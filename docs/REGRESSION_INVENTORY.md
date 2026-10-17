# Delivery Assistant — Permanent Regression Inventory

This inventory establishes the permanent traceability matrix between extension features, behavioral contracts, historical/reproduced defects, regression tests, responsible source modules, and quality-gate verification commands.

| Feature Area | Behavioral Contract | Defect ID / Description | Source Modules | Regression Test File | Quality Gate Command | Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Phone Number Extraction** | Contract A, B | **DEF-01**: Missing phone replaced with stale cache via `data-rowindex` collision on pagination/sort. | `content.js` | `tests/phone-extraction-and-association.test.mjs` | `node --test tests/phone-extraction-and-association.test.mjs` | PROTECTED |
| **Phone Normalization** | Contract B | **DEF-02**: Non-phone strings (city name, order ID, Persian text) accepted as valid phone number. | `content.js`, `injected-main.js` | `tests/phone-extraction-and-association.test.mjs` | `node --test tests/phone-extraction-and-association.test.mjs` | PROTECTED |
| **Row Association & Virtualization** | Contract A, G | **DEF-03**: Horizontal scroll virtualization causing blank extraction; multi-fragment row mismatch. | `injected-main.js`, `content.js` | `tests/phone-extraction-and-association.test.mjs`, `tests/surgical-fixes-v19.test.mjs` | `node --test tests/*.test.mjs` | PROTECTED |
| **Chapar Session Detection** | Contract D | **DEF-04**: Open Chapar tab content script timeout causing premature `allTabsAreLogin` and false `NEEDS_LOGIN`. | `background.js`, `chapar-portal.js` | `tests/chapar-auth-session-scenarios.test.mjs` | `node --test tests/chapar-auth-session-scenarios.test.mjs` | PROTECTED |
| **Chapar Idle Lock Form** | Contract D | **DEF-05**: Background `frm_IDLELogin` modal causing false positive login detection on active employee session. | `chapar-portal.js`, `background.js` | `tests/chapar-auth-detection.test.mjs`, `tests/chapar-auth-session-scenarios.test.mjs` | `node --test tests/*.test.mjs` | PROTECTED |
| **Flexigrid Empty Result** | Contract D, I | **DEF-06**: Empty Flexigrid JSON `{page:1,total:0,rows:[]}` misclassified as `AUTHENTICATED` or `NEEDS_LOGIN`. | `background.js` | `tests/chapar-auth-detection.test.mjs`, `tests/chapar-lookup-flow.test.mjs` | `node --test tests/*.test.mjs` | PROTECTED |
| **Chapar Waybill Routing** | Contract C | **DEF-07**: Iran Post barcodes starting with 54/64 misrouted to Chapar instead of Post. | `content.js` | `tests/surgical-fixes-v19.test.mjs` | `node --test tests/surgical-fixes-v19.test.mjs` | PROTECTED |
| **Phone Search Contamination** | Contract C | **DEF-08**: Customer phone lookup displaying older historical waybills instead of the active order's waybill. | `background.js` | `tests/surgical-fixes-v19.test.mjs`, `tests/chapar-lookup-flow.test.mjs` | `node --test tests/*.test.mjs` | PROTECTED |
| **Pending Payment Preservation** | Contract F | **DEF-09**: Setting enabled removed ALL pending orders instead of preserving exactly 1 eligible pending record for active search reference. | `injected-main.js`, `content.js` | `tests/pending-payment-preservation.test.mjs`, `tests/settings-filtering-regression.test.mjs` | `node --test tests/pending-payment-preservation.test.mjs` | PROTECTED |
| **Hide Pending Critical Failure** | Contract F | **DEF-16**: Combobox selector collision (`:r3n:`) and grouping fallback on empty search preserved all pending rows, making toggle nonfunctional. Fixed with non-combobox detection and zero-pending contract on empty search. | `injected-main.js` | `tests/pending-payment-critical-regression.test.mjs` | `node --test tests/pending-payment-critical-regression.test.mjs` | PROTECTED |
| **Detail Panel Gap (0px)** | Contract F | **DEF-10**: Legacy DOM CSS `display:none` causing 10-25cm blank virtualization gap before detail panel. | `injected-main.js` | `tests/settings-filtering-regression.test.mjs`, `tests/pending-payment-preservation.test.mjs` | `node --test tests/*.test.mjs` | PROTECTED |
| **Jira Authentication & Lookup** | Contract E, H | **DEF-11**: Jira login redirects not detected as `AUTH_REQUIRED`; login button missing from error states. | `background.js`, `content.js` | `tests/jira-integration-regression.test.mjs`, `tests/chapar-jira-ui-parity.test.mjs` | `node --test tests/*.test.mjs` | PROTECTED |
| **Stale Asynchronous Results** | Contract G | **DEF-12**: Rapid row selection allowed delayed responses from row A to overwrite UI of row B. | `content.js`, `background.js` | `tests/chapar-lookup-flow.test.mjs`, `tests/phone-extraction-and-association.test.mjs` | `node --test tests/*.test.mjs` | PROTECTED |
| **GraphQL Error Handling** | Contract H, I | **DEF-13**: HTTP 401 or GraphQL errors payload misreported as "فاقد مرجوعی" and cached. | `shortcuts.js` | `tests/surgical-fixes-v19.test.mjs` | `node --test tests/surgical-fixes-v19.test.mjs` | PROTECTED |
| **Route Typo Resilience** | Contract H | **DEF-14**: Navigation broken on `/commnets/` URL typos in Automoby. | `shortcuts.js` | `tests/surgical-fixes-v19.test.mjs` | `node --test tests/surgical-fixes-v19.test.mjs` | PROTECTED |
| **Native Bridge & Startup Coalescing** | Contract H | **DEF-15**: Concurrent startup triggers spawning duplicate native messaging bridge instances. | `background.js` | `tests/surgical-fixes-v19.test.mjs` | `node --test tests/surgical-fixes-v19.test.mjs` | PROTECTED |

---

## Quality Gate Execution

```bash
# Run all automated tests (unit, integration, fixture, regression)
node --test tests/*.test.mjs

# Run full quality gate with syntax validation and classification
node tests/quality-gate.mjs
```
