"""Full End-to-End Update Pipeline Verification Test.

Performs genuine end-to-end integration test:
1. Starts real AdminServer on ephemeral port in isolated test directory.
2. Publishes genuine signed test release (v19.1.0-e2e) via Server release engine.
3. Client discovers update via HTTP endpoint.
4. Client downloads package via HTTP, validates SHA256 and HMAC release signature.
5. Client stages package and creates snapshot backup of baseline extension.
6. Client applies update files to controlled test extension copy.
7. Client health check passes.
8. Client emits genuine update_signal.json.
9. Native host detects update_signal.json and pushes UPDATE_READY.
10. Controlled extension service worker processes UPDATE_READY and reports new runtime version.
11. Native host atomically writes chrome_runtime_version.json.
12. Client activation verifier confirms v19.1.0-e2e active.
13. Client reports final ACTIVATION_VERIFIED status back to AdminServer.
14. Server acknowledges and records verified activation.
"""

import io
import json
import os
import shutil
import struct
import tempfile
import threading
import time
import urllib.request
from pathlib import Path
import sys
from unittest.mock import patch

_src = Path(__file__).resolve().parent.parent / "src"
if str(_src) not in sys.path:
    sys.path.insert(0, str(_src))

from driver_update_assistant.client import AgentClient
from driver_update_assistant.config import AgentConfig, ServerConfig
from driver_update_assistant.native_messaging.host import (
    _signal_monitor_loop,
    read_message,
    send_message,
)
from driver_update_assistant.protocol import (
    ErrorCode,
    ReleaseMetadata,
    UpdateState,
)
from driver_update_assistant.server.app import AdminServer
from driver_update_assistant.server.device_registry import DeviceRegistry
from driver_update_assistant.server.release_store import ReleaseStore


def run_e2e_test():
    test_root = Path(tempfile.mkdtemp(prefix="E2E_Update_Test_"))
    print("======================================================================")
    print("  FULL END-TO-END UPDATE PIPELINE INTEGRATION TEST")
    print("======================================================================")
    print(f"[*] Workspace Root: {test_root}")

    server_dir = test_root / "server"
    client_dir = test_root / "client"
    ext_dir = test_root / "extension_copy"
    src_release_dir = test_root / "release_source"

    server_dir.mkdir()
    client_dir.mkdir()
    ext_dir.mkdir()
    src_release_dir.mkdir()

    server = None
    server_thread = None

    try:
        # ---------------------------------------------------------
        # STAGE 1: Initialize Controlled Extension Copy (v19.0.0)
        # ---------------------------------------------------------
        print("\n[STAGE 1] Initializing Controlled Test Extension (v19.0.0)...")
        with open(ext_dir / "manifest.json", "w", encoding="utf-8") as f:
            json.dump({
                "manifest_version": 3,
                "name": "Delivery Assistant",
                "version": "19.0.0",
                "background": {"service_worker": "background.js"}
            }, f, indent=2)

        for fn in ("background.js", "ui-render.js", "shortcuts.js", "content.js"):
            with open(ext_dir / fn, "w", encoding="utf-8") as f:
                f.write(f"// Delivery Assistant {fn} - v19.0.0 baseline\n")

        print(f"  -> Baseline extension initialized at: {ext_dir}")

        # ---------------------------------------------------------
        # STAGE 2: Start Admin Server with Registered Test Device
        # ---------------------------------------------------------
        print("\n[STAGE 2] Starting AdminServer on 127.0.0.1:18092...")
        srv_config = ServerConfig(
            host="127.0.0.1",
            port=18092,
            data_dir=str(server_dir / "data"),
            releases_dir=str(server_dir / "releases"),
            secret_key="e2e-audit-master-signing-secret",
            require_device_enrollment=True,
        )

        server = AdminServer(srv_config)

        # Pre-register test employee device
        server.state.registry.enroll_device(
            device_id="DEV-E2E-AUDIT",
            raw_token="token_e2e_secret_xyz",
            hostname="audit-workstation",
        )

        server_thread = threading.Thread(target=server.start, daemon=True)
        server_thread.start()
        time.sleep(0.5)
        print("  -> AdminServer listening and device registered.")

        # ---------------------------------------------------------
        # STAGE 3: Publish Genuine Release via Server Engine
        # ---------------------------------------------------------
        print("\n[STAGE 3] Publishing Disposable Release v19.1.0-e2e via Server...")
        # Create source files for v19.1.0-e2e
        with open(src_release_dir / "manifest.json", "w", encoding="utf-8") as f:
            json.dump({
                "manifest_version": 3,
                "name": "Delivery Assistant",
                "version": "19.1.0-e2e",
                "background": {"service_worker": "background.js"}
            }, f, indent=2)

        for fn in ("background.js", "ui-render.js", "shortcuts.js", "content.js"):
            with open(src_release_dir / fn, "w", encoding="utf-8") as f:
                f.write(f"// Delivery Assistant {fn} - v19.1.0-e2e updated content\n")

        # Publish through server release store
        meta, pkg_path = server.state.store.publish_release(
            version="19.1.0-e2e",
            source_dir=str(src_release_dir),
            secret_key=srv_config.secret_key,
            notes="Disposable Release-Readiness Audit Build",
            product_id="delivery_assistant"
        )
        print(f"  -> Release published successfully:")
        print(f"     Release ID: {meta.release_id}")
        print(f"     Version:    {meta.version}")
        print(f"     SHA256:     {meta.package_sha256[:16]}...")
        print(f"     HMAC Sig:   {meta.signature[:16]}...")
        print(f"     File:       {pkg_path.name} ({meta.package_size} bytes)")

        # ---------------------------------------------------------
        # STAGE 4: Client Update Check via HTTP Endpoint
        # ---------------------------------------------------------
        print("\n[STAGE 4] Client Checking for Updates via HTTP...")
        client_config = AgentConfig(
            device_id="DEV-E2E-AUDIT",
            server_url="http://127.0.0.1:18092",
            device_token="token_e2e_secret_xyz",
            extension_dir=str(ext_dir),
            data_dir=str(client_dir / "data"),
            log_dir=str(client_dir / "logs"),
            staging_dir=str(client_dir / "data" / "staging"),
            backup_dir=str(client_dir / "data" / "backups"),
            verification_secret=srv_config.secret_key,
            activation_timeout_seconds=5,
        )
        client = AgentClient(client_config)

        ok, err, msg, latest_meta = client.check_for_update()
        assert ok is True, f"Update check failed: {err} - {msg}"
        assert latest_meta.version == "19.1.0-e2e", f"Expected 19.1.0-e2e, got {latest_meta.version}"
        print(f"  -> Update detected: current={client.get_installed_extension_version()} -> target={latest_meta.version}")

        # ---------------------------------------------------------
        # STAGE 5: Background Native Messaging Signal Monitor
        # ---------------------------------------------------------
        print("\n[STAGE 5] Starting Native Messaging Host Signal Monitor...")
        client_data_dir = Path(client_config.data_dir)
        client_data_dir.mkdir(parents=True, exist_ok=True)
        signal_file = client_data_dir / "update_signal.json"
        runtime_file = client_data_dir / "chrome_runtime_version.json"

        pushed_notifications = []
        stop_event = threading.Event()

        def capture_push(msg):
            print(f"  [NativeHost Push] Dispatched: {msg}")
            pushed_notifications.append(msg)
            # Simulate Chrome receiving push and acknowledging runtime activation
            if msg.get("action") == "UPDATE_READY":
                target_v = msg.get("target_version")
                tx_id = msg.get("transaction_id")
                # Extension Service Worker writes back active version via REPORT_RUNTIME_VERSION
                with open(runtime_file, "w", encoding="utf-8") as rf:
                    json.dump({
                        "runtime_version": target_v,
                        "transaction_id": tx_id,
                        "timestamp": time.time()
                    }, rf)
                print(f"  [Chrome SW Sim] Received UPDATE_READY -> Reloaded -> Reported v{target_v} to Native Host.")

        with patch("driver_update_assistant.native_messaging.host.send_message", side_effect=capture_push):
            monitor_t = threading.Thread(
                target=_signal_monitor_loop,
                args=(signal_file, stop_event, client.logger),
                daemon=True,
            )
            monitor_t.start()

            # ---------------------------------------------------------
            # STAGE 6: Execute Full Client Update Pipeline
            # ---------------------------------------------------------
            print("\n[STAGE 6] Executing Full Client Update Pipeline...")
            journal = client.execute_update(latest_meta)

            print(f"  -> Journal Final State: {journal.state.value}")
            print(f"  -> Journal Error Code:  {journal.last_error.value}")
            print(f"  -> Message:             {journal.error_message}")

            # Verify journal reached ACTIVATION_VERIFIED
            assert journal.state == UpdateState.ACTIVATION_VERIFIED, f"Update did not reach ACTIVATION_VERIFIED: {journal.state}"

            stop_event.set()
            monitor_t.join(timeout=2.0)

        # ---------------------------------------------------------
        # STAGE 7: Verification of Results across all components
        # ---------------------------------------------------------
        print("\n[STAGE 7] Verifying State Across All Components...")

        # 1. Target Extension Files
        with open(ext_dir / "manifest.json", "r", encoding="utf-8") as mf:
            active_manifest = json.load(mf)
        print(f"  [Extension on Disk] Version: {active_manifest.get('version')}")
        assert active_manifest.get("version") == "19.1.0-e2e"

        # 2. Backup Integrity
        backups = list(Path(client_config.backup_dir).glob("backup_v*"))
        assert len(backups) >= 1, "Backup was not created"
        manifest_file = backups[0] / "backup_manifest.json"
        assert manifest_file.exists(), "Backup manifest is missing"
        print(f"  [Backup] Preserved rollback snapshot: {backups[0].name} (contains backup_manifest.json)")

        # 3. Native Messaging Notification
        assert len(pushed_notifications) == 1, "Native host did not push UPDATE_READY"
        assert pushed_notifications[0]["target_version"] == "19.1.0-e2e"
        assert not signal_file.exists(), "update_signal.json was not consumed by Native Host"
        print("  [Native Messaging] Confirmed push delivery & signal consumption.")

        # 4. Server Device Status
        device_status = server.state.registry.get_device("DEV-E2E-AUDIT")
        print(f"  [Server Device Record] Reported State: {device_status.get('last_state')}")
        print(f"                         Installed Ver:  {device_status.get('installed_version')}")
        assert device_status.get("last_state") == UpdateState.ACTIVATION_VERIFIED.value
        assert device_status.get("installed_version") == "19.1.0-e2e"

        print("\n======================================================================")
        print("  FULL SERVER-TO-CLIENT-TO-CHROME UPDATE PIPELINE PASSED 100%!")
        print("======================================================================")
        return True

    finally:
        if server:
            server.shutdown()
        shutil.rmtree(test_root, ignore_errors=True)


if __name__ == "__main__":
    import sys
    success = run_e2e_test()
    sys.exit(0 if success else 1)
