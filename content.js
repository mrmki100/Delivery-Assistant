/**
 * content.js
 * 
 * Runs exclusively on panel.automoby.ir.
 * Responsible for extracting UI data, updating the Shadow DOM Command Center,
 * and communicating with the Service Worker (API Bridge).
 */

(function () {
    'use strict';

    // Master dictionary for finding data fields in MuiDataGrid
    const FIELDS = {
        phone: ['phonenumber', 'mobile', 'customerMobile', 'phoneNumber', 'phone', 'receiver_mobile', 'senderMobile', 'sender_mobile', 'customer_phone', 'cellphone', 'customer_mobile', 'customerPhone', 'buyerMobile', 'recipientPhone'],
        parcel: ['id', 'orderId', 'returnId', 'parcelId', 'consignmentId', 'order_id', 'return_id', 'request_id', 'reference_id'],
        waybill: ['billOfLading', 'waybill', 'trackingNo', 'barcode', 'postBarcode', 'tracking_no', 'return_tracking_no', 'return_barcode', 'consignmentNo', 'consignment_no', 'consignmentNumber', 'traceNumber'],
        order: ['orderId', 'order_id', 'orderNumber', 'order_number', 'orderNo']
    };

    let activeCustomerName = '';
    let activeCustomerPhone = '';
    let currentRoutingSeq = 0;

    function toAsciiDigits(str) {
        if (str == null) return '';
        return String(str)
            .replace(/[\u06F0-\u06F9]/g, d => String.fromCharCode(d.charCodeAt(0) - 0x06F0 + 48))
            .replace(/[\u0660-\u0669]/g, d => String.fromCharCode(d.charCodeAt(0) - 0x0660 + 48));
    }

    // ==========================================
    // 0. MAIN-WORLD SCRIPT INJECTION (FALLBACK)
    // ==========================================
    function ensureMainScriptInjected() {
        if (document.getElementById('cx-injected-main')) return;
        try {
            const script = document.createElement('script');
            script.id = 'cx-injected-main';
            script.src = chrome.runtime.getURL('injected-main.js');
            (document.head || document.documentElement).appendChild(script);
        } catch (e) {
            // Silently fall back to DOM cache if CSP restricts script tag
        }
    }
    ensureMainScriptInjected();

    // ==========================================
    // 1. FLOATING BAR INJECTION (Shadow DOM)
    // ==========================================
    function ensurePanelExists() {
        // getExtensionRoot is globally available via ui-render.js
        const root = typeof getExtensionRoot === 'function' ? getExtensionRoot() : null;
        if (!root) return;

        if (root.querySelector('.cx-floating-bar')) return;

        const panel = document.createElement('div');
        panel.className = 'cx-floating-bar';

        const themeIcon = typeof _getThemeIcon === 'function' ? _getThemeIcon() : '🌙';
        const themeAriaLabel = typeof _getThemeAriaLabel === 'function' ? _getThemeAriaLabel() : 'تغییر تم';

        panel.innerHTML = `
            <div class="cx-floating-bar-info">
                <div class="cx-badge-ai">🤖 دستیار هوشمند</div>
                <div class="cx-customer-name" id="chapar-name">👇 روی ردیف کلیک کنید 👇</div>
                <div class="cx-order-chip" id="cx-order-chip" style="display: none;"></div>
            </div>

            <div class="cx-shortcuts-container" id="cx-shortcuts-bar"></div>
            
            <div class="cx-button-group">
                <button class="cx-theme-toggle" id="cx-theme-toggle-bar" aria-label="${themeAriaLabel}" title="${themeAriaLabel}">${themeIcon}</button>
                <button class="cx-settings-toggle" id="cx-settings-toggle-bar" aria-label="تنظیمات میانبرها" title="تنظیمات میانبرها">⚙️</button>
                <button class="cx-btn-trigger" id="btn-phone" disabled>📱 موبایل: منتظر...</button>
                <button class="cx-btn-trigger" id="btn-waybill" disabled>📦 بارنامه: منتظر...</button>
            </div>
        `;

        // Attach theme toggle listener
        const themeBtn = panel.querySelector('#cx-theme-toggle-bar');
        if (themeBtn && typeof toggleTheme === 'function') {
            themeBtn.addEventListener('click', () => {
                toggleTheme();
            });
        }

        // Attach settings toggle listener
        const settingsBtn = panel.querySelector('#cx-settings-toggle-bar');
        if (settingsBtn) {
            settingsBtn.addEventListener('click', () => {
                if (typeof renderShortcutSettingsModal === 'function') {
                    renderShortcutSettingsModal(async (enabledIds) => {
                        const shortcutsBar = panel.querySelector('#cx-shortcuts-bar');
                        if (typeof renderShortcutsBar === 'function') {
                            renderShortcutsBar(shortcutsBar, enabledIds);
                        }
                        const ctx = window.CX_SHORTCUTS?.getOrderContext();
                        if (ctx?.orderId) {
                            window.CX_SHORTCUTS.setOrderContext(ctx);
                        }
                    });
                }
            });
        }

        // Initialize shortcuts bar
        const shortcutsBar = panel.querySelector('#cx-shortcuts-bar');
        if (window.CX_SHORTCUTS && typeof renderShortcutsBar === 'function') {
            window.CX_SHORTCUTS.getEnabledShortcuts().then(enabledIds => {
                renderShortcutsBar(shortcutsBar, enabledIds);
            });
        }

        root.appendChild(panel);
    }

    // Inject stylesheet to cleanly hide marked pending-payment rows in host DOM
    function ensurePendingFilterStyle() {
        if (document.getElementById('cx-pending-filter-style')) return;
        const style = document.createElement('style');
        style.id = 'cx-pending-filter-style';
        style.textContent = `
            html[data-cx-hide-pending="true"] .MuiDataGrid-row.cx-pending-payment-row {
                display: none !important;
            }
        `;
        (document.head || document.documentElement).appendChild(style);
    }
    ensurePendingFilterStyle();

    // Synchronize settings with MAIN world and DOM attributes
    if (chrome?.storage?.local) {
        chrome.storage.local.get(['cxAlways100', 'cxHidePendingPayment'], res => {
            const always100 = !!res?.cxAlways100;
            const hidePending = !!res?.cxHidePendingPayment;
            document.documentElement.setAttribute('data-cx-always-100', always100 ? 'true' : 'false');
            document.documentElement.setAttribute('data-cx-hide-pending', hidePending ? 'true' : 'false');
            if (always100) {
                window.dispatchEvent(new CustomEvent('cx-apply-page-size-100'));
            }
            filterPendingPaymentOrders();
        });

        chrome.storage.onChanged.addListener((changes, area) => {
            if (area === 'local') {
                if (changes.cxAlways100) {
                    const enabled = !!changes.cxAlways100.newValue;
                    document.documentElement.setAttribute('data-cx-always-100', enabled ? 'true' : 'false');
                    if (enabled) {
                        window.dispatchEvent(new CustomEvent('cx-apply-page-size-100'));
                    }
                }
                if (changes.cxHidePendingPayment) {
                    const enabled = !!changes.cxHidePendingPayment.newValue;
                    document.documentElement.setAttribute('data-cx-hide-pending', enabled ? 'true' : 'false');
                    filterPendingPaymentOrders();
                }
            }
        });
    }

    // Keep the panel alive (helps against React re-renders wiping the DOM)
    setInterval(() => {
        ensurePanelExists();
        ensurePendingFilterStyle();

        // Check if pagination exists and needs to be set to 100
        if (document.documentElement.getAttribute('data-cx-always-100') === 'true') {
            const pagInput = document.querySelector('.MuiTablePagination-input input');
            const pagSelect = document.querySelector('.MuiTablePagination-select');
            const currentVal = pagInput ? String(pagInput.value).trim() : (pagSelect ? pagSelect.innerText.trim() : '');
            if (currentVal && currentVal !== '100') {
                window.dispatchEvent(new CustomEvent('cx-apply-page-size-100'));
            }
        }

        // Apply pending-payment filter in Admin Orders
        filterPendingPaymentOrders();
    }, 1000);

    // ==========================================
    // 2. DATA EXTRACTION & LIVE ROW CACHE
    // ==========================================

    // Persistent row data cache across scroll & row re-renders
    // Maps rowId (string) -> { phone: string, waybill: string, name: string, updatedAt: number }
    const rowDataCache = new Map();

    /**
     * Scans all currently visible row elements in the DOM and updates the rowCache.
     * This captures cell values before they are virtualized out of the DOM when
     * the user scrolls horizontally or vertically.
     */
    function updateRowCacheFromDOM() {
        try {
            const rows = document.querySelectorAll('.MuiDataGrid-row');
            if (!rows || rows.length === 0) return;

            // Cap cache size to prevent memory leak
            if (rowDataCache.size > 300) {
                const keys = Array.from(rowDataCache.keys()).slice(0, 100);
                keys.forEach(k => rowDataCache.delete(k));
            }

            rows.forEach(row => {
                const rowId = row.getAttribute('data-id') || row.getAttribute('data-rowindex');
                if (!rowId) return;

                let entry = rowDataCache.get(rowId);
                if (!entry) {
                    entry = { phone: '', waybill: '', name: '', orderId: '', parcelId: '', updatedAt: Date.now() };
                    rowDataCache.set(rowId, entry);
                }

                // Scan phone fields
                if (!entry.phone) {
                    for (const field of FIELDS.phone) {
                        const cell = row.querySelector(`[data-field="${field}"]`);
                        if (cell) {
                            const content = cell.querySelector('.MuiDataGrid-cellContent');
                            const text = (content ? content.innerText : cell.innerText).trim();
                            if (text && text.length >= 7) {
                                entry.phone = text;
                                entry.updatedAt = Date.now();
                                break;
                            }
                        }
                    }
                }

                // Scan waybill fields
                if (!entry.waybill) {
                    for (const field of FIELDS.waybill) {
                        const cell = row.querySelector(`[data-field="${field}"]`);
                        if (cell) {
                            const content = cell.querySelector('.MuiDataGrid-cellContent');
                            const text = (content ? content.innerText : cell.innerText).trim();
                            if (text && text.length >= 3) {
                                entry.waybill = text;
                                entry.updatedAt = Date.now();
                                break;
                            }
                        }
                    }
                }

                // Scan orderId
                if (!entry.orderId) {
                    for (const field of FIELDS.order) {
                        const cell = row.querySelector(`[data-field="${field}"]`);
                        if (cell) {
                            const content = cell.querySelector('.MuiDataGrid-cellContent');
                            const text = (content ? content.innerText : cell.innerText).trim();
                            if (text && /^\d+$/.test(text)) {
                                entry.orderId = text;
                                entry.updatedAt = Date.now();
                                break;
                            }
                        }
                    }
                }

                // Scan customer name
                if (!entry.name) {
                    const nameCell = row.querySelector('[data-field="full_name"] .MuiDataGrid-cellContent')
                        || row.querySelector('[data-field="customerName"] .MuiDataGrid-cellContent')
                        || row.querySelector('[data-field="customer_name"] .MuiDataGrid-cellContent');
                    if (nameCell) {
                        const text = nameCell.innerText.trim();
                        if (text) {
                            entry.name = text;
                            entry.updatedAt = Date.now();
                        }
                    }
                }
            });
            // Apply pending payment filtering scoped to Admin Orders (/parcel/)
            filterPendingPaymentOrders();
        } catch (err) {
            // Non-critical cache update error
        }
    }

    /**
     * Filters/hides orders with status "در انتظار پرداخت" in Admin Orders (/parcel/).
     * Operates purely at the display/DOM layer using synchronized CSS class tagging.
     */
    function filterPendingPaymentOrders() {
        if (!window.location.pathname.startsWith('/parcel')) return;

        const isEnabled = document.documentElement.getAttribute('data-cx-hide-pending') === 'true';
        const rows = document.querySelectorAll('.MuiDataGrid-row');
        if (!rows || rows.length === 0) return;

        if (!isEnabled) {
            rows.forEach(r => {
                if (r.classList.contains('cx-pending-payment-row')) {
                    r.classList.remove('cx-pending-payment-row');
                }
            });
            return;
        }

        const pendingIds = new Set();
        rows.forEach(row => {
            const stateCell = row.querySelector('[data-field="state"]');
            if (stateCell && stateCell.innerText.trim() === 'در انتظار پرداخت') {
                const id = row.getAttribute('data-id');
                if (id) pendingIds.add(id);
            }
        });

        rows.forEach(row => {
            const id = row.getAttribute('data-id');
            if (id && pendingIds.has(id)) {
                row.classList.add('cx-pending-payment-row');
            } else {
                row.classList.remove('cx-pending-payment-row');
            }
        });
    }

    // Listen for manual trigger from settings modal
    window.addEventListener('cx-apply-pending-filter', filterPendingPaymentOrders);

    // Update cache immediately on initialization
    updateRowCacheFromDOM();

    // Throttled scroll listener to prevent main thread blocking
    let scrollThrottleTimeout = null;
    window.addEventListener('scroll', () => {
        if (scrollThrottleTimeout) return;
        scrollThrottleTimeout = setTimeout(() => {
            scrollThrottleTimeout = null;
            updateRowCacheFromDOM();
        }, 150);
    }, { capture: true, passive: true });

    // Observe DOM mutations to capture new rows and cells as they enter the grid
    let cacheDebounceTimeout = null;
    const gridDomObserver = new MutationObserver(() => {
        if (cacheDebounceTimeout) return;
        cacheDebounceTimeout = setTimeout(() => {
            cacheDebounceTimeout = null;
            updateRowCacheFromDOM();
        }, 120);
    });
    gridDomObserver.observe(document.body, { childList: true, subtree: true });

    /**
     * Reads and clears fiber-extracted data set by injected-main.js on click capture.
     */
    function getFiberExtractedData(row) {
        if (!row) return null;
        const attr = row.getAttribute('data-cx-fiber-extracted');
        if (!attr) return null;
        try {
            const data = JSON.parse(attr);
            row.removeAttribute('data-cx-fiber-extracted');
            return data;
        } catch (e) {
            return null;
        }
    }

    /**
     * Given a row element, collects ALL sibling row fragments that represent the
     * same logical record. MUI DataGrid with column virtualization / pinned columns
     * may render a single row across multiple separate `.MuiDataGrid-row` elements.
     * They all share the same `data-id` attribute.
     */
    function getAllRowFragments(clickedRow) {
        const rowId = clickedRow.getAttribute('data-id');
        if (rowId) {
            const allFragments = document.querySelectorAll(`.MuiDataGrid-row[data-id="${rowId}"]`);
            if (allFragments.length > 0) return Array.from(allFragments);
        }
        const rowIndex = clickedRow.getAttribute('data-rowindex');
        if (rowIndex) {
            const allFragments = document.querySelectorAll(`.MuiDataGrid-row[data-rowindex="${rowIndex}"]`);
            if (allFragments.length > 0) return Array.from(allFragments);
        }
        return [clickedRow];
    }

    /**
     * Searches for a data field across one or more row fragments.
     */
    function extractData(rowFragments, fieldNamesArray) {
        const rows = Array.isArray(rowFragments) ? rowFragments : [rowFragments];

        for (let field of fieldNamesArray) {
            for (let row of rows) {
                let cell = row.querySelector(`[data-field="${field}"]`);
                if (cell) {
                    let content = cell.querySelector('.MuiDataGrid-cellContent');
                    let text = content ? content.innerText.trim() : cell.innerText.trim();
                    if (text) return text;
                }
            }
        }
        return '';
    }

    /**
     * Searches for the customer name across all row fragments.
     */
    function extractName(rowFragments) {
        const rows = Array.isArray(rowFragments) ? rowFragments : [rowFragments];
        for (let row of rows) {
            let nameCell = row.querySelector('[data-field="full_name"] .MuiDataGrid-cellContent')
                || row.querySelector('[data-field="customerName"] .MuiDataGrid-cellContent')
                || row.querySelector('[data-field="customer_name"] .MuiDataGrid-cellContent');
            if (nameCell) {
                let text = nameCell.innerText.trim();
                if (text) return text;
            }
        }
        return 'مشتری انتخاب شد';
    }

    // ==========================================
    // 3. ROW CLICK EVENT LISTENER
    // ==========================================
    document.addEventListener('click', (e) => {
        let row = e.target.closest('.MuiDataGrid-row');
        if (!row) return;

        // Try getting unvirtualized data directly from React Fiber (via injected-main.js capture)
        const fiberData = getFiberExtractedData(row);

        // Get all DOM fragments for this record
        const rowFragments = getAllRowFragments(row);

        // Run a quick cache update to capture current DOM state
        updateRowCacheFromDOM();

        const rowId = row.getAttribute('data-id') || row.getAttribute('data-rowindex');
        const cached = rowId ? rowDataCache.get(rowId) : null;

        // Failsafe Diagnostic Export Tool (Alt+Click)
        if (e.altKey) {
            e.preventDefault();
            let allCells = [];
            rowFragments.forEach(frag => {
                frag.querySelectorAll('[data-field]').forEach(c => allCells.push(c));
            });
            let exportMsg = "🔎 AUTOMOBY HIDDEN COLUMN CODES FOR THIS PAGE:\n\n";
            allCells.forEach(c => {
                let fieldName = c.getAttribute('data-field');
                let val = (c.querySelector('.MuiDataGrid-cellContent') ? c.querySelector('.MuiDataGrid-cellContent').innerText : c.innerText).trim().replace(/\n/g, ' ');
                if (val && fieldName !== '__detail_panel_toggle__' && fieldName !== 'actions') {
                    exportMsg += `DOM Cell: "${val}"   --->   Code Name: '${fieldName}'\n`;
                }
            });
            if (cached) {
                exportMsg += `\n📦 CACHED ROW DATA:\nPhone: "${cached.phone}" | Waybill: "${cached.waybill}" | Name: "${cached.name}"\n`;
            }
            if (fiberData) {
                exportMsg += `\n⚡ REACT FIBER DATA:\nPhone: "${fiberData.phone}" | Waybill: "${fiberData.waybill}" | Name: "${fiberData.name}"\n`;
            }
            alert(exportMsg);
            console.log(exportMsg);
            return;
        }

        // Multi-Layer Data Resolution:
        // Tier 1: React Fiber (direct memory access, completely immune to horizontal scroll virtualization)
        // Tier 2: Currently mounted DOM cells (across all row fragments)
        // Tier 3: Persistent Row Cache (historical observations across horizontal/vertical scroll)

        // 1. Phone Number
        let phone = (fiberData && fiberData.phone) ? fiberData.phone : '';
        if (!phone) phone = extractData(rowFragments, FIELDS.phone);
        if (!phone && cached && cached.phone) phone = cached.phone;
        phone = toAsciiDigits(phone).trim();

        // 2. Waybill / Barcode
        let waybill = (fiberData && fiberData.waybill) ? fiberData.waybill : '';
        if (!waybill) waybill = extractData(rowFragments, FIELDS.waybill);
        if (!waybill && cached && cached.waybill) waybill = cached.waybill;
        waybill = toAsciiDigits(waybill).trim();

        // 3. Customer Name
        let name = (fiberData && fiberData.name) ? fiberData.name : '';
        if (!name) name = extractName(rowFragments);
        if ((!name || name === 'مشتری انتخاب شد') && cached && cached.name) name = cached.name;
        activeCustomerName = name || 'مشتری انتخاب شد';
        activeCustomerPhone = phone || (cached && cached.phone) || '';

        // 4. Order ID
        let orderId = (fiberData && fiberData.orderId) ? fiberData.orderId : '';
        if (!orderId) orderId = extractData(rowFragments, FIELDS.order);
        if (!orderId && cached && cached.orderId) orderId = cached.orderId;
        orderId = toAsciiDigits(orderId).trim();

        // 5. Parcel ID
        let parcelId = (fiberData && fiberData.parcelId) ? fiberData.parcelId : '';
        if (!parcelId) parcelId = extractData(rowFragments, ['id', 'parcelId']);
        if (!parcelId && cached && cached.parcelId) parcelId = cached.parcelId;
        parcelId = toAsciiDigits(parcelId).trim();

        // Update the cache with any newly discovered fields for this row
        if (rowId) {
            rowDataCache.set(rowId, {
                phone: phone || cached?.phone || '',
                waybill: waybill || cached?.waybill || '',
                name: (activeCustomerName !== 'مشتری انتخاب شد' ? activeCustomerName : cached?.name) || '',
                orderId: orderId || cached?.orderId || '',
                parcelId: parcelId || cached?.parcelId || '',
                updatedAt: Date.now()
            });
        }

        // Update the Floating Bar UI
        const root = getExtensionRoot();
        if (!root) return;

        const nameHeader = root.querySelector('#chapar-name');
        if (nameHeader) {
            nameHeader.innerText = "👤 " + activeCustomerName;
        }

        const orderChip = root.querySelector('#cx-order-chip');
        if (orderChip) {
            if (orderId) {
                orderChip.style.display = 'inline-block';
                orderChip.innerText = `سفارش: #${orderId}`;
            } else {
                orderChip.style.display = 'none';
            }
        }

        // Update Shared Context & trigger background status checks
        if (window.CX_SHORTCUTS && typeof window.CX_SHORTCUTS.setOrderContext === 'function') {
            window.CX_SHORTCUTS.setOrderContext({
                orderId,
                parcelId,
                phone,
                waybill,
                name: activeCustomerName
            });
        }

        const btnPhone = root.querySelector('#btn-phone');
        const btnWaybill = root.querySelector('#btn-waybill');

        /**
         * Re-binds button state and attaches click listener safely.
         */
        const activateBtn = (btn, text, filterType, value, isPostButton = false) => {
            if (!btn) return;
            btn.disabled = false;
            btn.innerHTML = typeof _esc === 'function' ? _esc(text) : text;
            btn.className = `cx-btn-trigger ${isPostButton ? 'active-post' : 'active-chapar'}`;

            // Clone the button to remove old event listeners
            const newBtn = btn.cloneNode(true);
            btn.parentNode.replaceChild(newBtn, btn);

            newBtn.addEventListener('click', async (clickEvent) => {
                clickEvent.preventDefault();
                if (newBtn.disabled) return;

                // Disable during in-flight action to prevent repeated click storms
                newBtn.disabled = true;

                // Always backup to clipboard just in case
                if (navigator.clipboard) {
                    navigator.clipboard.writeText(value).catch(err => console.warn("Clipboard failed", err));
                }

                // Show Loading Spinner for UX
                const originalText = newBtn.innerHTML;
                newBtn.innerHTML = `<div class="cx-spinner"></div> در حال انتقال...`;

                try {
                    await handleRoutingAction(filterType, value, isPostButton, {
                        name: activeCustomerName,
                        phone: activeCustomerPhone
                    });
                } finally {
                    newBtn.innerHTML = originalText;
                    newBtn.disabled = false;
                }
            });
        };

        const deactivateBtn = (btn, text) => {
            if (!btn) return;
            btn.disabled = true;
            btn.innerText = text;
            btn.className = 'cx-btn-trigger';
        };

        if (btnPhone) {
            if (phone.length > 5) activateBtn(btnPhone, "📱 موبایل: " + phone, 'گیرنده', phone, false);
            else deactivateBtn(btnPhone, "📱 موبایل: ندارد");
        }

        if (btnWaybill) {
            // HYBRID ROUTING LOGIC (Prefix Scanner & Contextual Classifier)
            if (waybill.length > 2) {
                if (waybill.startsWith('5410') || waybill.startsWith('5480') || waybill.startsWith('6410') || waybill.startsWith('54') || waybill.startsWith('64')) {
                    // Route to Chapar Tracking Engine
                    activateBtn(btnWaybill, "📦 چاپار: " + waybill, 'ConsignmentNo', waybill, false);
                } else {
                    // Route to Iran Post Ghost Robot
                    activateBtn(btnWaybill, "📦 پست: " + waybill, null, waybill, true);
                }
            } else {
                deactivateBtn(btnWaybill, "📦 بارنامه: ندارد");
            }
        }
    });

    // ==========================================
    // 4. THE API BRIDGE DISPATCHER
    // ==========================================
    async function handleRoutingAction(filterType, value, isPostRoute, contextSnapshot = null) {
        if (isPostRoute) {
            // Task: Iran Post -> Tell background script to open Tab and prep storage
            chrome.runtime.sendMessage({
                action: 'OPEN_POST_TAB',
                query: value
            });
            return;
        }

        const thisSeq = ++currentRoutingSeq;
        const targetValue = value;
        const targetCustomerName = contextSnapshot?.name || activeCustomerName;
        const targetPhone = contextSnapshot?.phone || activeCustomerPhone;

        // Task: Chapar -> Tell background script to execute silent fetch
        const response = await new Promise(resolve => {
            chrome.runtime.sendMessage({
                action: 'FETCH_CHAPAR',
                type: filterType,
                query: targetValue,
                phone: targetPhone,
                name: targetCustomerName
            }, resolve);
        });

        // STALE CANCELLATION GUARD:
        // If the user clicked another row or triggered another search while this request was in flight, discard!
        if (thisSeq !== currentRoutingSeq) {
            console.warn('[Delivery Assistant] Stale request discarded:', { thisSeq, currentRoutingSeq, targetValue });
            return;
        }

        // Handle Response
        if (!response || !response.success) {
            if (response && response.error === 'AUTH_REQUIRED') {
                if (typeof renderAuthErrorModal === 'function') {
                    renderAuthErrorModal();
                } else {
                    alert('لطفا وارد حساب چاپار شوید.');
                }
            } else {
                alert('خطا در ارتباط با سرور چاپار: ' + (response?.error || 'Unknown Error'));
            }
        } else {
            // Route to the appropriate UI modal based on response type
            if (response.isPhoneList) {
                if (typeof renderPhoneListModal === 'function') {
                    renderPhoneListModal(response.data, targetValue, targetCustomerName);
                }
            } else {
                if (typeof renderTrackingModal === 'function') {
                    renderTrackingModal(response.data, targetValue, targetCustomerName);
                }
            }
        }
    }

    // Connect Shortcut status updates to floating bar UI
    if (window.CX_SHORTCUTS && typeof window.CX_SHORTCUTS.onStatusUpdate === 'function') {
        window.CX_SHORTCUTS.onStatusUpdate((shortcutId, status) => {
            if (typeof updateShortcutBadge === 'function') {
                updateShortcutBadge(shortcutId, status);
            }
        });
    }

    // Diagnostic / MCP Test Bridge (Safe Read-Only Trigger)
    let testBtn = document.getElementById('cx-mcp-test-trigger');
    if (!testBtn) {
        testBtn = document.createElement('button');
        testBtn.id = 'cx-mcp-test-trigger';
        testBtn.style.display = 'none';
        (document.body || document.documentElement).appendChild(testBtn);
    }
    testBtn.addEventListener('click', async () => {
        const rawQuery = document.documentElement.getAttribute('data-cx-test-query');
        const type = document.documentElement.getAttribute('data-cx-test-type') || 'ConsignmentNo';
        const name = document.documentElement.getAttribute('data-cx-test-name') || '';
        
        // Validate inputs before executing
        const allowedTypes = ['ConsignmentNo', 'گیرنده', 'TEST_RENDER_MODAL'];
        if (!allowedTypes.includes(type)) return;

        if (type === 'TEST_RENDER_MODAL') {
            const rawMock = document.documentElement.getAttribute('data-cx-test-mock');
            if (rawMock && typeof renderTrackingModal === 'function') {
                try {
                    const mockData = JSON.parse(rawMock);
                    renderTrackingModal(mockData, mockData.waybill || '54807199275779101', name || 'تست');
                    document.documentElement.setAttribute('data-cx-test-status', 'completed');
                } catch (e) {
                    document.documentElement.setAttribute('data-cx-test-status', 'error: ' + e.message);
                }
            }
            return;
        }
        
        const query = toAsciiDigits(rawQuery || '').trim();
        if (!/^[0-9a-zA-Z%_\-\+]{3,40}$/.test(query)) return;

        if (name) activeCustomerName = name;
        await handleRoutingAction(type, query, false, { name: activeCustomerName, phone: activeCustomerPhone });
        document.documentElement.setAttribute('data-cx-test-status', 'completed');
    });

})();
