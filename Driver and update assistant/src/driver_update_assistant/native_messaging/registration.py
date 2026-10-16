"""Windows Registry registration for Chrome Native Messaging Host."""

import json
import os
import platform
import sys
from pathlib import Path
from typing import Optional, Tuple

REGISTRY_KEY_PATH = r"Software\Google\Chrome\NativeMessagingHosts\driver_update_assistant"


def get_default_manifest_path() -> Path:
    """Returns absolute path to native host manifest."""
    root = Path(__file__).resolve().parent.parent.parent.parent
    return root / "config" / "driver_update_assistant.json"


def write_manifest_file(manifest_path: Path, runner_bat_path: Path, extension_id: str) -> None:
    """Generates the native host JSON manifest."""
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest = {
        "name": "driver_update_assistant",
        "description": "Native Messaging Host for Delivery Assistant Extension",
        "path": str(runner_bat_path.resolve()),
        "type": "stdio",
        "allowed_origins": [
            f"chrome-extension://{extension_id}/"
        ],
    }
    with open(manifest_path, "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2)


def install_native_host(manifest_path: Path) -> Tuple[bool, str]:
    """Registers the manifest path in Windows Registry HKCU."""
    if platform.system() != "Windows":
        return True, f"[MOCK] Registered native host for {platform.system()}"

    try:
        import winreg
        key = winreg.CreateKey(winreg.HKEY_CURRENT_USER, REGISTRY_KEY_PATH)
        winreg.SetValue(key, "", winreg.REG_SZ, str(manifest_path.resolve()))
        winreg.CloseKey(key)
        return True, f"Successfully registered native host at HKCU\\{REGISTRY_KEY_PATH}"
    except Exception as e:
        return False, f"Failed to register in Windows Registry: {str(e)}"


def uninstall_native_host() -> Tuple[bool, str]:
    """Removes the registry key from HKCU."""
    if platform.system() != "Windows":
        return True, "[MOCK] Unregistered native host"

    try:
        import winreg
        winreg.DeleteKey(winreg.HKEY_CURRENT_USER, REGISTRY_KEY_PATH)
        return True, "Successfully deleted registry key"
    except FileNotFoundError:
        return True, "Registry key was not present"
    except Exception as e:
        return False, f"Failed to delete registry key: {str(e)}"


def check_native_host_registration() -> Tuple[bool, str]:
    """Checks whether the host is currently registered in HKCU and manifest/target files exist."""
    if platform.system() != "Windows":
        return True, "[MOCK] Native host registered"

    try:
        import winreg
        key = winreg.OpenKey(winreg.HKEY_CURRENT_USER, REGISTRY_KEY_PATH, 0, winreg.KEY_READ)
        manifest_val = winreg.QueryValue(key, "")
        winreg.CloseKey(key)

        manifest_path = Path(manifest_val)
        if not manifest_path.exists():
            return False, f"Registry key points to missing manifest: {manifest_val}"

        try:
            with open(manifest_path, "r", encoding="utf-8-sig") as f:
                manifest_data = json.load(f)
            host_path = Path(manifest_data.get("path", ""))
            if not host_path.exists():
                return False, f"Manifest exists but executable/script is missing: {host_path}"
        except Exception as json_err:
            return False, f"Malformed manifest JSON: {str(json_err)}"

        return True, f"Registered pointing to: {manifest_val}"
    except FileNotFoundError:
        return False, "Not registered in HKCU"
    except Exception as e:
        return False, f"Error reading registry: {str(e)}"


if __name__ == "__main__":
    if "--install" in sys.argv:
        manifest = get_default_manifest_path()
        ok, msg = install_native_host(manifest)
        print(msg)
    elif "--uninstall" in sys.argv:
        ok, msg = uninstall_native_host()
        print(msg)
    else:
        ok, msg = check_native_host_registration()
        print(f"Status: {msg}")
