"""Streaming package downloader with bounded memory, timeout, and size limits."""

import hashlib
import os
import shutil
import urllib.error
import urllib.request
from pathlib import Path
from typing import Optional, Tuple

from driver_update_assistant.protocol import ErrorCode


def download_package(
    url: str,
    target_path: Path,
    device_id: str,
    device_token: str,
    max_size_bytes: int = 50 * 1024 * 1024,
    timeout_seconds: float = 30.0,
) -> Tuple[bool, ErrorCode, str, Optional[Path]]:
    """
    Streams package from server to disk.
    Returns (success, error_code, reason, output_path).
    """
    target_path.parent.mkdir(parents=True, exist_ok=True)
    part_path = target_path.with_suffix(".part")

    req = urllib.request.Request(
        url=url,
        headers={
            "User-Agent": "DeliveryAssistantUpdater/1.0",
            "x-device-id": device_id,
            "x-device-token": device_token,
            "Authorization": f"Bearer {device_token}",
        },
    )

    h = hashlib.sha256()
    bytes_downloaded = 0

    try:
        with urllib.request.urlopen(req, timeout=timeout_seconds) as response:
            if response.status != 200:
                return (
                    False,
                    ErrorCode.SERVER_UNAVAILABLE,
                    f"Server returned HTTP status {response.status}",
                    None,
                )

            with open(part_path, "wb") as out_f:
                while True:
                    chunk = response.read(65536)
                    if not chunk:
                        break
                    bytes_downloaded += len(chunk)
                    if bytes_downloaded > max_size_bytes:
                        out_f.close()
                        if part_path.exists():
                            part_path.unlink()
                        return (
                            False,
                            ErrorCode.PACKAGE_TOO_LARGE,
                            f"Downloaded data exceeded maximum size {max_size_bytes} bytes",
                            None,
                        )
                    h.update(chunk)
                    out_f.write(chunk)

        # Atomic rename to final path
        if target_path.exists():
            target_path.unlink()
        part_path.replace(target_path)
        return True, ErrorCode.NONE, "Download complete", target_path

    except urllib.error.HTTPError as he:
        if part_path.exists():
            part_path.unlink()
        if he.code == 401 or he.code == 403:
            return False, ErrorCode.AUTH_FAILED, f"Authentication failed: {he.reason}", None
        return False, ErrorCode.SERVER_UNAVAILABLE, f"HTTP Error {he.code}: {he.reason}", None

    except urllib.error.URLError as ue:
        if part_path.exists():
            part_path.unlink()
        return False, ErrorCode.SERVER_UNAVAILABLE, f"Network error: {str(ue.reason)}", None

    except TimeoutError:
        if part_path.exists():
            part_path.unlink()
        return False, ErrorCode.TIMEOUT, "Download timed out", None

    except OSError as oe:
        if part_path.exists():
            part_path.unlink()
        # Disk full or permission error
        if getattr(oe, "errno", None) in (28, 122) or "space" in str(oe).lower():
            return False, ErrorCode.DISK_FULL, f"Disk full during download: {str(oe)}", None
        return False, ErrorCode.PERMISSION_DENIED, f"Filesystem error: {str(oe)}", None

    except Exception as e:
        if part_path.exists():
            part_path.unlink()
        return False, ErrorCode.SERVER_UNAVAILABLE, f"Download failed: {str(e)}", None
