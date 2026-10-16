"""Client GUI Home overview view.

Displays connection status to the central server, local device enrollment,
currently detected Chrome extension version, update status, and quick sync action.
"""

import time
from typing import Optional
from PySide6.QtCore import Qt, QTimer
from PySide6.QtWidgets import (
    QFrame,
    QGridLayout,
    QHBoxLayout,
    QLabel,
    QPushButton,
    QVBoxLayout,
    QWidget,
)

from driver_update_assistant.client.service import CheckUpdateWorker, ClientManager
from driver_update_assistant.protocol import ReleaseMetadata
from driver_update_assistant.ui.icons import get_icon
from driver_update_assistant.ui.widgets import MetricCard, StatusBadge


class HomeView(QWidget):
    """Client Home screen for employee laptops."""

    def __init__(
        self,
        manager: ClientManager,
        is_dark: bool = True,
        parent: Optional[QWidget] = None,
    ):
        super().__init__(parent)
        self.manager = manager
        self.is_dark = is_dark
        self.latest_release: Optional[ReleaseMetadata] = None
        self._check_worker: Optional[CheckUpdateWorker] = None

        self._setup_ui()

        # Auto-refresh check every 30 seconds
        self.timer = QTimer(self)
        self.timer.timeout.connect(self.trigger_sync)
        self.timer.start(30000)

        # Trigger initial sync
        QTimer.singleShot(500, self.trigger_sync)

    def _setup_ui(self) -> None:
        main_layout = QVBoxLayout(self)
        main_layout.setContentsMargins(24, 20, 24, 20)
        main_layout.setSpacing(20)

        # Header row
        header_row = QHBoxLayout()
        title_box = QVBoxLayout()
        title_box.setSpacing(2)

        title = QLabel("System Status and Extension Overview")
        title.setStyleSheet("font-size: 18px; font-weight: 700;")
        title_box.addWidget(title)

        subtitle = QLabel("Local employee assistant monitoring Chrome extension version and central server connection.")
        subtitle.setStyleSheet("color: #888888; font-size: 12px;")
        title_box.addWidget(subtitle)

        header_row.addLayout(title_box)
        header_row.addStretch()

        self.btn_sync = QPushButton("Sync and Check")
        self.btn_sync.setProperty("class", "primary")
        self.btn_sync.setIcon(get_icon("refresh", self.is_dark))
        self.btn_sync.clicked.connect(self.trigger_sync)
        header_row.addWidget(self.btn_sync)

        main_layout.addLayout(header_row)

        # KPI Metrics Cards (4 cards)
        cards_layout = QHBoxLayout()
        cards_layout.setSpacing(14)

        self.card_conn = MetricCard("Central Server", "Connecting...", "Checking status", "server", self.is_dark)
        self.card_device = MetricCard("Device Identity", self.manager.config.device_id, "Enrolled laptop", "shield", self.is_dark)
        self.card_version = MetricCard("Extension Version", "Checking...", "Local files", "releases", self.is_dark)
        self.card_update = MetricCard("Update Status", "Up to Date", "Ready", "check", self.is_dark)

        cards_layout.addWidget(self.card_conn)
        cards_layout.addWidget(self.card_device)
        cards_layout.addWidget(self.card_version)
        cards_layout.addWidget(self.card_update)

        main_layout.addLayout(cards_layout)

        # Detailed Status Card
        info_frame = QFrame()
        info_frame.setObjectName("Card")
        info_layout = QVBoxLayout(info_frame)
        info_layout.setContentsMargins(20, 16, 20, 16)
        info_layout.setSpacing(12)

        info_title = QLabel("Connection and Environment Details")
        info_title.setStyleSheet("font-size: 14px; font-weight: 700;")
        info_layout.addWidget(info_title)

        grid = QGridLayout()
        grid.setSpacing(10)

        grid.addWidget(QLabel("Server Endpoint:"), 0, 0)
        self.lbl_server_url = QLabel(self.manager.config.server_url)
        self.lbl_server_url.setStyleSheet("font-family: 'Consolas'; font-weight: 600;")
        grid.addWidget(self.lbl_server_url, 0, 1)

        grid.addWidget(QLabel("Extension Directory:"), 1, 0)
        self.lbl_ext_dir = QLabel(self.manager.config.extension_dir or "Default workspace root")
        self.lbl_ext_dir.setStyleSheet("font-family: 'Consolas'; color: #888888; font-size: 11px;")
        grid.addWidget(self.lbl_ext_dir, 1, 1)

        grid.addWidget(QLabel("Last Synchronized:"), 2, 0)
        self.lbl_last_sync = QLabel("Never")
        grid.addWidget(self.lbl_last_sync, 2, 1)

        grid.addWidget(QLabel("Telemetry Outbox:"), 3, 0)
        self.lbl_outbox = QLabel("0 pending offline reports")
        grid.addWidget(self.lbl_outbox, 3, 1)

        info_layout.addLayout(grid)
        main_layout.addWidget(info_frame)

        # Notification / Banner Frame
        self.banner = QFrame()
        self.banner.setObjectName("Card")
        self.banner.setStyleSheet("border-left: 4px solid #0066CC;")
        banner_layout = QHBoxLayout(self.banner)
        banner_layout.setContentsMargins(16, 12, 16, 12)

        self.banner_text = QLabel(
            "All background telemetry is queued securely with atomic journal checkpoints. "
            "If an update occurs, rollback snapshots protect local configurations."
        )
        self.banner_text.setStyleSheet("font-size: 12px; color: #888888;")
        self.banner_text.setWordWrap(True)
        banner_layout.addWidget(self.banner_text)

        main_layout.addWidget(self.banner)
        main_layout.addStretch()

    def trigger_sync(self) -> None:
        if self._check_worker and self._check_worker.isRunning():
            return

        self.btn_sync.setEnabled(False)
        self.card_conn.set_value("Syncing...", "Heartbeat in progress")

        self._check_worker = CheckUpdateWorker(self.manager.client, self)
        self._check_worker.finished_check.connect(self._on_sync_finished)
        self._check_worker.start()

    def _on_sync_finished(self, is_online: bool, update_avail: bool, message: str, meta: Optional[ReleaseMetadata]) -> None:
        self.btn_sync.setEnabled(True)
        installed_ver = self.manager.client.get_installed_extension_version()
        self.card_version.set_value(f"v{installed_ver}", "Installed in Chrome")

        now_str = time.strftime("%H:%M:%S")
        self.lbl_last_sync.setText(f"Today at {now_str}")

        pending_outbox = len(self.manager.client.outbox.get_pending_reports())
        self.lbl_outbox.setText(f"{pending_outbox} pending report(s)" if pending_outbox else "All reports synced (0 pending)")

        if is_online:
            self.card_conn.set_value("Online", "Connected to LAN server")
            if update_avail and meta:
                self.latest_release = meta
                self.card_update.set_value(f"v{meta.version} Ready", "Update available")
                self.banner_text.setText(
                    f"A new extension release <b>v{meta.version}</b> is available from the administrator. "
                    "Navigate to the 'Extension Updates' tab to review and install."
                )
                self.banner.setStyleSheet("border-left: 4px solid #FBBC04;")
            else:
                self.card_update.set_value("Up to Date", f"v{installed_ver} latest")
                self.banner_text.setText("Extension is up to date and verified against the administrator server.")
                self.banner.setStyleSheet("border-left: 4px solid #34A853;")
        else:
            self.card_conn.set_value("Offline", "Cannot reach server")
            self.card_update.set_value("Unknown", "Server unreachable")
            self.banner_text.setText(
                "Unable to reach the central administrator server. Cached extension files continue working offline. "
                "Verify your LAN Wi-Fi connection or check Server settings."
            )
            self.banner.setStyleSheet("border-left: 4px solid #EA4335;")

        # Also trigger manager poll for folder requests
        self.manager.poll_state()
