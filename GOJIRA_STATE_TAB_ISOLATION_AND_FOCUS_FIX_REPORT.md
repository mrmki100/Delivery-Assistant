# GoJira Precheck State Synchronization, Isolated Jira Tabs, Template UI Cleanup, and Description Autofocus Report

**Project:** Delivery Assistant Chrome Extension (Manifest V3)  
**Date:** 2026-10-17  
**Status:** All Fixes Implemented, Quality Gate Passing (454/454 tests across 55 suites), Live Browser Verified via Chrome DevTools MCP  
**Jira Submissions:** Strictly ZERO (No Jira issues were submitted, created, or published)

---

## 1. Executive Summary

This report documents the deep investigation, root cause diagnosis, surgical implementation, automated regression testing, and live browser verification for three critical defects in the Delivery Assistant GoJira integration:

1. **Issue 1 (Precheck State Synchronization Lag):** When an operator clicked GoJira before checking the Jira ticket, a prerequisite warning ("⚠️ اول چک کن") was displayed. However, upon clicking "بررسی تیکت Jira" and completing the lookup successfully for that exact record, the GoJira button remained frozen in the warning state until an arbitrary 3000ms `setTimeout` finished. This was resolved with prompt event-driven synchronization (`notifyGojiraPrecheckCompleted`) that instantly disarms the alert, updates the visual state to authorized (`⚡ GoJira`), and strictly ties authorization to the checked record's unique identity (`rowId` and tracking number).
2. **Issue 2 (Tab Sharing & Draft Corruption):** Clicking a GoJira template used `chrome.tabs.query({ url: "*://jira.automoby.ir/*" })` and updated/reused `tabs[0]`, diverting existing Jira tabs and corrupting unfinished manual drafts. This was eliminated by establishing complete browser tab isolation: every template selection unconditionally creates a new, independent browser tab with an operation-scoped URL token (`#gojira-op=...`), targets the payload strictly to that new tab ID, and blocks existing tabs from consuming storage tasks.
3. **Issue 3 (Template UI Cleanup & Description Autofocus):**
   - **UI Hierarchy:** The visible "CX" badge/chip decoration was removed from the template card, and the redundant/displaced "Platform / Task" header badge was removed. "Platform / Task" was placed directly beneath "منیره داننده" as a secondary subtitle (`.cx-gojira-item-sub`), while preserving the underlying Jira payload mapping to label `CX`.
   - **Description Autofocus:** Jira was previously leaving initial keyboard focus on `#assignee-field`. A bounded, single-pass autofocus mechanism (`focusDescriptionEditor`) was implemented in `jira-assistant.js` that prioritizes TinyMCE active editor body and plain `#description` textarea, safely positioning the cursor at the end of the text without repeatedly stealing focus during operator typing.

---

## 2. Verified Root Causes

### Issue 1: Precheck State Does Not Update Promptly
- **Root Cause:** In [content.js](file:///c:/Users/mrmki/Documents/antiGG%20repo/Delivery%20Assistant/content.js#L1751-L1768), `showGojiraPrecheckAlert(triggerBtn)` applies the `.cx-gojira-alert` class and sets `gojiraAlertTimeout = setTimeout(..., 3000)`. When the operator clicked "بررسی تیکت Jira", [performJiraLookup](file:///c:/Users/mrmki/Documents/antiGG%20repo/Delivery%20Assistant/content.js#L1460-L1528) executed and set `lastCompletedJiraCheck = { rowId, parcelId, waybill, success: true }`. However, `performJiraLookup` never cleared `gojiraAlertTimeout`, never removed `.cx-gojira-alert`, and never restored `#btn-gojira-trigger`'s innerHTML back to `<span>⚡</span><span>GoJira</span>`. As a result, the button remained visually frozen displaying `⚠️ اول چک کن` for up to 3 seconds even after a genuine lookup succeeded.
- **Record Scoping Gap:** `isGojiraCheckSatisfied()` used `matchesRowId || matchesTracking`, which could allow cross-row bleeding if tracking number checks were ambiguous or if row transitions occurred while lookups were in-flight.

### Issue 2: Template Selection Reuses Existing Jira Tabs
- **Root Cause:** In [background.js](file:///c:/Users/mrmki/Documents/antiGG%20repo/Delivery%20Assistant/background.js), `handlePrepareGojiraIssue` explicitly queried open Jira tabs:
  ```javascript
  const tabs = await chrome.tabs.query({ url: "*://jira.automoby.ir/*" });
  if (tabs.length > 0) {
      targetTab = tabs[0];
      await chrome.tabs.update(targetTab.id, { active: true });
  }
  ```
  If an operator already had a Jira tab open preparing an unrelated issue, `background.js` hijacked that tab, brought it to focus, and dispatched `PREPARE_GOJIRA_ISSUE` to it, overwriting the user's manual draft. Furthermore, `chrome.storage.local.set({ gojiraPendingTask: ... })` used a generic global key without tab identification, causing any tab reload or navigation to pick up the task.

### Issue 3: Template Card Text Clutter & Assignee Focus
- **Root Cause A (Visible CX Badge & Misplaced Platform / Task):** In [content.js](file:///c:/Users/mrmki/Documents/antiGG%20repo/Delivery%20Assistant/content.js), the template menu header contained `<span class="cx-gojira-header-badge">Platform / Task</span>`, and the item card contained `<span class="cx-gojira-chip">CX</span>` alongside the name. The name was rendered as `داننده` rather than `منیره داننده`, and the subtitle read `مسئول: منیره داننده`.
- **Root Cause B (Assignee Focus):** In [jira-assistant.js](file:///c:/Users/mrmki/Documents/antiGG%20repo/Delivery%20Assistant/jira-assistant.js#L244-L317), `selectAssignee` was invoked near the end of `prepareGoJiraIssue`. It focused `#assignee-field` to trigger suggestion dropdowns and select Monireh Danandeh. Neither `selectAssignee` nor `prepareGoJiraIssue` ever shifted focus to the Description control. Consequently, initial focus remained on `#assignee-field`.

---

## 3. Files and Execution Paths Inspected

1. **[content.js](file:///c:/Users/mrmki/Documents/antiGG%20repo/Delivery%20Assistant/content.js):**
   - Execution paths: `performJiraLookup` $\rightarrow$ `notifyGojiraPrecheckCompleted` $\rightarrow$ `isGojiraCheckSatisfied` $\rightarrow$ `showGojiraPrecheckAlert` $\rightarrow$ `updateGojiraWidgetForSelectedRow`.
   - Template menu markup in `initCommandCenterUI`.
2. **[background.js](file:///c:/Users/mrmki/Documents/antiGG%20repo/Delivery%20Assistant/background.js):**
   - Execution path: `handlePrepareGojiraIssue` $\rightarrow$ `chrome.tabs.create` $\rightarrow$ tab readiness wait $\rightarrow$ targeted `chrome.tabs.sendMessage` $\rightarrow$ storage cleanup.
3. **[jira-assistant.js](file:///c:/Users/mrmki/Documents/antiGG%20repo/Delivery%20Assistant/jira-assistant.js):**
   - Execution paths: `prepareGoJiraIssue` $\rightarrow$ `focusDescriptionEditor` $\rightarrow$ `checkPendingTask` (guarded by `#gojira-op=...`) $\rightarrow$ `chrome.runtime.onMessage` (deduplicated by `activeOperations`).
4. **[gojira-templates.js](file:///c:/Users/mrmki/Documents/antiGG%20repo/Delivery%20Assistant/gojira-templates.js):**
   - Invariants: Verified that `labels: ['CX']` remains untouched in the issue payload.
5. **[styles.css](file:///c:/Users/mrmki/Documents/antiGG%20repo/Delivery%20Assistant/styles.css):**
   - Typography, spacing, RTL hierarchy, and dark mode support for `.cx-gojira-item-name`, `.cx-gojira-item-sub`, `.cx-gojira-alert`.
6. **Test Suites:**
   - [tests/quality-gate.mjs](file:///c:/Users/mrmki/Documents/antiGG%20repo/Delivery%20Assistant/tests/quality-gate.mjs)
   - [tests/gojira-deep-audit-and-form-population.test.mjs](file:///c:/Users/mrmki/Documents/antiGG%20repo/Delivery%20Assistant/tests/gojira-deep-audit-and-form-population.test.mjs)
   - [tests/gojira-state-tab-isolation-focus.test.mjs](file:///c:/Users/mrmki/Documents/antiGG%20repo/Delivery%20Assistant/tests/gojira-state-tab-isolation-focus.test.mjs)

---

## 4. Implementation Changes

### A. Precheck State Synchronization (`content.js`)
- Added `notifyGojiraPrecheckCompleted(checkedRowId, parcelId, waybill)`:
  - Verifies that the completed lookup corresponds to the currently selected `rowId` and tracking number.
  - Immediately disarms any active `gojiraAlertTimeout` via `clearTimeout`.
  - Removes the `.cx-gojira-alert` CSS class.
  - Restores `#btn-gojira-trigger`'s HTML to `<span>⚡</span><span>GoJira</span>`.
  - Restores tooltip title to `'آماده‌سازی تیکت GoJira'`.
- In `performJiraLookup`:
  - Added race-condition check: if `activeGojiraSelection.rowId` changed while the network lookup was in flight, the authorization is discarded to prevent cross-row pollution.
  - Calls `notifyGojiraPrecheckCompleted(currentRowId, cleanParcel, cleanWaybill)` immediately upon `response.success`.
- In `isGojiraCheckSatisfied`:
  - Enforced strict identity matching: if `lastCompletedJiraCheck.rowId !== activeGojiraSelection.rowId`, returns `false`.
  - If tracking numbers are present on both records and do not match, returns `false`.

### B. Isolated Jira Tabs (`background.js` & `jira-assistant.js`)
- In `background.js` (`handlePrepareGojiraIssue`):
  - Completely removed `chrome.tabs.query({ url: "*://jira.automoby.ir/*" })` and tab reuse logic.
  - Generates a unique operation identifier: `operationId = 'gojira_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8)`.
  - Always opens a new browser tab:
    ```javascript
    const targetUrl = `https://jira.automoby.ir/secure/Dashboard.jspa#gojira-op=${operationId}`;
    const targetTab = await chrome.tabs.create({ url: targetUrl, active: true });
    ```
  - Scopes pending task storage to `gojiraPendingTask_${operationId}`.
  - Implements a tab load listener awaiting `changeInfo.status === 'complete'` for `targetTab.id` before dispatching messages.
  - Dispatches `chrome.tabs.sendMessage` targeted strictly to `targetTab.id`.
- In `jira-assistant.js`:
  - `checkPendingTask()` now parses `window.location.hash.match(/gojira-op=([^&]+)/)`.
  - Tabs without this hash (such as existing tabs with manual drafts or user-opened Jira tabs) exit immediately without executing anything.
  - Added `const activeOperations = new Set()` to deduplicate message passing and hydration events.

### C. Template Picker UI Cleanup (`content.js`)
- Cleaned up template markup in `initCommandCenterUI`:
  - Removed `<span class="cx-gojira-header-badge">Platform / Task</span>` from the header.
  - Removed `<span class="cx-gojira-chip">CX</span>` and `.cx-gojira-item-meta`.
  - Updated card structure:
    ```html
    <div class="cx-gojira-item-info">
        <span class="cx-gojira-item-name">منیره <span>داننده</span></span>
        <span class="cx-gojira-item-sub">Platform / Task</span>
    </div>
    ```
  - Clean visual hierarchy:
    ```
    منیره داننده
    Platform / Task
    ```
- Preserved underlying Jira payload mapping: `labels: ['CX']` remains in `gojira-templates.js` and is populated into Jira's MultiSelect component.

### D. Description Field Autofocus (`jira-assistant.js`)
- Implemented `focusDescriptionEditor(dialog)`:
  - Bounded readiness loop (up to 10 attempts, 200ms interval).
  - Priority 1: If TinyMCE visual editor is active (`window.tinymce.activeEditor`), invokes `.focus()` and collapses selection to the end of the text.
  - Priority 2: If an editor iframe exists (`.tox-edit-area__iframe`, `mce_0_ifr`), focuses `iframe.contentWindow` and `iframe.contentDocument.body`.
  - Priority 3: If plain `#description` textarea is active, invokes `.focus()` and sets selection range to the end of the text (`len, len`).
  - Single-pass execution: Disarms once focused; never attaches continuous observers or steals focus while the operator types.
  - In `prepareGoJiraIssue`: invoked after Assignee and all custom fields are populated.
  - Return contract: Reports `descriptionFocused: true` in the preparation response.

---

## 5. Automated Regression Testing

All tests were executed using the official test suite and quality gate runner:
`node tests/quality-gate.mjs`

### Test Suite Results:
- **Total Tests:** 454
- **Total Test Suites:** 55
- **Passing Tests:** 454 (100%)
- **Failing Tests:** 0
- **Duration:** 258.1ms

### Specific Tests Covering the Root Causes:
1. `tests/gojira-state-tab-isolation-focus.test.mjs`:
   - `verifies performJiraLookup notifies GoJira immediately upon successful check`: PASS
   - `verifies notifyGojiraPrecheckCompleted immediately disarms alert and updates UI`: PASS
   - `simulates precheck state transitions and strict record scoping`: PASS
     - Record A unauthorized before check $\rightarrow$ authorized promptly after check.
     - Switching to Record B resets authorization.
     - In-flight check for Record A does not authorize Record B.
     - Failed checks do not authorize.
   - `verifies background.js always opens a new Jira tab and never reuses existing tabs`: PASS
   - `verifies jira-assistant.js protects existing tabs and unsaved drafts`: PASS
   - `verifies operation deduplication prevents duplicate executions in the same tab`: PASS
   - `verifies template menu card displays Monireh Danandeh with Platform / Task as secondary subtitle`: PASS
   - `verifies actual Jira issue payload retains CX label invariant`: PASS
   - `verifies jira-assistant.js implements focusDescriptionEditor and focuses Description`: PASS
   - `verifies focusDescriptionEditor is bounded and does not steal focus repeatedly`: PASS
2. `tests/gojira-deep-audit-and-form-population.test.mjs`:
   - Layout & visibility invariants (both horizontal and compact mode): PASS
   - ZERO submission guard: PASS
   - Cleaned-up template picker layout: PASS

---

## 6. Live Browser Verification via Chrome DevTools MCP

Live verification was executed directly against authenticated instances of **Automoby Panel** (`https://panel.automoby.ir/parcel?page=0&limit=100`) and **Jira** (`https://jira.automoby.ir/secure/Dashboard.jspa`).

### Verification 1: Issue 1 — Precheck Warning & Prompt State Synchronization
1. **Initial Warning Trigger:**
   - Navigated to Automoby panel (Page 1).
   - Selected row `1543494`.
   - Clicked `#btn-gojira-trigger` before running Jira lookup.
   - **Observed Result:** GoJira button displayed `⚠️ اول چک کن`, `.cx-gojira-alert` class applied, tooltip updated to "ابتدا باید بررسی تیکت Jira برای این مرسوله انجام شود", template menu remained closed.
   - **Artifact:** Saved screenshot to `tests/live-gojira-alert-state.png`.
2. **Prompt Synchronization upon Lookup Completion:**
   - Clicked "بررسی تیکت Jira" (`#btn-jira-lookup`).
   - Network search completed in 1212ms.
   - **Observed Result:** Immediately upon completion, `alertActiveAfter: false`, button text instantly restored to `⚡ GoJira`, tooltip restored to "آماده‌سازی تیکت GoJira", button enabled. No waiting for the 3000ms timer was required.
3. **Menu Opening:**
   - Clicked `#btn-gojira-trigger`.
   - **Observed Result:** Menu opened promptly (`display: flex`).
   - Card displayed: `منیره داننده` with subtitle `Platform / Task`. No visible CX chip.
   - **Artifact:** Saved screenshot to `tests/live-gojira-menu-cleaned-up.png`.
4. **Strict Record Scoping:**
   - Selected row `1543454` (Row 2).
   - Clicked `#btn-gojira-trigger`.
   - **Observed Result:** Displayed `⚠️ اول چک کن`. Row 2 was NOT authorized by Row 1's check.
   - Switched back to row `1543494`. Clicked `#btn-gojira-trigger`.
   - **Observed Result:** Opened menu immediately without warning.

### Verification 2: Issue 2 — Independent Jira Tab Creation & Draft Isolation
1. **Draft Setup in Existing Tab:**
   - Jira Tab A (Page 7) had an unfinished manual draft:
     - `URL: https://jira.automoby.ir/secure/Dashboard.jspa`
     - `Summary: 1543454`
     - `Description: کفپوش مجیکال\n`
2. **Template Selection:**
   - In Automoby (Page 1), selected row `1543494` (Store: `فروشگاه تسلا`).
   - Clicked `منیره داننده` template in the GoJira menu.
3. **Tab Isolation Verification:**
   - Queried `list_pages`.
   - **Observed Result:** A brand new tab (Page 8) was created (`https://jira.automoby.ir/secure/Dashboard.jspa#gojira-op=gojira_...`).
   - **Inspected Tab A (Page 7):**
     - `Summary: 1543454` (100% UNTOUCHED)
     - `Description: کفپوش مجیکال\n` (100% UNTOUCHED)
     - Not reloaded, not redirected, not overwritten.

### Verification 3: Issue 3 — Description Autofocus & Field Population in New Tab
1. **Inspected Tab B (Page 8):**
   - Evaluated DOM of the newly created tab:
     - `Summary: "1543494"` (Tracking number strictly populated)
     - `Description: "فروشگاه تسلا\n"` (Store name + newline)
     - `Tracking Number (customfield_10402): "1543494"`
     - `Assignee: "منیره داننده"`
     - `Labels: ["CX"]` (Real Jira label preserved)
     - `activeEl: {"tagName": "IFRAME", "id": "mce_0_ifr", "className": "tox-edit-area__iframe"}`
     - `iframeActive: true` (Inside TinyMCE editor body)
   - **Observed Result:** Initial focus was NOT on Assignee (`#assignee-field`). Initial keyboard focus was directly in the editable Description editor.
   - **Artifact:** Saved screenshot to `tests/live-jira-tab8-isolated-focused.png`.

### Verification 4: Compact Mode Compatibility
1. **Toggled Layout to Compact Mode:**
   - Toggled `#cx-layout-toggle-bar`.
   - Floating panel switched to `.cx-compact`.
   - Clicked `#btn-gojira-trigger`.
   - **Observed Result:** GoJira template picker opened cleanly above the compact panel without clipping (`position: absolute; z-index: 1000000; display: flex`).
   - **Artifact:** Saved screenshot to `tests/live-gojira-compact-menu-open.png`.

---

## 7. Zero Submission Invariant Confirmation

- All live tests verified that the Create Issue dialog in Jira remains in the `PREPARED_UNSUBMITTED` state.
- Zero Jira issues were submitted, created, or published during automated testing or live browser verification.

---

## 8. Final Git Diff Summary

### Core Files Modified:
- **`content.js`:** Added `notifyGojiraPrecheckCompleted`, implemented prompt alert dismissal, enforced strict record-scoped check matching, and cleaned up template menu markup (removed header badge and CX chip, rendered `Platform / Task` subtitle beneath name).
- **`background.js`:** Replaced existing-tab reuse with unconditional `chrome.tabs.create`, generated unique operation tokens, and targeted messages strictly to the new tab ID.
- **`jira-assistant.js`:** Implemented `focusDescriptionEditor` to focus the Description field instead of Assignee, added hash-based tab isolation guards (`#gojira-op=...`), and prevented re-execution loops.
- **`tests/gojira-deep-audit-and-form-population.test.mjs`:** Updated template card layout assertions.
- **`tests/gojira-state-tab-isolation-focus.test.mjs`:** Added comprehensive regression tests for precheck synchronization, tab isolation, and Description autofocus.

All existing uncommitted files in `Driver and update assistant/` were completely preserved and left untouched.
