"""Server GUI Main Window.

Assembles the administrator management console:
- Navigation sidebar (Dashboard, Devices, Releases, Folder Access, Settings, Logs)
- Persistent light/dark theme toggle
- Background REST service management
- Real-time fleet metrics and zero-trust controls
"""

from typing import Optional
from PySide6.QtCore import Qt, QSize
from PySide6.QtGui import QCloseEvent
from PySide6.QtWidgets import (
    QApplication,
    QButtonGroup,
    QFrame,
    QHBoxLayout,
    QLabel,
    QMainWindow,
    QPushButton,
    QStackedWidget,
    QVBoxLayout,
    QWidget,
)

from driver_update_assistant.config import ServerConfig
from driver_update_assistant.server.gui.dashboard_view import DashboardView
from driver_update_assistant.server.gui.devices_view import DevicesView
from driver_update_assistant.server.gui.folder_access_view import FolderAccessView
from driver_update_assistant.server.gui.logs_view import LogsView
from driver_update_assistant.server.gui.releases_view import ReleasesView
from driver_update_assistant.server.gui.settings_view import SettingsView
from driver_update_assistant.server.service import ServerServiceWorker
from driver_update_assistant.ui.icons import get_icon
from driver_update_assistant.ui.theme import ThemeManager
from driver_update_assistant.ui.widgets import NavButton, StatusBadge


class ServerMainWindow(QMainWindow):
    """Primary administrator management console window."""

    def __init__(self, config: ServerConfig, parent: Optional[QWidget] = None):
        super().__init__(parent)
        self.config = config
        self.theme_manager = ThemeManager(config.data_dir)
        self.is_dark = self.theme_manager.is_dark

        self.setWindowTitle("Delivery Assistant - Central Management Console (Server)")
        self.setMinimumSize(1080, 720)
        self.resize(1180, 780)

        # Background HTTP REST server worker
        self.service_worker = ServerServiceWorker(config, self)

        self._setup_ui()

        # Apply initial stylesheet
        self._apply_theme()

        # Auto-start server service
        self.service_worker.start()

    def _setup_ui(self) -> None:
        central_widget = QWidget(self)
        self.setCentralWidget(central_widget)

        root_layout = QHBoxLayout(central_widget)
        root_layout.setContentsMargins(0, 0, 0, 0)
        root_layout.setSpacing(0)

        # 1. Left Navigation Sidebar
        self.sidebar = QFrame()
        self.sidebar.setObjectName("Sidebar")
        self.sidebar.setFixedWidth(240)
        sidebar_layout = QVBoxLayout(self.sidebar)
        sidebar_layout.setContentsMargins(16, 20, 16, 20)
        sidebar_layout.setSpacing(8)

        # Brand header
        brand_row = QHBoxLayout()
        brand_icon = QLabel()
        brand_icon.setPixmap(get_icon("server", self.is_dark).pixmap(24, 24))
        brand_row.addWidget(brand_icon)

        brand_lbl = QLabel("Management Console")
        brand_lbl.setStyleSheet("font-size: 15px; font-weight: 700; letter-spacing: -0.2px;")
        brand_row.addWidget(brand_lbl)
        brand_row.addStretch()
        sidebar_layout.addLayout(brand_row)

        role_badge = QLabel("ADMINISTRATOR")
        role_badge.setStyleSheet(
            "font-size: 10px; font-weight: 700; color: #4CAF50; letter-spacing: 1px; margin-bottom: 12px;"
        )
        sidebar_layout.addWidget(role_badge)

        # Navigation buttons
        self.nav_group = QButtonGroup(self)
        self.nav_group.setExclusive(True)

        self.btn_nav_dashboard = NavButton("Dashboard", "dashboard", self.is_dark)
        self.btn_nav_devices = NavButton("Enrolled Laptops", "devices", self.is_dark)
        self.btn_nav_releases = NavButton("Extension Releases", "releases", self.is_dark)
        self.btn_nav_folder = NavButton("Folder Access", "folder", self.is_dark)
        self.btn_nav_settings = NavButton("Server Settings", "settings", self.is_dark)
        self.btn_nav_logs = NavButton("Audit and Diagnostics", "logs", self.is_dark)

        nav_buttons = [
            (self.btn_nav_dashboard, 0),
            (self.btn_nav_devices, 1),
            (self.btn_nav_releases, 2),
            (self.btn_nav_folder, 3),
            (self.btn_nav_settings, 4),
            (self.btn_nav_logs, 5),
        ]

        for btn, idx in nav_buttons:
            btn.setFixedHeight(40)
            self.nav_group.addButton(btn, idx)
            sidebar_layout.addWidget(btn)

        self.btn_nav_dashboard.setChecked(True)
        self.nav_group.idClicked.connect(self._on_nav_selected)

        sidebar_layout.addStretch()

        # Theme toggle button at bottom of sidebar
        self.theme_toggle_btn = QPushButton("Toggle Theme")
        self.theme_toggle_btn.setIcon(get_icon("sun" if self.is_dark else "moon", self.is_dark))
        self.theme_toggle_btn.clicked.connect(self.toggle_theme)
        sidebar_layout.addWidget(self.theme_toggle_btn)

        version_lbl = QLabel("v2.1.0 • Admin Role")
        version_lbl.setStyleSheet("color: #777777; font-size: 11px;")
        version_lbl.setAlignment(Qt.AlignCenter)
        sidebar_layout.addWidget(version_lbl)

        root_layout.addWidget(self.sidebar)

        # 2. Right Content Area (Top bar + QStackedWidget)
        content_container = QWidget()
        content_layout = QVBoxLayout(content_container)
        content_layout.setContentsMargins(0, 0, 0, 0)
        content_layout.setSpacing(0)

        # Top Bar
        self.top_bar = QFrame()
        self.top_bar.setObjectName("HeaderBar")
        self.top_bar.setFixedHeight(56)
        top_bar_layout = QHBoxLayout(self.top_bar)
        top_bar_layout.setContentsMargins(24, 0, 24, 0)

        self.page_title = QLabel("Fleet Dashboard")
        self.page_title.setStyleSheet("font-size: 16px; font-weight: 700;")
        top_bar_layout.addWidget(self.page_title)
        top_bar_layout.addStretch()

        # Service indicator
        srv_label = QLabel("Service:")
        srv_label.setStyleSheet("color: #888888; font-size: 12px;")
        top_bar_layout.addWidget(srv_label)

        self.top_service_badge = StatusBadge("Listening", "success")
        top_bar_layout.addWidget(self.top_service_badge)

        self.service_worker.server_started.connect(
            lambda h, p: self._set_service_badge(True, f"Port {p}")
        )
        self.service_worker.server_stopped.connect(
            lambda: self._set_service_badge(False)
        )
        self.service_worker.server_error.connect(
            lambda err: self._set_service_badge(False, "Error")
        )

        content_layout.addWidget(self.top_bar)

        # Stacked pages
        self.stack = QStackedWidget()

        # Initialize Server State via AdminServer instance
        from driver_update_assistant.server.app import AdminServer
        self.dummy_server = AdminServer(self.config)
        state = self.dummy_server.state

        self.view_dashboard = DashboardView(state.registry, state.store, state.audit, self.is_dark, self)
        self.view_devices = DevicesView(state.registry, self.is_dark, self)
        self.view_releases = ReleasesView(state.store, self.config, self.is_dark, self)
        self.view_folder = FolderAccessView(state, self.is_dark, self)
        self.view_settings = SettingsView(self.config, self.service_worker, self.is_dark, self)
        self.view_logs = LogsView(state.audit, self.is_dark, self)

        self.stack.addWidget(self.view_dashboard)
        self.stack.addWidget(self.view_devices)
        self.stack.addWidget(self.view_releases)
        self.stack.addWidget(self.view_folder)
        self.stack.addWidget(self.view_settings)
        self.stack.addWidget(self.view_logs)

        content_layout.addWidget(self.stack)
        root_layout.addWidget(content_container)

    def _set_service_badge(self, is_online: bool, text: str = "") -> None:
        if is_online:
            self.top_service_badge.setText(f"Active ({text})" if text else "Active")
            self.top_service_badge.badge_type = "success"
        else:
            self.top_service_badge.setText("Stopped")
            self.top_service_badge.badge_type = "neutral"
        self.top_service_badge.style_badge()

    def _on_nav_selected(self, index: int) -> None:
        self.stack.setCurrentIndex(index)
        titles = [
            "Fleet Dashboard",
            "Enrolled Laptops",
            "Extension Releases",
            "Authorized Folder Access",
            "Server Settings",
            "Security Audit and Diagnostics",
        ]
        if 0 <= index < len(titles):
            self.page_title.setText(titles[index])

    def toggle_theme(self) -> None:
        self.theme_manager.toggle_theme()
        self.is_dark = self.theme_manager.is_dark
        self._apply_theme()

        # Update icons
        self.theme_toggle_btn.setIcon(get_icon("sun" if self.is_dark else "moon", self.is_dark))
        self.btn_nav_dashboard.update_icon(self.is_dark)
        self.btn_nav_devices.update_icon(self.is_dark)
        self.btn_nav_releases.update_icon(self.is_dark)
        self.btn_nav_folder.update_icon(self.is_dark)
        self.btn_nav_settings.update_icon(self.is_dark)
        self.btn_nav_logs.update_icon(self.is_dark)

    def _apply_theme(self) -> None:
        qss = self.theme_manager.get_stylesheet()
        app = QApplication.instance()
        if app:
            app.setStyleSheet(qss)

    def closeEvent(self, event: QCloseEvent) -> None:
        if self.service_worker.is_running:
            self.service_worker.stop()
        event.accept()
