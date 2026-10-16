"""Renders and captures full screenshots of Server and Client GUI windows in both Light and Dark themes."""

import os
import sys
from pathlib import Path

# Ensure paths
workspace = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(workspace / "src"))

from PySide6.QtCore import QSize, Qt
from PySide6.QtGui import QFont, QPixmap
from PySide6.QtWidgets import QApplication

from driver_update_assistant.client.gui.main_window import ClientMainWindow
from driver_update_assistant.config import AgentConfig, ServerConfig
from driver_update_assistant.server.gui.main_window import ServerMainWindow

ARTIFACTS_DIR = Path(r"C:\Users\mrmki\.gemini\antigravity-ide\brain\3b57845b-3d78-4787-87a3-79259ebd345f")


def capture_widget(widget, output_path: Path):
    widget.show()
    widget.repaint()
    QApplication.processEvents()

    # Capture pixmap of the entire window
    pixmap = widget.grab()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    pixmap.save(str(output_path), "PNG")
    print(f"[OK] Saved screenshot: {output_path} ({pixmap.width()}x{pixmap.height()})")


def main():
    os.environ["QT_QPA_PLATFORM"] = "offscreen"
    app = QApplication.instance() or QApplication([])

    # In offscreen QPA mode, load Windows system fonts explicitly
    for font_file in ("segoeui.ttf", "segoeuib.ttf", "segoeuii.ttf", "consolas.ttf"):
        f_path = Path(os.environ.get("WINDIR", "C:\\Windows")) / "Fonts" / font_file
        if f_path.exists():
            from PySide6.QtGui import QFontDatabase
            QFontDatabase.addApplicationFont(str(f_path))

    font = QFont("Segoe UI", 9)
    app.setFont(font)

    # 1. Server Window (Dark Theme)
    srv_cfg = ServerConfig(
        data_dir=str(workspace / "data"),
        releases_dir=str(workspace / "releases"),
    )
    srv_win = ServerMainWindow(srv_cfg)
    srv_win.resize(1180, 780)

    # Dashboard view (Dark)
    srv_win._on_nav_selected(0)
    capture_widget(srv_win, ARTIFACTS_DIR / "server_gui_dark_dashboard.png")

    # Devices view (Dark)
    srv_win._on_nav_selected(1)
    capture_widget(srv_win, ARTIFACTS_DIR / "server_gui_dark_devices.png")

    # Folder Access view (Dark)
    srv_win._on_nav_selected(3)
    capture_widget(srv_win, ARTIFACTS_DIR / "server_gui_dark_folder_access.png")

    # Releases view (Dark)
    srv_win._on_nav_selected(2)
    capture_widget(srv_win, ARTIFACTS_DIR / "server_gui_dark_releases.png")

    # Settings view (Dark)
    srv_win._on_nav_selected(4)
    capture_widget(srv_win, ARTIFACTS_DIR / "server_gui_dark_settings.png")

    # Toggle to Light theme
    srv_win.toggle_theme()
    capture_widget(srv_win, ARTIFACTS_DIR / "server_gui_light_dashboard.png")

    srv_win.close()

    # Reset theme to dark mode for client
    import json
    with open(workspace / "data" / "theme.json", "w", encoding="utf-8") as f:
        json.dump({"dark_mode": True}, f)

    # 2. Client Window (Dark Theme)
    client_cfg = AgentConfig(
        device_id="LAPTOP-01",
        server_url="http://127.0.0.1:8088",
        data_dir=str(workspace / "data"),
        extension_dir=str(workspace.parent.resolve()),
    )
    client_win = ClientMainWindow(client_cfg)
    client_win.resize(1060, 700)

    # Home view (Dark)
    client_win._on_nav_selected(0)
    capture_widget(client_win, ARTIFACTS_DIR / "client_gui_dark_home.png")

    # Extension Updates view (Dark)
    client_win._on_nav_selected(1)
    capture_widget(client_win, ARTIFACTS_DIR / "client_gui_dark_updates.png")

    # Shared Folders view (Dark)
    client_win._on_nav_selected(2)
    capture_widget(client_win, ARTIFACTS_DIR / "client_gui_dark_shared_folders.png")

    # Folder Access view (Dark)
    client_win._on_nav_selected(3)
    capture_widget(client_win, ARTIFACTS_DIR / "client_gui_dark_folder.png")

    # Settings view (Dark)
    client_win._on_nav_selected(4)
    capture_widget(client_win, ARTIFACTS_DIR / "client_gui_dark_settings.png")

    # Toggle to Light theme
    client_win.toggle_theme()
    capture_widget(client_win, ARTIFACTS_DIR / "client_gui_light_home.png")

    client_win.close()
    print("[SUCCESS] All GUI screens rendered and captured successfully!")


if __name__ == "__main__":
    main()
