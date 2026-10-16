"""Unit tests for Server and Client GUI architecture and role separation."""

import os
import unittest
from pathlib import Path
from PySide6.QtCore import Qt
from PySide6.QtWidgets import QApplication

from driver_update_assistant.config import AgentConfig, ServerConfig
from driver_update_assistant.ui.theme import ThemeManager


class TestGuiSeparation(unittest.TestCase):
    """Verifies strict separation between Server and Client applications."""

    @classmethod
    def setUpClass(cls):
        # Create offscreen QApplication for testing widgets without displaying windows
        os.environ["QT_QPA_PLATFORM"] = "offscreen"
        if not QApplication.instance():
            cls.app = QApplication([])
        else:
            cls.app = QApplication.instance()

    def test_theme_manager_tokens_and_stylesheet(self):
        tmp_dir = Path("data/test_theme")
        tmp_dir.mkdir(parents=True, exist_ok=True)
        mgr = ThemeManager(str(tmp_dir))

        dark_qss = mgr.get_stylesheet(force_dark=True)
        self.assertIn("QMainWindow", dark_qss)
        self.assertIn("#Sidebar", dark_qss)
        self.assertIn("background-color: #121417", dark_qss)

        light_qss = mgr.get_stylesheet(force_dark=False)
        self.assertIn("QMainWindow", light_qss)
        self.assertIn("background-color: #FFFFFF", light_qss)

    def test_server_main_window_instantiation(self):
        from driver_update_assistant.server.gui.main_window import ServerMainWindow

        cfg = ServerConfig(
            data_dir="data/test_srv_gui",
            releases_dir="releases/test_srv_gui",
            secret_key="test-key-32-chars-long-here-abc",
        )
        win = ServerMainWindow(cfg)
        self.assertIn("Management Console (Server)", win.windowTitle())
        self.assertEqual(win.stack.count(), 6)

        # Test view switching
        win._on_nav_selected(1)
        self.assertEqual(win.stack.currentIndex(), 1)
        self.assertEqual(win.page_title.text(), "Enrolled Laptops")

        win._on_nav_selected(2)
        self.assertEqual(win.stack.currentIndex(), 2)
        self.assertEqual(win.page_title.text(), "Extension Releases")

        win._on_nav_selected(3)
        self.assertEqual(win.stack.currentIndex(), 3)
        self.assertEqual(win.page_title.text(), "Authorized Folder Access")

        # Clean close
        win.close()

    def test_client_main_window_instantiation(self):
        from driver_update_assistant.client.gui.main_window import ClientMainWindow

        cfg = AgentConfig(
            device_id="TEST-LAPTOP",
            server_url="http://127.0.0.1:8088",
            data_dir="data/test_client_gui",
        )
        win = ClientMainWindow(cfg)
        self.assertIn("Client (Employee)", win.windowTitle())
        self.assertEqual(win.stack.count(), 5)

        # Test view switching
        win._on_nav_selected(1)
        self.assertEqual(win.stack.currentIndex(), 1)
        self.assertEqual(win.page_title.text(), "Extension Updates and Version Management")

        win._on_nav_selected(2)
        self.assertEqual(win.stack.currentIndex(), 2)
        self.assertEqual(win.page_title.text(), "Configured Shared Folders")

        win._on_nav_selected(3)
        self.assertEqual(win.stack.currentIndex(), 3)
        self.assertEqual(win.page_title.text(), "Authorized Remote Folder Access")

        # Verify Client UI does not have Server administration tabs
        self.assertFalse(hasattr(win, "view_devices"))
        self.assertFalse(hasattr(win, "view_releases"))
        self.assertTrue(hasattr(win, "view_shared_folders"))

        win.close()


if __name__ == "__main__":
    unittest.main()
