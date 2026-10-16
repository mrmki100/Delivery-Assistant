"""Client GUI Extension Updates view.

Manages checking, reviewing release notes, staging, installing, and rollback
recovery for the Chrome extension with clear progress indicators and reload instructions.
"""

from typing import Optional
from PySide6.QtCore import Qt
from PySide6.QtWidgets import (
    QFrame,
    QHBoxLayout,
    QLabel,
    QMessageBox,
    QProgressBar,
    QPushButton,
    QTextEdit,
    QVBoxLayout,
    QWidget,
)

from driver_update_assistant.client.service import (
    CheckUpdateWorker,
    ClientManager,
    ExecuteUpdateWorker,
)
from driver_update_assistant.protocol import ReleaseMetadata
from driver_update_assistant.ui.icons import get_icon
from driver_update_assistant.ui.widgets import StatusBadge


class UpdatesView(QWidget):
    """Extension update download, verification, install, and diagnostic console."""

    def __init__(
        self,
        manager: ClientManager,
        is_dark: bool = True,
        parent: Optional[QWidget] = None,
    ):
        super().__init__(parent)
        self.manager = manager
        self.is_dark = is_dark
        self.current_metadata: Optional[ReleaseMetadata] = None

        self._check_worker: Optional[CheckUpdateWorker] = None
        self._update_worker: Optional[ExecuteUpdateWorker] = None

        self._setup_ui()
        self.refresh_versions()

    def _setup_ui(self) -> None:
        main_layout = QVBoxLayout(self)
        main_layout.setContentsMargins(24, 20, 24, 20)
        main_layout.setSpacing(16)

        # Header row
        header_row = QHBoxLayout()
        title_box = QVBoxLayout()
        title_box.setSpacing(2)

        title = QLabel("Extension Updates and Version Management")
        title.setStyleSheet("font-size: 18px; font-weight: 700;")
        title_box.addWidget(title)

        subtitle = QLabel("Verify cryptographic signatures and deploy extension updates safely with automated rollback.")
        subtitle.setStyleSheet("color: #888888; font-size: 12px;")
        title_box.addWidget(subtitle)

        header_row.addLayout(title_box)
        header_row.addStretch()

        self.btn_check = QPushButton("Check for Updates")
        self.btn_check.setIcon(get_icon("refresh", self.is_dark))
        self.btn_check.clicked.connect(self.on_check_updates)
        header_row.addWidget(self.btn_check)

        main_layout.addLayout(header_row)

        # Version Comparison Card
        ver_card = QFrame()
        ver_card.setObjectName("Card")
        ver_layout = QHBoxLayout(ver_card)
        ver_layout.setContentsMargins(20, 16, 20, 16)
        ver_layout.setSpacing(20)

        # Installed Version Column
        col1 = QVBoxLayout()
        lbl1 = QLabel("INSTALLED VERSION")
        lbl1.setStyleSheet("color: #888888; font-size: 11px; font-weight: 600;")
        col1.addWidget(lbl1)

        self.lbl_installed_ver = QLabel("v0.0.0")
        self.lbl_installed_ver.setStyleSheet("font-size: 22px; font-weight: 700;")
        col1.addWidget(self.lbl_installed_ver)

        self.badge_installed = StatusBadge("Current", "info")
        col1.addWidget(self.badge_installed)
        ver_layout.addLayout(col1)

        ver_layout.addStretch()

        # Target / Available Version Column
        col2 = QVBoxLayout()
        lbl2 = QLabel("LATEST AVAILABLE RELEASE")
        lbl2.setStyleSheet("color: #888888; font-size: 11px; font-weight: 600;")
        col2.addWidget(lbl2)

        self.lbl_target_ver = QLabel("Checking...")
        self.lbl_target_ver.setStyleSheet("font-size: 22px; font-weight: 700;")
        col2.addWidget(self.lbl_target_ver)

        self.badge_status = StatusBadge("Idle", "neutral")
        col2.addWidget(self.badge_status)
        ver_layout.addLayout(col2)

        main_layout.addWidget(ver_card)

        # Release Notes Box
        notes_frame = QFrame()
        notes_frame.setObjectName("Card")
        notes_layout = QVBoxLayout(notes_frame)
        notes_layout.setContentsMargins(16, 14, 16, 14)
        notes_layout.setSpacing(8)

        notes_lbl = QLabel("Release Notes and Changelog")
        notes_lbl.setStyleSheet("font-size: 13px; font-weight: 600;")
        notes_layout.addWidget(notes_lbl)

        self.notes_text = QTextEdit()
        self.notes_text.setReadOnly(True)
        self.notes_text.setPlaceholderText("Release notes will appear here when an update is available...")
        self.notes_text.setFixedHeight(120)
        notes_layout.addWidget(self.notes_text)

        main_layout.addWidget(notes_frame)

        # Progress bar and status message
        self.progress_frame = QFrame()
        self.progress_frame.setObjectName("Card")
        prog_layout = QVBoxLayout(self.progress_frame)
        prog_layout.setContentsMargins(16, 14, 16, 14)
        prog_layout.setSpacing(10)

        self.lbl_progress_status = QLabel("Ready")
        self.lbl_progress_status.setStyleSheet("font-weight: 600; font-size: 13px;")
        prog_layout.addWidget(self.lbl_progress_status)

        self.prog_bar = QProgressBar()
        self.prog_bar.setRange(0, 100)
        self.prog_bar.setValue(0)
        self.prog_bar.setFixedHeight(12)
        prog_layout.addWidget(self.prog_bar)

        # Developer Mode Notice
        self.lbl_notice = QLabel(
            "<b>Activation Notice:</b> Because the Chrome extension runs in Developer Mode, "
            "files are safely replaced on disk. To reload running extension background scripts, "
            "navigate to <code>chrome://extensions</code> and click the circular reload icon, or restart Chrome."
        )
        self.lbl_notice.setWordWrap(True)
        self.lbl_notice.setStyleSheet("color: #888888; font-size: 11px;")
        prog_layout.addWidget(self.lbl_notice)

        main_layout.addWidget(self.progress_frame)

        # Action Buttons
        btn_row = QHBoxLayout()
        btn_row.addStretch()

        self.btn_install = QPushButton("Download and Install Update")
        self.btn_install.setProperty("class", "primary")
        self.btn_install.setIcon(get_icon("download", self.is_dark))
        self.btn_install.setEnabled(False)
        self.btn_install.clicked.connect(self.on_install_update)
        btn_row.addWidget(self.btn_install)

        main_layout.addLayout(btn_row)
        main_layout.addStretch()

    def refresh_versions(self) -> None:
        curr = self.manager.client.get_installed_extension_version()
        self.lbl_installed_ver.setText(f"v{curr}")

    def on_check_updates(self) -> None:
        if self._check_worker and self._check_worker.isRunning():
            return

        self.btn_check.setEnabled(False)
        self.lbl_progress_status.setText("Connecting to server to check releases...")
        self.prog_bar.setValue(10)

        self._check_worker = CheckUpdateWorker(self.manager.client, self)
        self._check_worker.finished_check.connect(self._on_check_finished)
        self._check_worker.start()

    def _on_check_finished(self, is_online: bool, update_avail: bool, message: str, meta: Optional[ReleaseMetadata]) -> None:
        self.btn_check.setEnabled(True)
        self.refresh_versions()

        if not is_online:
            self.lbl_target_ver.setText("Offline")
            self.badge_status.setText("Offline")
            self.badge_status.badge_type = "error"
            self.badge_status.style_badge()
            self.lbl_progress_status.setText("Failed to connect to central server.")
            self.prog_bar.setValue(0)
            self.btn_install.setEnabled(False)
            return

        if update_avail and meta:
            self.current_metadata = meta
            self.lbl_target_ver.setText(f"v{meta.version}")
            self.badge_status.setText("Update Available")
            self.badge_status.badge_type = "warning"
            self.badge_status.style_badge()
            self.notes_text.setText(meta.release_notes or "No changelog provided for this release.")
            self.lbl_progress_status.setText(f"New update v{meta.version} ready to install.")
            self.prog_bar.setValue(100)
            self.btn_install.setEnabled(True)
        else:
            self.lbl_target_ver.setText(self.lbl_installed_ver.text())
            self.badge_status.setText("Up to Date")
            self.badge_status.badge_type = "success"
            self.badge_status.style_badge()
            self.notes_text.setText("Your extension is running the latest published release.")
            self.lbl_progress_status.setText("System is fully up to date.")
            self.prog_bar.setValue(100)
            self.btn_install.setEnabled(False)

    def on_install_update(self) -> None:
        if not self.current_metadata:
            return

        confirm = QMessageBox.question(
            self,
            "Confirm Update Installation",
            f"Are you ready to install extension release v{self.current_metadata.version}?\n\n"
            "A pre-update snapshot backup will be created automatically for instant rollback if any file fails validation.",
            QMessageBox.Yes | QMessageBox.No,
            QMessageBox.Yes,
        )
        if confirm != QMessageBox.Yes:
            return

        self.btn_install.setEnabled(False)
        self.btn_check.setEnabled(False)
        self.prog_bar.setValue(15)
        self.lbl_progress_status.setText("Starting secure update pipeline...")

        self._update_worker = ExecuteUpdateWorker(self.manager.client, self.current_metadata, self)
        self._update_worker.step_changed.connect(self._on_update_step)
        self._update_worker.finished_update.connect(self._on_update_finished)
        self._update_worker.start()

    def _on_update_step(self, step_name: str, percent: int) -> None:
        self.lbl_progress_status.setText(step_name)
        self.prog_bar.setValue(percent)

    def _on_update_finished(self, success: bool, state_name: str, message: str) -> None:
        self.btn_check.setEnabled(True)
        self.refresh_versions()

        if success:
            self.prog_bar.setValue(100)
            self.lbl_progress_status.setText(f"Update completed: {message}")
            self.badge_status.setText("Installed")
            self.badge_status.badge_type = "success"
            self.badge_status.style_badge()
            self.btn_install.setEnabled(False)
            QMessageBox.information(
                self,
                "Update Successful",
                f"Extension files updated successfully to v{self.current_metadata.version}!\n\n"
                "Please reload the extension in Chrome (chrome://extensions) to activate changes.",
            )
        else:
            self.prog_bar.setValue(0)
            self.lbl_progress_status.setText(f"Update failed ({state_name}): {message}")
            self.badge_status.setText("Failed")
            self.badge_status.badge_type = "error"
            self.badge_status.style_badge()
            self.btn_install.setEnabled(True)  # Allow retry
            QMessageBox.critical(
                self,
                "Update Failed",
                f"The update could not be completed safely.\n\nState: {state_name}\nError: {message}\n\n"
                "Any existing files were preserved or automatically restored via rollback.",
            )
