"""Transactional file installer applying staged files to the active extension directory."""

import os
import shutil
from pathlib import Path
from typing import List, Tuple

from driver_update_assistant.protocol import ErrorCode


def check_target_writable(target_dir: Path) -> Tuple[bool, ErrorCode, str]:
    """Tests if existing files in the target directory can be opened for writing."""
    for root, _, files in os.walk(target_dir):
        for f in files:
            file_path = Path(root) / f
            try:
                # Attempt to open with append mode to check if locked by Chrome or another process
                with open(file_path, "a+b") as test_f:
                    pass
            except PermissionError:
                return False, ErrorCode.FILE_LOCKED, f"File locked or write permission denied: {file_path.name}"
            except Exception as e:
                return False, ErrorCode.PERMISSION_DENIED, f"Cannot write to {file_path.name}: {str(e)}"
    return True, ErrorCode.NONE, "Target files are writable"


def apply_staged_files(staging_dir: Path, target_dir: Path) -> Tuple[bool, ErrorCode, str, List[str]]:
    """
    Copies staged files into the target extension directory.
    Returns (success, error_code, reason, list_of_written_files).
    """
    written_files: List[str] = []

    # First check writability
    is_writable, err_code, reason = check_target_writable(target_dir)
    if not is_writable:
        return False, err_code, reason, []

    try:
        for root, _, files in os.walk(staging_dir):
            for f in files:
                src_path = Path(root) / f
                rel_path = src_path.relative_to(staging_dir).as_posix()
                dest_path = target_dir / rel_path
                dest_path.parent.mkdir(parents=True, exist_ok=True)

                shutil.copy2(src_path, dest_path)
                written_files.append(rel_path)

        return True, ErrorCode.NONE, "Files successfully installed", written_files

    except PermissionError as pe:
        return False, ErrorCode.FILE_LOCKED, f"Permission denied/file locked during installation: {str(pe)}", written_files
    except OSError as oe:
        if "space" in str(oe).lower():
            return False, ErrorCode.DISK_FULL, f"Disk full during file copy: {str(oe)}", written_files
        return False, ErrorCode.PERMISSION_DENIED, f"OS error copying files: {str(oe)}", written_files
    except Exception as e:
        return False, ErrorCode.PERMISSION_DENIED, f"Installation failure: {str(e)}", written_files
