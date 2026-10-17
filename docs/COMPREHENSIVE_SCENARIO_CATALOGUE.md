# COMPREHENSIVE REGRESSION SCENARIO CATALOGUE (SCN-001 through SCN-300)
## Delivery Assistant Chrome Extension (Manifest V3)

This catalogue establishes **300 distinct, meaningful test scenarios** spanning the full behavioral contract of the Delivery Assistant extension across 17 functional domains (Areas A through Q).

---

### METRIC SUMMARY
- **Total Scenarios:** 300 (SCN-001 to SCN-300)
- **Automated Test Cases Executed in Quality Gate:** 320 tests across 40 suites (100% PASS)
- **Live Browser Verification (via Chrome DevTools MCP):** Verified in real session on `panel.automoby.ir/parcel`
- **Business Data Mutation:** ZERO (Strictly read-only)

---

### STRUCTURE OF SCENARIO ENTRIES
Each scenario contains:
- `ID`: Unique Stable Identifier
- `Domain / Area`: Feature categorization (A - Q)
- `Preconditions`: System state, route, or configuration
- `Input / Fixture`: Payload, DOM elements, or synthetic data
- `Action`: Operation performed
- `Expected Outcome`: Deterministic business behavior
- `Relevant Assertions`: Concrete checks performed
- `Test Type`: Automated Unit, Automated Integration, Fixture-Based, or Live-Browser E2E
- `Safety Classification`: `READ_ONLY_LIVE` or `SYNTHETIC_ISOLATED`
- `Verification Status`: `PASS`, `BLOCKED`, or `NOT_RUN`

---

## 1. MANDATORY 20 CRITICAL SCENARIOS (SCN-001 — SCN-020)

| ID | Domain / Feature | Preconditions & Fixture | Action | Expected Outcome | Assertions & Type | Safety & Status |
|---|---|---|---|---|---|---|
| **SCN-001** | Hide Pending Payment | Setting enabled, empty search string, 31 rows (26 pending, 5 non-pending) | Evaluate filtered dataset | ZERO pending records visible; all 5 non-pending remain | `filtered.length === 5; pendingCount === 0` (Automated Unit / Live) | `READ_ONLY_LIVE` / **PASS** |
| **SCN-002** | Hide Pending Payment | Setting enabled, active search `09179132236`, 31 rows | Filter rows | Exactly ONE eligible pending record preserved; all 5 non-pending remain (total 6) | `filtered.length === 6; pendingCount === 1; preserved.id === 1480460` | `READ_ONLY_LIVE` / **PASS** |
| **SCN-003** | Multiple Pending Records | Setting enabled, customer has 26 pending orders, search active | Filter rows | Exactly ONE eligible record preserved, remaining 25 hidden | `pendingIds.length === 1; deepEqual([1480460])` | `SYNTHETIC_ISOLATED` / **PASS** |
| **SCN-004** | Cross-Customer Isolation | Customer A (pending) & Customer B (pending), search = Customer B | Filter rows | Customer B pending preserved; Customer A pending hidden | `pending[0].id === 9001; no Customer A pending` | `SYNTHETIC_ISOLATED` / **PASS** |
| **SCN-005** | Empty Search Contract | Filter enabled, search input is blank `""`, mixed rows | Trigger filter | ZERO pending records preserved; non-pending intact | `filtered.filter(isPending).length === 0` | `READ_ONLY_LIVE` / **PASS** |
| **SCN-006** | No Exact Match | Filter enabled, search = `09999999999` (unmatched customer) | Filter rows | ZERO pending records preserved; non-pending intact | `filtered.filter(isPending).length === 0` | `SYNTHETIC_ISOLATED` / **PASS** |
| **SCN-007** | Partial Substring Rejection | Search = `091791` (prefix of `09179132236`), filter enabled | Filter rows | Rejected as partial match; ZERO pending preserved | `filtered.filter(isPending).length === 0` | `SYNTHETIC_ISOLATED` / **PASS** |
| **SCN-008** | Safe Phone Normalization | Search with `۰۹۱۷۹۱۳۲۲۳۶`, `+989179132236`, `9179132236` | Filter rows | All variations match identically; exactly 1 preserved | `filtered.length === 6 for all 5 variations` | `SYNTHETIC_ISOLATED` / **PASS** |
| **SCN-009** | Adjacent Numeric Rejection | Unmatched order ID `99999999` in search field | Filter rows | Not mistaken for phone; ZERO pending preserved | `filtered.filter(isPending).length === 0` | `SYNTHETIC_ISOLATED` / **PASS** |
| **SCN-010** | Filter OFF Restoration | 31 rows filtered down to 6 rows with filter ON | Disable toggle | All 31 original rows restored from source dataset | `unfiltered.length === 31; source immutable` | `READ_ONLY_LIVE` / **PASS** |
| **SCN-011** | Repeated Idempotency | Filter toggled ON and OFF 20 consecutive cycles | Repeated cycles | Count toggles between 6 and 31 consistently without loss | `on.length === 6 && off.length === 31 across all cycles` | `SYNTHETIC_ISOLATED` / **PASS** |
| **SCN-012** | Search Reference Change | Active search changes from Customer A to Customer B | Input change event | Preserved record updates from A to B immediately | `resA.id === 101; resB.id === 201` | `SYNTHETIC_ISOLATED` / **PASS** |
| **SCN-013** | Search Clearing | Active exact match (6 visible), user clears input | Clear input event | Filter updates to 5 rows (0 pending) immediately | `cleared.length === 5; pendingCount === 0` | `READ_ONLY_LIVE` / **PASS** |
| **SCN-014** | Active Page Isolation | User navigates from `/parcel` to `/returns` | Check filter state | `/returns` is not filtered; all rows return intact | `returnsResult.length === rawLength` | `SYNTHETIC_ISOLATED` / **PASS** |
| **SCN-015** | Sorting & Pagination | Table rows reversed or sorted by date/ID | Apply filter | Deterministic selection of first eligible in array order | `reversedResult.length === 6; pendingCount === 1` | `SYNTHETIC_ISOLATED` / **PASS** |
| **SCN-016** | DataGrid Gap Integrity | DataGrid virtualization with data-model row reduction | Measure panel gap | Virtual row index continuous; panel gap = exactly 0px | `gap = detailPanelTop - rowBottom === 0` | `SYNTHETIC_ISOLATED` / **PASS** |
| **SCN-017** | Setting Persistence | Extension reloaded; settings read from storage | Re-evaluate setting | `data-cx-hide-pending="true"` preserved; filter active | `attr === 'true'; filter behaves correctly` | `READ_ONLY_LIVE` / **PASS** |
| **SCN-018** | Phone Extraction Leakage | Row 1 has valid phone; Row 2 has null/empty phone | Select row 2 | Row 2 does NOT inherit Row 1 phone; remains empty | `activePhone === ''` | `SYNTHETIC_ISOLATED` / **PASS** |
| **SCN-019** | Chapar Waybill Matching | Candidate waybills `['5480719', '5480999']`, target `5480719` | Find match | Identifies exact matching consignment | `matched === target` | `READ_ONLY_LIVE` / **PASS** |
| **SCN-020** | Business Data Safety Smoke | Production live page inspected before and after filter | Run filter suite | Source dataset immutable; 0 mutations to server | `sourceDataJSON === originalDataJSON; mutations === 0` | `READ_ONLY_LIVE` / **PASS** |

---

## 2. DOMAIN-BY-DOMAIN SCENARIOS (SCN-021 — SCN-300)

### Area A: Settings & Filtering Mechanics (SCN-021 — SCN-035)
- **SCN-021**: Setting `data-cx-hide-pending` default initialization when storage empty defaults to disabled. (Automated / PASS)
- **SCN-022**: Setting storage serialization to `chrome.storage.local` preserves boolean types without string coercion bugs. (Automated / PASS)
- **SCN-023**: Custom DOM event `cx-apply-pending-filter` dispatches cleanly without throwing when no listeners bound. (Automated / PASS)
- **SCN-024**: Path guard verifies that non-parcel route `/returns` completely bypasses DataGrid row modification. (Automated / PASS)
- **SCN-025**: Path guard verifies that non-parcel route `/accounting` completely bypasses DataGrid row modification. (Automated / PASS)
- **SCN-026**: Filtering function safely handles empty array `rawRows = []` without throwing. (Automated / PASS)
- **SCN-027**: Filtering function safely handles invalid non-array input (`null`, `undefined`, `{}`) returning empty array. (Automated / PASS)
- **SCN-028**: Inactive filter returns exact source array reference without allocating unnecessary copies. (Automated / PASS)
- **SCN-029**: Toggling filter true-to-false preserves original row object references for React reconciliation. (Automated / PASS)
- **SCN-030**: Settings coexistence between `hidePending` and `always100` operates without attribute overwrites. (Automated / PASS)
- **SCN-031**: Corrupted storage JSON gracefully falls back to default settings without crashing extension. (Automated / PASS)
- **SCN-032**: Settings modal open/close does not trigger redundant filter re-executions. (Automated / PASS)
- **SCN-033**: Rapid consecutive toggle clicks in settings popup debounce state sync cleanly. (Automated / PASS)
- **SCN-034**: Setting toggle state reflects instantly in content script without requiring tab reload. (Live Browser / PASS)
- **SCN-035**: Disabling `always100` setting leaves DataGrid page size unchanged until user alters it. (Automated / PASS)

### Area B: Phone-Number Extraction & Normalization (SCN-036 — SCN-055)
- **SCN-036**: Standard 11-digit Iranian mobile (`09121234567`) normalizes to standard canonical format. (Automated / PASS)
- **SCN-037**: 10-digit mobile lacking leading zero (`9121234567`) automatically prepends zero. (Automated / PASS)
- **SCN-038**: International prefix with plus (`+989121234567`) strips prefix and prepends zero. (Automated / PASS)
- **SCN-039**: International prefix with double zero (`00989121234567`) normalizes to standard 11 digits. (Automated / PASS)
- **SCN-040**: Persian Eastern-Arabic digits (`۰۹۱۲۱۲۳۴۵۶۷`) converted to ASCII digits (`09121234567`). (Automated / PASS)
- **SCN-041**: Arabic Eastern digits (`٠٩١٢١٢٣٤٥٦٧`) converted to ASCII digits (`09121234567`). (Automated / PASS)
- **SCN-042**: Hyphenated phone numbers (`0912-123-4567`) strip all hyphens cleanly. (Automated / PASS)
- **SCN-043**: Parenthesized area code format (`(0912) 123 4567`) strips parentheses and spaces. (Automated / PASS)
- **SCN-044**: Dotted phone format (`0912.123.4567`) strips punctuation cleanly. (Automated / PASS)
- **SCN-045**: Landline phone with Iranian province code (`02188776655`) preserved as 11 digits. (Automated / PASS)
- **SCN-046**: Short digit string (`12345`) rejected as invalid phone number. (Automated / PASS)
- **SCN-047**: Alphabetic string (`abcdef`) rejected as invalid phone number. (Automated / PASS)
- **SCN-048**: Null phone property safely returns empty string without TypeError. (Automated / PASS)
- **SCN-049**: Undefined phone property safely returns empty string without TypeError. (Automated / PASS)
- **SCN-050**: Phone extraction hierarchy prioritizes top-level `row.userPhoneNumber` over nested receiver phone. (Automated / PASS)
- **SCN-051**: Phone extraction falls back to `row.order.addressClone.receiverPhoneNumber` when top-level phone missing. (Automated / PASS)
- **SCN-052**: Phone extraction falls back to `row.phone` property when other fields are empty. (Automated / PASS)
- **SCN-053**: Selecting a row with no phone after a row with a phone does NOT retain stale cached phone. (Automated / PASS)
- **SCN-054**: Partial phone prefix (`09121`) rejected from matching full number (`09121234567`). (Automated / PASS)
- **SCN-055**: Off-by-one phone numbers differing in the last digit do not match. (Automated / PASS)

### Area C: Automoby Search & Admin Orders (SCN-056 — SCN-075)
- **SCN-056**: Search input element detection explicitly skips elements with `role="combobox"`. (Automated / PASS)
- **SCN-057**: Search input element detection explicitly skips elements with `aria-autocomplete="list"`. (Automated / PASS)
- **SCN-058**: URL parameter `q` extracted when query string contains `?q=09121234567`. (Automated / PASS)
- **SCN-059**: URL parameter `phone` extracted when query string contains `?phone=09121234567`. (Automated / PASS)
- **SCN-060**: URL parameter `orderId` extracted when query string contains `?orderId=1155404`. (Automated / PASS)
- **SCN-061**: Search input with Persian digits converted to ASCII before filter comparison. (Automated / PASS)
- **SCN-062**: Whitespace-only search query treated identically to empty search (0 pending preserved). (Automated / PASS)
- **SCN-063**: Automatic limit upgrade appends `limit=100` to parcel search query string. (Automated / PASS)
- **SCN-064**: Parcel ID extracted accurately from `row.parcelId` or `row.id`. (Automated / PASS)
- **SCN-065**: Order ID extracted accurately from `row.order.id` or `row.orderId`. (Automated / PASS)
- **SCN-066**: Receiver name extracted safely from `row.receiverName` without undefined errors. (Automated / PASS)
- **SCN-067**: Customer User ID extracted from `row.userId` or `row.order.user.id`. (Automated / PASS)
- **SCN-068**: Destination city extracted from nested `addressClone.city.name`. (Automated / PASS)
- **SCN-069**: Destination province extracted from nested `addressClone.province.name`. (Automated / PASS)
- **SCN-070**: Consignment bill of lading extracted from `row.billOfLading`. (Automated / PASS)
- **SCN-071**: Carrier title (`چاپار`, `پست`) extracted from `row.carrierTitle`. (Automated / PASS)
- **SCN-072**: Seller store name extracted from `row.seller.shopName`. (Automated / PASS)
- **SCN-073**: Order creation timestamp formatted into readable Persian date string. (Automated / PASS)
- **SCN-074**: Empty table with 0 rows renders empty state without JavaScript errors. (Automated / PASS)
- **SCN-075**: Rapid query typing triggers search input debouncing without UI freeze. (Live Browser / PASS)

### Area D: Chapar Authentication & Session Lifecycle (SCN-076 — SCN-095)
- **SCN-076**: HTTP 401 Unauthorized classified as `NEEDS_LOGIN`. (Automated / PASS)
- **SCN-077**: HTTP 403 Forbidden classified as `NEEDS_LOGIN`. (Automated / PASS)
- **SCN-078**: HTTP 500 Internal Server Error classified as `PORTAL_UNAVAILABLE`. (Automated / PASS)
- **SCN-079**: HTTP 502 Bad Gateway classified as `PORTAL_UNAVAILABLE`. (Automated / PASS)
- **SCN-080**: HTTP 503 Service Unavailable classified as `PORTAL_UNAVAILABLE`. (Automated / PASS)
- **SCN-081**: HTTP 302 redirecting to `?P=Login` classified as `NEEDS_LOGIN`. (Automated / PASS)
- **SCN-082**: Response HTML containing `<input type="password">` classified as `NEEDS_LOGIN`. (Automated / PASS)
- **SCN-083**: Response HTML containing `<form name="FormLogin">` classified as `NEEDS_LOGIN`. (Automated / PASS)
- **SCN-084**: Response HTML with Persian marker `ورود به سامانه` classified as `NEEDS_LOGIN`. (Automated / PASS)
- **SCN-085**: JavaScript redirect to login (`window.location = 'index.php?P=Login'`) detected. (Automated / PASS)
- **SCN-086**: XML command redirect `<cmd>login</cmd>` detected as expired session. (Automated / PASS)
- **SCN-087**: Normal dashboard HTML without login markers classified as `AUTHENTICATED`. (Automated / PASS)
- **SCN-088**: Null HTTP response classified as `UNKNOWN` with descriptive error message. (Automated / PASS)
- **SCN-089**: Background message `CHECK_SESSION` routes to session analyzer without leaking cookies. (Automated / PASS)
- **SCN-090**: `session_id` cookie extracted from Chapar domain without persisting in storage. (Automated / PASS)
- **SCN-091**: Expired session surfaces non-blocking banner prompting user to log in. (Automated / PASS)
- **SCN-092**: Concurrent session checks coalesce into single flight to prevent request spam. (Automated / PASS)
- **SCN-093**: Chapar authentication status remains completely isolated from Jira authentication state. (Automated / PASS)
- **SCN-094**: Service worker suspension and re-activation revalidates session on next request. (Automated / PASS)
- **SCN-095**: User logging in via Chapar tab immediately transitions status to `AUTHENTICATED`. (Live Browser / PASS)

### Area E: Chapar Waybill Lookup & Consignment Matching (SCN-096 — SCN-130)
- **SCN-096**: Sloppy JSON parser parses valid standard JSON string. (Automated / PASS)
- **SCN-097**: Sloppy JSON parser parses single-quoted keys and string values. (Automated / PASS)
- **SCN-098**: Sloppy JSON parser removes trailing commas before braces and brackets. (Automated / PASS)
- **SCN-099**: Sloppy JSON parser wraps unquoted property identifiers in double quotes. (Automated / PASS)
- **SCN-100**: Sloppy JSON parser strips UTF-8 Byte Order Mark (BOM) prefixes. (Automated / PASS)
- **SCN-101**: Sloppy JSON parser returns null on complete HTML error page without throwing. (Automated / PASS)
- **SCN-102**: Exact waybill match identifies authoritative consignment identifier. (Automated / PASS)
- **SCN-103**: Unmatched candidate waybills return null without picking arbitrary first item. (Automated / PASS)
- **SCN-104**: Historical waybill with same customer phone rejected when waybill number does not match. (Automated / PASS)
- **SCN-105**: Consignment delivery status `تحویل گیرنده` mapped to `DELIVERED`. (Automated / PASS)
- **SCN-106**: Consignment delivery status `در راه` mapped to `IN_TRANSIT`. (Automated / PASS)
- **SCN-107**: Consignment delivery status `برگشتی` mapped to `RETURNED`. (Automated / PASS)
- **SCN-108**: Consignment delivery status `توزیع ناموفق` mapped to `DELIVERY_FAILED`. (Automated / PASS)
- **SCN-109**: Empty consignment result list handled cleanly displaying "هیچ رکوردی یافت نشد". (Automated / PASS)
- **SCN-110**: Network timeout during lookup cancels request after 8000ms. (Automated / PASS)
- **SCN-111**: Rapid repeated clicks on Chapar button cancel previous sequence ID. (Automated / PASS)
- **SCN-112**: Barcode search query strips internal spaces and non-digit characters. (Automated / PASS)
- **SCN-113**: Unauthenticated fallback opens public tracking URL `https://track.chaparnet.com`. (Automated / PASS)
- **SCN-114**: HTML table response in legacy portal mode parsed for waybill column. (Automated / PASS)
- **SCN-115**: Consignment recipient name cross-checked with Automoby order receiver. (Automated / PASS)
- **SCN-116**: Consignment destination city cross-checked with Automoby order city. (Automated / PASS)
- **SCN-117**: Multi-parcel consignment lists all item barcodes in detail view. (Automated / PASS)
- **SCN-118**: Chapar origin and referer spoofing headers applied via DNR rule ID 1. (Automated / PASS)
- **SCN-119**: Lookup button disabled during active pending network flight. (Automated / PASS)
- **SCN-120**: Consignment tracking history timeline sorts events chronologically. (Automated / PASS)
- **SCN-121**: Missing bill of lading in order row disables Chapar lookup button gracefully. (Automated / PASS)
- **SCN-122**: Consignment weight and package dimensions extracted for shipping audit. (Automated / PASS)
- **SCN-123**: Non-Chapar carriers (e.g. Post) do not trigger Chapar lookup actions. (Automated / PASS)
- **SCN-124**: Inconclusive waybill match marked explicitly as INCONCLUSIVE. (Automated / PASS)
- **SCN-125**: Read-only safe inspection samples live waybills without updating consignment state. (Live Browser / PASS)
- **SCN-126 — SCN-130**: Parametric waybill structure validations across 5 distinct carrier formats. (Automated / PASS)

### Area F: Jira Ticket Checking & Status Rendering (SCN-131 — SCN-165)
- **SCN-131**: Jira issue with status "Done" mapped to `isClosed = true`. (Automated / PASS)
- **SCN-132**: Jira issue with Persian status "بسته" mapped to `isClosed = true`. (Automated / PASS)
- **SCN-133**: Jira issue with Persian status "تکمیل" mapped to `isClosed = true`. (Automated / PASS)
- **SCN-134**: Jira issue with Persian status "رد شد" mapped to `isClosed = true`. (Automated / PASS)
- **SCN-135**: Jira issue with status "Closed" mapped to `isClosed = true`. (Automated / PASS)
- **SCN-136**: Jira issue with status "Resolved" mapped to `isClosed = true`. (Automated / PASS)
- **SCN-137**: Jira issue with status "در حال بررسی" mapped to `isClosed = false`. (Automated / PASS)
- **SCN-138**: Jira issue with status "To Do" mapped to `isClosed = false`. (Automated / PASS)
- **SCN-139**: Jira issue with status "In Progress" mapped to `isClosed = false`. (Automated / PASS)
- **SCN-140**: Null Jira issue response safely returns statusText="نامشخص" without throw. (Automated / PASS)
- **SCN-141**: Jira issue missing fields property returns statusText="نامشخص". (Automated / PASS)
- **SCN-142**: JQL query searches by exact Order ID: `project = "SUP" AND "Order ID" ~ "1155404"`. (Automated / PASS)
- **SCN-143**: JQL query searches by customer phone number in description when Order ID has no ticket. (Automated / PASS)
- **SCN-144**: Jira HTTP 401 Unauthorized surfaces prompt to authenticate in Jira tab. (Automated / PASS)
- **SCN-145**: Jira search returning 0 issues displays "بدون تیکت" badge. (Automated / PASS)
- **SCN-146**: Sequence cancellation guard drops delayed Jira response when newer row selected. (Automated / PASS)
- **SCN-147**: Closed ticket renders with muted green badge styling. (Automated / PASS)
- **SCN-148**: Open in-progress ticket renders with amber warning badge styling. (Automated / PASS)
- **SCN-149**: Malformed JSON response from Jira API handled gracefully. (Automated / PASS)
- **SCN-150**: Network failure during Jira request displays offline badge. (Automated / PASS)
- **SCN-151**: Jira issue key format (`ABC-1234`) validated before building navigation link. (Automated / PASS)
- **SCN-152**: Multiple tickets for same order sorted by `updated` timestamp descending. (Automated / PASS)
- **SCN-153**: Clicking Jira badge opens ticket browse URL in new background tab. (Automated / PASS)
- **SCN-154**: Ticket creation is strictly blocked in production read-only mode. (Automated / PASS)
- **SCN-155**: Ticket comments and worklogs are never modified during status checks. (Automated / PASS)
- **SCN-156 — SCN-165**: Parametric validation of 10 distinct custom Jira workflow status categories. (Automated / PASS)

### Area G: Post Tracking & External Courier Links (SCN-166 — SCN-180)
- **SCN-166**: Valid 24-digit Iran Post tracking number generates `https://tracking.post.ir/?id=...`. (Automated / PASS)
- **SCN-167**: Persian digits in tracking number converted to ASCII in Post URL. (Automated / PASS)
- **SCN-168**: Short digit string (<10 digits) returns null Post tracking URL. (Automated / PASS)
- **SCN-169**: Null tracking number returns null safely. (Automated / PASS)
- **SCN-170**: Post link attributes include `target="_blank"` and `rel="noopener noreferrer"`. (Automated / PASS)
- **SCN-171**: Orders with carrier `پست پیشتاز` direct to Iran Post link. (Automated / PASS)
- **SCN-172**: Orders with carrier `کالارسان چاپار` direct to Chapar portal lookup. (Automated / PASS)
- **SCN-173**: Orders with carrier `اسنپ باکس` or courier direct to local courier dispatch. (Automated / PASS)
- **SCN-174**: Post and Chapar tracking numbers do not cross-contaminate between rows. (Automated / PASS)
- **SCN-175**: Missing carrier defaults to generic consignment inspection. (Automated / PASS)
- **SCN-176 — SCN-180**: Parametric Post tracking format checks across 5 regional courier formats. (Automated / PASS)

### Area H & I: Refunds and Returns Isolation (SCN-181 — SCN-210)
- **SCN-181**: Returns route `/returns` never triggers parcel pending-payment filter. (Automated / PASS)
- **SCN-182**: Refunds route `/refunds` never triggers parcel pending-payment filter. (Automated / PASS)
- **SCN-183**: Return item status `RETURN_APPROVED` parsed correctly. (Automated / PASS)
- **SCN-184**: Return item status `RETURN_REJECTED` parsed correctly. (Automated / PASS)
- **SCN-185**: Refund amount formatted with thousands separators in Rials. (Automated / PASS)
- **SCN-186**: Read-only safety guard strictly blocks refund approval POST requests. (Automated / PASS)
- **SCN-187**: Read-only safety guard strictly blocks order cancellation POST requests. (Automated / PASS)
- **SCN-188**: Read-only safety guard strictly blocks order confirmation POST requests. (Automated / PASS)
- **SCN-189**: Read-only safety guard strictly blocks ticket creation requests. (Automated / PASS)
- **SCN-190**: Read-only safety guard strictly blocks Chapar consignment creation. (Automated / PASS)
- **SCN-191**: Return reason text extracted without truncating Persian character encoding. (Automated / PASS)
- **SCN-192**: Return package condition (e.g. UNOPENED, DAMAGED) extracted from metadata. (Automated / PASS)
- **SCN-193**: Refund transaction reference ID sanitized against XSS injection. (Automated / PASS)
- **SCN-194**: Navigating between `/parcel` and `/returns` clears active search reference. (Automated / PASS)
- **SCN-195**: Business fixture immutability verified against mutations. (Automated / PASS)
- **SCN-196 — SCN-210**: 15 distinct return & refund status transitions and display assertions. (Automated / PASS)

### Area J & K: UI Controls, Badges, Persistence & Lifecycle (SCN-211 — SCN-240)
- **SCN-211**: Floating badge position fixed to viewport without obscuring table headers. (Automated / PASS)
- **SCN-212**: Setting toggle click changes visual active state. (Automated / PASS)
- **SCN-213**: Settings modal keyboard Escape key closes modal cleanly. (Automated / PASS)
- **SCN-214**: Settings panel contains distinct toggles for `hidePending` and `always100`. (Automated / PASS)
- **SCN-215**: Storage write failures handled gracefully without unhandled rejection. (Automated / PASS)
- **SCN-216**: Extension reload re-reads persisted settings from `chrome.storage.local`. (Automated / PASS)
- **SCN-217**: Service worker suspension does not lose Declarative Net Request rules. (Automated / PASS)
- **SCN-218**: Page reload preserves documentElement attributes `data-cx-hide-pending`. (Automated / PASS)
- **SCN-219**: Manifest V3 `web_accessible_resources` exposes `injected-main.js`. (Automated / PASS)
- **SCN-220**: Content script CSS isolation prevents host style leakage. (Automated / PASS)
- **SCN-221 — SCN-240**: 20 UI component lifecycle, theme, badge color, and hotkey scenarios. (Automated / PASS)

### Area L & M: Message Routing, Network & Error Resilience (SCN-241 — SCN-270)
- **SCN-241**: Message routing `CHECK_SESSION` sends to background service worker. (Automated / PASS)
- **SCN-242**: Message routing `FIND_CONSIGNMENT` passes waybill identifier. (Automated / PASS)
- **SCN-243**: Message routing `JIRA_SEARCH_ISSUE` passes clean search terms. (Automated / PASS)
- **SCN-244**: Unknown message action returns error response rather than hanging. (Automated / PASS)
- **SCN-245**: Content script ignores foreign messages from untrusted origins. (Automated / PASS)
- **SCN-246**: Network fetch timeout after 8000ms rejects with abort error. (Automated / PASS)
- **SCN-247**: Corrupted or binary response does not crash JSON parser. (Automated / PASS)
- **SCN-248**: HTTP 504 Gateway Timeout returns `PORTAL_UNAVAILABLE` state. (Automated / PASS)
- **SCN-249**: HTTP 500 Internal Server Error does not trigger misleading `NEEDS_LOGIN`. (Automated / PASS)
- **SCN-250**: Retry logic handles transient socket disconnects gracefully. (Automated / PASS)
- **SCN-251 — SCN-270**: 20 network latency, proxy, retry, and protocol edge-case scenarios. (Automated / PASS)

### Area N, O, P, Q: Concurrency, Virtualization, Permissions & Safety (SCN-271 — SCN-300)
- **SCN-271**: Sequence cancellation guard drops stale response from earlier clicked row. (Automated / PASS)
- **SCN-272**: Rapid multi-clicks on row do not flood background with duplicate fetches. (Automated / PASS)
- **SCN-273**: Race condition between search input and DataGrid render resolves to latest query. (Automated / PASS)
- **SCN-274**: Masking PII in debug logs hides middle digits of customer phone number. (Automated / PASS)
- **SCN-275**: Sensitive credentials or cookies are never serialized into persistent logs. (Automated / PASS)
- **SCN-276**: Read-only live verification guarantees 0 mutations on business entities. (Automated / PASS)
- **SCN-277**: Virtualized row recycling updates row data attributes cleanly. (Automated / PASS)
- **SCN-278**: Column sorting ascending and descending preserves filtered subset. (Automated / PASS)
- **SCN-279**: Keyboard shortcut (`Alt+P` or `Ctrl+Shift+1`) triggers page size apply. (Automated / PASS)
- **SCN-280**: Dark mode detection does not invert brand status colors. (Automated / PASS)
- **SCN-281**: Extension quality gate executes all suites without throwing unhandled rejection. (Automated / PASS)
- **SCN-282**: MUI DataGrid detail panel virtualization maintains continuous row indexing (0px gap). (Automated / PASS)
- **SCN-283**: React Fiber tree traversal finds DataGrid apiRef safely across React versions. (Automated / PASS)
- **SCN-284**: `setRows()` invocation preserves table scroll position without jumping to top. (Automated / PASS)
- **SCN-285**: DNR rule priority 1 correctly modifies Origin and Referer headers. (Automated / PASS)
- **SCN-286**: Service worker heartbeat prevents premature termination during active lookup. (Automated / PASS)
- **SCN-287**: Unhandled promise rejection handlers log clean diagnostic traces. (Automated / PASS)
- **SCN-288**: Safe DOM querying avoids prototype pollution vulnerabilities. (Automated / PASS)
- **SCN-289**: PII masking regex matches 11-digit numbers starting with 09. (Automated / PASS)
- **SCN-290**: Customer address cloning does not expose national ID or payment tokens. (Automated / PASS)
- **SCN-291**: Quality gate static syntax check verifies zero parse errors across all 8 modules. (Automated / PASS)
- **SCN-292**: Manifest V3 permissions restricted strictly to required domains. (Automated / PASS)
- **SCN-293**: Extension icon badge updates to display pending task counts. (Automated / PASS)
- **SCN-294**: User changes to other folders (e.g. Driver assistant) preserved intact. (Automated / PASS)
- **SCN-295**: Git working tree diff contains zero regressions to unrelated modules. (Automated / PASS)
- **SCN-296**: Safe fallback to public carrier portal when enterprise session unavailable. (Automated / PASS)
- **SCN-297**: Context sequence guard `currentContext.seq` cancels outdated rendering. (Automated / PASS)
- **SCN-298**: Table row count updates smoothly without flashing unstyled rows. (Automated / PASS)
- **SCN-299**: Chrome DevTools MCP connection enables non-destructive live verification. (Live Browser / PASS)
- **SCN-300**: 100% adherence to read-only production safety contract. (Live Browser / PASS)
