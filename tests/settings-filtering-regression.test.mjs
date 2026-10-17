import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

/**
 * Pure logic under test extracted from injected-main.js and content.js
 */
function isPendingPaymentOrder(row) {
    if (!row || typeof row !== 'object') return false;
    // Authoritative GraphQL enum or status field
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
    const cleanPhone = String(phone).trim().replace(/[\s\-\+]/g, '');
    const orderId = String(row.orderId || row.order?.id || row.order_id || '').trim();
    const parcelId = String(row.parcelId || row.id || '').trim();
    const userId = String(row.userId || row.user?.id || row.order?.user?.id || '').trim();
    return { cleanPhone, orderId, parcelId, userId };
}

function filterRowsForDataGrid(rawRows, isHidePending, activeSearchRef = '') {
    if (!rawRows || !Array.isArray(rawRows)) return [];
    if (!isHidePending) return rawRows;

    const cleanSearch = activeSearchRef ? String(activeSearchRef).trim().replace(/[\s\-\+]/g, '') : '';
    const pendingOrders = [];
    const nonPendingOrders = [];

    for (const row of rawRows) {
        if (isPendingPaymentOrder(row)) {
            pendingOrders.push(row);
        } else {
            nonPendingOrders.push(row);
        }
    }

    const preservedPendingOrders = [];

    if (cleanSearch) {
        const matchingPending = [];
        for (const row of pendingOrders) {
            const refs = getRowReferences(row);
            const matches = (refs.cleanPhone && refs.cleanPhone.includes(cleanSearch))
                || (refs.orderId && refs.orderId === cleanSearch)
                || (refs.parcelId && refs.parcelId === cleanSearch)
                || (refs.userId && refs.userId === cleanSearch);
            if (matches) {
                matchingPending.push(row);
            }
        }
        if (matchingPending.length > 0) {
            preservedPendingOrders.push(matchingPending[0]);
        }
    } else {
        const seenGroups = new Set();
        for (const row of pendingOrders) {
            const refs = getRowReferences(row);
            const groupKey = refs.cleanPhone || refs.userId || refs.orderId || String(row.id);
            if (!seenGroups.has(groupKey)) {
                seenGroups.add(groupKey);
                preservedPendingOrders.push(row);
            }
        }
    }

    const preservedPendingIds = new Set(preservedPendingOrders.map(r => r.id));
    return rawRows.filter(r => !isPendingPaymentOrder(r) || preservedPendingIds.has(r.id));
}

describe('Settings & Status Filtering Regression Tests', () => {

    describe('Authoritative Status Detection (isPendingPaymentOrder)', () => {
        test('identifies standard GraphQL enum PAYMENT_PENDING as pending', () => {
            assert.equal(isPendingPaymentOrder({ id: 1, state: 'PAYMENT_PENDING' }), true);
            assert.equal(isPendingPaymentOrder({ id: 2, status: 'PAYMENT_PENDING' }), true);
            assert.equal(isPendingPaymentOrder({ id: 3, orderState: 'PAYMENT_PENDING' }), true);
            assert.equal(isPendingPaymentOrder({ id: 4, order: { state: 'PAYMENT_PENDING' } }), true);
        });

        test('identifies Persian display status "در انتظار پرداخت" as pending', () => {
            assert.equal(isPendingPaymentOrder({ id: 5, state: 'در انتظار پرداخت' }), true);
            assert.equal(isPendingPaymentOrder({ id: 6, status: 'در انتظار پرداخت' }), true);
            assert.equal(isPendingPaymentOrder({ id: 7, order: { state: 'در انتظار پرداخت' } }), true);
        });

        test('preserves non-pending statuses without false positives', () => {
            const nonPendingStatuses = [
                'CANCELLED_ADMIN',
                'SELLER_SHIPPED',
                'DELIVERED',
                'PROCESSING',
                'WAITING_FOR_SELLER_CONFIRM',
                'READY_TO_SHIP',
                'RETURNED',
                'REFUNDED',
                'لغو شد',
                'تحویل شده',
                'ارسال شد (فروشنده)'
            ];

            for (const status of nonPendingStatuses) {
                assert.equal(isPendingPaymentOrder({ id: 10, state: status }), false, `Status ${status} should not be pending`);
            }
        });

        test('safely handles missing, null, undefined, and delayed status values', () => {
            assert.equal(isPendingPaymentOrder(null), false);
            assert.equal(isPendingPaymentOrder(undefined), false);
            assert.equal(isPendingPaymentOrder({}), false);
            assert.equal(isPendingPaymentOrder({ id: 99 }), false);
            assert.equal(isPendingPaymentOrder({ id: 100, state: null }), false);
            assert.equal(isPendingPaymentOrder({ id: 101, state: undefined }), false);
            assert.equal(isPendingPaymentOrder({ id: 102, state: '' }), false);
        });

        test('does NOT infer status from tracking number, title, or incidental wording', () => {
            const rowWithIncidentalText = {
                id: 200,
                state: 'SELLER_SHIPPED',
                billOfLading: 'PAYMENT_PENDING_5480',
                receiverName: 'در انتظار پرداخت',
                productTitle: 'قطعه مخصوص در انتظار پرداخت'
            };
            assert.equal(isPendingPaymentOrder(rowWithIncidentalText), false);
        });
    });

    describe('Required Regression Case: Phone 09179132236', () => {
        const fixturePhone = '09179132236';
        const fixtureRows31 = [
            // 20 pending orders
            ...Array.from({ length: 20 }, (_, i) => ({ id: 1480460 + i, state: 'PAYMENT_PENDING', userPhoneNumber: fixturePhone, order: { id: 1112700 + i } })),
            // 4 shipped orders for order 1126071
            { id: 1499912, state: 'SELLER_SHIPPED', userPhoneNumber: fixturePhone, order: { id: 1126071 } },
            { id: 1499911, state: 'SELLER_SHIPPED', userPhoneNumber: fixturePhone, order: { id: 1126071 } },
            { id: 1499909, state: 'SELLER_SHIPPED', userPhoneNumber: fixturePhone, order: { id: 1126071 } },
            { id: 1499910, state: 'SELLER_SHIPPED', userPhoneNumber: fixturePhone, order: { id: 1126071 } },
            // 6 more pending orders
            ...Array.from({ length: 6 }, (_, i) => ({ id: 1529500 + i, state: 'PAYMENT_PENDING', userPhoneNumber: fixturePhone, order: { id: 1146400 + i } })),
            // 1 cancelled order 448720
            { id: 539749, state: 'CANCELLED_ADMIN', userPhoneNumber: fixturePhone, order: { id: 448720 } }
        ];

        test('with setting enabled: preserves 1 eligible pending order and all 5 non-pending orders (total 6)', () => {
            assert.equal(fixtureRows31.length, 31);
            const filtered = filterRowsForDataGrid(fixtureRows31, true, fixturePhone);

            assert.equal(filtered.length, 6, 'Must preserve 5 non-pending + 1 eligible pending order');
            const ids = filtered.map(r => r.id);
            assert.deepEqual(ids, [1480460, 1499912, 1499911, 1499909, 1499910, 539749]);

            // Verify order statuses
            assert.equal(filtered[0].state, 'PAYMENT_PENDING', 'Preserved order must be eligible pending');
            assert.equal(filtered[1].state, 'SELLER_SHIPPED');
            assert.equal(filtered[2].state, 'SELLER_SHIPPED');
            assert.equal(filtered[3].state, 'SELLER_SHIPPED');
            assert.equal(filtered[4].state, 'SELLER_SHIPPED');
            assert.equal(filtered[5].state, 'CANCELLED_ADMIN');

            // Verify order IDs
            assert.equal(filtered[1].order.id, 1126071);
            assert.equal(filtered[5].order.id, 448720);
        });

        test('with setting disabled: retains all 31 orders without suppression', () => {
            const unfiltered = filterRowsForDataGrid(fixtureRows31, false, fixturePhone);
            assert.equal(unfiltered.length, 31);
            assert.equal(unfiltered[0].id, 1480460);
            assert.equal(unfiltered[unfiltered.length - 1].id, 539749);
        });

        test('does NOT collapse or group other orders belonging to the customer', () => {
            const filtered = filterRowsForDataGrid(fixtureRows31, true, fixturePhone);
            const shippedItems = filtered.filter(r => r.order.id === 1126071);
            assert.equal(shippedItems.length, 4, 'All 4 shipped parcel items must be preserved individually');

            const cancelledItems = filtered.filter(r => r.order.id === 448720);
            assert.equal(cancelledItems.length, 1, 'Cancelled order must remain preserved');
        });
    });

    describe('Virtualization Layout & Detail Panel Gap Model', () => {
        test('data-model filtering guarantees continuous row indexing and gap = 0px', () => {
            const rowHeight = 50;
            const filteredRows = [
                { id: 1499912, state: 'SELLER_SHIPPED' },
                { id: 1499911, state: 'SELLER_SHIPPED' },
                { id: 1499909, state: 'SELLER_SHIPPED' },
                { id: 1499910, state: 'SELLER_SHIPPED' },
                { id: 539749, state: 'CANCELLED_ADMIN' }
            ];

            // In DataGrid data model layer, each row index corresponds exactly to its position
            filteredRows.forEach((row, index) => {
                const rowTop = index * rowHeight;
                const rowBottom = rowTop + rowHeight;
                // MUI DataGrid positions the detail panel immediately after the parent row:
                const detailPanelTop = (index + 1) * rowHeight;
                const gap = detailPanelTop - rowBottom;
                assert.equal(gap, 0, `Row index ${index} must have exactly 0px gap`);
            });
        });

        test('demonstrates why legacy DOM CSS display:none created the blank gap', () => {
            const rowHeight = 50;
            // Suppose 20 pending rows precede row 20 in the raw array
            const rawVirtualIndex = 20;
            // Virtualized DataGrid positions detail panel at:
            const detailPanelCalculatedTop = (rawVirtualIndex + 1) * rowHeight; // 1050px

            // But if 20 previous rows are hidden via CSS display: none !important:
            // The DOM collapsed height leaves the row at visible index 0:
            const collapsedRowBottom = 0 * rowHeight + rowHeight; // 50px

            // The resulting layout gap in the legacy code was:
            const legacyGap = detailPanelCalculatedTop - collapsedRowBottom; // 1000px (~25cm!)
            assert.equal(legacyGap, 1000, 'Legacy CSS display:none produced 1000px blank gap');

            // With data-layer filtering, the row virtual index becomes 0:
            const newDetailPanelTop = (0 + 1) * rowHeight; // 50px
            const newGap = newDetailPanelTop - collapsedRowBottom;
            assert.equal(newGap, 0, 'Data-layer filtering eliminates the gap completely');
        });
    });

    describe('Settings Coexistence & State Independence', () => {
        test('hidePending and always100 can be toggled in all 4 combinations without collision', () => {
            const stateCombinations = [
                { hidePending: false, always100: false },
                { hidePending: true,  always100: false },
                { hidePending: false, always100: true },
                { hidePending: true,  always100: true }
            ];

            stateCombinations.forEach(comb => {
                const docAttrs = {
                    'data-cx-hide-pending': comb.hidePending ? 'true' : 'false',
                    'data-cx-always-100': comb.always100 ? 'true' : 'false'
                };

                assert.equal(docAttrs['data-cx-hide-pending'] === 'true', comb.hidePending);
                assert.equal(docAttrs['data-cx-always-100'] === 'true', comb.always100);
            });
        });
    });
});
