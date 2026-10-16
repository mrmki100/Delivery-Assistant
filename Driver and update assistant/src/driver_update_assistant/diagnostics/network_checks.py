"""Diagnostics for local networking, admin server connectivity, port collision detection, and VPN isolation analysis.

Strictly non-destructive: Never modifies system proxies, routing tables, network adapters,
or firewall rules without explicit user request.
"""

import os
import platform
import socket
import subprocess
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import urlparse


def check_port_available(host: str, port: int) -> Tuple[bool, str]:
    """
    Checks if a local TCP port is available for binding without taking it over or killing processes.
    Returns (is_available, description).
    """
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 0)
            bind_host = host if host and host != "0.0.0.0" else "0.0.0.0"
            s.bind((bind_host, port))
            return True, f"Port {port} on {bind_host} is available."
    except PermissionError:
        return False, f"Permission denied binding to port {port}. Ports below 1024 require elevated privileges."
    except OSError as e:
        # WSAEADDRINUSE (10048) on Windows
        return False, (
            f"Port collision: Port {port} on {host} is already in use by another process. "
            f"Please configure a different listening port in Server Settings."
        )
    except Exception as e:
        return False, f"Unable to bind port {port}: {str(e)}"


def get_system_proxy_status() -> Dict[str, Any]:
    """
    Safely inspects Windows system proxy settings without modifying them.
    Used to detect if VPN software (such as V2RayN) is running in System Proxy mode.
    """
    proxy_info = {
        "proxy_enabled": False,
        "proxy_server": "",
        "env_http_proxy": os.environ.get("HTTP_PROXY") or os.environ.get("http_proxy", ""),
        "env_https_proxy": os.environ.get("HTTPS_PROXY") or os.environ.get("https_proxy", ""),
        "env_all_proxy": os.environ.get("ALL_PROXY") or os.environ.get("all_proxy", ""),
    }

    if platform.system() == "Windows":
        try:
            import winreg
            key_path = r"Software\Microsoft\Windows\CurrentVersion\Internet Settings"
            with winreg.OpenKey(winreg.HKEY_CURRENT_USER, key_path, 0, winreg.KEY_READ) as key:
                enabled, _ = winreg.QueryValueEx(key, "ProxyEnable")
                proxy_info["proxy_enabled"] = bool(enabled)
                try:
                    server, _ = winreg.QueryValueEx(key, "ProxyServer")
                    proxy_info["proxy_server"] = str(server)
                except FileNotFoundError:
                    pass
        except Exception:
            pass

    return proxy_info


def get_local_ip_addresses() -> List[str]:
    """Retrieves all non-loopback local IPv4 addresses."""
    addresses = []
    try:
        hostname = socket.gethostname()
        for info in socket.getaddrinfo(hostname, None, socket.AF_INET):
            ip = info[4][0]
            if not ip.startswith("127.") and ip not in addresses:
                addresses.append(ip)
    except Exception:
        pass
    if not addresses:
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
                s.connect(("8.8.8.8", 80))
                addresses.append(s.getsockname()[0])
        except Exception:
            addresses.append("127.0.0.1")
    return addresses


def get_candidate_lan_interfaces() -> List[Dict[str, Any]]:
    """
    Identifies candidate LAN IPv4 addresses, distinguishing between standard LAN subnets
    (192.168.x.x, 10.x.x.x, 172.16-31.x.x) and loopback addresses.
    """
    candidates = []
    ips = get_local_ip_addresses()
    for ip in ips:
        is_private_lan = (
            ip.startswith("192.168.")
            or ip.startswith("10.")
            or any(ip.startswith(f"172.{i}.") for i in range(16, 32))
        )
        candidates.append({
            "ip": ip,
            "type": "LAN (Private)" if is_private_lan else "Other",
            "recommended_for_server": is_private_lan,
        })
    return candidates


def diagnose_connection_preflight(server_url: str, timeout_seconds: float = 3.0) -> Dict[str, Any]:
    """
    Performs a granular preflight diagnosis on the Server connection.
    Categorizes connectivity issues into actionable states:
    - OK
    - SERVICE_NOT_RUNNING
    - CONNECTION_TIMEOUT (with VPN routing checks)
    - UNREACHABLE
    - INVALID_URL
    """
    result = {
        "status": "UNKNOWN",
        "reachable": False,
        "host": "",
        "port": 0,
        "message": "",
        "vpn_suspected": False,
        "recommendation": "",
    }

    try:
        parsed = urlparse(server_url)
        host = parsed.hostname or "127.0.0.1"
        port = parsed.port or (443 if parsed.scheme == "https" else 80)
        result["host"] = host
        result["port"] = port
    except Exception as e:
        result["status"] = "INVALID_URL"
        result["message"] = f"Invalid server URL format: {str(e)}"
        result["recommendation"] = "Verify the server URL in Client Settings (e.g. http://192.168.1.100:8088)."
        return result

    proxy_status = get_system_proxy_status()
    has_active_proxy = proxy_status["proxy_enabled"] or bool(proxy_status["env_http_proxy"])

    try:
        with socket.create_connection((host, port), timeout=timeout_seconds):
            result["status"] = "OK"
            result["reachable"] = True
            result["message"] = f"Successfully connected to Server at {host}:{port}"
            return result
    except ConnectionRefusedError:
        result["status"] = "SERVICE_NOT_RUNNING"
        result["reachable"] = False
        result["message"] = f"Connection refused at {host}:{port}. The Admin Server is not running or listening on that port."
        result["recommendation"] = (
            "Ensure the Administrator laptop is powered on and the 'Start Service' button "
            "has been clicked in the Server Settings console."
        )
        return result
    except socket.timeout:
        result["status"] = "CONNECTION_TIMEOUT"
        result["reachable"] = False
        result["message"] = f"Connection to {host}:{port} timed out after {timeout_seconds}s."

        if has_active_proxy:
            result["vpn_suspected"] = True
            result["recommendation"] = (
                "A system proxy or VPN (such as V2RayN or Windscribe) appears to be active. "
                "LAN traffic to local IP addresses may be routed through the VPN tunnel. "
                "Troubleshooting step: Check VPN settings for 'Allow LAN Traffic' or 'Bypass Local IP addresses' (192.168.0.0/16, 10.0.0.0/8). "
                "Do NOT disable the VPN globally; adjust local bypass rules."
            )
        else:
            result["recommendation"] = (
                "Ensure both laptops are connected to the same Wi-Fi network and that Windows Firewall "
                "on the Server laptop permits inbound TCP connections on port 8088."
            )
        return result
    except socket.gaierror as e:
        result["status"] = "UNREACHABLE_HOST"
        result["reachable"] = False
        result["message"] = f"Cannot resolve server host '{host}': {str(e)}"
        result["recommendation"] = "Verify the Server hostname or enter the Server's static LAN IP address directly."
        return result
    except Exception as e:
        result["status"] = "ERROR"
        result["reachable"] = False
        result["message"] = f"Network error connecting to {host}:{port}: {str(e)}"
        result["recommendation"] = "Check physical network cable or Wi-Fi signal."
        return result


def check_server_connectivity(server_url: str, timeout_seconds: float = 3.0) -> Tuple[bool, str]:
    """Compatibility wrapper returning (is_reachable, message)."""
    diag = diagnose_connection_preflight(server_url, timeout_seconds)
    return diag["reachable"], diag["message"]


def get_windows_firewall_profiles() -> Dict[str, Any]:
    """Inspects Windows Firewall state for Domain, Private, and Public profiles."""
    profiles = {}
    if platform.system() != "Windows":
        return {"system": platform.system(), "status": "Non-Windows OS"}

    try:
        output = subprocess.check_output(
            ["netsh", "advfirewall", "show", "allprofiles", "state"],
            text=True,
            stderr=subprocess.DEVNULL,
        )
        current_profile = None
        for line in output.splitlines():
            line = line.strip()
            if "Profile Settings:" in line or "Profile:" in line:
                current_profile = line.split()[0]
            elif line.startswith("State") and current_profile:
                parts = line.split()
                if len(parts) >= 2:
                    profiles[current_profile] = parts[1]
    except Exception as e:
        profiles["error"] = str(e)
    return profiles


def run_full_diagnostics(server_url: str) -> Dict[str, Any]:
    """Runs a complete diagnostic scan for the local agent."""
    diag = diagnose_connection_preflight(server_url)
    return {
        "hostname": socket.gethostname(),
        "local_ips": get_local_ip_addresses(),
        "candidate_interfaces": get_candidate_lan_interfaces(),
        "server_url": server_url,
        "server_reachable": diag["reachable"],
        "server_status": diag["status"],
        "server_message": diag["message"],
        "vpn_suspected": diag["vpn_suspected"],
        "recommendation": diag["recommendation"],
        "proxy_info": get_system_proxy_status(),
        "firewall_profiles": get_windows_firewall_profiles(),
    }
