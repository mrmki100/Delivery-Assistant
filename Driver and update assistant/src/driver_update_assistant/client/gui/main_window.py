"""Client GUI Main Window.

Assembles the Employee Client application:
- Navigation sidebar (Home, Extension Updates, Folder Access, Settings & Support)
- Persistent light/dark theme toggle
- Background update and folder access monitoring
- Zero-trust employee consent UI
"""

from typing import Optional
from PySide6.QtCore import Qt
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

from driver_update_assistant.client.gui.folder_access_view import FolderAccessView
from driver_update_assistant.client.gui.home_view import HomeView
from driver_update_assistant.client.gui.settings_view import SettingsView
from driver_update_assistant.client.gui.shared_folders_view import SharedFoldersView
from driver_update_assistant.client.gui.updates_view import UpdatesView
from driver_update_assistant.client.service import ClientManager
from driver_update_assistant.config import AgentConfig
from driver_update_assistant.ui.icons import get_icon
from driver_update_assistant.ui.theme import ThemeManager
from driver_update_assistant.ui.widgets import NavButton, StatusBadge


class ClientMainWindow(QMainWindow):
    """Primary Employee Client application window."""

    def __init__(self, config: AgentConfig, parent: Optional[QWidget] = None):
        super().__init__(parent)
        self.config = config
        self.theme_manager = ThemeManager(config.data_dir)
        self.is_dark = self.theme_manager.is_dark

        self.setWindowTitle("Delivery Assistant - Client (Employee)")
        self.setMinimumSize(980, 640)
        self.resize(1060, 700)

        # Background client coordinator
        self.manager = ClientManager(config, self)

        self._setup_ui()
        self._apply_theme()

    def _setup_ui(self) -> None:
        central_widget = QWidget(self)
        self.setCentralWidget(central_widget)

        root_layout = QHBoxLayout(central_widget)
        root_layout.setContentsMargins(0, 0, 0, 0)
        root_layout.setSpacing(0)

        # 1. Left Navigation Sidebar
        self.sidebar = QFrame()
        self.sidebar.setObjectName("Sidebar")
        self.sidebar.setFixedWidth(230)
        sidebar_layout = QVBoxLayout(self.sidebar)
        sidebar_layout.setContentsMargins(16, 20, 16, 20)
        sidebar_layout.setSpacing(8)

        # Brand header
        brand_row = QHBoxLayout()
        brand_icon = QLabel()
        brand_icon.setPixmap(get_icon("shield", self.is_dark).pixmap(24, 24))
        brand_row.addWidget(brand_icon)

        brand_lbl = QLabel("Delivery Assistant")
        brand_lbl.setStyleSheet("font-size: 15px; font-weight: 700; letter-spacing: -0.2px;")
        brand_row.addWidget(brand_lbl)
        brand_row.addStretch()
        sidebar_layout.addLayout(brand_row)

        role_badge = QLabel("EMPLOYEE CLIENT")
        role_badge.setStyleSheet(
            "font-size: 10px; font-weight: 700; color: #2196F3; letter-spacing: 1px; margin-bottom: 12px;"
        )
        sidebar_layout.addWidget(role_badge)

        # Navigation buttons
        self.nav_group = QButtonGroup(self)
        self.nav_group.setExclusive(True)

        self.btn_nav_home = NavButton("Home Overview", "dashboard", self.is_dark)
        self.btn_nav_updates = NavButton("Extension Updates", "releases", self.is_dark)
        self.btn_nav_shared_folders = NavButton("Shared Folders", "folder", self.is_dark)
        self.btn_nav_folder = NavButton("Folder Access", "shield", self.is_dark)
        self.btn_nav_settings = NavButton("Settings and Support", "settings", self.is_dark)

        nav_buttons = [
            (self.btn_nav_home, 0),
            (self.btn_nav_updates, 1),
            (self.btn_nav_shared_folders, 2),
            (self.btn_nav_folder, 3),
            (self.btn_nav_settings, 4),
        ]

        for btn, idx in nav_buttons:
            btn.setFixedHeight(40)
            self.nav_group.addButton(btn, idx)
            sidebar_layout.addWidget(btn)

        self.btn_nav_home.setChecked(True)
        self.nav_group.idClicked.connect(self._on_nav_selected)

        sidebar_layout.addStretch()

        # Theme toggle
        self.theme_toggle_btn = QPushButton("Toggle Theme")
        self.theme_toggle_btn.setIcon(get_icon("sun" if self.is_dark else "moon", self.is_dark))
        self.theme_toggle_btn.clicked.connect(self.toggle_theme)
        sidebar_layout.addWidget(self.theme_toggle_btn)

        dev_lbl = QLabel(f"{self.config.device_id} • v2.1.0")
        dev_lbl.setStyleSheet("color: #777777; font-size: 11px;")
        dev_lbl.setAlignment(Qt.AlignCenter)
        sidebar_layout.addWidget(dev_lbl)

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

        self.page_title = QLabel("System Status and Overview")
        self.page_title.setStyleSheet("font-size: 16px; font-weight: 700;")
        top_bar_layout.addWidget(self.page_title)
        top_bar_layout.addStretch()

        dev_badge = StatusBadge(self.config.device_id, "info")
        top_bar_layout.addWidget(dev_badge)

        content_layout.addWidget(self.top_bar)

        # Stacked pages
        self.stack = QStackedWidget()

        self.view_home = HomeView(self.manager, self.is_dark, self)
        self.view_updates = UpdatesView(self.manager, self.is_dark, self)
        self.view_shared_folders = SharedFoldersView(self.manager, self.is_dark, self)
        self.view_folder = FolderAccessView(self.manager, self.is_dark, self)
        self.view_settings = SettingsView(self.manager, self.is_dark, self)

        self.stack.addWidget(self.view_home)
        self.stack.addWidget(self.view_updates)
        self.stack.addWidget(self.view_shared_folders)
        self.stack.addWidget(self.view_folder)
        self.stack.addWidget(self.view_settings)

        content_layout.addWidget(self.stack)
        root_layout.addWidget(content_container)

    def _on_nav_selected(self, index: int) -> None:
        self.stack.setCurrentIndex(index)
        titles = [
            "System Status and Overview",
            "Extension Updates and Version Management",
            "Configured Shared Folders",
            "Authorized Remote Folder Access",
            "Client Settings and Diagnostics",
        ]

        if 0 <= index < len(titles):
            self.page_title.setText(titles[index])

    def toggle_theme(self) -> None:
        self.theme_manager.toggle_theme()
        self.is_dark = self.theme_manager.is_dark
        self._apply_theme()

        self.theme_toggle_btn.setIcon(get_icon("sun" if self.is_dark else "moon", self.is_dark))
        self.btn_nav_home.update_icon(self.is_dark)
        self.btn_nav_updates.update_icon(self.is_dark)
        self.btn_nav_shared_folders.update_icon(self.is_dark)
        self.btn_nav_folder.update_icon(self.is_dark)
        self.btn_nav_settings.update_icon(self.is_dark)
        self.view_shared_folders.update_theme(self.is_dark)
        self.view_folder.update_theme(self.is_dark)

    def _apply_theme(self) -> None:
        qss = self.theme_manager.get_stylesheet()
        app = QApplication.instance()
        if app:
            app.setStyleSheet(qss)
