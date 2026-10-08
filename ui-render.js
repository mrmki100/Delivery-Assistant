/**
 * ui-render.js
 * These functions handle the UI injection and rendering inside the Automoby panel.
 * They should be imported or appended into your main content.js script.
 */

/**
 * Escapes a string for safe interpolation into HTML.
 * Converts &, <, >, ", and ' to their HTML entity equivalents.
 * Returns an empty string for null/undefined input.
 * @param {*} str - The value to escape
 * @returns {string} HTML-safe string
 */
function _esc(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/**
 * Creates and retrieves a Shadow DOM root.
 * This guarantees our Extension CSS does not break or inherit from Automoby's React MuiDataGrid styles.
 */
function getExtensionRoot() {
    let host = document.getElementById('automoby-cx-extension-host');
    
    if (!host) {
        host = document.createElement('div');
        host.id = 'automoby-cx-extension-host';
        host.style.cssText = 'position: fixed; z-index: 2147483647; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none;';
        document.body.appendChild(host);
        
        // Attach Shadow DOM (Open mode allows our script to access it)
        const shadowRoot = host.attachShadow({ mode: 'open' });
        
        // Inject our isolated CSS
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = chrome.runtime.getURL('styles.css');
        shadowRoot.appendChild(link);
        
        // Create the actual container where UI elements will live
        const root = document.createElement('div');
        root.id = 'automoby-cx-extension-root';
        root.style.pointerEvents = 'auto'; // Re-enable clicks for our UI
        shadowRoot.appendChild(root);
        
        // Restore persisted theme on first load
        _restoreTheme(host);
        
        return root;
    }
    
    return host.shadowRoot.getElementById('automoby-cx-extension-root');
}

// ==========================================
// THEME MANAGEMENT
// ==========================================

/**
 * Restores the persisted theme from chrome.storage.local.
 * If no preference is stored, defaults to light mode.
 */
function _restoreTheme(host) {
    if (chrome.storage && chrome.storage.local) {
        chrome.storage.local.get(['cxTheme'], (result) => {
            if (result.cxTheme === 'dark') {
                host.classList.add('cx-dark');
            }
        });
    }
}

/**
 * Toggles between dark and light theme.
 * Persists the choice in chrome.storage.local.
 */
function toggleTheme() {
    const host = document.getElementById('automoby-cx-extension-host');
    if (!host) return;
    
    const isDark = host.classList.toggle('cx-dark');
    
    // Update all toggle button icons in the Shadow DOM
    const root = host.shadowRoot.getElementById('automoby-cx-extension-root');
    if (root) {
        const toggleBtns = root.querySelectorAll('.cx-theme-toggle');
        toggleBtns.forEach(btn => {
            btn.textContent = isDark ? '☀️' : '🌙';
            btn.setAttribute('aria-label', isDark ? 'تغییر به حالت روشن' : 'تغییر به حالت تاریک');
        });
    }
    
    // Persist theme preference
    if (chrome.storage && chrome.storage.local) {
        chrome.storage.local.set({ cxTheme: isDark ? 'dark' : 'light' });
    }
}

/**
 * Returns the current theme icon (☀️ for dark mode, 🌙 for light mode).
 */
function _getThemeIcon() {
    const host = document.getElementById('automoby-cx-extension-host');
    return (host && host.classList.contains('cx-dark')) ? '☀️' : '🌙';
}

/**
 * Returns the current theme aria-label.
 */
function _getThemeAriaLabel() {
    const host = document.getElementById('automoby-cx-extension-host');
    return (host && host.classList.contains('cx-dark')) ? 'تغییر به حالت روشن' : 'تغییر به حالت تاریک';
}

// ==========================================
// MODAL CLOSE HELPERS
// ==========================================

/**
 * Closes a modal overlay with fade-out animation.
 * Cleans up any associated keyboard listeners.
 */
function _closeOverlay(overlay) {
    if (!overlay || overlay._cxClosing) return;
    overlay._cxClosing = true; // Prevent double-close
    overlay.classList.add('cx-modal-fade-out');
    
    // Remove the ESC key listener if one was attached
    if (overlay._cxEscHandler) {
        document.removeEventListener('keydown', overlay._cxEscHandler);
        overlay._cxEscHandler = null;
    }
    
    setTimeout(() => overlay.remove(), 300);
}

/**
 * Attaches backdrop-click and ESC-key close behavior to a modal overlay.
 * - Clicking outside the .cx-modal panel closes the modal.
 * - Pressing Escape closes the modal.
 * - Neither interferes with interactions inside the modal panel.
 * 
 * @param {HTMLElement} overlay - The modal overlay element
 * @param {Function} [closeFn] - Optional custom close function (e.g., for back navigation).
 *                                If not provided, defaults to _closeOverlay(overlay).
 */
function _attachModalCloseBehavior(overlay, closeFn) {
    const doClose = closeFn || (() => _closeOverlay(overlay));
    
    // Backdrop click: close only if the click target is the overlay itself (not a child)
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
            doClose();
        }
    });
    
    // ESC key listener (attached to document so it works regardless of focus)
    const escHandler = (e) => {
        if (e.key === 'Escape') {
            e.preventDefault();
            doClose();
        }
    };
    overlay._cxEscHandler = escHandler;
    document.addEventListener('keydown', escHandler);
}

// ==========================================
// NAVIGATION STATE — for Back button support
// ==========================================

/**
 * Module-level navigation context.
 * Stores the data needed to return to the phone list modal when the user
 * presses "برگشت" from a waybill details view.
 * 
 * Set by renderPhoneListModal before drilling into a specific waybill.
 * Cleared when the user closes all modals.
 */
let _navContext = null;

/**
 * Canonical Chapar Status Taxonomy & Semantic Resolver.
 * Discovered from empirical audit of 1,600+ real production Chapar consignments.
 * Maps operational states to semantic categories, accessible labels, icons, and visual styles.
 */
function resolveChaparStatus(statusInput) {
    if (!statusInput || typeof statusInput !== 'string') {
        return {
            code: 'UNKNOWN',
            labelFa: 'نامشخص',
            badgeClass: 'badge-neutral',
            markerClass: 'marker-neutral',
            icon: '❓',
            category: 'UNKNOWN',
            severity: 'neutral',
            ariaLabel: 'وضعیت نامشخص',
            isTerminal: false
        };
    }

    const clean = statusInput.replace(/<[^>]*>/g, '').trim();
    const codeMatch = clean.match(/^([A-Za-z0-9_-]+)/);
    const code = codeMatch ? codeMatch[1].toUpperCase() : '';

    // 1. DELIVERED (موفق / سبز)
    if (code === 'OK' || clean.includes('سالم تحویل شد') || (clean.includes('تحویل شد') && !clean.includes('عدم تحویل'))) {
        return {
            code: 'OK',
            labelFa: 'سالم تحویل شد',
            badgeClass: 'badge-success',
            markerClass: 'marker-success',
            icon: '✅',
            category: 'DELIVERED',
            severity: 'success',
            ariaLabel: 'وضعیت: تحویل موفق به گیرنده',
            isTerminal: true
        };
    }

    // 2. RETURNED & REJECTED (مرجوعی و بازگشت / قرمز)
    if (code === 'RO' || clean.includes('عودت به مشتری')) {
        return {
            code: 'RO',
            labelFa: 'عودت به مشتری (نهایی)',
            badgeClass: 'badge-danger',
            markerClass: 'marker-danger',
            icon: '↩️',
            category: 'RETURNED',
            severity: 'danger',
            ariaLabel: 'وضعیت: عودت داده شد به مشتری فرستنده (مرجوعی نهایی)',
            isTerminal: true
        };
    }
    if (code === 'RH' || clean.includes('عودت به پیمانکار')) {
        return {
            code: 'RH',
            labelFa: 'عودت به پیمانکار فرستنده',
            badgeClass: 'badge-danger',
            markerClass: 'marker-danger',
            icon: '↩️',
            category: 'RETURNED',
            severity: 'danger',
            ariaLabel: 'وضعیت: در مسیر عودت به فرستنده',
            isTerminal: false
        };
    }
    if (code === 'RCH' || clean.includes('برگشت به سوله مرکزی') || clean.includes('برگشت به سوله')) {
        return {
            code: 'RCH',
            labelFa: 'برگشت به سوله مرکزی',
            badgeClass: 'badge-danger',
            markerClass: 'marker-danger',
            icon: '↩️',
            category: 'RETURNED',
            severity: 'danger',
            ariaLabel: 'وضعیت: برگشت به هاب و سوله مرکزی (عدم تحویل)',
            isTerminal: false
        };
    }
    if (code === 'CR' || clean.includes('امتناع گیرنده') || clean.includes('انصراف گیرنده')) {
        return {
            code: 'CR',
            labelFa: 'امتناع گیرنده از دریافت',
            badgeClass: 'badge-danger',
            markerClass: 'marker-danger',
            icon: '🛑',
            category: 'REJECTED',
            severity: 'danger',
            ariaLabel: 'وضعیت: گیرنده از دریافت کالا امتناع کرد (مرجوعی)',
            isTerminal: false
        };
    }

    // 3. DELIVERY PROBLEMS & DELAYS (مشکل در توزیع و تاخیر / نارنجی)
    if (code === 'NH' || clean.includes('نبود گیرنده') || clean.includes('عدم حضور')) {
        return {
            code: 'NH',
            labelFa: 'عدم حضور گیرنده در محل',
            badgeClass: 'badge-warning',
            markerClass: 'marker-warning',
            icon: '⚠️',
            category: 'DELIVERY_PROBLEM',
            severity: 'warning',
            ariaLabel: 'وضعیت: گیرنده در محل حضور نداشت (نیاز به هماهنگی مجدد)',
            isTerminal: false
        };
    }
    if (code === 'WA' || clean.includes('آدرس یا تلفن اشتباه') || clean.includes('نقص آدرس')) {
        return {
            code: 'WA',
            labelFa: 'عدم تحویل بدلیل آدرس یا تلفن اشتباه',
            badgeClass: 'badge-warning',
            markerClass: 'marker-warning',
            icon: '⚠️',
            category: 'DELIVERY_PROBLEM',
            severity: 'warning',
            ariaLabel: 'وضعیت: نقص در آدرس یا تلفن گیرنده (نیاز به تصحیح آدرس)',
            isTerminal: false
        };
    }
    if (code === 'DAR' || clean.includes('تاخیر در توزیع') || clean.includes('در حال بررسی جهت توزیع')) {
        return {
            code: 'DAR',
            labelFa: 'تاخیر در توزیع (بررسی مجدد)',
            badgeClass: 'badge-warning',
            markerClass: 'marker-warning',
            icon: '⏳',
            category: 'DELIVERY_DELAYED',
            severity: 'warning',
            ariaLabel: 'وضعیت: تاخیر در برنامه توزیع و زمان‌بندی مجدد',
            isTerminal: false
        };
    }
    if (code === 'TW' || clean.includes('انبار موقت')) {
        return {
            code: 'TW',
            labelFa: 'ارسال به انبار موقت',
            badgeClass: 'badge-warning',
            markerClass: 'marker-warning',
            icon: '🏢',
            category: 'DELIVERY_HOLD',
            severity: 'warning',
            ariaLabel: 'وضعیت: توقف موقت در انبار',
            isTerminal: false
        };
    }
    if (code === 'OC' || clean.includes('ظرفیت تکمیل')) {
        return {
            code: 'OC',
            labelFa: 'تکمیل ظرفیت ناوگان',
            badgeClass: 'badge-warning',
            markerClass: 'marker-warning',
            icon: '⏳',
            category: 'DELIVERY_HOLD',
            severity: 'warning',
            ariaLabel: 'وضعیت: در انتظار ظرفیت ناوگان ارسال',
            isTerminal: false
        };
    }

    // 4. OUT FOR DELIVERY (در دست توزیع / فیروزه‌ای)
    if (code === 'OD' || clean.includes('توزیع توسط پیک') || clean.includes('توزیع توسط موزع')) {
        return {
            code: 'OD',
            labelFa: 'توزیع توسط پیک (در دست موزع)',
            badgeClass: 'badge-cyan',
            markerClass: 'marker-cyan',
            icon: '🛵',
            category: 'OUT_FOR_DELIVERY',
            severity: 'cyan',
            ariaLabel: 'وضعیت: مرسوله تحویل پیک جهت توزیع گردید',
            isTerminal: false
        };
    }

    // 5. POSTAL HANDOFF (تحویل به پست / بنفش)
    if (clean.includes('نماینده پست') || clean.includes('تحویل پست') || clean.includes('تحویل به پست') || clean.includes('ارسال به پست')) {
        return {
            code: 'POST_HANDOFF',
            labelFa: 'تحویل به شرکت ملی پست',
            badgeClass: 'badge-purple',
            markerClass: 'marker-purple',
            icon: '📮',
            category: 'POSTAL_HANDOFF',
            severity: 'purple',
            ariaLabel: 'وضعیت: مرسوله تحویل شرکت ملی پست شده است',
            isTerminal: false
        };
    }

    // 6. IN TRANSIT (در حال انتقال / آبی کاربنی)
    if (code === 'OS' || clean.includes('حرکت از مبدا')) {
        return {
            code: 'OS',
            labelFa: 'حرکت از مبدا (در مسیر انتقال)',
            badgeClass: 'badge-primary',
            markerClass: 'marker-primary',
            icon: '🚚',
            category: 'IN_TRANSIT',
            severity: 'primary',
            ariaLabel: 'وضعیت: حرکت از مبدا و انتقال بین شهری',
            isTerminal: false
        };
    }
    if (code === 'IR' || clean.includes('اسکن ورود')) {
        return {
            code: 'IR',
            labelFa: 'ورود به هاب / مرکز پردازش',
            badgeClass: 'badge-primary',
            markerClass: 'marker-primary',
            icon: '📥',
            category: 'IN_TRANSIT',
            severity: 'primary',
            ariaLabel: 'وضعیت: اسکن ورود در هاب توزیع',
            isTerminal: false
        };
    }
    if (code === 'CI' || clean.includes('تخلیه بار')) {
        return {
            code: 'CI',
            labelFa: 'تخلیه بار در مقصد',
            badgeClass: 'badge-primary',
            markerClass: 'marker-primary',
            icon: '📦',
            category: 'IN_TRANSIT',
            severity: 'primary',
            ariaLabel: 'وضعیت: بار در انبار مقصد تخلیه گردید',
            isTerminal: false
        };
    }
    if (code === 'DP' || clean.includes('پردازش پاکات')) {
        return {
            code: 'DP',
            labelFa: 'سورتینگ و پردازش مرسوله',
            badgeClass: 'badge-primary',
            markerClass: 'marker-primary',
            icon: '⚙️',
            category: 'IN_TRANSIT',
            severity: 'primary',
            ariaLabel: 'وضعیت: در حال پردازش در هاب مرکزی',
            isTerminal: false
        };
    }
    if (code === 'OF' || clean.includes('اسکن خروج')) {
        return {
            code: 'OF',
            labelFa: 'اسکن خروج از هاب / مرکز پردازش',
            badgeClass: 'badge-primary',
            markerClass: 'marker-primary',
            icon: '📤',
            category: 'IN_TRANSIT',
            severity: 'primary',
            ariaLabel: 'وضعیت: اسکن خروج به سمت مقصد',
            isTerminal: false
        };
    }

    // 7. REGISTERED & PICKUP (ثبت اولیه و جمع‌آوری / خاکستری)
    if (code === 'PU' || clean.includes('جمع آوری بار') || clean.includes('جمع‌آوری')) {
        return {
            code: 'PU',
            labelFa: 'جمع‌آوری بار از فرستنده',
            badgeClass: 'badge-neutral',
            markerClass: 'marker-neutral',
            icon: '📦',
            category: 'REGISTERED',
            severity: 'neutral',
            ariaLabel: 'وضعیت: بار از فرستنده دریافت و جمع‌آوری شد',
            isTerminal: false
        };
    }
    if (code === 'PDR' || clean.includes('مستندات جمع آوری') || clean.includes('مستندات توزیع')) {
        return {
            code: 'PDR',
            labelFa: 'ثبت مستندات در سامانه',
            badgeClass: 'badge-neutral',
            markerClass: 'marker-neutral',
            icon: '📄',
            category: 'REGISTERED',
            severity: 'neutral',
            ariaLabel: 'وضعیت: مستندات حمل بار در سامانه ثبت گردید',
            isTerminal: false
        };
    }
    if (code === 'D01' || clean.includes('ورود اطلاعات')) {
        return {
            code: 'D01',
            labelFa: 'ورود اطلاعات (در انتظار جمع‌آوری)',
            badgeClass: 'badge-neutral',
            markerClass: 'marker-neutral',
            icon: '📝',
            category: 'REGISTERED',
            severity: 'neutral',
            ariaLabel: 'وضعیت: بارنامه ثبت شده و در انتظار جمع‌آوری است',
            isTerminal: false
        };
    }

    // Fallback: clean string
    return {
        code: code || 'OTHER',
        labelFa: clean,
        badgeClass: 'badge-warning',
        markerClass: 'marker-warning',
        icon: '📋',
        category: 'IN_TRANSIT',
        severity: 'warning',
        ariaLabel: `وضعیت: ${clean}`,
        isTerminal: false
    };
}

/**
 * Renders the main Chapar tracking modal with all metadata and the Amazon-style timeline.
 * 
 * @param {Object} data - Parsed tracking data returned from the official REST API
 * @param {string} waybill - The tracking barcode
 * @param {string} customerName - The extracted customer name
 * @param {Object} [backContext] - Optional. If present, enables "برگشت" button.
 *   @param {Array}  backContext.waybills     - The waybill list to go back to
 *   @param {string} backContext.phone        - The phone number
 *   @param {string} backContext.customerName - The customer name for the list view
 */
function renderTrackingModal(data, waybill, customerName, backContext) {
    const root = getExtensionRoot();
    
    // Remove existing modal if one is already open
    const existingModal = root.querySelector('.cx-modal-overlay');
    if (existingModal) {
        // Clean up ESC listener from previous modal
        if (existingModal._cxEscHandler) {
            document.removeEventListener('keydown', existingModal._cxEscHandler);
        }
        existingModal.remove();
    }

    const overlay = document.createElement('div');
    overlay.className = 'cx-modal-overlay';

    // Determine the back button
    const hasBack = !!(backContext && backContext.waybills && backContext.waybills.length > 0);
    const backBtnHTML = hasBack
        ? `<button class="cx-btn cx-btn-secondary" id="cx-back-btn" aria-label="برگشت به لیست بارنامه‌ها">⟵ برگشت</button>`
        : `<button class="cx-btn cx-btn-secondary" id="cx-close-modal" aria-label="بستن">بستن</button>`;

    // --- CASE 1: PUBLIC-ONLY CHAPAR TRACKING ---
    if (data && data.isPublicOnly) {
        overlay.innerHTML = `
            <div class="cx-modal">
                <div class="cx-modal-header">
                    <div>
                        <h2 class="cx-modal-title">پیگیری مرسوله چاپار</h2>
                        <div class="cx-modal-subtitle">${_esc(customerName || '')} | ${_esc(waybill)}</div>
                    </div>
                    <div class="cx-status-badge badge-primary">🌐 سامانه عمومی چاپار</div>
                </div>
                
                <div class="cx-modal-body">
                    <div class="cx-delivery-banner cx-in-transit" style="padding: 16px; line-height: 1.8;">
                        <div style="font-size: 14px; margin-bottom: 8px;">
                            📦 این مرسوله در پورتال پرسنلی ثبت نشده است و جزئیات آن در سامانه رهگیری عمومی چاپار در دسترس است.
                        </div>
                        <div style="font-size: 13px; opacity: 0.9;">
                            شماره بارنامه: <strong style="font-family: monospace; font-size: 14px; letter-spacing: 0.5px;">${_esc(waybill)}</strong>
                        </div>
                    </div>
                    
                    <div style="text-align: center; margin: 28px 0 16px 0;">
                        <button class="cx-btn cx-btn-primary" id="cx-open-public-track-btn" style="padding: 10px 24px; font-size: 14px; font-weight: 600;">
                            🌐 مشاهده در سامانه عمومی چاپار
                        </button>
                    </div>
                </div>
                
                <div class="cx-modal-footer">
                    ${backBtnHTML}
                    <button class="cx-btn cx-btn-secondary" id="cx-copy-waybill" aria-label="کپی شماره بارنامه">📋 کپی بارنامه</button>
                    <button class="cx-theme-toggle" id="cx-theme-toggle-modal" aria-label="${_getThemeAriaLabel()}" title="${_getThemeAriaLabel()}">${_getThemeIcon()}</button>
                </div>
            </div>
        `;

        root.appendChild(overlay);

        if (hasBack) {
            const backBtn = root.querySelector('#cx-back-btn');
            const goBack = () => {
                if (overlay._cxEscHandler) {
                    document.removeEventListener('keydown', overlay._cxEscHandler);
                    overlay._cxEscHandler = null;
                }
                overlay.remove();
                renderPhoneListModal(backContext.waybills, backContext.phone, backContext.customerName);
            };
            backBtn.addEventListener('click', goBack);
            _attachModalCloseBehavior(overlay, goBack);
        } else {
            root.querySelector('#cx-close-modal').addEventListener('click', () => {
                _closeOverlay(overlay);
            });
            _attachModalCloseBehavior(overlay);
        }

        const openBtn = root.querySelector('#cx-open-public-track-btn');
        if (openBtn) {
            openBtn.addEventListener('click', () => {
                chrome.runtime.sendMessage({
                    action: 'OPEN_PUBLIC_CHAPAR_TAB',
                    query: waybill
                });
            });
        }

        const copyBtn = root.querySelector('#cx-copy-waybill');
        if (copyBtn) {
            copyBtn.addEventListener('click', () => {
                if (waybill && navigator.clipboard) {
                    navigator.clipboard.writeText(waybill).then(() => {
                        copyBtn.innerText = 'کپی شد! ✅';
                        setTimeout(() => copyBtn.innerText = '📋 کپی بارنامه', 2000);
                    });
                }
            });
        }

        root.querySelector('#cx-theme-toggle-modal').addEventListener('click', () => {
            toggleTheme();
        });

        return;
    }

    // --- CASE 2: NORMAL CHAPAR PORTAL RECORD ---
    // 1. DELIVERY & STATUS BANNERS
    let bannerHTML = '';
    const statusText = (data.status || (data.history && data.history[0]?.status) || 'در حال پیگیری').trim();
    const statusInfo = resolveChaparStatus(statusText);
    const isDelivered = !!(data.isDelivered && (data.deliveryDate || data.deliveredInfo));

    if (isDelivered) {
        bannerHTML += `
            <div class="cx-delivery-banner cx-delivered" role="status" aria-label="تحویل موفق به گیرنده">
                ✅ <strong>تحویل شد</strong> — زمان دقیق تحویل: <strong>${_esc(data.deliveryDate || '')}</strong>${data.deliveredTo ? ` به گیرنده: <strong>${_esc(data.deliveredTo)}</strong>` : ''}
            </div>
        `;
    } else if (statusInfo.category === 'RETURNED' || statusInfo.category === 'REJECTED') {
        bannerHTML += `
            <div class="cx-delivery-banner" role="status" aria-label="${_esc(statusInfo.ariaLabel)}" style="background: rgba(239, 68, 68, 0.12); border: 1px solid rgba(239, 68, 68, 0.35); color: #dc2626; padding: 12px 16px; border-radius: 8px; margin-bottom: 16px; font-weight: 600;">
                ${statusInfo.icon} <strong>مرجوعی / عدم تحویل:</strong> ${_esc(statusInfo.labelFa)}
            </div>
        `;
    } else if (statusInfo.category === 'DELIVERY_PROBLEM' || statusInfo.category === 'DELIVERY_DELAYED' || statusInfo.category === 'DELIVERY_HOLD') {
        bannerHTML += `
            <div class="cx-delivery-banner" role="status" aria-label="${_esc(statusInfo.ariaLabel)}" style="background: rgba(245, 158, 11, 0.12); border: 1px solid rgba(245, 158, 11, 0.35); color: #d97706; padding: 12px 16px; border-radius: 8px; margin-bottom: 16px; font-weight: 600;">
                ${statusInfo.icon} <strong>نیاز به پیگیری / مشکل در توزیع:</strong> ${_esc(statusInfo.labelFa)}
            </div>
        `;
    } else if (statusInfo.category === 'OUT_FOR_DELIVERY') {
        const estDeliveryText = data.maxDeliveryTime ? ` (حداکثر زمان تحویل: <strong>${_esc(data.maxDeliveryTime)}</strong>)` : '';
        bannerHTML += `
            <div class="cx-delivery-banner" role="status" aria-label="${_esc(statusInfo.ariaLabel)}" style="background: rgba(6, 182, 212, 0.12); border: 1px solid rgba(6, 182, 212, 0.35); color: #0891b2; padding: 12px 16px; border-radius: 8px; margin-bottom: 16px; font-weight: 600;">
                ${statusInfo.icon} <strong>در دست توزیع:</strong> مرسوله تحویل پیک گردیده و در مسیر تحویل به گیرنده است.${estDeliveryText}
            </div>
        `;
    } else {
        const estDeliveryText = data.maxDeliveryTime ? ` | حداکثر زمان تحویل: <strong>${_esc(data.maxDeliveryTime)}</strong>` : '';
        bannerHTML += `
            <div class="cx-delivery-banner cx-in-transit" role="status" aria-label="در حال انتقال">
                🚚 <strong>در حال توزیع / پیگیری</strong> — آخرین وضعیت: <strong>${_esc(statusInfo.labelFa)}</strong>${estDeliveryText}
            </div>
        `;
    }

    // 2. POSTAL HANDOFF BANNER (ONLY if verified postal tracking number exists)
    if (data.postalTrackingNumber) {
        bannerHTML += `
            <div class="cx-postal-handoff-banner" role="region" aria-label="اطلاعات تحویل به پست">
                <div class="cx-postal-title">📮 مرسوله تحویل شرکت ملی پست شده است</div>
                <div class="cx-postal-code-row">
                    <span>کد رهگیری پست:</span>
                    <strong class="cx-postal-code">${_esc(data.postalTrackingNumber)}</strong>
                    <button class="cx-btn cx-btn-small cx-btn-primary" id="cx-track-post-modal-btn" aria-label="پیگیری در سامانه شرکت ملی پست">📦 پیگیری در سامانه پست</button>
                    <button class="cx-btn cx-btn-small cx-btn-secondary" id="cx-copy-post-modal-btn" aria-label="کپی کد رهگیری پستی">📋 کپی کد پست</button>
                </div>
                <div style="margin-top: 6px; font-size: 11px; opacity: 0.85; line-height: 1.5;">
                    💡 <em>نکته: وضعیت در چاپار نشان‌دهنده تحویل بسته به پست است. جهت پیگیری روند توزیع نهایی تا مقصد، از سامانه رهگیری پست استفاده کنید.</em>
                </div>
            </div>
        `;
    }

    // 3. DYNAMIC METADATA GRID
    let metaHTML = '';
    const knownTranslations = {
        'probableTrackingNumber': 'کد رهگیری احتمالی',
        'maxDeliveryTime': 'حداکثر زمان تحویل',
        'deliveryDate': 'زمان دقیق تحویل',
        'deliveredTo': 'تحویل گیرنده',
        'delivered_to': 'تحویل گیرنده',
        'pickupDate': 'تاریخ جمع‌آوری',
        'pickupTime': 'زمان جمع‌آوری',
        'postalTrackingNumber': 'کد رهگیری پست',
        'packageNo': 'شماره بسته',
        'classificationLabel': 'نوع مرسوله',
        'origin': 'مبدا',
        'dest': 'مقصد',
        'sender_company': 'شرکت فرستنده',
        'sender_contact': 'فرستنده',
        'receiver_contact': 'گیرنده',
        'service': 'نوع خدمات',
        'pickupAgent': 'نماینده جمع‌آوری',
        'pickup_agent': 'نماینده جمع‌آوری',
        'deliveryAgent': 'نماینده توزیع',
        'delivery_agent': 'نماینده توزیع',
        'weight': 'وزن (کیلوگرم)',
        'pieces': 'تعداد بسته',
        'contents': 'محتویات',
        'reference': 'شماره مرجع',
        'paymentMethod': 'روش پرداخت',
        'payment_method': 'روش پرداخت',
        'method': 'روش ارسال',
        'createdAt': 'تاریخ ایجاد',
        'modifiedAt': 'آخرین تغییر'
    };

    const skipKeys = [
        'history', 'geo', 'internalId', 'packageIds', 'manifestItems', 'isDelivered', 'isPostal', 'isPublicOnly',
        'deliveryDateSource', 'classification', 'portalWaybill', 'portalOrigin', 
        'portalDest', 'portalService', 'portalStatus', 'portalSender', 'portalReceiver',
        'signature', 'payment_link', 'attach', 'delivery_time', 'deliveredInfo'
    ];

    // Priority displayed items first (operational fields)
    const priorityItems = [];
    if (isDelivered && data.deliveryDate) {
        priorityItems.push({ label: 'زمان دقیق تحویل', value: data.deliveryDate });
    }
    if (data.maxDeliveryTime) {
        priorityItems.push({ label: 'حداکثر زمان تحویل', value: data.maxDeliveryTime });
    }
    if (data.probableTrackingNumber) {
        priorityItems.push({ label: 'کد رهگیری احتمالی', value: data.probableTrackingNumber });
    }
    if (data.weight) {
        priorityItems.push({ label: 'وزن (کیلوگرم)', value: data.weight });
    }
    if (data.pieces) {
        priorityItems.push({ label: 'تعداد بسته', value: data.pieces });
    }
    if (data.contents) {
        priorityItems.push({ label: 'محتویات', value: data.contents });
    }
    if (data.reference) {
        priorityItems.push({ label: 'شماره مرجع', value: data.reference });
    }
    if (data.pickupDate) {
        const pickupStr = data.pickupTime ? `${data.pickupDate} (${data.pickupTime})` : data.pickupDate;
        priorityItems.push({ label: 'جمع‌آوری', value: pickupStr });
    }
    if (data.method) {
        priorityItems.push({ label: 'روش ارسال', value: data.method });
    }
    if (data.paymentMethod || data.payment_method) {
        priorityItems.push({ label: 'روش پرداخت', value: data.paymentMethod || data.payment_method });
    }
    if (data.postalTrackingNumber) {
        priorityItems.push({ label: 'کد رهگیری پست', value: data.postalTrackingNumber });
    }
    if (data.packageNo && data.packageNo !== waybill) {
        priorityItems.push({ label: 'شماره بسته', value: data.packageNo });
    }
    if (data.origin) priorityItems.push({ label: 'مبدا', value: data.origin });
    if (data.dest) priorityItems.push({ label: 'مقصد', value: data.dest });
    if (data.deliveredTo) priorityItems.push({ label: 'تحویل گیرنده', value: data.deliveredTo });
    if (data.deliveryAgent || data.delivery_agent) priorityItems.push({ label: 'نماینده توزیع', value: data.deliveryAgent || data.delivery_agent });
    if (data.pickupAgent || data.pickup_agent) priorityItems.push({ label: 'نماینده جمع‌آوری', value: data.pickupAgent || data.pickup_agent });
    if (data.createdAt) priorityItems.push({ label: 'تاریخ ایجاد', value: data.createdAt });
    if (data.modifiedAt) priorityItems.push({ label: 'آخرین تغییر', value: data.modifiedAt });
    if (data.service || data.portalService) priorityItems.push({ label: 'نوع خدمات', value: data.service || data.portalService });

    priorityItems.forEach(item => {
        metaHTML += `
            <div class="cx-meta-item">
                <div class="cx-meta-label">${_esc(item.label)}</div>
                <div class="cx-meta-value">${_esc(item.value)}</div>
            </div>
        `;
    });

    // Other non-skipped metadata
    const alreadyRenderedLabels = new Set(priorityItems.map(p => p.label));
    Object.keys(data).forEach(key => {
        if (skipKeys.includes(key) || typeof data[key] === 'object') return;
        if (data[key] === null || data[key] === '' || data[key] === '-') return;
        const label = knownTranslations[key];
        if (!label || alreadyRenderedLabels.has(label)) return;
        
        metaHTML += `
            <div class="cx-meta-item">
                <div class="cx-meta-label">${_esc(label)}</div>
                <div class="cx-meta-value">${_esc(data[key])}</div>
            </div>
        `;
    });

    // 4. TIMELINE GENERATION (Chronologically sorted with newest at top)
    let logs = Array.isArray(data.history) ? [...data.history] : [];
    const currentStatus = logs.length > 0 ? (logs[0].status || 'در حال پیگیری') : 'وضعیت نامشخص';
    let timelineHTML = '';
    
    logs.forEach((log, index) => {
        const isLatest = index === 0; 
        const displayDate = log.date || '';
        const displayStatus = log.status || 'ثبت در سیستم';
        const displayLoc = log.loc || '';

        let extraDetails = '';
        Object.keys(log).forEach(key => {
            if (['date', 'status', 'loc', 'timestamp_date', 'sortKey', 'geo', 'row'].includes(key)) return;
            if (!log[key] || typeof log[key] === 'object' || log[key] === '-') return;
            
            let keyFa = key;
            if (key === 'agent' || key === 'by' || key === 'operator') keyFa = 'توسط';
            if (key === 'package_no' || key === 'package') keyFa = 'بسته';
            if (key === 'receiver') keyFa = 'تحویل گیرنده';
            if (key === 'rep' || key === 'branch') keyFa = 'نماینده';
            if (key === 'action') keyFa = 'دستور';
            
            extraDetails += `<span class="cx-log-tag"><strong>${_esc(keyFa)}:</strong> ${_esc(log[key])}</span>`;
        });

        const evInfo = resolveChaparStatus(displayStatus);
        timelineHTML += `
            <div class="cx-timeline-item ${isLatest ? 'latest' : ''}">
                <div class="cx-timeline-marker ${evInfo.markerClass}"></div>
                <div class="cx-timeline-content">
                    <div class="cx-timeline-header">
                        <span class="cx-timeline-status">${evInfo.icon} ${_esc(displayStatus)}</span>
                        <span class="cx-timeline-date">${_esc(displayDate)}</span>
                    </div>
                    ${displayLoc ? `<div class="cx-timeline-location">📍 مکان: ${_esc(displayLoc)}</div>` : ''}
                    ${extraDetails ? `<div class="cx-timeline-extras">${extraDetails}</div>` : ''}
                </div>
            </div>
        `;
    });

    overlay.innerHTML = `
        <div class="cx-modal">
            <div class="cx-modal-header">
                <div>
                    <h2 class="cx-modal-title">پیگیری مرسوله چاپار</h2>
                    <div class="cx-modal-subtitle">${_esc(customerName || '')} | ${_esc(waybill)}</div>
                </div>
                <div class="cx-status-badge ${statusInfo.badgeClass}" role="status" aria-label="${_esc(statusInfo.ariaLabel)}">${statusInfo.icon} ${_esc(statusInfo.labelFa)}</div>
            </div>
            
            <div class="cx-modal-body">
                ${bannerHTML}
                
                ${metaHTML ? `<div class="cx-meta-grid">${metaHTML}</div>` : ''}
                
                <div class="cx-timeline">
                    ${timelineHTML || `<div style="text-align:center; color: var(--cx-empty-color);">اطلاعاتی یافت نشد</div>`}
                </div>
            </div>
            
            <div class="cx-modal-footer">
                ${backBtnHTML}
                <button class="cx-btn cx-btn-secondary" id="cx-copy-waybill" aria-label="کپی شماره بارنامه">📋 کپی بارنامه</button>
                <button class="cx-btn cx-btn-primary" id="cx-copy-logs" aria-label="کپی گزارش">کپی گزارش</button>
                ${data.postalTrackingNumber ? `<button class="cx-btn cx-btn-primary" id="cx-footer-post-btn" aria-label="رهگیری در پست">📮 رهگیری پست</button>` : ''}
                <button class="cx-btn cx-btn-secondary" id="cx-open-public-track-btn" aria-label="رهگیری در سامانه عمومی چاپار">🌐 سامانه عمومی</button>
                <button class="cx-btn cx-btn-chapar" id="cx-open-chapar" aria-label="پورتال چاپار">🔗 پورتال چاپار</button>
                <button class="cx-theme-toggle" id="cx-theme-toggle-modal" aria-label="${_getThemeAriaLabel()}" title="${_getThemeAriaLabel()}">${_getThemeIcon()}</button>
            </div>
        </div>
    `;

    root.appendChild(overlay);

    // --- Back button or Close button ---
    if (hasBack) {
        const backBtn = root.querySelector('#cx-back-btn');
        const goBack = () => {
            if (overlay._cxEscHandler) {
                document.removeEventListener('keydown', overlay._cxEscHandler);
                overlay._cxEscHandler = null;
            }
            overlay.remove();
            renderPhoneListModal(backContext.waybills, backContext.phone, backContext.customerName);
        };
        backBtn.addEventListener('click', goBack);
        _attachModalCloseBehavior(overlay, goBack);
    } else {
        root.querySelector('#cx-close-modal').addEventListener('click', () => {
            _closeOverlay(overlay);
        });
        _attachModalCloseBehavior(overlay);
    }

    // --- Track in Post handlers ---
    const trackPostBtn = root.querySelector('#cx-track-post-modal-btn');
    const footerPostBtn = root.querySelector('#cx-footer-post-btn');
    const handleTrackPost = () => {
        if (data.postalTrackingNumber) {
            chrome.runtime.sendMessage({
                action: 'OPEN_POST_TAB',
                query: data.postalTrackingNumber
            });
        }
    };
    if (trackPostBtn) trackPostBtn.addEventListener('click', handleTrackPost);
    if (footerPostBtn) footerPostBtn.addEventListener('click', handleTrackPost);

    // --- Copy Post Tracking Number ---
    const copyPostBtn = root.querySelector('#cx-copy-post-modal-btn');
    if (copyPostBtn) {
        copyPostBtn.addEventListener('click', () => {
            if (data.postalTrackingNumber && navigator.clipboard) {
                navigator.clipboard.writeText(data.postalTrackingNumber).then(() => {
                    copyPostBtn.innerText = 'کپی شد! ✅';
                    setTimeout(() => copyPostBtn.innerText = '📋 کپی کد پست', 2000);
                });
            }
        });
    }

    // --- Open Public Chapar Tracking handler ---
    const openPublicTrackBtn = root.querySelector('#cx-open-public-track-btn');
    if (openPublicTrackBtn) {
        openPublicTrackBtn.addEventListener('click', () => {
            chrome.runtime.sendMessage({
                action: 'OPEN_PUBLIC_CHAPAR_TAB',
                query: waybill
            });
        });
    }

    // --- Copy Report ---
    root.querySelector('#cx-copy-logs').addEventListener('click', () => {
        const logText = logs.map(l => {
            const locText = l.loc ? ` (${l.loc})` : '';
            const byText = l.agent || l.by ? ` [توسط: ${l.agent || l.by}]` : '';
            return `${l.date} - ${l.status}${locText}${byText}`;
        }).join('\n');
        
        navigator.clipboard.writeText(logText).then(() => {
            const copyBtn = root.querySelector('#cx-copy-logs');
            copyBtn.innerText = 'کپی شد! ✅';
            setTimeout(() => copyBtn.innerText = 'کپی گزارش', 2000);
        }).catch(err => {
            console.warn('Clipboard copy failed', err);
            const copyBtn = root.querySelector('#cx-copy-logs');
            copyBtn.innerText = 'خطا در کپی ❌';
            setTimeout(() => copyBtn.innerText = 'کپی گزارش', 2000);
        });
    });
    
    // --- Copy Waybill Number ---
    root.querySelector('#cx-copy-waybill').addEventListener('click', () => {
        if (!waybill) {
            const btn = root.querySelector('#cx-copy-waybill');
            btn.innerText = 'بارنامه‌ای نیست ❌';
            setTimeout(() => btn.innerText = '📋 کپی بارنامه', 2000);
            return;
        }
        navigator.clipboard.writeText(waybill).then(() => {
            const btn = root.querySelector('#cx-copy-waybill');
            btn.innerText = 'کپی شد! ✅';
            setTimeout(() => btn.innerText = '📋 کپی بارنامه', 2000);
        }).catch(err => {
            console.warn('Clipboard copy failed', err);
            const btn = root.querySelector('#cx-copy-waybill');
            btn.innerText = 'خطا در کپی ❌';
            setTimeout(() => btn.innerText = '📋 کپی بارنامه', 2000);
        });
    });
    
    // --- Open in Chapar Portal ---
    root.querySelector('#cx-open-chapar').addEventListener('click', () => {
        if (!waybill) {
            const btn = root.querySelector('#cx-open-chapar');
            btn.innerText = 'بارنامه‌ای نیست ❌';
            setTimeout(() => btn.innerText = '🔗 پورتال چاپار', 2000);
            return;
        }
        chrome.runtime.sendMessage({
            action: 'OPEN_CHAPAR_TAB',
            internalId: data.internalId,
            waybill: waybill
        });
    });
    
    // --- Theme toggle in modal ---
    root.querySelector('#cx-theme-toggle-modal').addEventListener('click', () => {
        toggleTheme();
    });
}

/**
 * Renders the Authentication Error modal if the background fetch detects an expired session.
 */
function renderAuthErrorModal() {
    const root = getExtensionRoot();
    
    const existingModal = root.querySelector('.cx-modal-overlay');
    if (existingModal) {
        if (existingModal._cxEscHandler) {
            document.removeEventListener('keydown', existingModal._cxEscHandler);
        }
        existingModal.remove();
    }

    const overlay = document.createElement('div');
    overlay.className = 'cx-modal-overlay';
    
    overlay.innerHTML = `
        <div class="cx-modal cx-modal-error">
            <div class="cx-modal-icon">🔒</div>
            <h2 class="cx-modal-title">نشست چاپار منقضی شده است</h2>
            <p class="cx-modal-message">برای دریافت خودکار اطلاعات در پس‌زمینه، لطفا ابتدا وارد حساب کاربری چاپار شوید و سپس مجددا تلاش کنید.</p>
            <div class="cx-modal-actions">
                <button class="cx-btn cx-btn-primary" id="cx-login-chapar" aria-label="ورود به پورتال چاپار">ورود به پورتال چاپار</button>
                <button class="cx-btn cx-btn-secondary" id="cx-close-modal" aria-label="بستن">بستن</button>
            </div>
        </div>
    `;

    root.appendChild(overlay);

    root.querySelector('#cx-close-modal').addEventListener('click', () => {
        _closeOverlay(overlay);
    });
    
    root.querySelector('#cx-login-chapar').addEventListener('click', () => {
        // Open Chapar in a new tab so they can login. 
        window.open('https://portal.chaparnet.com', '_blank');
        _closeOverlay(overlay);
    });
    
    // Backdrop click + ESC key close
    _attachModalCloseBehavior(overlay);
}

/**
 * Helper function to determine the color class of the status badge.
 */
function getBadgeClass(status) {
    return resolveChaparStatus(status).badgeClass;
}

/**
 * Renders a list of waybills for a specific phone number.
 */
function renderPhoneListModal(waybills, phone, customerName) {
    const root = getExtensionRoot();
    
    const existingModal = root.querySelector('.cx-modal-overlay');
    if (existingModal) {
        if (existingModal._cxEscHandler) {
            document.removeEventListener('keydown', existingModal._cxEscHandler);
        }
        existingModal.remove();
    }

    const overlay = document.createElement('div');
    overlay.className = 'cx-modal-overlay';
    
    let listHTML = '';
    waybills.forEach(w => {
        const wInfo = resolveChaparStatus(w.status);
        listHTML += `
            <div class="cx-waybill-card">
                <div class="cx-waybill-card-header">
                    <strong>${_esc(w.waybill)}</strong>
                    <span class="cx-status-badge ${wInfo.badgeClass}" role="status" aria-label="${_esc(wInfo.ariaLabel)}">${wInfo.icon} ${_esc(wInfo.labelFa)}</span>
                </div>
                <div class="cx-waybill-card-body">
                    <span>📅 تاریخ پیکاپ: ${_esc(w.pickupDate || w.date)}</span>
                    <span>📍 مسیر: از ${_esc(w.origin)} به ${_esc(w.dest)}</span>
                    <span>📦 سرویس: ${_esc(w.service)}</span>
                    <span>📋 آخرین وضعیت: ${_esc(wInfo.labelFa)} <small style="opacity:0.7">(${_esc(w.status)})</small></span>
                </div>
                <div style="text-align: left; margin-top: 10px;">
                    <button class="cx-btn cx-btn-primary cx-btn-small cx-waybill-select-btn" data-waybill="${_esc(w.waybill)}" aria-label="مشاهده جزئیات بارنامه ${_esc(w.waybill)}">مشاهده جزئیات</button>
                </div>
            </div>
        `;
    });

    overlay.innerHTML = `
        <div class="cx-modal" role="dialog" aria-modal="true" aria-labelledby="cx-title-select-waybill">
            <div class="cx-modal-header">
                <div>
                    <h2 class="cx-modal-title" id="cx-title-select-waybill">انتخاب بارنامه</h2>
                    <div class="cx-modal-subtitle">موبایل: ${_esc(phone)} | ${_esc(customerName)}</div>
                </div>
                <div class="cx-status-badge badge-warning">${waybills.length} مورد یافت شد</div>
            </div>
            
            <div class="cx-modal-body" style="background: var(--cx-bg-modal-body); max-height: 400px; overflow-y: auto;">
                ${listHTML}
            </div>
            
            <div class="cx-modal-footer">
                <button class="cx-btn cx-btn-secondary" id="cx-close-modal" aria-label="بستن">بستن</button>
                <button class="cx-theme-toggle" id="cx-theme-toggle-list" aria-label="${_getThemeAriaLabel()}" title="${_getThemeAriaLabel()}">${_getThemeIcon()}</button>
            </div>
        </div>
    `;

    root.appendChild(overlay);

    root.querySelector('#cx-close-modal').addEventListener('click', () => {
        _closeOverlay(overlay);
    });
    
    // Backdrop click + ESC key close
    _attachModalCloseBehavior(overlay);
    
    // Theme toggle in list modal
    root.querySelector('#cx-theme-toggle-list').addEventListener('click', () => {
        toggleTheme();
    });

    // Attach click listeners to open the specific waybill using the existing logic
    const selectButtons = root.querySelectorAll('.cx-waybill-select-btn');
    selectButtons.forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const selectedWaybill = e.target.getAttribute('data-waybill');
            
            const originalText = e.target.innerText;
            e.target.innerHTML = `<div class="cx-spinner"></div> صبر کنید...`;
            
            const response = await new Promise(resolve => {
                chrome.runtime.sendMessage({
                    action: 'FETCH_CHAPAR',
                    type: 'ConsignmentNo',
                    query: selectedWaybill
                }, resolve);
            });

            if (!response || !response.success) {
                alert('خطا در دریافت جزئیات بارنامه: ' + (response?.error || 'Unknown Error'));
                e.target.innerHTML = originalText;
            } else {
                // Pass backContext so the details view can navigate back to this list
                renderTrackingModal(response.data, selectedWaybill, customerName, {
                    waybills: waybills,
                    phone: phone,
                    customerName: customerName
                });
            }
        });
    });
}

// ==========================================
// SHORTCUTS BAR & SETTINGS UI
// ==========================================

/**
 * Renders enabled shortcut buttons with status badges inside the floating bar.
 */
function renderShortcutsBar(container, enabledIds = []) {
    if (!container) return;
    container.innerHTML = '';

    const registry = window.CX_SHORTCUTS?.registry || [];
    const activeShortcuts = registry.filter(s => enabledIds.includes(s.id));

    if (activeShortcuts.length === 0) {
        container.style.display = 'none';
        return;
    }
    container.style.display = 'flex';

    activeShortcuts.forEach(s => {
        const btn = document.createElement('button');
        btn.className = 'cx-shortcut-btn';
        btn.id = `cx-shortcut-${s.id}`;
        btn.setAttribute('data-shortcut-id', s.id);
        btn.setAttribute('title', s.description || s.title);

        btn.innerHTML = `
            <span>${s.icon} ${_esc(s.title)}</span>
            <span class="cx-shortcut-badge badge-none" id="cx-badge-${s.id}">-</span>
        `;

        btn.addEventListener('click', (e) => {
            e.preventDefault();
            if (window.CX_SHORTCUTS && typeof window.CX_SHORTCUTS.triggerShortcut === 'function') {
                window.CX_SHORTCUTS.triggerShortcut(s.id);
            }
        });

        container.appendChild(btn);
    });
}

/**
 * Updates a specific shortcut's status badge.
 */
function updateShortcutBadge(shortcutId, status) {
    const root = getExtensionRoot();
    if (!root) return;

    const badge = root.querySelector(`#cx-badge-${shortcutId}`);
    if (!badge || !status) return;

    badge.textContent = status.badgeText || status.label || '-';
    badge.className = `cx-shortcut-badge badge-${status.state || 'none'}`;
    if (status.tooltip || status.statusLabel) {
        badge.setAttribute('title', status.tooltip || status.statusLabel);
    }
}

/**
 * Renders the shortcut configuration preferences modal.
 */
async function renderShortcutSettingsModal(onSave) {
    const root = getExtensionRoot();
    if (!root) return;

    const existingModal = root.querySelector('.cx-modal-overlay');
    if (existingModal) {
        if (existingModal._cxEscHandler) {
            document.removeEventListener('keydown', existingModal._cxEscHandler);
        }
        existingModal.remove();
    }

    const registry = window.CX_SHORTCUTS?.registry || [];
    const enabledIds = await (window.CX_SHORTCUTS?.getEnabledShortcuts() || Promise.resolve(['returns', 'manual_refunds', 'admin_orders']));

    let itemsHTML = '';
    registry.forEach(s => {
        const isChecked = enabledIds.includes(s.id) ? 'checked' : '';
        itemsHTML += `
            <label class="cx-settings-item">
                <div class="cx-settings-item-info">
                    <span style="font-size: 20px;">${s.icon}</span>
                    <div>
                        <div class="cx-settings-item-title">${_esc(s.title)} (${_esc(s.route)})</div>
                        <div class="cx-settings-item-desc">${_esc(s.description || '')}</div>
                    </div>
                </div>
                <input type="checkbox" class="cx-settings-checkbox" data-id="${_esc(s.id)}" ${isChecked}>
            </label>
        `;
    });

    const overlay = document.createElement('div');
    overlay.className = 'cx-modal-overlay';
    overlay.innerHTML = `
        <div class="cx-modal" role="dialog" aria-modal="true" aria-labelledby="cx-settings-title" style="max-width: 500px;">
            <div class="cx-modal-header">
                <div>
                    <h2 class="cx-modal-title" id="cx-settings-title">⚙️ تنظیمات میانبرهای اتوموبی</h2>
                    <div class="cx-modal-subtitle">انتخاب بخش‌های فعال در نوار دستیار هوشمند</div>
                </div>
            </div>
            
            <div class="cx-modal-body" style="background: var(--cx-bg-modal-body);">
                <div class="cx-settings-list">
                    ${itemsHTML}
                </div>
            </div>
            
            <div class="cx-modal-footer">
                <button class="cx-btn cx-btn-secondary" id="cx-settings-cancel">انصراف</button>
                <button class="cx-btn cx-btn-primary" id="cx-settings-save">ذخیره و اعمال</button>
            </div>
        </div>
    `;

    root.appendChild(overlay);

    _attachModalCloseBehavior(overlay);

    overlay.querySelector('#cx-settings-cancel').addEventListener('click', () => {
        _closeOverlay(overlay);
    });

    overlay.querySelector('#cx-settings-save').addEventListener('click', async () => {
        const checkboxes = overlay.querySelectorAll('.cx-settings-checkbox');
        const selected = [];
        checkboxes.forEach(cb => {
            if (cb.checked) {
                selected.push(cb.getAttribute('data-id'));
            }
        });

        if (window.CX_SHORTCUTS && typeof window.CX_SHORTCUTS.setEnabledShortcuts === 'function') {
            await window.CX_SHORTCUTS.setEnabledShortcuts(selected);
        }

        _closeOverlay(overlay);

        if (typeof onSave === 'function') {
            onSave(selected);
        }
    });
}
