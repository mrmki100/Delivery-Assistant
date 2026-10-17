/**
 * injected-main.js
 * 
 * Runs in the MAIN world context on panel.automoby.ir.
 * Has direct access to React Fiber and component props on DOM nodes.
 * Extracts row data directly from MUI DataGrid React components,
 * completely immune to column virtualization and horizontal scrolling.
 */
(function() {
    'use strict';

    if (window.__DELIVERY_ASSISTANT_MAIN_INJECTED__) return;
    window.__DELIVERY_ASSISTANT_MAIN_INJECTED__ = true;
    try {
        document.documentElement.setAttribute('data-cx-main-injected', 'true');
    } catch (e) {}

    const PHONE_KEYS = [
        'phonenumber', 'mobile', 'customerMobile', 'phoneNumber', 'phone',
        'receiver_mobile', 'senderMobile', 'sender_mobile', 'customer_phone',
        'cellphone', 'customer_mobile', 'customerPhone', 'buyerMobile', 'recipientPhone'
    ];

    const WAYBILL_KEYS = [
        'billOfLading', 'waybill', 'trackingNo', 'barcode', 'postBarcode',
        'tracking_no', 'return_tracking_no', 'return_barcode', 'consignmentNo',
        'consignment_no', 'consignmentNumber', 'traceNumber'
    ];

    const NAME_KEYS = [
        'full_name', 'customerName', 'name', 'receiverName', 'recipientName',
        'customer_name', 'clientName', 'buyerName', 'receiver_name'
    ];

    const ORDER_KEYS = [
        'orderId', 'order_id', 'orderNumber', 'order_number', 'orderNo'
    ];

    const PARCEL_KEYS = [
        'parcelId', 'parcel_id', 'id'
    ];

    /**
     * Finds the React Fiber key on an element.
     */
    function getFiber(element) {
        if (!element) return null;
        for (const key in element) {
            if (key.startsWith('__reactFiber$') || key.startsWith('__reactInternalInstance$')) {
                return element[key];
            }
        }
        return null;
    }

    /**
     * Traverses the React Fiber tree starting from rowEl or child cells
     * to extract the full, unvirtualized row data object.
     */
    function extractRowFromReact(rowEl) {
        if (!rowEl) return null;

        const elementsToTry = [rowEl];
        const cell = rowEl.querySelector('.MuiDataGrid-cell');
        if (cell) elementsToTry.push(cell);

        for (const el of elementsToTry) {
            let fiber = getFiber(el);
            let depth = 0;
            while (fiber && depth < 25) {
                const props = fiber.memoizedProps;
                if (props) {
                    // Direct row object on GridRow
                    if (props.row && typeof props.row === 'object' && !Array.isArray(props.row)) {
                        return props.row;
                    }
                    if (props.rowModel && typeof props.rowModel === 'object') {
                        return props.rowModel;
                    }
                    // GridCell params
                    if (props.params && props.params.row && typeof props.params.row === 'object') {
                        return props.params.row;
                    }
                    // apiRef lookup
                    if (props.apiRef && props.apiRef.current && typeof props.apiRef.current.getRow === 'function') {
                        const rowId = rowEl.getAttribute('data-id');
                        if (rowId) {
                            try {
                                const r = props.apiRef.current.getRow(rowId);
                                if (r) return r;
                            } catch (e) {}
                        }
                    }
                }
                const stateNode = fiber.stateNode;
                if (stateNode && stateNode.props) {
                    if (stateNode.props.row && typeof stateNode.props.row === 'object') {
                        return stateNode.props.row;
                    }
                    if (stateNode.props.rowModel && typeof stateNode.props.rowModel === 'object') {
                        return stateNode.props.rowModel;
                    }
                }
                fiber = fiber.return;
                depth++;
            }
        }

        // Try grid root if not found on row
        const gridRoot = rowEl.closest('.MuiDataGrid-root');
        if (gridRoot) {
            let fiber = getFiber(gridRoot);
            let depth = 0;
            const rowId = rowEl.getAttribute('data-id');
            while (fiber && depth < 30) {
                const props = fiber.memoizedProps;
                if (props) {
                    if (props.rows && Array.isArray(props.rows)) {
                        const found = props.rows.find(r => String(r.id) === String(rowId));
                        if (found) return found;
                    }
                    if (props.apiRef && props.apiRef.current && typeof props.apiRef.current.getRow === 'function' && rowId) {
                        try {
                            const r = props.apiRef.current.getRow(rowId);
                            if (r) return r;
                        } catch (e) {}
                    }
                }
                fiber = fiber.return;
                depth++;
            }
        }

        return null;
    }

    /**
     * Extracts phone, waybill, name, orderId, and parcelId from a raw React row data object.
     */
    function extractFields(rowObj) {
        if (!rowObj || typeof rowObj !== 'object') return { phone: '', waybill: '', name: '', orderId: '', parcelId: '' };

        let phone = '';
        let waybill = '';
        let name = '';
        let orderId = '';
        let parcelId = '';

        const isParcelPath = window.location.pathname.startsWith('/parcel');

        // 1. Phone matching
        for (const key of PHONE_KEYS) {
            if (rowObj[key] != null) {
                const val = String(rowObj[key]).trim();
                if (val && val.length >= 7) {
                    phone = val;
                    break;
                }
            }
        }
        if (!phone) {
            const nestedPhone = rowObj.userPhoneNumber
                || rowObj.order?.addressClone?.receiverPhoneNumber
                || rowObj.addressClone?.receiverPhoneNumber
                || rowObj.physicalItem?.physicalOrderItem?.orderItem?.order?.user?.phoneNumber
                || rowObj.order?.user?.phoneNumber
                || rowObj.user?.phoneNumber;
            if (nestedPhone != null && String(nestedPhone).trim().length >= 7) {
                phone = String(nestedPhone).trim();
            }
        }
        // Phone regex fallback
        if (!phone) {
            for (const [k, v] of Object.entries(rowObj)) {
                if (typeof v === 'string' || typeof v === 'number') {
                    const s = String(v).trim().replace(/[\s\-\+]/g, '');
                    if (/^(0098|0|\+98)?9\d{9}$/.test(s)) {
                        phone = s.startsWith('0098') ? '0' + s.slice(4) : s.startsWith('+98') ? '0' + s.slice(3) : !s.startsWith('0') ? '0' + s : s;
                        break;
                    }
                }
            }
        }

        // 2. Waybill matching
        function isValidWaybillCandidate(val) {
            if (!val || typeof val !== 'string') return false;
            const str = val.trim();
            if (str.length < 3) return false;
            if (/[\u0600-\u06FF]/.test(str)) return false;
            if (/^(null|undefined|none|n\/a|na|-+)$/i.test(str)) return false;
            if (/^([0-9])\1{5,}$/.test(str)) return false;
            return true;
        }

        for (const key of WAYBILL_KEYS) {
            if (rowObj[key] != null) {
                const val = String(rowObj[key]).trim();
                if (isValidWaybillCandidate(val)) {
                    waybill = val;
                    break;
                }
            }
        }
        if (!waybill) {
            const nestedWaybill = rowObj.shipping?.billOfLading
                || rowObj.return?.billOfLading
                || rowObj.parcel?.billOfLading
                || rowObj.shipping?.snappBoxOrder?.trackingNumber;
            if (nestedWaybill != null) {
                const str = String(nestedWaybill).trim();
                if (isValidWaybillCandidate(str)) {
                    waybill = str;
                }
            }
        }
        // Waybill pattern fallback (Chapar 5410/5480/6410 or Post 20-24 digits)
        if (!waybill) {
            for (const [k, v] of Object.entries(rowObj)) {
                if (typeof v === 'string' || typeof v === 'number') {
                    const s = String(v).trim();
                    if ((s.startsWith('5410') || s.startsWith('5480') || s.startsWith('6410')) && s.length >= 10) {
                        waybill = s;
                        break;
                    }
                    if (/^\d{20,24}$/.test(s)) {
                        waybill = s;
                        break;
                    }
                }
            }
        }

        // 3. Name matching
        for (const key of NAME_KEYS) {
            if (rowObj[key] != null) {
                const val = String(rowObj[key]).trim();
                if (val && val.length > 1) {
                    name = val;
                    break;
                }
            }
        }
        if (!name) {
            if (rowObj.userFullName && String(rowObj.userFullName).trim().length > 1) {
                name = String(rowObj.userFullName).trim();
            } else {
                const addr = rowObj.order?.addressClone || rowObj.addressClone;
                if (addr && (addr.receiverFirstName || addr.receiverFamilyName)) {
                    name = `${addr.receiverFirstName || ''} ${addr.receiverFamilyName || ''}`.trim();
                } else {
                    const u = rowObj.physicalItem?.physicalOrderItem?.orderItem?.order?.user
                        || rowObj.order?.user
                        || rowObj.user;
                    if (u) {
                        name = `${u.firstName || ''} ${u.lastName || ''}`.trim() || u.fullName || '';
                    }
                }
            }
        }

        // 4. Order ID matching
        for (const key of ORDER_KEYS) {
            if (rowObj[key] != null) {
                const val = String(rowObj[key]).trim();
                if (val && /^\d+$/.test(val)) {
                    orderId = val;
                    break;
                }
            }
        }
        if (!orderId) {
            const nestedOrder = rowObj.order?.id
                || rowObj.physicalItem?.physicalOrderItem?.orderItem?.orderId
                || rowObj.physicalItem?.physicalOrderItem?.orderItem?.order?.id;
            if (nestedOrder != null && /^\d+$/.test(String(nestedOrder).trim())) {
                orderId = String(nestedOrder).trim();
            }
        }

        // 5. Parcel ID matching (Shipment identifier)
        // High priority: explicit parcel fields
        const explicitParcelKeys = ['parcelId', 'parcel_id', 'packageNo', 'consignmentId', 'shipmentId'];
        for (const key of explicitParcelKeys) {
            if (rowObj[key] != null) {
                const val = String(rowObj[key]).trim();
                if (val && /^\d+$/.test(val)) {
                    parcelId = val;
                    break;
                }
            }
        }
        // Nested parcel structures (e.g. ReturnItemModel in Returns)
        if (!parcelId) {
            const nestedParcel = rowObj.physicalItem?.physicalOrderItem?.parcelId
                || rowObj.physicalOrderItem?.parcelId
                || rowObj.parcel?.id
                || rowObj.parcel?.parcelId
                || rowObj.parcelItem?.parcelId;
            if (nestedParcel != null && /^\d+$/.test(String(nestedParcel).trim())) {
                parcelId = String(nestedParcel).trim();
            }
        }
        // Admin Orders (/parcel/) or explicit ParcelModel where rowObj.id IS the parcel identifier:
        // NEVER treat generic rowObj.id as parcelId in Returns, Manual Refunds, or non-parcel models!
        if (!parcelId && (isParcelPath || rowObj.__typename === 'ParcelModel')) {
            if (rowObj.id != null && /^\d+$/.test(String(rowObj.id).trim())) {
                parcelId = String(rowObj.id).trim();
            }
        }

        return { phone, waybill, name, orderId, parcelId };
    }

    // Attach capture-phase click listener to extract data synchronously before bubbling
    document.addEventListener('click', (e) => {
        try {
            const row = e.target.closest('.MuiDataGrid-row');
            if (!row) return;

            const rowObj = extractRowFromReact(row);
            if (rowObj) {
                const fields = extractFields(rowObj);
                row.setAttribute('data-cx-fiber-extracted', JSON.stringify(fields));
            }
        } catch (err) {
            // Fail silently to avoid interfering with host page
        }
    }, true);

    // ==========================================
    // 6. ALWAYS 100 ITEMS PAGE-SIZE AUTOMATION
    // ==========================================
    let isApplyingPageSize = false;
    let lastAppliedTime = 0;

    function applyPageSize100() {
        if (document.documentElement.getAttribute('data-cx-always-100') !== 'true') return false;
        if (isApplyingPageSize) return false;

        const now = Date.now();
        if (now - lastAppliedTime < 800) return false;

        const pagination = document.querySelector('.MuiTablePagination-root');
        if (!pagination) return false;

        const input = pagination.querySelector('.MuiTablePagination-input input');
        const select = pagination.querySelector('.MuiTablePagination-select');
        const currentVal = input ? String(input.value).trim() : (select ? select.innerText.trim() : '');

        // If it's already 100, do nothing!
        if (currentVal === '100') return false;

        isApplyingPageSize = true;
        lastAppliedTime = now;

        try {
            // Method 1: React Props synthetic event (Immediate, clean, zero popover flicker)
            if (input) {
                let inputProps = null;
                for (const k in input) {
                    if (k.startsWith('__reactProps')) {
                        inputProps = input[k];
                        break;
                    }
                }
                if (inputProps && typeof inputProps.onChange === 'function') {
                    inputProps.onChange({ target: { value: 100, name: input.name } });
                    isApplyingPageSize = false;
                    return true;
                }
            }

            // Method 2: DOM fallback (simulate dropdown selection)
            const trigger = select || pagination.querySelector('.MuiTablePagination-input');
            if (trigger) {
                trigger.click();
                setTimeout(() => {
                    const listbox = document.querySelector('ul[role="listbox"], [role="listbox"]');
                    if (listbox) {
                        const opt100 = listbox.querySelector('li[data-value="100"]')
                            || Array.from(listbox.querySelectorAll('li')).find(li => li.innerText.trim() === '100');
                        if (opt100) {
                            opt100.click();
                        } else {
                            const backdrop = document.querySelector('.MuiBackdrop-root');
                            if (backdrop) backdrop.click();
                        }
                    }
                    isApplyingPageSize = false;
                }, 50);
                return true;
            }
        } catch (err) {
            // Silently ignore non-critical errors
        } finally {
            setTimeout(() => { isApplyingPageSize = false; }, 500);
        }
        return false;
    }

    // ==========================================
    // 7. PENDING PAYMENT FILTER AUTOMATION (MUI DataGrid Model Layer)
    // ==========================================
    function getGridFiber() {
        const gridRoot = document.querySelector('.MuiDataGrid-root');
        if (!gridRoot) return null;
        let fiber = getFiber(gridRoot);
        let cur = fiber;
        while (cur) {
            if (cur.memoizedProps?.apiRef?.current && Array.isArray(cur.memoizedProps?.rows)) {
                return {
                    apiRef: cur.memoizedProps.apiRef,
                    rawRows: cur.memoizedProps.rows,
                    fiberNode: cur
                };
            }
            cur = cur.return;
        }
        return null;
    }

    function isPendingPaymentOrder(row) {
        if (!row || typeof row !== 'object') return false;
        // Authoritative GraphQL enum or status field
        if (row.state === 'PAYMENT_PENDING' || row.state === 'در انتظار پرداخت') return true;
        if (row.status === 'PAYMENT_PENDING' || row.status === 'در انتظار پرداخت') return true;
        if (row.orderState === 'PAYMENT_PENDING' || row.orderState === 'در انتظار پرداخت') return true;
        if (row.order?.state === 'PAYMENT_PENDING' || row.order?.state === 'در انتظار پرداخت') return true;
        return false;
    }

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

    function getActiveSearchReference() {
        try {
            const urlParams = new URLSearchParams(window.location.search);
            const qParam = urlParams.get('q') || urlParams.get('search') || urlParams.get('query') || urlParams.get('phone') || urlParams.get('orderId');
            if (qParam && qParam.trim()) {
                return toAsciiDigits(qParam.trim());
            }
        } catch (_) {}

        // Locate text input that is NOT a combobox (seller dropdown has role="combobox")
        const inputs = Array.from(document.querySelectorAll('input[type="text"], input[type="search"]'));
        for (const input of inputs) {
            if (input.readOnly || input.disabled) continue;
            if (input.getAttribute('role') === 'combobox') continue;
            if (input.getAttribute('aria-autocomplete') === 'list') continue;

            const placeholder = input.getAttribute('placeholder') || '';
            const ariaLabel = input.getAttribute('aria-label') || '';
            const container = input.closest('.MuiFormControl-root, .MuiTextField-root, .MuiOutlinedInput-root') || input.parentElement;
            const containerText = container ? container.textContent : '';

            if (/جست\s*و?\s*جو|search|شماره|تلفن|سفارش|کد/i.test(placeholder) ||
                /جست\s*و?\s*جو|search|شماره|تلفن|سفارش|کد/i.test(ariaLabel) ||
                /جست\s*و?\s*جو|search/i.test(containerText)) {
                if (input.value && input.value.trim()) {
                    return toAsciiDigits(input.value.trim());
                }
                return ''; // Search input exists and is empty
            }
        }

        // Secondary fallback: any non-combobox text input with a value
        for (const input of inputs) {
            if (input.readOnly || input.disabled) continue;
            if (input.getAttribute('role') === 'combobox') continue;
            if (input.getAttribute('aria-autocomplete') === 'list') continue;
            if (input.value && input.value.trim()) {
                return toAsciiDigits(input.value.trim());
            }
        }

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

    function filterPendingOrdersWithPreservation(rawRows, isHidePending, activeSearchRef = '') {
        if (!rawRows || !Array.isArray(rawRows)) return [];
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

        // Authoritative business contract:
        // EXACT VALID MATCH EXISTS -> Preserve exactly ONE eligible matching pending-payment record.
        // NO VALID EXACT MATCH (empty, invalid, or no match) -> Preserve ZERO pending-payment records.
        // Non-pending records are ALWAYS preserved.
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

    let isSyncingPending = false;
    function syncPendingOrdersFilter() {
        if (isSyncingPending) return;
        const grid = getGridFiber();
        if (!grid || !grid.apiRef?.current || typeof grid.apiRef.current.setRows !== 'function') return;

        const isParcelPage = window.location.pathname.startsWith('/parcel');
        const isHidePending = isParcelPage && document.documentElement.getAttribute('data-cx-hide-pending') === 'true';
        const rawRows = grid.rawRows;
        if (!rawRows || !Array.isArray(rawRows)) return;

        const activeSearchRef = isHidePending ? getActiveSearchReference() : '';
        const targetRows = filterPendingOrdersWithPreservation(rawRows, isHidePending, activeSearchRef);

        const currentGridIds = grid.apiRef.current.state?.rows?.dataRowIds || [];
        const targetIds = targetRows.map(r => r.id);

        let isMatch = currentGridIds.length === targetIds.length;
        if (isMatch) {
            for (let i = 0; i < targetIds.length; i++) {
                if (currentGridIds[i] !== targetIds[i]) {
                    isMatch = false;
                    break;
                }
            }
        }

        if (isMatch) return;

        try {
            isSyncingPending = true;
            grid.apiRef.current.setRows(targetRows);
        } catch (err) {
            // Fail silently to avoid interfering with host page
        } finally {
            isSyncingPending = false;
        }
    }

    // Recompute filter on search input changes
    const onSearchChange = (e) => {
        if (e.target && (e.target.matches('input[type="text"], input[type="search"]') || e.target.closest('.MuiOutlinedInput-root'))) {
            syncPendingOrdersFilter();
        }
    };
    document.addEventListener('input', onSearchChange, true);
    document.addEventListener('change', onSearchChange, true);

    // Listen for custom apply events from content script or settings
    window.addEventListener('cx-apply-page-size-100', () => {
        applyPageSize100();
    });
    window.addEventListener('cx-apply-pending-filter', () => {
        syncPendingOrdersFilter();
    });

    // Observe documentElement attribute changes for real-time reactivity
    const attrObserver = new MutationObserver((mutations) => {
        for (const m of mutations) {
            if (m.type === 'attributes') {
                if (m.attributeName === 'data-cx-always-100' && document.documentElement.getAttribute('data-cx-always-100') === 'true') {
                    applyPageSize100();
                } else if (m.attributeName === 'data-cx-hide-pending') {
                    syncPendingOrdersFilter();
                }
            }
        }
    });
    attrObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-cx-always-100', 'data-cx-hide-pending'] });

    // Observe DOM mutations for newly rendered pagination and DataGrid rows
    let paginationDebounce = null;
    let gridDebounce = null;
    const domObserver = new MutationObserver(() => {
        if (document.documentElement.getAttribute('data-cx-always-100') === 'true') {
            if (!paginationDebounce) {
                paginationDebounce = setTimeout(() => {
                    paginationDebounce = null;
                    applyPageSize100();
                }, 150);
            }
        }
        if (!gridDebounce) {
            gridDebounce = setTimeout(() => {
                gridDebounce = null;
                syncPendingOrdersFilter();
            }, 120);
        }
    });

    const targetRoot = document.body || document.documentElement;
    if (targetRoot) {
        domObserver.observe(targetRoot, { childList: true, subtree: true });
    }

    // React router SPA navigation hooks
    const originalPushState = history.pushState;
    if (originalPushState) {
        history.pushState = function() {
            const ret = originalPushState.apply(this, arguments);
            setTimeout(applyPageSize100, 250);
            setTimeout(syncPendingOrdersFilter, 300);
            return ret;
        };
    }
    const originalReplaceState = history.replaceState;
    if (originalReplaceState) {
        history.replaceState = function() {
            const ret = originalReplaceState.apply(this, arguments);
            setTimeout(applyPageSize100, 250);
            setTimeout(syncPendingOrdersFilter, 300);
            return ret;
        };
    }
    window.addEventListener('popstate', () => {
        setTimeout(applyPageSize100, 250);
        setTimeout(syncPendingOrdersFilter, 300);
    });

    // Initial load checks
    setTimeout(applyPageSize100, 500);
    setTimeout(syncPendingOrdersFilter, 600);

})();
