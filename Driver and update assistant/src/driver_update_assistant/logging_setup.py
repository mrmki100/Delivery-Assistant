"""Structured logging configuration with automatic secret redaction and rotation."""

import logging
import logging.handlers
import os
import re
from pathlib import Path
from typing import Optional

# Regular expressions for secrets redaction
_OTP_REGEX = re.compile(r"\b\d{4}[-\s]?\d{4}\b")
_TOKEN_REGEX = re.compile(r"(bearer\s+|token[\s:=]+|secret[\s:=]+)[A-Za-z0-9_\-\.]{8,}", re.IGNORECASE)
_KEY_REGEX = re.compile(r"-----BEGIN [A-Z ]+ PRIVATE KEY-----.*?-----END [A-Z ]+ PRIVATE KEY-----", re.DOTALL)


class RedactingFormatter(logging.Formatter):
    """Logging formatter that automatically redacts OTPs, tokens, and private keys."""

    def format(self, record: logging.LogRecord) -> str:
        original = super().format(record)
        redacted = _KEY_REGEX.sub("[REDACTED_PRIVATE_KEY]", original)
        redacted = _TOKEN_REGEX.sub(r"\1[REDACTED_SECRET]", redacted)
        redacted = _OTP_REGEX.sub("[REDACTED_OTP]", redacted)
        return redacted


def setup_logger(
    name: str = "driver_assistant",
    log_dir: Optional[str] = None,
    log_file: str = "assistant.log",
    level: int = logging.INFO,
    device_id: Optional[str] = None,
) -> logging.Logger:
    """Configures and returns a thread-safe, redacting logger."""
    logger = logging.getLogger(name)
    logger.setLevel(level)

    # Avoid duplicate handlers if called multiple times
    if logger.handlers:
        return logger

    formatter = RedactingFormatter(
        fmt="%(asctime)s [%(levelname)s] [dev:%(device_id)s] [%(name)s] %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )

    # Context filter to inject device_id
    class DeviceFilter(logging.Filter):
        def filter(self, record: logging.LogRecord) -> bool:
            record.device_id = getattr(record, "device_id", device_id or "LOCAL")
            return True

    # Console Handler (clean stdout)
    console_handler = logging.StreamHandler()
    console_handler.setLevel(level)
    console_handler.setFormatter(formatter)
    console_handler.addFilter(DeviceFilter())
    logger.addHandler(console_handler)

    # Optional File Handler with Rotation (max 5MB, keep 5 backups)
    if log_dir:
        log_path = Path(log_dir)
        try:
            log_path.mkdir(parents=True, exist_ok=True)
            file_handler = logging.handlers.RotatingFileHandler(
                filename=log_path / log_file,
                maxBytes=5 * 1024 * 1024,
                backupCount=5,
                encoding="utf-8",
            )
            file_handler.setLevel(level)
            file_handler.setFormatter(formatter)
            file_handler.addFilter(DeviceFilter())
            logger.addHandler(file_handler)
        except Exception:
            # Fallback to console only if file creation fails (e.g., read-only sandbox)
            pass

    return logger
