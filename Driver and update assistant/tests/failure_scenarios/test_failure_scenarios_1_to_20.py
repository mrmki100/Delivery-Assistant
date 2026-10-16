"""Automated tests for Failure Scenarios 01 through 20 (Section 8)."""

import json
import os
import shutil
import tempfile
import time
import unittest
import urllib.error
import zipfile
from pathlib import Path
from unittest.mock import MagicMock, patch

import sys
from pathlib import Path

# Bootstrap sys.path
_src = Path(__file__).resolve().parent.parent.parent / "src"
if str(_src) not in sys.path:
    sys.path.insert(0, str(_src))

from driver_update_assistant.client import AgentClient
from driver_update_assistant.config import AgentConfig
from driver_update_assistant.protocol import ErrorCode, ReleaseMetadata, UpdateState
from driver_update_assistant.server.release_store import compute_file_sha256, compute_release_signature
from driver_update_assistant.updater.downloader import download_package
from driver_update_assistant.updater.installer import apply_staged_files
from driver_update_assistant.updater.rollback import RollbackManager
from driver_update_assistant.updater.staging import stage_package
from driver_update_assistant.updater.verifier import verify_package_file


class TestFailureScenarios1to20(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.mkdtemp()
        self.agent_dir = Path(self.temp_dir) / "agent_data"
        self.ext_dir = Path(self.temp_dir) / "extension"
        self.agent_dir.mkdir(parents=True)
        self.ext_dir.mkdir(parents=True)

        # Baseline extension v19.0
        with open(self.ext_dir / "manifest.json", "w", encoding="utf-8") as f:
            json.dump({"name": "Delivery Assistant", "version": "19.0"}, f)
        for fn in ("background.js", "ui-render.js", "shortcuts.js", "content.js"):
            with open(self.ext_dir / fn, "w", encoding="utf-8") as f:
                f.write(f"// {fn} baseline\n")

        self.config = AgentConfig(
            device_id="DEV-TEST",
            server_url="http://127.0.0.1:18888",
            device_token="tok_123",
            extension_dir=str(self.ext_dir),
            data_dir=str(self.agent_dir),
            log_dir=str(self.agent_dir / "logs"),
            staging_dir=str(self.agent_dir / "staging"),
            backup_dir=str(self.agent_dir / "backups"),
            verification_secret="sec_123",
            max_package_size_bytes=1024 * 1024,  # 1MB
        )
        self.client = AgentClient(self.config)

    def tearDown(self):
        shutil.rmtree(self.temp_dir, ignore_errors=True)

    # 01. Server unavailable before the version check
    def test_scenario_01_server_unavailable_before_version_check(self):
        with patch("urllib.request.urlopen", side_effect=urllib.error.URLError("Connection refused")):
            ok, err, msg, meta = self.client.check_for_update()
            self.assertFalse(ok)
            self.assertEqual(err, ErrorCode.SERVER_UNAVAILABLE)
            self.assertIsNone(meta)

    # 02. Server becomes unavailable during package download
    def test_scenario_02_server_unavailable_during_download(self):
        with patch("urllib.request.urlopen", side_effect=urllib.error.URLError("Connection reset")):
            dest = self.agent_dir / "pkg.zip"
            ok, err, msg, path = download_package("http://server/pkg.zip", dest, "DEV", "tok")
            self.assertFalse(ok)
            self.assertEqual(err, ErrorCode.SERVER_UNAVAILABLE)

    # 03. Wi-Fi disconnects halfway through transfer
    def test_scenario_03_wifi_disconnects_halfway(self):
        mock_resp = MagicMock()
        mock_resp.status = 200
        mock_resp.read.side_effect = [b"first_chunk_500_bytes", ConnectionResetError("Wi-Fi dropped")]
        with patch("urllib.request.urlopen", return_value=mock_resp):
            dest = self.agent_dir / "pkg.zip"
            ok, err, msg, path = download_package("http://server/pkg.zip", dest, "DEV", "tok")
            self.assertFalse(ok)
            self.assertEqual(err, ErrorCode.SERVER_UNAVAILABLE)

    # 04. Connection times out during metadata retrieval
    def test_scenario_04_timeout_during_metadata_retrieval(self):
        with patch("urllib.request.urlopen", side_effect=TimeoutError("Request timed out")):
            ok, err, msg, meta = self.client.check_for_update()
            self.assertFalse(ok)
            self.assertEqual(err, ErrorCode.SERVER_UNAVAILABLE)

    # 05. HTTP error response from the server (e.g. 500)
    def test_scenario_05_http_500_error(self):
        http_err = urllib.error.HTTPError("http://srv", 500, "Internal Server Error", {}, None)
        with patch("urllib.request.urlopen", side_effect=http_err):
            ok, err, msg, meta = self.client.check_for_update()
            self.assertFalse(ok)
            self.assertEqual(err, ErrorCode.SERVER_UNAVAILABLE)

    # 06. Authentication failure (401 Unauthorized)
    def test_scenario_06_authentication_failure(self):
        http_err = urllib.error.HTTPError("http://srv", 401, "Unauthorized", {}, None)
        with patch("urllib.request.urlopen", side_effect=http_err):
            ok, err, msg, meta = self.client.check_for_update()
            self.assertFalse(ok)
            self.assertEqual(err, ErrorCode.AUTH_FAILED)

    # 07. Device enrollment revoked during an update (403 Forbidden)
    def test_scenario_07_device_revoked(self):
        http_err = urllib.error.HTTPError("http://srv", 403, "Forbidden - Device Revoked", {}, None)
        with patch("urllib.request.urlopen", side_effect=http_err):
            ok, err, msg, meta = self.client.check_for_update()
            self.assertFalse(ok)
            self.assertEqual(err, ErrorCode.AUTH_FAILED)

    # 08. Downloaded package is truncated (size mismatch)
    def test_scenario_08_downloaded_package_truncated(self):
        pkg = self.agent_dir / "truncated.zip"
        with open(pkg, "wb") as f:
            f.write(b"PK\x03\x04truncated")

        meta = ReleaseMetadata(
            product_id="delivery_assistant",
            version="20.0",
            release_id="rel_20",
            min_updater_version="1.0.0",
            package_size=50000,  # Expects 50K bytes
            package_sha256=compute_file_sha256(pkg),
            files_manifest={},
            signature="sig",
            timestamp=time.time(),
        )
        ok, err, msg = verify_package_file(pkg, meta, "sec_123")
        self.assertFalse(ok)
        self.assertEqual(err, ErrorCode.PACKAGE_TRUNCATED)

    # 09. Downloaded package has the wrong SHA-256 hash
    def test_scenario_09_package_wrong_sha256_hash(self):
        pkg = self.agent_dir / "badhash.zip"
        with zipfile.ZipFile(pkg, "w") as zf:
            zf.writestr("manifest.json", json.dumps({"version": "20.0"}))

        meta = ReleaseMetadata(
            product_id="delivery_assistant",
            version="20.0",
            release_id="rel_20",
            min_updater_version="1.0.0",
            package_size=pkg.stat().st_size,
            package_sha256="0000000000000000000000000000000000000000000000000000000000000000",
            files_manifest={},
            signature="sig",
            timestamp=time.time(),
        )
        ok, err, msg = verify_package_file(pkg, meta, "sec_123")
        self.assertFalse(ok)
        self.assertEqual(err, ErrorCode.HASH_MISMATCH)

    # 10. Release signature is invalid
    def test_scenario_10_release_signature_invalid(self):
        pkg = self.agent_dir / "badsig.zip"
        with zipfile.ZipFile(pkg, "w") as zf:
            zf.writestr("manifest.json", json.dumps({"version": "20.0"}))

        meta = ReleaseMetadata(
            product_id="delivery_assistant",
            version="20.0",
            release_id="rel_20",
            min_updater_version="1.0.0",
            package_size=pkg.stat().st_size,
            package_sha256=compute_file_sha256(pkg),
            files_manifest={},
            signature="forged_signature_123",
            timestamp=time.time(),
        )
        ok, err, msg = verify_package_file(pkg, meta, "sec_123")
        self.assertFalse(ok)
        self.assertEqual(err, ErrorCode.SIGNATURE_INVALID)

    # 11. Package metadata is malformed
    def test_scenario_11_package_metadata_malformed(self):
        pkg = self.agent_dir / "pkg.zip"
        with open(pkg, "wb") as f:
            f.write(b"not a zip file at all")
        pkg_size = pkg.stat().st_size
        pkg_hash = compute_file_sha256(pkg)
        sig = compute_release_signature("delivery_assistant", "20.0", "rel_20", pkg_hash, pkg_size, "sec_123")

        meta = ReleaseMetadata(
            product_id="delivery_assistant",
            version="20.0",
            release_id="rel_20",
            min_updater_version="1.0.0",
            package_size=pkg_size,
            package_sha256=pkg_hash,
            files_manifest={},
            signature=sig,
            timestamp=time.time(),
        )
        ok, err, msg = verify_package_file(pkg, meta, "sec_123")
        self.assertFalse(ok)
        self.assertEqual(err, ErrorCode.PACKAGE_TRUNCATED)

    # 12. Package version disagrees with manifest.json
    def test_scenario_12_package_version_disagrees_with_manifest(self):
        pkg = self.agent_dir / "ver_mismatch.zip"
        with zipfile.ZipFile(pkg, "w") as zf:
            zf.writestr("manifest.json", json.dumps({"version": "19.5"}))  # disagrees with 20.0

        pkg_size = pkg.stat().st_size
        pkg_hash = compute_file_sha256(pkg)
        sig = compute_release_signature("delivery_assistant", "20.0", "rel_20", pkg_hash, pkg_size, "sec_123")

        meta = ReleaseMetadata(
            product_id="delivery_assistant",
            version="20.0",
            release_id="rel_20",
            min_updater_version="1.0.0",
            package_size=pkg_size,
            package_sha256=pkg_hash,
            files_manifest={},
            signature=sig,
            timestamp=time.time(),
        )
        ok, err, msg = verify_package_file(pkg, meta, "sec_123")
        self.assertFalse(ok)
        self.assertEqual(err, ErrorCode.VERSION_CONFLICT)

    # 13. Archive contains path-traversal entries
    def test_scenario_13_archive_contains_path_traversal(self):
        pkg = self.agent_dir / "traversal.zip"
        with zipfile.ZipFile(pkg, "w") as zf:
            zf.writestr("manifest.json", json.dumps({"version": "20.0"}))
            zf.writestr("../../etc/passwd", "evil")

        pkg_size = pkg.stat().st_size
        pkg_hash = compute_file_sha256(pkg)
        sig = compute_release_signature("delivery_assistant", "20.0", "rel_20", pkg_hash, pkg_size, "sec_123")

        meta = ReleaseMetadata(
            product_id="delivery_assistant",
            version="20.0",
            release_id="rel_20",
            min_updater_version="1.0.0",
            package_size=pkg_size,
            package_sha256=pkg_hash,
            files_manifest={},
            signature=sig,
            timestamp=time.time(),
        )
        ok, err, msg = verify_package_file(pkg, meta, "sec_123")
        self.assertFalse(ok)
        self.assertEqual(err, ErrorCode.PATH_TRAVERSAL_DETECTED)

    # 14. Archive contains an unexpected file or link (e.g. .exe / .bat)
    def test_scenario_14_archive_contains_executable(self):
        pkg = self.agent_dir / "trojan.zip"
        with zipfile.ZipFile(pkg, "w") as zf:
            zf.writestr("manifest.json", json.dumps({"version": "20.0"}))
            zf.writestr("install.bat", "@echo off\r\nformat c:")

        pkg_size = pkg.stat().st_size
        pkg_hash = compute_file_sha256(pkg)
        sig = compute_release_signature("delivery_assistant", "20.0", "rel_20", pkg_hash, pkg_size, "sec_123")

        meta = ReleaseMetadata(
            product_id="delivery_assistant",
            version="20.0",
            release_id="rel_20",
            min_updater_version="1.0.0",
            package_size=pkg_size,
            package_sha256=pkg_hash,
            files_manifest={},
            signature=sig,
            timestamp=time.time(),
        )
        ok, err, msg = verify_package_file(pkg, meta, "sec_123")
        self.assertFalse(ok)
        self.assertEqual(err, ErrorCode.FORBIDDEN_FILE_TYPE)

    # 15. Package exceeds the configured size limit
    def test_scenario_15_package_exceeds_size_limit(self):
        pkg = self.agent_dir / "big.zip"
        with open(pkg, "wb") as f:
            f.write(b"0" * (2 * 1024 * 1024))  # 2MB > 1MB limit

        meta = ReleaseMetadata(
            product_id="delivery_assistant",
            version="20.0",
            release_id="rel_20",
            min_updater_version="1.0.0",
            package_size=pkg.stat().st_size,
            package_sha256="hash",
            files_manifest={},
            signature="sig",
            timestamp=time.time(),
        )
        ok, err, msg = verify_package_file(pkg, meta, "sec_123", max_size_bytes=1024 * 1024)
        self.assertFalse(ok)
        self.assertEqual(err, ErrorCode.PACKAGE_TOO_LARGE)

    # 16. Disk becomes full during download
    def test_scenario_16_disk_full_during_download(self):
        mock_resp = MagicMock()
        mock_resp.__enter__.return_value = mock_resp
        mock_resp.status = 200
        mock_resp.read.side_effect = [b"chunk1", OSError(28, "No space left on device")]
        with patch("urllib.request.urlopen", return_value=mock_resp):
            dest = self.agent_dir / "diskfull.zip"
            ok, err, msg, path = download_package("http://server/pkg.zip", dest, "DEV", "tok")
            self.assertFalse(ok)
            self.assertEqual(err, ErrorCode.DISK_FULL)

    # 17. Disk becomes full during staging
    def test_scenario_17_disk_full_during_staging(self):
        pkg = self.agent_dir / "valid_pkg.zip"
        with zipfile.ZipFile(pkg, "w") as zf:
            zf.writestr("manifest.json", json.dumps({"version": "20.0"}))
            zf.writestr("large.js", "content" * 100)

        meta = ReleaseMetadata(
            product_id="delivery_assistant",
            version="20.0",
            release_id="rel_20",
            min_updater_version="1.0.0",
            package_size=pkg.stat().st_size,
            package_sha256=compute_file_sha256(pkg),
            files_manifest={},
            signature="sig",
            timestamp=time.time(),
        )

        staging_dir = self.agent_dir / "staging"
        with patch("zipfile.ZipFile.extract", side_effect=OSError(28, "No space left on device")):
            ok, err, msg, path = stage_package(pkg, staging_dir, meta)
            self.assertFalse(ok)
            self.assertEqual(err, ErrorCode.DISK_FULL)

    # 18. Permission denied when creating the staging directory
    def test_scenario_18_permission_denied_staging_dir(self):
        staging_dir = self.agent_dir / "staging"
        pkg = self.agent_dir / "valid.zip"
        with zipfile.ZipFile(pkg, "w") as zf:
            zf.writestr("manifest.json", "{}")

        meta = ReleaseMetadata("delivery_assistant", "20.0", "rel_20", "1.0", 10, "h", {}, "s", time.time())
        with patch("pathlib.Path.mkdir", side_effect=PermissionError("Access denied")):
            ok, err, msg, path = stage_package(pkg, staging_dir, meta)
            self.assertFalse(ok)
            self.assertEqual(err, ErrorCode.PERMISSION_DENIED)

    # 19. Permission denied while creating a backup
    def test_scenario_19_permission_denied_creating_backup(self):
        mgr = RollbackManager(Path(self.agent_dir / "backups"))
        with patch("pathlib.Path.mkdir", side_effect=PermissionError("Access denied")):
            ok, err, msg, path = mgr.create_backup(self.ext_dir, "19.0")
            self.assertFalse(ok)
            self.assertEqual(err, ErrorCode.PERMISSION_DENIED)

    # 20. Existing extension files are locked or in use
    def test_scenario_20_existing_files_locked(self):
        staging_dir = self.agent_dir / "staging_sample"
        staging_dir.mkdir(parents=True)
        with open(staging_dir / "manifest.json", "w") as f:
            f.write("new content")

        with patch("builtins.open", side_effect=PermissionError("File locked by another process")):
            ok, err, msg, files = apply_staged_files(staging_dir, self.ext_dir)
            self.assertFalse(ok)
            self.assertEqual(err, ErrorCode.FILE_LOCKED)


if __name__ == "__main__":
    unittest.main()
