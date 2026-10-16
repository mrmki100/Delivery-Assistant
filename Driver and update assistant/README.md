# Driver and Update Assistant for Delivery Assistant

A secure, transactional Windows updater and restricted network folder-access management subsystem for the **Delivery Assistant** Chrome Extension (`Automoby to Chapar & Post - CX Master`).

---

## Key Features

1. **Feature A — Secure Chrome Extension Updater:**
   - Centralized release publishing over corporate Wi-Fi/LAN (~10 laptops).
   - Cryptographic signing (HMAC-SHA256 / Ed25519) and SHA-256 hash verification.
   - 16-state transaction state machine with atomic journaling.
   - Complete pre-update snapshot backup and verifiable automatic rollback.
   - Native Messaging Host bridge for verified Chrome activation.
   - Guaranteed protection against path-traversal, malicious executables, or corrupted archives.

2. **Feature B — User-Approved Folder Access:**
   - Explicit employee consent displayed on local machine.
   - Request-bound 8-digit OTP challenge preventing tampering, replay, and brute force.
   - Strict blocklist of system directories (`C:\Windows`, `AppData`, browser data).
   - Time-limited temporary Windows SMB share with lease expiration.
   - Automatic cleanup on expiry, revocation, or post-reboot recovery.

3. **User-Friendly Console Interface:**
   - Compact CMD-style interface with bilingual Persian / English support.
   - Clear two-primary-option menu for nontechnical employees.

---

## Quick Start

### 1. Launch Agent CLI
```powershell
python -m driver_update_assistant.cli
```

### 2. Run Test Suite
```powershell
python -m unittest discover -s tests -p "test_*.py"
```

### 3. Documentation
- [Architecture](ARCHITECTURE.md)
- [Security Policies](SECURITY.md)
- [Threat Model](THREAT_MODEL.md)
- [Installation Guide](INSTALL.md)
- [Operations Guide](OPERATIONS.md)
- [Project Log](PROJECT_LOG.md)
