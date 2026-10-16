"""Client GUI Folder Access Consent and Active Lease View.

Implements the employee-side request-and-approval workflow:
- Review incoming folder access requests targeted at this machine
- Displays requesting administrator identity, exact preconfigured folder path, permissions, purpose, and expiration
- Explicit Accept and Decline controls
- Direct authorization using the local Shared Folders allowlist (no re-picking of folder)
- Live active session lease countdown
- Immediate local revocation controls
"""

import time
from typing import Dict, List, Optional
from PySide6.QtCore import Qt, QTimer
from PySide6.QtWidgets import (
    QFrame,
    QHBoxLayout,
    QLabel,
    QMessageBox,
    QPushButton,
    QVBoxLayout,
    QWidget,
)

from driver_update_assistant.client.service import ClientManager
from driver_update_assistant.protocol import (
    FolderRequestStatus,
    FolderSessionRecord,
    SharePermission,
)
from driver_update_assistant.ui.icons import get_icon
from driver_update_assistant.ui.widgets import EmptyState, HeaderBar, StatusBadge


class FolderAccessView(QWidget):
    """Employee consent and folder sharing management interface."""

    def __init__(
        self,
        manager: ClientManager,
        is_dark: bool = True,
        parent: Optional[QWidget] = None,
    ):
        super().__init__(parent)
        self.manager = manager
        self.is_dark = is_dark
        self.pending_requests: List[Dict] = []
        self.active_sessions: List[Dict] = []

        self._setup_ui()

        # Connect signals
        self.manager.pending_requests_changed.connect(self._on_pending_requests)
        self.manager.active_sessions_changed.connect(self._on_active_sessions)

        # Polling timer every 3 seconds
        self.timer = QTimer(self)
        self.timer.timeout.connect(self.manager.poll_state)
        self.timer.start(3000)

        self.manager.poll_state()

    def _setup_ui(self) -> None:
        main_layout = QVBoxLayout(self)
        main_layout.setContentsMargins(28, 24, 28, 24)
        main_layout.setSpacing(20)

        # Header
        header = HeaderBar(
            title="Authorized Remote Folder Access",
            subtitle="Review incoming administrative support requests. Access is granted only to preconfigured folders from your Shared Folders allowlist.",
            badge_text="Consent-First",
            badge_type="info",
        )
        main_layout.addWidget(header)

        # Incoming Requests Section
        self.incoming_container = QFrame()
        self.incoming_container.setObjectName("MetricCard")
        self.incoming_layout = QVBoxLayout(self.incoming_container)
        self.incoming_layout.setContentsMargins(20, 16, 20, 16)
        self.incoming_layout.setSpacing(12)

        lbl_incoming_title = QLabel("Pending Administrative Requests")
        lbl_incoming_title.setStyleSheet("font-size: 15px; font-weight: 700;")
        self.incoming_layout.addWidget(lbl_incoming_title)

        self.incoming_content = QVBoxLayout()
        self.incoming_content.setSpacing(12)
        self.incoming_layout.addLayout(self.incoming_content)

        main_layout.addWidget(self.incoming_container)

        # Active Leases Section
        self.active_container = QFrame()
        self.active_container.setObjectName("MetricCard")
        self.active_layout = QVBoxLayout(self.active_container)
        self.active_layout.setContentsMargins(20, 16, 20, 16)
        self.active_layout.setSpacing(12)

        self.lbl_active_title = QLabel("Active Access Sessions")
        self.lbl_active_title.setStyleSheet("font-size: 15px; font-weight: 700;")
        self.active_layout.addWidget(self.lbl_active_title)

        self.active_content = QVBoxLayout()
        self.active_content.setSpacing(12)
        self.active_layout.addLayout(self.active_content)

        main_layout.addWidget(self.active_container)

        # Zero-trust security guarantee banner
        sec_banner = QFrame()
        sec_banner.setObjectName("MetricCard")
        sec_banner.setStyleSheet("border-left: 4px solid #34A853;")
        sec_layout = QVBoxLayout(sec_banner)
        sec_layout.setContentsMargins(16, 12, 16, 12)

        sec_title = QLabel("Zero-Trust Local Allowlist & Mutual Consent")
        sec_title.setStyleSheet("font-size: 12px; font-weight: 700;")
        sec_layout.addWidget(sec_title)

        sec_text = QLabel(
            "An administrator cannot access arbitrary directories on this laptop. Only folders you explicitly "
            "add in the 'Shared Folders' tab can be requested, and every individual session requires your manual Accept."
        )
        sec_text.setStyleSheet("color: #888888; font-size: 11px;")
        sec_text.setWordWrap(True)
        sec_layout.addWidget(sec_text)

        main_layout.addWidget(sec_banner)
        main_layout.addStretch()

    def _on_pending_requests(self, requests: List[Dict]) -> None:
        self.pending_requests = requests
        while self.incoming_content.count():
            item = self.incoming_content.takeAt(0)
            if item.widget():
                item.widget().deleteLater()

        pending_items = [
            r for r in requests
            if r.get("status") in (FolderRequestStatus.PENDING.value, FolderRequestStatus.CHALLENGED.value, "PENDING_APPROVAL")
        ]

        if not pending_items:
            empty = EmptyState("No Pending Requests", "There are currently no remote folder access requests awaiting approval.", "folder", self.is_dark)
            self.incoming_content.addWidget(empty)
            return

        for req in pending_items:
            req_card = self._build_request_card(req)
            self.incoming_content.addWidget(req_card)

    def _build_request_card(self, req: Dict) -> QWidget:
        card = QFrame()
        card.setObjectName("MetricCard")
        card.setStyleSheet("background-color: rgba(255, 193, 7, 0.06); border: 1px solid rgba(255, 193, 7, 0.35); border-radius: 8px;")
        layout = QVBoxLayout(card)
        layout.setContentsMargins(18, 16, 18, 16)
        layout.setSpacing(12)

        # Top line: Admin, status, permission
        top_row = QHBoxLayout()
        admin_lbl = QLabel(f"Requesting Administrator: <b>{req.get('admin_id', 'Admin')}</b>")
        admin_lbl.setStyleSheet("font-size: 13px;")
        top_row.addWidget(admin_lbl)
        top_row.addStretch()

        perm_str = "Read-Only" if req.get("permission") in ("read_only", "READ") else "Read-Write"
        badge = StatusBadge(perm_str, "info" if perm_str == "Read-Only" else "warning")
        top_row.addWidget(badge)
        layout.addLayout(top_row)

        # Details
        folder_path = req.get("proposed_folder") or req.get("requested_folder") or "Operational Folder"
        path_lbl = QLabel(f"Requested Folder Path: <code>{folder_path}</code>")
        path_lbl.setStyleSheet("font-size: 13px; font-weight: 600;")
        path_lbl.setWordWrap(True)
        layout.addWidget(path_lbl)

        purpose = req.get("purpose", "Administrative support")
        purpose_lbl = QLabel(f"Stated Purpose: <i>{purpose}</i>")
        purpose_lbl.setStyleSheet("color: #888888; font-size: 12px;")
        layout.addWidget(purpose_lbl)

        duration = req.get("duration_minutes", 30)
        dur_lbl = QLabel(f"Requested Lease Duration: <b>{duration} minutes</b>")
        dur_lbl.setStyleSheet("font-size: 12px;")
        layout.addWidget(dur_lbl)

        # Action Buttons: Accept & Decline
        btn_row = QHBoxLayout()
        btn_row.addStretch()

        btn_decline = QPushButton("Decline Request")
        btn_decline.setObjectName("DangerButton")
        btn_decline.setFixedWidth(130)
        btn_decline.clicked.connect(lambda _, r=req: self.on_deny_request(r))
        btn_row.addWidget(btn_decline)

        btn_accept = QPushButton("Accept and Grant Access")
        btn_accept.setObjectName("PrimaryButton")
        btn_accept.setIcon(get_icon("check", self.is_dark))
        btn_accept.setFixedWidth(190)
        btn_accept.clicked.connect(lambda _, r=req: self.on_approve_request(r))
        btn_row.addWidget(btn_accept)

        layout.addLayout(btn_row)
        return card

    def _on_active_sessions(self, sessions: List[Dict]) -> None:
        self.active_sessions = sessions
        while self.active_content.count():
            item = self.active_content.takeAt(0)
            if item.widget():
                item.widget().deleteLater()

        if not sessions:
            empty = EmptyState("No Active Shares", "No local folders are currently shared with the administrator.", "shield", self.is_dark)
            self.active_content.addWidget(empty)
            return

        now = time.time()
        for sess in sessions:
            card = QFrame()
            card.setObjectName("MetricCard")
            layout = QVBoxLayout(card)
            layout.setContentsMargins(16, 12, 16, 12)
            layout.setSpacing(8)

            row = QHBoxLayout()
            folder = sess.get("folder_path", "")
            perm = "Read-Only" if sess.get("permission") in ("read_only", "READ") else "Read-Write"
            row.addWidget(QLabel(f"Shared: <code>{folder}</code> ({perm})"))
            row.addStretch()

            rem = max(0, int(sess.get("expires_at", 0) - now))
            time_badge = StatusBadge(f"{rem // 60}m {rem % 60}s remaining", "success")
            row.addWidget(time_badge)

            btn_revoke = QPushButton("Revoke Access")
            btn_revoke.setObjectName("DangerButton")
            btn_revoke.clicked.connect(lambda _, r=sess: self.on_revoke_session(r))
            row.addWidget(btn_revoke)

            layout.addLayout(row)
            self.active_content.addWidget(card)

    def on_approve_request(self, req: Dict) -> None:
        target_path = req.get("proposed_folder") or req.get("requested_folder") or ""
        perm_requested = req.get("permission", SharePermission.READ_ONLY.value)

        # 1. Re-validate that folder is STILL in employee's allowlist
        is_allowed, reason, entry = self.manager.client.allowlist.is_request_allowed(
            target_path, perm_requested
        )
        if not is_allowed or not entry:
            QMessageBox.critical(
                self,
                "Request Blocked by Allowlist Policy",
                f"Cannot grant access to '{target_path}':\n\n{reason}\n\n"
                "Please configure this directory first in the 'Shared Folders' tab.",
            )
            return

        # 2. Grant access directly without asking user to re-select folder
        req_id = req["request_id"]
        ok, msg = self.manager.client.approve_folder_request(req_id, entry.path, perm_requested)
        if not ok:
            QMessageBox.critical(self, "Approval Error", f"Server error approving request:\n{msg}")
            return

        # 3. Create local session record for countdown tracking
        duration_sec = req.get("duration_minutes", 30) * 60
        record = FolderSessionRecord(
            session_id=req_id,
            request_id=req_id,
            device_id=self.manager.config.device_id,
            folder_path=entry.path,
            share_name=f"APP_{self.manager.config.device_id}",
            permission=SharePermission.READ_ONLY if perm_requested in ("read_only", "READ") else SharePermission.READ_WRITE,
            admin_ip=None,
            created_at=time.time(),
            expires_at=time.time() + duration_sec,
            status=FolderRequestStatus.ACTIVE,
        )
        self.manager.session_store.save_session(record)

        self.manager.poll_state()
        QMessageBox.information(
            self,
            "Access Authorized",
            f"Access to '{entry.path}' successfully approved for {req.get('duration_minutes', 30)} minutes.\n\n"
            "The administrator can now browse and retrieve files within this folder.",
        )

    def on_deny_request(self, req: Dict) -> None:
        req_id = req.get("request_id")
        self.manager.client.deny_folder_request(req_id)
        self.pending_requests = [r for r in self.pending_requests if r.get("request_id") != req_id]
        self._on_pending_requests(self.pending_requests)
        self.manager.poll_state()
        QMessageBox.information(self, "Request Declined", "Folder access request was declined. No access was granted.")

    def on_revoke_session(self, sess: Dict) -> None:
        req_id = sess.get("request_id") or sess.get("session_id")
        self.manager.client.revoke_folder_request(req_id)
        self.manager.session_store.remove_session(sess.get("session_id"))
        self.manager.poll_state()
        QMessageBox.information(self, "Access Revoked", "Folder access session terminated immediately.")

    def update_theme(self, is_dark: bool) -> None:
        self.is_dark = is_dark
        self._on_pending_requests(self.pending_requests)
        self._on_active_sessions(self.active_sessions)
