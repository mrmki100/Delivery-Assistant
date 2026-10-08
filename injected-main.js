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
        for (const key of WAYBILL_KEYS) {
            if (rowObj[key] != null) {
                const val = String(rowObj[key]).trim();
                if (val && val.length >= 3) {
                    waybill = val;
                    break;
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
        if (!orderId && rowObj.order && rowObj.order.id) {
            orderId = String(rowObj.order.id).trim();
        }

        // 5. Parcel ID matching
        for (const key of PARCEL_KEYS) {
            if (rowObj[key] != null) {
                const val = String(rowObj[key]).trim();
                if (val && /^\d+$/.test(val)) {
                    parcelId = val;
                    break;
                }
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

    // Listen for custom apply event from content script or settings
    window.addEventListener('cx-apply-page-size-100', () => {
        applyPageSize100();
    });

    // Observe DOM mutations for newly rendered MuiTablePagination elements
    let paginationDebounce = null;
    const paginationObserver = new MutationObserver(() => {
        if (document.documentElement.getAttribute('data-cx-always-100') !== 'true') return;
        if (paginationDebounce) return;
        paginationDebounce = setTimeout(() => {
            paginationDebounce = null;
            applyPageSize100();
        }, 150);
    });
    const targetRoot = document.body || document.documentElement;
    if (targetRoot) {
        paginationObserver.observe(targetRoot, { childList: true, subtree: true });
    }

    // React router SPA navigation hooks
    const originalPushState = history.pushState;
    if (originalPushState) {
        history.pushState = function() {
            const ret = originalPushState.apply(this, arguments);
            setTimeout(applyPageSize100, 250);
            return ret;
        };
    }
    const originalReplaceState = history.replaceState;
    if (originalReplaceState) {
        history.replaceState = function() {
            const ret = originalReplaceState.apply(this, arguments);
            setTimeout(applyPageSize100, 250);
            return ret;
        };
    }
    window.addEventListener('popstate', () => {
        setTimeout(applyPageSize100, 250);
    });

    // Initial load check
    setTimeout(applyPageSize100, 500);

})();
