# Current Problems

This document tracks known issues, technical debt, and architectural risks in the current codebase.

## 1. Chapar Sloppy JSON Output (RESOLVED/MITIGATED RISK)
- **Problem ID:** BUG-001
- **Severity:** HIGH (Critical Path)
- **Status:** Mitigated (via custom parser)
- **Symptoms:** Extension previously threw `خطا در ارتباط با سرور چاپار: خطای فرمت سرور` and failed to load details.
- **Reproduction:** Execute a background fetch to `portal.chaparnet.com/OBJ/List/Consignment.php`.
- **Expected behavior:** Server returns strict `application/json`.
- **Actual behavior:** Server returns unquoted keys, single-quoted strings, literal line breaks, invalid backslash escapes (e.g., `\'`), and BOM characters.
- **Relevant files:** `background.js`
- **Relevant functions:** `parseSloppyJSON()`
- **Likely technical cause:** Chapar's PHP framework manually concatenates strings to generate JavaScript object literals instead of using standard `json_encode()`.
- **Known workaround:** `parseSloppyJSON` runs highly specific regex passes to sanitize the string into strict JSON.
- **Remaining uncertainty:** If Chapar introduces a new formatting quirk (e.g., unescaped double quotes inside HTML attributes when using single quotes as string boundaries), the regex might fail.

## 2. Chapar Authentication Expiry
- **Problem ID:** ARCH-001
- **Severity:** MEDIUM
- **Status:** Handled gracefully
- **Symptoms:** UI displays "لطفا وارد حساب چاپار شوید." (Please login to Chapar).
- **Reproduction:** Close all Chapar portal tabs, wait for session expiry or clear cookies, then click a Waybill in Automoby.
- **Actual behavior:** The background `fetch` returns the HTML of the login page instead of JSON.
- **Relevant files:** `background.js` (`handleChaparPhoneSearch`, `handleChaparFetch`)
- **Likely technical cause:** Service Worker sends `credentials: 'include'` but the cookies are invalid/expired.
- **Possible impact:** Interrupts user workflow, requiring manual login in another tab.

## 3. Iran Post Target Element Changes
- **Problem ID:** RISK-001
- **Severity:** LOW
- **Status:** Open Risk
- **Symptoms:** Iran Post tab opens, but the tracking number is not injected.
- **Relevant files:** `iran-post.js`
- **Relevant functions:** DOM Polling loop (`setInterval`)
- **Likely technical cause:** `tracking.post.ir` occasionally updates its DOM IDs or switches to single-page app (React/Vue) behaviors that break query selectors like `#txtSearch`.
- **Evidence:** `iran-post.js` uses multiple fallback selectors (`document.querySelector('input[type="text"][placeholder*="کد رهگیری"]')`) specifically to mitigate this.

## 4. Unused Offscreen Files (Technical Debt)
- **Problem ID:** DEBT-001
- **Severity:** LOW
- **Status:** Unresolved
- **Symptoms:** `offscreen.html` and `offscreen.js` exist in the repository but are never invoked by `background.js`.
- **Relevant files:** `offscreen.html`, `offscreen.js`
- **Likely technical cause:** Previous architectural iteration used an offscreen document to parse HTML via DOMParser. Current architecture parses JSON directly, rendering these files obsolete.
- **Possible impact:** Minor bundle bloat and potential confusion for future developers.
