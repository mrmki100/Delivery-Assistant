# Security & Threat Model: Driver and Update Assistant

## 1. Security Architecture Principles

The **Driver and Update Assistant** system is designed under a **Zero-Trust & Mutual Consent** framework. Administrative authority alone is insufficient to compromise employee confidentiality or system stability.

Key security tenets:
1. **Role Separation:** Distinct executables, binaries, and privileges for Server and Client.
2. **Mutual Consent:** Privileged operations on client laptops (such as remote folder access) require active local user authorization.
3. **Defense in Depth:** Multi-layer input validation, cryptographic integrity verification, and state machine transaction rollback.
4. **Least Privilege:** Default read-only access, tightly scoped firewall rules, and restriction of access to non-sensitive user directories.

---

## 2. Authentication & Device Identity

### 2.1 Enrolled Device Registry
- Devices must be enrolled by an administrator before they can query updates or participate in folder sharing.
- Each device receives a cryptographically secure 256-bit random bearer token upon enrollment.
- Tokens are stored on the server using **salted SHA-256 hashes**. Raw tokens are never stored in plaintext in the database or exposed via API endpoints.
- Server rejects all unauthenticated requests with `401 Unauthorized` or `403 Forbidden`.

### 2.2 Instant Revocation
- When a device is revoked in the administrator console, its token hash status is updated to `revoked` in SQLite.
- All subsequent API requests from the revoked device are rejected immediately.

---

## 3. Extension Release Integrity & Verification

### 3.1 Cryptographic Release Signing
Every extension release distributed by the Server contains:
- `sha256`: SHA-256 digest of the entire release payload archive.
- `signature`: HMAC-SHA256 signature generated using a 256-bit master signing secret known only to the Server.

### 3.2 Client-Side Pre-Installation Verification
Before an update is unpacked or executed, the Client:
1. Downloads the package into an isolated staging folder outside the live extension root.
2. Re-computes the SHA-256 hash of the downloaded file and validates equality against metadata.
3. Validates the HMAC signature to ensure the release was produced by the genuine administrator server.
4. Rejects any package if the hash or signature does not verify.

### 3.3 Path Traversal Defense (Anti-ZipSlip)
- During archive extraction, every entry path is canonicalized using `os.path.abspath`.
- If an entry contains path traversal sequences (such as `../` or absolute drive roots) attempting to write outside the staging directory, extraction is immediately aborted and logged as a security alert.

---

## 4. Authorized Remote Folder Access Security

### 4.1 Restricted Path Policy
The Client strictly forbids sharing sensitive operating system, program, and user-profile root directories. Attempting to share any of the following paths is rejected with `INVALID_FOLDER_PATH`:
- Drive roots (e.g., `C:\`, `D:\`)
- Windows directories (e.g., `C:\Windows`, `System32`)
- Program Files (`C:\Program Files`, `C:\Program Files (x86)`)
- Critical User folders (`AppData`, `System Volume Information`, `Recovery`)

### 4.2 Two-Factor Mutual Consent & 8-Digit OTP
To prevent unauthorized or rogue server access:
1. The administrator specifies the exact path, purpose, duration, and access mode (`Read-Only` or `Read-Write`).
2. The employee laptop displays the full details of the request in the Client GUI.
3. If the employee approves, the Client generates a cryptographically bound 8-digit OTP (`XXXX-XXXX`) derived from an HMAC digest of `(challenge_id + path + duration + secret)`.
4. The OTP is valid for a maximum of 5 minutes and permits a maximum of 3 verification attempts. After 3 failed attempts, the challenge is invalidated to prevent brute-force attacks.

### 4.3 Scoped ACLs and Windows Share Management
- When access is granted, the Client creates a scoped Windows SMB share targeting *only* the approved directory.
- Windows file ACLs are updated to grant access only to the authenticated session user, with `Read` or `Read/Write` as specified.
- The pre-existing ACL state is snapshotted to disk prior to modification.
- Upon session expiration, cancellation, or error, the Client terminates open file handles, deletes the SMB share, and restores the original ACLs.

### 4.4 Firewall Configuration Safety
- The application never disables Windows Firewall globally.
- Inbound firewall rules are scoped strictly to the required TCP port (`8088` on Server, SMB ports only when active lease exists).
- Rules are automatically deregistered upon application uninstallation or service termination.

---

## 5. Chrome Native Messaging Host Security

If integrated with Chrome Native Messaging:
- The Native Messaging Host manifest explicitly locks `allowed_origins` to the specific extension ID (`peeaifdbofikdfgffggf...`).
- Incoming messages are strictly deserialized via typed JSON schemas.
- No arbitrary shell commands, script execution, or raw system calls are exposed via the Native Messaging channel.
