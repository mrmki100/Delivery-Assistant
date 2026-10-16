"""Vector icon generator providing professional, monochrome Qt QIcon objects."""

from PySide6.QtCore import QPointF, QRectF, Qt
from PySide6.QtGui import QBrush, QColor, QIcon, QPainter, QPainterPath, QPen, QPixmap


def create_vector_icon(name: str, color_hex: str = "#9AA0A6", size: int = 20) -> QIcon:
    """Renders a consistent, professional monochrome vector icon to a QIcon."""
    pixmap = QPixmap(size, size)
    pixmap.fill(Qt.transparent)

    painter = QPainter(pixmap)
    painter.setRenderHint(QPainter.Antialiasing, True)

    color = QColor(color_hex)
    pen = QPen(color)
    pen.setWidthF(1.6)
    pen.setCapStyle(Qt.RoundCap)
    pen.setJoinStyle(Qt.RoundJoin)
    painter.setPen(pen)
    painter.setBrush(Qt.NoBrush)

    s = float(size)
    pad = s * 0.15
    w = s - (2 * pad)
    h = s - (2 * pad)

    if name == "dashboard":
        # 4 small grid rectangles
        half_w = (w - 2.5) / 2.0
        half_h = (h - 2.5) / 2.0
        painter.drawRoundedRect(QRectF(pad, pad, half_w, half_h), 1.5, 1.5)
        painter.drawRoundedRect(QRectF(pad + half_w + 2.5, pad, half_w, half_h), 1.5, 1.5)
        painter.drawRoundedRect(QRectF(pad, pad + half_h + 2.5, half_w, half_h), 1.5, 1.5)
        painter.drawRoundedRect(QRectF(pad + half_w + 2.5, pad + half_h + 2.5, half_w, half_h), 1.5, 1.5)

    elif name == "devices":
        # Laptop: screen + keyboard base
        screen_h = h * 0.7
        painter.drawRoundedRect(QRectF(pad + 1.5, pad, w - 3.0, screen_h), 2, 2)
        # Base line
        base_y = pad + screen_h + 2.0
        painter.drawLine(QPointF(pad, base_y), QPointF(pad + w, base_y))

    elif name == "releases":
        # Package / Isometric Box
        p = QPainterPath()
        mid_x = pad + (w / 2.0)
        p.moveTo(mid_x, pad)
        p.lineTo(pad + w, pad + (h * 0.28))
        p.lineTo(pad + w, pad + (h * 0.72))
        p.lineTo(mid_x, pad + h)
        p.lineTo(pad, pad + (h * 0.72))
        p.lineTo(pad, pad + (h * 0.28))
        p.closeSubpath()
        painter.drawPath(p)
        # Inner edges
        painter.drawLine(QPointF(mid_x, pad), QPointF(mid_x, pad + (h * 0.55)))
        painter.drawLine(QPointF(mid_x, pad + (h * 0.55)), QPointF(pad, pad + (h * 0.28)))
        painter.drawLine(QPointF(mid_x, pad + (h * 0.55)), QPointF(pad + w, pad + (h * 0.28)))

    elif name == "folder":
        # Tabbed folder
        p = QPainterPath()
        tab_w = w * 0.4
        tab_h = h * 0.25
        p.moveTo(pad, pad + tab_h)
        p.lineTo(pad + tab_w * 0.8, pad + tab_h)
        p.lineTo(pad + tab_w, pad)
        p.lineTo(pad + w - 2, pad)
        p.lineTo(pad + w, pad + tab_h)
        p.lineTo(pad + w, pad + h)
        p.lineTo(pad, pad + h)
        p.closeSubpath()
        painter.drawPath(p)

    elif name == "settings":
        # Professional sliders / controls icon
        # Top slider
        painter.drawLine(QPointF(pad, pad + (h * 0.25)), QPointF(pad + w, pad + (h * 0.25)))
        painter.drawEllipse(QRectF(pad + (w * 0.25) - 2.5, pad + (h * 0.25) - 2.5, 5, 5))
        # Middle slider
        painter.drawLine(QPointF(pad, pad + (h * 0.55)), QPointF(pad + w, pad + (h * 0.55)))
        painter.drawEllipse(QRectF(pad + (w * 0.75) - 2.5, pad + (h * 0.55) - 2.5, 5, 5))
        # Bottom slider
        painter.drawLine(QPointF(pad, pad + (h * 0.85)), QPointF(pad + w, pad + (h * 0.85)))
        painter.drawEllipse(QRectF(pad + (w * 0.45) - 2.5, pad + (h * 0.85) - 2.5, 5, 5))

    elif name == "logs":
        # Document with text lines
        painter.drawRoundedRect(QRectF(pad + 1.0, pad, w - 2.0, h), 2, 2)
        line_pad = pad + 3.5
        line_w = w - 7.0
        painter.drawLine(QPointF(line_pad, pad + (h * 0.3)), QPointF(line_pad + line_w, pad + (h * 0.3)))
        painter.drawLine(QPointF(line_pad, pad + (h * 0.52)), QPointF(line_pad + line_w, pad + (h * 0.52)))
        painter.drawLine(QPointF(line_pad, pad + (h * 0.74)), QPointF(line_pad + (line_w * 0.6), pad + (h * 0.74)))

    elif name == "server":
        # 3 Server Rack units
        unit_h = (h - 4.0) / 3.0
        for i in range(3):
            y = pad + (i * (unit_h + 2.0))
            painter.drawRoundedRect(QRectF(pad, y, w, unit_h), 1.5, 1.5)
            # Dot indicator
            painter.drawPoint(QPointF(pad + w - 3.5, y + (unit_h / 2.0)))

    elif name == "shield":
        # Security shield
        p = QPainterPath()
        p.moveTo(pad + (w / 2.0), pad)
        p.lineTo(pad + w, pad + (h * 0.2))
        p.quadTo(QPointF(pad + w, pad + (h * 0.7)), QPointF(pad + (w / 2.0), pad + h))
        p.quadTo(QPointF(pad, pad + (h * 0.7)), QPointF(pad, pad + (h * 0.2)))
        p.closeSubpath()
        painter.drawPath(p)

    elif name == "refresh":
        # Curved refresh arrow
        rect = QRectF(pad + 1, pad + 1, w - 2, h - 2)
        painter.drawArc(rect, 45 * 16, 270 * 16)
        # Arrowhead
        p = QPainterPath()
        tip_x = pad + w - 1.5
        tip_y = pad + (h * 0.45)
        p.moveTo(tip_x - 3, tip_y - 2)
        p.lineTo(tip_x, tip_y)
        p.lineTo(tip_x + 3, tip_y - 2)
        painter.drawPath(p)

    elif name == "check":
        p = QPainterPath()
        p.moveTo(pad + 1.0, pad + (h * 0.55))
        p.lineTo(pad + (w * 0.38), pad + h - 1.5)
        p.lineTo(pad + w - 1.0, pad + 1.5)
        pen.setWidthF(2.0)
        painter.setPen(pen)
        painter.drawPath(p)

    elif name == "alert":
        # Warning triangle
        p = QPainterPath()
        p.moveTo(pad + (w / 2.0), pad)
        p.lineTo(pad + w, pad + h)
        p.lineTo(pad, pad + h)
        p.closeSubpath()
        painter.drawPath(p)
        painter.drawLine(QPointF(pad + (w / 2.0), pad + (h * 0.4)), QPointF(pad + (w / 2.0), pad + (h * 0.7)))
        painter.drawPoint(QPointF(pad + (w / 2.0), pad + (h * 0.85)))

    elif name == "sun":
        # Sun icon for theme toggle
        painter.drawEllipse(QRectF(pad + (w * 0.28), pad + (h * 0.28), w * 0.44, h * 0.44))
        # Rays
        mid = pad + (w / 2.0)
        painter.drawLine(QPointF(mid, pad), QPointF(mid, pad + 2.5))
        painter.drawLine(QPointF(mid, pad + h - 2.5), QPointF(mid, pad + h))
        painter.drawLine(QPointF(pad, mid), QPointF(pad + 2.5, mid))
        painter.drawLine(QPointF(pad + w - 2.5, mid), QPointF(pad + w, mid))

    elif name == "moon":
        # Crescent moon
        p = QPainterPath()
        p.moveTo(pad + (w * 0.6), pad)
        p.quadTo(QPointF(pad, pad + (h * 0.5)), QPointF(pad + (w * 0.6), pad + h))
        p.quadTo(QPointF(pad + (w * 0.25), pad + (h * 0.5)), QPointF(pad + (w * 0.6), pad))
        painter.drawPath(p)

    elif name == "download":
        painter.drawLine(QPointF(pad + (w / 2.0), pad), QPointF(pad + (w / 2.0), pad + (h * 0.7)))
        # Arrowhead
        p = QPainterPath()
        p.moveTo(pad + (w * 0.25), pad + (h * 0.45))
        p.lineTo(pad + (w / 2.0), pad + (h * 0.7))
        p.lineTo(pad + (w * 0.75), pad + (h * 0.45))
        painter.drawPath(p)
        # Tray
        painter.drawLine(QPointF(pad, pad + h), QPointF(pad + w, pad + h))

    elif name == "search":
        # Magnifying glass
        lens_r = w * 0.32
        painter.drawEllipse(QRectF(pad, pad, lens_r * 2, lens_r * 2))
        painter.drawLine(
            QPointF(pad + (lens_r * 1.7), pad + (lens_r * 1.7)),
            QPointF(pad + w, pad + h),
        )

    else:
        # Default fallback generic dot
        painter.drawEllipse(QRectF(pad + (w * 0.3), pad + (h * 0.3), w * 0.4, h * 0.4))

    painter.end()
    return QIcon(pixmap)


def get_icon(name: str, is_dark: bool = True, size: int = 20) -> QIcon:
    """Convenience helper returning a theme-adapted vector QIcon."""
    color = "#F1F3F5" if is_dark else "#1E232A"
    return create_vector_icon(name, color_hex=color, size=size)

