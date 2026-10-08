/**
 * iran-post.js
 * Content script specifically for tracking.post.ir
 * Automates tracking number injection and Captcha focus for agents.
 */

(function() {
    'use strict';

    console.log("🚀 [Delivery Assistant] Iran Post Tracker Initialized");

    function toAsciiDigits(str) {
        if (str == null) return '';
        return String(str)
            .replace(/[\u06F0-\u06F9]/g, d => String.fromCharCode(d.charCodeAt(0) - 0x06F0 + 48))
            .replace(/[\u0660-\u0669]/g, d => String.fromCharCode(d.charCodeAt(0) - 0x0660 + 48));
    }

    // Retrieve the tracking number passed from Automoby
    chrome.storage.local.get(['postTrackingTask'], function(result) {
        const rawTask = result.postTrackingTask;
        let trackingNo = toAsciiDigits(String(rawTask || '')).trim();
        if (trackingNo && trackingNo.includes('،')) {
            trackingNo = trackingNo.split('،')[0].trim();
        } else if (trackingNo && trackingNo.includes(',')) {
            trackingNo = trackingNo.split(',')[0].trim();
        }
        
        if (trackingNo && /^\d{10,30}$/.test(trackingNo)) {
            console.log("📦 [Delivery Assistant] Found Post Tracking Task:", trackingNo);
            
            // Wait for the DOM to be fully ready and the input to appear
            let attempts = 0;
            const maxAttempts = 20; // 10 seconds total

            const checkExist = setInterval(function() {
                attempts++;
                
                // Typical IDs used by tracking.post.ir
                const searchBox = document.getElementById('txtSearch') || document.querySelector('input[type="text"][placeholder*="کد رهگیری"]');
                const captchaBox = document.getElementById('txtCaptcha') || document.querySelector('input[type="text"][id*="Captcha"], input[type="text"][name*="captcha"]'); 
                
                if (searchBox) {
                    clearInterval(checkExist);
                    console.log("🎯 [Delivery Assistant] Search input found. Injecting tracking number.");
                    
                    // Clear the task immediately to prevent re-runs on refresh
                    chrome.storage.local.remove(['postTrackingTask']);

                    // Inject the tracking number using native setter
                    searchBox.focus();
                    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
                    if (setter) {
                        setter.call(searchBox, trackingNo);
                    } else {
                        searchBox.value = trackingNo;
                    }
                    searchBox.dispatchEvent(new Event('input', { bubbles: true }));
                    searchBox.dispatchEvent(new Event('change', { bubbles: true }));
                    
                    // Smart Focus: Move cursor directly to the Captcha field so agent just types
                    if (captchaBox) {
                        captchaBox.focus();
                        console.log("✍️ [Delivery Assistant] Captcha input focused. Waiting for manual input.");
                    } else {
                        console.warn("⚠️ [Delivery Assistant] Captcha input not found by ID. Attempting fallback focus.");
                        const allInputs = Array.from(document.querySelectorAll('input[type="text"]'));
                        const searchIndex = allInputs.indexOf(searchBox);
                        if (searchIndex !== -1 && searchIndex + 1 < allInputs.length) {
                            allInputs[searchIndex + 1].focus();
                        }
                    }
                } else if (attempts >= maxAttempts) {
                    clearInterval(checkExist);
                    chrome.storage.local.remove(['postTrackingTask']);
                    console.error("❌ [Delivery Assistant] Could not find the search input on tracking.post.ir after 10 seconds.");
                }
            }, 500);
        } else if (rawTask) {
            // Clean up invalid task
            chrome.storage.local.remove(['postTrackingTask']);
        }
    });
})();
