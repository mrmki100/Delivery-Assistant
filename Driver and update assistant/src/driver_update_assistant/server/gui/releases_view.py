"""Server GUI Releases view for publishing, signing, and managing extension versions."""

import json
import time
from pathlib import Path
from typing import Optional
from PySide6.QtCore import Qt
from PySide6.QtWidgets import (
    QDialog,
    QFileDialog,
    QFormLayout,
    QFrame,
    QHBoxLayout,
    QHeaderView,
    QLabel,
    QLineEdit,
    QMessageBox,
    QPlainTextEdit,
    QPushButton,
    QTableWidget,
    QTableWidgetItem,
    QVBoxLayout,
    QWidget,
)

from driver_update_assistant.config import ServerConfig
from driver_update_assistant.server.release_store import ReleaseStore


class PublishReleaseDialog(QDialog):
    """Dialog to package, validate, sign, and publish a new extension release."""

    def __init__(self, store: ReleaseStore, secret_key: str, parent: Optional[QWidget] = None):
        super().__init__(parent)
        self.store = store
        self.secret_key = secret_key
        self.setWindowTitle("Publish New Extension Release")
        self.setFixedSize(540, 420)

        layout = QVBoxLayout(self)
        layout.setSpacing(14)

        form = QFormLayout()

        # 1. Source Directory Selector
        dir_layout = QHBoxLayout()
        self.source_dir_edit = QLineEdit()
        self.source_dir_edit.setPlaceholderText("Select extension folder containing manifest.json")
        self.source_dir_edit.textChanged.connect(self._inspect_source_dir)
        dir_layout.addWidget(self.source_dir_edit)

        browse_btn = QPushButton("Browse...")
        browse_btn.clicked.connect(self._browse_dir)
        dir_layout.addWidget(browse_btn)
        form.addRow("Source Folder:", dir_layout)

        # 2. Detected Version
        self.version_lbl = QLabel("— (Select folder to detect)")
        self.version_lbl.setStyleSheet("font-weight: 600; color: #3399FF;")
        form.addRow("Detected Version:", self.version_lbl)

        # 3. Release Notes
        self.notes_edit = QPlainTextEdit()
        self.notes_edit.setPlaceholderText("Enter changelog or operational release notes...")
        self.notes_edit.setMaximumHeight(100)
        form.addRow("Release Notes:", self.notes_edit)

        layout.addLayout(form)

        # Status text
        self.status_lbl = QLabel("")
        self.status_lbl.setStyleSheet("color: #8C939A; font-size: 11px;")
        layout.addWidget(self.status_lbl)

        # Action Buttons
        btn_layout = QHBoxLayout()
        btn_layout.addStretch()

        cancel_btn = QPushButton("Cancel")
        cancel_btn.clicked.connect(self.reject)
        btn_layout.addWidget(cancel_btn)

        self.publish_btn = QPushButton("Publish and Sign Release")
        self.publish_btn.setObjectName("PrimaryBtn")
        self.publish_btn.setEnabled(False)
        self.publish_btn.clicked.connect(self._publish)
        btn_layout.addWidget(self.publish_btn)

        layout.addLayout(btn_layout)

        self.detected_version = None

    def _browse_dir(self) -> None:
        chosen = QFileDialog.getExistingDirectory(self, "Select Extension Source Directory")
        if chosen:
            self.source_dir_edit.setText(chosen)

    def _inspect_source_dir(self, path_str: str) -> None:
        p = Path(path_str)
        manifest_file = p / "manifest.json"
        if p.is_dir() and manifest_file.is_file():
            try:
                with open(manifest_file, "r", encoding="utf-8") as f:
                    manifest_data = json.load(f)
                ver = manifest_data.get("version")
                if ver:
                    self.detected_version = str(ver)
                    self.version_lbl.setText(f"v{ver} (Valid Manifest V{manifest_data.get('manifest_version', 3)})")
                    self.publish_btn.setEnabled(True)
                    self.status_lbl.setText("Folder validated. Ready to package.")
                    return
            except Exception as e:
                self.status_lbl.setText(f"Failed to read manifest: {str(e)}")

        self.detected_version = None
        self.version_lbl.setText("— (Invalid or missing manifest.json)")
        self.publish_btn.setEnabled(False)

    def _publish(self) -> None:
        if not self.detected_version:
            return

        src_dir = self.source_dir_edit.text().strip()
        notes = self.notes_edit.toPlainText().strip()

        try:
            meta, zip_path = self.store.publish_release(
                version=self.detected_version,
                source_dir=src_dir,
                secret_key=self.secret_key,
                notes=notes,
            )
            QMessageBox.information(
                self,
                "Release Published",
                f"Release v{meta.version} published successfully!\n\n"
                f"Package SHA-256:\n{meta.package_sha256[:32]}...\n\n"
                f"Signature:\n{meta.signature[:32]}...",
            )
            self.accept()
        except Exception as e:
            QMessageBox.critical(self, "Publishing Error", f"Failed to publish release:\n{str(e)}")


class ReleasesView(QWidget):
    """Releases management view showing published versions and publish dialog."""

    def __init__(self, store: ReleaseStore, config: ServerConfig, is_dark: bool = True, parent: Optional[QWidget] = None):
        super().__init__(parent)
        self.store = store
        self.config = config
        self.is_dark = is_dark

        self._setup_ui()
        self.refresh_releases()

    def _setup_ui(self) -> None:
        layout = QVBoxLayout(self)
        layout.setContentsMargins(24, 20, 24, 20)
        layout.setSpacing(16)

        # Top Bar
        top_bar = QHBoxLayout()
        top_bar.setSpacing(12)

        title_lbl = QLabel("Published Extension Releases")
        t_font = title_lbl.font()
        t_font.setBold(True)
        t_font.setPointSize(14)
        title_lbl.setFont(t_font)
        top_bar.addWidget(title_lbl)
        top_bar.addStretch()

        self.publish_btn = QPushButton("Publish New Release")
        self.publish_btn.setObjectName("PrimaryBtn")
        self.publish_btn.clicked.connect(self._show_publish_dialog)
        top_bar.addWidget(self.publish_btn)

        refresh_btn = QPushButton("Refresh")
        refresh_btn.clicked.connect(self.refresh_releases)
        top_bar.addWidget(refresh_btn)

        layout.addLayout(top_bar)

        # Releases Table
        self.table = QTableWidget()
        self.table.setColumnCount(6)
        self.table.setHorizontalHeaderLabels([
            "Version", "Release ID", "Package Size", "SHA-256 Digest", "Release Notes", "Published Date"
        ])
        self.table.horizontalHeader().setSectionResizeMode(0, QHeaderView.ResizeToContents)
        self.table.horizontalHeader().setSectionResizeMode(1, QHeaderView.ResizeToContents)
        self.table.horizontalHeader().setSectionResizeMode(2, QHeaderView.ResizeToContents)
        self.table.horizontalHeader().setSectionResizeMode(3, QHeaderView.ResizeToContents)
        self.table.horizontalHeader().setSectionResizeMode(4, QHeaderView.Stretch)
        self.table.horizontalHeader().setSectionResizeMode(5, QHeaderView.ResizeToContents)
        self.table.verticalHeader().setVisible(False)
        self.table.setEditTriggers(QTableWidget.NoEditTriggers)
        self.table.setSelectionBehavior(QTableWidget.SelectRows)
        layout.addWidget(self.table)

    def refresh_releases(self) -> None:
        releases = []
        for meta_file in sorted(self.store.releases_dir.glob("rel_*.json"), reverse=True):
            try:
                with open(meta_file, "r", encoding="utf-8") as f:
                    releases.append(json.load(f))
            except Exception:
                continue

        self.table.setRowCount(len(releases))
        for row_idx, rel in enumerate(releases):
            self.table.setItem(row_idx, 0, QTableWidgetItem(f"v{rel.get('version', '')}"))
            self.table.setItem(row_idx, 1, QTableWidgetItem(rel.get("release_id", "")))

            size_bytes = rel.get("package_size", 0)
            size_kb = f"{size_bytes / 1024:.1f} KB" if size_bytes < 1024 * 1024 else f"{size_bytes / (1024*1024):.2f} MB"
            self.table.setItem(row_idx, 2, QTableWidgetItem(size_kb))

            sha = rel.get("package_sha256", "")
            sha_item = QTableWidgetItem(f"{sha[:16]}...")
            sha_item.setToolTip(sha)
            self.table.setItem(row_idx, 3, sha_item)

            self.table.setItem(row_idx, 4, QTableWidgetItem(rel.get("release_notes", "—")))

            ts = rel.get("timestamp", 0)
            t_str = time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(ts)) if ts else "—"
            self.table.setItem(row_idx, 5, QTableWidgetItem(t_str))

    def _show_publish_dialog(self) -> None:
        dlg = PublishReleaseDialog(self.store, self.config.secret_key, self)
        if dlg.exec():
            self.refresh_releases()
