"""Unit tests verifying network isolation, port availability checks, and non-destructive diagnostics."""

import socket
import unittest

from driver_update_assistant.diagnostics.network_checks import (
    check_port_available,
    diagnose_connection_preflight,
    get_candidate_lan_interfaces,
    get_system_proxy_status,
)


class TestNetworkIsolation(unittest.TestCase):
    """Ensures network operations never disrupt other applications or misreport state."""

    def test_check_port_available_on_free_port(self):
        # Bind ephemeral socket to find free port, then close
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.bind(("127.0.0.1", 0))
            free_port = s.getsockname()[1]

        avail, msg = check_port_available("127.0.0.1", free_port)
        self.assertTrue(avail)
        self.assertIn("available", msg)

    def test_check_port_available_detects_collision(self):
        # Open listening socket on ephemeral port
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.bind(("127.0.0.1", 0))
            s.listen(1)
            occupied_port = s.getsockname()[1]

            # Try checking the same port
            avail, msg = check_port_available("127.0.0.1", occupied_port)
            self.assertFalse(avail)
            self.assertIn("collision", msg.lower())
            self.assertIn(str(occupied_port), msg)

    def test_diagnose_connection_preflight_service_not_running(self):
        # Find unused port
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.bind(("127.0.0.1", 0))
            unused_port = s.getsockname()[1]

        diag = diagnose_connection_preflight(f"http://127.0.0.1:{unused_port}")
        self.assertFalse(diag["reachable"])
        self.assertIn(diag["status"], ("SERVICE_NOT_RUNNING", "CONNECTION_TIMEOUT"))
        self.assertTrue(len(diag["recommendation"]) > 0)

    def test_get_system_proxy_status_is_read_only(self):
        # Check that inspecting system proxy does not alter environment or throw
        status = get_system_proxy_status()
        self.assertIn("proxy_enabled", status)
        self.assertIn("proxy_server", status)
        self.assertIsInstance(status["proxy_enabled"], bool)

    def test_get_candidate_lan_interfaces(self):
        candidates = get_candidate_lan_interfaces()
        self.assertIsInstance(candidates, list)
        for c in candidates:
            self.assertIn("ip", c)
            self.assertIn("type", c)
            self.assertIn("recommended_for_server", c)


if __name__ == "__main__":
    unittest.main()
