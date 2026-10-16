"""Client Application Entry Point.

Launches the dedicated Employee Client GUI application
for Chrome extension update monitoring, diagnostics, and zero-trust
folder access consent. Also serves as the Chrome Native Messaging host
when invoked with --native-host.
"""

import sys
from driver_update_assistant.config import load_agent_config


def main() -> int:
    """Primary application entry point for the Client."""
    # Handle Chrome Native Messaging Host invocation
    # Chrome launches native hosts with arguments: chrome-extension://<ext_id>/ --parent-window=<hwnd>
    if "--native-host" in sys.argv or any(arg.startswith("chrome-extension://") for arg in sys.argv):
        from driver_update_assistant.native_messaging.host import run_native_host
        run_native_host()
        return 0

    if sys.stdout and hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    if sys.stderr and hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")

    from PySide6.QtCore import Qt
    from PySide6.QtGui import QFont
    from PySide6.QtWidgets import QApplication
    from driver_update_assistant.client.gui.main_window import ClientMainWindow

    QApplication.setHighDpiScaleFactorRoundingPolicy(
        Qt.HighDpiScaleFactorRoundingPolicy.PassThrough
    )

    app = QApplication(sys.argv)
    app.setApplicationName("Delivery Assistant - Employee Client")
    app.setOrganizationName("Automoby Delivery Assistant")

    font = QFont("Segoe UI", 9)
    font.setStyleHint(QFont.SansSerif)
    app.setFont(font)

    # Load employee agent configuration
    config = load_agent_config()

    # Launch GUI
    window = ClientMainWindow(config)
    window.show()

    return app.exec()


if __name__ == "__main__":
    sys.exit(main())
