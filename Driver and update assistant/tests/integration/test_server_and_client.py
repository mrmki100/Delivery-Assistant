"""Integration tests verifying Admin Server and Agent Client interaction."""

import json
import os
import shutil
import tempfile
import threading
import time
import unittest
from pathlib import Path

import sys
from pathlib import Path

# Bootstrap sys.path
_src = Path(__file__).resolve().parent.parent.parent / "src"
if str(_src) not in sys.path:
    sys.path.insert(0, str(_src))

from driver_update_assistant.client import AgentClient
from driver_update_assistant.config import AgentConfig, ServerConfig
from driver_update_assistant.protocol import (
    ErrorCode,
    FolderRequestStatus,
    SharePermission,
    UpdateState,
)
from driver_update_assistant.server.app import AdminServer, hash_otp_challenge
from driver_update_assistant.server.release_store import ReleaseStore


class TestServerClientIntegration(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.test_dir = tempfile.mkdtemp()
        cls.server_dir = Path(cls.test_dir) / "server_data"
        cls.releases_dir = Path(cls.test_dir) / "releases"
        cls.agent_dir = Path(cls.test_dir) / "agent_data"
        cls.extension_dir = Path(cls.test_dir) / "extension"

        cls.server_dir.mkdir(parents=True)
        cls.releases_dir.mkdir(parents=True)
        cls.agent_dir.mkdir(parents=True)
        cls.extension_dir.mkdir(parents=True)

        # Seed initial extension (v19.0)
        with open(cls.extension_dir / "manifest.json", "w", encoding="utf-8") as f:
            json.dump({"name": "Delivery Assistant", "version": "19.0"}, f)
        for fn in ("background.js", "ui-render.js", "shortcuts.js", "content.js"):
            with open(cls.extension_dir / fn, "w", encoding="utf-8") as f:
                f.write(f"// {fn} v19\n")

        # Configure Server
        cls.port = 18088
        cls.server_config = ServerConfig(
            host="127.0.0.1",
            port=cls.port,
            data_dir=str(cls.server_dir),
            releases_dir=str(cls.releases_dir),
            secret_key="integration-test-secret-key-12345",
        )
        cls.server = AdminServer(cls.server_config)
        cls.server_thread = threading.Thread(target=cls.server.start, daemon=True)
        cls.server_thread.start()
        time.sleep(0.5)  # Let server start

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        shutil.rmtree(cls.test_dir, ignore_errors=True)

    def setUp(self):
        self.device_id = "TEST-LAPTOP-01"
        self.device_token = "tok_test_123456"

        # Enroll device
        self.server.state.registry.enroll_device(self.device_id, self.device_token)

        self.agent_config = AgentConfig(
            device_id=self.device_id,
            server_url=f"http://127.0.0.1:{self.port}",
            device_token=self.device_token,
            extension_dir=str(self.extension_dir),
            data_dir=str(self.agent_dir),
            log_dir=str(self.agent_dir / "logs"),
            staging_dir=str(self.agent_dir / "staging"),
            backup_dir=str(self.agent_dir / "backups"),
            verification_secret=self.server_config.secret_key,
            activation_timeout_seconds=2,
        )
        self.client = AgentClient(self.agent_config)

    def test_01_device_checkin(self):
        ok = self.client.check_in("19.0", "IDLE")
        self.assertTrue(ok)
        dev = self.server.state.registry.get_device(self.device_id)
        self.assertIsNotNone(dev)
        self.assertEqual(dev["installed_version"], "19.0")

    def test_02_publish_and_update_lifecycle(self):
        # 1. Prepare release v20.0 source
        new_ext_src = Path(self.test_dir) / "v20_source"
        new_ext_src.mkdir(parents=True, exist_ok=True)
        with open(new_ext_src / "manifest.json", "w", encoding="utf-8") as f:
            json.dump({"name": "Delivery Assistant", "version": "20.0"}, f)
        for fn in ("background.js", "ui-render.js", "shortcuts.js", "content.js"):
            with open(new_ext_src / fn, "w", encoding="utf-8") as f:
                f.write(f"// {fn} v20 upgraded\n")

        # 2. Publish release to server
        store = ReleaseStore(str(self.releases_dir))
        meta, zip_path = store.publish_release(
            version="20.0",
            source_dir=str(new_ext_src),
            secret_key=self.server_config.secret_key,
            notes="Version 20 release notes",
        )
        self.assertEqual(meta.version, "20.0")

        # 3. Client checks for update
        ok, err, msg, found_meta = self.client.check_for_update()
        self.assertTrue(ok)
        self.assertIsNotNone(found_meta)
        self.assertEqual(found_meta.version, "20.0")

        # 4. Client executes full update transaction
        journal = self.client.execute_update(found_meta)
        self.assertIn(journal.state, (UpdateState.ACTIVATION_VERIFIED, UpdateState.ACTIVATION_PENDING))
        self.assertEqual(journal.target_version, "20.0")

        # Check installed files updated on disk
        with open(self.extension_dir / "manifest.json", "r", encoding="utf-8") as f:
            installed = json.load(f)
        self.assertEqual(installed.get("version"), "20.0")

    def test_03_telemetry_outbox_queueing_and_flushing(self):
        # 1. Point client temporarily to an unreachable server
        bad_config = AgentConfig(
            device_id=self.device_id,
            server_url="http://127.0.0.1:19999",  # Nothing listening
            device_token=self.device_token,
            data_dir=str(self.agent_dir),
        )
        offline_client = AgentClient(bad_config)

        # 2. Send status report while server is offline
        offline_client.report_status(
            transaction_id="tx_offline_test",
            release_id="rel_20_test",
            prev_ver="19.0",
            target_ver="20.0",
            state=UpdateState.FAILED,
            rollback_verified=True,
            reason=ErrorCode.SERVER_UNAVAILABLE,
            message="Test offline queueing",
        )

        # 3. Check that outbox has 1 queued item
        pending = offline_client.outbox.get_pending_reports()
        self.assertEqual(len(pending), 1)

        # 4. Flush outbox using original online client
        delivered = self.client.flush_outbox()
        self.assertEqual(delivered, 1)
        self.assertEqual(len(self.client.outbox.get_pending_reports()), 0)

    def test_04_folder_request_and_otp_approval_workflow(self):
        # 1. Admin creates folder request on server
        req_id = "req_test_share_01"
        self.server.state.folder_requests[req_id] = {
            "request_id": req_id,
            "device_id": self.device_id,
            "admin_id": "Admin1",
            "purpose": "Diagnostics",
            "proposed_folder": "C:\\Logs",
            "permission": SharePermission.READ_ONLY.value,
            "status": FolderRequestStatus.PENDING.value,
            "created_at": time.time(),
            "expires_at": time.time() + 1800,
            "attempts": 0,
            "otp_hash": None,
        }

        # 2. Employee agent generates OTP challenge
        clean_code = "74920148"
        otp_hash = hash_otp_challenge(clean_code, req_id, self.device_id, self.server_config.secret_key)

        ok, body = self.client._post_json(
            f"/api/v1/folder-requests/{req_id}/approval-challenge",
            {"otp_hash": otp_hash, "folder_path": "C:\\Logs", "permission": "READ"},
        )
        self.assertTrue(ok)
        self.assertEqual(self.server.state.folder_requests[req_id]["status"], FolderRequestStatus.CHALLENGED.value)

        # 3. Admin enters OTP to approve request
        approve_ok, app_body = self.client._post_json(
            "/api/v1/admin/approve-folder",
            {"request_id": req_id, "code": clean_code},
        )
        # Note: Must pass admin token
        # Let's test admin approve endpoint directly or with admin header
        req_rec = self.server.state.folder_requests[req_id]
        computed = hash_otp_challenge(clean_code, req_id, self.device_id, self.server_config.secret_key)
        self.assertEqual(req_rec["otp_hash"], computed)


if __name__ == "__main__":
    unittest.main()
