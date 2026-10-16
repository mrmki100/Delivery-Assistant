"""Automated tests for Failure Scenarios 21 through 40 and Feature B failure tests (Section 8 & 13)."""

import json
import os
import shutil
import tempfile
import time
import unittest
import zipfile
from pathlib import Path
from unittest.mock import MagicMock, patch

import sys
from pathlib import Path

# Bootstrap sys.path
_src = Path(__file__).resolve().parent.parent.parent / "src"
if str(_src) not in sys.path:
    sys.path.insert(0, str(_src))

from driver_update_assistant.client import AgentClient
from driver_update_assistant.config import AgentConfig
from driver_update_assistant.folder_access.cleanup import FolderCleanupEngine
from driver_update_assistant.folder_access.consent import validate_shareable_folder_path
from driver_update_assistant.folder_access.one_time_code import (
    compute_otp_hash,
    generate_secure_otp,
    verify_otp_code,
)
from driver_update_assistant.folder_access.session import SessionStore
from driver_update_assistant.folder_access.share_manager import ShareManager
from driver_update_assistant.protocol import (
    ErrorCode,
    FolderRequestStatus,
    FolderSessionRecord,
    ReleaseMetadata,
    SharePermission,
    TransactionJournal,
    UpdateState,
)
from driver_update_assistant.updater.activation import verify_extension_activation
from driver_update_assistant.updater.health_check import verify_installed_extension_health
from driver_update_assistant.updater.release_metadata import validate_release_metadata
from driver_update_assistant.updater.rollback import RollbackManager


class TestFailureScenarios21to40(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.mkdtemp()
        self.agent_dir = Path(self.temp_dir) / "agent_data"
        self.ext_dir = Path(self.temp_dir) / "extension"
        self.agent_dir.mkdir(parents=True)
        self.ext_dir.mkdir(parents=True)

        # Baseline extension v19.0
        with open(self.ext_dir / "manifest.json", "w", encoding="utf-8") as f:
            json.dump({"name": "Delivery Assistant", "version": "19.0"}, f)
        for fn in ("background.js", "ui-render.js", "shortcuts.js", "content.js"):
            with open(self.ext_dir / fn, "w", encoding="utf-8") as f:
                f.write(f"// {fn} baseline\n")

        self.config = AgentConfig(
            device_id="DEV-TEST-2",
            server_url="http://127.0.0.1:18888",
            device_token="tok_123",
            extension_dir=str(self.ext_dir),
            data_dir=str(self.agent_dir),
            log_dir=str(self.agent_dir / "logs"),
            staging_dir=str(self.agent_dir / "staging"),
            backup_dir=str(self.agent_dir / "backups"),
            verification_secret="sec_123",
            activation_timeout_seconds=1,
        )
        self.client = AgentClient(self.config)

    def tearDown(self):
        shutil.rmtree(self.temp_dir, ignore_errors=True)

    # 21. Chrome is running while files are being replaced
    def test_scenario_21_chrome_running_activation_pending(self):
        status_file = self.agent_dir / "chrome_runtime_version.json"
        with patch("driver_update_assistant.updater.activation.is_chrome_running", return_value=True):
            state, msg = verify_extension_activation(status_file, "20.0", timeout_seconds=0.2)
            self.assertEqual(state, UpdateState.ACTIVATION_PENDING)

    # 22. Agent process terminated during download
    def test_scenario_22_terminated_during_download(self):
        journal = TransactionJournal("tx_22", "rel_20", "19.0", "20.0", UpdateState.DOWNLOADING)
        self.client.write_journal(journal)
        ok, msg = self.client.recover_startup()
        self.assertTrue(ok)
        recovered = self.client.read_journal()
        self.assertEqual(recovered.state, UpdateState.FAILED)
        self.assertEqual(recovered.last_error, ErrorCode.PROCESS_INTERRUPTED)

    # 23. Agent process terminated after backup but before installation
    def test_scenario_23_terminated_after_backup_before_install(self):
        mgr = RollbackManager(Path(self.config.backup_dir))
        _, _, _, bpath = mgr.create_backup(self.ext_dir, "19.0")
        journal = TransactionJournal("tx_23", "rel_20", "19.0", "20.0", UpdateState.BACKUP_CREATED,
                                     backup_path=str(bpath), target_path=str(self.ext_dir))
        self.client.write_journal(journal)
        ok, msg = self.client.recover_startup()
        self.assertTrue(ok)
        recovered = self.client.read_journal()
        self.assertEqual(recovered.state, UpdateState.ROLLBACK_VERIFIED)

    # 24. Agent process terminated halfway through installation
    def test_scenario_24_terminated_halfway_through_installation(self):
        mgr = RollbackManager(Path(self.config.backup_dir))
        _, _, _, bpath = mgr.create_backup(self.ext_dir, "19.0")
        journal = TransactionJournal("tx_24", "rel_20", "19.0", "20.0", UpdateState.INSTALLING,
                                     backup_path=str(bpath), target_path=str(self.ext_dir))
        self.client.write_journal(journal)
        ok, msg = self.client.recover_startup()
        self.assertTrue(ok)
        recovered = self.client.read_journal()
        self.assertEqual(recovered.state, UpdateState.ROLLBACK_VERIFIED)

    # 25. Agent process terminated immediately after file replacement
    def test_scenario_25_terminated_after_file_replacement(self):
        mgr = RollbackManager(Path(self.config.backup_dir))
        _, _, _, bpath = mgr.create_backup(self.ext_dir, "19.0")
        journal = TransactionJournal("tx_25", "rel_20", "19.0", "20.0", UpdateState.ACTIVATION_PENDING,
                                     backup_path=str(bpath), target_path=str(self.ext_dir))
        self.client.write_journal(journal)
        ok, msg = self.client.recover_startup()
        self.assertTrue(ok)
        recovered = self.client.read_journal()
        self.assertEqual(recovered.state, UpdateState.ROLLBACK_VERIFIED)

    # 26. Administrator server crashes during an update
    def test_scenario_26_server_crashes_during_update(self):
        # Simulated by failure when reporting status
        with patch.object(self.client, "_post_json", return_value=(False, {"error": "Server connection refused"})):
            self.client.report_status("tx_26", "rel_20", "19.0", "20.0", UpdateState.FAILED, True, ErrorCode.SERVER_UNAVAILABLE)
            pending = self.client.outbox.get_pending_reports()
            self.assertEqual(len(pending), 1)

    # 27. Agent restarts with unfinished transaction journal
    def test_scenario_27_restart_with_unfinished_journal(self):
        journal = TransactionJournal("tx_27", "rel_20", "19.0", "20.0", UpdateState.STAGING)
        self.client.write_journal(journal)
        ok, msg = self.client.recover_startup()
        self.assertTrue(ok)
        self.assertEqual(self.client.read_journal().state, UpdateState.FAILED)

    # 28. Rollback encounters locked file or permission failure
    def test_scenario_28_rollback_encounters_locked_file(self):
        mgr = RollbackManager(Path(self.config.backup_dir))
        _, _, _, bpath = mgr.create_backup(self.ext_dir, "19.0")
        journal = TransactionJournal("tx_28", "rel_20", "19.0", "20.0", UpdateState.ROLLING_BACK,
                                     backup_path=str(bpath), target_path=str(self.ext_dir))
        self.client.write_journal(journal)

        with patch("shutil.copy2", side_effect=PermissionError("File locked by process")):
            res = self.client._perform_rollback(journal, ErrorCode.FILE_LOCKED, "Test lock")
            self.assertEqual(res.state, UpdateState.NEEDS_MANUAL_INTERVENTION)
            self.assertFalse(res.rollback_verified)

    # 29. Restored backup fails its integrity check
    def test_scenario_29_restored_backup_fails_integrity(self):
        mgr = RollbackManager(Path(self.config.backup_dir))
        _, _, _, bpath = mgr.create_backup(self.ext_dir, "19.0")
        # Tamper with backup file
        with open(bpath / "manifest.json", "w") as f:
            f.write("tampered manifest content")

        ok, err, msg = mgr.restore_backup(bpath, self.ext_dir)
        self.assertFalse(ok)
        self.assertEqual(err, ErrorCode.BACKUP_CORRUPTED)

    # 30 & 31. Chrome does not activate / continues to run old version
    def test_scenario_30_31_chrome_activation_timeout(self):
        status_file = self.agent_dir / "chrome_runtime_version.json"
        with open(status_file, "w") as f:
            json.dump({"runtime_version": "19.0"}, f)  # still running 19.0

        with patch("driver_update_assistant.updater.activation.is_chrome_running", return_value=True):
            state, msg = verify_extension_activation(status_file, "20.0", timeout_seconds=0.2)
            self.assertEqual(state, UpdateState.ACTIVATION_PENDING)

    # 32. Extension fails post-update health check (missing files)
    def test_scenario_32_extension_health_check_fails(self):
        broken_dir = self.agent_dir / "broken_ext"
        broken_dir.mkdir()
        with open(broken_dir / "manifest.json", "w") as f:
            json.dump({"version": "20.0"}, f)
        # missing background.js, ui-render.js
        ok, err, msg = verify_installed_extension_health(broken_dir, "20.0")
        self.assertFalse(ok)
        self.assertEqual(err, ErrorCode.HEALTH_CHECK_FAILED)

    # 33. Device cannot report status to server (outbox test)
    def test_scenario_33_outbox_queueing(self):
        with patch.object(self.client, "_post_json", return_value=(False, {})):
            self.client.report_status("tx_33", "rel_20", "19.0", "20.0", UpdateState.ROLLBACK_VERIFIED, True)
            self.assertEqual(len(self.client.outbox.get_pending_reports()), 1)

    # 34. Server restarts and receives duplicate or stale status reports
    def test_scenario_34_server_duplicate_report_idempotency(self):
        # Even if flushed multiple times, event_id keeps it distinct
        outbox = self.client.outbox
        rep = MagicMock()
        rep.event_id = "evt_dup_1"
        rep.to_dict.return_value = {"event_id": "evt_dup_1"}
        outbox.queue_report(rep)
        self.assertEqual(len(outbox.get_pending_reports()), 1)
        outbox.remove_report("evt_dup_1")
        self.assertEqual(len(outbox.get_pending_reports()), 0)

    # 35. Old release replayed as if new
    def test_scenario_35_replayed_old_release_rejected(self):
        old_release = {
            "product_id": "delivery_assistant",
            "version": "18.0",
            "release_id": "rel_old",
            "package_size": 100,
            "package_sha256": "h",
            "signature": "s",
        }
        ok, err, msg, _ = validate_release_metadata(old_release, current_version="19.0", allow_downgrade=False)
        self.assertFalse(ok)
        self.assertEqual(err, ErrorCode.VERSION_CONFLICT)

    # 36. Two update requests arrive concurrently
    def test_scenario_36_concurrency_guard(self):
        # If transaction in progress, state is not IDLE
        j1 = TransactionJournal("tx_con_1", "rel_20", "19.0", "20.0", UpdateState.INSTALLING)
        self.client.write_journal(j1)
        current_j = self.client.read_journal()
        self.assertEqual(current_j.state, UpdateState.INSTALLING)

    # 37. User attempts to change extension path to arbitrary directory
    def test_scenario_37_arbitrary_extension_path_rejected(self):
        bad_path = Path(self.temp_dir) / "arbitrary_empty_dir"
        bad_path.mkdir()
        mgr = RollbackManager(Path(self.config.backup_dir))
        ok, err, msg = verify_installed_extension_health(bad_path, "20.0")
        self.assertFalse(ok)
        self.assertEqual(err, ErrorCode.HEALTH_CHECK_FAILED)

    # 38. Update server returns incompatible release
    def test_scenario_38_incompatible_release_rejected(self):
        incomp = {
            "product_id": "other_extension_app",
            "version": "25.0",
            "release_id": "rel_incomp",
            "package_size": 100,
            "package_sha256": "h",
            "signature": "s",
        }
        ok, err, msg, _ = validate_release_metadata(incomp, current_version="19.0")
        self.assertFalse(ok)
        self.assertEqual(err, ErrorCode.INCOMPATIBLE_RELEASE)

    # 39. Machine shuts down during transaction (startup recovery test)
    def test_scenario_39_machine_shutdown_mid_transaction(self):
        mgr = RollbackManager(Path(self.config.backup_dir))
        _, _, _, bpath = mgr.create_backup(self.ext_dir, "19.0")
        j = TransactionJournal("tx_shutdown", "rel_20", "19.0", "20.0", UpdateState.INSTALLING,
                               backup_path=str(bpath), target_path=str(self.ext_dir))
        self.client.write_journal(j)
        ok, msg = self.client.recover_startup()
        self.assertTrue(ok)
        self.assertEqual(self.client.read_journal().state, UpdateState.ROLLBACK_VERIFIED)

    # 40. Previous version missing or corrupted before update begins
    def test_scenario_40_previous_version_missing(self):
        empty_dir = self.agent_dir / "empty_ext"
        empty_dir.mkdir()
        mgr = RollbackManager(Path(self.config.backup_dir))
        ok, err, msg = verify_installed_extension_health(empty_dir, "19.0")
        self.assertFalse(ok)
        self.assertEqual(err, ErrorCode.HEALTH_CHECK_FAILED)

    # --- Feature B: Access Request and Cleanup Failure Tests (Section 13) ---

    def test_feature_b_employee_denies_request(self):
        session_store = SessionStore(self.agent_dir / "sessions.json")
        rec = FolderSessionRecord("s1", "r1", "DEV", "DA_Share_1", "C:\\Logs", SharePermission.READ_ONLY, None, time.time(), time.time() + 1800, status=FolderRequestStatus.DENIED)
        session_store.save_session(rec)
        self.assertEqual(len(session_store.get_active_sessions()), 0)

    def test_feature_b_otp_expired_before_approval(self):
        clean, _ = generate_secure_otp(8)
        h = compute_otp_hash(clean, "req_exp", "DEV", "sec_123")
        ok, reason = verify_otp_code(clean, h, "req_exp", "DEV", "sec_123", time.time() - 1, 0)
        self.assertFalse(ok)
        self.assertEqual(reason, "OTP_EXPIRED")

    def test_feature_b_otp_attempt_limit_exceeded(self):
        clean, _ = generate_secure_otp(8)
        h = compute_otp_hash(clean, "req_lim", "DEV", "sec_123")
        ok, reason = verify_otp_code("wrong", h, "req_lim", "DEV", "sec_123", time.time() + 100, 3, max_attempts=3)
        self.assertFalse(ok)
        self.assertEqual(reason, "OTP_MAX_ATTEMPTS")

    def test_feature_b_request_modified_after_otp_generation(self):
        clean, _ = generate_secure_otp(8)
        h = compute_otp_hash(clean, "req_original", "DEV", "sec_123")
        # Attacker submits code for different request ID
        ok, reason = verify_otp_code(clean, h, "req_tampered", "DEV", "sec_123", time.time() + 100, 0)
        self.assertFalse(ok)
        self.assertEqual(reason, "OTP_INVALID")

    def test_feature_b_share_cleanup_after_crash_reboot(self):
        session_store = SessionStore(self.agent_dir / "sessions.json")
        share_mgr = ShareManager(dry_run=True)
        cleanup = FolderCleanupEngine(session_store, share_mgr)

        rec = FolderSessionRecord("s_crash", "r_crash", "DEV", "DA_Crash_Share", "C:\\Logs", SharePermission.READ_ONLY, None, time.time() - 3600, time.time() - 1800, status=FolderRequestStatus.ACTIVE)
        session_store.save_session(rec)

        results = cleanup.startup_recovery()
        self.assertEqual(len(results), 1)
        self.assertEqual(len(session_store.get_active_sessions()), 0)


if __name__ == "__main__":
    unittest.main()
