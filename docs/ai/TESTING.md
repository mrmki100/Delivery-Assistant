# Testing

## Automated Tests
**CONFIRMED:** There are NO automated tests (Unit, Integration, or E2E) currently configured in this repository.

## Manual Testing Procedures

### 1. Automoby DOM Extraction
- **Action:** Open `panel.automoby.ir`.
- **Verify:** The `.cx-floating-bar` is injected.
- **Action:** Click on various rows in the data grid.
- **Verify:** The phone number and waybill buttons populate correctly based on the row's hidden data.
- **Edge Case:** Use **Alt+Click** on a row to verify the hidden column code names haven't changed.

### 2. Chapar Phone Search API
- **Action:** Ensure logged into `portal.chaparnet.com` in another tab.
- **Action:** Click the "📱 موبایل" button on a row with a valid phone number.
- **Verify:** The modal opens and displays a list of waybills.
- **Edge Case:** Clear cookies for `portal.chaparnet.com` and test. Verify the extension handles the auth failure gracefully and prompts the user to log in.

### 3. Chapar Detailed Tracking API
- **Action:** Click a "📦 چاپار" button.
- **Verify:** The modal opens, displaying timeline nodes (Origin, Destination, Statuses) and a detailed table of internal logs.
- **Edge Case:** Verify that logs containing escaped characters or literal line breaks do not crash the parser.

### 4. Iran Post Routing
- **Action:** Click a "📦 پست" button for a non-Chapar waybill.
- **Verify:** A new tab opens to `tracking.post.ir`.
- **Verify:** The tracking number is automatically pasted into the search box.
- **Verify:** The Captcha box is focused automatically.

## Regression-Sensitive Areas
- **`parseSloppyJSON` in `background.js`:** This regex chain is highly tuned. Any changes here MUST be manually tested against real Chapar JSON payloads containing `\'`, literal newlines, and unquoted keys.
- **DNR Rules in `background.js`:** The header spoofing rules are required. If `background.js` fails to register them on install, all Chapar requests will return empty text.
