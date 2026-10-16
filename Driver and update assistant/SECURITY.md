# Security Architecture & Policies: Driver and Update Assistant

## 1. Cryptographic Architecture

### 1.1 Package Verification & Integrity
- **Digest Algorithm:** SHA-256 for all update packages and individual critical files.
- **Digital Signatures:** Releases are signed by the administrator using an HMAC-SHA256 signature scheme with a 256-bit secret or an Ed25519 signature. The agent validates this signature against its pre-installed verification key before unpacking or staging any archive.
- **Untrusted Server Defense:** Even if an attacker compromises the server IP or DNS on the Wi-Fi LAN, they cannot inject malicious code into agent machines without the valid signature key.

### 1.3 Release Signing: Symmetric HMAC vs. Asymmetric Ed25519 Assessment & Migration Plan
- **Current HMAC Architecture:** Releases are signed using HMAC-SHA256 computed over `product_id:version:release_id:package_sha256:package_size`. While this prevents unauthenticated third-party package forgery on the network, it relies on a shared symmetric secret (`verification_secret`) provisioned on each employee laptop (`agent.toml`).
- **Security Implications:**
  1. *Shared Secret Exposure:* A compromised employee machine or malicious insider with administrator rights to their local disk can extract `verification_secret`.
  2. *Forged Package Injection:* Possession of this secret allows an attacker to forge release signatures for arbitrary modified extension packages, potentially targeting other employee machines if the network transport or DNS were spoofed.
- **Target Asymmetric Architecture (Ed25519):**
  1. *Server-Side Private Key:* The private signing key (`release_signer.key`) is generated once and stored exclusively on the administrator machine with restricted file ACLs or hardware token protection.
  2. *Client-Side Public Key:* Employee laptops receive only the corresponding public verification key (`release_verifier.pub`), which allows mathematical verification of genuine signatures but makes signature forgery computationally infeasible even if reverse-engineered.
- **Backward-Compatible Migration Roadmap:**
  - **Phase 1 (Dual Signing & Dual Verification):** AdminServer computes both an HMAC-SHA256 signature and an Ed25519 signature in release metadata (`signature` and `signature_ed25519`). Client checks for `public_key_path` in `agent.toml`; if present, it validates Ed25519; otherwise, it falls back to HMAC.
  - **Phase 2 (Public Key Distribution):** Distribute `release_verifier.pub` to client configurations via standard workstation provisioning.
  - **Phase 3 (HMAC Deprecation):** Once all active fleet machines are running the Ed25519-aware updater, disable HMAC validation on clients and reject releases lacking valid asymmetric signatures.

---

## 2. Windows Privilege & UAC Boundary

1. **Unelevated by Default:** The agent runs under the standard logged-in user account. Ordinary version checks, downloads, package verifications, staging, and extension file updates for user-owned directories require NO administrative elevation.
2. **Narrow Elevation for System-Level Operations:** Only operations that strictly require local administrative rights (such as configuring temporary Windows Firewall rules or managing Windows SMB shares) request elevation via Windows UAC (`ShellExecute` with `runas`).
3. **No Silent Elevation or SYSTEM Service:** The application never attempts to bypass UAC, install unquoted service paths, run arbitrary commands as SYSTEM, or modify core Windows security settings.

---

## 3. Filesystem & Path Security

### 3.1 Extension Update Staging
- All zip extraction is strictly validated against path traversal:
  - Rejects `..`, drive letters (`C:`), UNC paths (`\\server\share`), and leading slashes.
  - Ensures every extracted file resolves strictly within the staging directory.
- File extensions inside update archives are strictly constrained to static web assets: `.js`, `.json`, `.css`, `.html`, `.png`, `.jpg`, `.svg`, `.ico`, `.txt`, `.md`. Any `.exe`, `.dll`, `.bat`, `.cmd`, `.vbs`, `.ps1`, or `.scr` file triggers immediate package rejection.

### 3.2 Folder Access Blocklist
To protect sensitive system and personal data, the following paths (and their subdirectories) are strictly blocked from being shared under Feature B:
- Windows Root & System: `C:\Windows`, `C:\`, `D:\` (root drives)
- Program Files: `C:\Program Files`, `C:\Program Files (x86)`
- User Credentials & App Data: `%APPDATA%`, `%LOCALAPPDATA%`, `%USERPROFILE%\AppData`
- Chrome Profiles: `Default`, `User Data`, extension storage directories
- System Volume Information, Recovery, `$Recycle.Bin`

All paths are resolved to their canonical paths (`os.path.realpath`) before validation, defeating symlink and directory junction bypasses.

---

## 4. Chrome Native Messaging Security

- **Host Manifest:** `driver_update_assistant.json` installed in `HKCU\Software\Google\Chrome\NativeMessagingHosts`.
- **Origin Lockdown:** Only the specific unpacked extension ID (`ajbnjogoeehfjnjbpodgoihmcmooliom`) and configured extension IDs are listed in `allowed_origins`. Chrome automatically enforces this at the process boundary.
- **Payload Limits:** Maximum message length strictly enforced at 64 KB (Chrome's default max is 1 MB).
- **Strict Schema & Action Whitelist:** The native host only responds to explicit actions (`GET_STATUS`, `TRIGGER_UPDATE`, `REPORT_RUNTIME_VERSION`, `REQUEST_RELOAD`). No arbitrary shell command execution, file execution, or script evaluation is ever exposed.

---

## 5. Network & SMB Security Policy

1. **No Anonymous or Guest Access:** SMB guest and anonymous sessions remain disabled. Access requires explicit local credentials or machine-level trust.
2. **Firewall Scope:** If an inbound SMB rule is provisioned, it is explicitly scoped to the administrator laptop's IP address (`RemoteAddresses: <AdminIP>`).
3. **Lease Model:** Shares automatically unprovision after lease expiration (default 30 minutes, max 60 minutes).
4. **No Permanent State Degradation:** The Windows network profile is never changed globally from Public to Private without user confirmation, and Windows Defender / Firewall are never disabled.

---

## 6. Privacy & Redaction

Structured logs and audit trails strictly redact:
- Plaintext OTPs
- Passwords and bearer tokens
- Extension cookies and session headers
- Personal file contents
- Sensitive personal paths
