"""Server Application Entry Point.

Launches the dedicated Administrator Server GUI management console
for fleet oversight, release publishing, zero-trust device enrollment,
and authorized folder access sessions.
"""

import sys
from PySide6.QtCore import Qt
from PySide6.QtGui import QFont
from PySide6.QtWidgets import QApplication

from driver_update_assistant.config import load_server_config
from driver_update_assistant.server.gui.main_window import ServerMainWindow


def main() -> int:
    """Primary application entry point for the Server."""
    # Ensure Windows console encoding is clean
    if sys.stdout and hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    if sys.stderr and hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")

    # High-DPI attributes
    QApplication.setHighDpiScaleFactorRoundingPolicy(
        Qt.HighDpiScaleFactorRoundingPolicy.PassThrough
    )

    app = QApplication(sys.argv)
    app.setApplicationName("Delivery Assistant - Server Console")
    app.setOrganizationName("Automoby Delivery Assistant")

    # Set modern default typography (Segoe UI / Fluent system font)
    font = QFont("Segoe UI", 9)
    font.setStyleHint(QFont.SansSerif)
    app.setFont(font)

    # Load administrator server configuration
    config = load_server_config()

    # Launch GUI
    window = ServerMainWindow(config)
    window.show()

    return app.exec()


if __name__ == "__main__":
    sys.exit(main())
