"""Device registry and enrollment management backed by SQLite."""

import hashlib
import sqlite3
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Dict, Generator, List, Optional, Tuple


def hash_token(raw_token: str) -> str:
    """Computes SHA-256 hash of a bearer token."""
    return hashlib.sha256(raw_token.encode("utf-8")).hexdigest()


class DeviceRegistry:
    """Manages enrolled devices, credentials, and telemetry status."""

    def __init__(self, db_path: str):
        self.db_path = db_path
        Path(db_path).parent.mkdir(parents=True, exist_ok=True)
        self._init_db()

    @contextmanager
    def _connection(self) -> Generator[sqlite3.Connection, None, None]:
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        try:
            with conn:
                yield conn
        finally:
            conn.close()

    def _init_db(self) -> None:
        with self._connection() as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS devices (
                    device_id TEXT PRIMARY KEY,
                    token_hash TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'AUTHORIZED',
                    hostname TEXT,
                    ip_address TEXT,
                    installed_version TEXT DEFAULT '0.0.0',
                    last_state TEXT DEFAULT 'IDLE',
                    rollback_verified INTEGER DEFAULT 0,
                    last_checkin REAL DEFAULT 0,
                    created_at REAL NOT NULL
                )
                """
            )

    def enroll_device(self, device_id: str, raw_token: str, hostname: Optional[str] = None) -> bool:
        """Enrolls or re-enrolls a device with a given token."""
        now = time.time()
        thash = hash_token(raw_token)
        with self._connection() as conn:
            conn.execute(
                """
                INSERT INTO devices (device_id, token_hash, status, hostname, created_at, last_checkin)
                VALUES (?, ?, 'AUTHORIZED', ?, ?, ?)
                ON CONFLICT(device_id) DO UPDATE SET
                    token_hash=excluded.token_hash,
                    status='AUTHORIZED',
                    hostname=coalesce(excluded.hostname, devices.hostname)
                """,
                (device_id, thash, hostname, now, now),
            )
        return True

    def revoke_device(self, device_id: str) -> bool:
        """Revokes a device, preventing further access."""
        with self._connection() as conn:
            cur = conn.execute(
                "UPDATE devices SET status='REVOKED' WHERE device_id=?",
                (device_id,),
            )
            return cur.rowcount > 0

    def verify_device(self, device_id: str, raw_token: str) -> Tuple[bool, str]:
        """Validates credentials. Returns (is_authenticated, status_or_reason)."""
        with self._connection() as conn:
            cur = conn.execute(
                "SELECT token_hash, status FROM devices WHERE device_id=?",
                (device_id,),
            )
            row = cur.fetchone()
            if not row:
                return False, "DEVICE_UNKNOWN"
            if row["status"] == "REVOKED":
                return False, "DEVICE_REVOKED"
            expected_hash = row["token_hash"]
            provided_hash = hash_token(raw_token)
            if expected_hash != provided_hash:
                return False, "AUTH_FAILED"
            return True, "AUTHORIZED"

    def update_checkin(
        self,
        device_id: str,
        ip_address: Optional[str] = None,
        installed_version: Optional[str] = None,
        last_state: Optional[str] = None,
        rollback_verified: Optional[bool] = None,
    ) -> None:
        """Updates check-in timestamp and telemetry state."""
        now = time.time()
        updates = ["last_checkin=?"]
        params: List[Any] = [now]

        if ip_address is not None:
            updates.append("ip_address=?")
            params.append(ip_address)
        if installed_version is not None:
            updates.append("installed_version=?")
            params.append(installed_version)
        if last_state is not None:
            updates.append("last_state=?")
            params.append(last_state)
        if rollback_verified is not None:
            updates.append("rollback_verified=?")
            params.append(1 if rollback_verified else 0)

        params.append(device_id)
        query = f"UPDATE devices SET {', '.join(updates)} WHERE device_id=?"
        with self._connection() as conn:
            conn.execute(query, tuple(params))

    def list_devices(self) -> List[Dict[str, Any]]:
        """Returns inventory of all registered devices."""
        with self._connection() as conn:
            cur = conn.execute("SELECT * FROM devices ORDER BY device_id ASC")
            rows = cur.fetchall()
            return [dict(r) for r in rows]

    def get_device(self, device_id: str) -> Optional[Dict[str, Any]]:
        """Fetches a single device record."""
        with self._connection() as conn:
            cur = conn.execute("SELECT * FROM devices WHERE device_id=?", (device_id,))
            row = cur.fetchone()
            return dict(row) if row else None
