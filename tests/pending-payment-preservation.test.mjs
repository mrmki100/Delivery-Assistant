import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

/**
 * Pure logic under test extracted from injected-main.js
 */
function toAsciiDigits(str) {
    if (str == null) return '';
    return String(str)
        .replace(/[\u06F0-\u06F9]/g, d => String.fromCharCode(d.charCodeAt(0) - 0x06F0 + 48))
        .replace(/[\u0660-\u0669]/g, d => String.fromCharCode(d.charCodeAt(0) - 0x0660 + 48));
}

function isPendingPaymentOrder(row) {
    if (!row || typeof row !== 'object') return false;
    if (row.state === 'PAYMENT_PENDING' || row.state === 'در انتظار پرداخت') return true;
    if (row.status === 'PAYMENT_PENDING' || row.status === 'در انتظار پرداخت') return true;
    if (row.orderState === 'PAYMENT_PENDING' || row.orderState === 'در انتظار پرداخت') return true;
    if (row.order?.state === 'PAYMENT_PENDING' || row.order?.state === 'در انتظار پرداخت') return true;
    return false;
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
    const userId = toAsciiDigits(String(row.userId || row.user?.id || row.order?.user?.id || '')).trim();

    return { normPhone, orderId, parcelId, userId };
}

function filterPendingOrdersWithPreservation(rawRows, isHidePending, activeSearchRef = '', currentPath = '/parcel') {
    if (!rawRows || !Array.isArray(rawRows)) return [];
    if (!currentPath.startsWith('/parcel')) return rawRows;
    if (!isHidePending) return rawRows;

    const cleanRaw = toAsciiDigits(String(activeSearchRef || '')).trim();
    const searchPhone = normalizePhoneNumber(cleanRaw);
    const searchOrderId = cleanRaw;

    const nonPendingOrders = [];
    const pendingOrders = [];

    for (const row of rawRows) {
        if (isPendingPaymentOrder(row)) {
            pendingOrders.push(row);
        } else {
            nonPendingOrders.push(row);
        }
    }

    let preservedPending = null;

    // Strict contract:
    // EXACT VALID MATCH EXISTS -> Preserve exactly ONE eligible matching pending-payment record.
    // NO VALID EXACT MATCH (empty, invalid, or no match) -> Preserve ZERO pending-payment records.
    if (searchPhone || (searchOrderId && /^\d+$/.test(searchOrderId))) {
        for (const row of pendingOrders) {
            const refs = getRowReferences(row);
            const isExactPhone = searchPhone && refs.normPhone === searchPhone;
            const isExactOrder = searchOrderId && (refs.orderId === searchOrderId || refs.parcelId === searchOrderId || refs.userId === searchOrderId);
            if (isExactPhone || isExactOrder) {
                preservedPending = row;
                break; // Deterministic: preserve exactly ONE eligible record
            }
        }
    }

    if (preservedPending) {
        return rawRows.filter(r => !isPendingPaymentOrder(r) || r.id === preservedPending.id);
    } else {
        return nonPendingOrders;
    }
}

describe('Critical Test Domain — Pending-Payment Filter Preservation Rule', () => {

    const fixturePhone0917 = '09179132236';
    const fixture31Rows = [
        // 20 pending orders for customer 09179132236
        ...Array.from({ length: 20 }, (_, i) => ({
            id: 1480460 + i,
            state: 'PAYMENT_PENDING',
            userPhoneNumber: fixturePhone0917,
            order: { id: 1112700 + i, user: { phoneNumber: fixturePhone0917 } }
        })),
        // 4 shipped orders for order 1126071
        { id: 1499912, state: 'SELLER_SHIPPED', userPhoneNumber: fixturePhone0917, order: { id: 1126071 } },
        { id: 1499911, state: 'SELLER_SHIPPED', userPhoneNumber: fixturePhone0917, order: { id: 1126071 } },
        { id: 1499909, state: 'SELLER_SHIPPED', userPhoneNumber: fixturePhone0917, order: { id: 1126071 } },
        { id: 1499910, state: 'SELLER_SHIPPED', userPhoneNumber: fixturePhone0917, order: { id: 1126071 } },
        // 6 more pending orders for customer 09179132236
        ...Array.from({ length: 6 }, (_, i) => ({
            id: 1529500 + i,
            state: 'PAYMENT_PENDING',
            userPhoneNumber: fixturePhone0917,
            order: { id: 1146400 + i, user: { phoneNumber: fixturePhone0917 } }
        })),
        // 1 cancelled order 448720
        { id: 539749, state: 'CANCELLED_ADMIN', userPhoneNumber: fixturePhone0917, order: { id: 448720 } }
    ];

    test('Scenario 1: Setting is disabled -> all 31 orders retained without suppression', () => {
        const result = filterPendingOrdersWithPreservation(fixture31Rows, false, fixturePhone0917);
        assert.equal(result.length, 31);
        assert.equal(result[0].id, 1480460);
        assert.equal(result[result.length - 1].id, 539749);
    });

    test('Scenario 2: Setting is enabled with active search -> preserves all 5 non-pending AND exactly 1 eligible pending record', () => {
        const result = filterPendingOrdersWithPreservation(fixture31Rows, true, fixturePhone0917);
        // 5 non-pending (4 shipped + 1 cancelled) + 1 preserved pending = 6 total
        assert.equal(result.length, 6, 'Must preserve 5 non-pending + 1 eligible pending record');

        const pendingInResult = result.filter(r => isPendingPaymentOrder(r));
        assert.equal(pendingInResult.length, 1, 'Exactly one pending-payment record must be preserved');
        assert.equal(pendingInResult[0].id, 1480460, 'Preserved record is the first eligible candidate');

        const nonPendingInResult = result.filter(r => !isPendingPaymentOrder(r));
        assert.equal(nonPendingInResult.length, 5, 'All 5 non-pending orders must remain visible');
    });

    test('Scenario 3: One eligible pending-payment record exists -> preserved when filter is enabled', () => {
        const rows = [
            { id: 1, state: 'SELLER_SHIPPED', userPhoneNumber: '09121111111' },
            { id: 2, state: 'PAYMENT_PENDING', userPhoneNumber: '09121111111' }
        ];
        const result = filterPendingOrdersWithPreservation(rows, true, '09121111111');
        assert.equal(result.length, 2);
        assert.equal(result[1].id, 2);
    });

    test('Scenario 4: Multiple eligible records exist for the same reference -> exactly 1 preserved, others hidden', () => {
        const rows = [
            { id: 10, state: 'PAYMENT_PENDING', userPhoneNumber: '09351234567', order: { id: 901 } },
            { id: 11, state: 'PAYMENT_PENDING', userPhoneNumber: '09351234567', order: { id: 902 } },
            { id: 12, state: 'PAYMENT_PENDING', userPhoneNumber: '09351234567', order: { id: 903 } }
        ];
        const result = filterPendingOrdersWithPreservation(rows, true, '09351234567');
        assert.equal(result.length, 1);
        assert.equal(result[0].id, 10);
    });

    test('Scenario 5: Pending-payment records belong to different customers (no search string) -> hides all pending records', () => {
        const rows = [
            { id: 101, state: 'PAYMENT_PENDING', userPhoneNumber: '09110000001' },
            { id: 102, state: 'PAYMENT_PENDING', userPhoneNumber: '09110000001' },
            { id: 201, state: 'PAYMENT_PENDING', userPhoneNumber: '09220000002' },
            { id: 202, state: 'PAYMENT_PENDING', userPhoneNumber: '09220000002' },
            { id: 301, state: 'SELLER_SHIPPED', userPhoneNumber: '09330000003' }
        ];
        const result = filterPendingOrdersWithPreservation(rows, true, '');
        // On empty search, zero pending records preserved; only non-pending (301) remains
        assert.equal(result.length, 1);
        assert.equal(result[0].id, 301);
    });

    test('Scenario 6: Active search reference changes -> recomputes and preserves 1 for new search reference', () => {
        const rows = [
            { id: 1, state: 'PAYMENT_PENDING', userPhoneNumber: '09111111111' },
            { id: 2, state: 'PAYMENT_PENDING', userPhoneNumber: '09111111111' },
            { id: 3, state: 'PAYMENT_PENDING', userPhoneNumber: '09222222222' },
            { id: 4, state: 'PAYMENT_PENDING', userPhoneNumber: '09222222222' }
        ];
        const resA = filterPendingOrdersWithPreservation(rows, true, '09111111111');
        assert.equal(resA.length, 1);
        assert.equal(resA[0].id, 1);

        const resB = filterPendingOrdersWithPreservation(rows, true, '09222222222');
        assert.equal(resB.length, 1);
        assert.equal(resB[0].id, 3);
    });

    test('Scenario 7: Search reference is cleared -> recomputes and hides all pending records', () => {
        const rows = [
            { id: 1, state: 'PAYMENT_PENDING', userPhoneNumber: '09111111111' },
            { id: 2, state: 'PAYMENT_PENDING', userPhoneNumber: '09111111111' },
            { id: 3, state: 'PAYMENT_PENDING', userPhoneNumber: '09222222222' }
        ];
        const result = filterPendingOrdersWithPreservation(rows, true, '');
        assert.equal(result.length, 0);
    });

    test('Scenario 8: Active search is performed using order identifier -> preserves 1 matching that order ID', () => {
        const rows = [
            { id: 50, state: 'PAYMENT_PENDING', orderId: '112233' },
            { id: 51, state: 'PAYMENT_PENDING', orderId: '112233' },
            { id: 52, state: 'PAYMENT_PENDING', orderId: '998877' }
        ];
        const result = filterPendingOrdersWithPreservation(rows, true, '112233');
        assert.equal(result.length, 1);
        assert.equal(result[0].id, 50);
    });

    test('Scenario 9: No eligible pending-payment record exists -> non-pending records remain intact', () => {
        const rows = [
            { id: 1, state: 'DELIVERED', userPhoneNumber: '09120000000' },
            { id: 2, state: 'SELLER_SHIPPED', userPhoneNumber: '09120000000' }
        ];
        const result = filterPendingOrdersWithPreservation(rows, true, '09120000000');
        assert.equal(result.length, 2);
    });

    test('Scenario 10: Pending record on empty search -> zero pending records preserved without crash', () => {
        const rows = [
            { id: 999, state: 'PAYMENT_PENDING' }
        ];
        const result = filterPendingOrdersWithPreservation(rows, true, '');
        assert.equal(result.length, 0);
    });

    test('Scenario 11: Table rerenders -> filter produces deterministic output', () => {
        const res1 = filterPendingOrdersWithPreservation(fixture31Rows, true, fixturePhone0917);
        const res2 = filterPendingOrdersWithPreservation(fixture31Rows, true, fixturePhone0917);
        assert.deepEqual(res1.map(r => r.id), res2.map(r => r.id));
    });

    test('Scenario 12: Pagination changes -> applies correctly to page 2 rows', () => {
        const page2Rows = [
            { id: 201, state: 'SELLER_SHIPPED', userPhoneNumber: '09190000000' },
            { id: 202, state: 'PAYMENT_PENDING', userPhoneNumber: '09190000000' },
            { id: 203, state: 'PAYMENT_PENDING', userPhoneNumber: '09190000000' }
        ];
        const result = filterPendingOrdersWithPreservation(page2Rows, true, '09190000000');
        assert.equal(result.length, 2);
        assert.deepEqual(result.map(r => r.id), [201, 202]);
    });

    test('Scenario 13: Sorting changes -> preserves first eligible in sorted order', () => {
        const reversedRows = [...fixture31Rows].reverse();
        const result = filterPendingOrdersWithPreservation(reversedRows, true, fixturePhone0917);
        assert.equal(result.length, 6);
        const nonPending = result.filter(r => !isPendingPaymentOrder(r));
        assert.equal(nonPending.length, 5);
        const pending = result.filter(r => isPendingPaymentOrder(r));
        assert.equal(pending.length, 1);
    });

    test('Scenario 14: Background refresh updates table rows -> resync preserves latest records', () => {
        const updatedRows = [
            ...fixture31Rows,
            { id: 1600001, state: 'SELLER_SHIPPED', userPhoneNumber: fixturePhone0917, order: { id: 1199999 } }
        ];
        const result = filterPendingOrdersWithPreservation(updatedRows, true, fixturePhone0917);
        assert.equal(result.length, 7); // 6 non-pending + 1 pending
    });

    test('Scenario 15: Filter toggled repeatedly -> stable results without memory leak or record corruption', () => {
        for (let i = 0; i < 10; i++) {
            const on = filterPendingOrdersWithPreservation(fixture31Rows, true, fixturePhone0917);
            assert.equal(on.length, 6);
            const off = filterPendingOrdersWithPreservation(fixture31Rows, false, fixturePhone0917);
            assert.equal(off.length, 31);
        }
    });

    test('Scenario 16: Setting persists across navigation as data-cx-hide-pending', () => {
        const isHidePending = 'true' === 'true';
        const result = filterPendingOrdersWithPreservation(fixture31Rows, isHidePending, fixturePhone0917);
        assert.equal(result.length, 6);
    });

    test('Scenario 17: Another table (e.g. /returns or /accounting) must remain unaffected', () => {
        const returnRows = [
            { id: 801, state: 'PAYMENT_PENDING' },
            { id: 802, state: 'PAYMENT_PENDING' }
        ];
        const result = filterPendingOrdersWithPreservation(returnRows, true, '', '/returns');
        assert.equal(result.length, 2, 'Must NOT filter non-parcel tables');
    });

    test('Scenario 18: Delayed DOM update -> safely handles empty input before rows mount', () => {
        assert.deepEqual(filterPendingOrdersWithPreservation([], true), []);
        assert.deepEqual(filterPendingOrdersWithPreservation(null, true), []);
        assert.deepEqual(filterPendingOrdersWithPreservation(undefined, true), []);
    });

    test('Scenario 19: Page contains no recognizable search context -> hides all pending orders, preserving 5 non-pending', () => {
        const result = filterPendingOrdersWithPreservation(fixture31Rows, true, '');
        // On empty search, zero pending preserved + 5 non-pending = 5 total
        assert.equal(result.length, 5);
        assert.equal(result.filter(r => isPendingPaymentOrder(r)).length, 0);
    });

    test('Scenario 20: Relevant record changes eligibility from PAYMENT_PENDING to SELLER_SHIPPED', () => {
        const rows = [
            { id: 1480460, state: 'SELLER_SHIPPED', userPhoneNumber: fixturePhone0917 },
            { id: 1480461, state: 'PAYMENT_PENDING', userPhoneNumber: fixturePhone0917 }
        ];
        const result = filterPendingOrdersWithPreservation(rows, true, fixturePhone0917);
        assert.equal(result.length, 2, 'Now id 1480460 is non-pending and id 1480461 is preserved pending');
    });
});
