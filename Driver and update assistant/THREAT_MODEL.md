# Threat Model: Driver and Update Assistant

## 1. Scope and System Assets

### 1.1 Assets to Protect
1. **Host Integrity:** Employee laptops must not execute untrusted code or be compromised via update mechanisms.
2. **User Data & Confidentiality:** Personal files, credentials, browser profiles, and corporate delivery tokens must not be exposed or leaked.
3. **Extension Functionality:** The Delivery Assistant extension must remain operable and free from corruption or unauthorized modification.
4. **Network Perimeter:** Employee machines must not become permanent network file servers or expose open SMB ports to the entire LAN.

---

## 2. Threat Actors & Attacker Profiles

| Attacker Profile | Capabilities | Motivation |
| :--- | :--- | :--- |
| **Rogue Device on LAN** | Connected to same corporate Wi-Fi; can sniff unencrypted traffic, spoof DNS, or run rogue HTTP servers. | Man-in-the-middle attacks, credential harvesting, malware injection. |
| **Malicious Web Page / Extension** | Running in Chrome; attempts to message native hosts via Native Messaging API. | Sandbox escape, local file access, system compromise. |
| **Insider / Unauthorized Admin** | Admin network access; attempts to access employee files without explicit employee consent. | Exfiltration of unauthorized personal or sensitive data. |
| **Accidental Operator / Crash** | Power outage, network drop, user closing CMD window mid-transaction. | Unintentional corruption of extension files or lingering open shares. |

---

## 3. STRIDE Threat Analysis

### 3.1 Spoofing (Identity & Origin)
- **Threat:** Rogue LAN server impersonating the Admin Server to serve backdoored extension releases.
  - *Mitigation:* Releases must be cryptographically signed with the administrator's private key. The agent verifies the digital signature before opening the archive. Device enrollment uses pre-shared secret device tokens.
- **Threat:** Rogue browser extension calling the Native Messaging Host.
  - *Mitigation:* Chrome OS process sandbox restricts native messaging connections strictly to extensions listed in the host manifest (`allowed_origins`). The host double-checks the origin on connection.

### 3.2 Tampering (Data Integrity)
- **Threat:** Tampering with package payload in transit or in temporary directories.
  - *Mitigation:* SHA-256 package hash verified prior to extraction. Staging directory created with user-only ACLs. Path traversal checks prevent escaping target directories.
- **Threat:** Modifying the folder path or escalating permissions after an OTP is generated.
  - *Mitigation:* The OTP is cryptographically bound to `(request_id, device_id, folder_path, permission_level)`. If any parameter is altered, the server rejects the approval.
- **Threat:** State corruption due to process crash during file installation.
  - *Mitigation:* Atomic write of transaction journal state before filesystem modifications. Rollback engine can restore original files from snapshot upon next agent launch.

### 3.3 Repudiation
- **Threat:** Admin denies requesting access to a sensitive folder, or employee denies granting consent.
  - *Mitigation:* Both Admin Server and Agent maintain structured audit logs recording request IDs, timestamps, device IDs, folder paths, permissions, and outcome.

### 3.4 Information Disclosure
- **Threat:** Sensitive files, user credentials, or passwords exposed via network sharing.
  - *Mitigation:* Strict blocklist for system directories (`C:\Windows`, `AppData`, browser profiles). Explicit read-only default. Temporary firewall rules restricted to the Admin laptop IP. Hard lease expiration (max 60 minutes).
- **Threat:** Plaintext OTP intercepted in transit.
  - *Mitigation:* The OTP is displayed locally to the employee and communicated out-of-band. The server stores only an HMAC digest.

### 3.5 Denial of Service
- **Threat:** Network drop or disk exhaustion during package download causing broken extension state.
  - *Mitigation:* Downloads occur into isolated staging directories. Existing extension is never modified until the package is fully verified and a backup snapshot is taken.
- **Threat:** Flooding the OTP verification endpoint to guess the 8-digit code.
  - *Mitigation:* Strict 3-attempt limit per request. 5-minute expiry.

### 3.6 Elevation of Privilege
- **Threat:** Update package containing `.exe` or `.bat` files executing with elevated privileges.
  - *Mitigation:* Update packages are restricted to static web assets. Executables and scripts are explicitly rejected. Agent never executes downloaded files.
- **Threat:** Native messaging host exploited as an arbitrary shell runner.
  - *Mitigation:* The host accepts only a fixed enumeration of schema-validated commands. No `cmd.exe`, `powershell.exe`, or arbitrary subprocess execution is permitted from native messaging.

---

## 4. Residual Risks & Compensating Controls

1. **Unpacked Chrome Extension Reload Limitation:**
   - *Risk:* In developer mode, file changes on disk require `chrome.runtime.reload()` or browser restart.
   - *Control:* Native Messaging host sends a reload request to the extension service worker and monitors runtime version reporting. If activation fails to confirm within 60s, the agent logs `ACTIVATION_PENDING` / warns user to click reload in Chrome.
2. **Wi-Fi LAN Sniffing if HTTP is used:**
   - *Risk:* On unsegmented Wi-Fi, cleartext HTTP metadata could be observed.
   - *Control:* The Admin server supports HTTPS with local certificates. All package integrity relies on end-to-end cryptographic signatures, not transport trust alone.
