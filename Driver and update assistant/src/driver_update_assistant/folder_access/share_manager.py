"""Windows SMB share and scoped firewall rule lifecycle manager."""

import os
import platform
import subprocess
from pathlib import Path
from typing import Optional, Tuple

from driver_update_assistant.protocol import ErrorCode, SharePermission


class ShareManager:
    """Manages the creation, verification, and unprovisioning of temporary SMB shares."""

    def __init__(self, dry_run: bool = False):
        self.dry_run = dry_run or (platform.system() != "Windows")

    def create_share(
        self,
        share_name: str,
        folder_path: str,
        permission: SharePermission = SharePermission.READ_ONLY,
        admin_ip: Optional[str] = None,
        session_id: Optional[str] = None,
    ) -> Tuple[bool, ErrorCode, str, Optional[str]]:
        """
        Creates a temporary Windows SMB share and an optional IP-scoped firewall rule.
        Returns (success, error_code, reason, firewall_rule_name).
        """
        if self.dry_run:
            fw_name = f"DeliveryAssistant_TempShare_{session_id}" if admin_ip else None
            return True, ErrorCode.NONE, f"[MOCK] Share {share_name} provisioned for {folder_path}", fw_name

        perm_flag = "READ" if permission == SharePermission.READ_ONLY else "FULL"
        # We grant access to the current logged-in user context
        user_name = os.environ.get("USERNAME", "Everyone")

        cmd = ["net", "share", f"{share_name}={folder_path}", f"/GRANT:{user_name},{perm_flag}"]

        try:
            res = subprocess.run(cmd, capture_output=True, text=True)
            if res.returncode != 0:
                return (
                    False,
                    ErrorCode.SHARE_CREATION_FAILED,
                    f"net share failed (code {res.returncode}): {res.stderr.strip() or res.stdout.strip()}",
                    None,
                )
        except Exception as e:
            return False, ErrorCode.SHARE_CREATION_FAILED, f"Failed to execute net share: {str(e)}", None

        # Optionally add scoped firewall rule if admin_ip is specified
        fw_rule_name = None
        if admin_ip and session_id:
            fw_rule_name = f"DeliveryAssistant_TempShare_{session_id}"
            fw_cmd = [
                "netsh", "advfirewall", "firewall", "add", "rule",
                f"name={fw_rule_name}",
                "dir=in",
                "action=allow",
                "protocol=TCP",
                "localport=445",
                f"remoteip={admin_ip}",
            ]
            try:
                subprocess.run(fw_cmd, capture_output=True, text=True)
            except Exception:
                # If non-elevated user cannot add firewall rule, share still exists on local subnet
                fw_rule_name = None

        return True, ErrorCode.NONE, f"Share {share_name} created successfully", fw_rule_name

    def remove_share(self, share_name: str, firewall_rule_name: Optional[str] = None) -> Tuple[bool, str]:
        """
        Dismantles the temporary Windows SMB share and deletes the scoped firewall rule.
        """
        if self.dry_run:
            return True, f"[MOCK] Share {share_name} removed"

        success = True
        messages = []

        # 1. Delete SMB share
        del_cmd = ["net", "share", share_name, "/delete", "/y"]
        try:
            res = subprocess.run(del_cmd, capture_output=True, text=True)
            if res.returncode == 0 or "does not exist" in (res.stderr + res.stdout).lower():
                messages.append(f"Share {share_name} removed.")
            else:
                success = False
                messages.append(f"Failed to delete share {share_name}: {res.stderr.strip()}")
        except Exception as e:
            success = False
            messages.append(f"Error removing share: {str(e)}")

        # 2. Delete firewall rule if provisioned
        if firewall_rule_name:
            fw_del_cmd = ["netsh", "advfirewall", "firewall", "delete", "rule", f"name={firewall_rule_name}"]
            try:
                subprocess.run(fw_del_cmd, capture_output=True, text=True)
                messages.append(f"Firewall rule {firewall_rule_name} removed.")
            except Exception as e:
                messages.append(f"Error removing firewall rule: {str(e)}")

        return success, " | ".join(messages)
