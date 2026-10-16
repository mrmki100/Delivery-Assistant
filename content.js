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
        phone: ['phonenumber', 'mobile', 'customerMobile', 'phoneNumber', 'phone', 'receiver_mobile', 'senderMobile', 'sender_mobile', 'customer_phone', 'cellphone', 'customer_mobile', 'customerPhone', 'buyerMobile', 'recipientPhone', 'userPhoneNumber'],
        parcel: ['parcelId', 'parcel_id', 'consignmentId', 'trackingNo', 'shipmentId'],
        waybill: ['billOfLading', 'waybill', 'trackingNo', 'barcode', 'postBarcode', 'tracking_no', 'return_tracking_no', 'return_barcode', 'consignmentNo', 'consignment_no', 'consignmentNumber', 'traceNumber'],
        order: ['orderId', 'order_id', 'orderNumber', 'order_number', 'orderNo'],
        name: ['full_name', 'customerName', 'userFullName', 'customer_name', 'name', 'receiverName', 'recipientName']
    };

    let activeCustomerName = '';
    let activeCustomerPhone = '';
    let activeCustomerWaybill = '';
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
                <div class="cx-customer-name" id="chapar-name" title="مشتری فعال">👇 روی ردیف کلیک کنید 👇</div>
                <div class="cx-order-chip" id="cx-order-chip" style="display: none;"></div>
            </div>

            <div class="cx-bar-divider" aria-hidden="true"></div>

            <div class="cx-shortcuts-container" id="cx-shortcuts-bar"></div>
            
            <div class="cx-bar-divider" aria-hidden="true"></div>

            <div class="cx-tracking-group">
                <div class="cx-phone-widget" id="cx-phone-widget">
                    <button class="cx-btn-trigger" id="btn-phone" disabled aria-label="شماره موبایل گیرنده" title="شماره موبایل گیرنده">📱 موبایل: منتظر...</button>
                </div>
                <div class="cx-waybill-widget" id="cx-waybill-widget">
                    <button class="cx-btn-trigger" id="btn-waybill" disabled aria-label="رهگیری بارنامه" title="رهگیری بارنامه">📦 بارنامه: منتظر...</button>
                </div>
                <div class="cx-jira-widget" id="cx-jira-widget">
                    <button class="cx-btn-trigger btn-jira" id="btn-jira-lookup" disabled aria-label="بررسی تیکت Jira" title="برای استعلام تیکت ابتدا یک ردیف را انتخاب کنید">
                        <span>🎫</span>
                        <span>بررسی تیکت Jira</span>
                    </button>
                </div>
            </div>

            <div class="cx-bar-divider" aria-hidden="true"></div>

            <div class="cx-utilities-group">
                <button class="cx-settings-toggle" id="cx-settings-toggle-bar" aria-label="تنظیمات افزونه" title="تنظیمات افزونه">⚙️</button>
                <button class="cx-theme-toggle" id="cx-theme-toggle-bar" aria-label="${themeAriaLabel}" title="${themeAriaLabel}">${themeIcon}</button>
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

    // Clean up any legacy pending filter style if present
    const legacyPendingStyle = document.getElementById('cx-pending-filter-style');
    if (legacyPendingStyle) legacyPendingStyle.remove();

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

    // Reset active row selection on SPA route changes
    function resetActiveSelection() {
        activeCustomerName = '';
        activeCustomerPhone = '';
        activeCustomerWaybill = '';
        currentJiraSeq++;
        closeJiraDropdown();

        const root = typeof getExtensionRoot === 'function' ? getExtensionRoot() : null;
        if (!root) return;

        const nameHeader = root.querySelector('#chapar-name');
        if (nameHeader) nameHeader.innerText = '👇 روی ردیف کلیک کنید 👇';

        const orderChip = root.querySelector('#cx-order-chip');
        if (orderChip) {
            orderChip.style.display = 'none';
            orderChip.innerText = '';
        }

        currentRoutingSeq++;

        const phoneWidget = root.querySelector('#cx-phone-widget');
        if (phoneWidget) {
            phoneWidget.innerHTML = `<button class="cx-btn-trigger" id="btn-phone" disabled aria-label="شماره موبایل گیرنده" title="شماره موبایل گیرنده">📱 موبایل: منتظر...</button>`;
        } else {
            const btnPhone = root.querySelector('#btn-phone');
            if (btnPhone) {
                btnPhone.disabled = true;
                btnPhone.innerText = '📱 موبایل: منتظر...';
                btnPhone.className = 'cx-btn-trigger';
            }
        }

        const waybillWidget = root.querySelector('#cx-waybill-widget');
        if (waybillWidget) {
            waybillWidget.innerHTML = `<button class="cx-btn-trigger" id="btn-waybill" disabled aria-label="رهگیری بارنامه" title="رهگیری بارنامه">📦 بارنامه: منتظر...</button>`;
        } else {
            const btnWaybill = root.querySelector('#btn-waybill');
            if (btnWaybill) {
                btnWaybill.disabled = true;
                btnWaybill.innerText = '📦 بارنامه: منتظر...';
                btnWaybill.className = 'cx-btn-trigger';
            }
        }

        updateJiraWidgetForSelectedRow('', '', false);

        if (window.CX_SHORTCUTS && typeof window.CX_SHORTCUTS.setOrderContext === 'function') {
            window.CX_SHORTCUTS.setOrderContext({
                orderId: '',
                parcelId: '',
                phone: '',
                waybill: '',
                name: ''
            });
        }
    }

    let lastObservedPath = window.location.pathname;
    function checkRouteChange() {
        if (window.location.pathname !== lastObservedPath) {
            lastObservedPath = window.location.pathname;
            resetActiveSelection();
        }
    }
    window.addEventListener('popstate', checkRouteChange);

    // Keep the panel alive (helps against React re-renders wiping the DOM)
    setInterval(() => {
        checkRouteChange();
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

                // Scan parcelId
                if (!entry.parcelId) {
                    const isParcelPage = window.location.pathname.startsWith('/parcel');
                    const parcelFields = isParcelPage
                        ? ['parcelId', 'id']
                        : ['parcelId', 'parcel_id', 'consignmentId', 'shipmentId'];
                    for (const field of parcelFields) {
                        const cell = row.querySelector(`[data-field="${field}"]`);
                        if (cell) {
                            const content = cell.querySelector('.MuiDataGrid-cellContent');
                            const text = (content ? content.innerText : cell.innerText).trim();
                            if (text && /^\d+$/.test(text)) {
                                entry.parcelId = text;
                                entry.updatedAt = Date.now();
                                break;
                            }
                        }
                    }
                }

                // Scan customer name
                if (!entry.name) {
                    for (const field of FIELDS.name) {
                        const cell = row.querySelector(`[data-field="${field}"]`);
                        if (cell) {
                            const content = cell.querySelector('.MuiDataGrid-cellContent');
                            const text = (content ? content.innerText : cell.innerText).trim();
                            if (text && text.length > 1) {
                                entry.name = text;
                                entry.updatedAt = Date.now();
                                break;
                            }
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
     * Synchronizes pending payment filter state with injected-main.js (MAIN world).
     * Filter runs at the MUI DataGrid data model layer to guarantee exact virtualization sizing,
     * zero vertical gap on detail panel expansion, and full preservation of all non-pending orders.
     */
    function filterPendingPaymentOrders() {
        window.dispatchEvent(new CustomEvent('cx-apply-pending-filter'));
    }

    // Listen for manual trigger from settings modal or other components
    window.addEventListener('cx-apply-pending-filter', filterPendingPaymentOrders);

    // Update cache immediately on initialization
    updateRowCacheFromDOM();

    // Scroll listener: update row cache when user scrolls through virtualized grid
    let scrollThrottleTimeout = null;
    window.addEventListener('scroll', () => {
        if (scrollThrottleTimeout) return;
        scrollThrottleTimeout = setTimeout(() => {
            scrollThrottleTimeout = null;
            updateRowCacheFromDOM();
        }, 150);
    }, { capture: true, passive: true });

    // Observe DOM mutations to update row cache for shortcuts and tracking
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
        for (let field of FIELDS.name) {
            for (let row of rows) {
                let cell = row.querySelector(`[data-field="${field}"]`);
                if (cell) {
                    let content = cell.querySelector('.MuiDataGrid-cellContent');
                    let text = content ? content.innerText.trim() : cell.innerText.trim();
                    if (text && text.length > 1) return text;
                }
            }
        }
        return 'مشتری انتخاب شد';
    }

    /**
     * Re-binds button state and attaches click listener safely inside a widget container.
     */
    function activateBtn(targetWidget, text, filterType, value, isPostButton = false, btnId = 'btn-waybill') {
        if (!targetWidget) return;
        const btnClass = isPostButton ? 'active-post' : 'active-chapar';

        targetWidget.innerHTML = `
            <button class="cx-btn-trigger ${btnClass}" id="${btnId}" aria-label="${_esc(text)}" title="${_esc(text)}">
                ${_esc(text)}
            </button>
        `;

        const newBtn = targetWidget.querySelector(`#${btnId}`);
        if (!newBtn) return;

        newBtn.addEventListener('click', async (clickEvent) => {
            clickEvent.preventDefault();
            if (newBtn.disabled) return;

            // Always backup to clipboard just in case
            if (navigator.clipboard) {
                navigator.clipboard.writeText(value).catch(err => console.warn("Clipboard failed", err));
            }

            if (isPostButton) {
                chrome.runtime.sendMessage({
                    action: 'OPEN_POST_TAB',
                    query: value
                });
                return;
            }

            // Chapar lookup with loading spinner and exact Jira-parity error badge
            await handleRoutingAction(filterType, value, false, {
                name: activeCustomerName,
                phone: activeCustomerPhone
            }, targetWidget, text, btnId);
        });
    }

    function deactivateBtn(targetWidget, text, btnId = 'btn-waybill') {
        if (!targetWidget) return;
        targetWidget.innerHTML = `
            <button class="cx-btn-trigger" id="${btnId}" disabled aria-label="${_esc(text)}" title="${_esc(text)}">
                ${_esc(text)}
            </button>
        `;
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
        // Discard non-waybill delivery notes (e.g. 'حضوری', 'تحویل حضوری', 'پیک', or placeholders)
        if (/[\u0600-\u06FF]/.test(waybill) || /^(null|undefined|none|n\/a|-+)$/i.test(waybill) || /^([0-9])\1{5,}$/.test(waybill)) {
            waybill = '';
        }

        // 3. Customer Name
        let name = (fiberData && fiberData.name) ? fiberData.name : '';
        if (!name) name = extractName(rowFragments);
        if ((!name || name === 'مشتری انتخاب شد') && cached && cached.name) name = cached.name;
        activeCustomerName = name || 'مشتری انتخاب شد';
        activeCustomerPhone = phone || (cached && cached.phone) || '';
        activeCustomerWaybill = waybill || (cached && cached.waybill) || '';

        // 4. Order ID
        let orderId = (fiberData && fiberData.orderId) ? fiberData.orderId : '';
        if (!orderId) orderId = extractData(rowFragments, FIELDS.order);
        if (!orderId && cached && cached.orderId) orderId = cached.orderId;
        orderId = toAsciiDigits(orderId).trim();

        // 5. Parcel ID
        let parcelId = (fiberData && fiberData.parcelId) ? fiberData.parcelId : '';
        if (!parcelId) {
            const isParcelRoute = window.location.pathname.startsWith('/parcel');
            const domParcelKeys = isParcelRoute ? ['parcelId', 'id'] : ['parcelId', 'parcel_id', 'consignmentId', 'shipmentId'];
            parcelId = extractData(rowFragments, domParcelKeys);
        }
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
                orderChip.style.display = 'inline-flex';
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

        const phoneWidget = root.querySelector('#cx-phone-widget');
        const waybillWidget = root.querySelector('#cx-waybill-widget');

        if (phoneWidget) {
            if (phone.length > 5) activateBtn(phoneWidget, "📱 موبایل: " + phone, 'گیرنده', phone, false, 'btn-phone');
            else deactivateBtn(phoneWidget, "📱 موبایل: ندارد", 'btn-phone');
        }

        if (waybillWidget) {
            // HYBRID ROUTING LOGIC (Prefix Scanner & Contextual Classifier)
            if (waybill.length > 2) {
                if (waybill.startsWith('5410') || waybill.startsWith('5480') || waybill.startsWith('6410') || waybill.startsWith('54') || waybill.startsWith('64')) {
                    // Route to Chapar Tracking Engine
                    activateBtn(waybillWidget, "📦 چاپار: " + waybill, 'ConsignmentNo', waybill, false, 'btn-waybill');
                } else {
                    // Route to Iran Post Ghost Robot
                    activateBtn(waybillWidget, "📦 پست: " + waybill, null, waybill, true, 'btn-waybill');
                }
            } else {
                deactivateBtn(waybillWidget, "📦 بارنامه: ندارد", 'btn-waybill');
            }
        }

        // 3. Jira Ticket Lookup Widget
        updateJiraWidgetForSelectedRow(parcelId, waybill, true);
    });

    // ==========================================
    // 4. THE API BRIDGE DISPATCHER & CHAPAR UX
    // ==========================================
    function renderChaparErrorState(widget, errorObj, filterType, value, originalText, btnId, contextSnapshot) {
        if (!widget) return;
        const errType = errorObj?.error || 'UNKNOWN';
        const msg = errorObj?.message || 'خطا در ارتباط با سرور چاپار';

        if (errType === 'AUTH_REQUIRED') {
            widget.innerHTML = `
                <div class="cx-jira-error-badge" title="${_esc(msg)}">
                    <span>⚠️ نیاز به ورود</span>
                    <button class="cx-jira-login-btn" id="${btnId}-login" aria-label="ورود به پورتال چاپار">ورود ↗</button>
                    <button class="cx-jira-refresh-btn" id="${btnId}-retry" aria-label="تلاش مجدد برای استعلام چاپار" title="تلاش مجدد">🔄</button>
                </div>
            `;
            const loginBtn = widget.querySelector(`#${btnId}-login`);
            if (loginBtn) {
                loginBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    window.open('https://portal.chaparnet.com', '_blank');
                });
            }
        } else if (errType === 'PORTAL_UNAVAILABLE') {
            widget.innerHTML = `
                <div class="cx-jira-error-badge" title="${_esc(msg)}">
                    <span>⚠️ پورتال چاپار در دسترس نیست</span>
                    <button class="cx-jira-refresh-btn" id="${btnId}-retry" aria-label="تلاش مجدد برای استعلام چاپار" title="تلاش مجدد">🔄</button>
                </div>
            `;
        } else if (errType === 'NOT_FOUND') {
            widget.innerHTML = `
                <div class="cx-jira-empty-badge" title="${_esc(msg || 'شماره در چاپار یافت نشد')}">
                    <span>شماره در چاپار یافت نشد</span>
                    <button class="cx-jira-refresh-btn" id="${btnId}-retry" aria-label="تلاش مجدد برای استعلام چاپار" title="تلاش مجدد">🔄</button>
                </div>
            `;
        } else {
            widget.innerHTML = `
                <div class="cx-jira-error-badge" title="${_esc(msg)}">
                    <span>⚠️ خطا در ارتباط با چاپار</span>
                    <button class="cx-jira-refresh-btn" id="${btnId}-retry" aria-label="تلاش مجدد برای استعلام چاپار" title="تلاش مجدد">🔄</button>
                </div>
            `;
        }

        const retryBtn = widget.querySelector(`#${btnId}-retry`);
        if (retryBtn) {
            retryBtn.addEventListener('click', (e) => {
                e.preventDefault();
                handleRoutingAction(filterType, value, false, contextSnapshot, widget, originalText, btnId, true);
            });
        }
    }

    async function handleRoutingAction(filterType, value, isPostRoute, contextSnapshot = null, targetWidget = null, originalBtnText = null, targetBtnId = null, forceRefresh = false) {
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

        const root = typeof getExtensionRoot === 'function' ? getExtensionRoot() : null;
        const widget = targetWidget || (root ? (filterType === 'گیرنده' ? root.querySelector('#cx-phone-widget') : root.querySelector('#cx-waybill-widget')) : null);
        const btnId = targetBtnId || (filterType === 'گیرنده' ? 'btn-phone' : 'btn-waybill');
        const defaultText = filterType === 'گیرنده' ? `📱 موبایل: ${targetValue}` : `📦 چاپار: ${targetValue}`;
        const originalText = originalBtnText || defaultText;

        // Render Loading State on the widget matching Jira loading pattern
        if (widget) {
            widget.innerHTML = `
                <button class="cx-btn-trigger active-chapar loading" disabled aria-busy="true" aria-label="در حال بررسی چاپار...">
                    <div class="cx-spinner"></div>
                    <span>در حال بررسی چاپار...</span>
                </button>
            `;
        }

        try {
            // Task: Chapar -> Tell background script to execute silent fetch
            const response = await new Promise(resolve => {
                chrome.runtime.sendMessage({
                    action: 'FETCH_CHAPAR',
                    type: filterType,
                    query: targetValue,
                    phone: targetPhone,
                    name: targetCustomerName,
                    forceRefresh: forceRefresh
                }, resolve);
            });

            // STALE CANCELLATION GUARD:
            // If the user clicked another row or triggered another search while this request was in flight, discard!
            if (thisSeq !== currentRoutingSeq) {
                console.warn('[Delivery Assistant] Stale Chapar request discarded:', { thisSeq, currentRoutingSeq, targetValue });
                return;
            }

            // Handle Response
            if (!response || !response.success) {
                if (widget) {
                    renderChaparErrorState(widget, response, filterType, targetValue, originalText, btnId, contextSnapshot);
                } else if (response && response.error === 'AUTH_REQUIRED') {
                    if (typeof renderAuthErrorModal === 'function') {
                        renderAuthErrorModal();
                    } else {
                        alert('لطفا وارد حساب چاپار شوید.');
                    }
                } else if (response && response.error === 'NOT_FOUND') {
                    alert('شماره در چاپار یافت نشد');
                } else {
                    alert('خطا در ارتباط با سرور چاپار: ' + (response?.error || 'Unknown Error'));
                }
                return;
            }

            // Success: Restore operational button state
            if (widget) {
                widget.innerHTML = `
                    <button class="cx-btn-trigger active-chapar" id="${btnId}" aria-label="${_esc(originalText)}" title="${_esc(originalText)}">
                        ${_esc(originalText)}
                    </button>
                `;
                const restoredBtn = widget.querySelector(`#${btnId}`);
                if (restoredBtn) {
                    restoredBtn.addEventListener('click', (e) => {
                        e.preventDefault();
                        if (navigator.clipboard) {
                            navigator.clipboard.writeText(targetValue).catch(err => console.warn("Clipboard failed", err));
                        }
                        handleRoutingAction(filterType, targetValue, false, contextSnapshot, widget, originalText, btnId);
                    });
                }
            }

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
        } catch (err) {
            if (thisSeq !== currentRoutingSeq) return;
            if (widget) {
                renderChaparErrorState(widget, { error: 'EXCEPTION', message: err.message }, filterType, targetValue, originalText, btnId, contextSnapshot);
            } else {
                alert('خطا در ارتباط با سرور چاپار: ' + err.message);
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

    // ==========================================
    // 5. JIRA TICKET LOOKUP & ADAPTIVE UX
    // ==========================================
    let currentJiraSeq = 0;
    let activeJiraSelection = { parcelId: '', waybill: '' };

    function getStatusBadgeClass(ticket) {
        if (!ticket) return 'status-unknown';
        const cat = (ticket.statusCategory || '').toLowerCase();
        const statusText = (ticket.status || '').toLowerCase();

        if (ticket.isResolved || cat === 'done' || statusText.includes('done') || statusText.includes('بسته')) {
            return 'status-done';
        }
        if (cat === 'indeterminate' || cat === 'inprogress' || statusText.includes('progress') || statusText.includes('waiting') || statusText.includes('بررسی') || statusText.includes('انجام')) {
            return 'status-inprogress';
        }
        if (statusText.includes('reject') || statusText.includes('رد')) {
            return 'status-rejected';
        }
        if (cat === 'new' || statusText.includes('to do') || statusText.includes('open') || statusText.includes('باز')) {
            return 'status-new';
        }
        return 'status-unknown';
    }

    function openJiraTicket(key) {
        if (!key || typeof key !== 'string') return;
        const cleanKey = key.trim();
        if (!/^[A-Z0-9]+-\d+$/.test(cleanKey)) {
            console.error('[Delivery Assistant] Invalid Jira key format:', cleanKey);
            return;
        }
        const url = `https://jira.automoby.ir/browse/${encodeURIComponent(cleanKey)}`;
        chrome.runtime.sendMessage({ action: 'OPEN_JIRA_TAB', url });
    }

    function closeJiraDropdown() {
        const root = typeof getExtensionRoot === 'function' ? getExtensionRoot() : null;
        if (!root) return;
        const menu = root.querySelector('#cx-jira-menu');
        const toggleBtn = root.querySelector('#btn-jira-dropdown-toggle');
        if (menu) {
            menu.style.display = 'none';
        }
        if (toggleBtn) {
            toggleBtn.setAttribute('aria-expanded', 'false');
        }
    }

    // Close dropdown on outside click or Escape key
    document.addEventListener('click', (e) => {
        const root = typeof getExtensionRoot === 'function' ? getExtensionRoot() : null;
        if (!root) return;
        const widget = root.querySelector('#cx-jira-widget');
        if (widget && !e.composedPath().includes(widget)) {
            closeJiraDropdown();
        }
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeJiraDropdown();
        }
    });

    function updateJiraWidgetForSelectedRow(parcelId, waybill, hasSelectedRow = true) {
        // Increment sequence to invalidate any pending in-flight response
        currentJiraSeq++;
        closeJiraDropdown();

        const validParcel = parcelId && !/[\u0600-\u06FF]/.test(parcelId) && !/^(null|undefined|none|n\/a|-+)$/i.test(parcelId) ? parcelId : '';
        const validWaybill = waybill && !/[\u0600-\u06FF]/.test(waybill) && !/^(null|undefined|none|n\/a|-+)$/i.test(waybill) ? waybill : '';
        activeJiraSelection = { parcelId: validParcel, waybill: validWaybill };

        const root = typeof getExtensionRoot === 'function' ? getExtensionRoot() : null;
        if (!root) return;
        const widget = root.querySelector('#cx-jira-widget');
        if (!widget) return;

        const hasShipmentId = !!(validParcel || validWaybill);
        if (!hasShipmentId) {
            const label = hasSelectedRow ? 'شماره مرسوله ناموجود' : 'بررسی تیکت Jira';
            const tooltip = hasSelectedRow
                ? 'شماره مرسوله یا بارنامه برای این رکورد یافت نشد'
                : 'برای استعلام تیکت ابتدا یک ردیف را انتخاب کنید';
            widget.innerHTML = `
                <button class="cx-btn-trigger btn-jira" id="btn-jira-lookup" disabled aria-label="${_esc(label)}" title="${_esc(tooltip)}">
                    <span>🎫</span>
                    <span>${_esc(label)}</span>
                </button>
            `;
            return;
        }

        const displayTarget = validParcel || validWaybill;
        widget.innerHTML = `
            <button class="cx-btn-trigger btn-jira active-jira" id="btn-jira-lookup" aria-label="بررسی تیکت Jira برای مرسوله ${_esc(displayTarget)}" title="بررسی تیکت Jira برای مرسوله ${_esc(displayTarget)}">
                <span>🎫</span>
                <span>بررسی تیکت Jira</span>
            </button>
        `;

        const btn = widget.querySelector('#btn-jira-lookup');
        if (btn) {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                performJiraLookup(validParcel, validWaybill);
            });
        }
    }

    async function performJiraLookup(parcelId, waybill) {
        const thisSeq = ++currentJiraSeq;
        closeJiraDropdown();

        const root = typeof getExtensionRoot === 'function' ? getExtensionRoot() : null;
        if (!root) return;
        const widget = root.querySelector('#cx-jira-widget');
        if (!widget) return;

        const cleanParcel = parcelId && !/[\u0600-\u06FF]/.test(parcelId) && !/^(null|undefined|none|n\/a|-+)$/i.test(parcelId) ? String(parcelId).trim() : '';
        const cleanWaybill = waybill && !/[\u0600-\u06FF]/.test(waybill) && !/^(null|undefined|none|n\/a|-+)$/i.test(waybill) ? String(waybill).trim() : '';

        if (!cleanParcel && !cleanWaybill) {
            widget.innerHTML = `
                <div class="cx-jira-empty-badge" title="امکان استخراج شماره مرسوله وجود ندارد">
                    <span>شماره مرسوله پیدا نشد</span>
                </div>
            `;
            return;
        }

        // Render Loading State (accessible and prevents duplicate requests)
        widget.innerHTML = `
            <button class="cx-btn-trigger btn-jira loading" disabled aria-busy="true" aria-label="در حال استعلام Jira">
                <div class="cx-spinner cx-spinner-blue"></div>
                <span>در حال بررسی Jira...</span>
            </button>
        `;

        try {
            const response = await new Promise(resolve => {
                chrome.runtime.sendMessage({
                    action: 'JIRA_SEARCH_TICKETS',
                    parcelId: cleanParcel,
                    waybill: cleanWaybill
                }, resolve);
            });

            // STALE CANCELLATION GUARD:
            // If the user clicked another order row or triggered another lookup while in flight, discard!
            if (thisSeq !== currentJiraSeq) {
                console.warn('[Delivery Assistant] Stale Jira response discarded:', { thisSeq, currentJiraSeq });
                return;
            }

            if (!response || !response.success) {
                renderJiraErrorState(widget, response, parcelId, waybill);
                return;
            }

            const tickets = response.tickets || [];
            renderJiraResultsState(widget, tickets, parcelId, waybill, response.isIncomplete);
        } catch (err) {
            if (thisSeq !== currentJiraSeq) return;
            renderJiraErrorState(widget, { error: 'EXCEPTION', message: err.message }, parcelId, waybill);
        }
    }

    function renderJiraErrorState(widget, errorObj, parcelId, waybill) {
        if (!widget) return;
        const errType = errorObj?.error || 'UNKNOWN';
        const msg = errorObj?.message || 'خطا در ارتباط با Jira';

        if (errType === 'MISSING_SHIPMENT_NUMBER') {
            widget.innerHTML = `
                <div class="cx-jira-empty-badge" title="${_esc(msg)}">
                    <span>شماره مرسوله پیدا نشد</span>
                </div>
            `;
            return;
        }

        let labelText = '⚠️ خطا در ارتباط با Jira';
        if (errType === 'AUTH_REQUIRED') {
            labelText = '⚠️ نیاز به ورود Jira';
        } else if (errType === 'FORBIDDEN') {
            labelText = '⚠️ عدم دسترسی به Jira';
        }

        widget.innerHTML = `
            <div class="cx-jira-error-badge" title="${_esc(msg)}">
                <span>${_esc(labelText)}</span>
                <button class="cx-jira-login-btn" id="btn-jira-login" aria-label="ورود به سامانه Jira">ورود ↗</button>
                <button class="cx-jira-refresh-btn" id="btn-jira-retry" aria-label="تلاش مجدد برای استعلام Jira" title="تلاش مجدد">🔄</button>
            </div>
        `;

        const loginBtn = widget.querySelector('#btn-jira-login');
        if (loginBtn) {
            loginBtn.addEventListener('click', (e) => {
                e.preventDefault();
                window.open('https://jira.automoby.ir/login.jsp', '_blank');
            });
        }

        const retryBtn = widget.querySelector('#btn-jira-retry');
        if (retryBtn) {
            retryBtn.addEventListener('click', (e) => {
                e.preventDefault();
                performJiraLookup(parcelId, waybill);
            });
        }
    }

    function renderJiraResultsState(widget, tickets, parcelId, waybill, isIncomplete = false) {
        // Case C: 0 Matching Tickets
        if (tickets.length === 0) {
            if (isIncomplete) {
                widget.innerHTML = `
                    <div class="cx-jira-error-badge" title="نتایج جستوجو به دلیل محدودیت سرور کامل نیست">
                        <span>نتایج جستوجو کامل نیست</span>
                        <button class="cx-jira-refresh-btn" id="btn-jira-refresh" aria-label="استعلام مجدد Jira" title="استعلام مجدد">🔄</button>
                    </div>
                `;
            } else {
                widget.innerHTML = `
                    <div class="cx-jira-empty-badge" title="هیچ تیکتی برای این مرسوله در Jira ثبت نشده است">
                        <span>فاقد تیکت Jira</span>
                        <button class="cx-jira-refresh-btn" id="btn-jira-refresh" aria-label="استعلام مجدد Jira" title="استعلام مجدد">🔄</button>
                    </div>
                `;
            }
            const refreshBtn = widget.querySelector('#btn-jira-refresh');
            if (refreshBtn) {
                refreshBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    performJiraLookup(parcelId, waybill);
                });
            }
            return;
        }

        // Case A: Exactly 1 Matching Ticket
        if (tickets.length === 1) {
            const t = tickets[0];
            const badgeClass = getStatusBadgeClass(t);
            const statusLabel = _esc(t.status || 'وضعیت نامشخص');
            const tooltip = `تیکت: ${t.key}\nوضعیت: ${t.status}${t.resolution ? ' (' + t.resolution + ')' : ''}${t.summary ? '\nخلاصه: ' + t.summary : ''}`;

            widget.innerHTML = `
                <button class="cx-btn-trigger btn-jira btn-jira-ticket" id="btn-jira-ticket-single" aria-label="مشاهده تیکت ${t.key}، وضعیت: ${statusLabel}" title="${_esc(tooltip)}">
                    <span class="cx-jira-key ${t.isResolved ? 'cx-jira-resolved' : ''}">${_esc(t.key)}</span>
                    <span class="cx-jira-sep">—</span>
                    <span class="cx-jira-status-badge ${badgeClass}">${statusLabel}</span>
                </button>
                <button class="cx-jira-refresh-btn" id="btn-jira-refresh" aria-label="استعلام مجدد Jira" title="استعلام مجدد">🔄</button>
            `;

            const ticketBtn = widget.querySelector('#btn-jira-ticket-single');
            if (ticketBtn) {
                ticketBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    openJiraTicket(t.key);
                });
            }

            const refreshBtn = widget.querySelector('#btn-jira-refresh');
            if (refreshBtn) {
                refreshBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    performJiraLookup(parcelId, waybill);
                });
            }
            return;
        }

        // Case B: Multiple Matching Tickets (2 or more)
        const countLabel = tickets.length + (isIncomplete ? '+' : '');
        widget.innerHTML = `
            <button class="cx-btn-trigger btn-jira btn-jira-multi" id="btn-jira-dropdown-toggle" aria-expanded="false" aria-haspopup="listbox" aria-label="تیکت‌های Jira (${countLabel} مورد)" title="کلیک برای مشاهده لیست تیکت‌ها">
                <span>🎫</span>
                <span>${countLabel} تیکت Jira ▼</span>
            </button>
            <button class="cx-jira-refresh-btn" id="btn-jira-refresh" aria-label="استعلام مجدد Jira" title="استعلام مجدد">🔄</button>
            <div class="cx-jira-menu" id="cx-jira-menu" role="listbox" style="display: none;" aria-label="لیست تیکت‌های یافت شده">
                <div class="cx-jira-menu-header-bar">
                    <span>تیکت‌های مرتبط (${countLabel})</span>
                    <span style="font-size: 10px; opacity: 0.7;">برای باز کردن تیکت کلیک کنید</span>
                </div>
                ${tickets.map((t) => {
                    const bClass = getStatusBadgeClass(t);
                    const sLabel = _esc(t.status || 'وضعیت نامشخص');
                    return `
                        <div class="cx-jira-menu-item" role="option" tabindex="0" data-key="${_esc(t.key)}" aria-label="تیکت ${t.key}، وضعیت: ${sLabel}${t.summary ? '، خلاصه: ' + _esc(t.summary) : ''}">
                            <div class="cx-jira-item-top">
                                <span class="cx-jira-key ${t.isResolved ? 'cx-jira-resolved' : ''}">${_esc(t.key)}</span>
                                <span class="cx-jira-status-badge ${bClass}">${sLabel}</span>
                            </div>
                            ${t.summary ? `<div class="cx-jira-item-summary" title="${_esc(t.summary)}">${_esc(t.summary)}</div>` : ''}
                        </div>
                    `;
                }).join('')}
            </div>
        `;

        const toggleBtn = widget.querySelector('#btn-jira-dropdown-toggle');
        const menu = widget.querySelector('#cx-jira-menu');

        if (toggleBtn && menu) {
            toggleBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const isOpen = menu.style.display !== 'none';
                if (isOpen) {
                    menu.style.display = 'none';
                    toggleBtn.setAttribute('aria-expanded', 'false');
                } else {
                    menu.style.display = 'flex';
                    toggleBtn.setAttribute('aria-expanded', 'true');
                    const firstItem = menu.querySelector('.cx-jira-menu-item');
                    if (firstItem) firstItem.focus();
                }
            });
        }

        // Attach item click and keyboard handlers
        const items = widget.querySelectorAll('.cx-jira-menu-item');
        items.forEach((item, index) => {
            const key = item.getAttribute('data-key');
            item.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                closeJiraDropdown();
                openJiraTicket(key);
            });

            item.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    closeJiraDropdown();
                    openJiraTicket(key);
                } else if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    const next = items[index + 1] || items[0];
                    if (next) next.focus();
                } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    const prev = items[index - 1] || items[items.length - 1];
                    if (prev) prev.focus();
                }
            });
        });

        const refreshBtn = widget.querySelector('#btn-jira-refresh');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', (e) => {
                e.preventDefault();
                performJiraLookup(parcelId, waybill);
            });
        }
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
        const allowedTypes = ['ConsignmentNo', 'گیرنده', 'TEST_RENDER_MODAL', 'TEST_JIRA_LOOKUP', 'TEST_POST_ACTION', 'TEST_CHAPAR_LOOKUP'];
        if (!allowedTypes.includes(type)) return;

        if (type === 'TEST_POST_ACTION') {
            const trackingNo = document.documentElement.getAttribute('data-cx-test-query') || '';
            chrome.runtime.sendMessage({
                action: 'OPEN_POST_TAB',
                query: trackingNo
            }, (res) => {
                document.documentElement.setAttribute('data-cx-test-status', res?.success ? 'completed' : 'error: ' + (res?.error || 'unknown'));
            });
            return;
        }

        if (type === 'TEST_JIRA_LOOKUP') {
            const parcelId = document.documentElement.getAttribute('data-cx-test-parcel-id') || '';
            const waybill = document.documentElement.getAttribute('data-cx-test-waybill') || '';
            updateJiraWidgetForSelectedRow(parcelId, waybill, true);
            await performJiraLookup(parcelId, waybill);
            document.documentElement.setAttribute('data-cx-test-status', 'completed');
            return;
        }

        if (type === 'TEST_CHAPAR_LOOKUP') {
            const waybill = document.documentElement.getAttribute('data-cx-test-waybill') || '54807199275779101';
            const phone = document.documentElement.getAttribute('data-cx-test-phone') || '';
            const root = typeof getExtensionRoot === 'function' ? getExtensionRoot() : null;
            const waybillWidget = root ? root.querySelector('#cx-waybill-widget') : null;
            if (waybillWidget) {
                activateBtn(waybillWidget, "📦 چاپار: " + waybill, 'ConsignmentNo', waybill, false, 'btn-waybill');
                await handleRoutingAction('ConsignmentNo', waybill, false, { name: name || 'تست', phone: phone }, waybillWidget, "📦 چاپار: " + waybill, 'btn-waybill');
            }
            document.documentElement.setAttribute('data-cx-test-status', 'completed');
            return;
        }

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

    // ==========================================
    // 5. PROMPT CHAPAR AUTHENTICATION RESTORATION
    // ==========================================
    function restoreChaparButtonIfInErrorState() {
        const root = typeof getExtensionRoot === 'function' ? getExtensionRoot() : null;
        if (!root) return;

        const waybillWidget = root.querySelector('#cx-waybill-widget');
        if (waybillWidget && waybillWidget.querySelector('.cx-jira-error-badge')) {
            if (activeCustomerWaybill && activeCustomerWaybill.length > 2) {
                if (activeCustomerWaybill.startsWith('5410') || activeCustomerWaybill.startsWith('5480') || activeCustomerWaybill.startsWith('6410') || activeCustomerWaybill.startsWith('54') || activeCustomerWaybill.startsWith('64')) {
                    activateBtn(waybillWidget, "📦 چاپار: " + activeCustomerWaybill, 'ConsignmentNo', activeCustomerWaybill, false, 'btn-waybill');
                } else {
                    activateBtn(waybillWidget, "📦 پست: " + activeCustomerWaybill, null, activeCustomerWaybill, true, 'btn-waybill');
                }
            } else {
                deactivateBtn(waybillWidget, "📦 بارنامه: منتظر...", 'btn-waybill');
            }
        }

        const phoneWidget = root.querySelector('#cx-phone-widget');
        if (phoneWidget && phoneWidget.querySelector('.cx-jira-error-badge')) {
            if (activeCustomerPhone && activeCustomerPhone.length > 5) {
                activateBtn(phoneWidget, "📱 موبایل: " + activeCustomerPhone, 'گیرنده', activeCustomerPhone, false, 'btn-phone');
            } else {
                deactivateBtn(phoneWidget, "📱 موبایل: منتظر...", 'btn-phone');
            }
        }
    }

    // Real-time listener for Chapar authentication state transitions
    chrome.runtime.onMessage.addListener((msg) => {
        if (msg && msg.action === 'CHAPAR_AUTH_UPDATED') {
            if (msg.isAuthenticated) {
                restoreChaparButtonIfInErrorState();
            }
        }
    });

    // Check auth status promptly when user focuses back to the Automoby tab (without page reload)
    window.addEventListener('focus', () => {
        const root = typeof getExtensionRoot === 'function' ? getExtensionRoot() : null;
        if (!root) return;
        const hasChaparError = !!(root.querySelector('#cx-waybill-widget .cx-jira-error-badge') || root.querySelector('#cx-phone-widget .cx-jira-error-badge'));
        if (hasChaparError) {
            chrome.runtime.sendMessage({ action: 'CHECK_CHAPAR_AUTH', forceRefresh: false }, (res) => {
                if (chrome.runtime.lastError || !res) return;
                if (res.isAuthenticated || res.state === 'AUTHENTICATED') {
                    restoreChaparButtonIfInErrorState();
                }
            });
        }
    });

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            const root = typeof getExtensionRoot === 'function' ? getExtensionRoot() : null;
            if (!root) return;
            const hasChaparError = !!(root.querySelector('#cx-waybill-widget .cx-jira-error-badge') || root.querySelector('#cx-phone-widget .cx-jira-error-badge'));
            if (hasChaparError) {
                chrome.runtime.sendMessage({ action: 'CHECK_CHAPAR_AUTH', forceRefresh: false }, (res) => {
                    if (chrome.runtime.lastError || !res) return;
                    if (res.isAuthenticated || res.state === 'AUTHENTICATED') {
                        restoreChaparButtonIfInErrorState();
                    }
                });
            }
        }
    });

})();
