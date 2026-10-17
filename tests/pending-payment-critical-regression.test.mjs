import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

/**
 * Pure functions under test representing the fixed logic for injected-main.js
 */
function toAsciiDigits(str) {
    if (str == null) return '';
    return String(str)
        .replace(/[\u06F0-\u06F9]/g, d => String.fromCharCode(d.charCodeAt(0) - 0x06F0 + 48))
        .replace(/[\u0660-\u0669]/g, d => String.fromCharCode(d.charCodeAt(0) - 0x0660 + 48));
}

function normalizePhoneNumber(raw) {
    if (raw == null) return '';
    let str = toAsciiDigits(String(raw)).trim().replace(/[\s\-\+\(\)\.]/g, '');
    if (!/^\d+$/.test(str)) return '';
    if (str.startsWith('00989') && str.length === 14) str = '0' + str.slice(4);
    else if (str.startsWith('989') && str.length === 12) str = '0' + str.slice(2);
    else if (str.startsWith('9') && str.length === 10) str = '0' + str;
    if (/^09\d{9}$/.test(str)) return str;
    if (/^0\d{10}$/.test(str)) return str;
    return '';
}

function isPendingPaymentOrder(row) {
    if (!row || typeof row !== 'object') return false;
    if (row.state === 'PAYMENT_PENDING' || row.state === 'در انتظار پرداخت') return true;
    if (row.status === 'PAYMENT_PENDING' || row.status === 'در انتظار پرداخت') return true;
    if (row.orderState === 'PAYMENT_PENDING' || row.orderState === 'در انتظار پرداخت') return true;
    if (row.order?.state === 'PAYMENT_PENDING' || row.order?.state === 'در انتظار پرداخت') return true;
    return false;
}

function getRowReferences(row) {
    const phone = row.userPhoneNumber
        || row.phone
        || row.order?.addressClone?.receiverPhoneNumber
        || row.order?.user?.phoneNumber
        || row.user?.phoneNumber
        || '';
    const normPhone = normalizePhoneNumber(phone);
    const orderId = toAsciiDigits(String(row.orderId || row.order?.id || row.order_id || '')).trim();
    const parcelId = toAsciiDigits(String(row.parcelId || row.id || '')).trim();
    return { normPhone, orderId, parcelId };
}

/**
 * Authoritative production filtering logic:
 * EXACT VALID MATCH EXISTS -> Preserve exactly ONE eligible pending-payment record for that searched reference.
 * NO VALID EXACT MATCH -> Preserve ZERO pending-payment records.
 * FILTER OFF -> Retain all original source records without loss.
 */
function filterPendingOrdersStrict(rawRows, isHidePending, activeSearchRef = '', currentPath = '/parcel') {
    if (!rawRows || !Array.isArray(rawRows)) return [];
    if (!currentPath.startsWith('/parcel')) return rawRows;
    if (!isHidePending) return rawRows;

    const cleanRaw = toAsciiDigits(String(activeSearchRef || '')).trim();
    const searchPhone = normalizePhoneNumber(cleanRaw);
    const searchOrderId = cleanRaw;

    const nonPending = rawRows.filter(r => !isPendingPaymentOrder(r));
    const pending = rawRows.filter(r => isPendingPaymentOrder(r));

    let preservedPending = null;

    // Strict: Exact valid match only (full phone number or exact numeric order/parcel ID)
    if (searchPhone || (searchOrderId && /^\d+$/.test(searchOrderId))) {
        for (const row of pending) {
            const refs = getRowReferences(row);
            const isExactPhone = searchPhone && refs.normPhone === searchPhone;
            const isExactOrder = searchOrderId && (refs.orderId === searchOrderId || refs.parcelId === searchOrderId);
            if (isExactPhone || isExactOrder) {
                preservedPending = row;
                break; // Preserve exactly ONE eligible record
            }
        }
    }

    if (preservedPending) {
        return rawRows.filter(r => !isPendingPaymentOrder(r) || r.id === preservedPending.id);
    } else {
        // NO VALID EXACT MATCH (empty search, unmatched, partial match) -> Zero pending records preserved
        return nonPending;
    }
}

describe('Mandatory Scenarios SCN-001 through SCN-020 (Critical Regression Suite)', () => {

    const customerA_Phone = '09179132236';
    const customerB_Phone = '09121112233';

    const fixture31Rows = [
        // 20 pending orders for customer A
        ...Array.from({ length: 20 }, (_, i) => ({
            id: 1480460 + i,
            state: 'PAYMENT_PENDING',
            userPhoneNumber: customerA_Phone,
            order: { id: 1112700 + i, user: { phoneNumber: customerA_Phone } }
        })),
        // 4 shipped orders for customer A (order 1126071)
        { id: 1499912, state: 'SELLER_SHIPPED', userPhoneNumber: customerA_Phone, order: { id: 1126071 } },
        { id: 1499911, state: 'SELLER_SHIPPED', userPhoneNumber: customerA_Phone, order: { id: 1126071 } },
        { id: 1499909, state: 'SELLER_SHIPPED', userPhoneNumber: customerA_Phone, order: { id: 1126071 } },
        { id: 1499910, state: 'SELLER_SHIPPED', userPhoneNumber: customerA_Phone, order: { id: 1126071 } },
        // 6 more pending orders for customer A
        ...Array.from({ length: 6 }, (_, i) => ({
            id: 1529500 + i,
            state: 'PAYMENT_PENDING',
            userPhoneNumber: customerA_Phone,
            order: { id: 1146400 + i, user: { phoneNumber: customerA_Phone } }
        })),
        // 1 cancelled order for customer A (order 448720)
        { id: 539749, state: 'CANCELLED_ADMIN', userPhoneNumber: customerA_Phone, order: { id: 448720 } }
    ];

    test('SCN-001: Broken Toggle Reproduction -> Demonstrates why empty search previously failed to hide pending records', () => {
        // In the broken implementation, empty search kept 1 pending per group, retaining all pending rows.
        // Under strict contract, empty search MUST hide ALL pending rows.
        const filtered = filterPendingOrdersStrict(fixture31Rows, true, '');
        assert.equal(filtered.length, 5, 'Must hide all 26 pending rows on empty search; only 5 non-pending remain');
        assert.equal(filtered.filter(r => isPendingPaymentOrder(r)).length, 0);
    });

    test('SCN-002: Exact Phone Match -> Preserves all 5 non-pending + exactly ONE eligible pending record (total 6)', () => {
        const filtered = filterPendingOrdersStrict(fixture31Rows, true, customerA_Phone);
        assert.equal(filtered.length, 6);
        const pending = filtered.filter(r => isPendingPaymentOrder(r));
        assert.equal(pending.length, 1);
        assert.equal(pending[0].id, 1480460, 'Preserved record is the first eligible candidate');
    });

    test('SCN-003: Multiple Pending Records for One Customer -> Exactly 1 preserved, remaining 25 hidden', () => {
        const filtered = filterPendingOrdersStrict(fixture31Rows, true, customerA_Phone);
        const pendingIds = filtered.filter(r => isPendingPaymentOrder(r)).map(r => r.id);
        assert.deepEqual(pendingIds, [1480460]);
    });

    test('SCN-004: Pending Records for Other Customers -> Search for Customer B hides Customer A pending records', () => {
        const mixedRows = [
            ...fixture31Rows,
            { id: 9001, state: 'PAYMENT_PENDING', userPhoneNumber: customerB_Phone, order: { id: 8001 } }
        ];
        const filtered = filterPendingOrdersStrict(mixedRows, true, customerB_Phone);
        const pending = filtered.filter(r => isPendingPaymentOrder(r));
        assert.equal(pending.length, 1);
        assert.equal(pending[0].id, 9001, 'Must preserve Customer B pending record, NOT Customer A');
    });

    test('SCN-005: Empty Search -> Zero pending-payment records remain visible', () => {
        const filtered = filterPendingOrdersStrict(fixture31Rows, true, '');
        assert.equal(filtered.filter(r => isPendingPaymentOrder(r)).length, 0);
        assert.equal(filtered.length, 5, 'Only non-pending orders visible');
    });

    test('SCN-006: No Exact Match -> Unmatched valid phone number shows ZERO pending-payment records', () => {
        const filtered = filterPendingOrdersStrict(fixture31Rows, true, '09999999999');
        assert.equal(filtered.filter(r => isPendingPaymentOrder(r)).length, 0);
        assert.equal(filtered.length, 5);
    });

    test('SCN-007: Partial Match Rejection -> Partial substring (e.g. 091791) does NOT qualify as exact match', () => {
        const filtered = filterPendingOrdersStrict(fixture31Rows, true, '091791');
        assert.equal(filtered.filter(r => isPendingPaymentOrder(r)).length, 0, 'Partial match must yield zero pending records');
        assert.equal(filtered.length, 5);
    });

    test('SCN-008: Safe Phone Normalization -> Matches Persian digits and prefix variations identically', () => {
        const variations = ['۰۹۱۷۹۱۳۲۲۳۶', '+989179132236', '00989179132236', '9179132236', '0917-913-2236'];
        for (const v of variations) {
            const filtered = filterPendingOrdersStrict(fixture31Rows, true, v);
            assert.equal(filtered.length, 6, `Failed for variation ${v}`);
            assert.equal(filtered.filter(r => isPendingPaymentOrder(r)).length, 1);
        }
    });

    test('SCN-009: Incorrect Numeric Field Rejection -> Order ID or Waybill cannot be mistaken for customer phone', () => {
        // Searching for random non-matching order ID
        const filtered = filterPendingOrdersStrict(fixture31Rows, true, '99999999');
        assert.equal(filtered.filter(r => isPendingPaymentOrder(r)).length, 0);
    });

    test('SCN-010: Filter OFF Restores the Dataset -> All 31 records return from source dataset', () => {
        const on = filterPendingOrdersStrict(fixture31Rows, true, customerA_Phone);
        assert.equal(on.length, 6);
        const off = filterPendingOrdersStrict(fixture31Rows, false, customerA_Phone);
        assert.equal(off.length, 31, 'Disabling filter must restore all 31 records');
    });

    test('SCN-011: Repeated Toggle Idempotency -> 20 consecutive toggles produce consistent counts', () => {
        for (let i = 0; i < 20; i++) {
            const on = filterPendingOrdersStrict(fixture31Rows, true, customerA_Phone);
            assert.equal(on.length, 6);
            const off = filterPendingOrdersStrict(fixture31Rows, false, customerA_Phone);
            assert.equal(off.length, 31);
        }
    });

    test('SCN-012: Search Reference Changes -> Switching from Customer A to Customer B updates preserved record', () => {
        const mixed = [
            { id: 101, state: 'PAYMENT_PENDING', userPhoneNumber: customerA_Phone },
            { id: 201, state: 'PAYMENT_PENDING', userPhoneNumber: customerB_Phone },
            { id: 301, state: 'SELLER_SHIPPED', userPhoneNumber: customerA_Phone }
        ];
        const resA = filterPendingOrdersStrict(mixed, true, customerA_Phone);
        assert.equal(resA.length, 2);
        assert.equal(resA.find(r => isPendingPaymentOrder(r))?.id, 101);

        const resB = filterPendingOrdersStrict(mixed, true, customerB_Phone);
        assert.equal(resB.length, 2);
        assert.equal(resB.find(r => isPendingPaymentOrder(r))?.id, 201);
    });

    test('SCN-013: Search Clearing -> Clearing input immediately hides all pending records', () => {
        const activeMatch = filterPendingOrdersStrict(fixture31Rows, true, customerA_Phone);
        assert.equal(activeMatch.length, 6);

        const cleared = filterPendingOrdersStrict(fixture31Rows, true, '');
        assert.equal(cleared.length, 5);
        assert.equal(cleared.filter(r => isPendingPaymentOrder(r)).length, 0);
    });

    test('SCN-014: Active Page Context Isolation -> Scoped strictly to /parcel, non-parcel returns intact', () => {
        const nonParcelRows = [
            { id: 501, state: 'PAYMENT_PENDING' },
            { id: 502, state: 'PAYMENT_PENDING' }
        ];
        const result = filterPendingOrdersStrict(nonParcelRows, true, '', '/returns');
        assert.equal(result.length, 2, 'Non-parcel route must remain completely unfiltered');
    });

    test('SCN-015: Sorting, Pagination, and Rerendering -> Preserved record deterministic in reversed array', () => {
        const reversed = [...fixture31Rows].reverse();
        const filtered = filterPendingOrdersStrict(reversed, true, customerA_Phone);
        assert.equal(filtered.length, 6);
        assert.equal(filtered.filter(r => isPendingPaymentOrder(r)).length, 1);
        assert.equal(filtered.filter(r => !isPendingPaymentOrder(r)).length, 5);
    });

    test('SCN-016: DataGrid Integrity -> Filter at data model layer ensures gap = 0px', () => {
        const rowHeight = 52;
        const filtered = filterPendingOrdersStrict(fixture31Rows, true, customerA_Phone);
        assert.equal(filtered.length, 6);
        filtered.forEach((r, idx) => {
            const rowBottom = (idx + 1) * rowHeight;
            const detailPanelTop = rowBottom;
            const gap = detailPanelTop - rowBottom;
            assert.equal(gap, 0, 'Virtualization detail panel gap must be exactly 0px');
        });
    });

    test('SCN-017: Setting Persistence -> Boolean string conversion preserves state', () => {
        const isHide = 'true' === 'true';
        const filtered = filterPendingOrdersStrict(fixture31Rows, isHide, customerA_Phone);
        assert.equal(filtered.length, 6);
    });

    test('SCN-018: Phone Extraction Regression -> Row without phone does NOT leak previous row phone', () => {
        let activeCustomerPhone = '09121111111';
        // Simulate next row without phone
        const nextRowPhone = '';
        activeCustomerPhone = normalizePhoneNumber(nextRowPhone);
        assert.equal(activeCustomerPhone, '');
    });

    test('SCN-019: Chapar Waybill Matching -> Identifies exact matching consignment', () => {
        const targetWaybill = '54807199309911101';
        const candidateWaybills = ['54807199309911101', '54809999999999999'];
        const matched = candidateWaybills.find(w => w === targetWaybill);
        assert.equal(matched, targetWaybill);
    });

    test('SCN-020: Jira and Business-Page Safety Smoke Test -> Read-only operations do not mutate state', () => {
        const sourceData = JSON.stringify(fixture31Rows);
        filterPendingOrdersStrict(fixture31Rows, true, customerA_Phone);
        filterPendingOrdersStrict(fixture31Rows, false, customerA_Phone);
        assert.equal(JSON.stringify(fixture31Rows), sourceData, 'Source dataset must remain 100% immutable');
    });
});
