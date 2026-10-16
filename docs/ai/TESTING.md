# Testing

## Automated Tests
The repository includes a comprehensive Node.js native test suite (`node:test`) covering authentication detection, lookup gating, Jira regression, and UI parity:

### Execution Command
```bash
node --test tests/*.test.mjs
```

### Test Suites (30 Tests Total)
1. **`tests/chapar-auth-detection.test.mjs` (12 tests):**
   - HTTP 401 Unauthorized → `NEEDS_LOGIN`
   - HTTP 403 Forbidden → `NEEDS_LOGIN`
   - URL redirect to `/login` → `NEEDS_LOGIN`
   - URL redirect to `index.php?P=Login` → `NEEDS_LOGIN`
   - HTML body containing `<input type="password">` → `NEEDS_LOGIN`
   - HTML body containing Persian login prompts (`نام کاربری`, `رمز عبور`) → `NEEDS_LOGIN`
   - xajax XML redirect instruction (`window.location = 'index.php?P=Login'`) → `NEEDS_LOGIN`
   - HTTP 500, 502, 503 → `PORTAL_UNAVAILABLE`
   - Valid empty Flexigrid JSON (`total: 0, rows: []`) → `AUTHENTICATED`
   - Valid populated Flexigrid JSON (`total: 1, rows: [...]`) → `AUTHENTICATED`
   - Authenticated operational xajax XML/HTML → `AUTHENTICATED`
   - Unrecognized 200 response without auth markers → `UNKNOWN`

2. **`tests/chapar-lookup-flow.test.mjs` (8 tests):**
   - Unauthenticated consignment lookup returns `AUTH_REQUIRED` without falling back to public tracking
   - Unauthenticated phone search returns `AUTH_REQUIRED`
   - Portal 5xx returns `PORTAL_UNAVAILABLE` without claiming user is logged out
   - Network fetch timeout aborts cleanly and returns `PORTAL_UNAVAILABLE`
   - `isPublicOnly: true` returned ONLY when confirmed `AUTHENTICATED` and 0 rows found
   - Full tracking returned when authenticated and consignment exists
   - Recovery: transitioning from logged-out to logged-in on retry restores state
   - In-flight monotonic sequence guards (`currentRoutingSeq`) prevent race conditions

3. **`tests/jira-regression.test.mjs` (3 tests):**
   - Jira error handler renders exact `.cx-jira-error-badge` with `"⚠️ نیاز به ورود"`, `"ورود ↗"`, and `"🔄"` in `content.js`
   - Jira CSS classes in `styles.css` remain unmodified and intact
   - Jira ticket search in `background.js` remains intact

4. **`tests/ui-parity-chapar-jira.test.mjs` (7 tests):**
   - Chapar error state uses exact Persian label `"نیاز به ورود"`
   - Chapar error badge reuses `.cx-jira-error-badge`, `.cx-jira-login-btn`, and `.cx-jira-refresh-btn` CSS classes
   - Widget containers `#cx-waybill-widget` and `#cx-phone-widget` share exact `.cx-jira-widget` styling rules
   - Official Chapar portal login URL (`https://portal.chaparnet.com`) is targeted
   - Dark theme tokens are defined and match Jira error badge styling
   - Chapar button uses existing `.cx-spinner` component for loading state
   - Chapar and Jira maintain separate sequences and independent authentication states


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
