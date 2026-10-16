"""Release store for managing, signing, and serving update packages."""

import hashlib
import hmac
import json
import os
import time
import zipfile
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from driver_update_assistant.protocol import ReleaseMetadata
from driver_update_assistant.shared.crypto import (
    ALLOWED_EXTENSIONS,
    FORBIDDEN_EXTENSIONS,
    compute_file_sha256,
    compute_release_signature,
    verify_release_signature,
)


class ReleaseStore:
    """Manages publishing, validation, and retrieval of extension packages."""

    def __init__(self, releases_dir: str):
        self.releases_dir = Path(releases_dir)
        self.releases_dir.mkdir(parents=True, exist_ok=True)

    def publish_release(
        self,
        version: str,
        source_dir: str,
        secret_key: str,
        notes: str = "",
        min_updater_version: str = "1.0.0",
        product_id: str = "delivery_assistant",
    ) -> Tuple[ReleaseMetadata, Path]:
        """Packages, validates, signs, and stores a new extension release."""
        src_path = Path(source_dir).resolve()
        if not src_path.is_dir():
            raise ValueError(f"Source directory does not exist: {source_dir}")

        manifest_file = src_path / "manifest.json"
        if not manifest_file.exists():
            raise ValueError(f"Missing manifest.json in source directory: {source_dir}")

        with open(manifest_file, "r", encoding="utf-8") as f:
            manifest_json = json.load(f)

        manifest_version = manifest_json.get("version")
        if manifest_version != version:
            raise ValueError(
                f"Version mismatch: requested '{version}' but manifest.json has '{manifest_version}'"
            )

        release_id = f"rel_{version}_{int(time.time())}"
        zip_filename = f"{product_id}_{version}_{release_id}.zip"
        zip_path = self.releases_dir / zip_filename

        files_manifest: Dict[str, str] = {}

        # Inspect all source files for path safety and forbidden executables
        with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
            for root, _, files in os.walk(src_path):
                for file in sorted(files):
                    file_path = Path(root) / file
                    rel_path = file_path.relative_to(src_path).as_posix()

                    # Prevent traversal or hidden dangerous patterns
                    if ".." in rel_path or rel_path.startswith("/"):
                        raise ValueError(f"Illegal relative path in source: {rel_path}")

                    ext = file_path.suffix.lower()
                    if ext in FORBIDDEN_EXTENSIONS:
                        raise ValueError(f"Forbidden executable file in package: {rel_path}")

                    file_hash = compute_file_sha256(file_path)
                    files_manifest[rel_path] = file_hash
                    zf.write(file_path, arcname=rel_path)

        package_size = zip_path.stat().st_size
        package_sha256 = compute_file_sha256(zip_path)

        signature = compute_release_signature(
            product_id=product_id,
            version=version,
            release_id=release_id,
            package_sha256=package_sha256,
            package_size=package_size,
            secret_key=secret_key,
        )

        metadata = ReleaseMetadata(
            product_id=product_id,
            version=version,
            release_id=release_id,
            min_updater_version=min_updater_version,
            package_size=package_size,
            package_sha256=package_sha256,
            files_manifest=files_manifest,
            signature=signature,
            timestamp=time.time(),
            release_notes=notes,
        )

        metadata_path = self.releases_dir / f"{release_id}.json"
        with open(metadata_path, "w", encoding="utf-8") as f:
            json.dump(metadata.to_dict(), f, indent=2)

        return metadata, zip_path

    def get_release_metadata(self, release_id: str) -> Optional[ReleaseMetadata]:
        """Loads metadata for a specific release ID."""
        meta_file = self.releases_dir / f"{release_id}.json"
        if not meta_file.exists():
            return None
        with open(meta_file, "r", encoding="utf-8") as f:
            data = json.load(f)
        return ReleaseMetadata.from_dict(data)

    def get_package_path(self, release_id: str) -> Optional[Path]:
        """Finds the package zip file for a given release ID."""
        for p in self.releases_dir.glob(f"*_{release_id}.zip"):
            if p.is_file():
                return p
        return None

    def get_latest_release(self) -> Optional[ReleaseMetadata]:
        """Returns the release with the highest timestamp or version."""
        releases: List[ReleaseMetadata] = []
        for meta_file in self.releases_dir.glob("rel_*.json"):
            try:
                with open(meta_file, "r", encoding="utf-8") as f:
                    data = json.load(f)
                releases.append(ReleaseMetadata.from_dict(data))
            except Exception:
                continue

        if not releases:
            return None

        # Sort by timestamp descending
        releases.sort(key=lambda r: r.timestamp, reverse=True)
        return releases[0]
