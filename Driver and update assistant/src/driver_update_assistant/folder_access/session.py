"""Persistent session store for tracking active temporary folder shares."""

import json
from pathlib import Path
from typing import Dict, List, Optional

from driver_update_assistant.protocol import FolderRequestStatus, FolderSessionRecord


class SessionStore:
    """Thread-safe file store tracking all active network shares and their leases."""

    def __init__(self, store_file: Path):
        self.store_file = store_file
        self.store_file.parent.mkdir(parents=True, exist_ok=True)

    def _read_all(self) -> Dict[str, Dict]:
        if not self.store_file.exists():
            return {}
        try:
            with open(self.store_file, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return {}

    def _write_all(self, data: Dict[str, Dict]) -> None:
        temp_file = self.store_file.with_suffix(".tmp")
        with open(temp_file, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)
        if self.store_file.exists():
            self.store_file.unlink()
        temp_file.replace(self.store_file)

    def save_session(self, record: FolderSessionRecord) -> None:
        sessions = self._read_all()
        sessions[record.session_id] = record.to_dict()
        self._write_all(sessions)

    def get_session(self, session_id: str) -> Optional[FolderSessionRecord]:
        sessions = self._read_all()
        data = sessions.get(session_id)
        return FolderSessionRecord.from_dict(data) if data else None

    def get_active_sessions(self) -> List[FolderSessionRecord]:
        sessions = self._read_all()
        active = []
        for data in sessions.values():
            rec = FolderSessionRecord.from_dict(data)
            if rec.status == FolderRequestStatus.ACTIVE:
                active.append(rec)
        return active

    def update_status(self, session_id: str, status: FolderRequestStatus) -> None:
        sessions = self._read_all()
        if session_id in sessions:
            sessions[session_id]["status"] = status.value
            self._write_all(sessions)

    def remove_session(self, session_id: str) -> None:
        sessions = self._read_all()
        if session_id in sessions:
            del sessions[session_id]
            self._write_all(sessions)
