# Current Problems

This document tracks known issues, technical debt, and architectural risks in the current codebase.

## 1. Chapar Sloppy JSON Output (RESOLVED/MITIGATED RISK)
- **Problem ID:** BUG-001
- **Severity:** HIGH (Critical Path)
- **Status:** Mitigated (via custom parser)
- **Symptoms:** Extension previously threw `خطا در ارتباط با سرور چاپار: خطای فرمت سرور` and failed to load details.
- **Reproduction:** Execute a background fetch to `portal.chaparnet.com/OBJ/List/Consignment.php`.
- **Expected behavior:** Server returns strict `application/json`.
- **Actual behavior:** Server returns unquoted keys, single-quoted strings, literal line breaks, invalid backslash escapes (e.g., `\'`), and BOM characters.
- **Relevant files:** `background.js`
- **Relevant functions:** `parseSloppyJSON()`
- **Likely technical cause:** Chapar's PHP framework manually concatenates strings to generate JavaScript object literals instead of using standard `json_encode()`.
- **Known workaround:** `parseSloppyJSON` runs highly specific regex passes to sanitize the string into strict JSON.
- **Remaining uncertainty:** If Chapar introduces a new formatting quirk (e.g., unescaped double quotes inside HTML attributes when using single quotes as string boundaries), the regex might fail.

## 2. Chapar Authentication Expiry & Misleading Public Tracking Fallback (RESOLVED)
- **Problem ID:** ARCH-001
- **Severity:** HIGH (User Confusion / Operational Hazard)
- **Status:** Resolved (via decoupled pre-flight auth check, corrected Flexigrid classification, and Jira-parity UI)
- **Symptoms:** When an unauthenticated agent clicked a Chapar waybill (e.g. `54807199309911101`), the extension displayed the public-tracking modal ("این مرسوله در پورتال پرسنلی ثبت نشده است...") instead of the login-required state (`⚠️ نیاز به ورود`).
- **Reproduction:**
  1. Open Chrome with Automoby dashboard.
  2. Log out of `portal.chaparnet.com`.
  3. Select an Automoby row with a Chapar waybill.
  4. Click "📦 چاپار".
- **Root Cause Analysis:**
  1. `Consignment.php` returns HTTP 200 with `{page:1,total:0,rows:[]}` when unauthenticated (no session cookie) AS WELL AS when authenticated with a non-existent waybill.
  2. `analyzeChaparPortalAuth(res, text)` previously classified any response with `Array.isArray(parsed.rows)` as `AUTHENTICATED`. Because `[]` is an array, empty unauthenticated responses were misclassified as `AUTHENTICATED`.
  3. `handleChaparFetch` jumped straight to querying `Consignment.php` without pre-flight authentication verification.
  4. Seeing 0 rows and a falsely reported `AUTHENTICATED` state, `handleChaparFetch` branched to `isPublicOnly: true`, opening the public tracking fallback modal.
- **Solution & Reconciled Implementation:**
  1. **Strict Flexigrid Classification:** In `analyzeChaparPortalAuth`, an empty Flexigrid response `{page:1,total:0,rows:[]}` on its own returns `UNKNOWN`, NEVER `AUTHENTICATED`. Only populated rows (`rows.length > 0` with valid cells) or operational page tokens (`P=Operation`, `tbl_cons`, `FormConsignmentHistory`) establish `AUTHENTICATED`.
  2. **Decoupled Pre-flight Auth Check:** `handleChaparFetch` and `handleChaparPhoneSearch` call `checkChaparAuthStatus(forceRefresh)` before dispatching waybill queries. If `NEEDS_LOGIN`, execution aborts immediately with `AUTH_REQUIRED`.
  3. **Authoritative Session Verification:** `checkChaparAuthStatus` queries active portal tabs (`PING_PORTAL_SESSION`) and performs an authoritative request to `https://portal.chaparnet.com/index.php?P=Operation&Tab=Consignment` (which redirects/emits login HTML when logged out).
  4. **Public Fallback Gating:** Public tracking fallback is strictly restricted: only if the session was conclusively confirmed `AUTHENTICATED` and genuine internal searches return zero rows without session expiry during the query.
  5. **Exact Jira UI Parity & Zero-Reload Recovery:** Renders red `.cx-jira-error-badge` with `"⚠️ نیاز به ورود"`, `"ورود ↗"`, and `"🔄"`. On retry, passes `forceRefresh: true` to invalidate cached status and re-verify session.
  6. **Regression Tests:** 33 automated tests (Tests A through K, Jira parity, UI parity) all pass.

## 3. Iran Post Target Element Changes
- **Problem ID:** RISK-001
- **Severity:** LOW
- **Status:** Open Risk
- **Symptoms:** Iran Post tab opens, but the tracking number is not injected.
- **Relevant files:** `iran-post.js`
- **Relevant functions:** DOM Polling loop (`setInterval`)
- **Likely technical cause:** `tracking.post.ir` occasionally updates its DOM IDs or switches to single-page app (React/Vue) behaviors that break query selectors like `#txtSearch`.
- **Evidence:** `iran-post.js` uses multiple fallback selectors (`document.querySelector('input[type="text"][placeholder*="کد رهگیری"]')`) specifically to mitigate this.

## 5. Chapar Auth Zero-Reload & Jira Connection/Login Regression (RESOLVED)
- **Problem ID:** REG-002
- **Severity:** HIGH
- **Status:** Resolved
- **Symptoms:**
  1. *Issue 1:* After logging in to Chapar, the extension still behaved as if logged out until manually reloading the page.
  2. *Issue 2:* Jira login button disappeared; widget displayed `⚠️ خطا در ارتباط با Jira` without a login button.
- **Root Causes:**
  1. *Issue 1:* Chapar portal DOM includes a persistent idle lock template modal `<form id="frm_IDLELogin"><input type="password" name="fld_Idle_Password"></form>`. In `chapar-portal.js` and `background.js`, naive password field checks triggered false positives for login pages, failing to recognize authenticated employee sessions. Additionally, Automoby tabs lacked real-time message handling and focus listeners to update buttons without reloading.
  2. *Issue 2:* Jira session expiry causes the server to redirect or return HTML (`login.jsp`), which crashed JSON parsing with a `SyntaxError` and was classified as `NETWORK_ERROR`. In `content.js:renderJiraErrorState()`, the login button was only rendered under `AUTH_REQUIRED` and completely missing under `NETWORK_ERROR`/connection timeout.
- **Resolution:**
  1. Filter out hidden background idle inputs in `evaluatePortalAuthState()`; prioritize operational tokens (`خوش آمدید`, `Customer-User`, `عملیات`, `خروج`, `.flexigrid`, `#tbl_cons`).
  2. Detect transition with debounced MutationObserver and broadcast `CHAPAR_AUTH_UPDATED` via service worker.
  3. Listen to `CHAPAR_AUTH_UPDATED` and tab `focus`/`visibilitychange` in `content.js` to restore buttons immediately.
  4. Ensure Jira HTML redirects/pages are classified as `AUTH_REQUIRED` in `background.js`.
  5. Unconditionally render the Jira login button (`<button id="btn-jira-login">ورود ↗</button>`) and retry button across all error states in `content.js`.

