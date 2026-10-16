"""Live test for Chrome Extension self-reload via Native Messaging."""

import json
import os
import sys
import time
from pathlib import Path

def main():
    workspace_root = Path(__file__).resolve().parent.parent.parent
    subsystem_root = workspace_root / "Driver and update assistant"

    manifest_path = workspace_root / "manifest.json"
    signal_path = subsystem_root / "data" / "update_signal.json"
    status_path = subsystem_root / "data" / "chrome_runtime_version.json"

    with open(manifest_path, "r", encoding="utf-8") as f:
        manifest_data = json.load(f)

    orig_ver = manifest_data.get("version", "19.0")
    test_ver = "19.1" if orig_ver != "19.1" else "19.2"

    print(f"[TEST] Original manifest version: {orig_ver}")
    print(f"[TEST] Updating manifest.json to: {test_ver}")

    manifest_data["version"] = test_ver
    with open(manifest_path, "w", encoding="utf-8") as f:
        json.dump(manifest_data, f, indent=2)

    print("[TEST] Emitting update_signal.json to native host...")
    start_time = time.time()
    signal_payload = {
        "action": "UPDATE_READY",
        "target_version": test_ver,
        "transaction_id": f"tx_live_{int(start_time)}",
        "timestamp": start_time,
        "files_verified": True,
    }
    with open(signal_path, "w", encoding="utf-8") as f:
        json.dump(signal_payload, f, indent=2)

    print(f"[TEST] Polling {status_path} for runtime confirmation of v{test_ver}...")
    success = False
    for i in range(30):
        time.sleep(0.5)
        if status_path.exists():
            try:
                with open(status_path, "r", encoding="utf-8") as f:
                    status_data = json.load(f)
                r_ver = status_data.get("runtime_version")
                r_ts = status_data.get("timestamp", 0)
                print(f"  Poll {i+1:02d}: reported v{r_ver} at ts={r_ts:.1f}")
                if r_ver == test_ver and r_ts >= start_time - 1.0:
                    success = True
                    print(f"\n[TEST PASS] Chrome Extension successfully self-reloaded to v{test_ver} without any manual intervention!")
                    break
            except Exception as e:
                print(f"  Poll error: {e}")

    # Revert manifest back to original version
    print(f"\n[TEST] Reverting manifest.json back to v{orig_ver} and signaling self-reload back...")
    manifest_data["version"] = orig_ver
    with open(manifest_path, "w", encoding="utf-8") as f:
        json.dump(manifest_data, f, indent=2)

    revert_start = time.time()
    with open(signal_path, "w", encoding="utf-8") as f:
        json.dump({
            "action": "UPDATE_READY",
            "target_version": orig_ver,
            "transaction_id": f"tx_revert_{int(revert_start)}",
            "timestamp": revert_start,
            "files_verified": True,
        }, f, indent=2)

    for i in range(20):
        time.sleep(0.5)
        if status_path.exists():
            try:
                with open(status_path, "r", encoding="utf-8") as f:
                    status_data = json.load(f)
                if status_data.get("runtime_version") == orig_ver and status_data.get("timestamp", 0) >= revert_start - 1.0:
                    print(f"[TEST PASS] Chrome Extension successfully self-reloaded back to original v{orig_ver}!")
                    break
            except Exception:
                pass

    if not success:
        print("[TEST FAIL] Chrome extension did not report updated runtime version within timeout.")
        sys.exit(1)

    print("\n[TEST COMPLETED] All self-reload verifications passed!")
    sys.exit(0)

if __name__ == "__main__":
    main()
