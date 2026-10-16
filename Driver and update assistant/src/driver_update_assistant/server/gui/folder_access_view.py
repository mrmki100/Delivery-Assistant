"""Server GUI Folder Access Management View.

Allows the administrator to:
- Select an enrolled client device and select from its preconfigured advertised folders
- Specify permission level, lease duration, and audit purpose
- Track request lifecycle (Pending User Approval, Approved, Denied, Active, Expired, Revoked)
- Explore files in approved folders via application-mediated access (no OS share required)
- Instantly revoke active leases
"""

import time
from pathlib import Path
from typing import Dict, List, Optional
from PySide6.QtCore import Qt, QTimer
from PySide6.QtWidgets import (
    QComboBox,
    QDialog,
    QDialogButtonBox,
    QFileDialog,
    QFormLayout,
    QFrame,
    QHBoxLayout,
    QHeaderView,
    QLabel,
    QLineEdit,
    QMessageBox,
    QPushButton,
    QSpinBox,
    QTableWidget,
    QTableWidgetItem,
    QVBoxLayout,
    QWidget,
)

from driver_update_assistant.protocol import FolderRequestStatus, SharePermission
from driver_update_assistant.server.app import AdminServerState
from driver_update_assistant.ui.icons import get_icon
from driver_update_assistant.ui.widgets import EmptyState, HeaderBar, StatusBadge


class CreateFolderRequestDialog(QDialog):
    """Dialog to initiate a new folder access request selecting from advertised client folders."""

    def __init__(
        self,
        enrolled_devices: List[Dict],
        client_shared_folders: Dict[str, List[Dict]],
        parent: Optional[QWidget] = None,
    ):
        super().__init__(parent)
        self.enrolled_devices = enrolled_devices
        self.client_shared_folders = client_shared_folders
        self.setWindowTitle("New Folder Access Request")
        self.setMinimumWidth(500)

        layout = QVBoxLayout(self)
        layout.setSpacing(16)
        layout.setContentsMargins(22, 22, 22, 22)

        title = QLabel("Request Remote Folder Access")
        title.setStyleSheet("font-size: 16px; font-weight: 700;")
        layout.addWidget(title)

        desc = QLabel(
            "Select an enrolled device and one of its preconfigured shared folders. "
            "Access requires explicit local approval by the employee."
        )
        desc.setWordWrap(True)
        desc.setStyleSheet("color: #888888; font-size: 12px;")
        layout.addWidget(desc)

        form = QFormLayout()
        form.setSpacing(12)

        # 1. Device selection
        self.device_combo = QComboBox()
        for d in enrolled_devices:
            dev_id = d.get("device_id", "Unknown")
            hostname = d.get("hostname", "")
            display = f"{dev_id} ({hostname})" if hostname else dev_id
            self.device_combo.addItem(display, dev_id)
        self.device_combo.currentIndexChanged.connect(self._on_device_changed)
        form.addRow("Target Device:", self.device_combo)

        # 2. Advertised Folder selection
        self.folder_combo = QComboBox()
        form.addRow("Advertised Folder:", self.folder_combo)

        self.folder_notice = QLabel("")
        self.folder_notice.setStyleSheet("color: #E53935; font-size: 11px;")
        self.folder_notice.setWordWrap(True)
        form.addRow("", self.folder_notice)

        # 3. Access Level
        self.perm_combo = QComboBox()
        self.perm_combo.addItem("Read-Only (Recommended)", SharePermission.READ_ONLY.value)
        self.perm_combo.addItem("Read-Write (Audited)", SharePermission.READ_WRITE.value)
        form.addRow("Access Level:", self.perm_combo)

        # 4. Duration
        self.duration_spin = QSpinBox()
        self.duration_spin.setRange(5, 480)
        self.duration_spin.setValue(30)
        self.duration_spin.setSuffix(" minutes")
        form.addRow("Lease Duration:", self.duration_spin)

        # 5. Purpose
        self.purpose_input = QLineEdit()
        self.purpose_input.setText("Administrative diagnostic support")
        form.addRow("Stated Purpose:", self.purpose_input)

        layout.addLayout(form)

        self.btn_box = QDialogButtonBox(QDialogButtonBox.Ok | QDialogButtonBox.Cancel)
        self.btn_box.accepted.connect(self.validate_and_accept)
        self.btn_box.rejected.connect(self.reject)
        layout.addWidget(self.btn_box)

        # Trigger initial device update
        self._on_device_changed()

    def _on_device_changed(self) -> None:
        self.folder_combo.clear()
        dev_id = self.device_combo.currentData()
        if not dev_id:
            return

        folders = self.client_shared_folders.get(dev_id, [])
        if not folders:
            self.folder_combo.setEnabled(False)
            self.folder_notice.setText(
                "No eligible folders configured on this device.\n"
                "The employee must add folders in the Client 'Shared Folders' tab."
            )
            self.btn_box.button(QDialogButtonBox.Ok).setEnabled(False)
        else:
            self.folder_combo.setEnabled(True)
            self.folder_notice.setText("")
            self.btn_box.button(QDialogButtonBox.Ok).setEnabled(True)
            for f in folders:
                path = f.get("path", "")
                perm = f.get("permission", SharePermission.READ_ONLY.value)
                label = f"{path} ({perm})"
                self.folder_combo.addItem(label, f)

    def validate_and_accept(self) -> None:
        if self.folder_combo.count() == 0:
            QMessageBox.warning(self, "No Folders", "No eligible shared folders available on this device.")
            return
        if not self.purpose_input.text().strip():
            QMessageBox.warning(self, "Missing Purpose", "Please enter an audit purpose for this request.")
            return
        self.accept()

    def get_data(self) -> Dict:
        folder_data = self.folder_combo.currentData() or {}
        return {
            "device_id": self.device_combo.currentData(),
            "proposed_folder": folder_data.get("path", ""),
            "permission": self.perm_combo.currentData(),
            "duration_minutes": self.duration_spin.value(),
            "purpose": self.purpose_input.text().strip(),
        }


class ExploreApprovedFolderDialog(QDialog):
    """File explorer for browsing and downloading files in an approved application-mediated session."""

    def __init__(self, session_id: str, folder_path: str, server_state: AdminServerState, parent: Optional[QWidget] = None):
        super().__init__(parent)
        self.session_id = session_id
        self.folder_path = folder_path
        self.server_state = server_state
        self.current_subpath = ""

        self.setWindowTitle(f"Explore Approved Folder - {Path(folder_path).name}")
        self.resize(650, 450)

        layout = QVBoxLayout(self)
        layout.setSpacing(12)
        layout.setContentsMargins(18, 18, 18, 18)

        # Header
        hdr = QLabel(f"Authorized Directory: <code>{folder_path}</code>")
        hdr.setStyleSheet("font-size: 13px; font-weight: 700;")
        layout.addWidget(hdr)

        nav_row = QHBoxLayout()
        self.btn_up = QPushButton("Up")
        self.btn_up.setFixedWidth(60)
        self.btn_up.clicked.connect(self._on_up_clicked)
        nav_row.addWidget(self.btn_up)

        self.path_lbl = QLabel("/")
        self.path_lbl.setStyleSheet("font-family: Consolas; font-weight: 600;")
        nav_row.addWidget(self.path_lbl, 1)

        self.btn_download = QPushButton("Download Selected")
        self.btn_download.clicked.connect(self._on_download_clicked)
        nav_row.addWidget(self.btn_download)

        layout.addLayout(nav_row)

        self.file_table = QTableWidget()
        self.file_table.setColumnCount(3)
        self.file_table.setHorizontalHeaderLabels(["Name", "Type", "Size"])
        self.file_table.horizontalHeader().setSectionResizeMode(0, QHeaderView.Stretch)
        self.file_table.horizontalHeader().setSectionResizeMode(1, QHeaderView.ResizeToContents)
        self.file_table.horizontalHeader().setSectionResizeMode(2, QHeaderView.ResizeToContents)
        self.file_table.cellDoubleClicked.connect(self._on_cell_double_clicked)
        layout.addWidget(self.file_table)

        btn_close = QPushButton("Close Explorer")
        btn_close.clicked.connect(self.accept)
        layout.addWidget(btn_close)

        self.refresh_files()

    def refresh_files(self) -> None:
        ok, items, err = self.server_state.app_access_manager.list_directory(self.session_id, self.current_subpath)
        if not ok:
            QMessageBox.critical(self, "Directory Error", f"Failed to list directory:\n{err}")
            return

        self.path_lbl.setText("/" + self.current_subpath)
        self.file_table.setRowCount(len(items))

        for row, item in enumerate(items):
            name_item = QTableWidgetItem(item["name"])
            self.file_table.setItem(row, 0, name_item)

            type_item = QTableWidgetItem("Folder" if item["is_dir"] else "File")
            self.file_table.setItem(row, 1, type_item)

            size_str = f"{item['size']:,} bytes" if not item["is_dir"] else "-"
            size_item = QTableWidgetItem(size_str)
            self.file_table.setItem(row, 2, size_item)

    def _on_cell_double_clicked(self, row: int, col: int) -> None:
        type_item = self.file_table.item(row, 1)
        name_item = self.file_table.item(row, 0)
        if type_item and type_item.text() == "Folder" and name_item:
            folder_name = name_item.text()
            self.current_subpath = f"{self.current_subpath}/{folder_name}".strip("/")
            self.refresh_files()

    def _on_up_clicked(self) -> None:
        if self.current_subpath:
            parts = self.current_subpath.split("/")
            self.current_subpath = "/".join(parts[:-1])
            self.refresh_files()

    def _on_download_clicked(self) -> None:
        row = self.file_table.currentRow()
        if row < 0:
            QMessageBox.information(self, "Select File", "Please select a file to download.")
            return

        type_item = self.file_table.item(row, 1)
        name_item = self.file_table.item(row, 0)
        if not type_item or type_item.text() == "Folder":
            QMessageBox.information(self, "Cannot Download Directory", "Please select an individual file.")
            return

        filename = name_item.text()
        rel_path = f"{self.current_subpath}/{filename}".strip("/")

        save_dest, _ = QFileDialog.getSaveFileName(self, "Save File As", filename)
        if not save_dest:
            return

        ok, content, err = self.server_state.app_access_manager.read_file(self.session_id, rel_path)
        if ok and content is not None:
            try:
                with open(save_dest, "wb") as f:
                    f.write(content)
                QMessageBox.information(self, "Downloaded", f"File saved successfully to:\n{save_dest}")
            except Exception as e:
                QMessageBox.critical(self, "Save Error", f"Failed to save file: {str(e)}")
        else:
            QMessageBox.critical(self, "Download Error", f"Failed to read remote file: {err}")


class FolderAccessView(QWidget):
    """Server Folder Access management dashboard and approval console."""

    def __init__(
        self,
        server_state: AdminServerState,
        is_dark: bool = True,
        parent: Optional[QWidget] = None,
    ):
        super().__init__(parent)
        self.server_state = server_state
        self.is_dark = is_dark

        self._setup_ui()

        self.timer = QTimer(self)
        self.timer.timeout.connect(self.refresh_table)
        self.timer.start(4000)

        self.refresh_table()

    def _setup_ui(self) -> None:
        main_layout = QVBoxLayout(self)
        main_layout.setContentsMargins(24, 20, 24, 20)
        main_layout.setSpacing(16)

        # Header bar
        header_row = QHBoxLayout()
        header_title = QLabel("Authorized Folder Access Sessions")
        header_title.setStyleSheet("font-size: 18px; font-weight: 700;")
        header_row.addWidget(header_title)
        header_row.addStretch()

        self.btn_refresh = QPushButton("Refresh")
        self.btn_refresh.setIcon(get_icon("refresh", self.is_dark))
        self.btn_refresh.clicked.connect(self.refresh_table)
        header_row.addWidget(self.btn_refresh)

        self.btn_new_request = QPushButton("Request Folder Access")
        self.btn_new_request.setObjectName("PrimaryButton")
        self.btn_new_request.setIcon(get_icon("folder", self.is_dark))
        self.btn_new_request.clicked.connect(self.on_create_request_clicked)
        header_row.addWidget(self.btn_new_request)

        main_layout.addLayout(header_row)

        desc = QLabel(
            "Manage temporary, scoped folder access sessions. Select an enrolled laptop, choose from its "
            "advertised shared folders, and wait for explicit employee consent."
        )
        desc.setStyleSheet("color: #888888; font-size: 12px;")
        desc.setWordWrap(True)
        main_layout.addWidget(desc)

        # Table container
        table_card = QFrame()
        table_card.setObjectName("MetricCard")
        table_layout = QVBoxLayout(table_card)
        table_layout.setContentsMargins(16, 16, 16, 16)

        self.table = QTableWidget()
        self.table.setColumnCount(7)
        self.table.setHorizontalHeaderLabels([
            "Device ID",
            "Target Folder",
            "Permission",
            "Status",
            "Duration",
            "Created",
            "Actions",
        ])
        self.table.horizontalHeader().setSectionResizeMode(0, QHeaderView.ResizeToContents)
        self.table.horizontalHeader().setSectionResizeMode(1, QHeaderView.Stretch)
        self.table.horizontalHeader().setSectionResizeMode(2, QHeaderView.ResizeToContents)
        self.table.horizontalHeader().setSectionResizeMode(3, QHeaderView.ResizeToContents)
        self.table.horizontalHeader().setSectionResizeMode(4, QHeaderView.ResizeToContents)
        self.table.horizontalHeader().setSectionResizeMode(5, QHeaderView.ResizeToContents)
        self.table.horizontalHeader().setSectionResizeMode(6, QHeaderView.ResizeToContents)
        self.table.verticalHeader().setVisible(False)
        self.table.setAlternatingRowColors(True)
        self.table.setShowGrid(False)

        table_layout.addWidget(self.table)
        main_layout.addWidget(table_card, 1)

        self.empty_state = EmptyState(
            title="No Folder Access Sessions",
            message="Click 'Request Folder Access' above to initiate an authorized session with an enrolled client.",
            icon_name="folder",
            is_dark=self.is_dark,
        )
        table_layout.addWidget(self.empty_state)

    def refresh_table(self) -> None:
        requests = list(self.server_state.folder_requests.values())
        now = time.time()

        # Check expirations
        for r in requests:
            if r.get("status") in (FolderRequestStatus.APPROVED.value, FolderRequestStatus.ACTIVE.value):
                if now > r.get("expires_at", 0):
                    r["status"] = FolderRequestStatus.EXPIRED.value

        if not requests:
            self.table.setVisible(False)
            self.empty_state.setVisible(True)
            return

        self.table.setVisible(True)
        self.empty_state.setVisible(False)
        self.table.setRowCount(len(requests))

        for row, req in enumerate(sorted(requests, key=lambda x: x.get("created_at", 0), reverse=True)):
            # 0: Device
            self.table.setItem(row, 0, QTableWidgetItem(req.get("device_id", "Unknown")))

            # 1: Folder
            folder = req.get("proposed_folder", "Not specified")
            self.table.setItem(row, 1, QTableWidgetItem(folder))

            # 2: Perm
            perm_str = "Read-Only" if req.get("permission") in ("read_only", "READ") else "Read-Write"
            self.table.setItem(row, 2, QTableWidgetItem(perm_str))

            # 3: Status Badge
            status = req.get("status", "UNKNOWN")
            badge_type = "neutral"
            display_status = status
            if status in (FolderRequestStatus.APPROVED.value, FolderRequestStatus.ACTIVE.value):
                badge_type = "success"
                display_status = "Approved & Active"
            elif status in (FolderRequestStatus.PENDING.value, "PENDING_APPROVAL"):
                badge_type = "warning"
                display_status = "Pending Employee Approval"
            elif status == FolderRequestStatus.DENIED.value:
                badge_type = "danger"
                display_status = "Denied by Employee"
            elif status == FolderRequestStatus.EXPIRED.value:
                badge_type = "neutral"
                display_status = "Expired"
            elif status == FolderRequestStatus.REVOKED.value:
                badge_type = "danger"
                display_status = "Revoked"

            badge = StatusBadge(display_status, badge_type)
            self.table.setCellWidget(row, 3, badge)

            # 4: Duration
            dur = f"{req.get('duration_minutes', 30)} min"
            self.table.setItem(row, 4, QTableWidgetItem(dur))

            # 5: Created
            c_time = time.strftime("%H:%M:%S", time.localtime(req.get("created_at", now)))
            self.table.setItem(row, 5, QTableWidgetItem(c_time))

            # 6: Action buttons
            actions_widget = QWidget()
            act_layout = QHBoxLayout(actions_widget)
            act_layout.setContentsMargins(4, 2, 4, 2)
            act_layout.setSpacing(6)

            req_id = req.get("request_id")
            session_id = req.get("session_id")

            if status in (FolderRequestStatus.APPROVED.value, FolderRequestStatus.ACTIVE.value) and session_id:
                btn_explore = QPushButton("Explore Files")
                btn_explore.setObjectName("PrimaryButton")
                btn_explore.clicked.connect(lambda _, s=session_id, f=folder: self._on_explore_clicked(s, f))
                act_layout.addWidget(btn_explore)

                btn_revoke = QPushButton("Revoke")
                btn_revoke.setObjectName("DangerButton")
                btn_revoke.clicked.connect(lambda _, rid=req_id: self._on_revoke_clicked(rid))
                act_layout.addWidget(btn_revoke)
            elif status in (FolderRequestStatus.PENDING.value, "PENDING_APPROVAL"):
                btn_cancel = QPushButton("Cancel Request")
                btn_cancel.clicked.connect(lambda _, rid=req_id: self._on_revoke_clicked(rid))
                act_layout.addWidget(btn_cancel)
            else:
                act_layout.addWidget(QLabel("-"))

            self.table.setCellWidget(row, 6, actions_widget)

    def on_create_request_clicked(self) -> None:
        devices = self.server_state.registry.list_devices()
        active_devices = [d for d in devices if d.get("status") == "active"]

        if not active_devices:
            QMessageBox.warning(
                self,
                "No Enrolled Devices",
                "There are no active enrolled devices. Please enroll an employee laptop first in the 'Devices' tab.",
            )
            return

        dlg = CreateFolderRequestDialog(
            active_devices,
            self.server_state.client_shared_folders,
            self,
        )
        if dlg.exec() == QDialog.Accepted:
            data = dlg.get_data()
            import os, uuid
            req_id = f"req_{int(time.time())}_{uuid.uuid4().hex[:8]}"
            dev_id = data["device_id"]
            duration = data["duration_minutes"]

            record = {
                "request_id": req_id,
                "device_id": dev_id,
                "admin_id": "Administrator",
                "proposed_folder": data["proposed_folder"],
                "permission": data["permission"],
                "duration_minutes": duration,
                "purpose": data["purpose"],
                "status": FolderRequestStatus.PENDING.value,
                "created_at": time.time(),
                "expires_at": time.time() + (duration * 60),
                "attempts": 0,
            }
            self.server_state.folder_requests[req_id] = record
            self.server_state.audit.log_event(
                "FOLDER_REQUEST_CREATED",
                "SUCCESS",
                device_id=dev_id,
                details={"request_id": req_id, "folder": data["proposed_folder"], "permission": data["permission"]},
            )
            self.refresh_table()
            QMessageBox.information(
                self,
                "Request Submitted",
                f"Folder access request sent to {dev_id}!\n\n"
                f"Target Folder: {data['proposed_folder']}\n"
                "The employee will see an approval prompt on their laptop.",
            )

    def _on_explore_clicked(self, session_id: str, folder_path: str) -> None:
        dlg = ExploreApprovedFolderDialog(session_id, folder_path, self.server_state, self)
        dlg.exec()

    def _on_revoke_clicked(self, req_id: str) -> None:
        if req_id in self.server_state.folder_requests:
            req = self.server_state.folder_requests[req_id]
            req["status"] = FolderRequestStatus.REVOKED.value
            self.server_state.app_access_manager.revoke_by_folder(req.get("proposed_folder", ""))
            self.server_state.audit.log_event(
                "FOLDER_REQUEST_REVOKED",
                "REVOKED",
                device_id=req.get("device_id"),
                details={"request_id": req_id},
            )
            self.refresh_table()
            QMessageBox.information(self, "Revoked", "Session revoked successfully.")

    def update_theme(self, is_dark: bool) -> None:
        self.is_dark = is_dark
        self.btn_refresh.setIcon(get_icon("refresh", is_dark))
        self.btn_new_request.setIcon(get_icon("folder", is_dark))
        self.empty_state.update_theme(is_dark)
        self.refresh_table()
