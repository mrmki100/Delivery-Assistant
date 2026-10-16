"""Server GUI Settings and Service Management view.

Provides controls for configuring LAN host/port, managing the background service
(Start / Stop / Restart), setting security & enrollment policies, and inspecting
storage directories and signing keys.
"""

import os
import socket
import subprocess
from typing import List, Optional
from PySide6.QtCore import Qt
from PySide6.QtWidgets import (
    QCheckBox,
    QFileDialog,
    QFormLayout,
    QFrame,
    QGroupBox,
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QMessageBox,
    QPushButton,
    QSpinBox,
    QVBoxLayout,
    QWidget,
)

from driver_update_assistant.config import ServerConfig, get_project_root
from driver_update_assistant.server.service import ServerServiceWorker
from driver_update_assistant.ui.icons import get_icon
from driver_update_assistant.ui.widgets import StatusBadge


def get_local_ip_addresses() -> List[str]:
    """Discovers available LAN IP addresses on the machine."""
    ips = []
    try:
        hostname = socket.gethostname()
        for ip in socket.gethostbyname_ex(hostname)[2]:
            if not ip.startswith("127."):
                ips.append(ip)
    except Exception:
        pass
    if not ips:
        ips.append("127.0.0.1")
    return ips


class SettingsView(QWidget):
    """Server Configuration and Background Service Control View."""

    def __init__(
        self,
        config: ServerConfig,
        worker: ServerServiceWorker,
        is_dark: bool = True,
        parent: Optional[QWidget] = None,
    ):
        super().__init__(parent)
        self.config = config
        self.worker = worker
        self.is_dark = is_dark

        self._setup_ui()
        self._update_service_status()

        # Connect worker signals
        self.worker.server_started.connect(self._on_server_started)
        self.worker.server_stopped.connect(self._on_server_stopped)
        self.worker.server_error.connect(self._on_server_error)

    def _setup_ui(self) -> None:
        main_layout = QVBoxLayout(self)
        main_layout.setContentsMargins(24, 20, 24, 20)
        main_layout.setSpacing(20)

        # Header
        header_row = QHBoxLayout()
        title = QLabel("Server Configuration and Service Management")
        title.setStyleSheet("font-size: 18px; font-weight: 700;")
        header_row.addWidget(title)
        header_row.addStretch()
        main_layout.addLayout(header_row)

        desc = QLabel(
            "Manage the central administrator service listening on the local network. "
            "Configure LAN endpoints, device enrollment requirements, and storage locations."
        )
        desc.setWordWrap(True)
        desc.setStyleSheet("color: #888888; font-size: 12px;")
        main_layout.addWidget(desc)

        # 1. Service Control Section
        service_group = QGroupBox("Central Service Status")
        service_layout = QVBoxLayout(service_group)
        service_layout.setSpacing(12)

        status_row = QHBoxLayout()
        status_lbl = QLabel("Service Status:")
        status_lbl.setStyleSheet("font-weight: 600;")
        status_row.addWidget(status_lbl)

        self.service_badge = StatusBadge("Stopped", "neutral")
        status_row.addWidget(self.service_badge)
        status_row.addStretch()

        self.btn_start = QPushButton("Start Service")
        self.btn_start.setProperty("class", "primary")
        self.btn_start.setIcon(get_icon("server", self.is_dark))
        self.btn_start.clicked.connect(self.on_start_service)
        status_row.addWidget(self.btn_start)

        self.btn_stop = QPushButton("Stop Service")
        self.btn_stop.setProperty("class", "danger")
        self.btn_stop.clicked.connect(self.on_stop_service)
        status_row.addWidget(self.btn_stop)

        service_layout.addLayout(status_row)

        # LAN discovery info
        local_ips = get_local_ip_addresses()
        lan_info = ", ".join([f"http://{ip}:{self.config.port}" for ip in local_ips])
        self.lbl_lan = QLabel(f"LAN Endpoint(s) for Client configuration:  <b>{lan_info}</b>")
        self.lbl_lan.setStyleSheet("font-size: 12px; color: #4CAF50;")
        service_layout.addWidget(self.lbl_lan)

        main_layout.addWidget(service_group)

        # 2. Network and Listening Parameters
        net_group = QGroupBox("Network and Binding")
        net_form = QFormLayout(net_group)
        net_form.setSpacing(10)

        self.host_input = QLineEdit(self.config.host)
        self.host_input.setPlaceholderText("0.0.0.0 or 127.0.0.1")
        net_form.addRow("Listening Host / Interface:", self.host_input)

        self.port_spin = QSpinBox()
        self.port_spin.setRange(1024, 65535)
        self.port_spin.setValue(self.config.port)
        net_form.addRow("Listening Port:", self.port_spin)

        main_layout.addWidget(net_group)

        # 3. Security and Policy Settings
        sec_group = QGroupBox("Security and Access Policies")
        sec_form = QFormLayout(sec_group)
        sec_form.setSpacing(10)

        self.chk_enrollment = QCheckBox("Require explicit device pre-enrollment (Zero-Trust)")
        self.chk_enrollment.setChecked(self.config.require_device_enrollment)
        sec_form.addRow("Device Policy:", self.chk_enrollment)

        self.otp_attempts_spin = QSpinBox()
        self.otp_attempts_spin.setRange(1, 10)
        self.otp_attempts_spin.setValue(self.config.max_otp_attempts)
        sec_form.addRow("Max OTP Verification Attempts:", self.otp_attempts_spin)

        self.otp_ttl_spin = QSpinBox()
        self.otp_ttl_spin.setRange(60, 3600)
        self.otp_ttl_spin.setValue(self.config.otp_ttl_seconds)
        self.otp_ttl_spin.setSuffix(" seconds")
        sec_form.addRow("OTP Code Validity (TTL):", self.otp_ttl_spin)

        self.secret_input = QLineEdit(self.config.secret_key)
        self.secret_input.setEchoMode(QLineEdit.Password)
        self.secret_toggle_btn = QPushButton("Show")
        self.secret_toggle_btn.setFixedWidth(60)
        self.secret_toggle_btn.clicked.connect(self.toggle_secret_visibility)

        secret_row = QHBoxLayout()
        secret_row.addWidget(self.secret_input)
        secret_row.addWidget(self.secret_toggle_btn)
        sec_form.addRow("Server Master Secret:", secret_row)

        main_layout.addWidget(sec_group)

        # 4. Storage Directories
        storage_group = QGroupBox("Storage and Key Management")
        storage_form = QFormLayout(storage_group)
        storage_form.setSpacing(10)

        data_row = QHBoxLayout()
        self.data_dir_lbl = QLabel(self.config.data_dir)
        self.data_dir_lbl.setStyleSheet("font-family: 'Consolas'; font-size: 11px;")
        btn_open_data = QPushButton("Open")
        btn_open_data.setFixedWidth(60)
        btn_open_data.clicked.connect(lambda: self._open_dir(self.config.data_dir))
        data_row.addWidget(self.data_dir_lbl)
        data_row.addWidget(btn_open_data)
        storage_form.addRow("Data and Registry Directory:", data_row)

        rel_row = QHBoxLayout()
        self.rel_dir_lbl = QLabel(self.config.releases_dir)
        self.rel_dir_lbl.setStyleSheet("font-family: 'Consolas'; font-size: 11px;")
        btn_open_rel = QPushButton("Open")
        btn_open_rel.setFixedWidth(60)
        btn_open_rel.clicked.connect(lambda: self._open_dir(self.config.releases_dir))
        rel_row.addWidget(self.rel_dir_lbl)
        rel_row.addWidget(btn_open_rel)
        storage_form.addRow("Releases Repository:", rel_row)

        main_layout.addWidget(storage_group)

        # Save actions
        btn_row = QHBoxLayout()
        btn_row.addStretch()

        self.btn_save = QPushButton("Save Configuration")
        self.btn_save.setProperty("class", "primary")
        self.btn_save.setIcon(get_icon("check", self.is_dark))
        self.btn_save.clicked.connect(self.on_save_config)
        btn_row.addWidget(self.btn_save)

        main_layout.addLayout(btn_row)
        main_layout.addStretch()

    def toggle_secret_visibility(self) -> None:
        if self.secret_input.echoMode() == QLineEdit.Password:
            self.secret_input.setEchoMode(QLineEdit.Normal)
            self.secret_toggle_btn.setText("Hide")
        else:
            self.secret_input.setEchoMode(QLineEdit.Password)
            self.secret_toggle_btn.setText("Show")

    def _open_dir(self, directory: str) -> None:
        if os.path.exists(directory):
            os.startfile(directory)
        else:
            QMessageBox.warning(self, "Directory Not Found", f"Directory does not exist yet:\n{directory}")

    def _update_service_status(self) -> None:
        is_running = self.worker.is_running
        if is_running:
            self.service_badge.setText("Active / Listening")
            self.service_badge.badge_type = "success"
            self.service_badge.style_badge()
            self.btn_start.setEnabled(False)
            self.btn_stop.setEnabled(True)
        else:
            self.service_badge.setText("Stopped")
            self.service_badge.badge_type = "neutral"
            self.service_badge.style_badge()
            self.btn_start.setEnabled(True)
            self.btn_stop.setEnabled(False)

    def on_start_service(self) -> None:
        if not self.worker.is_running:
            self.worker.start()
            self._update_service_status()

    def on_stop_service(self) -> None:
        if self.worker.is_running:
            self.worker.stop()
            self._update_service_status()

    def _on_server_started(self, host: str, port: int) -> None:
        self._update_service_status()

    def _on_server_stopped(self) -> None:
        self._update_service_status()

    def _on_server_error(self, err_msg: str) -> None:
        self._update_service_status()
        QMessageBox.critical(self, "Server Service Error", f"Failed to start service:\n{err_msg}")

    def on_save_config(self) -> None:
        host = self.host_input.text().strip()
        port = self.port_spin.value()
        if not host:
            QMessageBox.warning(self, "Invalid Host", "Host address cannot be empty.")
            return

        self.config.host = host
        self.config.port = port
        self.config.require_device_enrollment = self.chk_enrollment.isChecked()
        self.config.max_otp_attempts = self.otp_attempts_spin.value()
        self.config.otp_ttl_seconds = self.otp_ttl_spin.value()
        self.config.secret_key = self.secret_input.text().strip()

        # Update config file
        project_root = get_project_root()
        config_path = project_root / "config" / "server.toml"
        try:
            content = (
                f"[server]\n"
                f'host = "{self.config.host}"\n'
                f"port = {self.config.port}\n"
                f'data_dir = "{self.config.data_dir}"\n'
                f'releases_dir = "{self.config.releases_dir}"\n'
                f'secret_key = "{self.config.secret_key}"\n'
                f'signing_key_path = "{self.config.signing_key_path}"\n'
                f'public_key_path = "{self.config.public_key_path}"\n\n'
                f"[security]\n"
                f"require_device_enrollment = {'true' if self.config.require_device_enrollment else 'false'}\n"
                f"max_otp_attempts = {self.config.max_otp_attempts}\n"
                f"otp_ttl_seconds = {self.config.otp_ttl_seconds}\n"
                f"rate_limit_requests_per_minute = {self.config.rate_limit_requests_per_minute}\n"
            )
            with open(config_path, "w", encoding="utf-8") as f:
                f.write(content)
            QMessageBox.information(
                self,
                "Settings Saved",
                "Server configuration saved successfully.\nIf network ports were changed, restart the service to apply.",
            )
        except Exception as e:
            QMessageBox.critical(self, "Save Failed", f"Failed to save server.toml:\n{str(e)}")
