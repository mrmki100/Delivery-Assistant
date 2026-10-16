"""Client-side shared folder allowlist management and persistence."""

import json
import os
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Dict, List, Optional, Tuple

from driver_update_assistant.folder_access.consent import validate_shareable_folder_path
from driver_update_assistant.protocol import ErrorCode, SharePermission


@dataclass
class SharedFolderEntry:
    """A configured folder made eligible for future administrative access requests."""

    path: str
    canonical_path: str
    permission: str  # SharePermission.READ_ONLY.value or SharePermission.READ_WRITE.value
    enabled: bool = True
    added_at: float = 0.0

    def to_dict(self) -> Dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: Dict) -> "SharedFolderEntry":
        return cls(
            path=data["path"],
            canonical_path=data["canonical_path"],
            permission=data.get("permission", SharePermission.READ_ONLY.value),
            enabled=data.get("enabled", True),
            added_at=float(data.get("added_at", 0.0)),
        )


class SharedFolderAllowlist:
    """
    Manages the local database of employee-approved shared folders.
    Persists configuration in data/shared_folders.json.
    """

    def __init__(self, data_dir: Path):
        self.data_dir = Path(data_dir)
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.config_file = self.data_dir / "shared_folders.json"
        self._entries: Dict[str, SharedFolderEntry] = {}
        self.load()

    def load(self) -> None:
        """Loads configured shared folders from persistent disk storage."""
        if not self.config_file.exists():
            self._entries = {}
            return
        try:
            with open(self.config_file, "r", encoding="utf-8") as f:
                data = json.load(f)
            self._entries = {
                k: SharedFolderEntry.from_dict(v)
                for k, v in data.items()
            }
        except Exception:
            self._entries = {}

    def save(self) -> None:
        """Atomically saves the shared folder configuration to disk."""
        tmp = self.config_file.with_suffix(".tmp")
        payload = {k: v.to_dict() for k, v in self._entries.items()}
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(payload, f, indent=2)
        if self.config_file.exists():
            self.config_file.unlink()
        tmp.replace(self.config_file)

    @staticmethod
    def canonicalize_path(raw_path: str) -> str:
        """Normalizes and canonicalizes a Windows path for consistent comparison."""
        resolved = os.path.realpath(os.path.expandvars(raw_path.strip()))
        return os.path.normcase(os.path.abspath(resolved))

    def add_folder(
        self,
        raw_path: str,
        permission: SharePermission = SharePermission.READ_ONLY,
    ) -> Tuple[bool, str, Optional[SharedFolderEntry]]:
        """
        Validates, canonicalizes, and adds a folder to the local allowlist.
        Returns (success, message, entry).
        """
        is_safe, err_code, reason, canonical = validate_shareable_folder_path(raw_path)
        if not is_safe or not canonical:
            return False, reason, None

        norm_key = self.canonicalize_path(canonical)
        import time
        entry = SharedFolderEntry(
            path=canonical,
            canonical_path=norm_key,
            permission=permission.value,
            enabled=True,
            added_at=time.time(),
        )
        self._entries[norm_key] = entry
        self.save()
        return True, f"Folder '{canonical}' added successfully.", entry

    def remove_folder(self, raw_path: str) -> Tuple[bool, str]:
        """Removes a folder from the allowlist by path."""
        norm_key = self.canonicalize_path(raw_path)
        if norm_key in self._entries:
            del self._entries[norm_key]
            self.save()
            return True, "Folder removed from allowlist."
        return False, "Folder not found in allowlist."

    def list_folders(self) -> List[SharedFolderEntry]:
        """Returns all configured folder entries."""
        return list(self._entries.values())

    def get_eligible_folders(self) -> List[Dict]:
        """
        Returns a sanitized list of enabled eligible folders advertised to the Server.
        Only valid existing directories are included.
        """
        eligible = []
        for entry in self._entries.values():
            if not entry.enabled:
                continue
            # Re-verify the directory still exists
            if not os.path.isdir(entry.path):
                continue
            eligible.append({
                "path": entry.path,
                "permission": entry.permission,
            })
        return eligible

    def is_request_allowed(
        self,
        requested_path: str,
        requested_permission: str,
    ) -> Tuple[bool, str, Optional[SharedFolderEntry]]:
        """
        Validates whether an incoming administrative request matches a configured folder.
        Enforces that write access cannot be granted if only read-only was configured.
        """
        norm_key = self.canonicalize_path(requested_path)
        entry = self._entries.get(norm_key)

        if not entry:
            return False, f"Folder '{requested_path}' is not in the client allowlist.", None

        if not entry.enabled:
            return False, f"Folder '{requested_path}' is currently disabled by employee.", None

        if not os.path.isdir(entry.path):
            return False, f"Folder '{entry.path}' no longer exists on disk.", None

        # Check permission elevation
        if requested_permission == SharePermission.READ_WRITE.value and entry.permission == SharePermission.READ_ONLY.value:
            return False, "Request asks for Read-Write access, but folder is configured as Read-Only.", None

        return True, "Folder authorized by allowlist.", entry
