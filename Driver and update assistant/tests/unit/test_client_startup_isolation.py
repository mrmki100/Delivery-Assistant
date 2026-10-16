"""Regression test ensuring Client and Updater components never depend on the Server package."""

import sys
import unittest


class TestClientStartupIsolation(unittest.TestCase):
    """Ensures Client can start in complete isolation from Server modules."""

    def setUp(self):
        # Save original sys.modules state
        self._orig_server = sys.modules.get("driver_update_assistant.server")
        # Block the entire server package hierarchy
        sys.modules["driver_update_assistant.server"] = None
        for key in list(sys.modules.keys()):
            if key.startswith("driver_update_assistant.server."):
                del sys.modules[key]

    def tearDown(self):
        # Restore sys.modules
        if self._orig_server is not None:
            sys.modules["driver_update_assistant.server"] = self._orig_server
        elif "driver_update_assistant.server" in sys.modules:
            del sys.modules["driver_update_assistant.server"]

    def test_client_main_imports_without_server(self):
        """Verify client.main imports cleanly without server package."""
        import driver_update_assistant.client.main as client_main
        self.assertTrue(hasattr(client_main, "main"))

    def test_client_core_imports_without_server(self):
        """Verify client core classes import cleanly without server package."""
        from driver_update_assistant.client.core import AgentClient, DurableOutbox
        self.assertTrue(callable(AgentClient))
        self.assertTrue(callable(DurableOutbox))

    def test_updater_rollback_imports_without_server(self):
        """Verify RollbackManager functions without server package."""
        from driver_update_assistant.updater.rollback import RollbackManager
        self.assertTrue(callable(RollbackManager))

    def test_updater_staging_and_verifier_import_without_server(self):
        """Verify staging and verifier function without server package."""
        from driver_update_assistant.updater.staging import stage_package
        from driver_update_assistant.updater.verifier import verify_package_file
        self.assertTrue(callable(stage_package))
        self.assertTrue(callable(verify_package_file))

    def test_shared_crypto_contains_required_utilities(self):
        """Verify shared crypto module exposes required utilities."""
        from driver_update_assistant.shared.crypto import (
            ALLOWED_EXTENSIONS,
            FORBIDDEN_EXTENSIONS,
            compute_file_sha256,
            compute_release_signature,
            verify_release_signature,
        )
        self.assertIn(".js", ALLOWED_EXTENSIONS)
        self.assertIn(".exe", FORBIDDEN_EXTENSIONS)
        self.assertTrue(callable(compute_file_sha256))
        self.assertTrue(callable(compute_release_signature))
        self.assertTrue(callable(verify_release_signature))


if __name__ == "__main__":
    unittest.main()
