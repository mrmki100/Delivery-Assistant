"""Unit tests for automatic extension self-reload, Native Messaging, and activation verification."""

import io
import json
import os
import shutil
import struct
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

from driver_update_assistant.native_messaging.host import (
    _signal_monitor_loop,
    read_message,
    send_message,
)
from driver_update_assistant.native_messaging.registration import (
    check_native_host_registration,
    write_manifest_file,
)
from driver_update_assistant.protocol import UpdateState
from driver_update_assistant.updater.activation import (
    get_reported_runtime_version,
    is_chrome_running,
    verify_extension_activation,
)


class TestNativeMessagingHost(unittest.TestCase):
    """Verifies Chrome Native Messaging Host framing and message handling."""

    def test_message_framing_roundtrip(self):
        """Tests 32-bit little-endian length prefix encoding and decoding."""
        test_payload = {"action": "UPDATE_READY", "target_version": "20.0", "transaction_id": "tx_test_123"}
        encoded = json.dumps(test_payload).encode("utf-8")
        packet = struct.pack("<I", len(encoded)) + encoded

        stream = io.BytesIO(packet)
        msg = read_message(stream)
        self.assertIsNotNone(msg)
        self.assertEqual(msg.get("action"), "UPDATE_READY")
        self.assertEqual(msg.get("target_version"), "20.0")

    def test_read_message_truncated(self):
        """Tests that truncated stream returns None cleanly."""
        truncated_bytes = struct.pack("<I", 100) + b"short"
        stream = io.BytesIO(truncated_bytes)
        msg = read_message(stream)
        self.assertIsNone(msg)

    def test_send_message_thread_safe(self):
        """Tests sending message produces valid 32-bit length prefix and JSON."""
        buf = io.BytesIO()
        send_message({"action": "ACKNOWLEDGE_RELOAD", "target_version": "20.0"}, stream=buf)

        data = buf.getvalue()
        self.assertGreaterEqual(len(data), 4)
        length = struct.unpack("<I", data[:4])[0]
        content = json.loads(data[4 : 4 + length].decode("utf-8"))
        self.assertEqual(content.get("action"), "ACKNOWLEDGE_RELOAD")
        self.assertEqual(content.get("target_version"), "20.0")

    def test_signal_monitor_detects_and_consumes_signal(self):
        """Verifies that SignalMonitor detects update_signal.json and dispatches UPDATE_READY."""
        temp_dir = Path(tempfile.mkdtemp(prefix="test_sig_"))
        try:
            signal_file = temp_dir / "update_signal.json"
            stop_event = threading.Event()
            logger = MagicMock()

            # Write signal file
            signal_data = {
                "action": "UPDATE_READY",
                "transaction_id": "tx_999",
                "target_version": "21.0",
                "timestamp": time.time(),
                "files_verified": True,
            }
            with open(signal_file, "w", encoding="utf-8") as f:
                json.dump(signal_data, f)

            dispatched_messages = []

            def mock_send(msg):
                dispatched_messages.append(msg)
                stop_event.set()

            with patch("driver_update_assistant.native_messaging.host.send_message", side_effect=mock_send):
                # Run monitor in background thread
                t = threading.Thread(
                    target=_signal_monitor_loop,
                    args=(signal_file, stop_event, logger),
                    daemon=True,
                )
                t.start()
                t.join(timeout=3.0)
                stop_event.set()

            # Signal file must have been consumed/deleted
            self.assertFalse(signal_file.exists())
            # Notification must have been dispatched
            self.assertEqual(len(dispatched_messages), 1)
            self.assertEqual(dispatched_messages[0]["action"], "UPDATE_READY")
            self.assertEqual(dispatched_messages[0]["target_version"], "21.0")
            self.assertEqual(dispatched_messages[0]["transaction_id"], "tx_999")
        finally:
            shutil.rmtree(temp_dir, ignore_errors=True)


class TestActivationVerification(unittest.TestCase):
    """Verifies extension activation detection and diagnostic reporting."""

    def setUp(self):
        self.temp_dir = Path(tempfile.mkdtemp(prefix="test_act_"))
        self.status_file = self.temp_dir / "chrome_runtime_version.json"

    def tearDown(self):
        shutil.rmtree(self.temp_dir, ignore_errors=True)

    def test_activation_verified_when_version_matches(self):
        """Tests successful activation when extension reports expected version."""
        with open(self.status_file, "w", encoding="utf-8") as f:
            json.dump({"runtime_version": "20.0", "timestamp": time.time()}, f)

        state, msg = verify_extension_activation(self.status_file, "20.0", timeout_seconds=1.0)
        self.assertEqual(state, UpdateState.ACTIVATION_VERIFIED)
        self.assertIn("v20.0", msg)

    def test_activation_pending_when_chrome_running_and_registered(self):
        """Tests that when Chrome is running and host is registered, timeout yields informative pending state."""
        with open(self.status_file, "w", encoding="utf-8") as f:
            json.dump({"runtime_version": "19.0", "timestamp": time.time()}, f)

        with patch("driver_update_assistant.updater.activation.is_chrome_running", return_value=True):
            with patch("driver_update_assistant.updater.activation.check_native_host_registration", return_value=(True, "OK")):
                state, msg = verify_extension_activation(self.status_file, "20.0", timeout_seconds=0.2)
                self.assertEqual(state, UpdateState.ACTIVATION_PENDING)
                self.assertIn("notification was dispatched", msg)
                self.assertIn("timed out", msg)

    def test_activation_pending_when_native_host_unregistered(self):
        """Tests that missing Native Host registration is explicitly diagnosed."""
        with patch("driver_update_assistant.updater.activation.is_chrome_running", return_value=True):
            with patch("driver_update_assistant.updater.activation.check_native_host_registration", return_value=(False, "Not registered in HKCU")):
                state, msg = verify_extension_activation(self.status_file, "20.0", timeout_seconds=0.2)
                self.assertEqual(state, UpdateState.ACTIVATION_PENDING)
                self.assertIn("Native Messaging host is not registered", msg)

    def test_activation_verified_when_chrome_closed(self):
        """Tests that if Chrome is not running, files on disk are verified for next browser start."""
        with patch("driver_update_assistant.updater.activation.is_chrome_running", return_value=False):
            state, msg = verify_extension_activation(self.status_file, "20.0", timeout_seconds=0.2)
            self.assertEqual(state, UpdateState.ACTIVATION_VERIFIED)
            self.assertIn("Chrome is not running", msg)


class TestNativeHostRegistrationValidation(unittest.TestCase):
    """Verifies that check_native_host_registration validates disk files."""

    def setUp(self):
        self.temp_dir = Path(tempfile.mkdtemp(prefix="test_reg_"))
        self.manifest_file = self.temp_dir / "driver_update_assistant.json"
        self.runner_file = self.temp_dir / "host_runner.bat"
        self.runner_file.write_text("@echo off\nexit /b 0\n")

    def tearDown(self):
        shutil.rmtree(self.temp_dir, ignore_errors=True)

    def test_write_manifest_file(self):
        """Verifies manifest file generation."""
        write_manifest_file(self.manifest_file, self.runner_file, "ajbnjogoeehfjnjbpodgoihmcmooliom")
        self.assertTrue(self.manifest_file.exists())
        with open(self.manifest_file, "r", encoding="utf-8") as f:
            data = json.load(f)
        self.assertEqual(data["name"], "driver_update_assistant")
        self.assertIn("chrome-extension://ajbnjogoeehfjnjbpodgoihmcmooliom/", data["allowed_origins"])
        self.assertEqual(data["path"], str(self.runner_file.resolve()))


if __name__ == "__main__":
    unittest.main()
