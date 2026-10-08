# Project Timeline

*Note: History reconstructed from visible architecture remnants and current system behavior.*

## Stage 1: Basic DOM Injection
- Extension was created to inject a floating bar into `panel.automoby.ir`.
- Basic tracking extraction via `MuiDataGrid` class scraping implemented.

## Stage 2: Iran Post Integration
- Implemented `chrome.tabs.create` and cross-tab communication via `chrome.storage.local` to automate the Iran Post tracking site (`tracking.post.ir`).

## Stage 3: Initial Chapar Portal Integration
- Implemented `offscreen.html` and `offscreen.js` to parse HTML tables using `DOMParser`.
- Attempted to bypass Chapar API limitations by scraping the raw HTML of the portal.

## Stage 4: Advanced Hybrid Architecture (Current Stage)
- Abandoned `offscreen` HTML parsing in favor of undocumented JSON endpoints (`ConsignmentHistory.php`).
- Encountered WAF/Firewall blocking `chrome-extension://` requests.
- Implemented `chrome.declarativeNetRequest` to spoof `Origin` and `Referer`.
- Encountered massive JSON parsing errors due to Chapar's PHP framework generating "sloppy" javascript object literals instead of strict JSON.
- Implemented aggressive Regex sanitizer (`parseSloppyJSON`) to handle literal newlines, unquoted keys, BOMs, and invalid JSON escapes (`\'`).
