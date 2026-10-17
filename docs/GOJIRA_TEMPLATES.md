# GoJira Template Architecture & Developer Guide

## 1. Purpose of GoJira

**GoJira** is a purpose-built feature within the Delivery Assistant Chrome extension designed to streamline customer support issue reporting from Automoby (`panel.automoby.ir`) directly into Jira (`jira.automoby.ir`). 

Instead of manually navigating to Jira, finding the Create button, selecting the project, issue type, copying tracking numbers, extracting store names, adding labels, and selecting assignees, an operator simply selects a record in Automoby, clicks **GoJira**, chooses an employee template, and the extension prepares the Jira issue dialog with exact, verified values.

**Crucial Invariant:** GoJira prepares issues for review; it **never automatically submits production tickets**. The final review and submission remain strictly under human operator control.

---

## 2. Supported Panel Layouts & Non-Clipping Popover Architecture

Delivery Assistant supports two layouts:
1. **Horizontal / Expanded Layout:** All controls arranged in a single horizontal floating bar (`.cx-floating-bar`).
2. **Compact Layout:** Controls arranged across multiple rows (`.cx-floating-bar.cx-compact`).

### Non-Clipping Architecture
- **Root Cause of Prior Clipping:** `.cx-floating-bar` previously enforced `overflow-y: auto; overflow-x: hidden;`. Because the panel in horizontal mode is only ~52px tall, absolute popovers (`bottom: calc(100% + 10px)`) extending outside the bar bounds were clipped by the container overflow.
- **Solution:** Both `.cx-floating-bar` and `.cx-floating-bar.cx-compact` explicitly define `overflow: visible;`.
- **Stacking & Geometry:**
  - `.cx-gojira-widget`: establishes `position: relative` containing block.
  - `.cx-gojira-menu`: `position: absolute; bottom: calc(100% + 10px); right: 0; z-index: 1000000; width: 290px; direction: rtl;`.
  - Switching between horizontal and compact layouts toggles `.cx-compact` dynamically without destroying DOM event listeners or menu state.

---

## 3. Template Selector UI Redesign

The GoJira template picker is designed to professional design standards:

- **Surface & Elevation:**
  - Width: `290px` with `max-width: min(340px, calc(100vw - 30px))`.
  - Background: Glassmorphism surface `var(--cx-bg-surface)` with `backdrop-filter: blur(20px)`.
  - Border: `1px solid var(--cx-border-accent)`.
  - Radius: `12px`.
  - Box Shadow: `0 12px 36px rgba(0, 0, 0, 0.2), 0 4px 12px rgba(0, 82, 204, 0.12)`.
- **Header:**
  - Icon: `🚀`
  - Title: `آماده‌سازی تیکت Jira` (12px bold).
  - Scope Pill Badge: `Platform / Task` (10px bold, Jira blue accent).
- **Template Option Card (`داننده`):**
  - Icon: `📋`
  - Primary Name: `داننده` (14px bold Persian typography).
  - Subtitle: `مسئول: منیره داننده` (11px secondary muted).
  - Chip: `CX` badge (sky-blue tint, 10px bold).
  - Interactive States: Smooth hover elevation (`transform: translateY(-1px)`), border highlight `#0052cc`, and focus-visible keyboard outlines (`outline: 2px solid #0052cc; outline-offset: 1px`).
- **Keyboard Navigation & Accessibility:**
  - `ArrowDown` / `ArrowUp` cycles through available options.
  - `Enter` / `Space` selects and triggers template preparation.
  - `Escape` dismisses the dropdown.
  - Outside click closes the menu.
  - ARIA attributes: `role="listbox"`, `aria-label="انتخاب الگوی GoJira"`, `role="option"`, `aria-expanded`.

---

## 4. Required Operator Workflow & Precheck Gate

The extension enforces a strict, record-associated activation order:

```
[1. Select Automoby Record]
           │
           ▼
[2. Click "بررسی تیکت Jira"]
           │
           ▼
[3. Wait for Check to Complete (فاقد تیکت / دارای تیکت)]
           │
           ▼
[4. Click "GoJira"]
           │
           ▼
[5. Select "داننده" Template]
           │
           ▼
[6. Inspect Prepared Jira Form (Unsubmitted)]
```

### Precheck Gate Implementation
- If an operator clicks **GoJira** before running the Jira check for the current record:
  - Button text immediately changes to: `⚠️ اول چک کن`
  - Button receives warning class `.cx-gojira-alert` (amber pulse highlight).
  - Title updates to: `ابتدا باید بررسی تیکت Jira برای این مرسوله انجام شود`.
  - The template menu does **NOT** open.
  - No Jira navigation or preparation workflow starts.
  - The message remains visible for **3000ms (~3 seconds)** and automatically reverts back to `⚡ GoJira`.
- **Record Association Guard:**
  - Check completion state is recorded as `{ rowId, parcelId, waybill, timestamp, success: true }`.
  - If the operator checks record A, and then selects record B, record A's completed check does **not** authorize record B.
  - Clicking GoJira on record B displays `⚠️ اول چک کن` until record B is checked.
  - Running check (`isJiraLookupInProgress = true`) does not count as complete prematurely.
  - Failed or timed-out checks do not authorize GoJira.
  - Layout switching (horizontal <-> compact) preserves authorization for the currently checked record.

---

## 5. Required Danandeh Template Contract

The initial template is:

- **Display Name:** `داننده`
- **Template ID:** `danandeh`
- **Jira Project:** `Platform` (`10512`, Key: `PLATFORM`)
- **Jira Issue Type:** `Task` (`10002`)

### Field Mappings:
1. **Summary:**
   - Strictly the authoritative tracking number (`1543373`).
   - Zero prefixes, suffixes, store names, or customer data.
2. **Description:**
   - Begins with the exact store name extracted from expanded record details.
   - Followed immediately by a single newline (`\n`).
   - Remaining description is blank for operator notes.
   - Example: `مشهد پارت\n`
3. **Tracking Number Custom Field (`customfield_10402`):**
   - Strictly equals Summary: `Summary === customfield_10402`.
   - Populated with `1543373`.
4. **Assignee:**
   - Verified account: `منیره داننده` (`monire-danande`).
   - Verified suggestion link: `#منیره-داننده-1-link`.
5. **Labels:**
   - Exactly `CX` (uppercase ASCII).
   - Committed as an active token in Jira's multi-select component.
6. **Priority:**
   - Untouched. Preserves initial default value (e.g. `Medium`, value `3`).
7. **Request Subject (`customfield_10401`):**
   - Left unselected (`""` / `None`).
   - Operator selects appropriate category during review.
8. **Submission:**
   - **ZERO automated submission.** Production GoJira never submits.

---

## 6. How to Add Future Templates

To add a new employee template without duplicating workflow logic:

1. **Verify Account on Live Jira:**
   - Search autocomplete for employee username, display name, and suggestion ID.
2. **Register in `gojira-templates.js`:**
   ```javascript
   new_employee: {
       id: 'new_employee',
       displayName: 'نام کارمند',
       assignee: {
           accountUsername: 'verified-username',
           accountFullName: 'نام کامل کارمند',
           accountEmail: 'username@automoby.ir',
           searchQuery: 'نام کارمند',
           suggestionMatchRegex: /نام\s*کارمند|verified-username/i
       },
       labels: ['CX'],
       summaryRule: 'TRACKING_NUMBER_ONLY',
       descriptionRule: 'STORE_NAME_WITH_NEWLINE',
       trackingNumberField: 'customfield_10402',
       requestSubjectField: 'customfield_10401',
       priorityBehavior: 'PRESERVE_INITIAL'
   }
   ```
3. **Register Menu Item in `content.js`:**
   Add option card with `data-template-id="new_employee"`.
4. **Run Automated Tests:**
   Run `npm test` and `node tests/quality-gate.mjs` to ensure 100% regression gate pass.

---

## 7. Field Verification Status Matrix

| Field | Jira Selector / ID | Verified In Live Browser | Notes |
| :--- | :--- | :--- | :--- |
| **Project** | `#project` / `#project-field` | **VERIFIED** | Value: `10512`, Text: `Platform (پلتفرم) (PLATFORM)` |
| **Issue Type** | `#issuetype` / `#issuetype-field` | **VERIFIED** | Value: `10002`, Text: `Task` |
| **Summary** | `#summary` | **VERIFIED** | Value: `1543373` |
| **Description** | `#description` | **VERIFIED** | Value: `مشهد پارت\n` (TinyMCE synced) |
| **Tracking Custom Field** | `#customfield_10402` | **VERIFIED** | Value: `1543373` |
| **Assignee** | `#assignee` / `#assignee-field` | **VERIFIED** | Value: `monire-danande`, Text: `منیره داننده` |
| **Labels** | `#labels-textarea` / `#labels` | **VERIFIED** | Token: `CX` committed |
| **Priority** | `#priority` | **VERIFIED** | Untouched, Value: `3` (Medium) |
| **Request Subject** | `#customfield_10401` | **VERIFIED** | Value: `""` (unselected for review) |
| **Submission** | `#create-issue-submit` | **VERIFIED** | **NEVER clicked**; form stays open |
