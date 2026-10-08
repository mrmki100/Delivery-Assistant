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
**(ASYNC BRANCH 1)**: `fetch('https://app.krch.ir/v1/tracking')` for metadata
**(ASYNC BRANCH 2)**: `fetch('.../Consignment.php')` to get Internal DB ID from Chapar Portal
    ↓
Wait for Internal ID. If found, `fetch('.../ConsignmentHistory.php')` to get detailed tracking logs.
    ↓
`parseSloppyJSON()` cleans the heavily malformed PHP JSON output
    ↓
JSON Metadata and History are merged into a single `finalResponse` object
    ↓
`background.js` responds to message with `{ success: true, data: finalResponse }`
    ↓
`content.js` receives response
    ↓
Calls `renderTrackingModal(data)` in `ui-render.js`
    ↓
DOM is updated with the custom visual timeline.

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
Server returns sloppy JSON list of all waybills attached to that phone number.
    ↓
`parseSloppyJSON()` fixes and parses the JSON.
    ↓
`background.js` responds to message with `{ success: true, isPhoneList: true, data: parsedResults }`
    ↓
`content.js` receives response
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
