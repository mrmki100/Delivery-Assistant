"""Background server service thread for running Admin HTTP/REST server non-blockingly."""

import logging
import threading
from typing import Optional
from PySide6.QtCore import QObject, QThread, Signal

from driver_update_assistant.config import ServerConfig
from driver_update_assistant.server.app import AdminServer


class ServerServiceWorker(QThread):
    """Runs the HTTP REST server on a dedicated background thread."""

    server_started = Signal(str, int)
    server_stopped = Signal()
    server_error = Signal(str)

    def __init__(self, config: ServerConfig, parent: Optional[QObject] = None):
        super().__init__(parent)
        self.config = config
        self.server: Optional[AdminServer] = None
        self._is_running = False

    def run(self) -> None:
        try:
            self.server = AdminServer(self.config)
            self._is_running = True
            self.server_started.emit(self.config.host, self.config.port)
            self.server.start()
        except Exception as e:
            self._is_running = False
            self.server_error.emit(str(e))
        finally:
            self._is_running = False
            self.server_stopped.emit()

    def stop(self) -> None:
        if self.server:
            try:
                self.server.shutdown()
            except Exception:
                pass
        self._is_running = False
        self.quit()
        self.wait(2000)

    @property
    def is_running(self) -> bool:
        return self._is_running
