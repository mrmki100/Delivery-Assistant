"""Chrome Native Messaging host for bidirectional communication with Delivery Assistant extension."""

import json
import os
import struct
import sys
import threading
import time
from pathlib import Path
from typing import Any, Dict, Optional

from driver_update_assistant.config import load_agent_config
from driver_update_assistant.logging_setup import setup_logger

MAX_MESSAGE_BYTES = 64 * 1024  # 64 KB limit
_stdout_lock = threading.Lock()


def read_message(stream: Optional[Any] = None) -> Optional[Dict[str, Any]]:
    """Reads a message using Chrome Native Messaging protocol (32-bit length prefix)."""
    if stream is None:
        stream = sys.stdin.buffer
    raw_length = stream.read(4)
    if len(raw_length) < 4:
        return None
    message_length = struct.unpack("<I", raw_length)[0]
    if message_length > MAX_MESSAGE_BYTES:
        return {"error": "PAYLOAD_TOO_LARGE"}

    message_bytes = stream.read(message_length)
    if len(message_bytes) < message_length:
        return None
    try:
        return json.loads(message_bytes.decode("utf-8"))
    except Exception:
        return {"error": "MALFORMED_JSON"}


def send_message(message: Dict[str, Any], stream: Optional[Any] = None) -> None:
    """Thread-safe transmission of a message using Chrome Native Messaging protocol."""
    if stream is None:
        stream = sys.stdout.buffer
    encoded = json.dumps(message).encode("utf-8")
    payload = struct.pack("<I", len(encoded)) + encoded
    with _stdout_lock:
        stream.write(payload)
        stream.flush()


def _signal_monitor_loop(signal_file: Path, stop_event: threading.Event, logger: Any) -> None:
    """Background monitor that detects update signals from the Client and pushes them to Chrome."""
    while not stop_event.is_set():
        try:
            if signal_file.exists():
                try:
                    with open(signal_file, "r", encoding="utf-8") as f:
                        data = json.load(f)
                    # Remove or consume signal file immediately to prevent re-triggering
                    try:
                        signal_file.unlink()
                    except Exception:
                        pass

                    target_ver = data.get("target_version", "")
                    tx_id = data.get("transaction_id", "")
                    logger.info("SignalMonitor detected update signal for target v%s (tx: %s)", target_ver, tx_id)

                    # Send push notification to Chrome extension port
                    send_message({
                        "action": "UPDATE_READY",
                        "target_version": target_ver,
                        "transaction_id": tx_id,
                        "timestamp": data.get("timestamp", time.time()),
                        "files_verified": True,
                    })
                except Exception as read_err:
                    logger.error("Failed to read update signal: %s", str(read_err))
        except Exception as e:
            logger.error("Error in signal monitor loop: %s", str(e))

        time.sleep(0.25)


def run_native_host() -> None:
    """Main loop for Native Messaging Host process."""
    # Ensure binary mode on Windows
    if sys.platform == "win32":
        import msvcrt
        msvcrt.setmode(sys.stdin.fileno(), os.O_BINARY)
        msvcrt.setmode(sys.stdout.fileno(), os.O_BINARY)

    config = load_agent_config()
    logger = setup_logger("native_host", config.log_dir, "native_host.log", device_id=config.device_id)
    runtime_file = Path(config.data_dir) / "chrome_runtime_version.json"
    signal_file = Path(config.data_dir) / "update_signal.json"

    logger.info("Chrome Native Messaging host started (pid=%d).", os.getpid())

    stop_event = threading.Event()
    monitor_thread = threading.Thread(
        target=_signal_monitor_loop,
        args=(signal_file, stop_event, logger),
        daemon=True,
    )
    monitor_thread.start()

    try:
        while True:
            msg = read_message()
            if msg is None:
                logger.info("Chrome disconnected from stdin; exiting native host.")
                break

            if "error" in msg:
                send_message({"success": False, "error": msg["error"]})
                continue

            action = msg.get("action")

            if action == "GET_STATUS" or action == "CHECK_PENDING_RELOAD":
                # Check if there is an unconsumed update signal
                pending_signal = None
                if signal_file.exists():
                    try:
                        with open(signal_file, "r", encoding="utf-8") as f:
                            pending_signal = json.load(f)
                    except Exception:
                        pass

                journal_path = Path(config.data_dir) / "transaction_journal.json"
                last_state = "IDLE"
                if journal_path.exists():
                    try:
                        with open(journal_path, "r", encoding="utf-8") as f:
                            last_state = json.load(f).get("state", "IDLE")
                    except Exception:
                        pass

                response: Dict[str, Any] = {
                    "success": True,
                    "agent_version": "1.0.0",
                    "device_id": config.device_id,
                    "update_state": last_state,
                    "timestamp": time.time(),
                }

                if pending_signal:
                    response["action"] = "UPDATE_READY"
                    response["target_version"] = pending_signal.get("target_version")
                    response["transaction_id"] = pending_signal.get("transaction_id")
                    response["files_verified"] = True

                send_message(response)

            elif action == "REPORT_RUNTIME_VERSION":
                # Extension reports its active in-memory version
                runtime_ver = msg.get("runtime_version", "")
                tx_id = msg.get("transaction_id", "")
                runtime_file.parent.mkdir(parents=True, exist_ok=True)
                temp_runtime_file = runtime_file.with_suffix(f".tmp.{os.getpid()}.{int(time.time()*1000)}")
                try:
                    with open(temp_runtime_file, "w", encoding="utf-8") as f:
                        json.dump({
                            "runtime_version": runtime_ver,
                            "transaction_id": tx_id,
                            "timestamp": time.time(),
                        }, f)
                    os.replace(temp_runtime_file, runtime_file)
                except Exception as write_err:
                    logger.error("Failed to write runtime version atomically: %s", str(write_err))
                    try:
                        if temp_runtime_file.exists():
                            temp_runtime_file.unlink()
                    except Exception:
                        pass

                logger.info("Extension reported active runtime version: %s (tx: %s)", runtime_ver, tx_id)
                send_message({
                    "success": True,
                    "action": "ACKNOWLEDGE_VERSION",
                    "acknowledged_version": runtime_ver,
                })

            elif action == "RELOAD_INITIATED":
                target_ver = msg.get("target_version", "")
                tx_id = msg.get("transaction_id", "")
                logger.info("Extension confirmed reload initiated for target v%s (tx: %s)", target_ver, tx_id)
                send_message({
                    "success": True,
                    "action": "ACKNOWLEDGE_RELOAD",
                    "target_version": target_ver,
                })

            elif action == "PING":
                send_message({
                    "success": True,
                    "action": "PONG",
                    "timestamp": time.time(),
                })

            elif action == "REQUEST_RELOAD":
                send_message({"success": True, "instruction": "EXECUTE_CHROME_RUNTIME_RELOAD"})

            else:
                send_message({"success": False, "error": "UNKNOWN_ACTION", "action": action})

    except Exception as e:
        logger.error("Exception in native messaging loop: %s", str(e))
        send_message({"success": False, "error": "INTERNAL_ERROR", "details": str(e)})
    finally:
        stop_event.set()


if __name__ == "__main__":
    run_native_host()
