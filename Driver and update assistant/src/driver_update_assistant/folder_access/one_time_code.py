"""Cryptographically secure One-Time Passcode (OTP) generator and validator."""

import hashlib
import hmac
import secrets
import time
from typing import Tuple


def generate_secure_otp(length: int = 8) -> Tuple[str, str]:
    """
    Generates a cryptographically secure numeric OTP using secrets.randbelow.
    Returns (clean_code, formatted_code).
    """
    if length < 6 or length > 10:
        length = 8
    max_val = 10 ** length
    num = secrets.randbelow(max_val)
    clean_code = f"{num:0{length}d}"

    # Format e.g. 12345678 -> 1234-5678
    mid = length // 2
    formatted_code = f"{clean_code[:mid]}-{clean_code[mid:]}"
    return clean_code, formatted_code


def compute_otp_hash(clean_code: str, request_id: str, device_id: str, secret_key: str) -> str:
    """Computes HMAC-SHA256 challenge hash bound to the specific request and device."""
    payload = f"{clean_code.strip()}:{request_id.strip()}:{device_id.strip()}".encode("utf-8")
    return hmac.new(secret_key.encode("utf-8"), payload, hashlib.sha256).hexdigest()


def verify_otp_code(
    submitted_code: str,
    expected_hash: str,
    request_id: str,
    device_id: str,
    secret_key: str,
    expires_at: float,
    current_attempts: int,
    max_attempts: int = 3,
) -> Tuple[bool, str]:
    """
    Validates a submitted code against expected challenge hash with attempt and expiry checks.
    Returns (is_valid, reason).
    """
    if time.time() > expires_at:
        return False, "OTP_EXPIRED"

    if current_attempts >= max_attempts:
        return False, "OTP_MAX_ATTEMPTS"

    clean_code = submitted_code.replace("-", "").strip()
    computed = compute_otp_hash(clean_code, request_id, device_id, secret_key)

    if not hmac.compare_digest(expected_hash, computed):
        return False, "OTP_INVALID"

    return True, "VALID"
