# Delivery Assistant — Behavioral Contracts (v19.0)

This document formalizes the permanent behavioral contracts for the Delivery Assistant Chrome extension. Every feature and workflow protected here must be validated by automated regression tests and quality-gate checks before any code modifications are accepted.

---

## Contract A: Correct Customer and Row Association

* **Preconditions:** The operator is viewing an Automoby data table (`panel.automoby.ir/parcel`, `/returns`, or manual refund pages) and clicks a row.
* **Inputs:** DOM row element (`.MuiDataGrid-row`), React Fiber component hierarchy, `data-id`.
* **Expected Behavior:**
  1. The selected row's data is extracted directly from the React Fiber layer (unvirtualized memory) or DOM cells.
  2. The displayed customer name, phone number, order number, parcel ID, and waybill in the extension floating bar and shortcuts panel must belong strictly to the clicked row's record.
  3. Row fragments with the same `data-id` (MUI pinned columns) must be coalesced into the single record.
  4. Clicking a different row immediately re-associates all displayed values with the new record.
* **Invalid or Missing Input:** If a cell is blank or missing, no placeholder or previous row's value may be substituted.
* **Error Handling:** Failures to read Fiber properties must silently fall back to mounted DOM cells without throwing exceptions.
* **State Transitions:** `ROW_UNSELECTED` -> `ROW_SELECTED` -> `DATA_RESOLVED` -> `UI_UPDATED`.
* **Tests Protecting Contract:**
  * `tests/phone-extraction-and-association.test.mjs` (Scenarios A, E)
  * `tests/surgical-fixes-v19.test.mjs` (Fiber fallback tests)

---

## Contract B: Reliable Phone-Number Extraction & Normalization

* **Preconditions:** A table row is selected or inspected.
* **Inputs:** Raw string from `userPhoneNumber`, `phoneNumber`, `receiverPhoneNumber`, DOM cell, or user input.
* **Expected Behavior:**
  1. Iranian phone numbers must be normalized: convert Persian/Arabic-Indic digits to ASCII, strip whitespace, hyphens, and country prefixes (`+98`, `0098`, `98`).
  2. Normalized mobile numbers must be 11 digits starting with `09` (e.g., `09179132236`).
  3. Non-phone text (such as city names, order IDs, or notes like "تهران") must NEVER be accepted as a phone number.
  4. A missing, null, or empty phone number must cause `btn-phone` to show disabled with `"📱 موبایل: ندارد"`.
  5. A missing phone number must NEVER be substituted with a phone number from a previous row, cache collision, or unrelated search.
* **Invalid or Missing Input:** Returns empty string `""` for non-numeric or malformed values.
* **Tests Protecting Contract:**
  * `tests/phone-extraction-and-association.test.mjs` (Scenarios B, C, D)
  * `tests/surgical-fixes-v19.test.mjs`

---

## Contract C: Accurate Chapar Record Matching & Routing

* **Preconditions:** Operator initiates a shipment lookup for a waybill or customer phone number.
* **Inputs:** Waybill number (e.g. `54807199309911101` or `6410...`), mobile number (e.g. `09154747039`).
* **Expected Behavior:**
  1. **Hybrid Routing:** Barcodes starting with `5410`, `5480`, `6410` (or standard 17-digit Chapar numbers) route to Chapar. 20-24 digit Iran Post barcodes starting with `54` or `64` route to Iran Post.
  2. **Waybill Verification:** Waybill queries must match the exact waybill or confirmed suffix in the returned consignment record.
  3. **Phone Search Cross-Contamination Guard:** When searching by phone number, if the active row has a target waybill, the result must filter strictly for that waybill and reject unrelated historical shipments for that customer.
  4. **Single Candidate Auto-Select:** If phone search returns multiple waybills, render a selection modal listing all waybills with status badges.
* **Tests Protecting Contract:**
  * `tests/chapar-lookup-flow.test.mjs`
  * `tests/surgical-fixes-v19.test.mjs` (Bugs 3 and 6)
  * `tests/chapar-auth-session-scenarios.test.mjs`

---

## Contract D: Authentication-State Correctness & Pre-flight Gating

* **Preconditions:** Extension performs an operational Chapar query or pre-flight check.
* **Inputs:** Active portal tab status (`PING_PORTAL_SESSION`), HTTP response status, redirect URLs, HTML body markers.
* **Expected States:**
  * `AUTHENTICATED`: Operator has a verified session on `portal.chaparnet.com` (confirmed by operational UI markers like `P=Operation`, `tbl_cons`, `FormConsignmentHistory`, `خروج`, or active tab confirmation).
  * `NEEDS_LOGIN`: Confirmed unauthenticated state (HTTP 401/403, redirect to login, password input field visible, or Persian login prompts).
  * `PORTAL_UNAVAILABLE`: Network timeout (AbortError), DNS failure, connection reset, or HTTP 5xx server error.
  * `UNKNOWN`: Inconclusive response (e.g. empty 0-row Flexigrid JSON without auth markers).
* **Guarantees:**
  1. A genuine authenticated session MUST NOT be treated as `NEEDS_LOGIN`.
  2. If content script communication with an open Chapar tab is unready or throws, it must NOT assume `NEEDS_LOGIN`; it must fall through to the authoritative HTTP check.
  3. Missing cached state or missing shipment is NOT proof of unauthenticated state.
  4. Network failures or 5xx server errors must NEVER be reported as `NEEDS_LOGIN` or `NOT_FOUND`.
* **Tests Protecting Contract:**
  * `tests/chapar-auth-detection.test.mjs`
  * `tests/chapar-auth-session-scenarios.test.mjs` (Scenarios 1 through 20)

---

## Contract E: Independent Authentication Domains

* **Preconditions:** Extension interacts with Chapar (`portal.chaparnet.com`) and Jira (`jira.automoby.ir`).
* **Expected Behavior:**
  1. Chapar authentication and Jira authentication are completely decoupled.
  2. A failure or login requirement in Chapar must not alter the Jira widget status.
  3. A failure or login requirement in Jira must not alter the Chapar widget status.
  4. Each domain displays its own dedicated badge, login button, and error state.
* **Tests Protecting Contract:**
  * `tests/jira-integration-regression.test.mjs`
  * `tests/chapar-jira-ui-parity.test.mjs`

---

## Contract F: Pending-Payment Filtering & Active Reference Preservation

* **Preconditions:** Operator is on `/parcel` and toggles `cxHidePendingPayment` (or opens page with setting enabled).
* **Inputs:** `rawRows` from MUI DataGrid, active search context (search input value or URL params).
* **Business Rules:**
  1. **Non-Pending Preserved:** ALL non-pending orders (e.g., `SELLER_SHIPPED`, `CANCELLED_ADMIN`, `DELIVERED`, `PROCESSING`, `RETURNED`) are ALWAYS preserved without exception.
  2. **Exact Valid Search Match:** When an active search reference exists (e.g., customer mobile `09179132236` or order ID `1126071`):
     * Exactly ONE eligible pending-payment record associated with that exact searched reference is preserved.
     * All other redundant/duplicate pending-payment records matching that active reference are hidden.
  3. **Empty / Invalid / Unmatched Search Context:** When the search input is empty `""`, invalid, ambiguous, or has no exact matching pending-payment record:
     * ZERO pending-payment records are preserved (all pending orders are hidden).
     * Never preserve an unrelated pending-payment record as a fallback.
     * All non-pending records retain their intended visible behavior.
  4. **Filter Disabled (OFF):** When `data-cx-hide-pending` is false:
     * Pending-payment records follow the normal, unfiltered display behavior.
     * The filter does not mutate or remove records from the authoritative source dataset.
     * Turning the filter OFF restores 100% of the visible records.
  5. **Virtualization Layout Integrity:** Filtering runs at the MUI DataGrid row model layer via `grid.apiRef.current.setRows(targetRows)`:
     * Row indices are continuous (`0, 1, 2, ...`).
     * DataGrid virtual container height matches `targetRows.length * rowHeight`.
     * The detail panel expansion has `gap = 0px` (no blank space).
  6. **Dynamic Recomputation:** When the search input changes, the filter immediately re-evaluates and updates visible rows deterministically.
* **Tests Protecting Contract:**
  * `tests/pending-payment-critical-regression.test.mjs` (Mandatory SCN-001 through SCN-020)
  * `tests/pending-payment-preservation.test.mjs` (20 preservation scenarios)
  * `tests/settings-filtering-regression.test.mjs` (8 regression tests)

---

## Contract G: Stale-Result Protection (Sequence Guards)

* **Preconditions:** Operator rapidly selects row A, then row B, then row C.
* **Expected Behavior:**
  1. Every asynchronous operation increments an atomic sequence counter (`currentRoutingSeq`, `currentJiraSeq`, `currentContext.seq`).
  2. Responses from earlier requests (row A or B) arriving after a newer request (row C) has completed or started MUST be discarded.
  3. An older delayed response can NEVER overwrite the active UI state, customer name, phone number, waybill, or Jira tickets of the newer selection.
* **Tests Protecting Contract:**
  * `tests/chapar-lookup-flow.test.mjs` (Scenario 8 and Test J)
  * `tests/phone-extraction-and-association.test.mjs` (Scenario F)

---

## Contract H: Existing Functionality & Read-Only Safety

* **Preconditions:** Operator triggers shortcuts, Jira searches, Post lookups, or settings changes.
* **Guarantees:**
  1. The extension operates in strictly READ-ONLY mode on external systems (Automoby, Chapar, Post, Jira).
  2. No automated mutations, deletions, or status cancellations are performed.
  3. PII (customer phone numbers, tokens, session cookies) must never be dumped into persistent console logs or test reports.
  4. Shortcut navigation supports both `/commnets/` and `/comments/` routes.
  5. Always 100 items automation operates seamlessly alongside pending-payment filtering.
* **Tests Protecting Contract:**
  * `tests/surgical-fixes-v19.test.mjs`
  * `tests/settings-filtering-regression.test.mjs`

---

## Contract I: Safe Failure Behavior & Observable Outcomes

* **Guarantees:**
  1. `NOT_FOUND` ("شماره در چاپار یافت نشد") is rendered ONLY when the API responds successfully with 0 records.
  2. Network errors and timeouts render `PORTAL_UNAVAILABLE` or error badge with retry options.
  3. Auth errors render `NEEDS_LOGIN` with the exact required Persian label "⚠️ نیاز به ورود" and login redirect button.
  4. Parse errors render `PARSE_ERROR` without silent degradation into empty results.
* **Tests Protecting Contract:**
  * `tests/chapar-auth-detection.test.mjs`
  * `tests/chapar-lookup-flow.test.mjs`
  * `tests/chapar-jira-ui-parity.test.mjs`
