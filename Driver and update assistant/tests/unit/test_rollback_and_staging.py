"""Unit tests for staging extraction, snapshot backup, and atomic rollback."""

import json
import os
import shutil
import tempfile
import time
import unittest
import zipfile
from pathlib import Path

import sys
from pathlib import Path

# Bootstrap sys.path
_src = Path(__file__).resolve().parent.parent.parent / "src"
if str(_src) not in sys.path:
    sys.path.insert(0, str(_src))

from driver_update_assistant.protocol import ErrorCode, ReleaseMetadata
from driver_update_assistant.server.release_store import compute_file_sha256
from driver_update_assistant.updater.health_check import verify_installed_extension_health
from driver_update_assistant.updater.installer import apply_staged_files, check_target_writable
from driver_update_assistant.updater.rollback import RollbackManager
from driver_update_assistant.updater.staging import stage_package


class TestStagingAndRollback(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.mkdtemp()
        self.staging_root = Path(self.temp_dir) / "staging"
        self.backup_root = Path(self.temp_dir) / "backups"
        self.target_dir = Path(self.temp_dir) / "extension"

        self.staging_root.mkdir()
        self.backup_root.mkdir()
        self.target_dir.mkdir()

        # Seed initial target directory (v19.0)
        with open(self.target_dir / "manifest.json", "w", encoding="utf-8") as f:
            json.dump({"name": "Delivery Assistant", "version": "19.0"}, f)
        with open(self.target_dir / "background.js", "w", encoding="utf-8") as f:
            f.write("// Service worker v19\n")
        with open(self.target_dir / "ui-render.js", "w", encoding="utf-8") as f:
            f.write("// UI render v19\n")
        with open(self.target_dir / "shortcuts.js", "w", encoding="utf-8") as f:
            f.write("// Shortcuts v19\n")
        with open(self.target_dir / "content.js", "w", encoding="utf-8") as f:
            f.write("// Content v19\n")

    def tearDown(self):
        shutil.rmtree(self.temp_dir, ignore_errors=True)

    def _create_zip_package(self, release_id: str, files: dict) -> Tuple[Path, ReleaseMetadata]:
        pkg_path = Path(self.temp_dir) / f"{release_id}.zip"
        files_manifest = {}
        with zipfile.ZipFile(pkg_path, "w", zipfile.ZIP_DEFLATED) as zf:
            for name, content in files.items():
                zf.writestr(name, content)

        # Unpack temporarily to compute manifest hashes
        with zipfile.ZipFile(pkg_path, "r") as zf:
            for name in zf.namelist():
                content = zf.read(name)
                files_manifest[name] = compute_file_sha256(pkg_path)  # Mock manifest

        meta = ReleaseMetadata(
            product_id="delivery_assistant",
            version="20.0",
            release_id=release_id,
            min_updater_version="1.0.0",
            package_size=pkg_path.stat().st_size,
            package_sha256=compute_file_sha256(pkg_path),
            files_manifest={},
            signature="mock_sig",
            timestamp=time.time(),
        )
        return pkg_path, meta

    def test_safe_staging_extraction(self):
        files = {
            "manifest.json": json.dumps({"name": "Delivery Assistant", "version": "20.0"}),
            "background.js": "// Service worker v20\n",
        }
        pkg, meta = self._create_zip_package("rel_20_staging", files)
        ok, err, msg, staged_path = stage_package(pkg, self.staging_root, meta)

        self.assertTrue(ok)
        self.assertEqual(err, ErrorCode.NONE)
        self.assertIsNotNone(staged_path)
        self.assertTrue((staged_path / "manifest.json").exists())
        self.assertTrue((staged_path / "background.js").exists())

    def test_backup_and_verified_rollback(self):
        mgr = RollbackManager(self.backup_root)

        # 1. Create backup of v19.0
        ok, err, msg, backup_dir = mgr.create_backup(self.target_dir, "19.0")
        self.assertTrue(ok)
        self.assertIsNotNone(backup_dir)
        self.assertTrue((backup_dir / "backup_manifest.json").exists())

        # 2. Simulate bad installation or corruption in target directory
        with open(self.target_dir / "manifest.json", "w", encoding="utf-8") as f:
            f.write("corrupted or broken content")
        with open(self.target_dir / "background.js", "w", encoding="utf-8") as f:
            f.write("syntax error!!")

        # 3. Restore backup
        ok, err, msg = mgr.restore_backup(backup_dir, self.target_dir)
        self.assertTrue(ok)
        self.assertEqual(err, ErrorCode.NONE)

        # 4. Verify target directory restored to working v19.0
        with open(self.target_dir / "manifest.json", "r", encoding="utf-8") as f:
            restored = json.load(f)
        self.assertEqual(restored.get("version"), "19.0")

    def test_health_check_passes_on_valid_extension(self):
        ok, err, msg = verify_installed_extension_health(self.target_dir, "19.0")
        self.assertTrue(ok)
        self.assertEqual(err, ErrorCode.NONE)

    def test_health_check_fails_on_missing_core_file(self):
        (self.target_dir / "background.js").unlink()
        ok, err, msg = verify_installed_extension_health(self.target_dir, "19.0")
        self.assertFalse(ok)
        self.assertEqual(err, ErrorCode.HEALTH_CHECK_FAILED)


if __name__ == "__main__":
    unittest.main()
