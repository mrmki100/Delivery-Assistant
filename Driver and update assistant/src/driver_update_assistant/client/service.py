"""Background client service and async workers for communication, updates, and folder sessions."""

import json
import time
import urllib.request
from pathlib import Path
from typing import Any, Dict, List, Optional
from PySide6.QtCore import QObject, QThread, Signal

from driver_update_assistant.client import AgentClient
from driver_update_assistant.config import AgentConfig
from driver_update_assistant.folder_access.cleanup import FolderCleanupEngine
from driver_update_assistant.folder_access.session import SessionStore
from driver_update_assistant.folder_access.share_manager import ShareManager
from driver_update_assistant.protocol import (
    ErrorCode,
    FolderRequestStatus,
    FolderSessionRecord,
    ReleaseMetadata,
    UpdateState,
)


class CheckUpdateWorker(QThread):
    """Background worker for checking updates without blocking the UI."""

    finished_check = Signal(bool, bool, str, object)  # is_online, update_avail, message, ReleaseMetadata

    def __init__(self, client: AgentClient, parent: Optional[QObject] = None):
        super().__init__(parent)
        self.client = client

    def run(self) -> None:
        try:
            curr_ver = self.client.get_installed_extension_version()
            # Send check-in heartbeat
            is_online = self.client.check_in(curr_ver, "IDLE")
            if not is_online:
                self.finished_check.emit(False, False, "Cannot connect to central server.", None)
                return

            # Check for update
            valid, err, msg, meta = self.client.check_for_update()
            if valid and meta:
                self.finished_check.emit(True, True, f"New release available: v{meta.version}", meta)
            else:
                self.finished_check.emit(True, False, msg or "Extension is up to date.", None)
        except Exception as e:
            self.finished_check.emit(False, False, f"Check failed: {str(e)}", None)


class ExecuteUpdateWorker(QThread):
    """Background worker for executing update download, verify, staging, install, and reload check."""

    step_changed = Signal(str, int)  # step_name, percent (0-100)
    finished_update = Signal(bool, str, str)  # success, state_name, message

    def __init__(self, client: AgentClient, metadata: ReleaseMetadata, parent: Optional[QObject] = None):
        super().__init__(parent)
        self.client = client
        self.metadata = metadata

    def run(self) -> None:
        try:
            self.step_changed.emit("Downloading release package...", 20)
            # The client execute_update runs all stages transactionally
            journal = self.client.execute_update(self.metadata)

            if journal.state in (UpdateState.ACTIVATION_VERIFIED, UpdateState.ACTIVATION_PENDING, UpdateState.FILES_INSTALLED):
                self.step_changed.emit("Update installed successfully!", 100)
                self.finished_update.emit(True, journal.state.value, journal.error_message or "Installed successfully.")
            elif journal.rollback_verified:
                self.step_changed.emit("Rolled back to previous version.", 100)
                self.finished_update.emit(False, journal.state.value, f"Rolled back: {journal.error_message}")
            else:
                self.step_changed.emit("Update failed.", 100)
                self.finished_update.emit(False, journal.state.value, journal.error_message or "Unknown update failure.")
        except Exception as e:
            self.finished_update.emit(False, "FAILED", str(e))


class ClientManager(QObject):
    """Coordinates AgentClient, SessionStore, ShareManager, and periodic polling."""

    pending_requests_changed = Signal(list)
    active_sessions_changed = Signal(list)

    def __init__(self, config: AgentConfig, parent: Optional[QObject] = None):
        super().__init__(parent)
        self.config = config
        self.client = AgentClient(config)
        self.session_store = SessionStore(Path(config.data_dir) / "folder_sessions.json")
        self.share_mgr = ShareManager(dry_run=False)
        self.cleanup_engine = FolderCleanupEngine(self.session_store, self.share_mgr)

        # Run startup recovery on shares
        self.cleanup_engine.startup_recovery()
        # Run startup transaction recovery
        self.client.recover_startup()

    def get_pending_server_requests(self) -> List[Dict[str, Any]]:
        """Queries server for pending folder access requests targeted at this device."""
        url = f"{self.config.server_url.rstrip('/')}/api/v1/folder-requests/pending"
        req = urllib.request.Request(
            url,
            headers={
                "x-device-id": self.config.device_id,
                "x-device-token": self.config.device_token,
                "Authorization": f"Bearer {self.config.device_token}",
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=5.0) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                return data.get("pending_requests", [])
        except Exception:
            return []

    def poll_state(self) -> None:
        """Polls server pending requests and active share leases."""
        # 1. Clean up any expired shares locally
        self.cleanup_engine.check_and_clean_expired()

        # 2. Get active shares
        active = self.session_store.get_active_sessions()
        self.active_sessions_changed.emit([s.to_dict() for s in active])

        # 3. Get pending requests from server
        pending = self.get_pending_server_requests()
        self.pending_requests_changed.emit(pending)

    def submit_challenge_to_server(self, request_id: str, otp_hash: str, folder_path: str, perm: str) -> Tuple[bool, str]:
        """Registers the employee consent challenge on the central server."""
        url = f"{self.config.server_url.rstrip('/')}/api/v1/folder-requests/{request_id}/approval-challenge"
        payload = json.dumps({
            "otp_hash": otp_hash,
            "folder_path": folder_path,
            "permission": perm,
        }).encode("utf-8")
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
            with urllib.request.urlopen(req, timeout=8.0) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                return data.get("success", False), data.get("message", "Challenge registered")
        except Exception as e:
            return False, str(e)

    def deny_request_on_server(self, request_id: str) -> Tuple[bool, str]:
        """Denies a pending folder request on the central server."""
        url = f"{self.config.server_url.rstrip('/')}/api/v1/folder-requests/{request_id}/deny"
        req = urllib.request.Request(
            url,
            data=b"{}",
            headers={
                "Content-Type": "application/json",
                "x-device-id": self.config.device_id,
                "x-device-token": self.config.device_token,
                "Authorization": f"Bearer {self.config.device_token}",
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=8.0) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                return data.get("success", False), data.get("message", "Denied")
        except Exception as e:
            return False, str(e)
