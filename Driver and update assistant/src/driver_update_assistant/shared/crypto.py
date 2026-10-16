"""Role-neutral cryptographic utilities, release signatures, and archive file rules."""

import hashlib
import hmac
from pathlib import Path
from typing import TYPE_CHECKING, Set

if TYPE_CHECKING:
    from driver_update_assistant.protocol import ReleaseMetadata

# Allowed file extensions for static extension assets
ALLOWED_EXTENSIONS: Set[str] = {
    ".js", ".json", ".css", ".html", ".htm",
    ".png", ".jpg", ".jpeg", ".gif", ".svg", ".ico", ".webp",
    ".txt", ".md", ".woff", ".woff2", ".ttf", ".map"
}

# Forbidden file extensions that must never exist inside extension packages
FORBIDDEN_EXTENSIONS: Set[str] = {
    ".exe", ".bat", ".cmd", ".vbs", ".ps1", ".scr", ".pif", ".dll", ".sys", ".sh", ".py"
}


def compute_file_sha256(filepath: Path) -> str:
    """Computes SHA-256 digest of a file in chunks without loading entire file in memory."""
    h = hashlib.sha256()
    with open(filepath, "rb") as f:
        while chunk := f.read(65536):
            h.update(chunk)
    return h.hexdigest()


def compute_release_signature(
    product_id: str,
    version: str,
    release_id: str,
    package_sha256: str,
    package_size: int,
    secret_key: str,
) -> str:
    """Computes HMAC-SHA256 signature for release metadata."""
    payload = f"{product_id}:{version}:{release_id}:{package_sha256}:{package_size}".encode("utf-8")
    return hmac.new(secret_key.encode("utf-8"), payload, hashlib.sha256).hexdigest()


def verify_release_signature(metadata: "ReleaseMetadata", verification_secret: str) -> bool:
    """Validates the HMAC-SHA256 release signature against the package metadata."""
    expected_sig = compute_release_signature(
        metadata.product_id,
        metadata.version,
        metadata.release_id,
        metadata.package_sha256,
        metadata.package_size,
        verification_secret,
    )
    return hmac.compare_digest(metadata.signature, expected_sig)
