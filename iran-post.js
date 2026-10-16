/**
 * iran-post.js
 * Content script specifically for tracking.post.ir
 * Automatically populates the postal tracking number into #txtbSearch and focuses the Captcha field.
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

    /**
     * Finds the tracking search input on tracking.post.ir.
     * The verified primary input is #txtbSearch with placeholder "شماره مرسوله".
     */
    function findSearchBox() {
        return document.getElementById('txtbSearch') ||
               document.querySelector('input[name="txtbSearch"]') ||
               document.querySelector('input[placeholder*="شماره مرسوله"]') ||
               document.querySelector('input[placeholder*="مرسوله"]') ||
               document.getElementById('txtSearch') ||
               document.querySelector('input[placeholder*="کد رهگیری"]');
    }

    /**
     * Finds the security captcha input on tracking.post.ir.
     * The verified primary input is #txtCaptcha with placeholder "کد امنیتی را واردنمایید".
     */
    function findCaptchaBox() {
        return document.getElementById('txtCaptcha') ||
               document.querySelector('input[name="txtCaptcha"]') ||
               document.querySelector('input[placeholder*="امنیتی"]') ||
               document.querySelector('input[placeholder*="کد امنیتی"]') ||
               document.querySelector('input[id*="Captcha" i]');
    }

    /**
     * Injects the tracking number into the search box, updates native state,
     * dispatches input/change events, and focuses the Captcha box.
     */
    function populateSearchInput(trackingNo) {
        const searchBox = findSearchBox();
        if (!searchBox) return false;

        const captchaBox = findCaptchaBox();

        console.log("🎯 [Delivery Assistant] Target search input found (#" + (searchBox.id || 'unknown') + "). Injecting tracking number:", trackingNo);

        // Native prototype setter to ensure compatibility with any framework/binding
        searchBox.focus();
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
        if (setter) {
            setter.call(searchBox, trackingNo);
        } else {
            searchBox.value = trackingNo;
        }

        searchBox.dispatchEvent(new Event('input', { bubbles: true }));
        searchBox.dispatchEvent(new Event('change', { bubbles: true }));

        // Strict post-check verification
        if (searchBox.value !== trackingNo) {
            searchBox.value = trackingNo;
            searchBox.dispatchEvent(new Event('input', { bubbles: true }));
        }

        // Smart Focus: Move focus directly to the Captcha field so operator can immediately type
        if (captchaBox) {
            captchaBox.focus();
            console.log("✍️ [Delivery Assistant] Captcha input focused (#" + (captchaBox.id || 'unknown') + "). Ready for user input.");
        } else {
            const allInputs = Array.from(document.querySelectorAll('input[type="text"]'));
            const searchIndex = allInputs.indexOf(searchBox);
            if (searchIndex !== -1 && searchIndex + 1 < allInputs.length) {
                allInputs[searchIndex + 1].focus();
            }
        }

        return true;
    }

    let activeCheckTimer = null;
    let activeObserver = null;

    function cleanupWaiters() {
        if (activeCheckTimer) {
            clearInterval(activeCheckTimer);
            activeCheckTimer = null;
        }
        if (activeObserver) {
            activeObserver.disconnect();
            activeObserver = null;
        }
    }

    /**
     * Executes the population task, waiting for the DOM to be ready if needed.
     */
    function executeTrackingTask(rawTask) {
        let trackingNo = toAsciiDigits(String(rawTask || '')).trim();
        if (trackingNo && trackingNo.includes('،')) {
            trackingNo = trackingNo.split('،')[0].trim();
        } else if (trackingNo && trackingNo.includes(',')) {
            trackingNo = trackingNo.split(',')[0].trim();
        }

        if (!trackingNo || !/^[0-9a-zA-Z\-_]{8,35}$/.test(trackingNo)) {
            chrome.storage.local.remove(['postTrackingTask']);
            return false;
        }

        console.log("📦 [Delivery Assistant] Processing Post Tracking Task:", trackingNo);

        cleanupWaiters();

        // 1. Try immediate population
        if (populateSearchInput(trackingNo)) {
            chrome.storage.local.remove(['postTrackingTask']);
            return true;
        }

        // 2. If element is not yet in DOM, set up bounded retry and MutationObserver
        let attempts = 0;
        const maxAttempts = 40; // 10 seconds total (every 250ms)

        const attemptPopulation = () => {
            attempts++;
            if (populateSearchInput(trackingNo)) {
                cleanupWaiters();
                chrome.storage.local.remove(['postTrackingTask']);
                return true;
            }
            if (attempts >= maxAttempts) {
                cleanupWaiters();
                chrome.storage.local.remove(['postTrackingTask']);
                console.error("❌ [Delivery Assistant] Could not find the search input on tracking.post.ir after 10 seconds.");
                return false;
            }
            return false;
        };

        activeCheckTimer = setInterval(attemptPopulation, 250);

        try {
            activeObserver = new MutationObserver(() => {
                if (findSearchBox()) {
                    attemptPopulation();
                }
            });
            activeObserver.observe(document.documentElement || document.body, {
                childList: true,
                subtree: true
            });
        } catch (e) {
            console.warn("MutationObserver fallback error:", e.message);
        }

        return true;
    }

    // 1. On initial load or reload: check storage
    chrome.storage.local.get(['postTrackingTask'], function(result) {
        if (result && result.postTrackingTask) {
            executeTrackingTask(result.postTrackingTask);
        }
    });

    // 2. Direct message listener from background script for active/reused tabs
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message && message.action === 'INJECT_POST_TRACKING') {
            console.log("📨 [Delivery Assistant] Received direct injection message:", message.trackingNo);
            const success = executeTrackingTask(message.trackingNo);
            sendResponse({ success: true, processed: success });
            return true;
        }
    });

    // 3. Storage change listener for active tabs
    chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName === 'local' && changes.postTrackingTask && changes.postTrackingTask.newValue) {
            console.log("🔄 [Delivery Assistant] Detected postTrackingTask storage change:", changes.postTrackingTask.newValue);
            executeTrackingTask(changes.postTrackingTask.newValue);
        }
    });

})();
