"""Server GUI Logs & Diagnostics view.

Provides structured, filterable, and searchable security audit logs
with log export functionality and sensitive credential redaction.
"""

import json
import time
from typing import List, Optional
from PySide6.QtCore import Qt, QTimer
from PySide6.QtWidgets import (
    QComboBox,
    QFileDialog,
    QFrame,
    QHBoxLayout,
    QHeaderView,
    QLabel,
    QLineEdit,
    QMessageBox,
    QPushButton,
    QTableWidget,
    QTableWidgetItem,
    QVBoxLayout,
    QWidget,
)

from driver_update_assistant.server.audit_log import AuditLogger
from driver_update_assistant.ui.icons import get_icon
from driver_update_assistant.ui.widgets import StatusBadge


class LogsView(QWidget):
    """Structured Security Audit and Diagnostic Log Viewer."""

    def __init__(
        self,
        audit_logger: AuditLogger,
        is_dark: bool = True,
        parent: Optional[QWidget] = None,
    ):
        super().__init__(parent)
        self.audit_logger = audit_logger
        self.is_dark = is_dark
        self._raw_events: List[dict] = []

        self._setup_ui()

        self.timer = QTimer(self)
        self.timer.timeout.connect(self.refresh_logs)
        self.timer.start(5000)

        self.refresh_logs()

    def _setup_ui(self) -> None:
        main_layout = QVBoxLayout(self)
        main_layout.setContentsMargins(24, 20, 24, 20)
        main_layout.setSpacing(16)

        # Header row
        header_row = QHBoxLayout()
        title = QLabel("Security Audit and Diagnostic Logs")
        title.setStyleSheet("font-size: 18px; font-weight: 700;")
        header_row.addWidget(title)
        header_row.addStretch()

        self.btn_export = QPushButton("Export Diagnostics")
        self.btn_export.setIcon(get_icon("download", self.is_dark))
        self.btn_export.clicked.connect(self.on_export_logs)
        header_row.addWidget(self.btn_export)

        self.btn_refresh = QPushButton("Refresh")
        self.btn_refresh.setIcon(get_icon("refresh", self.is_dark))
        self.btn_refresh.clicked.connect(self.refresh_logs)
        header_row.addWidget(self.btn_refresh)

        main_layout.addLayout(header_row)

        desc = QLabel(
            "Immutable audit log tracking enrollment, package releases, client update states, and folder-access consents. "
            "Sensitive credentials and private tokens are automatically redacted."
        )
        desc.setWordWrap(True)
        desc.setStyleSheet("color: #888888; font-size: 12px;")
        main_layout.addWidget(desc)

        # Filter bar
        filter_row = QHBoxLayout()
        filter_row.setSpacing(10)

        self.search_input = QLineEdit()
        self.search_input.setPlaceholderText("Filter by device ID, admin, or details...")
        self.search_input.textChanged.connect(self.apply_filters)
        filter_row.addWidget(self.search_input, 2)

        self.event_filter = QComboBox()
        self.event_filter.addItem("All Events", "ALL")
        self.event_filter.addItem("Enrollment Events", "DEVICE_")
        self.event_filter.addItem("Release Events", "RELEASE_")
        self.event_filter.addItem("Update Reports", "UPDATE_")
        self.event_filter.addItem("Folder Access Events", "FOLDER_")
        self.event_filter.currentIndexChanged.connect(self.apply_filters)
        filter_row.addWidget(self.event_filter, 1)

        self.outcome_filter = QComboBox()
        self.outcome_filter.addItem("All Outcomes", "ALL")
        self.outcome_filter.addItem("Success", "SUCCESS")
        self.outcome_filter.addItem("Denied / Failed", "FAIL")
        self.outcome_filter.currentIndexChanged.connect(self.apply_filters)
        filter_row.addWidget(self.outcome_filter, 1)

        main_layout.addLayout(filter_row)

        # Table
        self.table = QTableWidget()
        self.table.setColumnCount(6)
        self.table.setHorizontalHeaderLabels(["Timestamp", "Event Type", "Outcome", "Device ID", "Actor / Admin", "Event Details"])
        self.table.horizontalHeader().setSectionResizeMode(0, QHeaderView.ResizeToContents)
        self.table.horizontalHeader().setSectionResizeMode(1, QHeaderView.ResizeToContents)
        self.table.horizontalHeader().setSectionResizeMode(2, QHeaderView.ResizeToContents)
        self.table.horizontalHeader().setSectionResizeMode(3, QHeaderView.ResizeToContents)
        self.table.horizontalHeader().setSectionResizeMode(4, QHeaderView.ResizeToContents)
        self.table.horizontalHeader().setSectionResizeMode(5, QHeaderView.Stretch)
        self.table.verticalHeader().setVisible(False)
        self.table.setSelectionBehavior(QTableWidget.SelectRows)

        main_layout.addWidget(self.table)

    def refresh_logs(self) -> None:
        self._raw_events = self.audit_logger.get_recent_events(limit=300)
        self.apply_filters()

    def apply_filters(self) -> None:
        query = self.search_input.text().strip().lower()
        ev_filter = self.event_filter.currentData()
        out_filter = self.outcome_filter.currentData()

        filtered = []
        for ev in self._raw_events:
            ev_type = ev.get("event_type", "")
            outcome = ev.get("outcome", "")
            dev_id = ev.get("device_id") or ""
            admin_id = ev.get("admin_id") or ""
            details = str(ev.get("details", ""))

            # Event type filter
            if ev_filter != "ALL" and not ev_type.startswith(ev_filter):
                continue

            # Outcome filter
            if out_filter == "SUCCESS" and outcome.upper() != "SUCCESS":
                continue
            elif out_filter == "FAIL" and outcome.upper() in ("SUCCESS", "INFO"):
                continue

            # Search text query
            if query:
                combined = f"{ev_type} {dev_id} {admin_id} {details}".lower()
                if query not in combined:
                    continue

            filtered.append(ev)

        self._populate_table(filtered)

    def _populate_table(self, events: List[dict]) -> None:
        self.table.setRowCount(len(events))

        for row, ev in enumerate(events):
            # Timestamp
            ts = ev.get("timestamp", 0)
            time_str = time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(ts)) if ts else "-"
            self.table.setItem(row, 0, QTableWidgetItem(time_str))

            # Event Type
            ev_type = ev.get("event_type", "")
            self.table.setItem(row, 1, QTableWidgetItem(ev_type))

            # Outcome badge
            outcome = ev.get("outcome", "")
            outcome_container = QWidget()
            out_layout = QHBoxLayout(outcome_container)
            out_layout.setContentsMargins(4, 2, 4, 2)
            out_layout.setAlignment(Qt.AlignCenter)

            if outcome.upper() == "SUCCESS":
                badge = StatusBadge("Success", "success")
            elif outcome.upper() in ("DENIED", "ERROR", "FAILURE", "FAILED"):
                badge = StatusBadge(outcome.capitalize(), "error")
            elif outcome.upper() == "ATTENTION_REQUIRED":
                badge = StatusBadge("Attention", "warning")
            else:
                badge = StatusBadge(outcome.capitalize(), "info")

            out_layout.addWidget(badge)
            self.table.setCellWidget(row, 2, outcome_container)

            # Device
            dev_id = ev.get("device_id") or "-"
            self.table.setItem(row, 3, QTableWidgetItem(dev_id))

            # Admin
            admin_id = ev.get("admin_id") or "-"
            self.table.setItem(row, 4, QTableWidgetItem(admin_id))

            # Details
            details_obj = ev.get("details", {})
            if isinstance(details_obj, dict):
                # Redact any accidental tokens/secrets
                safe_details = {k: v for k, v in details_obj.items() if "token" not in k.lower() and "secret" not in k.lower()}
                details_text = json.dumps(safe_details)
            else:
                details_text = str(details_obj)
            self.table.setItem(row, 5, QTableWidgetItem(details_text))

    def on_export_logs(self) -> None:
        path, _ = QFileDialog.getSaveFileName(
            self,
            "Export Diagnostic Audit Report",
            f"Server_Diagnostic_Report_{int(time.time())}.json",
            "JSON Files (*.json)",
        )
        if not path:
            return

        try:
            report_data = {
                "report_timestamp": time.time(),
                "report_date": time.strftime("%Y-%m-%d %H:%M:%S"),
                "total_events": len(self._raw_events),
                "events": self._raw_events,
            }
            with open(path, "w", encoding="utf-8") as f:
                json.dump(report_data, f, indent=2)

            QMessageBox.information(
                self,
                "Report Exported",
                f"Diagnostic report exported successfully to:\n{path}",
            )
        except Exception as e:
            QMessageBox.critical(self, "Export Failed", f"Failed to export report:\n{str(e)}")
