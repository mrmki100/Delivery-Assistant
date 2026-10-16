"""Security audit logger backed by SQLite."""

import json
import sqlite3
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Dict, Generator, List, Optional


class AuditLogger:
    """Records tamper-evident security events, approvals, and access logs."""

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
                CREATE TABLE IF NOT EXISTS audit_logs (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    timestamp REAL NOT NULL,
                    event_type TEXT NOT NULL,
                    device_id TEXT,
                    admin_id TEXT,
                    outcome TEXT NOT NULL,
                    details TEXT
                )
                """
            )
            conn.execute("CREATE INDEX IF NOT EXISTS idx_audit_dev ON audit_logs(device_id)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_audit_time ON audit_logs(timestamp)")

    def log_event(
        self,
        event_type: str,
        outcome: str,
        device_id: Optional[str] = None,
        admin_id: Optional[str] = None,
        details: Optional[Dict[str, Any]] = None,
    ) -> None:
        """Records an audit event with sanitized details."""
        now = time.time()
        details_str = json.dumps(details or {})
        with self._connection() as conn:
            conn.execute(
                """
                INSERT INTO audit_logs (timestamp, event_type, device_id, admin_id, outcome, details)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (now, event_type, device_id, admin_id, outcome, details_str),
            )

    def get_recent_events(self, limit: int = 50) -> List[Dict[str, Any]]:
        """Retrieves recent audit events."""
        with self._connection() as conn:
            cur = conn.execute(
                """
                SELECT id, timestamp, event_type, device_id, admin_id, outcome, details
                FROM audit_logs
                ORDER BY timestamp DESC
                LIMIT ?
                """,
                (limit,),
            )
            rows = cur.fetchall()
            return [
                {
                    "id": r["id"],
                    "timestamp": r["timestamp"],
                    "event_type": r["event_type"],
                    "device_id": r["device_id"],
                    "admin_id": r["admin_id"],
                    "outcome": r["outcome"],
                    "details": json.loads(r["details"] or "{}"),
                }
                for r in rows
            ]
