"""Client GUI Settings and Diagnostics view.

Allows the employee to configure the central server endpoint, test connectivity,
review device enrollment identity, and export a sanitized diagnostics report.
"""

import json
import time
import urllib.request
from typing import Optional
from PySide6.QtCore import Qt
from PySide6.QtWidgets import (
    QFileDialog,
    QFormLayout,
    QFrame,
    QGroupBox,
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QMessageBox,
    QPushButton,
    QVBoxLayout,
    QWidget,
)

from driver_update_assistant.client.service import ClientManager
from driver_update_assistant.config import get_project_root
from driver_update_assistant.ui.icons import get_icon
from driver_update_assistant.ui.widgets import StatusBadge


class SettingsView(QWidget):
    """Client Configuration and Diagnostics Support View."""

    def __init__(
        self,
        manager: ClientManager,
        is_dark: bool = True,
        parent: Optional[QWidget] = None,
    ):
        super().__init__(parent)
        self.manager = manager
        self.is_dark = is_dark

        self._setup_ui()

    def _setup_ui(self) -> None:
        main_layout = QVBoxLayout(self)
        main_layout.setContentsMargins(24, 20, 24, 20)
        main_layout.setSpacing(20)

        # Header
        header_row = QHBoxLayout()
        title = QLabel("Client Settings and Diagnostics")
        title.setStyleSheet("font-size: 18px; font-weight: 700;")
        header_row.addWidget(title)
        header_row.addStretch()

        self.btn_export = QPushButton("Export Diagnostic Report")
        self.btn_export.setIcon(get_icon("download", self.is_dark))
        self.btn_export.clicked.connect(self.on_export_diagnostics)
        header_row.addWidget(self.btn_export)

        main_layout.addLayout(header_row)

        desc = QLabel(
            "Configure LAN connection endpoints, test central server connectivity, "
            "and inspect local device enrollment details."
        )
        desc.setWordWrap(True)
        desc.setStyleSheet("color: #888888; font-size: 12px;")
        main_layout.addWidget(desc)

        # 1. Connection Group
        conn_group = QGroupBox("Central Administrator Connection")
        conn_form = QFormLayout(conn_group)
        conn_form.setSpacing(12)

        server_row = QHBoxLayout()
        self.server_url_input = QLineEdit(self.manager.config.server_url)
        self.server_url_input.setPlaceholderText("http://192.168.1.100:8088")
        server_row.addWidget(self.server_url_input)

        self.btn_test = QPushButton("Test Connection")
        self.btn_test.setIcon(get_icon("refresh", self.is_dark))
        self.btn_test.clicked.connect(self.on_test_connection)
        server_row.addWidget(self.btn_test)

        conn_form.addRow("Server URL / LAN IP:", server_row)

        self.lbl_test_result = QLabel("Not tested recently")
        self.lbl_test_result.setStyleSheet("color: #888888; font-size: 12px;")
        conn_form.addRow("Connection Diagnostic:", self.lbl_test_result)

        main_layout.addWidget(conn_group)

        # 2. Device Identity Group
        dev_group = QGroupBox("Device Enrollment and Security")
        dev_form = QFormLayout(dev_group)
        dev_form.setSpacing(12)

        self.lbl_dev_id = QLabel(self.manager.config.device_id)
        self.lbl_dev_id.setStyleSheet("font-weight: 700;")
        dev_form.addRow("Device Identifier:", self.lbl_dev_id)

        token_row = QHBoxLayout()
        self.token_input = QLineEdit(self.manager.config.device_token)
        self.token_input.setEchoMode(QLineEdit.Password)
        self.token_toggle_btn = QPushButton("Show")
        self.token_toggle_btn.setFixedWidth(60)
        self.token_toggle_btn.clicked.connect(self.toggle_token_visibility)
        token_row.addWidget(self.token_input)
        token_row.addWidget(self.token_toggle_btn)
        dev_form.addRow("Enrollment Token:", token_row)

        self.lbl_ext_path = QLabel(self.manager.config.extension_dir or "Default root")
        self.lbl_ext_path.setStyleSheet("font-family: 'Consolas'; font-size: 11px;")
        dev_form.addRow("Extension Directory:", self.lbl_ext_path)

        main_layout.addWidget(dev_group)

        # 3. Save Settings Button
        btn_row = QHBoxLayout()
        btn_row.addStretch()

        self.btn_save = QPushButton("Save Settings")
        self.btn_save.setProperty("class", "primary")
        self.btn_save.setIcon(get_icon("check", self.is_dark))
        self.btn_save.clicked.connect(self.on_save_settings)
        btn_row.addWidget(self.btn_save)

        main_layout.addLayout(btn_row)
        main_layout.addStretch()

    def toggle_token_visibility(self) -> None:
        if self.token_input.echoMode() == QLineEdit.Password:
            self.token_input.setEchoMode(QLineEdit.Normal)
            self.token_toggle_btn.setText("Hide")
        else:
            self.token_input.setEchoMode(QLineEdit.Password)
            self.token_toggle_btn.setText("Show")

    def on_test_connection(self) -> None:
        raw_url = self.server_url_input.text().strip().rstrip("/")
        if not raw_url:
            QMessageBox.warning(self, "Invalid URL", "Please enter a valid server URL.")
            return

        self.lbl_test_result.setText("Testing connectivity...")
        self.btn_test.setEnabled(False)

        try:
            health_url = f"{raw_url}/api/v1/health"
            req = urllib.request.Request(health_url)
            with urllib.request.urlopen(req, timeout=4.0) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                if data.get("status") == "ok":
                    self.lbl_test_result.setText("Successfully reached server health endpoint (HTTP 200 OK)")
                    self.lbl_test_result.setStyleSheet("color: #4CAF50; font-weight: 600;")
                else:
                    self.lbl_test_result.setText(f"Connected, but unexpected response: {data}")
                    self.lbl_test_result.setStyleSheet("color: #FBBC04;")
        except Exception as e:
            self.lbl_test_result.setText(f"Connection failed: {str(e)}")
            self.lbl_test_result.setStyleSheet("color: #EA4335;")
        finally:
            self.btn_test.setEnabled(True)

    def on_save_settings(self) -> None:
        new_url = self.server_url_input.text().strip().rstrip("/")
        new_token = self.token_input.text().strip()

        if not new_url:
            QMessageBox.warning(self, "Invalid URL", "Server URL cannot be empty.")
            return

        self.manager.config.server_url = new_url
        self.manager.config.device_token = new_token

        # Save to agent.toml
        project_root = get_project_root()
        config_path = project_root / "config" / "agent.toml"
        try:
            content = (
                f"[agent]\n"
                f'device_id = "{self.manager.config.device_id}"\n'
                f'server_url = "{self.manager.config.server_url}"\n'
                f'device_token = "{self.manager.config.device_token}"\n'
                f'extension_dir = "{self.manager.config.extension_dir}"\n'
                f'data_dir = "{self.manager.config.data_dir}"\n'
                f'log_dir = "{self.manager.config.log_dir}"\n'
                f"check_interval_seconds = {self.manager.config.check_interval_seconds}\n\n"
                f"[updater]\n"
                f"max_package_size_bytes = {self.manager.config.max_package_size_bytes}\n"
                f'public_key_path = "{self.manager.config.public_key_path}"\n'
                f'verification_secret = "{self.manager.config.verification_secret}"\n'
                f'staging_dir = "{self.manager.config.staging_dir}"\n'
                f'backup_dir = "{self.manager.config.backup_dir}"\n'
                f"activation_timeout_seconds = {self.manager.config.activation_timeout_seconds}\n\n"
                f"[folder_access]\n"
                f"default_lease_minutes = {self.manager.config.default_lease_minutes}\n"
                f"max_lease_minutes = {self.manager.config.max_lease_minutes}\n"
                f"otp_length = {self.manager.config.otp_length}\n"
                f"otp_ttl_seconds = {self.manager.config.otp_ttl_seconds}\n"
            )
            with open(config_path, "w", encoding="utf-8") as f:
                f.write(content)
            QMessageBox.information(self, "Settings Saved", "Client settings saved successfully to agent.toml.")
        except Exception as e:
            QMessageBox.critical(self, "Save Failed", f"Failed to save agent.toml:\n{str(e)}")

    def on_export_diagnostics(self) -> None:
        path, _ = QFileDialog.getSaveFileName(
            self,
            "Export Client Diagnostics",
            f"Client_Diagnostics_{self.manager.config.device_id}_{int(time.time())}.json",
            "JSON Files (*.json)",
        )
        if not path:
            return

        try:
            journal = self.manager.client.read_journal()
            outbox_reports = self.manager.client.outbox.get_pending_reports()
            installed_ver = self.manager.client.get_installed_extension_version()

            report = {
                "device_id": self.manager.config.device_id,
                "server_url": self.manager.config.server_url,
                "installed_extension_version": installed_ver,
                "timestamp": time.time(),
                "journal_state": journal.to_dict() if journal else None,
                "pending_telemetry_count": len(outbox_reports),
                "active_folder_sessions": [s.to_dict() for s in self.manager.session_store.get_active_sessions()],
            }

            with open(path, "w", encoding="utf-8") as f:
                json.dump(report, f, indent=2)

            QMessageBox.information(self, "Report Exported", f"Client diagnostics exported to:\n{path}")
        except Exception as e:
            QMessageBox.critical(self, "Export Failed", f"Failed to export diagnostics:\n{str(e)}")
