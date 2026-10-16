"""Cryptographic and archive structure verifier."""

import hashlib
import hmac
import json
import zipfile
from pathlib import Path
from typing import Optional, Tuple

from driver_update_assistant.protocol import ErrorCode, ReleaseMetadata
from driver_update_assistant.shared.crypto import (
    FORBIDDEN_EXTENSIONS,
    compute_file_sha256,
    verify_release_signature,
)


def verify_package_file(
    package_path: Path,
    metadata: ReleaseMetadata,
    verification_secret: str,
    max_size_bytes: int = 50 * 1024 * 1024,
) -> Tuple[bool, ErrorCode, str]:
    """
    Validates package hash, digital signature, size bounds, and zip security.
    Returns (is_valid, error_code, reason).
    """
    if not package_path.is_file():
        return False, ErrorCode.PACKAGE_TRUNCATED, "Package file does not exist on disk"

    # 1. Size verification
    actual_size = package_path.stat().st_size
    if actual_size > max_size_bytes:
        return False, ErrorCode.PACKAGE_TOO_LARGE, f"Package size {actual_size} exceeds max {max_size_bytes}"

    if actual_size != metadata.package_size:
        return (
            False,
            ErrorCode.PACKAGE_TRUNCATED,
            f"Package size mismatch: expected {metadata.package_size}, actual {actual_size}",
        )

    # 2. SHA-256 hash verification
    actual_hash = compute_file_sha256(package_path)
    if not hmac.compare_digest(actual_hash.lower(), metadata.package_sha256.lower()):
        return (
            False,
            ErrorCode.HASH_MISMATCH,
            f"Package SHA-256 mismatch: expected {metadata.package_sha256}, actual {actual_hash}",
        )

    # 3. Cryptographic signature verification
    if not verify_release_signature(metadata, verification_secret):
        return False, ErrorCode.SIGNATURE_INVALID, "Cryptographic release signature verification failed"

    # 4. Zip archive inspection (Path traversal & forbidden content)
    try:
        with zipfile.ZipFile(package_path, "r") as zf:
            namelist = zf.namelist()
            if not namelist:
                return False, ErrorCode.PACKAGE_TRUNCATED, "Package zip archive is empty"

            has_manifest = False
            for entry in namelist:
                # Security: Path traversal checks
                if ".." in entry or entry.startswith("/") or entry.startswith("\\") or ":" in entry:
                    return (
                        False,
                        ErrorCode.PATH_TRAVERSAL_DETECTED,
                        f"Malicious path traversal entry in package: {entry}",
                    )

                # Security: Forbidden executable file extensions
                suffix = Path(entry).suffix.lower()
                if suffix in FORBIDDEN_EXTENSIONS:
                    return (
                        False,
                        ErrorCode.FORBIDDEN_FILE_TYPE,
                        f"Forbidden executable file type detected in package: {entry}",
                    )

                if entry == "manifest.json":
                    has_manifest = True

            if not has_manifest:
                return False, ErrorCode.METADATA_MALFORMED, "Package archive does not contain manifest.json"

            # 5. Check manifest.json version inside zip matches metadata.version
            with zf.open("manifest.json") as mf:
                manifest_data = json.load(mf)
                zip_version = manifest_data.get("version")
                if zip_version != metadata.version:
                    return (
                        False,
                        ErrorCode.VERSION_CONFLICT,
                        f"manifest.json inside zip version '{zip_version}' conflicts with release metadata '{metadata.version}'",
                    )

    except zipfile.BadZipFile:
        return False, ErrorCode.PACKAGE_TRUNCATED, "Package is not a valid zip archive"
    except Exception as e:
        return False, ErrorCode.METADATA_MALFORMED, f"Archive verification error: {str(e)}"

    return True, ErrorCode.NONE, "Package verified successfully"
