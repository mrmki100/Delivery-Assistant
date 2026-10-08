# Architecture

## High-Level Architecture
The extension follows a standard Chrome Extension Manifest V3 pattern, utilizing a background Service Worker as an "API Bridge" to bypass CORS and CSRF restrictions, and Content Scripts to manipulate target DOMs.

## Runtime Contexts

### 1. Background / Service Worker (`background.js`)
- **Responsibilities:**
  - Receives `chrome.runtime.sendMessage` events from content scripts.
  - Executes cross-origin HTTP `fetch` requests to external APIs (`app.krch.ir`, `portal.chaparnet.com`).
  - Cleans and parses invalid JSON payloads returned by legacy external APIs using a custom parser (`parseSloppyJSON`).
  - Uses `chrome.declarativeNetRequest` to dynamically spoof HTTP headers (`Origin`, `Referer`) to bypass third-party WAF/CSRF protections.
  - Manages tab creation for external workflows (e.g., Iran Post tracking).

### 2. Content Script: Automoby Dashboard (`content.js`, `ui-render.js`, `styles.css`)
- **Location:** Injected into `*://panel.automoby.ir/*`.
- **Responsibilities:**
  - Scrapes the `MuiDataGrid` table in the Automoby React application to extract customer phone numbers and tracking waybills upon row click.
  - Injects a persistent floating action bar (Shadow DOM concept, though implemented as standard DOM nodes with heavy CSS encapsulation).
  - Listens for UI events (clicks on phone/waybill buttons) and delegates the heavy lifting to the Service Worker.
  - Receives parsed JSON data back from the Service Worker and renders rich modal overlays (Timelines, Log tables).

### 3. Content Script: Iran Post Tracker (`iran-post.js`)
- **Location:** Injected into `*://tracking.post.ir/*`.
- **Responsibilities:**
  - Reads `chrome.storage.local` upon page load to retrieve a pending tracking number.
  - Polls the DOM until the tracking input field is available.
  - Injects the tracking number into the input field and dispatches React/jQuery compatible DOM events (`input`, `change`).
  - Clears the storage task to prevent loop injection.
  - Automatically focuses the Captcha input box for the user.

## Explicit Relationships and Flows

### Chapar Tracking Flow (Confirmed via Code)
`content.js` (DOM Click)
  -> Extracts Phone/Waybill
  -> Determines Route (Chapar Prefix)
  -> `chrome.runtime.sendMessage({ action: 'FETCH_CHAPAR' })`
  -> `background.js` (Service Worker)
  -> `fetch('https://app.krch.ir/v1/tracking')` (Metadata)
  -> `fetch('https://portal.chaparnet.com/OBJ/List/Consignment.php')` (Get Internal ID)
  -> `fetch('https://portal.chaparnet.com/OBJ/List/ConsignmentHistory.php')` (Get Logs)
  -> `parseSloppyJSON()` (Sanitize PHP output)
  -> Returns merged JSON to `content.js`
  -> `content.js` calls `ui-render.js` -> `renderTrackingModal()`
  -> Modifies `panel.automoby.ir` DOM.

### Iran Post Flow (Confirmed via Code)
`content.js` (DOM Click)
  -> Determines Route (Post Prefix)
  -> `chrome.runtime.sendMessage({ action: 'OPEN_POST_TAB' })`
  -> `background.js` (Service Worker)
  -> `chrome.storage.local.set({ postTrackingTask: waybill })`
  -> `chrome.tabs.create({ url: 'https://tracking.post.ir/' })`
  -> Tab Opens -> `iran-post.js` injects
  -> `chrome.storage.local.get('postTrackingTask')`
  -> Injects into DOM & Focuses Captcha.

## Storage Architecture
- Uses `chrome.storage.local` exclusively as an ephemeral message bus for cross-tab context passing (passing tracking numbers from the background script to the Iran Post content script). No long-term state is persisted.

## Network/API Layer
- Exclusively handled by the Service Worker to leverage `host_permissions`.
- **Authentication:** Assumes the user has an active session on `portal.chaparnet.com`. Uses `credentials: 'include'` to automatically pass the browser's cookies along with background `fetch` requests.

## Messaging Architecture
- Simple Request-Response pattern using `chrome.runtime.sendMessage`. 
- No long-lived ports (`chrome.runtime.connect`) are currently used.

## Error Propagation
- `background.js` catches network/parsing errors and returns a normalized JSON object: `{ success: false, error: 'String reason' }`.
- `content.js` checks `response.success`. If `false`, it maps specific errors (like `'AUTH_REQUIRED'`) to specific UI components (like `renderAuthErrorModal()`), or falls back to a standard JS `alert()`.
