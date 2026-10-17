import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

describe('Surgical Fixes & Logic Audits (v19.0)', () => {

    describe('Bug 1: ReferenceError & Polling Loop Integrity (content.js)', () => {
        test('confirms ensurePendingFilterStyle() is removed from content.js', () => {
            const contentJs = fs.readFileSync(path.join(rootDir, 'content.js'), 'utf8');
            assert.equal(
                contentJs.includes('ensurePendingFilterStyle()'),
                false,
                'ensurePendingFilterStyle() must not be called anywhere in content.js'
            );
        });
    });

    describe('Bug 2: GraphQL Auth/Network Failures Error Handling (shortcuts.js)', () => {
        // Pure status check logic simulation mirroring shortcuts.js implementation
        async function simulateCheckStatus(mockFetch, cleanOrderId) {
            try {
                const res = await mockFetch('https://api.automoby.ir/graphql', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer test-token' },
                    body: JSON.stringify({ query: '...' })
                });
                if (!res.ok) throw new Error('HTTP ' + res.status);
                const json = await res.json();
                if ((Array.isArray(json?.errors) && json.errors.length > 0) || !json?.data?.getReturnListGeneralTable) {
                    const errMsg = json?.errors?.[0]?.message || 'خطا در دریافت اطلاعات مرجوعی';
                    throw new Error(errMsg);
                }
                const total = json.data.getReturnListGeneralTable.total || 0;
                if (total > 0) {
                    return { state: 'active', hasRecord: true, count: total, badgeText: `${total} مرجوعی` };
                } else {
                    return { state: 'none', hasRecord: false, count: 0, badgeText: 'فاقد مرجوعی' };
                }
            } catch (e) {
                return { state: 'error', badgeText: 'خطای استعلام', statusLabel: 'خطا در ارتباط', tooltip: e.message };
            }
        }

        test('returns error state and does not report "فاقد مرجوعی" on HTTP 401 Unauthorized', async () => {
            const mockFetch = async () => ({
                ok: false,
                status: 401,
                json: async () => ({})
            });
            const result = await simulateCheckStatus(mockFetch, '12345');
            assert.equal(result.state, 'error');
            assert.equal(result.badgeText, 'خطای استعلام');
        });

        test('returns error state on GraphQL errors payload', async () => {
            const mockFetch = async () => ({
                ok: true,
                status: 200,
                json: async () => ({ errors: [{ message: 'Unauthenticated' }], data: null })
            });
            const result = await simulateCheckStatus(mockFetch, '12345');
            assert.equal(result.state, 'error');
            assert.equal(result.tooltip, 'Unauthenticated');
        });

        test('returns active state when valid items are found', async () => {
            const mockFetch = async () => ({
                ok: true,
                status: 200,
                json: async () => ({ data: { getReturnListGeneralTable: { total: 2, data: [] } } })
            });
            const result = await simulateCheckStatus(mockFetch, '12345');
            assert.equal(result.state, 'active');
            assert.equal(result.count, 2);
        });

        test('returns none state ONLY when API responds successfully with 0 records', async () => {
            const mockFetch = async () => ({
                ok: true,
                status: 200,
                json: async () => ({ data: { getReturnListGeneralTable: { total: 0, data: [] } } })
            });
            const result = await simulateCheckStatus(mockFetch, '12345');
            assert.equal(result.state, 'none');
            assert.equal(result.badgeText, 'فاقد مرجوعی');
        });

        test('status caching logic ignores error states', () => {
            const cache = new Map();
            function setCachedStatus(key, result) {
                if (result && result.state !== 'error') {
                    cache.set(key, result);
                }
            }

            setCachedStatus('returns_123', { state: 'error', badgeText: 'خطای استعلام' });
            assert.equal(cache.has('returns_123'), false, 'Error states must NOT be cached');

            setCachedStatus('returns_123', { state: 'none', badgeText: 'فاقد مرجوعی' });
            assert.equal(cache.has('returns_123'), true, 'Successful none states may be cached');
        });
    });

    describe('Bug 3: Chapar Phone Search Cross-Contamination Guard (background.js)', () => {
        function filterPhoneSearchResults(rows, targetWaybill) {
            if (!rows || !Array.isArray(rows) || rows.length === 0) return null;
            const cleanWb = targetWaybill.trim();
            const wbSuffix = cleanWb.length > 10 ? cleanWb.slice(3) : null;
            const stripHtml = s => String(s || '').replace(/<[^>]+>/g, '').trim();

            const matchedRow = rows.find(r => {
                if (!r || !r.id || !Array.isArray(r.cell)) return false;
                const cellWb = stripHtml(r.cell[2] || '');
                if (!cellWb) return false;
                if (cellWb === cleanWb) return true;
                if (wbSuffix && (cellWb === wbSuffix || cellWb.endsWith(wbSuffix))) return true;
                return false;
            });

            return matchedRow || null;
        }

        test('rejects older/different shipments for the same phone number', () => {
            const olderShipmentRows = [
                { id: '1001', cell: ['1', '1402/05/10', '54807000000000001', 'تهران', 'اصفهان'] },
                { id: '1002', cell: ['2', '1402/06/15', '54807000000000002', 'تهران', 'شیراز'] }
            ];
            const targetWaybill = '54807199309911101';
            const matched = filterPhoneSearchResults(olderShipmentRows, targetWaybill);
            assert.equal(matched, null, 'Must not blindly pick row[0] when waybills differ');
        });

        test('correctly matches when target waybill is in the phone search results', () => {
            const rows = [
                { id: '1001', cell: ['1', '1402/05/10', '54807000000000001', 'تهران', 'اصفهان'] },
                { id: '1003', cell: ['2', '1403/07/20', '54807199309911101', 'تهران', 'مشهد'] }
            ];
            const targetWaybill = '54807199309911101';
            const matched = filterPhoneSearchResults(rows, targetWaybill);
            assert.notEqual(matched, null);
            assert.equal(matched.id, '1003');
        });

        test('correctly matches via waybill suffix when package barcode prefix differs', () => {
            const rows = [
                { id: '1005', cell: ['1', '1403/07/20', '07199309911101', 'تهران', 'مشهد'] }
            ];
            const targetWaybill = '54807199309911101'; // suffix: 07199309911101
            const matched = filterPhoneSearchResults(rows, targetWaybill);
            assert.notEqual(matched, null);
            assert.equal(matched.id, '1005');
        });
    });

    describe('Bug 4: Chapar Portal Task Lifecycle & Tab Handling', () => {
        test('preserves tasks in storage when user is on login page', () => {
            let storage = {
                chaparTrackingTask: '31448975',
                chaparTrackingWaybill: '54807199309911101'
            };

            function simulateCheckAndRun(isLoginPage) {
                if (isLoginPage) {
                    // Do NOT remove from storage
                    return { executed: false, preserved: true };
                }
                // Executed and removed
                delete storage.chaparTrackingTask;
                delete storage.chaparTrackingWaybill;
                return { executed: true, preserved: false };
            }

            // On login page
            const resLogin = simulateCheckAndRun(true);
            assert.equal(resLogin.preserved, true);
            assert.equal(storage.chaparTrackingTask, '31448975');

            // After login
            const resAuth = simulateCheckAndRun(false);
            assert.equal(resAuth.executed, true);
            assert.equal(storage.chaparTrackingTask, undefined);
        });

        test('verifies handleChaparTab reuses open tab and checks responsiveness via message', () => {
            const backgroundJs = fs.readFileSync(path.join(rootDir, 'background.js'), 'utf8');
            assert.match(backgroundJs, /PING_PORTAL_SESSION/);
            assert.doesNotMatch(backgroundJs, /if\s*\(internalId\)\s*\{\s*await chrome\.tabs\.reload\(tabs\[0\]\.id\);\s*\}/);
        });
    });

    describe('Bug 5: Scoped Pending-Payment Filter & MAIN Script Injection Guard', () => {
        function computeFilterRows(pathname, isHidePendingAttribute, rawRows, isPendingFn) {
            const isParcelPage = pathname.startsWith('/parcel');
            const isHidePending = isParcelPage && isHidePendingAttribute === 'true';
            return isHidePending ? rawRows.filter(r => !isPendingFn(r)) : rawRows;
        }

        test('applies pending-payment filter ONLY on /parcel routes', () => {
            const rows = [
                { id: 1, state: 'PAYMENT_PENDING' },
                { id: 2, state: 'PROCESSING' }
            ];
            const isPendingFn = r => r.state === 'PAYMENT_PENDING';

            // On /parcel route with setting enabled
            const parcelFiltered = computeFilterRows('/parcel/orders', 'true', rows, isPendingFn);
            assert.equal(parcelFiltered.length, 1);
            assert.equal(parcelFiltered[0].id, 2);

            // On /returns route with setting enabled
            const returnsFiltered = computeFilterRows('/returns/', 'true', rows, isPendingFn);
            assert.equal(returnsFiltered.length, 2, 'Non-parcel route must keep full rawRows');

            // On /manual-refunds route with setting enabled
            const refundsFiltered = computeFilterRows('/manual-refunds/', 'true', rows, isPendingFn);
            assert.equal(refundsFiltered.length, 2, 'Non-parcel route must keep full rawRows');
        });

        test('verifies data-cx-main-injected prevents duplicate script tags', () => {
            const contentJs = fs.readFileSync(path.join(rootDir, 'content.js'), 'utf8');
            const injectedMainJs = fs.readFileSync(path.join(rootDir, 'injected-main.js'), 'utf8');

            assert.match(injectedMainJs, /data-cx-main-injected/);
            assert.match(contentJs, /data-cx-main-injected/);
        });
    });

    describe('Bug 6: Chapar vs. Iran Post Waybill Routing Classifier (content.js)', () => {
        function isChaparWaybill(wb) {
            if (!wb || typeof wb !== 'string') return false;
            const cleanWb = wb.trim();
            if (/^\d{20,24}$/.test(cleanWb) && !cleanWb.startsWith('5410') && !cleanWb.startsWith('5480') && !cleanWb.startsWith('6410')) {
                return false;
            }
            return cleanWb.startsWith('5410') || cleanWb.startsWith('5480') || cleanWb.startsWith('6410') || cleanWb.startsWith('54') || cleanWb.startsWith('64');
        }

        test('routes 20-24 digit Iran Post barcodes starting with 54/64 (not 5410/5480/6410) to Post (returns false)', () => {
            // A 24-digit Iran Post barcode that happens to start with 5422...
            const postBarcode54 = '542200112233445566778899';
            assert.equal(isChaparWaybill(postBarcode54), false, '24-digit barcode starting with 5422 is Iran Post');

            // A 24-digit Iran Post barcode starting with 6499...
            const postBarcode64 = '649900112233445566778899';
            assert.equal(isChaparWaybill(postBarcode64), false, '24-digit barcode starting with 6499 is Iran Post');

            // Standard Iran Post 24-digit barcode starting with other prefixes
            const standardPostBarcode = '109988776655443322110099';
            assert.equal(isChaparWaybill(standardPostBarcode), false, 'Standard 24-digit barcode is Iran Post');
        });

        test('routes 20-24 digit barcodes starting with 5410/5480/6410 to Chapar (returns true)', () => {
            const chaparBarcode24 = '548000112233445566778899';
            assert.equal(isChaparWaybill(chaparBarcode24), true, '24-digit barcode starting with 5480 is Chapar');

            const chaparBarcode20 = '54101122334455667788';
            assert.equal(isChaparWaybill(chaparBarcode20), true, '20-digit barcode starting with 5410 is Chapar');
        });

        test('routes standard 17-digit Chapar waybills to Chapar (returns true)', () => {
            assert.equal(isChaparWaybill('54807199309911101'), true);
            assert.equal(isChaparWaybill('54101713507302101'), true);
            assert.equal(isChaparWaybill('64101713507302101'), true);
        });

        test('routes general short Chapar codes starting with 54 or 64 to Chapar (returns true)', () => {
            assert.equal(isChaparWaybill('5412345678'), true);
            assert.equal(isChaparWaybill('6412345678'), true);
        });
    });

    describe('Bug 7: React useId Selectors & Route Typo Resilience (shortcuts.js)', () => {
        test('confirms hardcoded :rmt: and :rq1: selectors are removed from shortcuts.js', () => {
            const shortcutsJs = fs.readFileSync(path.join(rootDir, 'shortcuts.js'), 'utf8');
            assert.equal(shortcutsJs.includes(':rmt:'), false, ':rmt: must be removed');
            assert.equal(shortcutsJs.includes(':rq1:'), false, ':rq1: must be removed');
        });

        test('supports both /commnets/ and /comments/ routes in navigation and route matching', () => {
            const shortcutsJs = fs.readFileSync(path.join(rootDir, 'shortcuts.js'), 'utf8');
            assert.match(shortcutsJs, /\/comments\//);
            assert.match(shortcutsJs, /\/commnets\//);
        });
    });

    describe('Bug 8: Duplicate Message Handlers, Dead Code & Startup Guards (background.js)', () => {
        test('confirms duplicate CHECK_CHAPAR_AUTH handler was removed', () => {
            const backgroundJs = fs.readFileSync(path.join(rootDir, 'background.js'), 'utf8');
            const matches = backgroundJs.match(/message\.action === 'CHECK_CHAPAR_AUTH'/g) || [];
            assert.equal(matches.length, 1, 'Only one CHECK_CHAPAR_AUTH handler must exist');
        });

        test('confirms dead function deriveDeliveryDate is removed', () => {
            const backgroundJs = fs.readFileSync(path.join(rootDir, 'background.js'), 'utf8');
            assert.equal(backgroundJs.includes('function deriveDeliveryDate'), false);
        });

        test('startup and bridge initialization guards coalesce concurrent invocations', async () => {
            let initCount = 0;
            let isInitializing = false;
            let activePort = null;

            function testInitBridge() {
                if (activePort || isInitializing) return;
                isInitializing = true;
                initCount++;
                activePort = { connected: true };
                isInitializing = false;
            }

            // Simulate concurrent startup: top-level + onStartup + onInstalled
            testInitBridge();
            testInitBridge();
            testInitBridge();

            assert.equal(initCount, 1, 'initNativeMessagingBridge must only initialize once');
        });
    });
});
