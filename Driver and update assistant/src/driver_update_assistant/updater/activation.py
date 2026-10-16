"""Activation checker for unpacked Chrome extensions."""

import json
import os
import subprocess
import time
from pathlib import Path
from typing import Optional, Tuple

from driver_update_assistant.native_messaging.registration import check_native_host_registration
from driver_update_assistant.protocol import UpdateState


def is_chrome_running() -> bool:
    """Checks whether Google Chrome processes are active."""
    try:
        output = subprocess.check_output(
            ["tasklist", "/fi", "imagename eq chrome.exe"],
            text=True,
            stderr=subprocess.DEVNULL,
        )
        return "chrome.exe" in output.lower()
    except Exception:
        return False


def get_reported_runtime_version(status_file: Path) -> Optional[str]:
    """Reads runtime version reported by the active extension via Native Messaging."""
    if not status_file.exists():
        return None
    try:
        with open(status_file, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data.get("runtime_version")
    except Exception:
        return None


def verify_extension_activation(
    status_file: Path,
    expected_version: str,
    timeout_seconds: float = 10.0,
    poll_interval: float = 0.5,
) -> Tuple[UpdateState, str]:
    """
    Polls the runtime version reported by Chrome Native Messaging.
    Returns (UpdateState, message).
    """
    start_time = time.time()

    while time.time() - start_time < timeout_seconds:
        runtime_ver = get_reported_runtime_version(status_file)
        if runtime_ver == expected_version:
            return UpdateState.ACTIVATION_VERIFIED, f"Extension activated and running v{expected_version}"
        time.sleep(poll_interval)

    if is_chrome_running():
        reg_ok, reg_msg = check_native_host_registration()
        if not reg_ok:
            return (
                UpdateState.ACTIVATION_PENDING,
                f"Chrome is running, but Native Messaging host is not registered or misconfigured ({reg_msg}). Extension cannot self-reload automatically. Register the host or reload via chrome://extensions.",
            )
        return (
            UpdateState.ACTIVATION_PENDING,
            f"Chrome is running; self-reload notification was dispatched, but extension runtime confirmation for v{expected_version} timed out after {timeout_seconds:.1f}s. Reload may be deferred due to active operations.",
        )
    else:
        return (
            UpdateState.ACTIVATION_VERIFIED,
            "Chrome is not running; new version will activate upon next browser launch.",
        )
