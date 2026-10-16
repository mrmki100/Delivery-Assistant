# Delivery Assistant: Deployment & Installation Guide

This guide describes the complete procedure for deploying the **Central Management Console (Server)** on the administrator's laptop and the **Employee Client Application** on employee laptops.

---

## 1. System Requirements & Architecture Separation

| Role | Target System | Executable / Entry Point | Permissions Required |
| :--- | :--- | :--- | :--- |
| **Server** | Administrator Laptop Only | `DriverUpdateAssistant-Server.exe`<br>*(or `python -m driver_update_assistant.server.main`)* | Standard User (Optional Admin for port < 1024) |
| **Client** | Employee Laptops | `DriverUpdateAssistant-Client.exe`<br>*(or `python -m driver_update_assistant.client.main`)* | Standard User (Admin required only during temporary SMB share creation) |

---

## 2. Administrator Laptop Setup (Server Application)

### Step 1: Staging the Application
The Server application is packaged inside:
```
Driver and update assistant\dist\server\DriverUpdateAssistant-Server\
```
Run `DriverUpdateAssistant-Server.exe` directly or run via source:
```powershell
python -m driver_update_assistant.server.main
```

### Step 2: Network & Firewall Configuration
1. Open Windows Defender Firewall:
   Allow incoming connections on the configured listening port (default: `TCP 8088`).
   ```powershell
   New-NetFirewallRule -DisplayName "Delivery Assistant Server" -Direction Inbound -LocalPort 8088 -Protocol TCP -Action Allow -Profile Private
   ```
2. Note your administrator laptop LAN IP address from the Server UI (`Server Settings` tab displays detected LAN addresses, e.g. `http://192.168.1.50:8088`).

### Step 3: Device Pre-Enrollment (Zero-Trust)
1. In the Server GUI, click the **Enrolled Laptops** tab.
2. Click **Enroll Device**.
3. Enter the employee's Device ID (e.g. `LAPTOP-02`) and Hostname.
4. Click **Enroll**. The dialog generates and displays a secure 32-character bearer token.
5. Provide the `Device ID` and `Token` securely to the employee for their one-time client configuration.

---

## 3. Employee Laptop Setup (Client Application)

### Step 1: Deploying the Client Executable
Copy the standalone client folder to the employee laptop:
```
Driver and update assistant\dist\client\DriverUpdateAssistant-Client\
```
Run `DriverUpdateAssistant-Client.exe` (or via source `python -m driver_update_assistant.client.main`).

### Step 2: First-Time Connection & Configuration
1. In the Client GUI, navigate to the **Settings & Support** tab.
2. Enter the administrator's LAN Server URL:
   ```
   http://<ADMIN_LAN_IP>:8088
   ```
3. Enter the assigned `Device Identifier` and `Enrollment Token`.
4. Click **Test Connection**. A green indicator confirms that the central server health endpoint is reachable.
5. Click **Save Settings**.

### Step 3: Verify Chrome Extension Detection
1. In the Client GUI, check the **Home Overview** and **Extension Updates** tabs.
2. The client will detect the installed Chrome extension version (e.g. `v19.0`) by reading `manifest.json`.
3. Click **Sync and Check** to perform the initial heartbeat check-in.

---

## 4. Operational Workflows

### A. Publishing an Extension Update (Administrator)
1. On the Server laptop, open the **Extension Releases** tab.
2. Click **Publish New Release**.
3. Select the folder containing the updated extension files (containing valid `manifest.json`).
4. The server inspects the folder, validates manifest keys, displays the detected version, and generates SHA-256 and HMAC-SHA256 signatures.
5. Enter release notes and click **Publish and Sign Release**.

### B. Installing an Update (Employee)
1. In the Client GUI, the **Extension Updates** tab displays "Update Available: vX.Y.Z" with changelog notes.
2. Click **Download and Install Update**.
3. The client:
   - Downloads the package into a sandboxed staging folder.
   - Verifies the SHA-256 hash and HMAC signature.
   - Takes an atomic snapshot backup of the current extension directory.
   - Replaces files transactionally.
   - If anything fails, it automatically rolls back to the previous snapshot.
4. **Activation in Developer Mode:** Reload the extension in `chrome://extensions` or restart Chrome.

### C. Authorized Remote Folder Access
1. Administrator selects the device in **Folder Access** and submits an access request specifying path, duration, and access level.
2. The employee receives the request in their Client GUI under **Folder Access**.
3. The employee reviews the path, purpose, and lease duration, and clicks **Approve and Generate Code**.
4. The Client displays an 8-digit verification code (`XXXX-XXXX`).
5. The employee shares this code with the administrator.
6. The administrator enters the code in their Server GUI. Upon HMAC verification, access is activated.
7. Either party can click **Revoke Now** at any time to instantly unprovision the share and remove firewall rules.

---

## 5. Uninstallation & Complete Cleanup

To remove the Client application and all associated shares/rules:
```powershell
powershell -ExecutionPolicy Bypass -File scripts\uninstall_agent.ps1
```
This cleans up:
1. Active temporary SMB shares (`net share /delete`).
2. Any temporary firewall rules (`DeliveryAssistant_TempShare_*`).
3. Local transaction journals and telemetry outbox.
4. Leaves the Chrome extension completely intact in its current working state.
