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

## 4. Chapar Authentication State Detection and Jira-Parity Login-Required UI
- **Context:** When an agent was logged out of `portal.chaparnet.com`, querying a waybill failed to locate the internal DB ID and previously fell through to opening the public tracking workflow with a misleading message ("این مرسوله در پورتال پرسنلی ثبت نشده است"). Agents were confused, not knowing whether the shipment truly didn't exist or if their portal session had simply expired.
- **Decision:**
  1. **Evidence-Based Auth Detection:** Implement `analyzeChaparPortalAuth(res, text)` in `background.js` to inspect HTTP status codes (401/403/5xx), URL redirects (`/login`, `P=Login`), and HTML login form markers (`type="password"`, Persian login markers), strictly distinguishing `NEEDS_LOGIN`, `PORTAL_UNAVAILABLE`, `AUTHENTICATED`, and `UNKNOWN`.
  2. **Public Tracking Gating:** Gate the public tracking fallback strictly: only when the user is confirmed `AUTHENTICATED` and the portal returns 0 rows may public tracking be offered.
  3. **Exact Jira UI Parity:** Reused the existing Jira login-required UI architecture in `content.js` and `styles.css`: wrapped `#btn-waybill` and `#btn-phone` in widget containers sharing `.cx-jira-widget` rules, reused `.cx-jira-error-badge`, `.cx-jira-login-btn`, and `.cx-jira-refresh-btn`, displayed the exact Persian label `"نیاز به ورود"`, provided a login button opening `https://portal.chaparnet.com`, and an in-place retry button `"🔄"`.
  4. **Strict Service Independence:** Jira and Chapar maintain separate sequence numbers (`currentJiraSeq`, `currentRoutingSeq`) and independent auth state caches so being logged into one never affects the other.
- **Alternatives Considered:**
  - Intrusive modal popup / alert: Rejected because it interrupts the agent's workflow and is inconsistent with the compact inline Jira error badge.
  - Silent redirect: Rejected because it navigates the agent away from the active Automoby order context.
- **Consequences:** Immediate visual feedback matching the familiar Jira workflow, zero misleading "not found" assumptions, one-click portal login, and immediate in-place retry without browser restart or extension reload.

