# Operations Guide: Driver and Update Assistant

## 1. Publishing a New Extension Release

When the development team has tested a new version of the Delivery Assistant extension (e.g. `20.0`):

### Step 1: Prepare the Source Files
Ensure `manifest.json` has the incremented version:
```json
{
  "manifest_version": 3,
  "name": "Delivery Assistant",
  "version": "20.0"
}
```

### Step 2: Publish via Admin CLI
Run the publisher command on the Admin laptop:
```powershell
python -m driver_update_assistant.cli --admin publish `
  --version "20.0" `
  --source-dir "C:\Path\To\NewExtension" `
  --notes "Updated tracking and improved Jira integration"
```

The publisher tool will:
1. Validate all files inside `source-dir` (ensures valid `manifest.json`, forbids `.exe`/`.bat`/`.vbs` executables).
2. Archive the files into `releases/delivery_assistant_v20.0_<hash>.zip`.
3. Compute the package SHA-256 digest.
4. Sign the package metadata using the private signing key.
5. Store the release metadata in the Admin Server release repository.

---

## 2. Managing Enrolled Devices

### 2.1 Enrolling a New Laptop
To authorize a new device (e.g. `LAPTOP-03`):
```powershell
python -m driver_update_assistant.cli --admin enroll --device-id "LAPTOP-03"
```
The command outputs a unique `device_token` to be placed into `config\agent.toml` on that laptop.

### 2.2 Inspecting Fleet Status
```powershell
python -m driver_update_assistant.cli --admin status
```
Output displays:
- Device ID
- Installed Version
- Update Transaction State (`IDLE`, `DOWNLOADING`, `ACTIVATION_VERIFIED`, etc.)
- Last Check-in Timestamp
- Failure / Rollback status

---

## 3. Extension Update Workflow (Employee Laptop)

From the employee laptop, launch the compact CLI:
```powershell
python -m driver_update_assistant.cli
```
Select:
```
1. Extension Updater
```
The agent checks the Admin Server for updates:
1. Downloads and cryptographically verifies the package.
2. Creates an exact snapshot backup of the current extension folder.
3. Stages the new files and atomically swaps them.
4. Signals Chrome to reload the extension.
5. Verifies that the running extension reports the new version string.
6. If any step fails, automatically restores the backup snapshot and reports the rollback to the Admin Server.

---

## 4. Temporary Folder Access Workflow (Feature B)

### Step 1: Admin Initiates Request
Admin sends a request to the employee machine via Admin Console or out-of-band:
- Admin Identity: `Admin (IT/Support)`
- Purpose: `Diagnose barcode scanner logs`
- Proposed Folder: `C:\Users\<user>\Desktop\ScannerLogs`
- Access: `Read-Only` (or `Read-Write`)
- Duration: `30 minutes`

### Step 2: Employee Grants Consent & Generates OTP
On the employee laptop CLI:
1. Select `2. Authorized Folder Access`.
2. Review the pending request details.
3. Verify or enter the exact folder path to share (system paths like `C:\Windows`, `AppData` are blocked).
4. Select `Generate One-Time Code`.
5. An 8-digit OTP is displayed on screen (e.g. `5829-1048`), valid for 5 minutes.
6. The employee reads the code to the admin.

### Step 3: Admin Submits Code
Admin submits the OTP to the Admin Server:
```powershell
python -m driver_update_assistant.cli --admin approve-folder --request-id "<REQ-ID>" --code "58291048"
```
Server validates the code and authorizes the temporary share.

### Step 4: Share Activation & Revocation
- The agent enables the temporary share (`\\LAPTOP-02\TempShare_<ReqID>`).
- On lease expiry or if employee selects `Revoke Active Share`, the share and firewall rules are immediately dismantled.

---

## 5. Emergency Rollback & Intervention

If an update is interrupted (power cut, crash) or fails activation:
1. Run:
   ```powershell
   python -m driver_update_assistant.cli --recover
   ```
2. The agent reads `data/transaction_journal.json`.
3. If an incomplete transaction is detected, the agent restores the active extension files from `data/backups/latest/`, verifies file hashes against the pre-update manifest, flushes the journal to `ROLLBACK_VERIFIED`, and reports the outcome to the Admin Server.
