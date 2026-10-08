# File Map

This document outlines the purpose, dependencies, and status of every file in the repository.

## Extension Core
- **`manifest.json`**
  - Type: Configuration File
  - Purpose: Defines extension metadata, MV3 architecture, permissions (`declarativeNetRequest`, `storage`, `offscreen`), and host permissions.
  - Status: ACTIVE

- **`background.js`**
  - Type: Service Worker / Background Script
  - Purpose: The central API bridge. Spoofs headers, handles HTTP requests to Chapar API, and parses sloppy JSON.
  - Important Functions: `handleChaparFetch`, `handleChaparPhoneSearch`, `parseSloppyJSON`, `handlePostTab`.
  - Depends on: Chrome APIs (`declarativeNetRequest`, `storage`, `tabs`).
  - Status: ACTIVE

## UI & Content Scripts (Automoby Panel)
- **`content.js`**
  - Type: Content Script
  - Purpose: Injected into `panel.automoby.ir`. Scrapes the DOM for tracking info and manages the floating action bar. Maps UI clicks to background messages.
  - Important Functions: `ensurePanelExists`, `extractData`, `handleRoutingAction`.
  - Depends on: `ui-render.js` (for rendering modals), `styles.css`.
  - Status: ACTIVE

- **`ui-render.js`**
  - Type: Content Script / UI Library
  - Purpose: Contains all HTML templates and DOM manipulation logic to render the custom modals (Loading, Error, Auth Error, Timeline, Phone Search List) inside Automoby.
  - Important Functions: `renderTrackingModal`, `renderPhoneListModal`, `renderAuthErrorModal`, `getExtensionRoot`.
  - Depends on: Global CSS defined in `styles.css`.
  - Status: ACTIVE

- **`styles.css`**
  - Type: CSS Stylesheet
  - Purpose: Contains heavily scoped/encapsulated CSS rules (using `.cx-` prefixes) to style the floating bar and modals without leaking into Automoby's React app styles.
  - Status: ACTIVE

## UI & Content Scripts (Iran Post)
- **`iran-post.js`**
  - Type: Content Script
  - Purpose: Injected into `tracking.post.ir`. Reads tracking number from storage and injects it into the post website search box.
  - Depends on: `chrome.storage.local`.
  - Status: ACTIVE

## Documentation & Reference
- **`chapar_api_docs.md`**
  - Type: Reference Documentation
  - Purpose: Contains original documentation for Chapar's REST API (`app.krch.ir`). Used for mapping JSON keys to Persian labels.
  - Status: REFERENCE

## Unused / Legacy Files
- **`offscreen.html`**
  - Type: HTML File
  - Purpose: Originally intended to host `offscreen.js` to parse raw HTML strings using `DOMParser` in the background.
  - Status: UNUSED / LEGACY (Replaced by `background.js` direct JSON fetching and sloppy JSON parsing).

- **`offscreen.js`**
  - Type: Background Script (Offscreen context)
  - Purpose: Contains logic to parse Flexigrid HTML tables into JSON.
  - Status: UNUSED / LEGACY (Replaced by `background.js` parsing `ConsignmentHistory.php` JSON).

## Important Side Effects
- `background.js` heavily modifies `chrome.declarativeNetRequest` dynamic rules on installation.
- `content.js` uses an aggressive `setInterval(ensurePanelExists, 1000)` to combat React DOM overwrites on the Automoby site.
