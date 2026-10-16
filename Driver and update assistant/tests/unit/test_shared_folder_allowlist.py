"""Unit tests for the client SharedFolderAllowlist and AppMediatedAccessManager."""

import os
import shutil
import tempfile
import time
import unittest
from pathlib import Path

from driver_update_assistant.folder_access.allowlist import SharedFolderAllowlist
from driver_update_assistant.folder_access.app_access import AppMediatedAccessManager
from driver_update_assistant.protocol import SharePermission


class TestSharedFolderAllowlist(unittest.TestCase):
    """Verifies that the client allowlist enforces security boundaries and persists state."""

    def setUp(self):
        self.test_dir = str(Path("data/test_allowlist_sandbox").resolve())
        shutil.rmtree(self.test_dir, ignore_errors=True)
        Path(self.test_dir).mkdir(parents=True, exist_ok=True)
        self.data_dir = Path(self.test_dir) / "data"
        self.allowlist = SharedFolderAllowlist(self.data_dir)

        # Create sample user directories
        self.valid_folder_1 = Path(self.test_dir) / "AutomobyLogs"
        self.valid_folder_1.mkdir(parents=True, exist_ok=True)
        (self.valid_folder_1 / "test.log").write_text("sample log line", encoding="utf-8")

        self.valid_folder_2 = Path(self.test_dir) / "ShipmentReports"
        self.valid_folder_2.mkdir(parents=True, exist_ok=True)

    def tearDown(self):
        shutil.rmtree(self.test_dir, ignore_errors=True)

    def test_add_valid_folder(self):
        ok, msg, entry = self.allowlist.add_folder(str(self.valid_folder_1), SharePermission.READ_ONLY)
        self.assertTrue(ok)
        self.assertIsNotNone(entry)
        self.assertEqual(len(self.allowlist.list_folders()), 1)

    def test_persistence_across_instances(self):
        self.allowlist.add_folder(str(self.valid_folder_1), SharePermission.READ_ONLY)
        # Create new instance with same data dir
        new_instance = SharedFolderAllowlist(self.data_dir)
        self.assertEqual(len(new_instance.list_folders()), 1)
        self.assertEqual(new_instance.list_folders()[0].path, str(self.valid_folder_1.resolve()))

    def test_reject_system_root_and_windows(self):
        # Drive root
        ok, reason, _ = self.allowlist.add_folder("C:\\")
        self.assertFalse(ok)
        self.assertIn("root", reason.lower())

        # Windows directory
        win_dir = os.environ.get("SystemRoot", "C:\\Windows")
        ok, reason, _ = self.allowlist.add_folder(win_dir)
        self.assertFalse(ok)
        self.assertIn("prohibited", reason.lower())

    def test_reject_nonexistent_directory(self):
        ok, reason, _ = self.allowlist.add_folder(str(Path(self.test_dir) / "Does_Not_Exist"))
        self.assertFalse(ok)
        self.assertIn("not a directory", reason.lower())

    def test_remove_folder(self):
        self.allowlist.add_folder(str(self.valid_folder_1))
        self.assertEqual(len(self.allowlist.list_folders()), 1)
        ok, _ = self.allowlist.remove_folder(str(self.valid_folder_1))
        self.assertTrue(ok)
        self.assertEqual(len(self.allowlist.list_folders()), 0)

    def test_is_request_allowed_enforces_allowlist_and_permissions(self):
        self.allowlist.add_folder(str(self.valid_folder_1), SharePermission.READ_ONLY)

        # 1. Matching read request -> Allowed
        ok, _, entry = self.allowlist.is_request_allowed(str(self.valid_folder_1), SharePermission.READ_ONLY.value)
        self.assertTrue(ok)
        self.assertIsNotNone(entry)

        # 2. Unlisted folder request -> Rejected
        ok, reason, _ = self.allowlist.is_request_allowed(str(self.valid_folder_2), SharePermission.READ_ONLY.value)
        self.assertFalse(ok)
        self.assertIn("not in the client allowlist", reason)

        # 3. Read-Write request for folder configured as Read-Only -> Rejected
        ok, reason, _ = self.allowlist.is_request_allowed(str(self.valid_folder_1), SharePermission.READ_WRITE.value)
        self.assertFalse(ok)
        self.assertIn("Read-Only", reason)


class TestAppMediatedAccessManager(unittest.TestCase):
    """Verifies that the application-mediated file interface strictly confines operations."""

    def setUp(self):
        self.test_dir = tempfile.mkdtemp()
        self.root_folder = Path(self.test_dir) / "TargetFolder"
        self.root_folder.mkdir()
        (self.root_folder / "file1.txt").write_text("Hello World", encoding="utf-8")
        sub = self.root_folder / "sub"
        sub.mkdir()
        (sub / "nested.txt").write_text("Nested File", encoding="utf-8")

        self.outside_file = Path(self.test_dir) / "secret.txt"
        self.outside_file.write_text("Confidential", encoding="utf-8")

        self.mgr = AppMediatedAccessManager()
        self.session = self.mgr.create_session(
            request_id="req_test_123",
            device_id="DEV-LAPTOP",
            admin_id="Admin",
            folder_path=str(self.root_folder),
            permission=SharePermission.READ_ONLY.value,
            purpose="Diagnostics",
            duration_minutes=30,
        )

    def tearDown(self):
        shutil.rmtree(self.test_dir, ignore_errors=True)

    def test_list_directory_success(self):
        ok, items, err = self.mgr.list_directory(self.session.session_id, "")
        self.assertTrue(ok)
        names = [i["name"] for i in items]
        self.assertIn("file1.txt", names)
        self.assertIn("sub", names)

    def test_read_file_success(self):
        ok, content, err = self.mgr.read_file(self.session.session_id, "file1.txt")
        self.assertTrue(ok)
        self.assertEqual(content, b"Hello World")

    def test_read_file_nested(self):
        ok, content, err = self.mgr.read_file(self.session.session_id, "sub/nested.txt")
        self.assertTrue(ok)
        self.assertEqual(content, b"Nested File")

    def test_path_traversal_blocked(self):
        # Attempt to read outside the root folder using relative escape
        ok, content, err = self.mgr.read_file(self.session.session_id, "../secret.txt")
        self.assertFalse(ok)
        self.assertIn("traversal", err.lower())

    def test_write_blocked_when_read_only(self):
        ok, msg = self.mgr.write_file(self.session.session_id, "new.txt", b"evil write")
        self.assertFalse(ok)
        self.assertIn("permission denied", msg.lower())

    def test_write_allowed_when_read_write(self):
        rw_session = self.mgr.create_session(
            request_id="req_rw_456",
            device_id="DEV-LAPTOP",
            admin_id="Admin",
            folder_path=str(self.root_folder),
            permission=SharePermission.READ_WRITE.value,
            purpose="Fixing configuration",
            duration_minutes=30,
        )
        ok, msg = self.mgr.write_file(rw_session.session_id, "allowed.txt", b"safe write")
        self.assertTrue(ok)
        self.assertTrue((self.root_folder / "allowed.txt").is_file())

    def test_revocation(self):
        self.mgr.revoke_session(self.session.session_id)
        ok, _, err = self.mgr.read_file(self.session.session_id, "file1.txt")
        self.assertFalse(ok)
        self.assertIn("revoked", err.lower())


if __name__ == "__main__":
    unittest.main()
