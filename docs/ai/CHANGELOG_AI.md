# AI Changelog

## Current Release Cycle
- **Change:** Migrated from HTML Scraping to JSON fetching for Chapar Tracking.
- **Files Affected:** `background.js`, `offscreen.html`, `offscreen.js`.
- **Why:** JSON endpoints (`ConsignmentHistory.php`) provide cleaner, structured data than HTML Flexigrids.
- **Impact:** `offscreen` components are now unused. Tracking is faster.

- **Change:** Implemented Header Spoofing (DNR).
- **Files Affected:** `manifest.json`, `background.js`.
- **Why:** Chapar firewall blocked `chrome-extension://` requests.
- **Impact:** Extension can now bypass CSRF and WAF protections. Requires `declarativeNetRequest` permission.

- **Change:** Implemented `parseSloppyJSON` regex sanitizer.
- **Files Affected:** `background.js`.
- **Why:** Chapar API returns incredibly malformed JavaScript object literals (unquoted keys, stray backslashes, literal newlines) that crashed strict `JSON.parse`.
- **Impact:** Extension is now highly resilient to invalid JSON syntax from the Chapar backend.

- **Change:** Version Reconciliation & Chapar Authentication Regression Fix (PR/Release 2.2 Reconciled).
- **Files Affected:** `background.js`, `content.js`, `tests/chapar-auth-detection.test.mjs`, `tests/chapar-lookup-flow.test.mjs`, `docs/ai/*`, `SUMMARY.md`.
- **Why:** In previous reference versions, clicking a Chapar waybill (e.g. `54807199309911101`) while logged out displayed the public-tracking modal instead of the Jira-style red login-required state (`⚠️ نیاز به ورود`). `analyzeChaparPortalAuth` incorrectly treated `{page:1,total:0,rows:[]}` as `AUTHENTICATED` because `Array.isArray(parsed.rows)` was true, and `handleChaparFetch` queried waybills without pre-flight authentication verification.
- **Impact:**
  1. Empty Flexigrid responses now classify as `UNKNOWN`, not `AUTHENTICATED`.
  2. Pre-flight auth checks via `checkChaparAuthStatus(forceRefresh)` run before waybill queries; unauthenticated requests abort immediately with `AUTH_REQUIRED`.
  3. Public tracking modal is strictly gated to confirmed `AUTHENTICATED` sessions with genuine 0-row results.
  4. Exact Jira-style red badge (`.cx-jira-error-badge`, `"⚠️ نیاز به ورود"`, `"ورود ↗"`, `"🔄"`) is displayed on both waybill and phone actions.
  5. In-place retry with `forceRefresh: true` allows zero-reload recovery after logging in.
  6. Added comprehensive Tests A through K, with all 33 test assertions passing.

- **Change:** Chapar Login State Zero-Reload Detection & Jira Button Restoration (Issue 1 & Issue 2 Fix).
- **Files Affected:** `chapar-portal.js`, `background.js`, `content.js`, `tests/jira-regression.test.mjs`, `tests/chapar-auth-detection.test.mjs`.
- **Why:**
  1. *Issue 1:* Chapar portal embeds a background idle lock modal (`<form id="frm_IDLELogin"><input type="password" name="fld_Idle_Password"></form>`) across employee session pages. Naive checks for `input[type="password"]` and `form[id*="login"]` caused `evaluatePortalAuthState()` and `analyzeChaparPortalAuth()` to falsely treat authenticated employee sessions as login pages. Furthermore, no event-driven notification bridge existed to update Automoby tabs upon login without a manual reload.
  2. *Issue 2:* Jira server returns HTTP redirects or HTML (`login.jsp`) upon unauthenticated REST queries, or network timeouts when off-VPN. Fetching `login.jsp` threw a JSON `SyntaxError` that got classified as `NETWORK_ERROR`. In `content.js`, the Jira login button (`<button id="btn-jira-login">ورود ↗</button>`) was only rendered inside `if (errType === 'AUTH_REQUIRED')` and omitted from the fallback branch, causing the login button to completely disappear and show only `"⚠️ خطا در ارتباط با Jira"`.
- **Impact:**
  1. `chapar-portal.js`: Filters out hidden background idle inputs, prioritizes authenticated employee signals (`خوش آمدید`, `Customer-User`, `عملیات`, `خروج`, `.flexigrid`, `#tbl_cons`), and broadcasts `CHAPAR_AUTH_STATE_CHANGED` via MutationObserver and tab load events.
  2. `background.js`: Handles Jira HTML/login redirects cleanly as `AUTH_REQUIRED`, prioritizes operational markers in `analyzeChaparPortalAuth`, broadcasts `CHAPAR_AUTH_UPDATED` to Automoby tabs, and responds to `CHECK_CHAPAR_AUTH`.
- **Change:** Chapar Mobile-Number Lookup Empty Result Fix (`شماره در چاپار یافت نشد`).
- **Files Affected:** `background.js`, `content.js`, `styles.css`, `tests/chapar-lookup-flow.test.mjs`, `tests/ui-parity-chapar-jira.test.mjs`.
- **Why:**
  When clicking the mobile-number button (`#btn-phone`), if Chapar responded successfully with a valid Flexigrid response containing 0 shipments or no usable waybill, `handleChaparPhoneSearch` returned `error: 'NOT_FOUND'`. `renderChaparErrorState` only checked for `AUTH_REQUIRED` and `PORTAL_UNAVAILABLE`, falling through to the generic error state: `⚠️ خطا در ارتباط با چاپار`. Additionally, malformed responses without `rows` array were previously misclassified as empty results rather than `PARSE_ERROR`.
- **Impact:**
  1. `background.js`: Strict validation that `jsonData` is an object with an `Array.isArray(jsonData.rows)` property. Malformed/non-Flexigrid responses return `PARSE_ERROR`. Valid responses with `rows.length === 0` or empty cells return `NOT_FOUND` with message `"شماره در چاپار یافت نشد"`.
  2. `content.js`: `renderChaparErrorState` renders `.cx-jira-empty-badge` with `"شماره در چاپار یافت نشد"` and the retry button (`#${btnId}-retry`) for `NOT_FOUND`. Genuine network errors, timeouts, and auth failures remain clearly distinguished.
  3. `styles.css`: Added `.cx-empty-badge` alias and verified theme variables for readable contrast across light and dark modes.
  4. Tests: 59 automated tests passing across 5 suites, including dedicated coverage for Scenarios 1 through 9.

