"""Design system tokens and QSS stylesheet generator for Light and Dark themes."""

import json
from pathlib import Path
from typing import Dict, Optional, Tuple


# Design Tokens: Palette
LIGHT_THEME = {
    "bg_window": "#F8F9FA",
    "bg_surface": "#FFFFFF",
    "bg_sidebar": "#F1F3F5",
    "bg_sidebar_hover": "#E9ECEF",
    "bg_sidebar_active": "#E3F2FD",
    "bg_card": "#FFFFFF",
    "bg_input": "#FFFFFF",
    "bg_table_alt": "#FAFAFA",
    "border": "#E2E5E8",
    "border_focus": "#0066CC",
    "text_primary": "#1A1D20",
    "text_secondary": "#5E646A",
    "text_muted": "#8C939A",
    "accent": "#0066CC",
    "accent_hover": "#0052A3",
    "accent_text": "#FFFFFF",
    "success": "#0F7B42",
    "success_bg": "#E6F4EA",
    "warning": "#B06000",
    "warning_bg": "#FEF3D6",
    "danger": "#D93025",
    "danger_bg": "#FCE8E6",
    "danger_hover": "#B3261E",
    "scrollbar": "#D0D4D9",
    "scrollbar_hover": "#B0B5BA",
}

DARK_THEME = {
    "bg_window": "#121417",
    "bg_surface": "#1A1D21",
    "bg_sidebar": "#16181C",
    "bg_sidebar_hover": "#22262C",
    "bg_sidebar_active": "#1C2A3A",
    "bg_card": "#1E2227",
    "bg_input": "#181B1F",
    "bg_table_alt": "#16191D",
    "border": "#2B3037",
    "border_focus": "#3399FF",
    "text_primary": "#F1F3F5",
    "text_secondary": "#9AA0A6",
    "text_muted": "#6E767E",
    "accent": "#3399FF",
    "accent_hover": "#5CB0FF",
    "accent_text": "#FFFFFF",
    "success": "#34A853",
    "success_bg": "#143521",
    "warning": "#FBBC04",
    "warning_bg": "#3D2E0A",
    "danger": "#EA4335",
    "danger_bg": "#3C1714",
    "danger_hover": "#F26154",
    "scrollbar": "#383E46",
    "scrollbar_hover": "#525A65",
}


def generate_stylesheet(theme: Dict[str, str]) -> str:
    """Compiles a complete Qt Stylesheet using theme color tokens."""
    return f"""
    * {{
        font-family: "Segoe UI";
        font-size: 13px;
        color: {theme['text_primary']};
    }}


    QMainWindow, QDialog {{
        background-color: {theme['bg_window']};
    }}

    QWidget#CentralWidget, QWidget#MainContent {{
        background-color: {theme['bg_window']};
    }}

    /* Sidebar Navigation */
    QFrame#Sidebar {{
        background-color: {theme['bg_sidebar']};
        border-right: 1px solid {theme['border']};
    }}

    QPushButton#NavBtn {{
        background-color: transparent;
        color: {theme['text_secondary']};
        border: none;
        border-radius: 6px;
        text-align: left;
        padding: 10px 14px;
        font-weight: 500;
        font-size: 13px;
    }}

    QPushButton#NavBtn:hover {{
        background-color: {theme['bg_sidebar_hover']};
        color: {theme['text_primary']};
    }}

    QPushButton#NavBtn:checked, QPushButton#NavBtn[active="true"] {{
        background-color: {theme['bg_sidebar_active']};
        color: {theme['accent']};
        font-weight: 600;
        border-left: 3px solid {theme['accent']};
    }}

    /* Cards & Containers */
    QFrame#Card, QFrame.card {{
        background-color: {theme['bg_card']};
        border: 1px solid {theme['border']};
        border-radius: 8px;
    }}

    /* Header Bar */
    QFrame#HeaderBar {{
        background-color: {theme['bg_surface']};
        border-bottom: 1px solid {theme['border']};
        padding: 12px 20px;
    }}

    /* Buttons */
    QPushButton {{
        background-color: {theme['bg_surface']};
        color: {theme['text_primary']};
        border: 1px solid {theme['border']};
        border-radius: 6px;
        padding: 7px 16px;
        font-weight: 500;
        min-height: 18px;
    }}

    QPushButton:hover {{
        background-color: {theme['bg_sidebar_hover']};
        border-color: {theme['border']};
    }}

    QPushButton:pressed {{
        background-color: {theme['bg_sidebar_active']};
    }}

    QPushButton:disabled {{
        color: {theme['text_muted']};
        background-color: {theme['bg_window']};
        border-color: {theme['border']};
    }}

    QPushButton#PrimaryBtn, QPushButton[primary="true"] {{
        background-color: {theme['accent']};
        color: {theme['accent_text']};
        border: 1px solid {theme['accent']};
        font-weight: 600;
    }}

    QPushButton#PrimaryBtn:hover, QPushButton[primary="true"]:hover {{
        background-color: {theme['accent_hover']};
        border-color: {theme['accent_hover']};
    }}

    QPushButton#DangerBtn, QPushButton[danger="true"] {{
        background-color: {theme['danger']};
        color: #FFFFFF;
        border: 1px solid {theme['danger']};
        font-weight: 600;
    }}

    QPushButton#DangerBtn:hover, QPushButton[danger="true"]:hover {{
        background-color: {theme['danger_hover']};
        border-color: {theme['danger_hover']};
    }}

    /* Form Inputs */
    QLineEdit, QTextEdit, QPlainTextEdit, QSpinBox {{
        background-color: {theme['bg_input']};
        color: {theme['text_primary']};
        border: 1px solid {theme['border']};
        border-radius: 6px;
        padding: 6px 10px;
        selection-background-color: {theme['accent']};
    }}

    QLineEdit:focus, QTextEdit:focus, QPlainTextEdit:focus, QSpinBox:focus {{
        border: 1px solid {theme['border_focus']};
    }}

    /* Tables */
    QTableWidget {{
        background-color: {theme['bg_card']};
        alternate-background-color: {theme['bg_table_alt']};
        border: 1px solid {theme['border']};
        border-radius: 8px;
        gridline-color: {theme['border']};
        selection-background-color: {theme['bg_sidebar_active']};
        selection-color: {theme['text_primary']};
    }}

    QHeaderView::section {{
        background-color: {theme['bg_sidebar']};
        color: {theme['text_secondary']};
        border: none;
        border-bottom: 1px solid {theme['border']};
        border-right: 1px solid {theme['border']};
        padding: 8px 12px;
        font-weight: 600;
        font-size: 12px;
    }}

    /* Progress Bar */
    QProgressBar {{
        background-color: {theme['bg_input']};
        border: 1px solid {theme['border']};
        border-radius: 6px;
        text-align: center;
        color: {theme['text_primary']};
        font-weight: 600;
        min-height: 18px;
    }}

    QProgressBar::chunk {{
        background-color: {theme['accent']};
        border-radius: 5px;
    }}

    /* Scrollbars */
    QScrollBar:vertical {{
        background: transparent;
        width: 8px;
        margin: 0px;
    }}

    QScrollBar::handle:vertical {{
        background: {theme['scrollbar']};
        border-radius: 4px;
        min-height: 24px;
    }}

    QScrollBar::handle:vertical:hover {{
        background: {theme['scrollbar_hover']};
    }}

    QScrollBar::add-line:vertical, QScrollBar::sub-line:vertical {{
        height: 0px;
    }}

    QScrollBar:horizontal {{
        background: transparent;
        height: 8px;
        margin: 0px;
    }}

    QScrollBar::handle:horizontal {{
        background: {theme['scrollbar']};
        border-radius: 4px;
        min-width: 24px;
    }}

    QScrollBar::add-line:horizontal, QScrollBar::sub-line:horizontal {{
        width: 0px;
    }}

    /* Tab Widget */
    QTabWidget::pane {{
        border: 1px solid {theme['border']};
        border-radius: 8px;
        background-color: {theme['bg_card']};
    }}

    QTabBar::tab {{
        background-color: {theme['bg_sidebar']};
        color: {theme['text_secondary']};
        border: 1px solid {theme['border']};
        border-bottom: none;
        border-top-left-radius: 6px;
        border-top-right-radius: 6px;
        padding: 8px 16px;
        margin-right: 2px;
    }}

    QTabBar::tab:selected {{
        background-color: {theme['bg_card']};
        color: {theme['accent']};
        font-weight: 600;
    }}
    """


class ThemeManager:
    """Manages application theme state and persistence."""

    def __init__(self, data_dir: str):
        self.config_file = Path(data_dir) / "theme.json"
        self.is_dark = self._load_preference()

    def _load_preference(self) -> bool:
        if self.config_file.exists():
            try:
                with open(self.config_file, "r", encoding="utf-8") as f:
                    data = json.load(f)
                return bool(data.get("dark_mode", True))
            except Exception:
                pass
        return True  # Default to sleek modern dark mode

    def save_preference(self, is_dark: bool) -> None:
        self.is_dark = is_dark
        self.config_file.parent.mkdir(parents=True, exist_ok=True)
        try:
            with open(self.config_file, "w", encoding="utf-8") as f:
                json.dump({"dark_mode": self.is_dark}, f)
        except Exception:
            pass

    def toggle_theme(self) -> bool:
        self.save_preference(not self.is_dark)
        return self.is_dark

    def get_tokens(self, force_dark: Optional[bool] = None) -> Dict[str, str]:
        dark = self.is_dark if force_dark is None else force_dark
        return DARK_THEME if dark else LIGHT_THEME

    def get_stylesheet(self, force_dark: Optional[bool] = None) -> str:
        return generate_stylesheet(self.get_tokens(force_dark=force_dark))

