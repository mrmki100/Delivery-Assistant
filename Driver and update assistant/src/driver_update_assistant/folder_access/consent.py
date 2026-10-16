"""Folder path security validation and explicit employee consent checking."""

import os
from pathlib import Path
from typing import List, Optional, Tuple

from driver_update_assistant.protocol import ErrorCode


def get_blocked_system_roots() -> List[str]:
    """Compiles list of system-critical paths that must never be shared."""
    blocked = []
    # Windows system directory
    sys_root = os.environ.get("SystemRoot") or "C:\\Windows"
    blocked.append(os.path.realpath(sys_root))

    # Program Files
    for pf_env in ("ProgramFiles", "ProgramFiles(x86)", "ProgramW6432"):
        val = os.environ.get(pf_env)
        if val:
            blocked.append(os.path.realpath(val))

    # User AppData / Credential stores
    for app_env in ("APPDATA", "LOCALAPPDATA", "USERPROFILE"):
        val = os.environ.get(app_env)
        if val:
            real_val = os.path.realpath(val)
            if "appdata" in app_env.lower():
                blocked.append(real_val)
            else:
                # Add specific sensitive subdirectories under USERPROFILE
                blocked.append(os.path.realpath(os.path.join(real_val, "AppData")))
                blocked.append(os.path.realpath(os.path.join(real_val, ".ssh")))
                blocked.append(os.path.realpath(os.path.join(real_val, ".aws")))

    return list(set(blocked))


def validate_shareable_folder_path(raw_path: str) -> Tuple[bool, ErrorCode, str, Optional[str]]:
    """
    Validates that the proposed folder is safe, canonical, and not system-critical.
    Returns (is_safe, error_code, reason, canonical_path).
    """
    if not raw_path or not raw_path.strip():
        return False, ErrorCode.FOLDER_NOT_FOUND, "Folder path cannot be empty", None

    try:
        resolved = os.path.realpath(os.path.expandvars(raw_path.strip()))
    except Exception as e:
        return False, ErrorCode.FOLDER_BLOCKED, f"Invalid path syntax: {str(e)}", None

    path_obj = Path(resolved)
    if not path_obj.is_dir():
        return False, ErrorCode.FOLDER_NOT_FOUND, f"Path does not exist or is not a directory: {resolved}", None

    # Check root drive: e.g. "C:\", "D:\"
    drive, rest = os.path.splitdrive(resolved)
    if not rest or rest in ("\\", "/", ""):
        return False, ErrorCode.FOLDER_BLOCKED, f"Sharing an entire drive root is strictly prohibited: {resolved}", None

    # Check against blocked paths
    blocked_roots = get_blocked_system_roots()
    for b_path in blocked_roots:
        if resolved == b_path or resolved.startswith(b_path + os.sep):
            return (
                False,
                ErrorCode.FOLDER_BLOCKED,
                f"Sharing system-critical or credential directory is prohibited: {b_path}",
                None,
            )

    # Check for browser profiles
    lower_path = resolved.lower()
    for sensitive_keyword in ("google\\chrome\\user data", "mozilla\\firefox", "microsoft\\edge\\user data"):
        if sensitive_keyword in lower_path:
            return (
                False,
                ErrorCode.FOLDER_BLOCKED,
                "Sharing browser profile or extension storage directories is prohibited",
                None,
            )

    return True, ErrorCode.NONE, "Folder path approved", resolved
