"""Application-mediated constrained folder access engine.

Exposes strictly bounded file operations (list, read, write) over an approved
folder during an active lease, with zero operating-system level SMB or firewall
modifications.
"""

import os
import shutil
import time
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from driver_update_assistant.protocol import ErrorCode, FolderRequestStatus, SharePermission


@dataclass
class ActiveAccessSession:
    """Represents an active, employee-approved folder access lease."""

    session_id: str
    request_id: str
    device_id: str
    admin_id: str
    folder_path: str
    canonical_root: str
    permission: str  # READ or FULL
    purpose: str
    created_at: float
    expires_at: float
    status: str = FolderRequestStatus.ACTIVE.value

    def is_expired(self) -> bool:
        return time.time() > self.expires_at

    def time_remaining_seconds(self) -> int:
        remaining = int(self.expires_at - time.time())
        return max(0, remaining)

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


class AppMediatedAccessManager:
    """
    Manages active folder access sessions and enforces strict path sandboxing.
    All operations are confined within the approved folder's root directory.
    """

    def __init__(self):
        self._active_sessions: Dict[str, ActiveAccessSession] = {}

    def create_session(
        self,
        request_id: str,
        device_id: str,
        admin_id: str,
        folder_path: str,
        permission: str,
        purpose: str,
        duration_minutes: int,
    ) -> ActiveAccessSession:
        """Initializes a new approved lease."""
        import uuid
        now = time.time()
        session_id = f"sess_{int(now)}_{uuid.uuid4().hex[:8]}"
        resolved_root = os.path.realpath(os.path.abspath(folder_path))

        session = ActiveAccessSession(
            session_id=session_id,
            request_id=request_id,
            device_id=device_id,
            admin_id=admin_id,
            folder_path=folder_path,
            canonical_root=resolved_root,
            permission=permission,
            purpose=purpose,
            created_at=now,
            expires_at=now + (duration_minutes * 60),
            status=FolderRequestStatus.ACTIVE.value,
        )
        self._active_sessions[session_id] = session
        return session

    def get_session(self, session_id: str) -> Optional[ActiveAccessSession]:
        session = self._active_sessions.get(session_id)
        if session and session.is_expired():
            session.status = FolderRequestStatus.EXPIRED.value
        return session

    def get_active_sessions(self) -> List[ActiveAccessSession]:
        """Returns sessions that are currently active and not expired."""
        active = []
        for s in list(self._active_sessions.values()):
            if s.is_expired():
                s.status = FolderRequestStatus.EXPIRED.value
            elif s.status == FolderRequestStatus.ACTIVE.value:
                active.append(s)
        return active

    def revoke_session(self, session_id: str) -> bool:
        """Terminates an active session immediately."""
        session = self._active_sessions.get(session_id)
        if session:
            session.status = FolderRequestStatus.REVOKED.value
            return True
        return False

    def revoke_by_folder(self, folder_path: str) -> int:
        """Revokes all sessions matching a specific folder path (e.g. when removed from allowlist)."""
        resolved = os.path.realpath(os.path.abspath(folder_path))
        count = 0
        for session in self._active_sessions.values():
            if session.canonical_root == resolved and session.status == FolderRequestStatus.ACTIVE.value:
                session.status = FolderRequestStatus.REVOKED.value
                count += 1
        return count

    def _resolve_safe_subpath(self, session: ActiveAccessSession, rel_subpath: str) -> Tuple[bool, Optional[Path], str]:
        """
        Resolves a relative subpath within the session's canonical root.
        Rejects directory traversal (anti-path-traversal / ZipSlip defense).
        """
        if session.status != FolderRequestStatus.ACTIVE.value or session.is_expired():
            return False, None, "Access session has expired or is revoked."

        root = Path(session.canonical_root).resolve()
        clean_rel = rel_subpath.lstrip("/\\")
        candidate = (root / clean_rel).resolve()

        try:
            # Check if candidate is within root
            candidate.relative_to(root)
        except ValueError:
            return False, None, "Path traversal attempt detected. Access denied."

        return True, candidate, ""

    def list_directory(self, session_id: str, subpath: str = "") -> Tuple[bool, List[Dict[str, Any]], str]:
        """Lists files and folders inside an authorized folder."""
        session = self.get_session(session_id)
        if not session:
            return False, [], "Session not found."

        ok, target, err = self._resolve_safe_subpath(session, subpath)
        if not ok or not target:
            return False, [], err

        if not target.is_dir():
            return False, [], f"Target path is not a directory: {target}"

        items = []
        try:
            for entry in sorted(os.scandir(target), key=lambda e: (not e.is_dir(), e.name.lower())):
                try:
                    stat = entry.stat()
                    items.append({
                        "name": entry.name,
                        "is_dir": entry.is_dir(),
                        "size": stat.st_size if entry.is_file() else 0,
                        "modified_at": stat.st_mtime,
                    })
                except Exception:
                    continue
            return True, items, ""
        except Exception as e:
            return False, [], f"Failed to list directory: {str(e)}"

    def read_file(self, session_id: str, rel_path: str, max_bytes: int = 50 * 1024 * 1024) -> Tuple[bool, Optional[bytes], str]:
        """Safely reads the contents of a file within the authorized folder."""
        session = self.get_session(session_id)
        if not session:
            return False, None, "Session not found."

        ok, target, err = self._resolve_safe_subpath(session, rel_path)
        if not ok or not target:
            return False, None, err

        if not target.is_file():
            return False, None, f"Target path is not a file: {target}"

        try:
            size = target.stat().st_size
            if size > max_bytes:
                return False, None, f"File exceeds maximum allowed size ({max_bytes} bytes)."
            with open(target, "rb") as f:
                content = f.read()
            return True, content, ""
        except Exception as e:
            return False, None, f"Failed to read file: {str(e)}"

    def write_file(self, session_id: str, rel_path: str, content: bytes) -> Tuple[bool, str]:
        """Safely writes content to a file, strictly requiring READ_WRITE permission."""
        session = self.get_session(session_id)
        if not session:
            return False, "Session not found."

        if session.permission != SharePermission.READ_WRITE.value:
            return False, "Permission denied: Session is Read-Only."

        ok, target, err = self._resolve_safe_subpath(session, rel_path)
        if not ok or not target:
            return False, err

        try:
            target.parent.mkdir(parents=True, exist_ok=True)
            with open(target, "wb") as f:
                f.write(content)
            return True, "File written successfully."
        except Exception as e:
            return False, f"Failed to write file: {str(e)}"
