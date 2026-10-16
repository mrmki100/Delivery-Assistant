"""Server GUI Devices view for searching, inspecting, and managing enrolled employee laptops."""

import os
import time
from typing import Optional
from PySide6.QtCore import Qt, QTimer
from PySide6.QtWidgets import (
    QDialog,
    QDialogButtonBox,
    QFormLayout,
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

from driver_update_assistant.server.device_registry import DeviceRegistry
from driver_update_assistant.ui.widgets import EmptyState, StatusBadge


class EnrollDeviceDialog(QDialog):
    """Dialog to enroll a new device and generate an enrollment token."""

    def __init__(self, registry: DeviceRegistry, parent: Optional[QWidget] = None):
        super().__init__(parent)
        self.registry = registry
        self.setWindowTitle("Enroll New Laptop")
        self.setFixedSize(420, 240)

        layout = QVBoxLayout(self)
        layout.setSpacing(14)

        form = QFormLayout()
        self.device_id_edit = QLineEdit()
        self.device_id_edit.setPlaceholderText("e.g. LAPTOP-02")
        form.addRow("Device ID:", self.device_id_edit)

        self.hostname_edit = QLineEdit()
        self.hostname_edit.setPlaceholderText("Optional computer name")
        form.addRow("Hostname:", self.hostname_edit)

        layout.addLayout(form)

        self.info_label = QLabel("A cryptographically secure enrollment token will be generated.")
        self.info_label.setStyleSheet("color: #8C939A; font-size: 11px;")
        layout.addWidget(self.info_label)

        btn_box = QDialogButtonBox(QDialogButtonBox.Ok | QDialogButtonBox.Cancel)
        btn_box.accepted.connect(self._enroll)
        btn_box.rejected.connect(self.reject)
        layout.addWidget(btn_box)

    def _enroll(self) -> None:
        dev_id = self.device_id_edit.text().strip().upper()
        if not dev_id:
            QMessageBox.warning(self, "Invalid Input", "Device ID is required.")
            return

        token = os.urandom(16).hex()
        hostname = self.hostname_edit.text().strip() or None

        self.registry.enroll_device(dev_id, token, hostname)

        # Show token to admin
        token_dlg = QDialog(self)
        token_dlg.setWindowTitle("Device Enrollment Succeeded")
        token_dlg.setFixedSize(460, 200)
        t_layout = QVBoxLayout(token_dlg)
        t_layout.addWidget(QLabel(f"Device <b>{dev_id}</b> has been enrolled successfully."))
        t_layout.addWidget(QLabel("Copy this token to the employee laptop's <code>config/agent.toml</code>:"))

        token_box = QLineEdit(token)
        token_box.setReadOnly(True)
        t_layout.addWidget(token_box)

        ok_btn = QPushButton("Done")
        ok_btn.clicked.connect(token_dlg.accept)
        t_layout.addWidget(ok_btn)
        token_dlg.exec()

        self.accept()


class DevicesView(QWidget):
    """Enrolled laptops inventory with search, enrollment, and revocation."""

    def __init__(self, registry: DeviceRegistry, is_dark: bool = True, parent: Optional[QWidget] = None):
        super().__init__(parent)
        self.registry = registry
        self.is_dark = is_dark

        self._setup_ui()

        self.timer = QTimer(self)
        self.timer.timeout.connect(self.refresh_devices)
        self.timer.start(5000)

        self.refresh_devices()

    def _setup_ui(self) -> None:
        layout = QVBoxLayout(self)
        layout.setContentsMargins(24, 20, 24, 20)
        layout.setSpacing(16)

        # Top Bar: Search + Actions
        top_bar = QHBoxLayout()
        top_bar.setSpacing(12)

        self.search_input = QLineEdit()
        self.search_input.setPlaceholderText("Search by Device ID, IP, or Hostname...")
        self.search_input.textChanged.connect(self._filter_table)
        top_bar.addWidget(self.search_input, stretch=1)

        self.enroll_btn = QPushButton("Enroll Device")
        self.enroll_btn.setObjectName("PrimaryBtn")
        self.enroll_btn.clicked.connect(self._show_enroll_dialog)
        top_bar.addWidget(self.enroll_btn)

        self.revoke_btn = QPushButton("Revoke Device")
        self.revoke_btn.setObjectName("DangerBtn")
        self.revoke_btn.setEnabled(False)
        self.revoke_btn.clicked.connect(self._revoke_selected)
        top_bar.addWidget(self.revoke_btn)

        refresh_btn = QPushButton("Refresh")
        refresh_btn.clicked.connect(self.refresh_devices)
        top_bar.addWidget(refresh_btn)

        layout.addLayout(top_bar)

        # Devices Table
        self.table = QTableWidget()
        self.table.setColumnCount(7)
        self.table.setHorizontalHeaderLabels([
            "Device ID", "Hostname", "IP Address", "Extension Ver", "State", "Status", "Last Check-in"
        ])
        self.table.horizontalHeader().setSectionResizeMode(0, QHeaderView.ResizeToContents)
        self.table.horizontalHeader().setSectionResizeMode(1, QHeaderView.Stretch)
        self.table.horizontalHeader().setSectionResizeMode(2, QHeaderView.ResizeToContents)
        self.table.horizontalHeader().setSectionResizeMode(3, QHeaderView.ResizeToContents)
        self.table.horizontalHeader().setSectionResizeMode(4, QHeaderView.ResizeToContents)
        self.table.horizontalHeader().setSectionResizeMode(5, QHeaderView.ResizeToContents)
        self.table.horizontalHeader().setSectionResizeMode(6, QHeaderView.ResizeToContents)
        self.table.verticalHeader().setVisible(False)
        self.table.setSelectionBehavior(QTableWidget.SelectRows)
        self.table.setSelectionMode(QTableWidget.SingleSelection)
        self.table.itemSelectionChanged.connect(self._on_selection_changed)
        layout.addWidget(self.table)

        self.cached_devices = []

    def refresh_devices(self) -> None:
        self.cached_devices = self.registry.list_devices()
        self._filter_table(self.search_input.text())

    def _filter_table(self, query: str) -> None:
        q = query.strip().lower()
        filtered = [
            d for d in self.cached_devices
            if not q or q in d["device_id"].lower() or q in (d.get("hostname") or "").lower() or q in (d.get("ip_address") or "").lower()
        ]

        self.table.setRowCount(len(filtered))
        for row_idx, dev in enumerate(filtered):
            item_id = QTableWidgetItem(dev["device_id"])
            item_id.setData(Qt.UserRole, dev["device_id"])
            self.table.setItem(row_idx, 0, item_id)

            self.table.setItem(row_idx, 1, QTableWidgetItem(dev.get("hostname") or "—"))
            self.table.setItem(row_idx, 2, QTableWidgetItem(dev.get("ip_address") or "—"))
            self.table.setItem(row_idx, 3, QTableWidgetItem(f"v{dev.get('installed_version', '0.0.0')}"))
            self.table.setItem(row_idx, 4, QTableWidgetItem(dev.get("last_state", "IDLE")))

            # Status cell
            status_str = dev.get("status", "AUTHORIZED")
            self.table.setItem(row_idx, 5, QTableWidgetItem(status_str))

            # Last checkin
            last_t = dev.get("last_checkin") or 0
            if last_t > 0:
                t_str = time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(last_t))
            else:
                t_str = "Never"
            self.table.setItem(row_idx, 6, QTableWidgetItem(t_str))

    def _on_selection_changed(self) -> None:
        has_sel = len(self.table.selectedItems()) > 0
        self.revoke_btn.setEnabled(has_sel)

    def _show_enroll_dialog(self) -> None:
        dlg = EnrollDeviceDialog(self.registry, self)
        if dlg.exec():
            self.refresh_devices()

    def _revoke_selected(self) -> None:
        sel_row = self.table.currentRow()
        if sel_row < 0:
            return
        dev_id = self.table.item(sel_row, 0).data(Qt.UserRole)
        confirm = QMessageBox.question(
            self,
            "Confirm Device Revocation",
            f"Are you sure you want to revoke '{dev_id}'?\n\nThis device will be immediately blocked from updates and folder access.",
            QMessageBox.Yes | QMessageBox.No,
        )
        if confirm == QMessageBox.Yes:
            self.registry.revoke_device(dev_id)
            self.refresh_devices()
