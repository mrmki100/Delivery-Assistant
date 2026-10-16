"""Unit tests for core security, cryptographic, and validation modules."""

import hashlib
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

from driver_update_assistant.folder_access.consent import validate_shareable_folder_path
from driver_update_assistant.folder_access.one_time_code import (
    compute_otp_hash,
    generate_secure_otp,
    verify_otp_code,
)
from driver_update_assistant.protocol import ErrorCode, ReleaseMetadata
from driver_update_assistant.server.release_store import compute_file_sha256, compute_release_signature
from driver_update_assistant.updater.release_metadata import is_version_newer, validate_release_metadata
from driver_update_assistant.updater.verifier import verify_package_file


class TestFolderConsentSecurity(unittest.TestCase):
    """Tests folder access blocklist, traversal prevention, and canonicalization."""

    def setUp(self):
        self.temp_dir = tempfile.mkdtemp()

    def tearDown(self):
        shutil.rmtree(self.temp_dir, ignore_errors=True)

    def test_reject_empty_path(self):
        ok, err, msg, _ = validate_shareable_folder_path("")
        self.assertFalse(ok)
        self.assertEqual(err, ErrorCode.FOLDER_NOT_FOUND)

    def test_reject_nonexistent_path(self):
        ok, err, msg, _ = validate_shareable_folder_path("C:\\Path\\That\\Definitely\\DoesNotExist\\12345")
        self.assertFalse(ok)
        self.assertEqual(err, ErrorCode.FOLDER_NOT_FOUND)

    def test_reject_drive_root(self):
        ok, err, msg, _ = validate_shareable_folder_path("C:\\")
        self.assertFalse(ok)
        self.assertEqual(err, ErrorCode.FOLDER_BLOCKED)

    def test_reject_windows_system_dir(self):
        windir = os.environ.get("SystemRoot", "C:\\Windows")
        ok, err, msg, _ = validate_shareable_folder_path(windir)
        self.assertFalse(ok)
        self.assertEqual(err, ErrorCode.FOLDER_BLOCKED)

    def test_reject_appdata(self):
        appdata = os.environ.get("APPDATA")
        if appdata:
            ok, err, msg, _ = validate_shareable_folder_path(appdata)
            self.assertFalse(ok)
            self.assertEqual(err, ErrorCode.FOLDER_BLOCKED)

    def test_accept_valid_custom_folder(self):
        # Create folder outside AppData (e.g. inside project data dir)
        safe_dir = _src.parent / "data" / "test_safe_folder"
        safe_dir.mkdir(parents=True, exist_ok=True)
        try:
            ok, err, msg, canonical = validate_shareable_folder_path(str(safe_dir))
            self.assertTrue(ok)
            self.assertEqual(err, ErrorCode.NONE)
            self.assertEqual(canonical, os.path.realpath(str(safe_dir)))
        finally:
            shutil.rmtree(safe_dir, ignore_errors=True)


class TestOneTimeCodeSecurity(unittest.TestCase):
    """Tests cryptographically secure OTP lifecycle, attempt bounds, and replay/tamper resistance."""

    def test_otp_generation_format_and_entropy(self):
        clean, formatted = generate_secure_otp(8)
        self.assertEqual(len(clean), 8)
        self.assertTrue(clean.isdigit())
        self.assertEqual(formatted, f"{clean[:4]}-{clean[4:]}")

    def test_otp_verification_success(self):
        clean, _ = generate_secure_otp(8)
        req_id = "req_101"
        dev_id = "LAPTOP-01"
        secret = "super-secret-key"
        expected_hash = compute_otp_hash(clean, req_id, dev_id, secret)

        ok, reason = verify_otp_code(
            submitted_code=clean,
            expected_hash=expected_hash,
            request_id=req_id,
            device_id=dev_id,
            secret_key=secret,
            expires_at=time.time() + 300,
            current_attempts=0,
        )
        self.assertTrue(ok)
        self.assertEqual(reason, "VALID")

    def test_otp_verification_failure_on_incorrect_code(self):
        clean, _ = generate_secure_otp(8)
        req_id = "req_101"
        dev_id = "LAPTOP-01"
        secret = "super-secret-key"
        expected_hash = compute_otp_hash(clean, req_id, dev_id, secret)

        ok, reason = verify_otp_code(
            submitted_code="00000000",
            expected_hash=expected_hash,
            request_id=req_id,
            device_id=dev_id,
            secret_key=secret,
            expires_at=time.time() + 300,
            current_attempts=1,
        )
        self.assertFalse(ok)
        self.assertEqual(reason, "OTP_INVALID")

    def test_otp_verification_expired(self):
        clean, _ = generate_secure_otp(8)
        req_id = "req_101"
        dev_id = "LAPTOP-01"
        secret = "super-secret-key"
        expected_hash = compute_otp_hash(clean, req_id, dev_id, secret)

        ok, reason = verify_otp_code(
            submitted_code=clean,
            expected_hash=expected_hash,
            request_id=req_id,
            device_id=dev_id,
            secret_key=secret,
            expires_at=time.time() - 10,  # Expired
            current_attempts=0,
        )
        self.assertFalse(ok)
        self.assertEqual(reason, "OTP_EXPIRED")

    def test_otp_max_attempts_exceeded(self):
        clean, _ = generate_secure_otp(8)
        req_id = "req_101"
        dev_id = "LAPTOP-01"
        secret = "super-secret-key"
        expected_hash = compute_otp_hash(clean, req_id, dev_id, secret)

        ok, reason = verify_otp_code(
            submitted_code=clean,
            expected_hash=expected_hash,
            request_id=req_id,
            device_id=dev_id,
            secret_key=secret,
            expires_at=time.time() + 300,
            current_attempts=3,  # Reached max attempts
            max_attempts=3,
        )
        self.assertFalse(ok)
        self.assertEqual(reason, "OTP_MAX_ATTEMPTS")

    def test_otp_tamper_binding(self):
        clean, _ = generate_secure_otp(8)
        req_id = "req_101"
        dev_id = "LAPTOP-01"
        secret = "super-secret-key"
        expected_hash = compute_otp_hash(clean, req_id, dev_id, secret)

        # Attacker tries using same OTP on a different request or device
        ok, reason = verify_otp_code(
            submitted_code=clean,
            expected_hash=expected_hash,
            request_id="req_999",  # Tampered
            device_id=dev_id,
            secret_key=secret,
            expires_at=time.time() + 300,
            current_attempts=0,
        )
        self.assertFalse(ok)
        self.assertEqual(reason, "OTP_INVALID")


class TestReleaseMetadataValidation(unittest.TestCase):
    """Tests release metadata validation, version progression, and schema enforcement."""

    def test_valid_metadata(self):
        data = {
            "product_id": "delivery_assistant",
            "version": "20.0",
            "release_id": "rel_20_1",
            "min_updater_version": "1.0.0",
            "package_size": 1024,
            "package_sha256": "abcdef",
            "signature": "sig123",
            "timestamp": time.time(),
        }
        ok, err, msg, meta = validate_release_metadata(data, current_version="19.0")
        self.assertTrue(ok)
        self.assertEqual(err, ErrorCode.NONE)
        self.assertIsNotNone(meta)

    def test_reject_missing_fields(self):
        data = {"product_id": "delivery_assistant"}
        ok, err, msg, meta = validate_release_metadata(data)
        self.assertFalse(ok)
        self.assertEqual(err, ErrorCode.METADATA_MALFORMED)

    def test_reject_incompatible_product_id(self):
        data = {
            "product_id": "malicious_app",
            "version": "20.0",
            "release_id": "rel_1",
            "package_size": 1024,
            "package_sha256": "abcdef",
            "signature": "sig",
        }
        ok, err, msg, meta = validate_release_metadata(data)
        self.assertFalse(ok)
        self.assertEqual(err, ErrorCode.INCOMPATIBLE_RELEASE)

    def test_reject_downgrade(self):
        data = {
            "product_id": "delivery_assistant",
            "version": "18.0",
            "release_id": "rel_1",
            "package_size": 1024,
            "package_sha256": "abcdef",
            "signature": "sig",
        }
        ok, err, msg, meta = validate_release_metadata(data, current_version="19.0", allow_downgrade=False)
        self.assertFalse(ok)
        self.assertEqual(err, ErrorCode.VERSION_CONFLICT)


class TestVerifierSecurity(unittest.TestCase):
    """Tests package verifier against size, hash, signature, and zip archive attacks."""

    def setUp(self):
        self.temp_dir = tempfile.mkdtemp()
        self.secret = "test-secret-key-32-chars-long"

    def tearDown(self):
        shutil.rmtree(self.temp_dir, ignore_errors=True)

    def _create_zip_package(self, filename: str, files: dict) -> Path:
        zip_path = Path(self.temp_dir) / filename
        with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
            for arcname, content in files.items():
                zf.writestr(arcname, content)
        return zip_path

    def test_verify_valid_package(self):
        files = {
            "manifest.json": json.dumps({"version": "20.0"}),
            "background.js": "console.log('v20');",
        }
        pkg = self._create_zip_package("valid.zip", files)
        pkg_size = pkg.stat().st_size
        pkg_hash = compute_file_sha256(pkg)
        sig = compute_release_signature("delivery_assistant", "20.0", "rel_1", pkg_hash, pkg_size, self.secret)

        meta = ReleaseMetadata(
            product_id="delivery_assistant",
            version="20.0",
            release_id="rel_1",
            min_updater_version="1.0.0",
            package_size=pkg_size,
            package_sha256=pkg_hash,
            files_manifest={},
            signature=sig,
            timestamp=time.time(),
        )

        ok, err, msg = verify_package_file(pkg, meta, self.secret)
        self.assertTrue(ok)
        self.assertEqual(err, ErrorCode.NONE)

    def test_reject_wrong_hash(self):
        files = {"manifest.json": json.dumps({"version": "20.0"})}
        pkg = self._create_zip_package("wrong_hash.zip", files)
        pkg_size = pkg.stat().st_size
        sig = compute_release_signature("delivery_assistant", "20.0", "rel_1", "bad_hash", pkg_size, self.secret)

        meta = ReleaseMetadata(
            product_id="delivery_assistant",
            version="20.0",
            release_id="rel_1",
            min_updater_version="1.0.0",
            package_size=pkg_size,
            package_sha256="bad_hash",
            files_manifest={},
            signature=sig,
            timestamp=time.time(),
        )

        ok, err, msg = verify_package_file(pkg, meta, self.secret)
        self.assertFalse(ok)
        self.assertEqual(err, ErrorCode.HASH_MISMATCH)

    def test_reject_invalid_signature(self):
        files = {"manifest.json": json.dumps({"version": "20.0"})}
        pkg = self._create_zip_package("bad_sig.zip", files)
        pkg_size = pkg.stat().st_size
        pkg_hash = compute_file_sha256(pkg)

        meta = ReleaseMetadata(
            product_id="delivery_assistant",
            version="20.0",
            release_id="rel_1",
            min_updater_version="1.0.0",
            package_size=pkg_size,
            package_sha256=pkg_hash,
            files_manifest={},
            signature="forged_invalid_signature",
            timestamp=time.time(),
        )

        ok, err, msg = verify_package_file(pkg, meta, self.secret)
        self.assertFalse(ok)
        self.assertEqual(err, ErrorCode.SIGNATURE_INVALID)

    def test_reject_zip_path_traversal(self):
        files = {
            "manifest.json": json.dumps({"version": "20.0"}),
            "../escaped.txt": "evil content",
        }
        pkg = self._create_zip_package("traversal.zip", files)
        pkg_size = pkg.stat().st_size
        pkg_hash = compute_file_sha256(pkg)
        sig = compute_release_signature("delivery_assistant", "20.0", "rel_1", pkg_hash, pkg_size, self.secret)

        meta = ReleaseMetadata(
            product_id="delivery_assistant",
            version="20.0",
            release_id="rel_1",
            min_updater_version="1.0.0",
            package_size=pkg_size,
            package_sha256=pkg_hash,
            files_manifest={},
            signature=sig,
            timestamp=time.time(),
        )

        ok, err, msg = verify_package_file(pkg, meta, self.secret)
        self.assertFalse(ok)
        self.assertEqual(err, ErrorCode.PATH_TRAVERSAL_DETECTED)

    def test_reject_forbidden_executable_file(self):
        files = {
            "manifest.json": json.dumps({"version": "20.0"}),
            "payload.exe": "binary executable bytes",
        }
        pkg = self._create_zip_package("forbidden.zip", files)
        pkg_size = pkg.stat().st_size
        pkg_hash = compute_file_sha256(pkg)
        sig = compute_release_signature("delivery_assistant", "20.0", "rel_1", pkg_hash, pkg_size, self.secret)

        meta = ReleaseMetadata(
            product_id="delivery_assistant",
            version="20.0",
            release_id="rel_1",
            min_updater_version="1.0.0",
            package_size=pkg_size,
            package_sha256=pkg_hash,
            files_manifest={},
            signature=sig,
            timestamp=time.time(),
        )

        ok, err, msg = verify_package_file(pkg, meta, self.secret)
        self.assertFalse(ok)
        self.assertEqual(err, ErrorCode.FORBIDDEN_FILE_TYPE)


if __name__ == "__main__":
    unittest.main()
