import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

/**
 * Pure functions under test from content.js and injected-main.js
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
    // Standard Iranian prefix conversions:
    if (str.startsWith('00989') && str.length === 14) str = '0' + str.slice(4);
    else if (str.startsWith('989') && str.length === 12) str = '0' + str.slice(2);
    else if (str.startsWith('9') && str.length === 10) str = '0' + str;
    // Valid mobile: 11 digits starting with 09
    if (/^09\d{9}$/.test(str)) return str;
    // Valid landline with area code: 11 digits starting with 0
    if (/^0\d{10}$/.test(str)) return str;
    return '';
}

/**
 * Simulates row cache and selection logic from content.js
 */
class RowSelectionManager {
    constructor() {
        this.rowDataCache = new Map();
        this.activeCustomerName = '';
        this.activeCustomerPhone = '';
        this.activeCustomerWaybill = '';
        this.activeOrderId = '';
        this.currentRoutingSeq = 0;
    }

    resetActiveSelection() {
        this.activeCustomerName = '';
        this.activeCustomerPhone = '';
        this.activeCustomerWaybill = '';
        this.activeOrderId = '';
        this.currentRoutingSeq++;
    }

    updateRowCache(rowId, fields) {
        if (!rowId) return; // Strict: NEVER key cache by data-rowindex!
        let entry = this.rowDataCache.get(rowId);
        if (!entry) {
            entry = { phone: '', waybill: '', name: '', orderId: '', parcelId: '' };
            this.rowDataCache.set(rowId, entry);
        }
        if (fields.phone) entry.phone = normalizePhoneNumber(fields.phone);
        if (fields.waybill) entry.waybill = fields.waybill;
        if (fields.name) entry.name = fields.name;
        if (fields.orderId) entry.orderId = fields.orderId;
    }

    selectRow({ rowId, fiberData, domCells }) {
        const cached = rowId ? this.rowDataCache.get(rowId) : null;

        // Phone resolution: Fiber -> DOM -> Cache (strictly for this rowId)
        let rawPhone = fiberData?.phone || domCells?.phone || (cached?.phone || '');
        let phone = normalizePhoneNumber(rawPhone);

        // Name resolution
        let name = fiberData?.name || domCells?.name || (cached?.name || '');

        // Waybill resolution
        let waybill = fiberData?.waybill || domCells?.waybill || (cached?.waybill || '');

        // Order resolution
        let orderId = fiberData?.orderId || domCells?.orderId || (cached?.orderId || '');

        // Authoritative assignment: MUST NOT fall back to old selection if this row has no phone
        this.activeCustomerName = name || 'مشتری انتخاب شد';
        this.activeCustomerPhone = phone; // Strict: never resurrect previous row's phone!
        this.activeCustomerWaybill = waybill;
        this.activeOrderId = orderId;

        // Update cache under unique rowId
        if (rowId) {
            this.updateRowCache(rowId, { phone, waybill, name, orderId });
        }

        return {
            name: this.activeCustomerName,
            phone: this.activeCustomerPhone,
            waybill: this.activeCustomerWaybill,
            orderId: this.activeOrderId,
            phoneButtonLabel: phone ? `📱 موبایل: ${phone}` : '📱 موبایل: ندارد',
            phoneButtonDisabled: !phone
        };
    }
}

describe('Critical Test Domain — Phone-Number Extraction & Row Association', () => {

    describe('Scenario A: Row Selection & Identity Consistency', () => {
        test('selects a row with known synthetic phone number and verifies association', () => {
            const manager = new RowSelectionManager();
            const result = manager.selectRow({
                rowId: 'row-101',
                fiberData: { phone: '09123456789', name: 'کاربر آزمایشی الف', orderId: '1001' }
            });

            assert.equal(result.phone, '09123456789');
            assert.equal(result.name, 'کاربر آزمایشی الف');
            assert.equal(result.phoneButtonLabel, '📱 موبایل: 09123456789');
            assert.equal(result.phoneButtonDisabled, false);
        });

        test('selecting a different row updates the displayed number to the new row', () => {
            const manager = new RowSelectionManager();
            manager.selectRow({
                rowId: 'row-101',
                fiberData: { phone: '09123456789', name: 'کاربر آزمایشی الف' }
            });
            assert.equal(manager.activeCustomerPhone, '09123456789');

            const result2 = manager.selectRow({
                rowId: 'row-102',
                fiberData: { phone: '09359876543', name: 'کاربر آزمایشی ب' }
            });
            assert.equal(result2.phone, '09359876543');
            assert.equal(manager.activeCustomerPhone, '09359876543');
            assert.equal(result2.name, 'کاربر آزمایشی ب');
        });
    });

    describe('Scenario B: Missing Data & No Unrelated Fallback', () => {
        test('empty phone field produces disabled button and empty active phone', () => {
            const manager = new RowSelectionManager();
            const result = manager.selectRow({
                rowId: 'row-empty-phone',
                fiberData: { phone: '', name: 'بدون شماره' }
            });

            assert.equal(result.phone, '');
            assert.equal(result.phoneButtonLabel, '📱 موبایل: ندارد');
            assert.equal(result.phoneButtonDisabled, true);
            assert.equal(manager.activeCustomerPhone, '');
        });

        test('null or undefined phone field safely yields empty string', () => {
            const manager = new RowSelectionManager();
            const result = manager.selectRow({
                rowId: 'row-null',
                fiberData: { phone: null }
            });
            assert.equal(result.phone, '');
            assert.equal(result.phoneButtonDisabled, true);
        });

        test('whitespace-only phone field yields empty string', () => {
            const manager = new RowSelectionManager();
            const result = manager.selectRow({
                rowId: 'row-spaces',
                fiberData: { phone: '   \t  ' }
            });
            assert.equal(result.phone, '');
            assert.equal(result.phoneButtonDisabled, true);
        });

        test('CRITICAL CONTRACT: previous selection had phone, next selection has NO phone -> MUST NOT leak stale phone', () => {
            const manager = new RowSelectionManager();
            // Step 1: Select row with phone
            manager.selectRow({
                rowId: 'row-1',
                fiberData: { phone: '09112223344', name: 'مشتری اول' }
            });
            assert.equal(manager.activeCustomerPhone, '09112223344');

            // Step 2: Select row WITHOUT phone
            const result2 = manager.selectRow({
                rowId: 'row-2',
                fiberData: { phone: '', waybill: '548011223344', orderId: '5566' }
            });

            assert.equal(result2.phone, '', 'Second row must have empty phone');
            assert.equal(manager.activeCustomerPhone, '', 'activeCustomerPhone must NOT retain row-1 phone');
            assert.equal(result2.phoneButtonLabel, '📱 موبایل: ندارد');
            assert.equal(result2.phoneButtonDisabled, true);
        });
    });

    describe('Scenario C: Non-Phone Fields & Semantic Extraction Guard', () => {
        test('rejects city names or non-numeric strings (e.g. "تهران")', () => {
            assert.equal(normalizePhoneNumber('تهران'), '');
            assert.equal(normalizePhoneNumber('اصفهان'), '');
            assert.equal(normalizePhoneNumber('حضوری'), '');
        });

        test('rejects short numbers such as order IDs or parcel IDs (e.g. "448720" or "1126071")', () => {
            assert.equal(normalizePhoneNumber('448720'), '');
            assert.equal(normalizePhoneNumber('1126071'), '');
            assert.equal(normalizePhoneNumber('12345'), '');
        });

        test('rejects waybill-like numbers that do not match phone patterns (e.g. 54807199309911101)', () => {
            assert.equal(normalizePhoneNumber('54807199309911101'), '');
        });
    });

    describe('Scenario D: Phone Format Normalization', () => {
        test('converts Persian digits to English 11-digit mobile', () => {
            assert.equal(normalizePhoneNumber('۰۹۱۷۹۱۳۲۲۳۶'), '09179132236');
            assert.equal(normalizePhoneNumber('۰۹۱۲۳۴۵۶۷۸۹'), '09123456789');
        });

        test('converts Arabic-Indic digits to English 11-digit mobile', () => {
            assert.equal(normalizePhoneNumber('٠٩١٧٩١٣٢٢٣٦'), '09179132236');
        });

        test('normalizes +98 prefix to standard leading 0', () => {
            assert.equal(normalizePhoneNumber('+989179132236'), '09179132236');
            assert.equal(normalizePhoneNumber('989179132236'), '09179132236');
        });

        test('normalizes 0098 prefix to standard leading 0', () => {
            assert.equal(normalizePhoneNumber('00989179132236'), '09179132236');
        });

        test('prepends leading 0 when 10 digits starting with 9 are provided', () => {
            assert.equal(normalizePhoneNumber('9179132236'), '09179132236');
        });

        test('strips separators, hyphens, and whitespace correctly', () => {
            assert.equal(normalizePhoneNumber('0917-913-2236'), '09179132236');
            assert.equal(normalizePhoneNumber('0917 913 2236'), '09179132236');
            assert.equal(normalizePhoneNumber(' (0917) 913 2236 '), '09179132236');
        });

        test('preserves valid 11-digit landline with area code', () => {
            assert.equal(normalizePhoneNumber('02188776655'), '02188776655');
            assert.equal(normalizePhoneNumber('۰۲۱۸۸۷۷۶۶۵۵'), '02188776655');
        });
    });

    describe('Scenario E: Row Index Collision & Virtualization Immunity', () => {
        test('does NOT use data-rowindex as cache key; prevents page 2 collision', () => {
            const manager = new RowSelectionManager();

            // Page 1, Row Index 0 (Record A: 09111111111)
            manager.selectRow({
                rowId: 'parcel-1001',
                fiberData: { phone: '09111111111', name: 'کاربر صفحه اول' }
            });
            assert.equal(manager.activeCustomerPhone, '09111111111');

            // Simulate user paginating to Page 2.
            // Row Index 0 on Page 2 is Record B: parcel-2001 (NO phone number).
            // Under buggy rowindex caching, rowindex="0" would fetch parcel-1001's phone!
            const page2Result = manager.selectRow({
                rowId: 'parcel-2001',
                fiberData: { phone: '', name: 'کاربر صفحه دوم بی شماره' }
            });

            assert.equal(page2Result.phone, '', 'Page 2 row 0 must NOT inherit Page 1 row 0 phone');
            assert.equal(manager.activeCustomerPhone, '');
        });
    });

    describe('Scenario F: Asynchronous Race Conditions & Sequence Guards', () => {
        test('older delayed response cannot overwrite newer selection', async () => {
            let activeUIPhone = '';
            let currentSeq = 0;

            async function asyncFetchForSelection(targetPhone, seq) {
                // Row A is slow (50ms), Row B is fast (10ms)
                const delay = targetPhone === '09111111111' ? 40 : 5;
                await new Promise(r => setTimeout(r, delay));
                if (seq === currentSeq) {
                    activeUIPhone = targetPhone;
                }
            }

            // User clicks Row A
            currentSeq++;
            const promiseA = asyncFetchForSelection('09111111111', currentSeq);

            // User immediately clicks Row B
            currentSeq++;
            const promiseB = asyncFetchForSelection('09222222222', currentSeq);

            await Promise.all([promiseA, promiseB]);

            // Row B was the newer selection; active UI must strictly reflect Row B!
            assert.equal(activeUIPhone, '09222222222');
        });
    });

    describe('Scenario G: Search-Source Consistency', () => {
        test('verifies phone matches intended record when table is filtered by search', () => {
            const manager = new RowSelectionManager();
            const searchedPhone = '09179132236';

            const searchRecord = {
                id: '1480460',
                userPhoneNumber: '09179132236',
                order: { id: '1112700', user: { fullName: 'مشتری جستجو شده' } }
            };

            const result = manager.selectRow({
                rowId: searchRecord.id,
                fiberData: {
                    phone: searchRecord.userPhoneNumber,
                    name: searchRecord.order.user.fullName,
                    orderId: searchRecord.order.id
                }
            });

            assert.equal(result.phone, searchedPhone);
            assert.equal(result.orderId, '1112700');
            assert.equal(result.name, 'مشتری جستجو شده');
        });
    });
});
