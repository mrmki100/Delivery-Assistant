/**
 * shortcuts.js
 * 
 * Reusable, extensible, and safe Context & Shortcut system for Automoby.
 * 
 * Core Architectural Principles:
 * 1. STRICT READ-ONLY: Never click destructive buttons, never submit forms, never mutate data.
 * 2. SHARED CONTEXT: Holds structured active record { seq, orderId, parcelId, phone, waybill, name }.
 * 3. BACKGROUND STATUS CHECKING: Reads GraphQL endpoints without page reloads to show status badges.
 * 4. STALE CANCELLATION: Rejects out-of-order async responses when the operator selects a new row.
 * 5. SAFE IN-TAB NAVIGATION: Navigates inside the SPA using sidebar router elements; never opens redundant tabs.
 * 6. USER CONFIGURABLE: Persists enabled shortcuts in chrome.storage.local.
 */

(function(window) {
    'use strict';

    // ==========================================
    // 1. SHORTCUT REGISTRY
    // ==========================================
    const SHORTCUT_REGISTRY = [
        {
            id: 'returns',
            title: 'مرجوعی',
            icon: '🔄',
            route: '/returns/',
            defaultEnabled: true,
            supportedKeys: ['orderId'],
            description: 'لیست مرجوعی‌های کالا و وضعیت استرداد قطعه',
            checkStatus: async (context, token) => {
                if (!context.orderId) return { state: 'idle', label: 'بدون سفارش' };
                try {
                    const res = await fetch('https://api.automoby.ir/graphql', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': 'Bearer ' + token
                        },
                        body: JSON.stringify({
                            operationName: 'getReturnListGeneralTable',
                            query: `query getReturnListGeneralTable($query: ReturnItemListInput!) {
                                getReturnListGeneralTable(query: $query) {
                                    total
                                    count
                                    data { id returnId state refundState }
                                }
                            }`,
                            variables: {
                                query: {
                                    orderId: parseInt(context.orderId, 10),
                                    pagination: { page: 0, limit: 5 }
                                }
                            }
                        })
                    });
                    const json = await res.json();
                    const total = json?.data?.getReturnListGeneralTable?.total || 0;
                    if (total > 0) {
                        return {
                            state: 'active',
                            hasRecord: true,
                            count: total,
                            badgeText: `${total} مرجوعی`,
                            statusLabel: 'مرجوعی فعال دارد',
                            tooltip: `${total} رکورد مرجوعی برای این سفارش ثبت شده است`
                        };
                    } else {
                        return {
                            state: 'none',
                            hasRecord: false,
                            count: 0,
                            badgeText: 'فاقد مرجوعی',
                            statusLabel: 'مرجوعی فعالی ندارد',
                            tooltip: 'هیچ مرجوعی برای این سفارش ثبت نشده است'
                        };
                    }
                } catch (e) {
                    return { state: 'error', badgeText: 'خطای استعلام', statusLabel: 'خطا در ارتباط', tooltip: e.message };
                }
            },
            fillSearch: (context) => {
                const input = document.querySelector('input[placeholder="شماره سفارش"]');
                if (!input || !context.orderId) return false;
                safeFillInput(input, context.orderId);
                return true;
            }
        },
        {
            id: 'manual_refunds',
            title: 'من و ریفاند',
            icon: '💳',
            route: '/manual-refunds/',
            defaultEnabled: true,
            supportedKeys: ['orderId'],
            description: 'لیست درخواست‌ها و سوابق استرداد وجه دستی',
            checkStatus: async (context, token) => {
                if (!context.orderId) return { state: 'idle', label: 'بدون سفارش' };
                try {
                    const res = await fetch('https://api.automoby.ir/graphql', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': 'Bearer ' + token
                        },
                        body: JSON.stringify({
                            operationName: 'adminManualRefunds',
                            query: `query adminManualRefunds($page: Int!, $limit: Int!, $orderId: Int) {
                                adminManualRefunds(page: $page, limit: $limit, orderId: $orderId) {
                                    total
                                    items { id state amount }
                                }
                            }`,
                            variables: {
                                page: 1,
                                limit: 5,
                                orderId: parseInt(context.orderId, 10)
                            }
                        })
                    });
                    const json = await res.json();
                    const total = json?.data?.adminManualRefunds?.total || 0;
                    const items = json?.data?.adminManualRefunds?.items || [];
                    if (total > 0) {
                        const pending = items.find(i => i.state === 'PENDING_REFUND');
                        return {
                            state: 'active',
                            hasRecord: true,
                            count: total,
                            badgeText: `${total} ریفاند`,
                            statusLabel: pending ? 'در انتظار ریفاند' : 'دارای ریفاند',
                            tooltip: `${total} مورد بازپرداخت (آخرین وضعیت: ${pending ? 'در انتظار' : 'پرداخت/رد شده'})`
                        };
                    } else {
                        return {
                            state: 'none',
                            hasRecord: false,
                            count: 0,
                            badgeText: 'فاقد ریفاند',
                            statusLabel: 'استردادی ندارد',
                            tooltip: 'هیچ استرداد وجهی برای این سفارش ثبت نشده است'
                        };
                    }
                } catch (e) {
                    return { state: 'error', badgeText: 'خطای استعلام', statusLabel: 'خطا در ارتباط', tooltip: e.message };
                }
            },
            fillSearch: (context) => {
                const label = Array.from(document.querySelectorAll('label')).find(l => l.innerText?.trim() === 'شماره سفارش');
                const input = label ? document.getElementById(label.getAttribute('for')) 
                           : (document.getElementById(':rmt:') || document.querySelector('input[type="text"]:not([placeholder*="فروشنده"])'));
                if (!input || !context.orderId) return false;
                safeFillInput(input, context.orderId);
                return true;
            }
        },
        {
            id: 'admin_orders',
            title: 'سفارشات ادمین',
            icon: '📋',
            route: '/parcel/',
            defaultEnabled: true,
            supportedKeys: ['orderId', 'phone', 'waybill'],
            description: 'میز کار سفارشات مرسوله و بررسی سفارش در جریان',
            checkStatus: null, // Always viewable directly
            fillSearch: (context) => {
                const label = Array.from(document.querySelectorAll('label')).find(l => l.innerText?.trim() === 'جست و جو ...');
                const input = label ? document.getElementById(label.getAttribute('for')) 
                           : (document.getElementById(':rq1:') || document.querySelector('input[placeholder*="جست و جو"]'));
                const val = context.orderId || context.phone || context.waybill;
                if (!input || !val) return false;
                safeFillInput(input, val);
                return true;
            }
        },
        {
            id: 'item_cancellations',
            title: 'لغو کالا',
            icon: '🚫',
            route: '/item-cancellation-requests/',
            defaultEnabled: false,
            supportedKeys: ['orderId'],
            description: 'درخواست‌های لغو اقلام سفارش مشتریان',
            checkStatus: null,
            fillSearch: (context) => {
                const input = document.querySelector('input[placeholder*="سفارش"]') || document.querySelector('input[type="text"]');
                if (input && context.orderId) {
                    safeFillInput(input, context.orderId);
                    return true;
                }
                return false;
            }
        },
        {
            id: 'comments',
            title: 'دیدگاه‌ها',
            icon: '💬',
            route: '/commnets/',
            defaultEnabled: false,
            supportedKeys: ['phone'],
            description: 'نظرات و بازخوردهای ثبت شده مشتریان',
            checkStatus: null,
            fillSearch: null
        },
        {
            id: 'products',
            title: 'محصولات',
            icon: '📦',
            route: '/product/',
            defaultEnabled: false,
            supportedKeys: [],
            description: 'کاتالوگ و مدیریت قطعات و کالاها',
            checkStatus: null,
            fillSearch: null
        }
    ];

    // ==========================================
    // 2. ACTIVE CONTEXT STATE
    // ==========================================
    let currentContext = {
        seq: 0,
        orderId: '',
        parcelId: '',
        phone: '',
        waybill: '',
        name: ''
    };

    // Cache of status checks: key is `${shortcutId}_${orderId}` -> statusObj
    const statusCache = new Map();

    // ==========================================
    // 3. SAFE INPUT AUTOFILL UTILITY
    // ==========================================
    function safeFillInput(input, value) {
        if (!input || value == null) return;
        try {
            input.focus();
            const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
            if (setter) {
                setter.call(input, value);
            } else {
                input.value = value;
            }
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));

            // Brief visual highlight to notify user
            input.style.transition = 'box-shadow 0.3s ease, border-color 0.3s ease';
            const prevShadow = input.style.boxShadow;
            const prevBorder = input.style.borderColor;
            input.style.boxShadow = '0 0 0 3px rgba(111, 44, 246, 0.4)';
            input.style.borderColor = '#6F2CF6';
            setTimeout(() => {
                input.style.boxShadow = prevShadow;
                input.style.borderColor = prevBorder;
            }, 1200);
        } catch (e) {
            console.warn('[CX] Failed to safely fill input:', e);
        }
    }

    // ==========================================
    // 4. IN-TAB SAFE NAVIGATION
    // ==========================================
    function getReactFiber(element) {
        if (!element) return null;
        for (const key in element) {
            if (key.startsWith('__reactFiber$') || key.startsWith('__reactInternalInstance$')) {
                return element[key];
            }
        }
        return null;
    }

    function navigateInPanel(targetRoute) {
        const cleanTarget = targetRoute.replace(/\/\*$/, '').replace(/\/$/, '');
        if (window.location.pathname.startsWith(cleanTarget)) {
            return true;
        }

        // 1. Try finding sidebar button by React Fiber item.path
        const buttons = Array.from(document.querySelectorAll('button'));
        for (const btn of buttons) {
            let fiber = getReactFiber(btn);
            while (fiber) {
                if (fiber.memoizedProps?.item?.path) {
                    const itemPath = fiber.memoizedProps.item.path.replace(/\/\*$/, '').replace(/\/$/, '');
                    if (itemPath === cleanTarget || itemPath.startsWith(cleanTarget)) {
                        const li = btn.querySelector('li') || btn;
                        li.click();
                        return true;
                    }
                }
                fiber = fiber.return;
            }
        }

        // 2. Fallback: match by known Persian route titles
        const routeTitles = {
            '/returns/': 'مرجوعی ها',
            '/manual-refunds/': 'من و ریفاند',
            '/parcel/': 'سفارشات ادمین',
            '/item-cancellation-requests/': 'درخواست‌های لغو کالا',
            '/commnets/': 'دیدگاه ها',
            '/product/': 'محصول'
        };
        const title = routeTitles[targetRoute];
        if (title) {
            const btn = buttons.find(b => b.innerText?.trim() === title || b.getAttribute('aria-label') === title);
            if (btn) {
                const li = btn.querySelector('li') || btn;
                li.click();
                return true;
            }
        }

        return false;
    }

    // ==========================================
    // 5. SHORTCUT EXECUTION & PENDING ACTION HANDLER
    // ==========================================
    function triggerShortcut(shortcutId) {
        const shortcut = SHORTCUT_REGISTRY.find(s => s.id === shortcutId);
        if (!shortcut) return;

        const cleanTarget = shortcut.route.replace(/\/\*$/, '').replace(/\/$/, '');
        const isCurrentPage = window.location.pathname.startsWith(cleanTarget);

        if (isCurrentPage) {
            // Already on target page, execute search fill directly
            if (shortcut.fillSearch) {
                shortcut.fillSearch(currentContext);
            }
        } else {
            // Store pending action so it completes once view switches
            try {
                sessionStorage.setItem('cx_pending_shortcut_action', JSON.stringify({
                    shortcutId: shortcut.id,
                    orderId: currentContext.orderId,
                    phone: currentContext.phone,
                    waybill: currentContext.waybill,
                    name: currentContext.name,
                    timestamp: Date.now()
                }));
            } catch (e) {}

            // Navigate in panel
            navigateInPanel(shortcut.route);
        }
    }

    // Process pending shortcut actions after navigation
    function checkPendingAction() {
        try {
            const raw = sessionStorage.getItem('cx_pending_shortcut_action');
            if (!raw) return;

            const pending = JSON.parse(raw);
            // Expire after 20 seconds
            if (Date.now() - pending.timestamp > 20000) {
                sessionStorage.removeItem('cx_pending_shortcut_action');
                return;
            }

            const shortcut = SHORTCUT_REGISTRY.find(s => s.id === pending.shortcutId);
            if (!shortcut) return;

            const cleanTarget = shortcut.route.replace(/\/\*$/, '').replace(/\/$/, '');
            if (window.location.pathname.startsWith(cleanTarget)) {
                if (shortcut.fillSearch) {
                    const filled = shortcut.fillSearch(pending);
                    if (filled) {
                        sessionStorage.removeItem('cx_pending_shortcut_action');
                    }
                }
            }
        } catch (e) {}
    }

    // Continuously check pending action when URL/DOM changes
    setInterval(checkPendingAction, 600);

    // ==========================================
    // 6. USER CONFIGURATION (chrome.storage.local)
    // ==========================================
    async function getEnabledShortcuts() {
        return new Promise(resolve => {
            if (chrome?.storage?.local) {
                chrome.storage.local.get(['cxEnabledShortcuts'], res => {
                    if (res?.cxEnabledShortcuts && Array.isArray(res.cxEnabledShortcuts)) {
                        resolve(res.cxEnabledShortcuts);
                    } else {
                        // Default to returns, manual_refunds, admin_orders
                        resolve(['returns', 'manual_refunds', 'admin_orders']);
                    }
                });
            } else {
                resolve(['returns', 'manual_refunds', 'admin_orders']);
            }
        });
    }

    async function setEnabledShortcuts(ids) {
        return new Promise(resolve => {
            if (chrome?.storage?.local) {
                chrome.storage.local.set({ cxEnabledShortcuts: ids }, () => {
                    resolve();
                });
            } else {
                resolve();
            }
        });
    }

    // ==========================================
    // 7. BACKGROUND STATUS ORCHESTRATOR
    // ==========================================
    let activeStatusListeners = [];

    function onStatusUpdate(fn) {
        activeStatusListeners.push(fn);
    }

    function emitStatusUpdate(shortcutId, status) {
        activeStatusListeners.forEach(fn => {
            try { fn(shortcutId, status); } catch (e) {}
        });
    }

    async function checkAllShortcutStatuses(context) {
        if (!context || !context.orderId) return;
        const thisSeq = context.seq;
        const token = localStorage.getItem('token');
        if (!token) return;

        const enabledIds = await getEnabledShortcuts();

        for (const shortcut of SHORTCUT_REGISTRY) {
            if (!enabledIds.includes(shortcut.id) || !shortcut.checkStatus) continue;

            // Check memory cache first
            const cacheKey = `${shortcut.id}_${context.orderId}`;
            if (statusCache.has(cacheKey)) {
                if (thisSeq === currentContext.seq) {
                    emitStatusUpdate(shortcut.id, statusCache.get(cacheKey));
                }
                continue;
            }

            // Emit loading state
            if (thisSeq === currentContext.seq) {
                emitStatusUpdate(shortcut.id, { state: 'loading', badgeText: 'استعلام...' });
            }

            // Run status check
            shortcut.checkStatus(context, token).then(result => {
                // STALE CANCELLATION: verify this is still the active order
                if (thisSeq !== currentContext.seq) {
                    return; // Stale! Discard immediately
                }
                statusCache.set(cacheKey, result);
                emitStatusUpdate(shortcut.id, result);
            }).catch(err => {
                if (thisSeq === currentContext.seq) {
                    emitStatusUpdate(shortcut.id, { state: 'error', badgeText: 'خطا', tooltip: err.message });
                }
            });
        }
    }

    function setOrderContext(data) {
        currentContext = {
            seq: currentContext.seq + 1,
            orderId: String(data.orderId || '').trim(),
            parcelId: String(data.parcelId || '').trim(),
            phone: String(data.phone || '').trim(),
            waybill: String(data.waybill || '').trim(),
            name: String(data.name || '').trim()
        };

        // Trigger background status check for new context
        checkAllShortcutStatuses(currentContext);

        return currentContext;
    }

    function getOrderContext() {
        return currentContext;
    }

    // Expose public API to window
    window.CX_SHORTCUTS = {
        registry: SHORTCUT_REGISTRY,
        setOrderContext,
        getOrderContext,
        getEnabledShortcuts,
        setEnabledShortcuts,
        triggerShortcut,
        onStatusUpdate,
        safeFillInput,
        navigateInPanel
    };

})(window);
