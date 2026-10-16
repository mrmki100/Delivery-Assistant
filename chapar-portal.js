/**
 * chapar-portal.js
 * 
 * Injected into portal.chaparnet.com to auto-open specific waybills.
 */

(function() {
    'use strict';

    // Check if there is a pending task from the extension
    chrome.storage.local.get(['chaparTrackingTask', 'chaparTrackingWaybill'], (data) => {
        const internalId = data.chaparTrackingTask;
        const waybill = data.chaparTrackingWaybill;
        
        if (internalId || waybill) {
            // We found a task, clear it
            chrome.storage.local.remove(['chaparTrackingTask', 'chaparTrackingWaybill']);
            
            if (internalId && /^\d+$/.test(String(internalId).trim())) {
                const safeInternalId = String(internalId).trim();
                // If we have the exact internal ID, we can directly trigger the waybill popup!
                // We inject a script tag that polls for the xajax_DoPHP function
                // since the portal is an SPA and might take time to initialize its xajax scripts.
                const script = document.createElement('script');
                script.textContent = `
                    (function() {
                        let attempts = 0;
                        const maxAttempts = 20; // 10 seconds
                        const checkExist = setInterval(function() {
                            attempts++;
                            if (typeof xajax_DoPHP === 'function') {
                                clearInterval(checkExist);
                                console.log('Delivery Assistant: Requesting popup for waybill ' + ${JSON.stringify(internalId)});
                                
                                // We must call the exact xajax function that draws the popup form and then triggers OpenConsHistory
                                // This matches the exact payload the portal sends when clicking a waybill.
                                xajax_DoPHP(
                                    'DrawPopupForm', 
                                    {
                                        "FormName": "FormConsignmentHistory",
                                        "variables": { "no": ${JSON.stringify(internalId)} },
                                        "functions": "undefined,RunFunction",
                                        "Width": 1500,
                                        "Height": 110,
                                        "Border": 1,
                                        "Padding": 0,
                                        "BoxTPL": "PopupBox.tpl"
                                    }, 
                                    'FormConsignmentHistory', 
                                    "displayPopupDiv('FormConsignmentHistory',1500,110,-1,50);MakeDraggable('#FormConsignmentHistory');", 
                                    "1;", 
                                    "centerPopupDiv('FormConsignmentHistory');AutoFocus(\\"FormConsignmentHistory\\");OpenConsHistory(" + ${JSON.stringify(internalId)} + ");;"
                                );
                            } else if (attempts >= maxAttempts) {
                                clearInterval(checkExist);
                                console.warn('Delivery Assistant: xajax_DoPHP function not found on page after 10 seconds.');
                            }
                        }, 500);
                    })();
                `;
                (document.head || document.documentElement).appendChild(script);
                script.remove();
            } else if (waybill) {
                // Fallback: We only have the waybill number. 
                // Attempt to inject it into the Flexigrid search box.
                let attempts = 0;
                const checkSearchBox = setInterval(() => {
                    attempts++;
                    // Common Flexigrid search box class is .qsbox
                    const qsbox = document.querySelector('.qsbox') || document.querySelector('input[name="query"]');
                    if (qsbox) {
                        clearInterval(checkSearchBox);
                        qsbox.value = waybill;
                        qsbox.dispatchEvent(new Event('input', { bubbles: true }));
                        
                        // Try to find the search button and click it
                        const searchBtn = qsbox.parentElement?.querySelector('input[type="button"], button') || document.querySelector('.qSearch');
                        if (searchBtn) {
                            searchBtn.click();
                        }
                    } else if (attempts >= 20) {
                        clearInterval(checkSearchBox);
                        console.warn("Delivery Assistant: Could not find search box for fallback.");
                    }
                }, 500);
            }
        }
    });

    // ==========================================
    // PORTAL AUTHENTICATION DETECTION & NOTIFIER
    // ==========================================
    function isElementVisible(el) {
        if (!el) return false;
        if (el.offsetParent === null && window.getComputedStyle(el).position !== 'fixed') return false;
        const style = window.getComputedStyle(el);
        return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
    }

    function evaluatePortalAuthState() {
        const bodyText = document.body ? document.body.innerText : '';

        // Reliable positive operational signals (authenticated employee session)
        const hasFlexigrid = !!document.querySelector('.flexigrid') || !!document.querySelector('#tbl_cons');
        const hasOperationUrl = window.location.href.includes('P=Operation') || window.location.href.includes('Tab=Consignment');
        const hasXajax = typeof window.xajax_DoPHP === 'function';
        const hasLogout = Array.from(document.querySelectorAll('a')).some(a => {
            const text = a.innerText.trim();
            return text === 'خروج' || text.includes('خروج از سامانه') || a.href.includes('Logout') || a.href.includes('logout');
        }) || /(?:خروج از سامانه|خروج از حساب)/i.test(bodyText);
        const hasWelcome = bodyText.includes('خوش آمدید') || bodyText.includes('سطح دسترسی') || bodyText.includes('Customer-User');
        const hasNavMenu = bodyText.includes('عملیات') && (bodyText.includes('حسابداری') || bodyText.includes('گزارشات'));

        const hasEmployeeUI = hasFlexigrid || hasOperationUrl || hasLogout || hasWelcome || hasNavMenu || hasXajax;

        // Login / Unauthenticated signals (exclude hidden background idle dialog inputs like frm_IDLELogin)
        const visiblePasswords = Array.from(document.querySelectorAll('input[type="password"]')).filter(isElementVisible);
        const hasVisiblePassword = visiblePasswords.length > 0;
        const isLoginUrl = (window.location.search.includes('P=Login') || window.location.pathname.includes('/login')) && !hasFlexigrid;

        // True login page: on explicit login URL or visible password input without active employee session
        const isLoginPage = isLoginUrl || (hasVisiblePassword && !hasWelcome && !hasNavMenu);

        // CRITICAL: Do not infer authenticated merely because login form disappeared!
        // Must have positive confirmation of employee portal UI without active login prompt.
        const isAuthenticated = !isLoginPage && hasEmployeeUI;

        return {
            isPortalTab: true,
            isLoginPage,
            isAuthenticated,
            url: window.location.href
        };
    }

    let lastSentAuthState = null;

    function notifyAuthIfChanged() {
        const status = evaluatePortalAuthState();
        if (lastSentAuthState === null || lastSentAuthState !== status.isAuthenticated) {
            lastSentAuthState = status.isAuthenticated;
            chrome.runtime.sendMessage({
                action: 'CHAPAR_AUTH_STATE_CHANGED',
                isAuthenticated: status.isAuthenticated,
                isLoginPage: status.isLoginPage
            }).catch(() => {});
        }
    }

    // 1. Initial check on load
    notifyAuthIfChanged();

    // 2. Event-driven observer for SPA / DOM transitions without page reload
    let authDebounceTimer = null;
    const authObserver = new MutationObserver(() => {
        if (authDebounceTimer) clearTimeout(authDebounceTimer);
        authDebounceTimer = setTimeout(() => {
            notifyAuthIfChanged();
        }, 300);
    });

    if (document.body) {
        authObserver.observe(document.body, { childList: true, subtree: true });
    } else {
        document.addEventListener('DOMContentLoaded', () => {
            if (document.body) {
                authObserver.observe(document.body, { childList: true, subtree: true });
            }
            notifyAuthIfChanged();
        });
    }

    // Listen for portal session ping requests
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
        if (msg.action === 'PING_PORTAL_SESSION') {
            const status = evaluatePortalAuthState();
            sendResponse(status);
            return true;
        }
    });
})();
