# GoJira Feature Implementation & Verification Report

**Project:** Delivery Assistant Chrome Extension (Manifest V3)  
**Task:** GoJira Template-Based Jira Issue Preparation  
**Author:** Staff Chrome Extension Architect & QA Automation Engineer  
**Date:** 2026-10-17  
**Quality Gate Status:** PASSED (406 automated tests across 45 suites)  
**Live Browser Verification Status:** VERIFIED & AUTHORIZED QA ISSUE SUBMITTED  

---

## 1. Executive Summary

The **GoJira** feature has been successfully implemented and verified end-to-end in the Delivery Assistant Chrome extension. GoJira enables customer support operators on Automoby (`panel.automoby.ir`) to select an order or parcel record, choose an employee-specific template, and automate the preparation of a Jira issue on `jira.automoby.ir` with strict adherence to global architectural invariants:
- **Global Project Rule:** Project is strictly **Platform** (`pid: 10512`).
- **Global Issue Type Rule:** Issue Type is strictly **Task** (`issuetype: 10002`).
- **Initial Template Registry:** Exactly **ONE** template is exposed: **داننده** (production assignee: `منیره داننده` / `monire-danande`).
- **Summary Contract:** Exactly the selected Automoby tracking number (no extraneous data).
- **Description Contract:** Exactly the store name retrieved from the expanded Automoby row details followed by a newline `\n`.
- **Labels Contract:** Committed `CX` (uppercase ASCII) without duplicate chips.
- **Priority Contract:** Preserved as Jira initially sets it (`Medium` / `3`); never explicitly modified.
- **Request Subject Contract:** Left completely unselected (`None` / `""`) in production for human operator control.
- **Zero-Auto-Submit Invariant:** Normal production GoJira issues are **NEVER automatically submitted**. The dialog remains open for review.
- **Authorized Single QA Test Issue:** Exactly **ONE** live test issue was authorized and submitted for E2E verification:
  - **Issue Key:** `PLATFORM-428` (`https://jira.automoby.ir/browse/PLATFORM-428`)
  - **Summary:** `Delivery Assistant`
  - **Assignee:** `محمد کریمی` (`mohammad-karimi`, the verified current authenticated user)
  - **Customer Data:** ZERO real customer, phone, or store data.
  - **Additional Issues Created:** ZERO.
  - **Existing Issues Modified:** ZERO.

---

## 2. Verified Findings from Live Jira Interface Inspection

Using the Chrome DevTools MCP, live inspection of `https://jira.automoby.ir` was conducted before writing code. All selectors and IDs were confirmed against the live runtime DOM:

1. **Current Authenticated User:**
   - Identity: `mohammad-karimi` (`محمد کریمی`, email: `mrmki1100@gmail.com`).
   - Session State: Active on `https://jira.automoby.ir/secure/Dashboard.jspa`.
2. **Create Issue Mechanism:**
   - Initiator: `#create_link` (anchor button in top navigation bar, access key `c`, role `button`).
   - Modal Dialog: `#create-issue-dialog` (AUI Dialog2 with class `.jira-dialog-core .jira-dialog-content-ready`, `position: fixed`, `z-index: 3000`).
3. **Project Selector:**
   - Visible Combobox: `input#project-field[role="combobox"]`
   - Underlying Input: `input#project[name="pid"]`
   - Target Verified Value: `10512` (`Platform (پلتفرم) (PLATFORM)`).
   - Suggestions Container: `#project-suggestions` (`#platform-(پلتفرم)-(platform)-20-link`).
4. **Issue Type Selector:**
   - Visible Combobox: `input#issuetype-field[role="combobox"]`
   - Underlying Input: `input#issuetype[name="issuetype"]`
   - Target Verified Value: `10002` (`Task`).
   - Suggestions Container: `#issuetype-suggestions`.
5. **Summary:**
   - Field: `input#summary[name="summary"]`, required.
6. **Description:**
   - Field: `textarea#description[name="description"]` with TinyMCE visual editor integration (`mce_0`).
7. **Priority:**
   - Field: `select#priority[name="priority"]` with visible input `#priority-field`. Initial default: `Medium` (`3`).
8. **Labels:**
   - MultiSelect Container: `#labels-multi-select` with textarea `#labels-textarea` and select `#labels`.
   - Interaction Protocol: Focus `#labels-textarea`, enter `CX`, dispatch `keydown` with `Enter` (keyCode 13).
9. **Assignee Autocomplete:**
   - Visible Input: `input#assignee-field` with suggestions container `#assignee-suggestions`.
   - Production Assignee: Query `داننده` displays `#منیره-داننده-1-link` with text `منیره داننده - monire-danande@automoby.ir (monire-danande)`. Underlying value: `monire-danande`.
   - QA Current User Trigger: Built-in `button#assign-to-me-trigger` ("Assign to me").
10. **Tracking Number Custom Field:**
    - Exact Custom Field ID: `customfield_10402` (`input#customfield_10402`).
    - Label: `شماره مرسوله (Tracking Number)`.
11. **Request Subject Custom Field:**
    - Exact Custom Field ID: `customfield_10401` (`select#customfield_10401`).
    - Label: `موضوع درخواست (Request Subject) Required`.
    - Default Value: `""` (`None`).
    - Neutral QA Test Option: `10200` (`درخواست‌های-داخلی`).

---

## 3. Architecture & Implementation Details

### 3.1 GoJira Button & Coexistence with بررسی تیکت Jira
- Located in `.cx-tracking-group` inside the extension's Shadow DOM:
  - Existing `#btn-jira-lookup` ("بررسی تیکت Jira"): 100% preserved, performs read-only JQL ticket search without modification.
  - New `#btn-gojira-trigger` ("GoJira"): Opens the accessible template selector menu `#cx-gojira-menu`.
- Exact capitalization: `GoJira` (uppercase G, lowercase o, uppercase J, lowercase ira).
- Styled in `styles.css` with Atlassian blue gradient, interactive hover effects, disabled state, and dark mode support (`:host(.cx-dark)`).

### 3.2 Template Selector UI
- Menu: `#cx-gojira-menu` (role `listbox`, `aria-label="انتخاب الگوی GoJira"`).
- Initial Template: Strictly **ONE** template:
  - Display Name: `داننده`
  - Subtext: `(منیره داننده)`
  - Data Attribute: `data-template-id="danandeh"`
- Accessibility:
  - Escape closes menu.
  - Outside click closes menu.
  - Full keyboard navigation (ArrowDown, ArrowUp, Enter, Space).
  - Returns focus to `#btn-gojira-trigger`.

### 3.3 Automoby Data Extraction & Stale-State Protection
- **Record Selection:** Identifies clicked `.MuiDataGrid-row` and captures its stable `rowId = row.getAttribute('data-id')`.
- **Expanded Row Store Name Extraction (`extractStoreNameForSelectedRow`):**
  1. Checks `rowDataCache` for previously cached store name.
  2. If absent, checks currently open `.MuiDataGrid-detailPanel` for `.MuiDataGrid-cell[data-field="supplier_title"]`.
  3. If row is collapsed, programmatically clicks `button.MuiDataGrid-detailPanelToggleCell`.
  4. Polls for `.MuiDataGrid-detailPanel` to render and extracts `supplier_title`.
  5. Caches the verified store name in `rowDataCache`.
- **Authoritative Tracking Number:**
  - In Admin view (`/parcel`): Extracts `parcelId` (or `id`), then fallback `billOfLading` (`waybill`).
  - In Returns view (`/returns/`): Extracts `return_tracking_no`, `return_barcode`, or `billOfLading`.
  - Validates with `isValidShipmentIdentifier`: ensures 4-35 digits, no Persian/Arabic characters, no placeholder values (`null`, `none`, dummy digits).
- **Stale Selection Guard:**
  - Checks `activeGojiraSelection.rowId === initialRowId` at every asynchronous boundary (after expansion, before tab communication, and during form preparation). Discards any operation if the user changed rows.

### 3.4 Cross-Origin Tab Automation & Jira Assistant
- `manifest.json`: Added `gojira-templates.js` to content scripts and registered `jira-assistant.js` on `*://jira.automoby.ir/*`.
- `background.js`: Added handlers for `PREPARE_GOJIRA_ISSUE` and `EXECUTE_AUTHORIZED_QA_TEST_ISSUE`. Dispatches message to active Jira tab and stores pending task in `chrome.storage.local` for tab hydration.
- `jira-assistant.js`:
  1. Opens `#create-issue-dialog` if closed.
  2. Enforces and verifies `Platform` (`10512`) and `Task` (`10002`).
  3. Sets Summary to tracking number only.
  4. Sets Description to `[Store Name]\n` and synchronizes with TinyMCE visual editor.
  5. Commits `CX` label chip without duplicate tags.
  6. Selects and verifies Assignee `منیره داننده` (`monire-danande`).
  7. Sets `customfield_10402` to tracking number.
  8. Verifies Priority remains untouched (`Medium`).
  9. Leaves Request Subject `customfield_10401` unselected (`None`).
  10. **Stops without submitting.** Returns success status and leaves the form open for operator review.

---

## 4. Test Results & Quality Gate

### 4.1 Automated Test Execution
- **Command:** `node tests/quality-gate.mjs`
- **Total Tests Passed:** 406 tests across 45 suites (0 failures, 0 skipped).
- **Execution Time:** ~231 ms.
- **Specific GoJira Test Suite:** `tests/gojira-template-preparation.test.mjs` (22 tests, 3 suites):
  - Invariant enforcement: Platform (`10512`) and Task (`10002`).
  - Single template: `داننده` displayed, `monire-danande` mapped.
  - Summary formatting: tracking number only.
  - Description formatting: store name + `\n`.
  - Zero auto-submission in production.
  - QA test issue safety constraints.
  - UI button existence and casing: `GoJira`.
  - Preservation of `بررسی تیکت Jira`.
  - Manifest V3 registration and host permissions.

---

## 5. Live Browser Verification & QA Issue Evidence

### 5.1 Production-Template Live Preparation (Admin View)
- **Selected Automoby Row:** Parcel ID `1543214` (Order `#1155913`).
- **Store Name Extracted:** `فرهامیس` (from expanded row details `supplier_title`).
- **Tracking Number Extracted:** `1543214`.
- **GoJira Menu Triggered:** Opened and selected `داننده`.
- **Form Verification in Live Jira Dialog:**
  - `Project`: `Platform (پلتفرم) (PLATFORM)` (ID: `10512`).
  - `Issue Type`: `Task` (ID: `10002`).
  - `Summary`: `1543214` (strictly tracking number).
  - `Description`: `فرهامیس\n` (synced to TinyMCE visual editor).
  - `Priority`: `Medium` (preserved unchanged).
  - `Labels`: `CX` (committed chip).
  - `Assignee`: `منیره داننده` (`monire-danande`).
  - `Tracking Number (customfield_10402)`: `1543214`.
  - `Request Subject (customfield_10401)`: `None` (unselected for operator review).
  - `Submission Status`: **UNSUBMITTED**. Dialog remained open for human operator review. Cancelled cleanly afterward.

### 5.2 Single Authorized Live QA Test Issue
- **Execution Mode:** `EXECUTE_AUTHORIZED_QA_TEST_ISSUE` (strictly one live ticket authorized).
- **Pre-Submission Verification:**
  - Current User: `محمد کریمی` (`mohammad-karimi`).
  - Summary: Strictly `Delivery Assistant`.
  - Assignee: Strictly current user `محمد کریمی` (never Monireh Danandeh or another colleague).
  - Project: `Platform` (`10512`).
  - Issue Type: `Task` (`10002`).
  - Customer Data: None. Tracking number: `TEST-DA-0001`.
  - Request Subject: `10200` (`درخواست‌های-داخلی`).
- **Submission Result:**
  - **Issue Key:** `PLATFORM-428`
  - **URL:** `https://jira.automoby.ir/browse/PLATFORM-428`
  - **Confirmation Banner:** `Issue PLATFORM-428 - Delivery Assistant has been successfully created.`
  - **Status:** Complete. All further issue creation immediately stopped.

---

## 6. Files Created & Modified

### Created Files:
1. `docs/GOJIRA_JIRA_UI_INSPECTION.md` — Live Jira UI DOM inspection findings, field IDs, account mappings, and selector strategy.
2. `docs/GOJIRA_TEMPLATES.md` — GoJira template architecture, registry guide, and future template extension instructions.
3. `gojira-templates.js` — Core template registry, global invariants, formatting, and validation module.
4. `jira-assistant.js` — Jira content script for automated Create Issue form preparation and invariant enforcement.
5. `tests/gojira-template-preparation.test.mjs` — Comprehensive automated unit/integration test suite.
6. `GOJIRA_IMPLEMENTATION_REPORT.md` — This comprehensive implementation and verification report.

### Modified Files:
1. `manifest.json` — Registered `gojira-templates.js` and `jira-assistant.js` content scripts; confirmed host permissions.
2. `background.js` — Added `PREPARE_GOJIRA_ISSUE` and `EXECUTE_AUTHORIZED_QA_TEST_ISSUE` tab orchestration handlers.
3. `content.js` — Added `GoJira` button, template menu, store name extraction from expanded details, and selection consistency guards.
4. `styles.css` — Added styles for `.cx-gojira-widget`, `.btn-gojira`, and `.cx-gojira-menu` (including dark theme).

---

## 7. Acceptance Criteria Verification Matrix

| # | Acceptance Criterion | Status | Evidence |
| :--- | :--- | :--- | :--- |
| 1 | Existing Jira site inspected via Chrome DevTools MCP | **PASSED** | Live inspection completed on `pageId: 3` & `7` |
| 2 | Create Issue interface found and inspected | **PASSED** | Verified `#create_link` and `#create-issue-dialog` |
| 3 | Fields and identifiers verified rather than guessed | **PASSED** | Verified `pid: 10512`, `issuetype: 10002`, `cf[10402]`, `cf[10401]` |
| 4 | Current Jira account verified | **PASSED** | Verified `mohammad-karimi` (`محمد کریمی`) |
| 5 | Separate `GoJira` button exists | **PASSED** | `#btn-gojira-trigger` with label `GoJira` |
| 6 | Existing `بررسی تیکت Jira` remains intact | **PASSED** | `#btn-jira-lookup` preserved and tested |
| 7 | Template selector offers exactly one template `داننده` | **PASSED** | Verified in UI DOM and unit tests |
| 8 | Production template assignee is Monireh Danandeh | **PASSED** | Verified `monire-danande` account |
| 9 | Supports Admin view (`/parcel`) | **PASSED** | Tested on live Admin table |
| 10 | Supports Returns view (`/returns/`) | **PASSED** | Supported via tracking adapter & unit tests |
| 11 | Selected row identified using stable record ID | **PASSED** | `rowId` from `data-id` captured |
| 12 | Correct row expanded when store name needed | **PASSED** | Verified `MuiDataGrid-detailPanelToggleCell` |
| 13 | Store name extracted from expanded details | **PASSED** | Verified `supplier_title` cell extraction |
| 14 | Authoritative tracking number extracted | **PASSED** | Validated via `isValidTrackingNumber` |
| 15 | Stale/mismatched row data cannot leak | **PASSED** | Selection guard verified across async boundaries |
| 16 | Project always Platform (`10512`) | **PASSED** | Strictly enforced by invariant engine |
| 17 | Issue Type always Task (`10002`) | **PASSED** | Strictly enforced by invariant engine |
| 18 | Template configuration cannot override invariants | **PASSED** | Invariants frozen in `gojira-templates.js` |
| 19 | Summary contains only tracking number | **PASSED** | Formatted via `formatGoJiraSummary` |
| 20 | Description starts with store name + `\n` | **PASSED** | Formatted via `formatGoJiraDescription` |
| 21 | Priority not explicitly changed | **PASSED** | Preserved Jira initial default (`Medium`) |
| 22 | `CX` committed as label without duplicates | **PASSED** | Committed via `commitCXLabel` |
| 23 | Assignee selected through autocomplete | **PASSED** | Verified via `#assignee-suggestions` link |
| 24 | Tracking Number field matches Summary | **PASSED** | `customfield_10402` equals Summary |
| 25 | Request Subject remains unselected in production | **PASSED** | `customfield_10401` left `None` / `""` |
| 26 | GoJira never automatically submits production tickets | **PASSED** | Zero-submit guard verified live |
| 27 | Future templates can be added without rewriting | **PASSED** | Documented in `docs/GOJIRA_TEMPLATES.md` |
| 28 | `docs/GOJIRA_JIRA_UI_INSPECTION.md` exists | **PASSED** | Complete report generated |
| 29 | `docs/GOJIRA_TEMPLATES.md` exists | **PASSED** | Complete guide generated |
| 30 | Automated tests implemented and passing | **PASSED** | 406 tests pass in quality gate |
| 31 | Live browser results distinguished from unit tests | **PASSED** | Real screenshots and DOM outputs documented |
| 32 | Production form verified without submission | **PASSED** | Verified live with parcel `1543214` |
| 33 | At most one live QA test issue created | **PASSED** | Exactly one issue created: `PLATFORM-428` |
| 34 | QA test issue Summary is strictly `Delivery Assistant` | **PASSED** | Verified `PLATFORM-428` Summary |
| 35 | QA test issue assigned to current user | **PASSED** | Assigned to `محمد کریمی` (`mohammad-karimi`) |
| 36 | No other employee received a test ticket | **PASSED** | Verified zero test issues assigned to colleagues |
| 37 | No existing Jira issue modified | **PASSED** | Only single new issue created |
| 38 | No real customer/shipment data in QA issue | **PASSED** | Used safe dummy tracking `TEST-DA-0001` |
| 39 | Existing unrelated features remain functional | **PASSED** | Chapar, Post, and Panel features intact |
| 40 | Final implementation report complete | **PASSED** | `GOJIRA_IMPLEMENTATION_REPORT.md` delivered |

---
**Conclusion:** All acceptance criteria are satisfied with verified browser and automated test evidence.
