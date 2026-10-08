/**
 * iran-post.js
 * Content script specifically for tracking.post.ir
 * Automates tracking number injection and Captcha focus for agents.
 */

(function() {
    'use strict';

    console.log("🚀 [Delivery Assistant] Iran Post Tracker Initialized");

    // We use chrome.storage.local to retrieve the tracking number passed from Automoby
    chrome.storage.local.get(['postTrackingTask'], function(result) {
        const trackingNo = result.postTrackingTask;
        
        if (trackingNo) {
            console.log("📦 [Delivery Assistant] Found Post Tracking Task:", trackingNo);
            
            // Wait for the DOM to be fully ready and the input to appear
            // Post.ir can be slow or use ASP.NET postbacks, so we poll for the input
            let attempts = 0;
            const maxAttempts = 20; // 10 seconds total

            const checkExist = setInterval(function() {
                attempts++;
                
                // Typical IDs used by tracking.post.ir (Adjust if their DOM changes)
                const searchBox = document.getElementById('txtSearch') || document.querySelector('input[type="text"][placeholder*="کد رهگیری"]');
                const captchaBox = document.getElementById('txtCaptcha') || document.querySelector('input[type="text"][id*="Captcha"], input[type="text"][name*="captcha"]'); 
                
                if (searchBox) {
                    clearInterval(checkExist);
                    console.log("🎯 [Delivery Assistant] Search input found. Injecting tracking number.");
                    
                    // Inject the tracking number
                    searchBox.value = trackingNo;
                    // Dispatch events to ensure frontend frameworks (like Vue/React/jQuery) register the change
                    searchBox.dispatchEvent(new Event('input', { bubbles: true }));
                    searchBox.dispatchEvent(new Event('change', { bubbles: true }));
                    
                    // Clear the task so it doesn't infinite loop on page reload
                    chrome.storage.local.remove(['postTrackingTask']);
                    
                    // Smart Focus: Move cursor directly to the Captcha field so agent just types
                    if (captchaBox) {
                        captchaBox.focus();
                        console.log("✍️ [Delivery Assistant] Captcha input focused. Waiting for manual input.");
                    } else {
                        console.warn("⚠️ [Delivery Assistant] Captcha input not found by ID. Attempting fallback focus.");
                        // Fallback: Just focus the next input field after the search box
                        const allInputs = Array.from(document.querySelectorAll('input[type="text"]'));
                        const searchIndex = allInputs.indexOf(searchBox);
                        if (searchIndex !== -1 && searchIndex + 1 < allInputs.length) {
                            allInputs[searchIndex + 1].focus();
                        }
                    }
                } else if (attempts >= maxAttempts) {
                    clearInterval(checkExist);
                    console.error("❌ [Delivery Assistant] Could not find the search input on tracking.post.ir after 10 seconds.");
                }
            }, 500);
        }
    });
})();
