# Technical Decisions

## 1. Hybrid API Approach for Chapar
- **Context:** The public REST API (`app.krch.ir`) lacks detailed logistical logs. The internal portal (`portal.chaparnet.com`) has the logs, but it is locked behind authentication and CSRF protections, and its JSON formatting is broken.
- **Decision:** Use a Hybrid Engine in `background.js` that makes sequential fetches to both endpoints and merges the results.
- **Alternatives Considered:** Originally, the extension fetched raw HTML from the portal and used an `offscreen.html` document with `DOMParser` to scrape the tables.
- **Reason:** The JSON internal endpoint (`ConsignmentHistory.php`) is cleaner and less prone to HTML layout changes, despite requiring a complex regex string sanitizer.

## 2. Header Spoofing via DeclarativeNetRequest (DNR)
- **Context:** Fetching the internal Chapar portal from `chrome-extension://` origin triggered their firewall, returning empty responses.
- **Decision:** Implement `chrome.declarativeNetRequest` to strip the extension's Origin and inject `Origin: https://portal.chaparnet.com`.
- **Alternatives Considered:** Asking users to run Chrome with security disabled (unacceptable).
- **Consequences:** Requires the highly-privileged `declarativeNetRequest` permission in Manifest V3.

## 3. Vanilla JS and CSS
- **Context:** Need to inject complex UI components into a third-party React application (`panel.automoby.ir`).
- **Decision:** Use pure Vanilla JS strings (Template Literals) and heavily scoped CSS classes (`.cx-`) rather than a framework.
- **Reason:** Avoids bundle bloat, dependency conflicts with the host site's React, and keeps the extension lightweight and easy to iterate on quickly.
