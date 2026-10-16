"""Client Shared Folders settings view for managing local folder access allowlist."""

import os
from pathlib import Path
from typing import Optional
from PySide6.QtCore import Qt
from PySide6.QtWidgets import (
    QComboBox,
    QFileDialog,
    QFrame,
    QHBoxLayout,
    QHeaderView,
    QLabel,
    QMessageBox,
    QPushButton,
    QTableWidget,
    QTableWidgetItem,
    QVBoxLayout,
    QWidget,
)

from driver_update_assistant.client.service import ClientManager
from driver_update_assistant.folder_access.consent import validate_shareable_folder_path
from driver_update_assistant.protocol import SharePermission
from driver_update_assistant.ui.icons import get_icon
from driver_update_assistant.ui.theme import ThemeManager
from driver_update_assistant.ui.widgets import EmptyState, HeaderBar, StatusBadge


class SharedFoldersView(QWidget):
    """
    Dedicated Client settings view allowing the employee to configure,
    validate, review, and persist folders eligible for administrative access requests.
    """

    def __init__(self, manager: ClientManager, is_dark: bool = True, parent: Optional[QWidget] = None):
        super().__init__(parent)
        self.manager = manager
        self.is_dark = is_dark
        self.allowlist = manager.client.allowlist
        self._init_ui()
        self.refresh_list()

    def _init_ui(self) -> None:
        layout = QVBoxLayout(self)
        layout.setContentsMargins(28, 28, 28, 28)
        layout.setSpacing(20)

        # 1. Header & Guidance Card
        header = HeaderBar(
            title="Configured Shared Folders",
            subtitle="Manage folders on this laptop that are eligible for future administrative support requests. Access is granted only when you explicitly approve an individual request.",
            badge_text="Zero-Trust Allowlist",
            badge_type="info",
        )
        layout.addWidget(header)

        # 2. Add Folder Controls Card
        add_card = QFrame()
        add_card.setObjectName("MetricCard")
        add_card_layout = QVBoxLayout(add_card)
        add_card_layout.setContentsMargins(20, 16, 20, 16)
        add_card_layout.setSpacing(12)

        add_title = QLabel("Add Eligible Folder")
        add_title.setStyleSheet("font-size: 15px; font-weight: 700;")
        add_card_layout.addWidget(add_title)

        ctrl_row = QHBoxLayout()
        ctrl_row.setSpacing(12)

        self.btn_browse = QPushButton("Select Folder...")
        self.btn_browse.setIcon(get_icon("folder", self.is_dark))
        self.btn_browse.setFixedWidth(160)
        self.btn_browse.clicked.connect(self._on_browse_clicked)
        ctrl_row.addWidget(self.btn_browse)

        self.selected_path_lbl = QLabel("No folder selected")
        self.selected_path_lbl.setStyleSheet("color: #888888; font-style: italic;")
        ctrl_row.addWidget(self.selected_path_lbl, 1)

        perm_lbl = QLabel("Default Permission:")
        perm_lbl.setStyleSheet("font-weight: 600;")
        ctrl_row.addWidget(perm_lbl)

        self.perm_combo = QComboBox()
        self.perm_combo.setFixedWidth(140)
        self.perm_combo.addItem("Read-Only (Default)", SharePermission.READ_ONLY.value)
        self.perm_combo.addItem("Read-Write", SharePermission.READ_WRITE.value)
        ctrl_row.addWidget(self.perm_combo)

        self.btn_add = QPushButton("Add to Allowlist")
        self.btn_add.setObjectName("PrimaryButton")
        self.btn_add.setFixedWidth(150)
        self.btn_add.setEnabled(False)
        self.btn_add.clicked.connect(self._on_add_clicked)
        ctrl_row.addWidget(self.btn_add)

        add_card_layout.addLayout(ctrl_row)

        notice_lbl = QLabel(
            "Security Policy: Drive roots (C:\\), Windows system directories, Program Files, and AppData are strictly rejected."
        )
        notice_lbl.setStyleSheet("color: #777777; font-size: 11px;")
        add_card_layout.addWidget(notice_lbl)

        layout.addWidget(add_card)

        # 3. Configured Folders Table Card
        table_card = QFrame()
        table_card.setObjectName("MetricCard")
        table_card_layout = QVBoxLayout(table_card)
        table_card_layout.setContentsMargins(20, 16, 20, 16)
        table_card_layout.setSpacing(12)

        table_header = QHBoxLayout()
        table_title = QLabel("Configured Folders")
        table_title.setStyleSheet("font-size: 15px; font-weight: 700;")
        table_header.addWidget(table_title)
        table_header.addStretch()

        self.btn_refresh = QPushButton("Refresh Status")
        self.btn_refresh.setIcon(get_icon("refresh", self.is_dark))
        self.btn_refresh.clicked.connect(self.refresh_list)
        table_header.addWidget(self.btn_refresh)
        table_card_layout.addLayout(table_header)

        self.table = QTableWidget()
        self.table.setColumnCount(5)
        self.table.setHorizontalHeaderLabels([
            "Folder Path",
            "Configured Permission",
            "Filesystem Status",
            "Sharing Eligibility",
            "Action",
        ])
        self.table.horizontalHeader().setSectionResizeMode(0, QHeaderView.Stretch)
        self.table.horizontalHeader().setSectionResizeMode(1, QHeaderView.ResizeToContents)
        self.table.horizontalHeader().setSectionResizeMode(2, QHeaderView.ResizeToContents)
        self.table.horizontalHeader().setSectionResizeMode(3, QHeaderView.ResizeToContents)
        self.table.horizontalHeader().setSectionResizeMode(4, QHeaderView.Fixed)
        self.table.setColumnWidth(4, 110)
        self.table.verticalHeader().setVisible(False)
        self.table.setAlternatingRowColors(True)
        self.table.setShowGrid(False)
        table_card_layout.addWidget(self.table)

        self.empty_state = EmptyState(
            title="No Shared Folders Configured",
            message="Click 'Select Folder...' above to add an operational directory (e.g. C:\\Logs\\Automoby) to your allowlist.",
            icon_name="folder",
            is_dark=self.is_dark,
        )
        table_card_layout.addWidget(self.empty_state)

        layout.addWidget(table_card, 1)

    def _on_browse_clicked(self) -> None:
        """Opens native Windows folder picker."""
        folder = QFileDialog.getExistingDirectory(
            self,
            "Select Folder for Allowlist",
            str(Path.home()),
            QFileDialog.ShowDirsOnly | QFileDialog.DontResolveSymlinks,
        )
        if not folder:
            return

        is_safe, err_code, reason, canonical = validate_shareable_folder_path(folder)
        if not is_safe or not canonical:
            QMessageBox.critical(
                self,
                "Restricted Folder",
                f"Cannot add folder:\n\n{reason}\n\nPlease choose an ordinary user directory.",
            )
            return

        self._pending_folder = canonical
        self.selected_path_lbl.setText(canonical)
        self.selected_path_lbl.setStyleSheet("color: #4CAF50; font-weight: 600;")
        self.btn_add.setEnabled(True)

    def _on_add_clicked(self) -> None:
        if not hasattr(self, "_pending_folder") or not self._pending_folder:
            return

        perm_val = self.perm_combo.currentData()
        perm = SharePermission(perm_val)

        success, msg, entry = self.allowlist.add_folder(self._pending_folder, perm)
        if success:
            QMessageBox.information(self, "Folder Added", msg)
            self._pending_folder = ""
            self.selected_path_lbl.setText("No folder selected")
            self.selected_path_lbl.setStyleSheet("color: #888888; font-style: italic;")
            self.btn_add.setEnabled(False)
            self.refresh_list()
            # Inform server of updated advertised shared folders
            curr_ver = self.manager.client.get_installed_extension_version()
            self.manager.client.check_in(curr_ver, "IDLE")
        else:
            QMessageBox.warning(self, "Cannot Add Folder", msg)

    def refresh_list(self) -> None:
        """Populates the table with currently configured folders and evaluates their validity."""
        self.allowlist.load()
        folders = self.allowlist.list_folders()

        if not folders:
            self.table.setVisible(False)
            self.empty_state.setVisible(True)
            return

        self.table.setVisible(True)
        self.empty_state.setVisible(False)
        self.table.setRowCount(len(folders))

        for row, entry in enumerate(folders):
            # 0: Path
            path_item = QTableWidgetItem(entry.path)
            self.table.setItem(row, 0, path_item)

            # 1: Permission
            perm_item = QTableWidgetItem("Read-Only" if entry.permission == SharePermission.READ_ONLY.value else "Read-Write")
            self.table.setItem(row, 1, perm_item)

            # 2: Filesystem Status
            exists = os.path.isdir(entry.path)
            status_badge = StatusBadge("Exists" if exists else "Missing", "success" if exists else "danger")
            self.table.setCellWidget(row, 2, status_badge)

            # 3: Sharing Eligibility
            elig_badge = StatusBadge("Eligible" if (exists and entry.enabled) else "Disabled", "info" if (exists and entry.enabled) else "neutral")
            self.table.setCellWidget(row, 3, elig_badge)

            # 4: Action (Remove)
            remove_btn = QPushButton("Remove")
            remove_btn.setObjectName("DangerButton")
            remove_btn.clicked.connect(lambda _, p=entry.path: self._on_remove_clicked(p))
            self.table.setCellWidget(row, 4, remove_btn)

    def _on_remove_clicked(self, folder_path: str) -> None:
        reply = QMessageBox.question(
            self,
            "Remove Folder",
            f"Are you sure you want to remove this folder from the allowlist?\n\n{folder_path}\n\n"
            "Future administrative requests targeting this folder will be blocked. Any active access sessions will be terminated.",
            QMessageBox.Yes | QMessageBox.No,
            QMessageBox.No,
        )
        if reply == QMessageBox.Yes:
            # Terminate any active sessions on this folder
            self.manager.cleanup_engine.check_and_clean_expired()
            self.allowlist.remove_folder(folder_path)
            self.refresh_list()
            # Update checkin on server
            curr_ver = self.manager.client.get_installed_extension_version()
            self.manager.client.check_in(curr_ver, "IDLE")
            QMessageBox.information(self, "Folder Removed", "The folder was removed from the allowlist.")

    def update_theme(self, is_dark: bool) -> None:
        self.is_dark = is_dark
        self.btn_browse.setIcon(get_icon("folder", is_dark))
        self.btn_refresh.setIcon(get_icon("refresh", is_dark))
        self.empty_state.update_theme(is_dark)
        self.refresh_list()
