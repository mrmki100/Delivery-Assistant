"""Safe staging and extraction engine for update packages."""

import os
import shutil
import zipfile
from pathlib import Path
from typing import Optional, Tuple

from driver_update_assistant.protocol import ErrorCode, ReleaseMetadata
from driver_update_assistant.shared.crypto import compute_file_sha256


def stage_package(
    package_path: Path,
    staging_root: Path,
    metadata: ReleaseMetadata,
) -> Tuple[bool, ErrorCode, str, Optional[Path]]:
    """
    Safely unpacks the validated package into an isolated staging directory.
    Validates against traversal escapes and checks per-file SHA-256 digests.
    """
    staging_dir = staging_root / metadata.release_id
    try:
        if staging_dir.exists():
            shutil.rmtree(staging_dir)
        staging_dir.mkdir(parents=True, exist_ok=True)
    except PermissionError as pe:
        return False, ErrorCode.PERMISSION_DENIED, f"Permission denied creating staging dir: {str(pe)}", None
    except OSError as oe:
        if "space" in str(oe).lower():
            return False, ErrorCode.DISK_FULL, f"Disk full creating staging dir: {str(oe)}", None
        return False, ErrorCode.PERMISSION_DENIED, f"OS error preparing staging: {str(oe)}", None

    resolved_staging = staging_dir.resolve()

    try:
        with zipfile.ZipFile(package_path, "r") as zf:
            for info in zf.infolist():
                entry_name = info.filename
                # Prevent path traversal
                if entry_name.startswith("/") or entry_name.startswith("\\") or ".." in entry_name or ":" in entry_name:
                    shutil.rmtree(staging_dir, ignore_errors=True)
                    return (
                        False,
                        ErrorCode.PATH_TRAVERSAL_DETECTED,
                        f"Zip entry violates path containment: {entry_name}",
                        None,
                    )

                extracted_target = (staging_dir / entry_name).resolve()
                if not str(extracted_target).startswith(str(resolved_staging)):
                    shutil.rmtree(staging_dir, ignore_errors=True)
                    return (
                        False,
                        ErrorCode.PATH_TRAVERSAL_DETECTED,
                        f"Entry resolves outside staging directory: {entry_name}",
                        None,
                    )

                zf.extract(info, staging_dir)

        # Validate per-file checksums against files_manifest if provided
        if metadata.files_manifest:
            for rel_path, expected_hash in metadata.files_manifest.items():
                file_path = staging_dir / rel_path
                if not file_path.is_file():
                    shutil.rmtree(staging_dir, ignore_errors=True)
                    return (
                        False,
                        ErrorCode.PACKAGE_TRUNCATED,
                        f"Missing expected file from manifest: {rel_path}",
                        None,
                    )
                actual_hash = compute_file_sha256(file_path)
                if actual_hash.lower() != expected_hash.lower():
                    shutil.rmtree(staging_dir, ignore_errors=True)
                    return (
                        False,
                        ErrorCode.HASH_MISMATCH,
                        f"File hash mismatch for {rel_path}: expected {expected_hash}, got {actual_hash}",
                        None,
                    )

        return True, ErrorCode.NONE, "Staging completed successfully", staging_dir

    except OSError as oe:
        shutil.rmtree(staging_dir, ignore_errors=True)
        if "space" in str(oe).lower():
            return False, ErrorCode.DISK_FULL, f"Disk full during staging: {str(oe)}", None
        return False, ErrorCode.PERMISSION_DENIED, f"I/O error during extraction: {str(oe)}", None
    except Exception as e:
        shutil.rmtree(staging_dir, ignore_errors=True)
        return False, ErrorCode.METADATA_MALFORMED, f"Extraction failed: {str(e)}", None
