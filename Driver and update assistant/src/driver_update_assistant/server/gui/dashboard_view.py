"""Server GUI Dashboard view providing high-level fleet metrics and recent activity."""

import time
from typing import Optional
from PySide6.QtCore import Qt, QTimer
from PySide6.QtWidgets import (
    QFrame,
    QHBoxLayout,
    QHeaderView,
    QLabel,
    QPushButton,
    QTableWidget,
    QTableWidgetItem,
    QVBoxLayout,
    QWidget,
)

from driver_update_assistant.server.audit_log import AuditLogger
from driver_update_assistant.server.device_registry import DeviceRegistry
from driver_update_assistant.server.release_store import ReleaseStore
from driver_update_assistant.ui.widgets import MetricCard, StatusBadge


class DashboardView(QWidget):
    """Administrator Dashboard with real-time fleet counters and event feed."""

    def __init__(
        self,
        registry: DeviceRegistry,
        release_store: ReleaseStore,
        audit_logger: AuditLogger,
        is_dark: bool = True,
        parent: Optional[QWidget] = None,
    ):
        super().__init__(parent)
        self.registry = registry
        self.release_store = release_store
        self.audit_logger = audit_logger
        self.is_dark = is_dark

        self._setup_ui()

        # Auto-refresh timer every 5 seconds
        self.timer = QTimer(self)
        self.timer.timeout.connect(self.refresh_data)
        self.timer.start(5000)

        self.refresh_data()

    def _setup_ui(self) -> None:
        main_layout = QVBoxLayout(self)
        main_layout.setContentsMargins(24, 20, 24, 20)
        main_layout.setSpacing(20)

        # 1. Top KPI Row (4 MetricCards)
        kpi_row = QHBoxLayout()
        kpi_row.setSpacing(16)

        self.card_devices = MetricCard(
            title="Enrolled Devices",
            value="0",
            subtext="0 authorized, 0 revoked",
            icon_name="devices",
            is_dark=self.is_dark,
        )
        self.card_online = MetricCard(
            title="Online Fleet",
            value="0",
            subtext="Checked in within 10m",
            icon_name="server",
            is_dark=self.is_dark,
        )
        self.card_release = MetricCard(
            title="Latest Release",
            value="None",
            subtext="No packages published",
            icon_name="releases",
            is_dark=self.is_dark,
        )
        self.card_sessions = MetricCard(
            title="Folder Shares",
            value="0",
            subtext="Active temporary leases",
            icon_name="folder",
            is_dark=self.is_dark,
        )

        kpi_row.addWidget(self.card_devices)
        kpi_row.addWidget(self.card_online)
        kpi_row.addWidget(self.card_release)
        kpi_row.addWidget(self.card_sessions)
        main_layout.addLayout(kpi_row)

        # 2. Recent Activity Card
        activity_card = QFrame()
        activity_card.setObjectName("Card")
        act_layout = QVBoxLayout(activity_card)
        act_layout.setContentsMargins(20, 16, 20, 16)
        act_layout.setSpacing(12)

        header_row = QHBoxLayout()
        title_lbl = QLabel("Recent Security and Update Activity")
        t_font = title_lbl.font()
        t_font.setBold(True)
        t_font.setPointSize(14)
        title_lbl.setFont(t_font)
        header_row.addWidget(title_lbl)
        header_row.addStretch()

        refresh_btn = QPushButton("Refresh")
        refresh_btn.clicked.connect(self.refresh_data)
        header_row.addWidget(refresh_btn)
        act_layout.addLayout(header_row)

        # Activity Table
        self.table = QTableWidget()
        self.table.setColumnCount(5)
        self.table.setHorizontalHeaderLabels(["Timestamp", "Event Type", "Device ID", "Outcome", "Details"])
        self.table.horizontalHeader().setSectionResizeMode(0, QHeaderView.ResizeToContents)
        self.table.horizontalHeader().setSectionResizeMode(1, QHeaderView.ResizeToContents)
        self.table.horizontalHeader().setSectionResizeMode(2, QHeaderView.ResizeToContents)
        self.table.horizontalHeader().setSectionResizeMode(3, QHeaderView.ResizeToContents)
        self.table.horizontalHeader().setSectionResizeMode(4, QHeaderView.Stretch)
        self.table.verticalHeader().setVisible(False)
        self.table.setEditTriggers(QTableWidget.NoEditTriggers)
        self.table.setSelectionBehavior(QTableWidget.SelectRows)
        act_layout.addWidget(self.table)

        main_layout.addWidget(activity_card)

    def refresh_data(self) -> None:
        """Fetches latest metrics and populates the activity table."""
        # 1. Device metrics
        devices = self.registry.list_devices()
        total_devs = len(devices)
        now = time.time()
        online_devs = sum(1 for d in devices if (now - (d.get("last_checkin") or 0)) < 600)
        auth_devs = sum(1 for d in devices if d.get("status") == "AUTHORIZED")
        rev_devs = total_devs - auth_devs

        self.card_devices.set_value(str(total_devs), f"{auth_devs} authorized, {rev_devs} revoked")
        self.card_online.set_value(str(online_devs), f"{total_devs - online_devs} offline")

        # 2. Release metrics
        latest = self.release_store.get_latest_release()
        if latest:
            self.card_release.set_value(f"v{latest.version}", f"ID: {latest.release_id[:16]}")
        else:
            self.card_release.set_value("None", "No packages published")

        # 3. Recent activity table
        events = self.audit_logger.get_recent_events(limit=20)
        self.table.setRowCount(len(events))
        for row_idx, ev in enumerate(events):
            t_str = time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(ev["timestamp"]))
            self.table.setItem(row_idx, 0, QTableWidgetItem(t_str))
            self.table.setItem(row_idx, 1, QTableWidgetItem(ev["event_type"]))
            self.table.setItem(row_idx, 2, QTableWidgetItem(ev.get("device_id") or "SERVER"))

            # Outcome badge widget
            outcome_cell = QTableWidgetItem(ev["outcome"])
            self.table.setItem(row_idx, 3, outcome_cell)

            details_str = str(ev.get("details", ""))
            self.table.setItem(row_idx, 4, QTableWidgetItem(details_str))
