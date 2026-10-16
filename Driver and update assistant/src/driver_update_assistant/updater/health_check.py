"""Health check validation for installed extension directory."""

import json
from pathlib import Path
from typing import List, Tuple

from driver_update_assistant.protocol import ErrorCode

REQUIRED_CORE_FILES = [
    "manifest.json",
    "background.js",
    "ui-render.js",
    "shortcuts.js",
    "content.js",
]


def verify_installed_extension_health(
    target_dir: Path,
    expected_version: str,
    required_files: List[str] = REQUIRED_CORE_FILES,
) -> Tuple[bool, ErrorCode, str]:
    """
    Validates that the target extension directory contains all critical files
    and that manifest.json reflects the expected version.
    """
    manifest_path = target_dir / "manifest.json"
    if not manifest_path.exists():
        return False, ErrorCode.HEALTH_CHECK_FAILED, "Missing manifest.json in target directory"

    try:
        with open(manifest_path, "r", encoding="utf-8") as f:
            manifest_data = json.load(f)
    except Exception as e:
        return False, ErrorCode.HEALTH_CHECK_FAILED, f"Corrupted manifest.json: {str(e)}"

    actual_version = manifest_data.get("version")
    if actual_version != expected_version:
        return (
            False,
            ErrorCode.HEALTH_CHECK_FAILED,
            f"Installed manifest version '{actual_version}' does not match expected '{expected_version}'",
        )

    # Check existence of required files
    for rf in required_files:
        rf_path = target_dir / rf
        if not rf_path.exists():
            return (
                False,
                ErrorCode.HEALTH_CHECK_FAILED,
                f"Missing critical extension file: {rf}",
            )

    return True, ErrorCode.NONE, f"Extension health check passed (version {expected_version})"
