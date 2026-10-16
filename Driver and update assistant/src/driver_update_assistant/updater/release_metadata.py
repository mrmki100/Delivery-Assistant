"""Validation and comparison logic for update release metadata."""

import re
from typing import Any, Dict, List, Tuple
from driver_update_assistant.protocol import ErrorCode, ReleaseMetadata


def parse_version(v_str: str) -> Tuple[int, ...]:
    """Parses a version string into a tuple of integers for comparison."""
    clean = re.sub(r"[^\d\.]", "", v_str.strip())
    parts = clean.split(".")
    try:
        return tuple(int(p) for p in parts if p)
    except ValueError:
        return (0,)


def is_version_newer(target_version: str, current_version: str) -> bool:
    """Returns True if target_version is strictly newer than current_version."""
    return parse_version(target_version) > parse_version(current_version)


def validate_release_metadata(
    data: Dict[str, Any],
    expected_product_id: str = "delivery_assistant",
    current_version: str = "0.0.0",
    allow_downgrade: bool = False,
) -> Tuple[bool, ErrorCode, str, Optional[ReleaseMetadata]]:
    """
    Validates release metadata schema, product identity, and version progression.
    Returns (is_valid, error_code, reason, metadata_obj).
    """
    required_fields = ["product_id", "version", "release_id", "package_size", "package_sha256", "signature"]
    for f in required_fields:
        if f not in data or data[f] is None:
            return False, ErrorCode.METADATA_MALFORMED, f"Missing required field: {f}", None

    if data["product_id"] != expected_product_id:
        return (
            False,
            ErrorCode.INCOMPATIBLE_RELEASE,
            f"Product ID mismatch: expected '{expected_product_id}', got '{data['product_id']}'",
            None,
        )

    target_ver = str(data["version"])
    if not allow_downgrade and parse_version(target_ver) <= parse_version(current_version):
        return (
            False,
            ErrorCode.VERSION_CONFLICT,
            f"Target version {target_ver} is not newer than current {current_version}",
            None,
        )

    try:
        meta = ReleaseMetadata.from_dict(data)
        return True, ErrorCode.NONE, "Metadata valid", meta
    except Exception as e:
        return False, ErrorCode.METADATA_MALFORMED, f"Failed to parse metadata: {str(e)}", None
