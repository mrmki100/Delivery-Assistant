"""Agent client, update transaction state machine, and durable outbox."""

import json
import os
import shutil
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from driver_update_assistant.config import AgentConfig
from driver_update_assistant.logging_setup import setup_logger
from driver_update_assistant.protocol import (
    DeviceStatusReport,
    ErrorCode,
    ReleaseMetadata,
    TransactionJournal,
    UpdateState,
)
from driver_update_assistant.folder_access.allowlist import SharedFolderAllowlist
from driver_update_assistant.updater.activation import verify_extension_activation
from driver_update_assistant.updater.downloader import download_package
from driver_update_assistant.updater.health_check import verify_installed_extension_health
from driver_update_assistant.updater.installer import apply_staged_files
from driver_update_assistant.updater.release_metadata import validate_release_metadata
from driver_update_assistant.updater.rollback import RollbackManager
from driver_update_assistant.updater.staging import stage_package
from driver_update_assistant.updater.verifier import verify_package_file


class DurableOutbox:
    """Stores undelivered telemetry status reports locally until the server is reachable."""

    def __init__(self, outbox_file: Path):
        self.outbox_file = outbox_file
        self.outbox_file.parent.mkdir(parents=True, exist_ok=True)

    def queue_report(self, report: DeviceStatusReport) -> None:
        reports = self.get_pending_reports()
        reports.append(report.to_dict())
        self._write(reports)

    def get_pending_reports(self) -> List[Dict[str, Any]]:
        if not self.outbox_file.exists():
            return []
        try:
            with open(self.outbox_file, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return []

    def _write(self, reports: List[Dict[str, Any]]) -> None:
        temp_file = self.outbox_file.with_suffix(".tmp")
        with open(temp_file, "w", encoding="utf-8") as f:
            json.dump(reports, f, indent=2)
        if self.outbox_file.exists():
            self.outbox_file.unlink()
        temp_file.replace(self.outbox_file)

    def remove_report(self, event_id: str) -> None:
        reports = self.get_pending_reports()
        reports = [r for r in reports if r.get("event_id") != event_id]
        self._write(reports)


class AgentClient:
    """Manages server communication, transaction journaling, and the update pipeline."""

    def __init__(self, config: AgentConfig):
        self.config = config
        self.logger = setup_logger("agent_client", config.log_dir, "agent.log", device_id=config.device_id)
        self.data_dir = Path(config.data_dir)
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.journal_file = self.data_dir / "transaction_journal.json"
        self.outbox = DurableOutbox(self.data_dir / "outbox.json")
        self.rollback_mgr = RollbackManager(Path(config.backup_dir))
        self.allowlist = SharedFolderAllowlist(self.data_dir)

    # --- Server API Communication ---

    def _get_json(self, endpoint: str, timeout: float = 10.0) -> Tuple[bool, Dict[str, Any]]:
        url = f"{self.config.server_url.rstrip('/')}{endpoint}"
        req = urllib.request.Request(
            url,
            headers={
                "Content-Type": "application/json",
                "x-device-id": self.config.device_id,
                "x-device-token": self.config.device_token,
                "Authorization": f"Bearer {self.config.device_token}",
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                body = json.loads(resp.read().decode("utf-8"))
                return True, body
        except Exception as e:
            return False, {"error": str(e)}

    def _post_json(self, endpoint: str, data: Dict[str, Any], timeout: float = 10.0) -> Tuple[bool, Dict[str, Any]]:
        url = f"{self.config.server_url.rstrip('/')}{endpoint}"
        payload = json.dumps(data).encode("utf-8")
        req = urllib.request.Request(
            url,
            data=payload,
            headers={
                "Content-Type": "application/json",
                "x-device-id": self.config.device_id,
                "x-device-token": self.config.device_token,
                "Authorization": f"Bearer {self.config.device_token}",
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                body = json.loads(resp.read().decode("utf-8"))
                return True, body
        except Exception as e:
            return False, {"error": str(e)}

    def check_in(self, installed_version: str, last_state: str) -> bool:
        """Sends periodic heartbeat check-in to server with advertised shared folders."""
        payload = {
            "installed_version": installed_version,
            "last_state": last_state,
            "shared_folders": self.allowlist.get_eligible_folders(),
        }
        ok, _ = self._post_json("/api/v1/devices/check-in", payload)
        return ok

    def get_pending_folder_requests(self) -> List[Dict[str, Any]]:
        """Queries the server for pending folder requests targeting this device."""
        ok, data = self._get_json("/api/v1/folder-requests/pending")
        if ok and data.get("success"):
            return data.get("pending_requests", [])
        return []

    def approve_folder_request(self, request_id: str, resolved_folder: str, permission: str) -> Tuple[bool, str]:
        """Submits employee approval for a requested folder."""
        ok, data = self._post_json(
            f"/api/v1/folder-requests/{request_id}/approve",
            {"folder_path": resolved_folder, "permission": permission},
        )
        if ok and data.get("success"):
            return True, data.get("message", "Request approved")
        return False, data.get("message", data.get("error", "Failed to approve"))

    def deny_folder_request(self, request_id: str) -> Tuple[bool, str]:
        """Submits employee denial for a requested folder."""
        ok, data = self._post_json(f"/api/v1/folder-requests/{request_id}/deny", {})
        if ok and data.get("success"):
            return True, "Request denied"
        return False, data.get("message", "Failed to deny")

    def revoke_folder_request(self, request_id: str) -> Tuple[bool, str]:
        """Terminates an active folder access session."""
        ok, data = self._post_json(f"/api/v1/folder-requests/{request_id}/revoke", {})
        if ok and data.get("success"):
            return True, "Access revoked"
        return False, data.get("message", "Failed to revoke")

    def flush_outbox(self) -> int:
        """Attempts to transmit pending telemetry reports from outbox."""
        pending = self.outbox.get_pending_reports()
        delivered = 0
        for rep in list(pending):
            ok, _ = self._post_json("/api/v1/devices/update-status", rep, timeout=5.0)
            if ok:
                self.outbox.remove_report(rep["event_id"])
                delivered += 1
            else:
                break
        return delivered

    def report_status(
        self,
        transaction_id: str,
        release_id: str,
        prev_ver: str,
        target_ver: str,
        state: UpdateState,
        rollback_verified: bool,
        reason: ErrorCode = ErrorCode.NONE,
        message: str = "",
    ) -> None:
        """Sends status telemetry report to server, falling back to local outbox."""
        rep = DeviceStatusReport(
            event_id=f"evt_{int(time.time())}_{os.urandom(4).hex()}",
            device_id=self.config.device_id,
            release_id=release_id,
            transaction_id=transaction_id,
            previous_version=prev_ver,
            target_version=target_ver,
            state=state,
            rollback_verified=rollback_verified,
            reason_code=reason,
            message=message,
            checkpoint_time=time.time(),
        )

        ok, _ = self._post_json("/api/v1/devices/update-status", rep.to_dict(), timeout=5.0)
        if not ok:
            self.logger.warning("Server unreachable; queued status report %s to outbox", rep.event_id)
            self.outbox.queue_report(rep)
        else:
            self.logger.info("Delivered status report %s: %s", rep.event_id, state.value)
            # Try flushing any other queued items
            self.flush_outbox()

    # --- Transaction Journal Persistence ---

    def read_journal(self) -> Optional[TransactionJournal]:
        if not self.journal_file.exists():
            return None
        try:
            with open(self.journal_file, "r", encoding="utf-8") as f:
                data = json.load(f)
            return TransactionJournal.from_dict(data)
        except Exception as e:
            self.logger.error("Failed to read transaction journal: %s", str(e))
            return None

    def write_journal(self, journal: TransactionJournal) -> None:
        """Atomically writes transaction journal state to disk."""
        journal.checkpoint_time = time.time()
        temp_file = self.journal_file.with_suffix(".tmp")
        with open(temp_file, "w", encoding="utf-8") as f:
            json.dump(journal.to_dict(), f, indent=2)
        if self.journal_file.exists():
            self.journal_file.unlink()
        temp_file.replace(self.journal_file)
        self.logger.debug("Journal state updated -> %s", journal.state.value)

    def get_installed_extension_version(self) -> str:
        """Reads version from manifest.json in the target extension directory."""
        ext_path = Path(self.config.extension_dir) / "manifest.json"
        if not ext_path.exists():
            return "0.0.0"
        try:
            with open(ext_path, "r", encoding="utf-8") as f:
                data = json.load(f)
            return data.get("version", "0.0.0")
        except Exception:
            return "0.0.0"

    # --- Update Pipeline Execution ---

    def check_for_update(self) -> Tuple[bool, ErrorCode, str, Optional[ReleaseMetadata]]:
        """Queries server for the latest release metadata."""
        url = f"{self.config.server_url.rstrip('/')}/api/v1/releases/latest"
        req = urllib.request.Request(
            url,
            headers={
                "x-device-id": self.config.device_id,
                "x-device-token": self.config.device_token,
                "Authorization": f"Bearer {self.config.device_token}",
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=10.0) as resp:
                body = json.loads(resp.read().decode("utf-8"))
                if not body.get("success"):
                    return False, ErrorCode.SERVER_UNAVAILABLE, "Server indicated failure", None

                current_ver = self.get_installed_extension_version()
                valid, err, msg, meta = validate_release_metadata(
                    body["release"], current_version=current_ver
                )
                return valid, err, msg, meta

        except urllib.error.HTTPError as he:
            if he.code == 404:
                return False, ErrorCode.NONE, "No update available", None
            if he.code in (401, 403):
                return False, ErrorCode.AUTH_FAILED, "Device authentication failed", None
            return False, ErrorCode.SERVER_UNAVAILABLE, f"HTTP Error {he.code}", None
        except urllib.error.URLError as ue:
            return False, ErrorCode.SERVER_UNAVAILABLE, f"Server unreachable: {str(ue.reason)}", None
        except Exception as e:
            return False, ErrorCode.SERVER_UNAVAILABLE, str(e), None

    def execute_update(self, metadata: ReleaseMetadata) -> TransactionJournal:
        """Executes full update transaction through state machine with rollback."""
        current_ver = self.get_installed_extension_version()
        tx_id = f"tx_{int(time.time())}_{os.urandom(4).hex()}"
        target_dir = Path(self.config.extension_dir)

        journal = TransactionJournal(
            transaction_id=tx_id,
            release_id=metadata.release_id,
            previous_version=current_ver,
            target_version=metadata.version,
            state=UpdateState.DOWNLOADING,
            target_path=str(target_dir),
        )
        self.write_journal(journal)

        pkg_dest = self.data_dir / "downloads" / f"{metadata.release_id}.zip"

        # 1. Download
        download_url = f"{self.config.server_url.rstrip('/')}/api/v1/releases/{metadata.release_id}/package"
        ok, err, msg, downloaded_file = download_package(
            url=download_url,
            target_path=pkg_dest,
            device_id=self.config.device_id,
            device_token=self.config.device_token,
            max_size_bytes=self.config.max_package_size_bytes,
        )
        if not ok or not downloaded_file:
            journal.state = UpdateState.FAILED
            journal.last_error = err
            journal.error_message = msg
            self.write_journal(journal)
            self.report_status(tx_id, metadata.release_id, current_ver, metadata.version, UpdateState.FAILED, False, err, msg)
            return journal

        # 2. Package verification
        ok, err, msg = verify_package_file(
            package_path=downloaded_file,
            metadata=metadata,
            verification_secret=self.config.verification_secret,
            max_size_bytes=self.config.max_package_size_bytes,
        )
        if not ok:
            journal.state = UpdateState.FAILED
            journal.last_error = err
            journal.error_message = msg
            self.write_journal(journal)
            self.report_status(tx_id, metadata.release_id, current_ver, metadata.version, UpdateState.FAILED, False, err, msg)
            return journal

        journal.state = UpdateState.DOWNLOAD_VERIFIED
        self.write_journal(journal)

        # 3. Safe Staging
        journal.state = UpdateState.STAGING
        self.write_journal(journal)
        ok, err, msg, staged_dir = stage_package(
            package_path=downloaded_file,
            staging_root=Path(self.config.staging_dir),
            metadata=metadata,
        )
        if not ok or not staged_dir:
            journal.state = UpdateState.FAILED
            journal.last_error = err
            journal.error_message = msg
            self.write_journal(journal)
            self.report_status(tx_id, metadata.release_id, current_ver, metadata.version, UpdateState.FAILED, False, err, msg)
            return journal

        journal.staging_path = str(staged_dir)
        journal.state = UpdateState.STAGED
        self.write_journal(journal)

        # 4. Create Snapshot Backup
        ok, err, msg, backup_path = self.rollback_mgr.create_backup(target_dir, current_ver)
        if not ok or not backup_path:
            journal.state = UpdateState.FAILED
            journal.last_error = err
            journal.error_message = msg
            self.write_journal(journal)
            self.report_status(tx_id, metadata.release_id, current_ver, metadata.version, UpdateState.FAILED, False, err, msg)
            return journal

        journal.backup_path = str(backup_path)
        journal.state = UpdateState.BACKUP_CREATED
        self.write_journal(journal)

        # 5. Apply Staged Files (Install)
        journal.state = UpdateState.INSTALLING
        self.write_journal(journal)

        ok, err, msg, written_files = apply_staged_files(staged_dir, target_dir)
        if not ok:
            self.logger.error("File installation failed (%s); triggering rollback", msg)
            return self._perform_rollback(journal, err, msg)

        # 6. Post-install Extension Health Check
        ok, err, msg = verify_installed_extension_health(target_dir, metadata.version)
        if not ok:
            self.logger.error("Health check failed (%s); triggering rollback", msg)
            return self._perform_rollback(journal, err, msg)

        journal.state = UpdateState.FILES_INSTALLED
        self.write_journal(journal)

        # Emit update signal for Chrome extension self-reload via Native Messaging host
        signal_file = self.data_dir / "update_signal.json"
        signal_payload = {
            "action": "UPDATE_READY",
            "transaction_id": tx_id,
            "target_version": metadata.version,
            "timestamp": time.time(),
            "nonce": os.urandom(8).hex(),
            "files_verified": True,
        }
        try:
            with open(signal_file, "w", encoding="utf-8") as sf:
                json.dump(signal_payload, sf, indent=2)
            self.logger.info("Dispatched update signal for v%s to %s", metadata.version, signal_file)
        except Exception as sig_err:
            self.logger.warning("Failed to write update_signal.json: %s", str(sig_err))

        # 7. Activation Verification
        journal.state = UpdateState.ACTIVATION_PENDING
        self.write_journal(journal)

        runtime_status_file = self.data_dir / "chrome_runtime_version.json"
        act_state, act_msg = verify_extension_activation(
            runtime_status_file,
            metadata.version,
            timeout_seconds=float(self.config.activation_timeout_seconds),
        )

        journal.state = act_state
        journal.error_message = act_msg
        self.write_journal(journal)

        self.report_status(
            tx_id,
            metadata.release_id,
            current_ver,
            metadata.version,
            act_state,
            False,
            ErrorCode.NONE,
            act_msg,
        )
        return journal

    def _perform_rollback(self, journal: TransactionJournal, cause_err: ErrorCode, cause_msg: str) -> TransactionJournal:
        """Executes verified rollback using the pre-update backup snapshot."""
        journal.state = UpdateState.ROLLING_BACK
        journal.last_error = cause_err
        journal.error_message = cause_msg
        self.write_journal(journal)

        if not journal.backup_path or not journal.target_path:
            journal.state = UpdateState.NEEDS_MANUAL_INTERVENTION
            self.write_journal(journal)
            self.report_status(
                journal.transaction_id,
                journal.release_id,
                journal.previous_version,
                journal.target_version,
                UpdateState.NEEDS_MANUAL_INTERVENTION,
                False,
                ErrorCode.ROLLBACK_FAILED,
                "Backup path missing from journal",
            )
            return journal

        ok, err, msg = self.rollback_mgr.restore_backup(
            Path(journal.backup_path),
            Path(journal.target_path),
        )

        if ok:
            journal.state = UpdateState.ROLLBACK_VERIFIED
            journal.rollback_verified = True
            self.write_journal(journal)
            self.report_status(
                journal.transaction_id,
                journal.release_id,
                journal.previous_version,
                journal.target_version,
                UpdateState.ROLLBACK_VERIFIED,
                True,
                cause_err,
                f"Rollback successful: {msg}",
            )
        else:
            journal.state = UpdateState.NEEDS_MANUAL_INTERVENTION
            journal.rollback_verified = False
            self.write_journal(journal)
            self.report_status(
                journal.transaction_id,
                journal.release_id,
                journal.previous_version,
                journal.target_version,
                UpdateState.NEEDS_MANUAL_INTERVENTION,
                False,
                err,
                f"Rollback verification failed: {msg}",
            )

        return journal

    def recover_startup(self) -> Tuple[bool, str]:
        """Inspects journal on agent startup and resolves interrupted transactions."""
        journal = self.read_journal()
        if not journal:
            return True, "Clean startup: No unfinished transactions"

        # Safe terminal states
        if journal.state in (UpdateState.IDLE, UpdateState.ACTIVATION_VERIFIED, UpdateState.ROLLBACK_VERIFIED):
            return True, f"Previous transaction finished cleanly ({journal.state.value})"

        self.logger.warning("Unfinished transaction detected in state %s; recovering", journal.state.value)

        # If interrupted before changing target files:
        if journal.state in (UpdateState.DOWNLOADING, UpdateState.DOWNLOAD_VERIFIED, UpdateState.STAGING, UpdateState.STAGED):
            journal.state = UpdateState.FAILED
            journal.last_error = ErrorCode.PROCESS_INTERRUPTED
            journal.error_message = "Process interrupted before installation"
            self.write_journal(journal)
            self.report_status(
                journal.transaction_id,
                journal.release_id,
                journal.previous_version,
                journal.target_version,
                UpdateState.FAILED,
                False,
                ErrorCode.PROCESS_INTERRUPTED,
                "Recovered to FAILED before installation",
            )
            return True, "Recovered safely: Transaction aborted prior to modifying extension files"

        # If interrupted during or after file copy, must roll back!
        if journal.state in (UpdateState.BACKUP_CREATED, UpdateState.INSTALLING, UpdateState.FILES_INSTALLED, UpdateState.ACTIVATION_PENDING, UpdateState.ROLLING_BACK):
            res_journal = self._perform_rollback(
                journal,
                ErrorCode.PROCESS_INTERRUPTED,
                "Process crashed or interrupted mid-install; automatic recovery rollback executed",
            )
            return (
                res_journal.rollback_verified,
                f"Recovery finished with state {res_journal.state.value}",
            )

        return False, f"Journal in unhandled state: {journal.state.value}"
