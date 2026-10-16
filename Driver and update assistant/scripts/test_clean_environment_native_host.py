"""Verification of Chrome Native Messaging Host in an isolated clean environment.

Tests that DriverUpdateAssistant-Client.exe runs in a completely separate directory
without depending on git repository source code, developer paths, or Python runtime.
"""

import io
import json
import os
import shutil
import struct
import subprocess
import sys
import tempfile
import time
from pathlib import Path


def encode_msg(data: dict) -> bytes:
    encoded = json.dumps(data).encode("utf-8")
    return struct.pack("<I", len(encoded)) + encoded


def read_msg(stream) -> dict:
    raw_len = stream.read(4)
    if len(raw_len) < 4:
        raise EOFError("Stream closed before reading length prefix")
    msg_len = struct.unpack("<I", raw_len)[0]
    raw_data = stream.read(msg_len)
    if len(raw_data) < msg_len:
        raise EOFError("Stream closed before reading full message payload")
    return json.loads(raw_data.decode("utf-8"))


def test_clean_environment():
    repo_root = Path(__file__).resolve().parent.parent
    built_client_dir = repo_root / "dist" / "client" / "DriverUpdateAssistant-Client"
    exe_source = built_client_dir / "DriverUpdateAssistant-Client.exe"

    if not exe_source.exists():
        print(f"FAIL: Built executable not found at {exe_source}")
        return False

    # 1. Create clean isolated directory
    clean_dir = Path(tempfile.mkdtemp(prefix="CleanClientTest_"))
    print(f"[*] Step 1: Isolated clean directory created: {clean_dir}")

    try:
        bin_dir = clean_dir / "bin"
        config_dir = clean_dir / "config"
        data_dir = clean_dir / "data"
        logs_dir = clean_dir / "logs"

        config_dir.mkdir(parents=True)
        data_dir.mkdir(parents=True)
        logs_dir.mkdir(parents=True)

        # Copy the entire standalone distribution
        print("[*] Step 2: Copying standalone distribution to clean environment...")
        shutil.copytree(built_client_dir, bin_dir)
        isolated_exe = bin_dir / "DriverUpdateAssistant-Client.exe"

        # 2. Create clean agent.toml in clean_dir/config
        agent_toml = config_dir / "agent.toml"
        with open(agent_toml, "w", encoding="utf-8") as f:
            f.write(f"""[agent]
device_id = "CLEAN-TEST-PC"
server_url = "http://127.0.0.1:8088"
device_token = "clean_test_token"
extension_dir = "{str(clean_dir / 'ext').replace(os.sep, '/')}"
data_dir = "{str(data_dir).replace(os.sep, '/')}"
log_dir = "{str(logs_dir).replace(os.sep, '/')}"

[updater]
verification_secret = "sec_clean_test"
staging_dir = "{str(data_dir / 'staging').replace(os.sep, '/')}"
backup_dir = "{str(data_dir / 'backups').replace(os.sep, '/')}"
activation_timeout_seconds = 10
""")

        # Also copy config to bin_dir/config so exe finds it when running from bin
        bin_config_dir = bin_dir / "config"
        bin_config_dir.mkdir(exist_ok=True)
        shutil.copy(agent_toml, bin_config_dir / "agent.toml")

        # 3. Create native messaging manifest
        manifest_file = clean_dir / "driver_update_assistant.json"
        manifest_content = {
            "name": "driver_update_assistant",
            "description": "Native Messaging Host for Delivery Assistant Extension",
            "path": str(isolated_exe),
            "type": "stdio",
            "allowed_origins": [
                "chrome-extension://ajbnjogoeehfjnjbpodgoihmcmooliom/"
            ]
        }
        with open(manifest_file, "w", encoding="utf-8") as f:
            json.dump(manifest_content, f, indent=2)
        print(f"[*] Step 3: Native Host Manifest created: {manifest_file}")
        print(f"          Executable Path: {isolated_exe}")

        # 4. Launch executable directly using Chrome's exact invocation arguments
        # Chrome invokes: <exe_path> chrome-extension://<id>/ --parent-window=<hwnd>
        chrome_args = [
            str(isolated_exe),
            "chrome-extension://ajbnjogoeehfjnjbpodgoihmcmooliom/",
            "--parent-window=0"
        ]

        # Strip PYTHONPATH and PYTHONHOME from env to ensure zero Python reliance
        clean_env = os.environ.copy()
        clean_env.pop("PYTHONPATH", None)
        clean_env.pop("PYTHONHOME", None)

        print(f"[*] Step 4: Spawning process as Chrome would (CWD=C:\\Windows\\System32)...")
        proc = subprocess.Popen(
            chrome_args,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            cwd=r"C:\Windows\System32",
            env=clean_env
        )

        # 5. Handshake: Send PING
        print("[*] Step 5: Testing PING handshake over stdio...")
        proc.stdin.write(encode_msg({"action": "PING"}))
        proc.stdin.flush()

        resp = read_msg(proc.stdout)
        print(f"          Response: {resp}")
        assert resp.get("success") is True, f"PING failed: {resp}"
        assert resp.get("action") == "PONG", f"Expected PONG: {resp}"
        print("          -> PASS: Handshake successful.")

        # 6. Status Query: Send GET_STATUS
        print("[*] Step 6: Testing GET_STATUS and data directory resolution...")
        proc.stdin.write(encode_msg({"action": "GET_STATUS"}))
        proc.stdin.flush()

        status_resp = read_msg(proc.stdout)
        print(f"          Response: {status_resp}")
        assert status_resp.get("success") is True, f"GET_STATUS failed: {status_resp}"
        assert status_resp.get("device_id") == "CLEAN-TEST-PC", f"Device ID mismatch: {status_resp}"
        print("          -> PASS: Status verified against clean config.")

        # 7. Push Signal Monitoring: Emit update_signal.json in data_dir
        print("[*] Step 7: Testing SignalMonitor push notification via update_signal.json...")
        sig_file = data_dir / "update_signal.json"
        with open(sig_file, "w", encoding="utf-8") as sf:
            json.dump({
                "action": "UPDATE_READY",
                "transaction_id": "tx_clean_audit_001",
                "target_version": "19.9.9",
                "timestamp": time.time(),
                "files_verified": True
            }, sf)

        # Wait for push notification from host
        push_msg = read_msg(proc.stdout)
        print(f"          Push Notification Received: {push_msg}")
        assert push_msg.get("action") == "UPDATE_READY", f"Expected UPDATE_READY, got: {push_msg}"
        assert push_msg.get("target_version") == "19.9.9", f"Target version mismatch: {push_msg}"
        assert push_msg.get("transaction_id") == "tx_clean_audit_001", f"Transaction mismatch: {push_msg}"

        # Verify signal file was consumed/unlinked
        time.sleep(0.3)
        assert not sig_file.exists(), "Update signal file was not consumed by monitor!"
        print("          -> PASS: Push notification dispatched and signal consumed.")

        # 8. Report Runtime Version: Extension reports active version
        print("[*] Step 8: Testing REPORT_RUNTIME_VERSION persistence...")
        proc.stdin.write(encode_msg({
            "action": "REPORT_RUNTIME_VERSION",
            "runtime_version": "19.9.9",
            "transaction_id": "tx_clean_audit_001"
        }))
        proc.stdin.flush()

        ack_resp = read_msg(proc.stdout)
        print(f"          Response: {ack_resp}")
        assert ack_resp.get("success") is True, f"Report failed: {ack_resp}"
        assert ack_resp.get("acknowledged_version") == "19.9.9"

        # Verify chrome_runtime_version.json written to clean data_dir
        runtime_file = data_dir / "chrome_runtime_version.json"
        assert runtime_file.exists(), f"Runtime version file was not written to {runtime_file}"
        with open(runtime_file, "r", encoding="utf-8") as rf:
            rf_data = json.load(rf)
        assert rf_data.get("runtime_version") == "19.9.9"
        print(f"          Runtime file verified on disk: {rf_data}")
        print("          -> PASS: Runtime version persisted atomically.")

        # 9. Clean termination on stdin close
        print("[*] Step 9: Closing stdin to verify clean exit...")
        proc.stdin.close()
        exit_code = proc.wait(timeout=5.0)
        print(f"          Process exited with code: {exit_code}")
        assert exit_code == 0, f"Expected 0, got {exit_code}"

        # Check logs
        log_file = logs_dir / "native_host.log"
        assert log_file.exists(), f"Log file missing: {log_file}"
        print(f"          Logs verified at {log_file} ({log_file.stat().st_size} bytes)")
        print("\n=======================================================")
        print("  ALL CLEAN ENVIRONMENT NATIVE HOST TESTS PASSED!       ")
        print("=======================================================")
        return True

    finally:
        shutil.rmtree(clean_dir, ignore_errors=True)


if __name__ == "__main__":
    success = test_clean_environment()
    sys.exit(0 if success else 1)
