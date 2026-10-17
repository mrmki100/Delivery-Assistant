# Delivery Assistant Chrome Extension
## Root-Cause Analysis and Minimal-Risk Fix for GoJira Button Independence & Clickability
**Document Identifier:** `GOJIRA_BUTTON_INDEPENDENCE_AND_CLICKABILITY_FIX_REPORT.md`  
**Date:** 2026-10-17  
**Author:** Staff Chrome Extension Architect & Quality Automation Specialist  
**Status:** Complete, Verified in Live Browser & Integrated via Quality Gate (417 passing tests)

---

### 1. Executive Summary

This engineering report documents the root-cause diagnosis, architectural repair, automated regression test suite, and real-browser verification for two reported defects in the **Delivery Assistant (v19.0)** Manifest V3 Chrome Extension:

*   **BUG 1 (Unintended Coupling):** GoJira became available only after the operator clicked the existing `"بررسی تیکت Jira"` button.
*   **BUG 2 (Button Disabled & Prohibited Cursor):** Even after an Automoby row had been selected, GoJira sometimes appeared disabled, hovering over it displayed the prohibited/not-allowed mouse cursor (`🚫`), and the button could not be clicked. Clicking `"بررسی تیکت Jira"` caused GoJira to become available.

**Core Contract Established & Enforced:**
> **WHEN A VALID AUTOMOBY RECORD IS SELECTED, GOJIRA MUST BE INDEPENDENTLY USABLE WITHOUT REQUIRING THE OPERATOR TO CLICK "بررسی تیکت Jira" FIRST.**

---

### 2. Confirmed Root Causes

#### A. Root Cause of Bug 2 (CSS Pointer Cursor Defect)
*   **Source File:** `styles.css` (lines 348 vs 399–440)
*   **The Defect:** Base class `.cx-btn-trigger` defines `cursor: not-allowed;` as the default fallback for unselected widgets. Specialized active buttons (`.active-chapar`, `.active-post`, `.active-jira`, `.btn-jira-ticket`) all explicitly override this with `cursor: pointer;`.
*   However, `.cx-btn-trigger.btn-gojira` and `:host(.cx-dark) .cx-btn-trigger.btn-gojira` were missing `cursor: pointer;` on their enabled and hover states!
*   **The Direct Consequence:** Even when `triggerBtn.disabled = false;` in the DOM and `pointer-events: auto;` was active, the browser computed `cursor: not-allowed;`. When operators moved their mouse over GoJira, the operating system displayed the prohibited slash-circle (`🚫`), visually indicating that the button was disabled.

#### B. Root Cause of Bug 1 & Bug 2 (JS Enablement Condition & Lifecycle Coupling)
*   **Source File:** `content.js` (`updateGojiraWidgetForSelectedRow` lines 1738–1743)
*   **Previous Condition:**
    ```javascript
    if (!hasSelectedRow || !validTracking) {
        triggerBtn.disabled = true;
        ...
        return;
    }
    ```
*   **The Defect:** GoJira conflated *"a valid record is selected"* with *"all Jira tracking fields have already been extracted from unexpanded DOM cells"*.
    1.  On **Returns (`/returns/`)**, `parcelId` is not extracted because `isParcelRoute` is false and `domParcelKeys` excludes generic `id`/`returnId`, while `waybill` is empty for return items not yet shipped.
    2.  On **Admin Orders (`/parcel`)**, if horizontal scroll virtualization unmounted the parcel cell or if React Fiber extraction was delayed, `parcelId` and `waybill` were initially empty.
    3.  Because `validTracking` was empty, `updateGojiraWidgetForSelectedRow` set `triggerBtn.disabled = true;` and returned immediately.
    4.  Furthermore, because the click event listener on `#btn-gojira-trigger` was attached *after* that early `return`, the click listener was never attached on initial row selection.
*   **Why Clicking "بررسی تیکت Jira" Activated GoJira:**
    *   When the operator clicked `"بررسی تیکت Jira"`, that button's execution triggered network requests, asynchronous state changes, and DOM mutations inside `#cx-jira-widget`.
    *   The page's `MutationObserver` (`gridDomObserver`) fired `updateRowCacheFromDOM()`, populating `rowDataCache`.
    *   Once cached or refreshed, subsequent selection evaluation found `cached.parcelId` / `cached.waybill`, which finally met `validTracking`, enabled GoJira, and attached its click listener.
    *   This created an accidental, unintended lifecycle dependency where operators felt they had to click `"بررسی تیکت Jira"` before GoJira could be used.

---

### 3. Exact Changes Implemented

#### 1. CSS Cursor Contract (`styles.css`)
Added explicit `cursor: pointer;` to enabled `.cx-btn-trigger.btn-gojira` in both light and dark mode, preserving `cursor: not-allowed;` exclusively for `:disabled`:
```css
.cx-btn-trigger.btn-gojira {
    background: linear-gradient(135deg, #0052cc 0%, #0747a6 100%);
    color: #ffffff;
    font-weight: 700;
    border: 1px solid #0052cc;
    box-shadow: 0 1px 3px rgba(0, 82, 204, 0.25);
    transition: all 0.2s ease;
    cursor: pointer;
}

.cx-btn-trigger.btn-gojira:hover:not(:disabled) {
    background: linear-gradient(135deg, #0747a6 0%, #003884 100%);
    box-shadow: 0 2px 6px rgba(0, 82, 204, 0.35);
    transform: translateY(-1px);
    cursor: pointer;
}

.cx-btn-trigger.btn-gojira:disabled {
    background: var(--cx-bg-secondary);
    color: var(--cx-text-disabled);
    border-color: var(--cx-border-light);
    box-shadow: none;
    cursor: not-allowed;
    opacity: 0.6;
}

:host(.cx-dark) .cx-btn-trigger.btn-gojira {
    background: linear-gradient(135deg, #2684ff 0%, #0052cc 100%);
    color: #ffffff;
    border-color: #2684ff;
    box-shadow: 0 1px 4px rgba(38, 132, 255, 0.3);
    cursor: pointer;
}

:host(.cx-dark) .cx-btn-trigger.btn-gojira:hover:not(:disabled) {
    background: linear-gradient(135deg, #4c9aff 0%, #2684ff 100%);
    box-shadow: 0 2px 8px rgba(38, 132, 255, 0.45);
    cursor: pointer;
}

:host(.cx-dark) .cx-btn-trigger.btn-gojira:disabled {
    background: #1e1e2d;
    color: #60607a;
    border-color: #2e2e42;
    cursor: not-allowed;
}
```

#### 2. Guaranteed Mount-Time Event Listener Initialization (`content.js`)
*   Extracted `initGojiraWidgetListeners(root)` to attach click and keyboard navigation listeners to `#btn-gojira-trigger` and `.cx-gojira-menu-item` immediately upon panel creation inside `initCommandCenterUI(panel)`.
*   Guarded by `dataset.listenerAttached` to guarantee idempotency and zero listener duplication.

#### 3. Decoupled Enablement Rule (`content.js: updateGojiraWidgetForSelectedRow`)
*   Separated **Record Identity** from **Jira Field Extraction Completion**.
*   Whenever a row is selected (`hasSelectedRow: true` and `rowId` exists), GoJira is **immediately enabled** (`triggerBtn.disabled = false`).
*   Does not require a pre-resolved tracking number at row-click time.
*   Does not reference or invoke `"بررسی تیکت Jira"`.
*   Only disables when row is deselected (`!hasSelectedRow || !cleanRowId`).

#### 4. On-Demand Multi-Tier Tracking Number Resolution (`content.js: executeGojiraPreparation`)
*   When the operator clicks GoJira and selects a template, `executeGojiraPreparation` validates record identity and resolves tracking numbers dynamically:
    1.  `activeGojiraSelection.trackingNumber` (if already populated).
    2.  `rowDataCache.get(initialRowId)?.parcelId || rowDataCache.get(initialRowId)?.waybill`.
    3.  On `/parcel`, `initialRowId` itself (as `rowId` is the parcel ID).
    4.  DOM queries across `getAllRowFragments(row)` for keys `['parcelId', 'id', 'consignmentId', 'shipmentId', 'returnId']`.
    5.  Detail panel expansion (during store name extraction).
*   If tracking number cannot be identified after all tiers, displays a clear Persian message:  
    `⚠️ شماره مرسوله یا بارنامه برای این رکورد یافت نشد. لطفاً از صحت اطلاعات ردیف اطمینان حاصل فرمایید.`
*   In the `finally` block, checks `activeGojiraSelection.hasSelectedRow` to ensure the button is never left permanently disabled after an error.

#### 5. Preservation of Existing "بررسی تیکت Jira" Widget
*   `updateJiraWidgetForSelectedRow` and `performJiraLookup` were left 100% untouched.
*   Neither button triggers or mutates the other.

---

### 4. Verification and Automated Testing Results

#### A. Automated Regression Test Suite (`node tests/gojira-independence-and-clickability.test.mjs`)
11 behavioral test cases specifically covering:
1.  **CSS Cursor Invariants:** Validated `cursor: pointer` on enabled state and `cursor: not-allowed` on disabled state in both light and dark modes.
2.  **Mount-Time Listener Binding:** Verified listeners are attached during panel construction.
3.  **Decoupled Enablement:** Proved GoJira enablement does not reference `activeJiraSelection`, `currentJiraSeq`, `tickets`, or `performJiraLookup`.
4.  **No Pre-resolved Tracking Dependency:** Verified GoJira does not require tracking number upfront.
5.  **On-Demand Dynamic Resolution:** Verified multi-tier resolution during execution.
6.  **Jira Check Invariants:** Verified `"بررسی تیکت Jira"` remains independent.
7.  **Scenario 1:** Row selected $\rightarrow$ GoJira enabled immediately with 0 Jira checks run.
8.  **Scenario 2:** Returns view with no tracking $\rightarrow$ GoJira enabled based on row identity.
9.  **Scenario 3:** GoJira remains enabled and clickable across all Jira check states (`IDLE`, `RUNNING`, `SUCCESS_ZERO`, `SUCCESS_ONE`, `SUCCESS_MULTI`, `FAILED`, `TIMEOUT`, `CORRUPT`).
10. **Scenario 4:** Row switching updates context and retains independent enablement without prior Jira check.
11. **Scenario 5:** Repeated clicks toggle menu safely without listener accumulation or state corruption.

**Result:** `11 passed, 0 failed` in 9.2ms.

#### B. Repository Quality Gate (`node tests/quality-gate.mjs`)
*   **Manifest V3 Integrity:** PASS
*   **Static Syntax Validation (8 modules):** PASS
*   **Complete Automated Test Suite:** **417 tests across 47 suites passed in 233.5ms.**
*   **Quality Gate Status:** **PASSED**

---

### 5. Safe Real-Browser Live Verification (Chrome DevTools MCP)

Live browser verification was executed on the running Chrome extension with active DevTools session on page `سفارشات ادمین | پنل اتوموبی (https://panel.automoby.ir/parcel?page=0&limit=100)`.

*   **Test 1 (Initial Load / Deselected State):**
    *   `nameHeader`: `"👇 روی ردیف کلیک کنید 👇"`
    *   `gojira.disabled`: `true`
    *   `gojira.cursor`: `"not-allowed"`
    *   `gojira.title`: `"برای آماده‌سازی تیکت ابتدا یک ردیف را انتخاب کنید"`
*   **Test 2 (Row Selection without Jira Check):**
    *   Selected row `1543373` (`مجتبی اسلامی`).
    *   `"بررسی تیکت Jira"` was **NOT** clicked.
    *   `gojira.disabled`: `false` (ENABLED IMMEDIATELY).
    *   `gojira.cursor`: `"pointer"` (PROHIBITED CURSOR ELIMINATED).
    *   `gojira.title`: `"آماده‌سازی تیکت GoJira برای مرسوله 1543373"`.
*   **Test 3 (Clicking GoJira Button Directly):**
    *   Clicked `#btn-gojira-trigger`.
    *   `aria-expanded`: `"true"`.
    *   `menuDisplay`: `"flex"`.
    *   Rendered template item: `"داننده (منیره داننده)"`.
*   **Test 4 (Row Switching):**
    *   Selected row `1543361` (`حبیب اله خانی`).
    *   `gojira.disabled`: `false`.
    *   `gojira.cursor`: `"pointer"`.
    *   `gojira.title`: `"آماده‌سازی تیکت GoJira برای مرسوله 1543361"`.
*   **Test 5 (Jira Check Independence):**
    *   Clicked `"بررسی تیکت Jira"`.
    *   Jira check completed and rendered badge `"فاقد تیکت Jira"`.
    *   GoJira remained enabled (`disabled: false`, `cursor: "pointer"`).
    *   Clicked GoJira after Jira check $\rightarrow$ opened menu cleanly (`menuDisplay: "flex"`).
*   **Screenshot Artifact Captured:**
    *   Saved to `tests/live-gojira-independent-verified.png`.

---

### 6. Strict Guardrail Confirmations

1.  **Zero Jira Issue Submission:**
    *   CONFIRMED: Exactly **0 Jira issues** were created, submitted, updated, or closed during this task.
2.  **Preservation of Existing "بررسی تیکت Jira":**
    *   CONFIRMED: The button retains its exact name, ID (`btn-jira-lookup`), query logic, and dropdown rendering.
3.  **Preservation of Unrelated User Work:**
    *   CONFIRMED: Chapar and Post tracking, pending payment preservation, panel dragging and compact layout, shortcut registry, and all pre-existing files remain intact.

---

### 7. Files Changed

| File | Change Description |
| :--- | :--- |
| `styles.css` | Added `cursor: pointer;` to enabled `.btn-gojira` and hover states in light and dark modes; preserved `cursor: not-allowed;` for disabled state. |
| `content.js` | 1. Extracted `initGojiraWidgetListeners(panel)` for mount-time binding.<br>2. Added `/parcel` route fallback for `parcelId`.<br>3. Decoupled `updateGojiraWidgetForSelectedRow` to enable on record identity without requiring prior tracking extraction or Jira checks.<br>4. Added dynamic multi-tier tracking resolution in `executeGojiraPreparation`.<br>5. Added test bridge handlers for automated integration verification. |
| `tests/gojira-independence-and-clickability.test.mjs` | Added 11 comprehensive behavioral and invariant tests covering independence, clickability, cursors, and state transitions. |
| `tests/live-gojira-independent-verified.png` | Live browser screenshot verifying enabled GoJira button and open template menu. |
