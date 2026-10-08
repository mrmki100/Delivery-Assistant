# AI Handoff Document

**Hello Fellow AI!** 
If you are reading this, you are tasked with assisting the developer with the **Delivery Assistant** Chrome Extension.

## 1. What This Project Is
A Manifest V3 Chrome Extension that bridges an internal CRM dashboard (`panel.automoby.ir`) with two external logistics providers: Chapar and Iran Post. It scrapes tracking numbers, spoofs headers to bypass third-party firewalls, sanitizes incredibly broken server JSON responses, and renders rich tracking modals directly inside the CRM.

## 2. What Currently Works
- DOM extraction from the Automoby React data grid.
- Smart routing based on Waybill prefixes.
- Header spoofing (`Origin`/`Referer`) via DNR.
- Background fetching from authenticated Chapar portal endpoints.
- Advanced Regex sanitization of Chapar's invalid JSON responses.
- Opening and automating the tracking input on `tracking.post.ir`.

## 3. What Currently Does Not Work (Or is Fragile)
- The extension requires the user to maintain an active, logged-in tab for `portal.chaparnet.com`. If the session expires, the API fetch silently returns HTML, triggering an `AUTH_REQUIRED` state.
- `offscreen.html` and `offscreen.js` are currently dead code left over from a previous HTML-scraping architecture.

## 4. Most Important Architecture Information
- **`background.js` is the API Bridge.** Content scripts CANNOT make direct network requests to Chapar due to CORS. All fetches are routed through `chrome.runtime.sendMessage`.
- **DNR Rules.** Look at `chrome.declarativeNetRequest.updateDynamicRules` in `background.js`. This is critical for the extension to function. Without it, Chapar drops the requests.
- **Sloppy JSON.** Chapar's JSON is broken. `parseSloppyJSON()` in `background.js` fixes it. **DO NOT replace this with standard `JSON.parse` or the extension will crash instantly.**

## 5. Important Files to Inspect First
1. `background.js` (Core network and parser logic)
2. `content.js` (DOM interaction and UI event mapping)
3. `ui-render.js` (Visual presentation)

## 6. Known Bugs & Technical Risks
- **Risk:** If Chapar updates their internal portal endpoints (`ConsignmentHistory.php`), the extension will fail to fetch logs.
- **Risk:** If Automoby changes the `data-field` attributes in their `MuiDataGrid`, `content.js` will fail to extract data.

## 7. Things an AI Must NOT Assume
- Do **NOT** assume the server returns `application/json` just because you use `fetch().json()`. Always use `await response.text()` and pass it through `parseSloppyJSON()`.
- Do **NOT** assume `eval()` or `new Function()` can be used to parse the sloppy JSON. MV3 completely bans them.
- Do **NOT** try to use Node.js modules or bundlers. This is a Vanilla JS project.

## 8. Suggested Investigation Order for Bugs
1. Check DevTools Console on `panel.automoby.ir`.
2. Check Service Worker Console in `chrome://extensions`.
3. Check if the user is actually logged into `portal.chaparnet.com`.

## 9. References
Review [ARCHITECTURE.md](./ARCHITECTURE.md), [DATA_FLOW.md](./DATA_FLOW.md), and [CURRENT_PROBLEMS.md](./CURRENT_PROBLEMS.md) before making any code modifications.

---

## KNOWN DOCUMENTATION LIMITATIONS
- Cannot definitively confirm the exact authentication timeout duration for `portal.chaparnet.com`.
- Cannot predict future DOM changes on `tracking.post.ir` or `panel.automoby.ir`.
- The exact structure of all potential Error HTML pages returned by Chapar's firewall is not fully mapped.
