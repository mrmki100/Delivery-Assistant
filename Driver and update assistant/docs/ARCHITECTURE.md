# System Architecture: Role Separation & Design System

## 1. Role Separation Overview

The Delivery Assistant desktop subsystem is organized into two distinct applications:

```
Driver and update assistant/
├── src/driver_update_assistant/
│   ├── server/               # Dedicated Administrator Management Console
│   │   ├── gui/              # Dashboard, Devices, Releases, Folder Access, Settings, Logs
│   │   ├── app.py            # Threaded HTTP REST Server API
│   │   ├── audit_log.py      # SQLite tamper-evident security audit logger
│   │   ├── device_registry.py# Zero-trust device inventory & credential hashes
│   │   └── release_store.py  # Package validation, SHA-256 & HMAC signing
│   ├── client/               # Dedicated Employee Laptop Client Application
│   │   ├── gui/              # Home Overview, Updates, Folder Access, Settings
│   │   ├── core.py           # AgentClient, 16-state transaction machine, Durable Outbox
│   │   └── service.py        # QThread workers for non-blocking UI operations
│   ├── ui/                   # Modern Design System (Segoe UI, Light/Dark QSS, Vector Icons)
│   ├── folder_access/        # Zero-trust OTP generator, path validation, scoped shares
│   ├── updater/              # Staging, atomic backup snapshots, transactional installer
│   └── protocol.py           # Strictly typed dataclasses and error codes
```

## 2. Key Invariants

1. **Role Independence:**
   - Server builds exclude client GUI components.
   - Client builds exclude server administration components.
   - No generic executable prompting for roles at startup.

2. **Zero-Trust Security:**
   - Every client request must provide an enrolled bearer token validated against salted SHA-256 hashes.
   - System root directories, Windows directories, and AppData folders are strictly prohibited from folder access sharing.
   - 8-digit OTP passcodes are single-use, rate-limited (max 3 attempts), and bound to request parameters via HMAC.

3. **Transaction Safety:**
   - 16 distinct states in the update transaction state machine.
   - Pre-update backup snapshot taken before touching any extension files.
   - Automatic verified rollback upon failure or process crash.
