"""Reusable modern UI widgets for Server and Client applications."""

from typing import Callable, Optional
from PySide6.QtCore import QSize, Qt
from PySide6.QtGui import QColor, QFont
from PySide6.QtWidgets import (
    QFrame,
    QHBoxLayout,
    QLabel,
    QPushButton,
    QSizePolicy,
    QVBoxLayout,
    QWidget,
)

from driver_update_assistant.ui.icons import create_vector_icon


class StatusBadge(QLabel):
    """Pill badge indicating status with semantic colors."""

    STATUS_MAP = {
        "ONLINE": ("#0F7B42", "#E6F4EA", "#34A853", "#143521"),
        "AUTHORIZED": ("#0F7B42", "#E6F4EA", "#34A853", "#143521"),
        "ACTIVE": ("#0F7B42", "#E6F4EA", "#34A853", "#143521"),
        "PASS": ("#0F7B42", "#E6F4EA", "#34A853", "#143521"),
        "SUCCESS": ("#0F7B42", "#E6F4EA", "#34A853", "#143521"),
        "OFFLINE": ("#5E646A", "#F1F3F5", "#9AA0A6", "#22262C"),
        "IDLE": ("#5E646A", "#F1F3F5", "#9AA0A6", "#22262C"),
        "EXPIRED": ("#5E646A", "#F1F3F5", "#9AA0A6", "#22262C"),
        "UPDATING": ("#0066CC", "#E3F2FD", "#3399FF", "#1C2A3A"),
        "PENDING": ("#B06000", "#FEF3D6", "#FBBC04", "#3D2E0A"),
        "CHALLENGED": ("#B06000", "#FEF3D6", "#FBBC04", "#3D2E0A"),
        "ATTENTION": ("#D93025", "#FCE8E6", "#EA4335", "#3C1714"),
        "REVOKED": ("#D93025", "#FCE8E6", "#EA4335", "#3C1714"),
        "FAILED": ("#D93025", "#FCE8E6", "#EA4335", "#3C1714"),
        "DENIED": ("#D93025", "#FCE8E6", "#EA4335", "#3C1714"),
        "ERROR": ("#D93025", "#FCE8E6", "#EA4335", "#3C1714"),
        "INFO": ("#0066CC", "#E3F2FD", "#3399FF", "#1C2A3A"),
        "WARNING": ("#B06000", "#FEF3D6", "#FBBC04", "#3D2E0A"),
        "NEUTRAL": ("#5E646A", "#F1F3F5", "#9AA0A6", "#22262C"),
    }

    TYPE_ALIASES = {
        "success": "SUCCESS",
        "error": "FAILED",
        "danger": "FAILED",
        "warning": "PENDING",
        "info": "INFO",
        "neutral": "NEUTRAL",
    }

    def __init__(self, status: str, badge_type_or_dark=True, parent: Optional[QWidget] = None):
        super().__init__(parent)
        self.setAlignment(Qt.AlignCenter)
        self.setSizePolicy(QSizePolicy.Fixed, QSizePolicy.Fixed)
        font = self.font()
        font.setBold(True)
        font.setPointSize(9)
        self.setFont(font)

        is_dark = True
        badge_type = None
        if isinstance(badge_type_or_dark, bool):
            is_dark = badge_type_or_dark
        elif isinstance(badge_type_or_dark, str):
            badge_type = badge_type_or_dark

        self._is_dark = is_dark
        self.badge_type = badge_type or status
        self.update_status(status, is_dark, badge_type=badge_type)

    def update_status(self, status: str, is_dark: bool = True, badge_type: Optional[str] = None, label: Optional[str] = None) -> None:
        self._is_dark = is_dark
        clean_key = (badge_type or status).upper().replace(" ", "_")
        if clean_key.lower() in self.TYPE_ALIASES:
            clean_key = self.TYPE_ALIASES[clean_key.lower()]

        display_text = label if label else status
        self.setText(f"  {display_text}  ")

        color_info = self.STATUS_MAP.get(clean_key, ("#5E646A", "#F1F3F5", "#9AA0A6", "#22262C"))
        if is_dark:
            fg, bg = color_info[2], color_info[3]
        else:
            fg, bg = color_info[0], color_info[1]

        self.setStyleSheet(
            f"background-color: {bg}; color: {fg}; border-radius: 10px; padding: 2px 8px; font-weight: 600;"
        )

    def style_badge(self) -> None:
        self.update_status(self.text().strip(), self._is_dark, badge_type=self.badge_type)



class MetricCard(QFrame):
    """Modern dashboard KPI card with metric, title, and optional badge."""

    def __init__(
        self,
        title: str,
        value: str,
        subtext: str = "",
        icon_name: Optional[str] = None,
        is_dark: bool = True,
        parent: Optional[QWidget] = None,
    ):
        super().__init__(parent)
        self.setObjectName("Card")

        layout = QVBoxLayout(self)
        layout.setContentsMargins(16, 14, 16, 14)
        layout.setSpacing(4)

        # Top row: Title + Icon
        top_row = QHBoxLayout()
        self.title_label = QLabel(title)
        self.title_label.setStyleSheet("color: #8C939A; font-size: 11px; font-weight: 600; text-transform: uppercase;")
        top_row.addWidget(self.title_label)
        top_row.addStretch()

        if icon_name:
            icon_label = QLabel()
            icon_color = "#9AA0A6" if is_dark else "#5E646A"
            icon = create_vector_icon(icon_name, color_hex=icon_color, size=18)
            icon_label.setPixmap(icon.pixmap(18, 18))
            top_row.addWidget(icon_label)

        layout.addLayout(top_row)

        # Value
        self.value_label = QLabel(value)
        val_font = self.value_label.font()
        val_font.setPointSize(22)
        val_font.setBold(True)
        self.value_label.setFont(val_font)
        layout.addWidget(self.value_label)

        # Subtext
        self.subtext_label = QLabel(subtext)
        self.subtext_label.setStyleSheet("color: #8C939A; font-size: 11px;")
        layout.addWidget(self.subtext_label)

    def set_value(self, value: str, subtext: Optional[str] = None) -> None:
        self.value_label.setText(value)
        if subtext is not None:
            self.subtext_label.setText(subtext)


class HeaderBar(QFrame):
    """Header bar with page title, description, and status indicator."""

    def __init__(
        self,
        title: str,
        subtitle: str,
        on_toggle_theme: Optional[Callable[[], None]] = None,
        is_dark: bool = True,
        badge_text: Optional[str] = None,
        badge_type: str = "info",
        parent: Optional[QWidget] = None,
    ):
        super().__init__(parent)
        self.setObjectName("HeaderBar")

        layout = QHBoxLayout(self)
        layout.setContentsMargins(20, 12, 20, 12)
        layout.setSpacing(16)

        text_layout = QVBoxLayout()
        text_layout.setSpacing(2)
        self.title_label = QLabel(title)
        t_font = self.title_label.font()
        t_font.setPointSize(16)
        t_font.setBold(True)
        self.title_label.setFont(t_font)
        text_layout.addWidget(self.title_label)

        self.subtitle_label = QLabel(subtitle)
        self.subtitle_label.setStyleSheet("color: #8C939A; font-size: 12px;")
        text_layout.addWidget(self.subtitle_label)

        layout.addLayout(text_layout)
        layout.addStretch()

        if badge_text:
            badge = StatusBadge(badge_text, badge_type)
            layout.addWidget(badge)

        if on_toggle_theme:
            self.theme_btn = QPushButton()
            self.theme_btn.setFixedSize(34, 34)
            self.theme_btn.setToolTip("Toggle Light/Dark Theme")
            icon_name = "sun" if is_dark else "moon"
            self.theme_btn.setIcon(create_vector_icon(icon_name, "#8C939A", 18))
            self.theme_btn.clicked.connect(on_toggle_theme)
            layout.addWidget(self.theme_btn)

    def set_title(self, title: str, subtitle: Optional[str] = None) -> None:
        self.title_label.setText(title)
        if subtitle:
            self.subtitle_label.setText(subtitle)


class NavButton(QPushButton):
    """Sidebar navigation button with vector icon and active styling."""

    def __init__(self, text: str, icon_name: str, is_dark: bool = True, parent: Optional[QWidget] = None):
        super().__init__(text, parent)
        self.setObjectName("NavBtn")
        self.setCheckable(True)
        self.icon_name = icon_name
        self.update_icon(is_dark)

    def update_icon(self, is_dark: bool) -> None:
        color = "#F1F3F5" if self.isChecked() else ("#9AA0A6" if is_dark else "#5E646A")
        self.setIcon(create_vector_icon(self.icon_name, color_hex=color, size=18))
        self.setIconSize(QSize(18, 18))


class EmptyState(QFrame):
    """Empty state container for lists or tables."""

    def __init__(self, title: str, message: str, icon_name: str = "logs", is_dark: bool = True, parent: Optional[QWidget] = None):
        super().__init__(parent)
        self.setObjectName("Card")

        layout = QVBoxLayout(self)
        layout.setAlignment(Qt.AlignCenter)
        layout.setContentsMargins(32, 48, 32, 48)
        layout.setSpacing(10)

        self.icon_name = icon_name
        self.icon_label = QLabel()
        self.icon_label.setAlignment(Qt.AlignCenter)
        icon_color = "#6E767E" if is_dark else "#8C939A"
        icon = create_vector_icon(icon_name, color_hex=icon_color, size=36)
        self.icon_label.setPixmap(icon.pixmap(36, 36))
        layout.addWidget(self.icon_label)

        title_lbl = QLabel(title)
        title_lbl.setAlignment(Qt.AlignCenter)
        t_font = title_lbl.font()
        t_font.setBold(True)
        t_font.setPointSize(14)
        title_lbl.setFont(t_font)
        layout.addWidget(title_lbl)

        msg_lbl = QLabel(message)
        msg_lbl.setAlignment(Qt.AlignCenter)
        msg_lbl.setStyleSheet("color: #8C939A; font-size: 12px;")
        msg_lbl.setWordWrap(True)
        layout.addWidget(msg_lbl)

    def update_theme(self, is_dark: bool) -> None:
        icon_color = "#6E767E" if is_dark else "#8C939A"
        icon = create_vector_icon(self.icon_name, color_hex=icon_color, size=36)
        self.icon_label.setPixmap(icon.pixmap(36, 36))
