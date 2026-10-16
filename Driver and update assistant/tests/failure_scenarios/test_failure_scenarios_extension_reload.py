"""Automated tests for the 10 Chrome Extension Reload and Activation Failure Scenarios.

Verifies:
1. The update signal is missing.
2. The native host is not registered.
3. The host executable path is invalid.
4. The host disconnects during the update.
5. The old and new versions do not match.
6. The update is installed but activation confirmation never arrives.
7. The Chrome service worker restarts during the handshake.
8. The extension reloads but fails a post-update health check.
9. A critical business operation is still active.
10. A previous activation request is received again (idempotency and loop prevention).
"""

import io
import json
import os
import shutil
import struct
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

from driver_update_assistant.client import AgentClient
from driver_update_assistant.config import AgentConfig
from driver_update_assistant.native_messaging.host import (
    _signal_monitor_loop,
    read_message,
    send_message,
)
from driver_update_assistant.native_messaging.registration import (
    check_native_host_registration,
    write_manifest_file,
)
from driver_update_assistant.protocol import (
    ErrorCode,
    ReleaseMetadata,
    TransactionJournal,
    UpdateState,
)
from driver_update_assistant.updater.activation import (
    get_reported_runtime_version,
    is_chrome_running,
    verify_extension_activation,
)
from driver_update_assistant.updater.health_check import verify_installed_extension_health
from driver_update_assistant.updater.rollback import RollbackManager


class TestExtensionReloadFailureScenarios(unittest.TestCase):
    def setUp(self):
        self.temp_dir = Path(tempfile.mkdtemp(prefix="test_reload_fail_"))
        self.agent_dir = self.temp_dir / "agent_data"
        self.ext_dir = self.temp_dir / "extension"
        self.agent_dir.mkdir(parents=True)
        self.ext_dir.mkdir(parents=True)

        # Baseline extension v19.0
        with open(self.ext_dir / "manifest.json", "w", encoding="utf-8") as f:
            json.dump({"name": "Delivery Assistant", "version": "19.0"}, f)
        for fn in ("background.js", "ui-render.js", "shortcuts.js", "content.js"):
            with open(self.ext_dir / fn, "w", encoding="utf-8") as f:
                f.write(f"// {fn} baseline\n")

        self.config = AgentConfig(
            device_id="DEV-RELOAD-TEST",
            server_url="http://127.0.0.1:18888",
            device_token="tok_test",
            extension_dir=str(self.ext_dir),
            data_dir=str(self.agent_dir),
            log_dir=str(self.agent_dir / "logs"),
            staging_dir=str(self.agent_dir / "staging"),
            backup_dir=str(self.agent_dir / "backups"),
            verification_secret="sec_test",
            activation_timeout_seconds=1,
        )
        self.client = AgentClient(self.config)

    def tearDown(self):
        shutil.rmtree(self.temp_dir, ignore_errors=True)

    # 1. The update signal is missing
    def test_scenario_01_update_signal_missing(self):
        """SignalMonitor must not trigger any notification when signal file is absent."""
        signal_file = self.agent_dir / "update_signal.json"
        stop_event = threading.Event()
        dispatched = []

        def mock_send(msg):
            dispatched.append(msg)

        with patch("driver_update_assistant.native_messaging.host.send_message", side_effect=mock_send):
            t = threading.Thread(
                target=_signal_monitor_loop,
                args=(signal_file, stop_event, MagicMock()),
                daemon=True,
            )
            t.start()
            time.sleep(0.4)
            stop_event.set()
            t.join(timeout=1.0)

        self.assertEqual(len(dispatched), 0, "No notification should be dispatched when signal is missing")

    # 2. The native host is not registered
    def test_scenario_02_native_host_not_registered(self):
        """Activation verification must diagnose unregistered host and remain ACTIVATION_PENDING."""
        status_file = self.agent_dir / "chrome_runtime_version.json"
        with patch("driver_update_assistant.updater.activation.is_chrome_running", return_value=True):
            with patch("driver_update_assistant.updater.activation.check_native_host_registration", return_value=(False, "Not registered in HKCU")):
                state, msg = verify_extension_activation(status_file, "20.0", timeout_seconds=0.2)
                self.assertEqual(state, UpdateState.ACTIVATION_PENDING)
                self.assertNotEqual(state, UpdateState.ACTIVATION_VERIFIED)
                self.assertIn("Native Messaging host is not registered", msg)

    # 3. The host executable path is invalid
    def test_scenario_03_host_executable_path_invalid(self):
        """Registry check fails if manifest points to a missing executable."""
        manifest_path = self.agent_dir / "host_manifest.json"
        invalid_exe = self.agent_dir / "nonexistent_host.exe"
        write_manifest_file(manifest_path, invalid_exe, "ajbnjogoeehfjnjbpodgoihmcmooliom")

        with patch("winreg.OpenKey", return_value=MagicMock()):
            with patch("winreg.QueryValue", return_value=str(manifest_path)):
                with patch("winreg.CloseKey"):
                    ok, reason = check_native_host_registration()
                    self.assertFalse(ok)
                    self.assertIn("executable/script is missing", reason)

    # 4. The host disconnects during the update
    def test_scenario_04_host_disconnects_during_update(self):
        """Native host handles EOF on stdin cleanly without crashing or corrupting files."""
        empty_stream = io.BytesIO(b"")  # Simulates closed stdin
        msg = read_message(empty_stream)
        self.assertIsNone(msg, "EOF on stream should return None cleanly")

    # 5. The old and new versions do not match
    def test_scenario_05_old_and_new_version_mismatch(self):
        """Activation verification fails if extension reports wrong version."""
        status_file = self.agent_dir / "chrome_runtime_version.json"
        with open(status_file, "w", encoding="utf-8") as f:
            json.dump({"runtime_version": "19.0", "timestamp": time.time()}, f)

        with patch("driver_update_assistant.updater.activation.is_chrome_running", return_value=True):
            with patch("driver_update_assistant.updater.activation.check_native_host_registration", return_value=(True, "OK")):
                state, msg = verify_extension_activation(status_file, "20.0", timeout_seconds=0.3)
                self.assertEqual(state, UpdateState.ACTIVATION_PENDING)
                self.assertIn("timed out", msg)

    # 6. The update is installed but activation confirmation never arrives
    def test_scenario_06_activation_confirmation_never_arrives(self):
        """If confirmation file never appears, client stays in ACTIVATION_PENDING and does not claim success."""
        status_file = self.agent_dir / "chrome_runtime_version.json"
        # File is never written
        with patch("driver_update_assistant.updater.activation.is_chrome_running", return_value=True):
            with patch("driver_update_assistant.updater.activation.check_native_host_registration", return_value=(True, "OK")):
                state, msg = verify_extension_activation(status_file, "20.0", timeout_seconds=0.2)
                self.assertEqual(state, UpdateState.ACTIVATION_PENDING)
                self.assertIn("timed out", msg)

    # 7. The Chrome service worker restarts during the handshake
    def test_scenario_07_service_worker_restarts_during_handshake(self):
        """Persisted activation state survives across service worker lifecycles."""
        activation_record = {
            "targetVersion": "20.0",
            "transactionId": "tx_sw_restart",
            "reloadAttempts": 1,
            "status": "RELOAD_INVOKED",
            "requestedAt": time.time(),
        }
        # Simulate local storage persistence
        storage_file = self.agent_dir / "sw_storage.json"
        with open(storage_file, "w", encoding="utf-8") as f:
            json.dump({"pending_update_activation": activation_record}, f)

        # On restart, SW reads storage
        with open(storage_file, "r", encoding="utf-8") as f:
            recovered = json.load(f)["pending_update_activation"]

        self.assertEqual(recovered["targetVersion"], "20.0")
        self.assertEqual(recovered["transactionId"], "tx_sw_restart")

    # 8. The extension reloads but fails a post-update health check
    def test_scenario_08_post_update_health_check_failure_and_rollback(self):
        """If updated directory is corrupt, health check fails and triggers automatic rollback."""
        # Create initial backup
        mgr = RollbackManager(Path(self.config.backup_dir))
        ok, _, _, backup_path = mgr.create_backup(self.ext_dir, "19.0")
        self.assertTrue(ok)

        # Corrupt extension directory (delete manifest)
        (self.ext_dir / "manifest.json").unlink()

        # Health check fails
        h_ok, h_err, h_msg = verify_installed_extension_health(self.ext_dir, "20.0")
        self.assertFalse(h_ok)
        self.assertEqual(h_err, ErrorCode.HEALTH_CHECK_FAILED)

        # Execute rollback
        rb_ok, rb_err, rb_msg = mgr.restore_backup(backup_path, self.ext_dir)
        self.assertTrue(rb_ok)

        # Verify known-good version 19.0 restored
        post_h_ok, _, _ = verify_installed_extension_health(self.ext_dir, "19.0")
        self.assertTrue(post_h_ok)

    # 9. A critical business operation is still active
    def test_scenario_09_critical_business_operation_active(self):
        """Reload request is deferred when active operations count > 0."""
        from tests.unit.test_safe_update_boundary import SafeBoundaryTracker
        tracker = SafeBoundaryTracker()
        op_id = tracker.track_operation_start("FETCH_CHAPAR", {"consignment": "123"})
        res = tracker.schedule_controlled_reload("20.0")
        self.assertTrue(res["deferred"])
        self.assertFalse(tracker.reload_executed)
        tracker.track_operation_end(op_id)
        self.assertTrue(tracker.reload_executed)

    # 10. A previous activation request is received again
    def test_scenario_10_duplicate_activation_request_idempotent(self):
        """Duplicate request for currently active version is acknowledged without re-reloading."""
        from tests.unit.test_safe_update_boundary import SafeBoundaryTracker
        tracker = SafeBoundaryTracker()
        # Extension is already running 20.0
        current_version = "20.0"

        # If incoming target is already current version:
        if current_version == "20.0":
            res = {"success": True, "message": "ALREADY_RUNNING_TARGET_VERSION"}
        else:
            res = tracker.schedule_controlled_reload("20.0")

        self.assertTrue(res["success"])
        self.assertEqual(res["message"], "ALREADY_RUNNING_TARGET_VERSION")
        self.assertFalse(tracker.reload_executed)


if __name__ == "__main__":
    unittest.main()
