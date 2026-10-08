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
            
            if (internalId) {
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
})();
