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
