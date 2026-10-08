# AI Context

## Project Name
Delivery Assistant

## Project Purpose
A Chrome Extension designed to streamline customer support operations by automatically extracting tracking numbers and phone numbers from the `panel.automoby.ir` dashboard, and seamlessly routing them to the correct postal/shipping service (Chapar or Iran Post) to fetch and display detailed tracking logs.

## What the Extension Does
- Injects a floating UI panel ("Shadow DOM Command Center") into the Automoby dashboard (`panel.automoby.ir`).
- Listens for clicks on table rows to extract customer phone numbers and package waybills.
- **Smart Routing:** Based on the waybill prefix, it determines if the package is handled by Chapar (e.g., starts with `5410`, `5480`) or Iran Post.
- **Chapar Integration:** Silently fetches tracking data via background service worker from Chapar's REST API and internal portal (using a hybrid approach to bypass CSRF/CORS), and renders a detailed timeline modal directly inside Automoby.
- **Iran Post Integration:** Opens the official Iran Post tracking site in a new tab, automatically injects the tracking number into the DOM, and focuses the Captcha box for the human agent.

## Main User Workflow
1. Agent opens `panel.automoby.ir` and views a list of orders.
2. Agent clicks on a specific order row.
3. Extension extracts phone and waybill and highlights them in the floating bar.
4. Agent clicks "📱 موبایل" (Phone) or "📦 چاپار / پست" (Waybill).
5. Extension fetches data and displays a custom modal (for Chapar) or opens a new tab (for Post).

## High-Level Architecture
- **Content Scripts:** Extract DOM data from `panel.automoby.ir` and inject UI overlays.
- **Service Worker (`background.js`):** Acts as the API Bridge, handling cross-origin requests, spoofing headers to bypass firewalls, and parsing non-standard JSON.
- **Declarative Net Request (DNR):** Used to spoof `Origin` and `Referer` headers for Chapar internal API requests.

## Important Components
- `background.js`: Service worker handling async fetches and DNR rules.
- `content.js`: Main content script for DOM extraction and UI routing.
- `ui-render.js`: Renders the complex modals (timeline, history, errors).
- `iran-post.js`: Content script injected into `tracking.post.ir`.

## Technologies Used
- Chrome Extension Manifest V3 (MV3)
- Vanilla JavaScript (ES6+)
- Vanilla CSS
- Chrome APIs (`chrome.runtime`, `chrome.storage`, `chrome.declarativeNetRequest`, `chrome.tabs`)

## Runtime Environments
- `panel.automoby.ir` (Content Script context)
- `tracking.post.ir` (Content Script context)
- Extension Service Worker (Background context)

## Current Development Status
Active. Recently underwent a major refactor to bypass Chapar's internal firewall by implementing header spoofing and a custom sloppy JSON parser.

## Important Constraints & Warnings
- **Chapar Firewall:** `portal.chaparnet.com` aggressively blocks requests without proper `Origin`/`Referer` headers and `X-Requested-With: XMLHttpRequest`.
- **Sloppy JSON:** Chapar's PHP backend generates invalid JSON strings (unquoted keys, literal newlines, stray backslashes). The `background.js` uses a highly specific `parseSloppyJSON` regex cleaner to fix this. Do **NOT** remove or over-simplify this parser.
- **Authentication:** For the Chapar internal API fetch to work, the user **MUST** be logged into `portal.chaparnet.com` in another tab so the service worker can attach the session cookies via `credentials: 'include'`.

## Where to Look First When Debugging
1. Look at `background.js` `handleChaparFetch()` for API routing logic and the sloppy JSON parser.
2. Look at `content.js` `handleRoutingAction()` for how UI actions map to background messages.
3. Look at `ui-render.js` for rendering logic of the fetched JSON data.

## References
- [ARCHITECTURE.md](./ARCHITECTURE.md)
- [DATA_FLOW.md](./DATA_FLOW.md)
- [CURRENT_PROBLEMS.md](./CURRENT_PROBLEMS.md)
- [DEBUGGING_GUIDE.md](./DEBUGGING_GUIDE.md)
- [API_AND_INTEGRATIONS.md](./API_AND_INTEGRATIONS.md)
- [FILE_MAP.md](./FILE_MAP.md)
