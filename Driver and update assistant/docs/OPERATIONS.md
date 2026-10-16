# Administrator & Operator Manual: Driver and Update Assistant

## 1. Overview

The **Driver and Update Assistant** system provides zero-trust fleet management for distributing Chrome extension updates and managing authorized, temporary remote folder access over local area networks (LAN).

- **Server Console (`DriverUpdateAssistant-Server.exe`):** Installed only on the administrator's laptop.
- **Client Application (`DriverUpdateAssistant-Client.exe`):** Installed on employee laptops.

---

## 2. Server Installation & First-Time Setup

### 2.1 System Requirements
- Windows 10 / 11 (64-bit) or Windows Server 2019+
- Administrator privileges (for managing LAN inbound port 8088 in Windows Firewall)
- Network connectivity on the office LAN / VPN

### 2.2 First Launch
1. Launch `DriverUpdateAssistant-Server.exe` from `dist\server\DriverUpdateAssistant-Server\`.
2. Navigate to **Server Settings** in the left sidebar:
   - Verify the detected **LAN IP Address** (e.g. `192.168.1.100`).
   - Confirm the listening port (default: `8088`).
   - Click **Start Service**. The status badge in the top bar will turn green (`RUNNING`).
3. If prompted by Windows Defender Firewall, allow incoming LAN connections for the Server application.

---

## 3. Enrolling Employee Laptops

Enrollment establishes a zero-trust cryptographic relationship between the Server and an employee Client laptop.

### 3.1 Generating Enrollment Credentials
1. In the Server Console, navigate to the **Devices** tab.
2. Click **Enroll New Device**.
3. Enter the device identifier (e.g., `LAPTOP-SALES-01`).
4. Click **Generate Token**.
5. Copy the generated bearer token. Provide the following details securely to the employee:
   - Server URL: `http://<ADMIN_LAN_IP>:8088`
   - Device ID: `LAPTOP-SALES-01`
   - Enrollment Token: `<SECRET_TOKEN>`

### 3.2 Revoking a Device
If an employee laptop is retired, lost, or compromised:
1. In the **Devices** tab, locate the device in the table.
2. Click **Revoke**.
3. Confirm revocation. The device's token hash is immediately invalidated in the registry. Subsequent requests from that device will receive `403 Forbidden - Device Revoked`.

---

## 4. Publishing Chrome Extension Releases

### 4.1 Release Packaging & Validation
1. In the Server Console, navigate to the **Extension Releases** tab.
2. In the **Publish New Release** card, click **Browse...** and select either:
   - The uncompressed extension directory containing `manifest.json`.
   - A `.zip` release archive containing the extension files.
3. The Server automatically:
   - Parses `manifest.json` and extracts the extension version and name.
   - Calculates the SHA-256 cryptographic digest of the release files.
   - Signs the release using the master HMAC secret.
4. Enter detailed **Release Notes** explaining the changes.
5. Click **Publish Release**.
6. The release is published to the immutable registry. Enrolled client laptops will automatically detect the new version during their next synchronization cycle.

---

## 5. Managing Remote Folder Access

### 5.1 Initiating an Access Request
1. In the Server Console, navigate to the **Folder Access** tab.
2. Select the target **Device** from the dropdown of active devices.
3. Specify the **Target Folder Path** on the employee machine (e.g. `C:\Logs\Automoby`).
   - *Note:* Protected operating system folders (such as `C:\Windows`, `Program Files`, and system roots) are automatically blocked.
4. Select the **Access Mode**:
   - `Read-Only` (default)
   - `Read-Write` (requires explicit elevated administrative justification)
5. Set the **Lease Duration** (e.g., 60 minutes).
6. Enter the administrative **Purpose** for the audit log.
7. Click **Request Folder Access**.

### 5.2 Mutual Consent & OTP Verification
1. The employee receives a notification and sees the pending request in their **Folder Access** tab.
2. The employee clicks **Approve**. The Client generates a cryptographically bound 8-digit One-Time Passcode (OTP), formatted as `XXXX-XXXX`, valid for 5 minutes.
3. The employee communicates the 8-digit code to the administrator verbally or via internal chat.
4. In the Server Console, click **Verify OTP & Connect**.
5. Enter the 8-digit code. Once validated, the temporary Windows share is activated with strict ACLs and an active lease countdown.

### 5.3 Lease Expiration and Revocation
- When the timer expires, the Client automatically unshares the folder and restores previous ACLs.
- The administrator can click **Revoke Lease** at any time from the Server Console to terminate access immediately.

---

## 6. Audit Logging and Troubleshooting

### 6.1 Audit Logs
- Navigate to **Audit Logs** to view timestamped, structured logs.
- Use the severity filter (`ALL`, `INFO`, `WARNING`, `ERROR`, `CRITICAL`) and search box to find specific events.
- Click **Export Sanitized Report** to generate a JSON report with tokens and sensitive paths redacted for compliance reviews.

### 6.2 Common Operational Issues
- **Client shows "Disconnected":**
  1. Verify the Server laptop is powered on and `Admin Server` is running.
  2. Verify both laptops are on the same subnet or connected to the corporate VPN.
  3. Ensure Windows Firewall on the Server allows inbound TCP on port 8088.
- **Update Stuck / Rollback Triggered:**
  - If an update is interrupted by a power failure or file lock, the Client's 16-state transaction manager will automatically restore the pre-update backup snapshot on subsequent launch.
