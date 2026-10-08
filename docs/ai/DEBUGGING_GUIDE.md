# Debugging Guide

This guide explains how to effectively trace issues and debug the extension.

## How the Extension Starts
1. Chrome loads the extension based on `manifest.json`.
2. The Service Worker (`background.js`) boots up invisibly.
3. When the user navigates to `panel.automoby.ir`, `content.js`, `ui-render.js`, and `styles.css` are automatically injected.
4. `content.js` begins a `setInterval` loop to ensure the floating Shadow Panel is injected into the DOM.

## Recommended Debugging Order
If an API request to Chapar fails, trace it in this order:

### 1. Content Script (UI Events)
- **Location:** Automoby Dashboard -> Chrome DevTools -> Console.
- **What to look for:** Did the user click the button? Did `extractData()` in `content.js` successfully pull the phone/waybill from the MuiDataGrid?
- **Pro-Tip:** Hold **Alt + Click** on any row in the Automoby dashboard. `content.js` has a secret diagnostic tool that will alert and console.log every hidden data-field code name in that row.

### 2. Service Worker (API Bridge)
- **Location:** `chrome://extensions` -> Find the extension -> Click **"service worker"** to open its dedicated DevTools.
- **What to look for:** This is where the magic happens. Look for logs tagged with `[🤖 CX Debug]`.
- **Check Network Tab:** Look at the POST requests to `Consignment.php`. 
- **Check Headers:** Verify that `X-Requested-With: XMLHttpRequest` was sent. Check if `Origin` was spoofed correctly (you can't easily see DNR spoofing in DevTools, but you can infer it if the server accepts the request).
- **Check JSON Parse Errors:** If Chapar sends bad JSON, `background.js` will catch it and log `Strict Error: ... | Sloppy Error: ...`. This tells you exactly which character broke the regex parser.

### 3. UI Rendering
- **Location:** Automoby Dashboard -> Chrome DevTools -> Elements.
- **What to look for:** If the Service Worker returns `{ success: true, data: {...} }` but the screen is blank, the error is in `ui-render.js`.
- **Check DOM:** Look for `.cx-modal-overlay`. If `ui-render.js` crashes during execution, it will log errors to the standard console.

## Where Errors Are Caught (and Not Caught)
- **Caught:** `background.js` aggressively wraps all `fetch` and `JSON.parse` operations in `try/catch` blocks. It almost never throws an unhandled exception. Instead, it returns `{ success: false, error: ... }` to `content.js`.
- **Not Caught:** DOM query failures in `content.js` or `ui-render.js` (e.g., if Automoby changes its `MuiDataGrid` class names) will throw standard null reference errors in the console.

## Important Chrome DevTools Locations
- **Service Worker Console:** Only accessible via `chrome://extensions`.
- **Content Script Context:** Accessible via the main page DevTools -> Console -> Change context dropdown from "top" to "Delivery Assistant".
