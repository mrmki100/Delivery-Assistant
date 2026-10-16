"""Snapshot backup creation and verified rollback engine."""

import json
import os
import shutil
import time
from pathlib import Path
from typing import Dict, Optional, Tuple

from driver_update_assistant.protocol import ErrorCode
from driver_update_assistant.shared.crypto import compute_file_sha256


class RollbackManager:
    """Manages pre-update snapshot creation, verification, and atomic restoration."""

    def __init__(self, backup_root: Path):
        self.backup_root = backup_root
        self.backup_root.mkdir(parents=True, exist_ok=True)

    def create_backup(self, target_dir: Path, current_version: str) -> Tuple[bool, ErrorCode, str, Optional[Path]]:
        """
        Creates a versioned snapshot of the current extension folder with checksum manifest.
        Returns (success, error_code, reason, backup_dir).
        """
        if not target_dir.is_dir():
            return False, ErrorCode.INVALID_TARGET_DIR, f"Target directory not found: {target_dir}", None

        timestamp = int(time.time())
        backup_dir = self.backup_root / f"backup_v{current_version}_{timestamp}"

        try:
            backup_dir.mkdir(parents=True, exist_ok=True)
            manifest: Dict[str, str] = {}

            # Copy all files except temporary updater directories or git caches
            for root, dirs, files in os.walk(target_dir):
                # Skip the updater subsystem folder if it happens to be located within
                dirs[:] = [d for d in dirs if d not in ("Driver and update assistant", ".git", "__pycache__", "node_modules")]

                for f in files:
                    src_file = Path(root) / f
                    rel_path = src_file.relative_to(target_dir).as_posix()
                    dest_file = backup_dir / rel_path
                    dest_file.parent.mkdir(parents=True, exist_ok=True)

                    shutil.copy2(src_file, dest_file)
                    manifest[rel_path] = compute_file_sha256(dest_file)

            # Write backup manifest
            with open(backup_dir / "backup_manifest.json", "w", encoding="utf-8") as mf:
                json.dump(manifest, mf, indent=2)

            return True, ErrorCode.NONE, "Backup created successfully", backup_dir

        except PermissionError as pe:
            return False, ErrorCode.PERMISSION_DENIED, f"Permission denied creating backup: {str(pe)}", None
        except OSError as oe:
            if "space" in str(oe).lower():
                return False, ErrorCode.DISK_FULL, f"Disk full creating backup: {str(oe)}", None
            return False, ErrorCode.PERMISSION_DENIED, f"OS error during backup: {str(oe)}", None
        except Exception as e:
            return False, ErrorCode.PERMISSION_DENIED, f"Backup creation failed: {str(e)}", None

    def verify_backup(self, backup_dir: Path) -> Tuple[bool, ErrorCode, str]:
        """Validates that backup files exist and match their manifest hashes."""
        manifest_file = backup_dir / "backup_manifest.json"
        if not manifest_file.exists():
            return False, ErrorCode.BACKUP_CORRUPTED, "Missing backup_manifest.json"

        try:
            with open(manifest_file, "r", encoding="utf-8") as mf:
                manifest: Dict[str, str] = json.load(mf)

            for rel_path, expected_hash in manifest.items():
                bf = backup_dir / rel_path
                if not bf.is_file():
                    return False, ErrorCode.BACKUP_CORRUPTED, f"Missing backup file: {rel_path}"
                actual_hash = compute_file_sha256(bf)
                if actual_hash.lower() != expected_hash.lower():
                    return False, ErrorCode.BACKUP_CORRUPTED, f"Checksum mismatch in backup file {rel_path}"

            return True, ErrorCode.NONE, "Backup verified intact"
        except Exception as e:
            return False, ErrorCode.BACKUP_CORRUPTED, f"Failed to verify backup: {str(e)}"

    def restore_backup(self, backup_dir: Path, target_dir: Path) -> Tuple[bool, ErrorCode, str]:
        """
        Restores the target directory from the backup snapshot and verifies integrity.
        """
        # First verify backup itself
        is_ok, err, msg = self.verify_backup(backup_dir)
        if not is_ok:
            return False, err, f"Cannot restore corrupted backup: {msg}"

        manifest_file = backup_dir / "backup_manifest.json"
        with open(manifest_file, "r", encoding="utf-8") as mf:
            manifest: Dict[str, str] = json.load(mf)

        try:
            # Copy all files from backup to target
            for rel_path, expected_hash in manifest.items():
                src_file = backup_dir / rel_path
                dest_file = target_dir / rel_path
                dest_file.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(src_file, dest_file)

                # Verify copied file
                restored_hash = compute_file_sha256(dest_file)
                if restored_hash.lower() != expected_hash.lower():
                    return (
                        False,
                        ErrorCode.ROLLBACK_FAILED,
                        f"Checksum mismatch on restored file: {rel_path}",
                    )

            return True, ErrorCode.NONE, "Rollback restored and verified successfully"

        except PermissionError as pe:
            return False, ErrorCode.FILE_LOCKED, f"Permission error or file locked during rollback: {str(pe)}"
        except OSError as oe:
            return False, ErrorCode.ROLLBACK_FAILED, f"OS error during rollback: {str(oe)}"
        except Exception as e:
            return False, ErrorCode.ROLLBACK_FAILED, f"Rollback restoration failed: {str(e)}"
