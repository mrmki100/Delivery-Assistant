# Data Flow

This document maps out the specific execution paths for the major features of the extension.

## Flow 1: Smart Waybill Routing & Chapar Fetch (Hybrid API)

User clicks a row in Automoby dashboard
    ↓
`content.js` event listener captures click
    ↓
`extractData()` pulls `waybill` string from MuiDataGrid DOM
    ↓
User clicks "📦 چاپار: [Waybill]" button
    ↓
`handleRoutingAction(filterType, value, false)`
    ↓
`chrome.runtime.sendMessage({ action: 'FETCH_CHAPAR', query: waybill })`
    ↓
`background.js` receives message
    ↓
`handleChaparFetch()` starts execution
    ↓
`checkChaparAuthStatus(forceRefresh)` performs decoupled pre-flight verification:
- Checks active portal tabs (`PING_PORTAL_SESSION`)
- Queries `https://portal.chaparnet.com/index.php?P=Operation&Tab=Consignment`
- If unauthenticated / redirect / login HTML / `NEEDS_LOGIN`:
  → Halts immediately with `{ success: false, error: 'AUTH_REQUIRED', message: 'شما باید در تب دیگری در سایت چاپار لاگین باشید' }`
  → `content.js` calls `renderChaparErrorState(widget, ...)` to transform button into red `.cx-jira-error-badge` with `"⚠️ نیاز به ورود"`, `"ورود ↗"`, and `"🔄"`.
  → Zero requests to `Consignment.php` made; NO public tracking modal shown.
    ↓
If `AUTHENTICATED`:
**(ASYNC BRANCH 1)**: `fetch('https://app.krch.ir/v1/tracking')` for metadata
**(ASYNC BRANCH 2)**: `fetch('.../Consignment.php')` to get Internal DB ID from Chapar Portal
    ↓
Lookup response analyzed:
- Inspects for session expiry during request (redirects or login HTML). If session expired mid-flight, marks `NEEDS_LOGIN` and returns `AUTH_REQUIRED`.
- Evaluates rows returned: empty Flexigrid `{page:1,total:0,rows:[]}` does NOT prove auth on its own.
- If pre-auth was verified `AUTHENTICATED` and genuine 0 rows are returned across all search queries:
  → ONLY then returns `{ success: true, isPublicOnly: true, trackingNumber: waybill }` for public tracking.
- If `AUTHENTICATED` and row found:
  → Extracts Internal ID. Parallel queries via `Promise.allSettled`:
    - `fetch('.../ConsignmentItems.php')` to extract package numbers.
    - `fetch('.../ConsignmentHistory.php')` to extract detailed timeline logs.
    - `fetchChaparConsignmentPopup(internalId)` via xajax (`DrawPopupForm`) to extract detailed popup metadata.
    ↓
`parseChaparPopupHTML()` scans the server-rendered HTML:
- Finds `<div id="PACKAGE_LIST">` and all `<div class="manifest_item">` elements.
- Preserves all manifest item identifiers into array `manifestItems`.
- Normalizes identifiers to ASCII digits.
- Sets internal property `probableTrackingNumber` (joined by comma if multiple, null if absent).
    ↓
Status, metadata, and history are merged into a single `finalResponse` object (cached in 45s memory cache).
    ↓
`background.js` responds to message with `{ success: true, data: finalResponse }`
    ↓
`content.js` receives response (verifies monotonic sequence `currentRoutingSeq` to prevent stale UI overwrite).
    ↓
Calls `renderTrackingModal(data)` in `ui-render.js`
    ↓
DOM is updated with the custom visual timeline and metadata grid:
- If `data.probableTrackingNumber` exists, renders compact metadata item with exact label **«کد رهگیری احتمالی»**.
- If absent, field is cleanly omitted without placeholders.

---

## Flow 2: Chapar Phone Number Search

User clicks a row in Automoby dashboard
    ↓
`content.js` event listener captures click
    ↓
`extractData()` pulls `phone` string from DOM
    ↓
User clicks "📱 موبایل: [Phone]" button
    ↓
`handleRoutingAction('گیرنده', phone, false)`
    ↓
`chrome.runtime.sendMessage({ action: 'FETCH_CHAPAR', type: 'گیرنده', query: phone })`
    ↓
`background.js` routes to `handleChaparPhoneSearch()`
    ↓
`chrome.declarativeNetRequest` silently intercepts the request and injects spoofed `Origin` and `Referer` headers.
    ↓
`fetch('.../Consignment.php')` sends a POST request with `credentials: 'include'` (sending user's active portal cookies).
    ↓
`analyzeChaparPortalAuth(res, text)` evaluates session state:
- If `NEEDS_LOGIN` → Returns `{ success: false, error: 'AUTH_REQUIRED' }` → `content.js` renders `.cx-jira-error-badge` with `"⚠️ نیاز به ورود"`.
- If `PORTAL_UNAVAILABLE` → Returns `{ success: false, error: 'PORTAL_UNAVAILABLE' }`.
- If `AUTHENTICATED` → `parseSloppyJSON()` fixes and parses the JSON.
    ↓
`background.js` responds to message with `{ success: true, isPhoneList: true, data: parsedResults }`
    ↓
`content.js` receives response (verifies `currentRoutingSeq`).
    ↓
Calls `renderPhoneListModal(data)` in `ui-render.js`
    ↓
DOM is updated with a list of selectable Waybill cards.

---

## Flow 3: Iran Post Routing

User clicks a row in Automoby dashboard
    ↓
`content.js` determines waybill prefix does NOT belong to Chapar.
    ↓
User clicks "📦 پست: [Waybill]" button
    ↓
`handleRoutingAction(null, waybill, true)`
    ↓
`chrome.runtime.sendMessage({ action: 'OPEN_POST_TAB', query: waybill })`
    ↓
`background.js` -> `handlePostTab()`
    ↓
`chrome.storage.local.set({ postTrackingTask: waybill })`
    ↓
`chrome.tabs.create({ url: 'https://tracking.post.ir/' })`
    ↓
New tab opens. Page loads.
    ↓
`iran-post.js` content script injects into new tab.
    ↓
Reads `chrome.storage.local.get('postTrackingTask')`
    ↓
DOM Polling loop (`setInterval`) waits for input `#txtSearch` to exist.
    ↓
Injects waybill string into input and dispatches native 'input' events.
    ↓
Storage is cleared to prevent infinite loops.
    ↓
Focuses the DOM element `#txtCaptcha` so user can immediately type.

---

## Potential Race Conditions & Async Warnings
- **Chapar Authentication State:** The background script assumes the user's browser has valid session cookies for `portal.chaparnet.com`. If the session expires exactly during the background fetch, the server will return HTML (login page), which `background.js` will catch and return an `AUTH_REQUIRED` error to the UI.
- **Iran Post DOM Load:** `tracking.post.ir` occasionally uses ASP.NET postbacks which destroy and recreate DOM elements. `iran-post.js` uses a `setInterval` to safely poll for the exact moment the element exists.
