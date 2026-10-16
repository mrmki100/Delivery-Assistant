"""Authentication and authorization middleware logic for Admin Server."""

import hmac
from typing import Optional, Tuple
from driver_update_assistant.server.device_registry import DeviceRegistry


def authenticate_request(
    headers: dict,
    device_registry: DeviceRegistry,
    require_enrollment: bool = True,
) -> Tuple[bool, str, Optional[str]]:
    """
    Validates device authentication from request headers.
    Returns (is_authorized, status_code_or_reason, device_id).
    """
    device_id = headers.get("x-device-id") or headers.get("X-Device-Id")
    auth_header = headers.get("authorization") or headers.get("Authorization") or ""

    token = None
    if auth_header.startswith("Bearer "):
        token = auth_header[7:].strip()
    elif "x-device-token" in headers or "X-Device-Token" in headers:
        token = headers.get("x-device-token") or headers.get("X-Device-Token")

    if not device_id or not token:
        if not require_enrollment:
            return True, "AUTHORIZED", device_id or "ANONYMOUS"
        return False, "AUTH_MISSING_CREDENTIALS", None

    is_valid, status = device_registry.verify_device(device_id, token)
    if not is_valid:
        return False, status, device_id

    return True, "AUTHORIZED", device_id


def authenticate_admin(headers: dict, secret_key: str) -> bool:
    """Validates admin operations against the configured secret key."""
    auth_header = headers.get("authorization") or headers.get("Authorization") or ""
    token = None
    if auth_header.startswith("Bearer "):
        token = auth_header[7:].strip()
    elif "x-admin-token" in headers or "X-Admin-Token" in headers:
        token = headers.get("x-admin-token") or headers.get("X-Admin-Token")

    if not token:
        return False

    return hmac.compare_digest(token, secret_key)
