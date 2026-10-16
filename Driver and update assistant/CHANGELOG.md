# Changelog: Driver and Update Assistant

All notable changes to the Driver and Update Assistant subsystem are documented in this file.

## [1.0.0] - 2026-10-09

### Added
- **Feature A: Chrome Extension Update Management Pipeline**:
  - Implemented release metadata schema, cryptographic package hash verification (SHA-256), and digital signature validation (HMAC-SHA256 / Ed25519).
  - Built 16-state transaction state machine with durable atomic journaling (`transaction_journal.json`).
  - Added safe staging extraction with path-traversal prevention and strict file type allowlisting.
  - Added pre-update directory snapshot engine and verifiable rollback restore.
  - Implemented Chrome Native Messaging host (`driver_update_assistant`) for secure in-memory extension reload triggering and runtime version verification.
  - Implemented Admin Server with REST API for release publishing, device check-ins, and update reporting with durable client outbox.
- **Feature B: Explicitly Authorized Folder Access**:
  - Implemented local consent interface showing requesting administrator, purpose, path, permissions, and duration.
  - Added system path blocklist (`C:\Windows`, `AppData`, browser profiles, root drives).
  - Built cryptographically secure 8-digit OTP challenge engine bound to `(request_id, device_id, folder_path, permissions)`.
  - Implemented Windows SMB share lifecycle with lease expiration and scoped firewall rule management.
  - Added automatic startup crash and reboot recovery engine for lingering shares.
- **Console Interface (CLI)**:
  - Compact Windows CMD-style interface with Persian and English messages.
  - Two primary menu choices: `1. Extension Updater`, `2. Authorized Folder Access`.
  - Submenus for diagnostics, status, and administrative release management.
- **Quality & Testing Suite**:
  - Comprehensive automated failure test suite covering over 40 failure scenarios for updater and folder access.
