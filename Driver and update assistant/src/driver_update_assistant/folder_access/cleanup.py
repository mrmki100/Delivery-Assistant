"""Automated lease expiration, explicit revocation, and crash recovery cleanup engine."""

import time
from typing import List, Tuple

from driver_update_assistant.folder_access.session import SessionStore
from driver_update_assistant.folder_access.share_manager import ShareManager
from driver_update_assistant.protocol import FolderRequestStatus


class FolderCleanupEngine:
    """Ensures temporary shares are revoked on expiry, manual revocation, or startup."""

    def __init__(self, store: SessionStore, share_mgr: ShareManager):
        self.store = store
        self.share_mgr = share_mgr

    def check_and_clean_expired(self) -> List[Tuple[str, bool, str]]:
        """Scans active sessions and cleans up any whose lease has lapsed."""
        now = time.time()
        results = []
        active = self.store.get_active_sessions()

        for session in active:
            if now >= session.expires_at:
                ok, msg = self.share_mgr.remove_share(session.share_name, session.firewall_rule_name)
                self.store.update_status(session.session_id, FolderRequestStatus.EXPIRED)
                results.append((session.session_id, ok, f"Expired lease cleaned up: {msg}"))

        return results

    def revoke_session(self, session_id: str) -> Tuple[bool, str]:
        """Manually revokes an active session immediately."""
        session = self.store.get_session(session_id)
        if not session:
            return False, f"Session {session_id} not found"

        ok, msg = self.share_mgr.remove_share(session.share_name, session.firewall_rule_name)
        self.store.update_status(session_id, FolderRequestStatus.REVOKED)
        return ok, f"Revocation complete: {msg}"

    def startup_recovery(self) -> List[Tuple[str, bool, str]]:
        """
        Executed on agent startup: dismantles all lingering shares from previous crashes.
        """
        results = []
        active = self.store.get_active_sessions()
        for session in active:
            ok, msg = self.share_mgr.remove_share(session.share_name, session.firewall_rule_name)
            self.store.update_status(session.session_id, FolderRequestStatus.REVOKED)
            results.append((session.session_id, ok, f"Startup recovery unprovisioned share: {msg}"))
        return results
