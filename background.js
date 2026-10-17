/**
 * background.js
 * 
 * The main Service Worker logic acting as the API Bridge.
 * Handles background REST API fetch requests to Chapar and opens tabs for Iran Post.
 */

// ==========================================
// 🐛 DEBUG LOGGING SYSTEM
// ==========================================
// To view these logs, go to chrome://extensions -> Click "service worker" under this extension.
function maskPII(val) {
    if (typeof val === 'string') {
        return val.replace(/(09\d{2})\d{4}(\d{3})/g, '$1***$2');
    }
    if (val && typeof val === 'object') {
        try {
            const clone = Array.isArray(val) ? [...val] : { ...val };
            if (clone.phone) clone.phone = maskPII(String(clone.phone));
            if (clone.query && typeof clone.query === 'string' && clone.query.startsWith('09')) {
                clone.query = maskPII(clone.query);
            }
            return clone;
        } catch (e) {
            return val;
        }
    }
    return val;
}

function logDebug(title, data = null) {
    const timestamp = new Date().toLocaleTimeString();
    console.log(`[🤖 DeliveryAssistant | ${timestamp}] ${title}`);
    if (data) {
        console.dir(maskPII(data));
    }
}

// ==========================================
// 🛡️ HEADER SPOOFING RULES (Bypass Chapar CSRF/Origin Firewall)
// ==========================================
chrome.runtime.onInstalled.addListener(() => {
    chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: [1],
        addRules: [{
            id: 1,
            priority: 1,
            action: {
                type: 'modifyHeaders',
                requestHeaders: [
                    { header: 'Origin', operation: 'set', value: 'https://portal.chaparnet.com' },
                    { header: 'Referer', operation: 'set', value: 'https://portal.chaparnet.com/index.php?P=Operation&Tab=Consignment' }
                ]
            },
            condition: {
                urlFilter: '*://portal.chaparnet.com/*',
                resourceTypes: ['xmlhttprequest']
            }
        }]
    }).catch(e => logDebug("DNR Rule Error", e.message));

    checkStartupActivation();
    initNativeMessagingBridge();
});

chrome.runtime.onStartup.addListener(() => {
    checkStartupActivation();
    initNativeMessagingBridge();
});

// ==========================================
// 🛡️ SAFE UPDATE & RELOAD BOUNDARY MANAGER
// ==========================================
const activeOperations = new Map(); // opId -> { opId, opName, startedAt, details }
let nextOpId = 1;
let pendingReloadPlan = null;

const PENDING_ACTIVATION_KEY = 'pending_update_activation';
const LAST_UPDATE_KEY = 'last_successful_update';
const MAX_RELOAD_ATTEMPTS = 3;
const OPERATION_STUCK_THRESHOLD_MS = 60000; // 60s threshold for reporting stuck operations

function trackOperationStart(opName = 'operation', details = {}) {
    const opId = nextOpId++;
    activeOperations.set(opId, {
        opId,
        opName,
        startedAt: Date.now(),
        details
    });
    logDebug(`[Ops] Started #${opId}: ${opName} (active count: ${activeOperations.size})`);
    return opId;
}

function trackOperationEnd(opId) {
    if (!opId) return;
    const info = activeOperations.get(opId);
    activeOperations.delete(opId);
    const duration = info ? Date.now() - info.startedAt : 0;
    logDebug(`[Ops] Finished #${opId}: ${info?.opName || 'op'} after ${duration}ms (remaining: ${activeOperations.size})`);

    // Strictly trigger deferred reload only when all operations reach safe boundary (size === 0)
    if (activeOperations.size === 0 && pendingReloadPlan) {
        logDebug("[Ops] All business operations reached safe completion boundary. Executing deferred reload.");
        const plan = pendingReloadPlan;
        pendingReloadPlan = null;
        executeControlledReload(plan);
    }
}

function isSystemBusy() {
    return activeOperations.size > 0;
}

function getActiveOperationsDiagnostics() {
    const now = Date.now();
    const ops = [];
    for (const [id, op] of activeOperations.entries()) {
        const runningSec = Math.round((now - op.startedAt) / 1000);
        ops.push({
            id,
            name: op.opName,
            runningSeconds: runningSec,
            isStuck: (now - op.startedAt) > OPERATION_STUCK_THRESHOLD_MS
        });
    }
    return ops;
}

/**
 * Validates update-ready signal, persists reload state to prevent reload loops,
 * and executes chrome.runtime.reload() when business operations reach a safe boundary.
 *
 * CRITICAL POLICY: NEVER force-reload or interrupt an active business transaction based on a timer!
 */
async function scheduleControlledReload({ targetVersion, transactionId, source = 'NATIVE_MESSAGING' }) {
    const currentVer = chrome.runtime.getManifest().version;
    logDebug(`[Reload] Update notification received. Target: v${targetVersion}, Current: v${currentVer}, Source: ${source}`);

    if (targetVersion && targetVersion === currentVer) {
        logDebug(`[Reload] Extension is already running target version v${currentVer}. No reload required.`);
        return { success: true, message: 'ALREADY_RUNNING_TARGET_VERSION' };
    }

    if (isSystemBusy()) {
        const diagnostics = getActiveOperationsDiagnostics();
        logDebug(`[Reload] Business operations currently active (${activeOperations.size}). Deferring reload until safe boundary.`, diagnostics);
        pendingReloadPlan = { 
            targetVersion, 
            transactionId, 
            source, 
            deferredAt: Date.now() 
        };
        // Deferral remains active until trackOperationEnd decrements activeOperations to 0.
        return { 
            success: true, 
            deferred: true, 
            activeOperationsCount: activeOperations.size,
            activeOperations: diagnostics 
        };
    }

    return await executeControlledReload({ targetVersion, transactionId, source });
}

async function executeControlledReload({ targetVersion, transactionId, source }) {
    try {
        const stored = await chrome.storage.local.get([PENDING_ACTIVATION_KEY]);
        const prev = stored[PENDING_ACTIVATION_KEY];
        let attempts = 1;

        if (prev && prev.targetVersion === targetVersion) {
            attempts = (prev.reloadAttempts || 1) + 1;
            if (attempts > MAX_RELOAD_ATTEMPTS) {
                logDebug(`[Reload] Aborting reload loop. Target v${targetVersion} attempted ${attempts - 1} times without manifest version advancing.`);
                await chrome.storage.local.set({
                    [PENDING_ACTIVATION_KEY]: {
                        ...prev,
                        status: 'LOOP_ABORTED',
                        lastError: 'Max reload attempts exceeded without manifest version change',
                        abortedAt: Date.now()
                    }
                });
                return { success: false, error: 'MAX_RELOAD_ATTEMPTS_EXCEEDED' };
            }
        }

        const activationRecord = {
            targetVersion,
            transactionId: transactionId || '',
            source: source || 'NATIVE_HOST',
            reloadAttempts: attempts,
            status: 'RELOAD_INVOKED',
            requestedAt: Date.now()
        };

        await chrome.storage.local.set({ [PENDING_ACTIVATION_KEY]: activationRecord });
        logDebug(`[Reload] Persisted activation state for v${targetVersion} (attempt ${attempts}/${MAX_RELOAD_ATTEMPTS}). Invoking chrome.runtime.reload()...`);

        // Notify Native Host that reload is taking place
        try {
            chrome.runtime.sendNativeMessage('driver_update_assistant', {
                action: 'RELOAD_INITIATED',
                target_version: targetVersion,
                transaction_id: transactionId || ''
            }, () => {});
        } catch (e) {
            // Non-fatal
        }

        // Brief delay for local storage flush before extension tear-down
        setTimeout(() => {
            try {
                chrome.runtime.reload();
            } catch (reloadErr) {
                logDebug(`[Reload] chrome.runtime.reload() threw: ${reloadErr.message}`);
            }
        }, 150);

        return { success: true, targetVersion, attempts };
    } catch (err) {
        logDebug(`[Reload] Error executing reload: ${err.message}`);
        return { success: false, error: err.message };
    }
}

/**
 * On service worker boot, verifies whether a pending update completed successfully,
 * clears pending state, and notifies the Native Messaging Host of active version.
 */
let startupActivationPromise = null;
function checkStartupActivation() {
    if (!startupActivationPromise) {
        startupActivationPromise = (async () => {
            const currentVer = chrome.runtime.getManifest().version;
            logDebug(`[Lifecycle] Service worker initialized. Running manifest version: v${currentVer}`);

            try {
                const stored = await chrome.storage.local.get([PENDING_ACTIVATION_KEY, LAST_UPDATE_KEY]);
                const pending = stored[PENDING_ACTIVATION_KEY];

                if (pending) {
                    if (pending.targetVersion === currentVer) {
                        logDebug(`[Lifecycle] VERIFIED: Target v${currentVer} is now active (tx: ${pending.transactionId})!`);
                        await chrome.storage.local.remove(PENDING_ACTIVATION_KEY);
                        await chrome.storage.local.set({
                            [LAST_UPDATE_KEY]: {
                                version: currentVer,
                                transactionId: pending.transactionId,
                                activatedAt: Date.now()
                            }
                        });
                        reportRuntimeVersionToNative(currentVer, pending.transactionId);
                    } else {
                        logDebug(`[Lifecycle] Pending target was v${pending.targetVersion}, but running v${currentVer} (attempt: ${pending.reloadAttempts})`);
                    }
                } else {
                    // Normal startup reporting
                    reportRuntimeVersionToNative(currentVer);
                }
            } catch (e) {
                logDebug(`[Lifecycle] Error checking activation: ${e.message}`);
            }
        })();
    }
    return startupActivationPromise;
}

function reportRuntimeVersionToNative(version, txId = '') {
    try {
        chrome.runtime.sendNativeMessage('driver_update_assistant', {
            action: 'REPORT_RUNTIME_VERSION',
            runtime_version: version,
            transaction_id: txId,
            timestamp: Date.now()
        }, (resp) => {
            if (chrome.runtime.lastError) {
                logDebug(`[NativeBridge] Runtime version reporting: ${chrome.runtime.lastError.message}`);
            } else {
                logDebug('[NativeBridge] Native host acknowledged runtime version:', resp);
            }
        });
    } catch (e) {
        logDebug(`[NativeBridge] Failed to send runtime report: ${e.message}`);
    }
}

// ==========================================
// 🔌 NATIVE MESSAGING BRIDGE
// ==========================================
let nativePort = null;
let nativeReconnectTimeout = null;
let isInitializingBridge = false;

function initNativeMessagingBridge() {
    if (nativePort || isInitializingBridge) {
        return;
    }
    isInitializingBridge = true;

    try {
        logDebug("[NativeBridge] Connecting to native host 'driver_update_assistant'...");
        nativePort = chrome.runtime.connectNative('driver_update_assistant');

        nativePort.onMessage.addListener((msg) => {
            logDebug("[NativeBridge] Received message from native host:", msg);
            if (!msg || typeof msg !== 'object') return;

            if (msg.action === 'UPDATE_READY') {
                const currentVer = chrome.runtime.getManifest().version;
                if (msg.target_version && msg.target_version !== currentVer) {
                    logDebug(`[NativeBridge] UPDATE_READY event received for target v${msg.target_version}`);
                    scheduleControlledReload({
                        targetVersion: msg.target_version,
                        transactionId: msg.transaction_id || '',
                        source: 'NATIVE_HOST_PORT'
                    });
                }
            }
        });

        nativePort.onDisconnect.addListener(() => {
            const err = chrome.runtime.lastError?.message || 'Host disconnected';
            logDebug(`[NativeBridge] Disconnected: ${err}`);
            nativePort = null;
            clearTimeout(nativeReconnectTimeout);
            // Attempt reconnect after 10s backoff
            nativeReconnectTimeout = setTimeout(() => {
                initNativeMessagingBridge();
            }, 10000);
        });

        // Report initial version to native host
        nativePort.postMessage({
            action: 'REPORT_RUNTIME_VERSION',
            runtime_version: chrome.runtime.getManifest().version,
            timestamp: Date.now()
        });

    } catch (e) {
        logDebug(`[NativeBridge] Error initializing native bridge: ${e.message}`);
        nativePort = null;
    } finally {
        isInitializingBridge = false;
    }
}

// Kick off initialization immediately on script evaluation
checkStartupActivation();
initNativeMessagingBridge();

// ==========================================
// 📨 EXTENSION MESSAGE DISPATCHER
// ==========================================
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // Validate sender is from this extension
    if (sender.id !== chrome.runtime.id) {
        return false;
    }
    if (!message || typeof message !== 'object') {
        return false;
    }

    if (message.action === 'FETCH_CHAPAR') {
        logDebug("1. Received FETCH_CHAPAR from UI", { action: message.action, type: message.type });
        const opId = trackOperationStart('FETCH_CHAPAR', { type: message.type, query: message.query });
        
        handleChaparFetch(message).then(response => {
            logDebug("5. Final Response sent back to UI", { success: response?.success });
            sendResponse(response);
        }).catch(err => {
            logDebug("FETCH_CHAPAR unhandled rejection", err.message);
            sendResponse({ success: false, error: err.message || 'خطا در ارتباط با سرور' });
        }).finally(() => {
            trackOperationEnd(opId);
        });
        
        return true; // Keep message channel open for async sendResponse
    }
    
    if (message.action === 'CHECK_CHAPAR_AUTH') {
        const opId = trackOperationStart('CHECK_CHAPAR_AUTH');
        checkChaparAuthStatus(message.forceRefresh)
            .then(sendResponse)
            .catch(err => sendResponse({ success: false, state: 'CHECK_FAILED', error: err.message }))
            .finally(() => trackOperationEnd(opId));
        return true;
    }

    if (message.action === 'OPEN_POST_TAB') {
        const opId = trackOperationStart('OPEN_POST_TAB', { query: message.query });
        handlePostTab(message.query)
            .then(sendResponse)
            .catch(err => sendResponse({ success: false, error: err.message }))
            .finally(() => trackOperationEnd(opId));
        return true; 
    }
    
    if (message.action === 'OPEN_CHAPAR_TAB') {
        const opId = trackOperationStart('OPEN_CHAPAR_TAB', { waybill: message.waybill });
        handleChaparTab(message.internalId, message.waybill)
            .then(sendResponse)
            .catch(err => sendResponse({ success: false, error: err.message }))
            .finally(() => trackOperationEnd(opId));
        return true; 
    }

    if (message.action === 'OPEN_PUBLIC_CHAPAR_TAB') {
        const opId = trackOperationStart('OPEN_PUBLIC_CHAPAR_TAB', { query: message.query });
        handlePublicChaparTab(message.query)
            .then(sendResponse)
            .catch(err => sendResponse({ success: false, error: err.message }))
            .finally(() => trackOperationEnd(opId));
        return true;
    }

    if (message.action === 'CHAPAR_AUTH_STATE_CHANGED') {
        if (message.isAuthenticated) {
            cachedChaparAuthState = { state: 'AUTHENTICATED', timestamp: Date.now(), message: null };
            broadcastChaparAuthToTabs(true);
        } else if (message.isLoginPage) {
            cachedChaparAuthState = null;
            broadcastChaparAuthToTabs(false);
        }
        sendResponse({ success: true });
        return true;
    }

    if (message.action === 'JIRA_SEARCH_TICKETS') {
        logDebug("Received JIRA_SEARCH_TICKETS from UI", { parcelId: message.parcelId, waybill: message.waybill });
        const opId = trackOperationStart('JIRA_SEARCH_TICKETS', { waybill: message.waybill, parcelId: message.parcelId });
        handleJiraTicketSearch(message.parcelId, message.waybill)
            .then(response => {
                logDebug("Jira search response sent to UI", { success: response?.success, count: response?.tickets?.length });
                sendResponse(response);
            })
            .catch(err => {
                logDebug("Jira search error", err.message);
                sendResponse({ success: false, error: 'NETWORK_ERROR', message: err.message || 'خطا در ارتباط با سرور Jira' });
            })
            .finally(() => {
                trackOperationEnd(opId);
            });
        return true;
    }

    if (message.action === 'OPEN_JIRA_TAB') {
        const opId = trackOperationStart('OPEN_JIRA_TAB', { url: message.url });
        handleOpenJiraTab(message.url)
            .then(sendResponse)
            .catch(err => sendResponse({ success: false, error: err.message }))
            .finally(() => trackOperationEnd(opId));
        return true;
    }

    if (message.action === 'PREPARE_GOJIRA_ISSUE') {
        const opId = trackOperationStart('PREPARE_GOJIRA_ISSUE', { trackingNumber: message.payload?.trackingNumber });
        handlePrepareGojiraIssue(message.payload, false)
            .then(sendResponse)
            .catch(err => sendResponse({ success: false, error: 'GOJIRA_ERROR', message: err.message }))
            .finally(() => trackOperationEnd(opId));
        return true;
    }

    if (message.action === 'EXECUTE_AUTHORIZED_QA_TEST_ISSUE') {
        const opId = trackOperationStart('EXECUTE_AUTHORIZED_QA_TEST_ISSUE', {});
        handlePrepareGojiraIssue(message.payload, true)
            .then(sendResponse)
            .catch(err => sendResponse({ success: false, error: 'QA_ERROR', message: err.message }))
            .finally(() => trackOperationEnd(opId));
        return true;
    }

    if (message.action === 'QUERY_UPDATE_ASSISTANT') {
        try {
            chrome.runtime.sendNativeMessage('driver_update_assistant', {
                action: 'REPORT_RUNTIME_VERSION',
                runtime_version: chrome.runtime.getManifest().version
            }, (response) => {
                if (chrome.runtime.lastError) {
                    sendResponse({
                        success: false,
                        available: false,
                        message: 'دستیار سیستم در دسترس نیست (نیاز به ثبت یا اجرای دستیار سیستم)',
                        error: chrome.runtime.lastError.message
                    });
                } else {
                    sendResponse({
                        success: true,
                        available: true,
                        active_version: chrome.runtime.getManifest().version,
                        nativeResponse: response
                    });
                }
            });
        } catch (e) {
            sendResponse({ success: false, available: false, error: e.message });
        }
        return true;
    }

    if (message.action === 'TRIGGER_EXTENSION_RELOAD') {
        scheduleControlledReload({
            targetVersion: message.targetVersion || '',
            transactionId: message.transactionId || '',
            source: 'INTERNAL_MESSAGE'
        }).then(result => {
            sendResponse(result);
        }).catch(err => {
            sendResponse({ success: false, error: err.message });
        });
        return true;
    }

    if (message.action === 'GET_ACTIVATION_STATUS') {
        chrome.storage.local.get([PENDING_ACTIVATION_KEY, LAST_UPDATE_KEY]).then(data => {
            sendResponse({
                success: true,
                current_version: chrome.runtime.getManifest().version,
                pending_activation: data[PENDING_ACTIVATION_KEY] || null,
                last_successful_update: data[LAST_UPDATE_KEY] || null,
                is_system_busy: isSystemBusy(),
                active_operations_count: activeOperations.size,
                active_operations: getActiveOperationsDiagnostics(),
                pending_reload: pendingReloadPlan ? {
                    targetVersion: pendingReloadPlan.targetVersion,
                    deferredSeconds: Math.round((Date.now() - pendingReloadPlan.deferredAt) / 1000)
                } : null
            });
        }).catch(err => {
            sendResponse({ success: false, error: err.message });
        });
        return true;
    }

    if (message.action === 'FORCE_DISMISS_STUCK_OPERATIONS_AND_RELOAD') {
        logDebug(`[Ops] Administrative dismissal requested for ${activeOperations.size} operations.`);
        activeOperations.clear();
        if (pendingReloadPlan) {
            const plan = pendingReloadPlan;
            pendingReloadPlan = null;
            executeControlledReload(plan).then(sendResponse);
            return true;
        }
        sendResponse({ success: true, message: 'OPERATIONS_CLEARED' });
        return true;
    }

    if (message.action === 'RELOAD_EXTENSION') {
        scheduleControlledReload({
            targetVersion: message.targetVersion || '',
            transactionId: message.transactionId || '',
            source: 'RELOAD_EXTENSION_MESSAGE'
        }).then(result => {
            sendResponse(result);
        }).catch(err => {
            sendResponse({ success: false, error: err.message });
        });
        return true;
    }
});

/**
 * Helper to parse sloppy PHP-generated JSON that has unquoted keys,
 * single quotes, literal newlines, or Byte Order Marks (BOM).
 * 
 * Chapar's Flexigrid PHP backend emits JavaScript object literals, NOT valid JSON:
 *   - Keys are unquoted:           page: 1, total: 1000
 *   - Strings use single quotes:   {id:'31448975', cell:['...']}
 *   - HTML with escaped quotes inside cells: '<a href=\"#\" onclick=\"...\">...</a>'
 *   - Literal \r\n line breaks inside values
 *   - Invalid escape sequences:    \' (not valid in JSON)
 *   - Possible UTF-8 BOM prefix
 * 
 * A regex approach CANNOT safely handle this because converting ' to " breaks
 * when cell values contain \" (HTML attribute escapes). This tokenizer walks
 * character-by-character to correctly handle string boundaries and escapes.
 */

/**
 * Normalizes Persian and Arabic digits to ASCII [0-9].
 */
function toAsciiDigits(str) {
    if (str == null) return '';
    return String(str)
        .replace(/[\u06F0-\u06F9]/g, d => String.fromCharCode(d.charCodeAt(0) - 0x06F0 + 48))
        .replace(/[\u0660-\u0669]/g, d => String.fromCharCode(d.charCodeAt(0) - 0x0660 + 48));
}

/**
 * Abortable fetch with a configurable timeout.
 */
async function fetchWithTimeout(url, options = {}, timeoutMs = 15000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetch(url, { ...options, signal: controller.signal });
        return res;
    } finally {
        clearTimeout(timer);
    }
}

/**
 * In-memory short-lived cache (45s TTL) for shipment detail queries.
 * Prevents redundant fetches to Chapar's PHP portal when operators re-inspect rows.
 */
const shipmentCache = new Map();
function getCachedShipment(wb) {
    if (!wb) return null;
    const entry = shipmentCache.get(wb);
    if (!entry) return null;
    if (Date.now() - entry.timestamp > 45000) {
        shipmentCache.delete(wb);
        return null;
    }
    return entry.data;
}
function setCachedShipment(wb, data) {
    if (!wb || !data) return;
    if (shipmentCache.size > 50) {
        const firstKey = shipmentCache.keys().next().value;
        shipmentCache.delete(firstKey);
    }
    shipmentCache.set(wb, { data, timestamp: Date.now() });
}

function parseSloppyJSON(rawText) {
    if (!rawText || typeof rawText !== 'string') return null;
    let cleanText = rawText.replace(/^\uFEFF/, '').trim();
    if (!cleanText) return null;
    
    // Fast path: try strict JSON.parse first
    try {
        return JSON.parse(cleanText);
    } catch (strictError) {
        logDebug("Strict JSON.parse failed, using tokenizer", strictError.message);
        
        let converted;
        try {
            converted = tokenizeAndConvert(cleanText);
            return JSON.parse(converted);
        } catch (tokenError) {
            const posMatch = tokenError.message.match(/position (\d+)/);
            if (posMatch && converted) {
                const pos = parseInt(posMatch[1]);
                const region = converted.substring(Math.max(0, pos - 40), pos + 40);
                logDebug("Tokenizer JSON.parse failed near", { position: pos, region, charCode: converted.charCodeAt(pos) });
            }
            throw new Error(`Strict Error: ${strictError.message} | Tokenizer Error: ${tokenError.message}`);
        }
    }
}

/**
 * Enhanced character-by-character tokenizer that converts Chapar's JS-object-literal
 * format into valid JSON. Handles:
 *   - Single-quoted strings → double-quoted, with internal escapes fixed
 *   - Unquoted object keys → double-quoted, resilient to newlines before colon
 *   - Literal newlines inside and outside strings → removed/escaped
 *   - Trailing commas before } and ] → eliminated
 *   - Safe handling of \u not followed by 4 hex digits (e.g. \user)
 *   - Stray backslash escapes (\') → converted to just the character
 */
function tokenizeAndConvert(input) {
    let out = '';
    let i = 0;
    const len = input.length;
    
    while (i < len) {
        const ch = input[i];
        
        // --- Single-quoted string: convert to double-quoted ---
        if (ch === "'") {
            out += '"';
            i++;
            while (i < len && input[i] !== "'") {
                if (input[i] === '\\') {
                    const next = input[i + 1];
                    if (next === "'") {
                        out += "'";
                        i += 2;
                    } else if (next === '"') {
                        out += '\\"';
                        i += 2;
                    } else if (next === '\\') {
                        out += '\\\\';
                        i += 2;
                    } else if (next === 'n' || next === 'r' || next === 't' || next === 'b' || next === 'f') {
                        out += '\\' + next;
                        i += 2;
                    } else if (next === 'u') {
                        // Check if followed by 4 valid hex digits
                        if (/^[0-9a-fA-F]{4}/.test(input.slice(i + 2, i + 6))) {
                            out += '\\u';
                            i += 2;
                        } else {
                            out += '\\\\u';
                            i += 2;
                        }
                    } else if (next === '/') {
                        out += '\\/';
                        i += 2;
                    } else {
                        out += '\\\\' + (next || '');
                        i += 2;
                    }
                } else if (input[i] === '"') {
                    out += '\\"';
                    i++;
                } else if (input[i].charCodeAt(0) < 0x20) {
                    const code = input[i].charCodeAt(0);
                    if (code === 0x0A) out += '\\n';
                    else if (code === 0x0D) out += '\\r';
                    else if (code === 0x09) out += '\\t';
                    else out += '\\u' + code.toString(16).padStart(4, '0');
                    i++;
                } else {
                    out += input[i];
                    i++;
                }
            }
            out += '"';
            i++; // skip closing '
            continue;
        }
        
        // --- Double-quoted string: pass through, fixing only invalid escapes ---
        if (ch === '"') {
            out += '"';
            i++;
            while (i < len && input[i] !== '"') {
                if (input[i] === '\\') {
                    const next = input[i + 1];
                    if (next === '"' || next === '\\' || next === '/' ||
                        next === 'b' || next === 'f' || next === 'n' || 
                        next === 'r' || next === 't') {
                        out += '\\' + next;
                        i += 2;
                    } else if (next === 'u') {
                        if (/^[0-9a-fA-F]{4}/.test(input.slice(i + 2, i + 6))) {
                            out += '\\u';
                            i += 2;
                        } else {
                            out += '\\\\u';
                            i += 2;
                        }
                    } else if (next === "'") {
                        out += "'";
                        i += 2;
                    } else {
                        out += '\\\\' + (next || '');
                        i += 2;
                    }
                } else if (input[i].charCodeAt(0) < 0x20) {
                    const code = input[i].charCodeAt(0);
                    if (code === 0x0A) out += '\\n';
                    else if (code === 0x0D) out += '\\r';
                    else if (code === 0x09) out += '\\t';
                    else out += '\\u' + code.toString(16).padStart(4, '0');
                    i++;
                } else {
                    out += input[i];
                    i++;
                }
            }
            out += '"';
            i++; // skip closing "
            continue;
        }
        
        // --- Literal newlines outside strings → skip ---
        if (ch === '\n' || ch === '\r') {
            i++;
            continue;
        }
        
        // --- Trailing comma elimination before } or ] ---
        if (ch === ',') {
            let nextNonWhiteIdx = i + 1;
            while (nextNonWhiteIdx < len && (input[nextNonWhiteIdx] === ' ' || input[nextNonWhiteIdx] === '\t' || input[nextNonWhiteIdx] === '\r' || input[nextNonWhiteIdx] === '\n')) {
                nextNonWhiteIdx++;
            }
            if (nextNonWhiteIdx < len && (input[nextNonWhiteIdx] === '}' || input[nextNonWhiteIdx] === ']')) {
                i++;
                continue;
            }
        }

        // --- Unquoted key detection ---
        if (isIdentStart(ch) && isAfterKeyPosition(out)) {
            let ident = '';
            while (i < len && isIdentChar(input[i])) {
                ident += input[i];
                i++;
            }
            while (i < len && (input[i] === ' ' || input[i] === '\t' || input[i] === '\r' || input[i] === '\n')) {
                i++;
            }
            if (i < len && input[i] === ':') {
                out += '"' + ident + '"';
            } else {
                out += ident;
            }
            continue;
        }
        
        // --- Everything else: pass through ---
        out += ch;
        i++;
    }
    
    return out;
}

/** Returns true if char can start a JS identifier (letter, _, $) */
function isIdentStart(ch) {
    return /[a-zA-Z_$]/.test(ch);
}

/** Returns true if char can be part of a JS identifier */
function isIdentChar(ch) {
    return /[a-zA-Z0-9_$]/.test(ch);
}

/** 
 * Checks if the most recent non-whitespace character in the output 
 * indicates we're in a position where an unquoted key could appear.
 */
function isAfterKeyPosition(output) {
    for (let j = output.length - 1; j >= 0; j--) {
        const ch = output[j];
        if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n') continue;
        return ch === '{' || ch === ',';
    }
    return true;
}

/**
 * The Silent Fetch logic using a HYBRID of REST API (for metadata) 
 * and Internal Portal API (for 100% accurate detailed logs).
/**
 * Reliable numeric sort key for Shamsi/Jalali date strings (e.g. "1405/07/14 11:58:46" -> 14050714115846).
 * Avoids browser-dependent Gregorian conversions and guarantees perfect chronological order.
 */
function parseShamsiSortKey(dateStr) {
    if (!dateStr || typeof dateStr !== 'string') return 0;
    const cleanDate = toAsciiDigits(dateStr);
    const nums = cleanDate.match(/\d+/g);
    if (!nums || nums.length < 3) return 0;
    const y = nums[0].padStart(4, '0');
    const m = nums[1].padStart(2, '0');
    const d = nums[2].padStart(2, '0');
    const hh = (nums[3] || '0').padStart(2, '0');
    const mm = (nums[4] || '0').padStart(2, '0');
    const ss = (nums[5] || '0').padStart(2, '0');
    return parseInt(`${y}${m}${d}${hh}${mm}${ss}`, 10) || 0;
}

/**
 * Strips HTML tags and resolves portal tooltips/escapes cleanly.
 */
function stripHtml(str) {
    if (typeof str !== 'string') return '';
    let clean = str.replace(/<[^>]*>/g, '').replace(/<[^>]*$/g, '');
    if (clean.includes('Short Name:')) {
        const parts = clean.split('>');
        clean = parts[parts.length - 1];
    }
    return clean.replace(/&nbsp;/g, ' ').replace(/"/g, '').trim();
}

/**
 * Traces the actual delivery status and delivery date from live Chapar responses.
 * Never guesses or falls back to pickup date or registration date.
 */

/**
 * Rigorously checks delivery status from authoritative Chapar server responses.
 * Zero keyword guessing: strictly checks server's CST_ID ('OK'), popup tick icon, or exact event phrase 'سالم تحویل شد'.
 */
function checkDeliveryStatus(portalStatus, popupData, historyLogs) {
    if (popupData?.isDelivered) {
        return {
            isDelivered: true,
            deliveryDate: popupData.deliveredInfo || null,
            deliveredTo: popupData.receiver || null
        };
    }
    
    const st = String(portalStatus || '').trim().toUpperCase();
    if (st === 'OK' || st.startsWith('OK ') || st.startsWith('OK(')) {
        return {
            isDelivered: true,
            deliveryDate: null,
            deliveredTo: null
        };
    }

    if (Array.isArray(historyLogs) && historyLogs.length > 0) {
        for (const log of historyLogs) {
            const rawStatus = String(log.status || '').trim();
            if (rawStatus === 'سالم تحویل شد' || rawStatus.toUpperCase() === 'OK') {
                return {
                    isDelivered: true,
                    deliveryDate: log.date || null,
                    deliveredTo: log.receiver || null
                };
            }
        }
    }

    return {
        isDelivered: false,
        deliveryDate: null,
        deliveredTo: null
    };
}


/**
 * Classifies the shipment into verified states:
 * State A: NORMAL_CHAPAR
 * State B: POSTAL_PENDING (marked as postal, but no separate barcode issued yet)
 * State C: POSTAL_HANDOFF (handed over to Post or postal barcode detected)
 * State D: UNKNOWN (unable to determine safely)
 */
function classifyShipment(orderData, query, packageNo, portalService, historyLogs = [], packageIds = []) {
    const waybill = String(query || '').trim();
    const pkgNo = String(packageNo || '').trim();
    const thirdRef = String(orderData?.third_reference || '').trim();
    const service = String(portalService || orderData?.service || '').trim();
    const method = String(orderData?.method || '').trim();
    const deliveryAgentCode = String(orderData?.delivery_agent_code || '').trim();
    const deliveryAgent = String(orderData?.delivery_agent || '').trim();

    // Check all available package IDs for 20-24 digit postal barcode
    let detectedPostalBarcode = null;
    if (/^\d{20,24}$/.test(thirdRef)) {
        detectedPostalBarcode = thirdRef;
    } else if (orderData?.referenceCause && /^\d{20,24}$/.test(String(orderData.referenceCause).trim())) {
        detectedPostalBarcode = String(orderData.referenceCause).trim();
    } else if (/^\d{20,24}$/.test(pkgNo) && pkgNo !== waybill) {
        detectedPostalBarcode = pkgNo;
    } else if (Array.isArray(packageIds)) {
        const found = packageIds.find(p => /^\d{20,24}$/.test(String(p).trim()) && String(p).trim() !== waybill);
        if (found) detectedPostalBarcode = String(found).trim();
    }

    const isMarkedPostal = method === '11' || service.includes('پستی') || service.includes('پست') || deliveryAgentCode === 'post' || deliveryAgent.includes('پست') || orderData?.thirdCourier === '11' || (orderData?.thirdCourierName && orderData.thirdCourierName.includes('پست'));

    // Check if handoff happened in history logs (explicit post handoff only; OF is out-scan, NOT post!)
    const logs = Array.isArray(historyLogs) && historyLogs.length > 0 
        ? historyLogs 
        : (Array.isArray(orderData?.history) ? orderData.history : []);
    const hasPostHandoffLog = logs.some(log => {
        const s = String(log.status || '');
        const b = String(log.branch || '');
        const by = String(log.by || '');
        const act = String(log.action || '');
        return s.includes('نماینده پست') || s.includes('تحویل به پست') || s.includes('تحویل پست') ||
               b.includes('نماینده پست') || by.includes('نماینده پست') || act.includes('تحویل پست');
    });

    // If shipment is already delivered, do not show postal handoff unless there is an actual postal barcode
    if (orderData?.isDelivered) {
        return {
            state: detectedPostalBarcode ? 'POSTAL_HANDOFF' : 'NORMAL_CHAPAR',
            label: detectedPostalBarcode ? 'تحویل به شرکت ملی پست' : 'چاپار',
            postalBarcode: detectedPostalBarcode,
            isPostal: !!detectedPostalBarcode
        };
    }

    if (detectedPostalBarcode) {
        return {
            state: 'POSTAL_HANDOFF',
            label: 'تحویل به شرکت ملی پست',
            postalBarcode: detectedPostalBarcode,
            isPostal: true
        };
    }

    if (isMarkedPostal || hasPostHandoffLog) {
        return {
            state: 'POSTAL_PENDING',
            label: 'ارسال پستی (در انتظار صدور بارکد)',
            postalBarcode: null,
            isPostal: true
        };
    }

    return {
        state: 'NORMAL_CHAPAR',
        label: 'چاپار',
        postalBarcode: null,
        isPostal: false
    };
}

/**
 * Parses the FormConsignmentHistory popup HTML emitted by the authenticated Chapar portal via xajax.
 */
function parseChaparPopupHTML(rawHtml) {
    if (!rawHtml) return {};
    let html = rawHtml;
    // Unescape XML CDATA / quotes
    html = html.replace(/\\"/g, '"').replace(/\\'/g, "'").replace(/&quot;/g, '"');

    const strip = (s) => (s || '').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

    const getTdAfter = (label) => {
        const pattern = '<td[^>]*>\\s*' + label + ':?\\s*(?:<[^>]+>)*\\s*<\\/td>\\s*<td[^>]*>([\\s\\S]*?)<\\/td>';
        const re = new RegExp(pattern, 'i');
        const m = html.match(re);
        return m ? strip(m[1]) : null;
    };

    const maxDeliveryMatch = html.match(/حداکثر زمان تحویل:?\s*(?:<[^>]+>)*\s*([0-9\/: ]+)/);
    const createdMatch = html.match(/<div>\s*ایجاد:\s*([\s\S]*?)\s*<\/div>/);
    const changedMatch = html.match(/<div>\s*تغییر:\s*([\s\S]*?)\s*<\/div>/);

    // Check delivered - exclusively using SmallTickGreen.png rendered by server
    const isDelivered = html.includes('SmallTickGreen.png');
    const deliveredMatch = html.match(/SmallTickGreen\.png[^>]*>(?:&nbsp;|\s)*([^<]+:\s*[0-9\/: ]+)/);

    // Receiver and Sender address / text
    const recvMatch = html.match(/<td[^>]*>\s*گیرنده:\s*<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>/i);
    const senderMatch = html.match(/<td[^>]*>\s*فرستنده:\s*<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>/i);

    // Extract PACKAGE_LIST / manifest_item entries from the detailed popup
    const extractManifestItems = (srcHtml) => {
        if (!srcHtml) return [];
        const items = [];
        const addItem = (rawVal) => {
            if (!rawVal) return;
            const val = toAsciiDigits(strip(rawVal)).trim();
            if (val && !items.includes(val)) items.push(val);
        };
        const manifestClassRegex = /<[^>]*\bclass=["'][^"']*\bmanifest_item\b[^"']*["'][^>]*>([\s\S]*?)<\/[a-zA-Z0-9]+>/gi;
        let m;
        while ((m = manifestClassRegex.exec(srcHtml)) !== null) {
            addItem(m[1]);
        }
        if (items.length === 0) {
            const idRegex1 = /<[^>]*\bclass=["'][^"']*\bmanifest_item\b[^"']*["'][^>]*\bid=["']([^"']+)["'][^>]*>/gi;
            while ((m = idRegex1.exec(srcHtml)) !== null) addItem(m[1]);
            const idRegex2 = /<[^>]*\bid=["']([^"']+)["'][^>]*\bclass=["'][^"']*\bmanifest_item\b[^"']*["'][^>]*>/gi;
            while ((m = idRegex2.exec(srcHtml)) !== null) addItem(m[1]);
        }
        if (items.length === 0 && srcHtml.includes('PACKAGE_LIST')) {
            const pkgListIdx = srcHtml.indexOf('PACKAGE_LIST');
            const pkgScope = srcHtml.slice(pkgListIdx, pkgListIdx + 4000);
            const divRegex = /<div\b[^>]*\bid=["'](\d+)["'][^>]*>([\s\S]*?)<\/div>/gi;
            while ((m = divRegex.exec(pkgScope)) !== null) {
                if (m[1] !== 'PACKAGE_LIST') addItem(m[1] || m[2]);
            }
        }
        return items;
    };

    const manifestItems = extractManifestItems(html);

    return {
        maxDeliveryTime: maxDeliveryMatch ? maxDeliveryMatch[1].trim() : null,
        paymentMethod: getTdAfter('روش پرداخت'),
        pickupTime: getTdAfter('زمان جمع آوری'),
        pickupDate: getTdAfter('تاریخ جمع آوری'),
        pickupAgent: getTdAfter('نماینده جمع آوری'),
        dest: getTdAfter('مقصد'),
        origin: getTdAfter('مبدا'),
        deliveryAgent: getTdAfter('نماینده توزیع'),
        method: getTdAfter('روش ارسال'),
        contents: getTdAfter('محتویات'),
        reference: getTdAfter('شماره مرجع'),
        weight: getTdAfter('وزن'),
        pieces: getTdAfter('تعداد بسته'),
        createdAt: createdMatch ? strip(createdMatch[1]) : null,
        modifiedAt: changedMatch ? strip(changedMatch[1]) : null,
        isDelivered: isDelivered,
        deliveredInfo: deliveredMatch ? strip(deliveredMatch[1]) : null,
        receiver: recvMatch ? strip(recvMatch[1]) : null,
        sender: senderMatch ? strip(senderMatch[1]) : null,
        manifestItems: manifestItems
    };
}

/**
 * Fetches the full detailed consignment popup from the authenticated Chapar portal via xajax.
 */
async function fetchChaparConsignmentPopup(internalId) {
    if (!internalId) return null;
    try {
        const xml = `<xjxobj><e><k>FormName</k><v>FormConsignmentHistory</v></e><e><k>variables</k><v><xjxobj><e><k>no</k><v>${internalId}</v></e></xjxobj></v></e><e><k>functions</k><v>OpenConsHistory(${internalId});,RunFunction</v></e><e><k>Width</k><v>1500</v></e><e><k>Height</k><v>110</v></e><e><k>Border</k><v>0</v></e><e><k>Padding</k><v>0</v></e><e><k>BoxTPL</k><v>PopupBox.tpl</v></e></xjxobj>`;
        const body = `xajax=DoPHP&xajaxr=${Date.now()}&xajaxargs[]=${encodeURIComponent("DrawPopupForm")}&xajaxargs[]=${encodeURIComponent(xml)}`;
        
        const res = await fetchWithTimeout("https://portal.chaparnet.com/index.php?P=Operation&Tab=Consignment", {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'accept': '*/*'
            },
            credentials: 'include',
            body: body
        }, 15000);
        const text = await res.text();
        return parseChaparPopupHTML(text);
    } catch (e) {
        logDebug("Chapar Popup Fetch Error", e.message);
        return null;
    }
}

/**
 * Parses the FormCons detailed consignment HTML from Chapar portal.
 * Extracts ReferenceCause (شماره بارنامه‌های غیر چاپاری) and ThirdCourier selection.
 */
function parseChaparConsignmentDetailHTML(html) {
    if (!html || typeof html !== 'string') {
        return { referenceCause: null, hasReferenceField: false, thirdCourier: null, thirdCourierName: null };
    }
    const unescaped = html.replace(/\\"/g, '"').replace(/\\'/g, "'");

    let referenceCause = null;
    let hasReferenceField = false;

    // Check for ReferenceCause input field in FormCons
    const inputMatch = unescaped.match(/<input[^>]*?(?:name=["']ReferenceCause["']|id=["']ReferenceCause["'])[^>]*>/i) ||
                       unescaped.match(/<input[^>]*?placeholder=["'][^"']*شماره بارنامه های غیر چاپاری[^"']*["'][^>]*>/i);

    if (inputMatch) {
        hasReferenceField = true;
        const valMatch = inputMatch[0].match(/value=["']([^"']*)["']/i);
        referenceCause = valMatch ? valMatch[1].trim() : '';
    }

    // Fallback: extract from OpenReportWindow('Post', '1931...', ...) if input value was empty or missing
    if (!referenceCause) {
        const reportMatch = unescaped.match(/OpenReportWindow\s*\(\s*['"]Post['"]\s*,\s*['"]([^'"]+)['"]/i);
        if (reportMatch && reportMatch[1].trim()) {
            referenceCause = reportMatch[1].trim();
            hasReferenceField = true;
        }
    }

    // ThirdCourier select extraction
    const selectMatch = unescaped.match(/<select[^>]*?name=["']ThirdCourier["'][^>]*>([\s\S]*?)<\/select>/i);
    let thirdCourier = null;
    let thirdCourierName = null;
    if (selectMatch) {
        const optMatch = selectMatch[1].match(/<option[^>]*?selected[^>]*?value=["']?([^"'>\s]*)["']?[^>]*>([\s\S]*?)<\/option>/i) ||
                         selectMatch[1].match(/<option[^>]*?value=["']?([^"'>\s]*)["']?[^>]*?selected[^>]*>([\s\S]*?)<\/option>/i);
        if (optMatch) {
            thirdCourier = optMatch[1].trim();
            thirdCourierName = optMatch[2].replace(/<[^>]*>/g, '').trim();
        }
    }

    return {
        referenceCause: referenceCause ? toAsciiDigits(referenceCause) : (hasReferenceField ? '' : null),
        hasReferenceField,
        thirdCourier,
        thirdCourierName
    };
}

/**
 * Fetches the detailed consignment form (FormCons) from the authenticated Chapar portal via xajax.
 * Contains ReferenceCause (شماره بارنامه‌های غیر چاپاری) and ThirdCourier selection.
 */
async function fetchChaparConsignmentDetail(internalId) {
    if (!internalId) return null;
    try {
        const xml = `<xjxobj><e><k>FormName</k><v>FormCons</v></e><e><k>variables</k><v><xjxobj><e><k>tbl_name</k><v>tbl_cons</v></e><e><k>key_name</k><v>fld_Cons_No</v></e><e><k>key_no</k><v>${internalId},</v></e></xjxobj></v></e><e><k>functions</k><v></v></e><e><k>Width</k><v>800</v></e><e><k>Height</k><v>550</v></e><e><k>Border</k><v>0</v></e><e><k>Padding</k><v>0</v></e><e><k>BoxTPL</k><v>PopupBox.tpl</v></e></xjxobj>`;
        const body = `xajax=DoPHP&xajaxr=${Date.now()}&xajaxargs[]=${encodeURIComponent("DrawPopupForm")}&xajaxargs[]=${encodeURIComponent(xml)}`;
        
        const res = await fetchWithTimeout("https://portal.chaparnet.com/index.php?P=Operation&Tab=Consignment", {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'accept': '*/*'
            },
            credentials: 'include',
            body: body
        }, 15000);
        const text = await res.text();
        return parseChaparConsignmentDetailHTML(text);
    } catch (e) {
        logDebug("Chapar Consignment Detail Fetch Error", e.message);
        return null;
    }
}

/**
 * Evaluates an HTTP Response and body text from portal.chaparnet.com
 * to determine whether the user is authenticated, needs login, or the portal is unavailable.
 *
 * @param {Response} res - Fetch Response object
 * @param {string} text - Response body string
 * @returns {{ state: 'AUTHENTICATED' | 'NEEDS_LOGIN' | 'PORTAL_UNAVAILABLE' | 'UNKNOWN', message?: string }}
 */
function analyzeChaparPortalAuth(res, text) {
    if (!res) {
        return { state: 'UNKNOWN', message: 'پاسخی از سرور پورتال چاپار دریافت نشد.' };
    }

    // 1. Explicit HTTP Authentication status codes
    if (res.status === 401 || res.status === 403) {
        return {
            state: 'NEEDS_LOGIN',
            message: 'نشست کاربری شما در پورتال چاپار فعال نیست. لطفاً وارد پورتال چاپار شوید.'
        };
    }

    // 2. Server unavailable status codes
    if (res.status >= 500) {
        return {
            state: 'PORTAL_UNAVAILABLE',
            message: `سرور پورتال چاپار در دسترس نیست (خطای ${res.status}).`
        };
    }

    // 3. HTTP Redirects to login page
    if (res.redirected && res.url) {
        const lowerUrl = res.url.toLowerCase();
        if (lowerUrl.includes('login') || lowerUrl.includes('p=login') || lowerUrl.includes('/auth')) {
            return {
                state: 'NEEDS_LOGIN',
                message: 'نشست کاربری شما در پورتال چاپار فعال نیست. لطفاً وارد پورتال چاپار شوید.'
            };
        }
    }

    const body = String(text || '').trim();

    // 4. Critical redirects embedded in XML or JS commands
    const isXmlRedirectToLogin = /<cmd[^>]*>.*?login.*?<\/cmd>/i.test(body);
    const isJsRedirectToLogin = /(?:window\.location|location\.href)\s*=\s*['"][^'"]*login/i.test(body);
    if (isXmlRedirectToLogin || isJsRedirectToLogin) {
        return {
            state: 'NEEDS_LOGIN',
            message: 'نشست کاربری شما در پورتال چاپار فعال نیست. لطفاً وارد پورتال چاپار شوید.'
        };
    }

    // 5. Evidence-based detection of Valid Authenticated Portal Response
    // Authenticated operational HTML markers (guarantees background idle modal frm_IDLELogin does not cause false negative)
    const hasAuthMarkers = body.includes('FormConsignmentHistory') || body.includes('tbl_cons') || body.includes('fld_Cons_No') ||
        body.includes('P=Operation') || body.includes('xajax_DoPHP') || body.includes('FormCons') ||
        body.includes('OpenConsHistory') || body.includes('P=Logout') || body.includes('خروج از سامانه') ||
        body.includes('خروج از حساب') || body.includes('خوش آمدید') || body.includes('سطح دسترسی') ||
        body.includes('مانیفست') || body.includes('تک بارنامه') || body.includes('بارنامه ها') ||
        /(?:>|\s)خروج(?:<|\s)/.test(body);

    if (hasAuthMarkers) {
        return { state: 'AUTHENTICATED' };
    }

    // 6. Evidence-based detection of Login Page markers in HTML body
    const hasPasswordInput = /<input[^>]*?(?:type=["']password["']|name=["']password["']|id=["']password["'])/i.test(body);
    const hasLoginForm = /<form[^>]*?(?:action=["'][^"']*login[^"']*["']|name=["'](?:login|FormLogin)["']|id=["'](?:login|FormLogin)["'])/i.test(body);
    const hasUsernameInput = /<input[^>]*?(?:name=["'](?:username|user_name|user|fld_username)["']|id=["'](?:username|user_name|user)["'])/i.test(body);
    const hasPersianLoginMarker = /(?:ورود به سامانه|ورود به سیستم|ورود به پورتال|لطفا وارد حساب|لطفاً وارد حساب)/i.test(body) && (hasPasswordInput || hasUsernameInput || /<form/i.test(body) || /login/i.test(body));

    if (hasPasswordInput || hasLoginForm || (hasUsernameInput && (hasPasswordInput || /login/i.test(body))) || hasPersianLoginMarker) {
        return {
            state: 'NEEDS_LOGIN',
            message: 'نشست کاربری شما در پورتال چاپار فعال نیست. لطفاً وارد پورتال چاپار شوید.'
        };
    }

    // Consignment.php returns Flexigrid JSON or sloppy JSON with "rows" and "page" or "total"
    if (body.startsWith('{') || body.includes('rows:') || body.includes('"rows":')) {
        const parsed = parseSloppyJSON(body);
        if (parsed && typeof parsed === 'object' && Array.isArray(parsed.rows)) {
            // A non-empty rows array with actual database items confirms an authenticated operational response
            if (parsed.rows.length > 0 && parsed.rows[0] && (parsed.rows[0].id || parsed.rows[0].cell)) {
                return { state: 'AUTHENTICATED' };
            }
            // CRITICAL: An empty rows array ({page:1,total:0,rows:[]}) NEVER proves authentication on its own!
            // It could be returned because the session is logged out OR because 0 shipments matched.
            return {
                state: 'UNKNOWN',
                message: 'پاسخ فاقد رکورد است و وضعیت احراز هویت را به تنهایی مشخص نمی‌کند.'
            };
        }
    }

    // 6. Generic HTML page returned instead of expected data
    if (res.status === 200 && (body.startsWith('<!DOCTYPE') || body.startsWith('<html') || body.includes('<body'))) {
        if (/login|ورود/i.test(body)) {
            return {
                state: 'NEEDS_LOGIN',
                message: 'نشست کاربری شما در پورتال چاپار منقضی شده است. لطفاً وارد سامانه شوید.'
            };
        }
        return {
            state: 'UNKNOWN',
            message: 'پاسخ نامشخصی از سرور چاپار دریافت شد.'
        };
    }

    return { state: 'UNKNOWN', message: 'وضعیت احراز هویت پورتال چاپار نامشخص است.' };
}

let cachedChaparAuthState = null;

function invalidateChaparAuth() {
    cachedChaparAuthState = null;
}

/**
 * Broadcasts Chapar authentication updates to all open Automoby tabs
 * so the UI updates promptly without requiring a page reload.
 */
function broadcastChaparAuthToTabs(isAuthenticated) {
    chrome.tabs.query({ url: "*://panel.automoby.ir/*" }, (tabs) => {
        if (!tabs || !Array.isArray(tabs)) return;
        for (const tab of tabs) {
            if (tab.id) {
                chrome.tabs.sendMessage(tab.id, {
                    action: 'CHAPAR_AUTH_UPDATED',
                    isAuthenticated: !!isAuthenticated
                }).catch(() => {});
            }
        }
    });
}

// Event-driven listener on portal.chaparnet.com tabs to detect navigation/login completion
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    const targetUrl = tab?.url || changeInfo?.url || '';
    if (!targetUrl.includes('portal.chaparnet.com')) return;
    if (changeInfo.status === 'complete') {
        chrome.tabs.sendMessage(tabId, { action: 'PING_PORTAL_SESSION' }, (ping) => {
            if (chrome.runtime.lastError || !ping) return;
            if (ping.isAuthenticated) {
                cachedChaparAuthState = { state: 'AUTHENTICATED', timestamp: Date.now(), message: null };
                broadcastChaparAuthToTabs(true);
            } else if (ping.isLoginPage) {
                cachedChaparAuthState = null;
                broadcastChaparAuthToTabs(false);
            }
        });
    }
});

/**
 * Explicitly tests and reports the Chapar portal authentication status.
 *
 * @param {boolean} forceRefresh - Whether to bypass memory cache
 * @returns {Promise<{ success: boolean, state: string, message?: string, error?: string }>}
 */
async function checkChaparAuthStatus(forceRefresh = false) {
    if (!forceRefresh && cachedChaparAuthState && (Date.now() - cachedChaparAuthState.timestamp < 30000)) {
        return {
            success: cachedChaparAuthState.state === 'AUTHENTICATED',
            state: cachedChaparAuthState.state,
            message: cachedChaparAuthState.message
        };
    }

    // 1. Try querying active portal tabs first
    try {
        const tabs = await chrome.tabs.query({ url: "*://portal.chaparnet.com/*" });
        let hasAuthenticatedTab = false;
        let confirmedLoginTabs = 0;
        let reachedTabs = 0;

        for (const tab of tabs) {
            if (tab.id) {
                try {
                    const ping = await chrome.tabs.sendMessage(tab.id, { action: 'PING_PORTAL_SESSION' });
                    if (ping) {
                        reachedTabs++;
                        if (ping.isAuthenticated) {
                            hasAuthenticatedTab = true;
                            break;
                        }
                        if (ping.isLoginPage) {
                            confirmedLoginTabs++;
                        }
                    }
                } catch (_) {
                    // Content script not ready in this tab, continue
                }
            }
        }

        if (hasAuthenticatedTab) {
            cachedChaparAuthState = { state: 'AUTHENTICATED', timestamp: Date.now(), message: null };
            return { success: true, state: 'AUTHENTICATED' };
        }

        // Only declare NEEDS_LOGIN from tabs if we reached tabs AND every reached tab confirmed it is a login page
        if (tabs.length > 0 && reachedTabs > 0 && confirmedLoginTabs === tabs.length) {
            cachedChaparAuthState = null;
            return {
                success: false,
                state: 'NEEDS_LOGIN',
                message: 'نشست کاربری شما در پورتال چاپار فعال نیست. لطفاً وارد پورتال چاپار شوید.'
            };
        }
    } catch (_) {}

    // 2. Perform authoritative HTTP session verification against operation dashboard
    try {
        const res = await fetchWithTimeout("https://portal.chaparnet.com/index.php?P=Operation&Tab=Consignment", {
            method: 'GET',
            headers: {
                'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
            },
            credentials: 'include'
        }, 12000);

        const text = await res.text();
        const analysis = analyzeChaparPortalAuth(res, text);

        if (analysis.state === 'AUTHENTICATED') {
            cachedChaparAuthState = { state: 'AUTHENTICATED', timestamp: Date.now(), message: null };
            return { success: true, state: 'AUTHENTICATED' };
        } else if (analysis.state === 'NEEDS_LOGIN') {
            cachedChaparAuthState = null;
            return {
                success: false,
                state: 'NEEDS_LOGIN',
                message: analysis.message || 'نشست کاربری شما در پورتال چاپار فعال نیست. لطفاً وارد پورتال چاپار شوید.'
            };
        } else if (analysis.state === 'PORTAL_UNAVAILABLE') {
            cachedChaparAuthState = null;
            return {
                success: false,
                state: 'PORTAL_UNAVAILABLE',
                message: analysis.message || 'سرور پورتال چاپار در دسترس نیست.'
            };
        }

        // If index.php was indeterminate, fallback to empty Consignment.php query check
        const searchBody = new URLSearchParams({
            page: "1", rp: "1", sortname: "tbl_cons.fld_Cons_No", sortorder: "DESC",
            query: "", qtype: "ConsignmentNo"
        });
        const listRes = await fetchWithTimeout("https://portal.chaparnet.com/OBJ/List/Consignment.php?Filter=&__Method=Internal&", {
            method: 'POST',
            headers: { 
                'accept': 'application/json, text/javascript, */*', 
                'content-type': 'application/x-www-form-urlencoded',
                'x-requested-with': 'XMLHttpRequest'
            },
            credentials: 'include',
            body: searchBody.toString()
        }, 12000);

        const listText = await listRes.text();
        const listAnalysis = analyzeChaparPortalAuth(listRes, listText);

        if (listAnalysis.state === 'AUTHENTICATED') {
            cachedChaparAuthState = { state: 'AUTHENTICATED', timestamp: Date.now(), message: null };
            return { success: true, state: 'AUTHENTICATED' };
        }
        if (listAnalysis.state === 'NEEDS_LOGIN') {
            cachedChaparAuthState = null;
            return { success: false, state: 'NEEDS_LOGIN', message: listAnalysis.message };
        }

        cachedChaparAuthState = null;
        return {
            success: false,
            state: 'UNKNOWN',
            message: analysis.message || listAnalysis.message || 'وضعیت احراز هویت پورتال چاپار نامشخص است.'
        };
    } catch (e) {
        cachedChaparAuthState = null;
        const isTimeout = e.name === 'AbortError' || (e.message && e.message.toLowerCase().includes('timeout'));
        const isNetwork = e.message && (e.message.includes('Failed to fetch') || e.message.includes('NetworkError') || e.message.includes('ERR_'));
        return {
            success: false,
            state: (isTimeout || isNetwork) ? 'PORTAL_UNAVAILABLE' : 'CHECK_FAILED',
            error: e.message,
            message: isTimeout ? 'مهلت زمان ارتباط با پورتال چاپار به پایان رسید.' : 'خطا در برقراری ارتباط با پورتال چاپار.'
        };
    }
}

/**
 * Handles fetching Chapar shipment details.
 * Prioritizes the authenticated Chapar portal (portal.chaparnet.com) to extract
 * all verified operational fields, delivery status, and chronological history.
 * If not available in the authenticated portal, falls back to a clean public-tracking safe action.
 */
async function handleChaparFetch(data) {
    try {
        if (data.type === 'گیرنده') {
            return await handleChaparPhoneSearch(data.query, data.forceRefresh);
        }

        const waybill = toAsciiDigits(String(data.query || '')).trim();
        const phone = toAsciiDigits(String(data.phone || '')).trim();

        // Check in-memory cache first to avoid duplicate network load (unless forceRefresh)
        if (!data.forceRefresh) {
            const cached = getCachedShipment(waybill);
            if (cached) {
                logDebug("Returning cached shipment data for waybill", waybill);
                return { success: true, data: cached };
            }
        }

        // 1. Rigorous Step: Establish Authentication State First
        const authStatus = await checkChaparAuthStatus(data.forceRefresh === true);
        if (authStatus.state === 'NEEDS_LOGIN') {
            invalidateChaparAuth();
            return {
                success: false,
                error: 'AUTH_REQUIRED',
                message: authStatus.message || 'نشست کاربری شما در پورتال چاپار فعال نیست. لطفاً وارد پورتال چاپار شوید.'
            };
        }

        if (authStatus.state === 'PORTAL_UNAVAILABLE') {
            return {
                success: false,
                error: 'PORTAL_UNAVAILABLE',
                message: authStatus.message || 'پورتال چاپار در دسترس نیست.'
            };
        }

        if (authStatus.state !== 'AUTHENTICATED') {
            return {
                success: false,
                error: 'CHECK_FAILED',
                message: authStatus.message || 'وضعیت ارتباط با پورتال چاپار نامشخص است.'
            };
        }

        let portalMetadata = {};
        let internalId = null;
        let packageNo = null;
        let packageIds = [];
        let combinedHistory = [];
        let popupData = null;

        // 2. Search Authenticated Chapar Portal (portal.chaparnet.com)
        try {
            const doPortalSearch = async (q, qt) => {
                const searchBody = new URLSearchParams({
                    page: "1", rp: "10", sortname: "tbl_cons.fld_Cons_No", sortorder: "DESC",
                    query: q, qtype: qt
                });
                const res = await fetchWithTimeout("https://portal.chaparnet.com/OBJ/List/Consignment.php?Filter=&__Method=Internal&", {
                    method: 'POST',
                    headers: { 
                        'accept': 'application/json, text/javascript, */*', 
                        'content-type': 'application/x-www-form-urlencoded',
                        'x-requested-with': 'XMLHttpRequest'
                    },
                    credentials: 'include',
                    body: searchBody.toString()
                }, 15000);
                const text = await res.text();
                return { res, text };
            };

            // Search attempt 1: by waybill directly
            let searchResult = await doPortalSearch(waybill, "ConsignmentNo");
            
            // Check for session expiry during the request
            let sessionCheck = analyzeChaparPortalAuth(searchResult.res, searchResult.text);
            if (sessionCheck.state === 'NEEDS_LOGIN') {
                invalidateChaparAuth();
                return {
                    success: false,
                    error: 'AUTH_REQUIRED',
                    message: sessionCheck.message || 'نشست کاربری شما در پورتال چاپار منقضی شده است. لطفاً وارد سامانه شوید.'
                };
            }
            if (sessionCheck.state === 'PORTAL_UNAVAILABLE') {
                return {
                    success: false,
                    error: 'PORTAL_UNAVAILABLE',
                    message: sessionCheck.message || 'پورتال چاپار در دسترس نیست.'
                };
            }

            let searchJson = parseSloppyJSON(searchResult.text);
            if (searchJson === null && !searchResult.text.includes('rows:')) {
                return {
                    success: false,
                    error: 'LOOKUP_ERROR',
                    message: 'خطای فرمت در پاسخ دریافتی از سرور چاپار'
                };
            }

            let row = (searchJson && searchJson.rows && searchJson.rows.length > 0 && searchJson.rows[0].id) ? searchJson.rows[0] : null;

            // Search attempt 2: if no row found and waybill looks like package barcode, try suffix wildcard
            if (!row && waybill.length > 10) {
                const suffix = waybill.slice(3);
                searchResult = await doPortalSearch("%" + suffix, "ConsignmentNo");
                sessionCheck = analyzeChaparPortalAuth(searchResult.res, searchResult.text);
                if (sessionCheck.state === 'NEEDS_LOGIN') {
                    invalidateChaparAuth();
                    return { success: false, error: 'AUTH_REQUIRED', message: sessionCheck.message };
                }
                searchJson = parseSloppyJSON(searchResult.text);
                if (searchJson && searchJson.rows && searchJson.rows.length > 0 && searchJson.rows[0].id) {
                    row = searchJson.rows[0];
                }
            }

            // Search attempt 3: if still no row and customer phone is available, search by receiver phone
            if (!row && phone && phone.length >= 7) {
                searchResult = await doPortalSearch(phone, "ReceiverName,ReceiverContact,ReceiverCompany,ReceiverRef,fld_Receiver_Mobile,fld_Receiver_Telephone1,ReceiverADDRESS_LINE_1,ReceiverADDRESS_LINE_2");
                sessionCheck = analyzeChaparPortalAuth(searchResult.res, searchResult.text);
                if (sessionCheck.state === 'NEEDS_LOGIN') {
                    invalidateChaparAuth();
                    return { success: false, error: 'AUTH_REQUIRED', message: sessionCheck.message };
                }
                searchJson = parseSloppyJSON(searchResult.text);
                if (searchJson && Array.isArray(searchJson.rows) && searchJson.rows.length > 0) {
                    const cleanWb = waybill.trim();
                    const wbSuffix = cleanWb.length > 10 ? cleanWb.slice(3) : null;
                    const matchedRow = searchJson.rows.find(r => {
                        if (!r || !r.id || !Array.isArray(r.cell)) return false;
                        const cellWb = stripHtml(r.cell[2] || '').trim();
                        if (!cellWb) return false;
                        if (cellWb === cleanWb) return true;
                        if (wbSuffix && (cellWb === wbSuffix || cellWb.endsWith(wbSuffix))) return true;
                        return false;
                    });
                    if (matchedRow) {
                        row = matchedRow;
                    }
                }
            }

            if (row && row.id) {
                internalId = row.id;
                const cell = row.cell || [];
                const rawStatusCode = stripHtml(cell[6]).trim();
                portalMetadata = {
                    pickupDate: stripHtml(cell[1]),
                    portalWaybill: stripHtml(cell[2]),
                    origin: stripHtml(cell[3]),
                    dest: stripHtml(cell[4]),
                    service: stripHtml(cell[5]),
                    statusCode: rawStatusCode,
                    status: rawStatusCode,
                    sender: stripHtml(cell[7]),
                    receiver: stripHtml(cell[8]),
                    pieces: stripHtml(cell[9]),
                    weight: stripHtml(cell[10]),
                    paymentMethod: stripHtml(cell[11])
                };
            }
        } catch (e) {
            logDebug("Portal Consignment Fetch Failed", e.message);
            const isTimeout = e.name === 'AbortError' || (e.message && e.message.toLowerCase().includes('timeout'));
            const isNetwork = e.message && (e.message.includes('Failed to fetch') || e.message.includes('NetworkError') || e.message.includes('ERR_'));
            return {
                success: false,
                error: (isTimeout || isNetwork) ? 'PORTAL_UNAVAILABLE' : 'LOOKUP_ERROR',
                message: isTimeout ? 'مهلت زمان ارتباط با پورتال چاپار به پایان رسید.' : (e.message || 'خطا در ارتباط با سرور چاپار')
            };
        }

        // 2. If consignment found in authenticated portal, fetch Items, History, and Detail Popup concurrently
        if (internalId) {
            const [itemsResult, historyResult, popupResult, detailResult] = await Promise.allSettled([
                // 2a. Items (Package numbers)
                (async () => {
                    const itemsBody = new URLSearchParams({
                        page: "1", rp: "100", sortname: "fld_Cons_Item_No", sortorder: "ASC"
                    });
                    const itemsRes = await fetchWithTimeout(`https://portal.chaparnet.com/OBJ/List/ConsignmentItems.php?cons_no=${internalId}&__Method=Internal&`, {
                        method: 'POST',
                        headers: { 
                            'accept': 'application/json, text/javascript, */*', 
                            'content-type': 'application/x-www-form-urlencoded',
                            'x-requested-with': 'XMLHttpRequest'
                        },
                        credentials: 'include',
                        body: itemsBody.toString()
                    }, 12000);
                    const itemsText = await itemsRes.text();
                    return parseSloppyJSON(itemsText);
                })(),
                // 2b. Detailed History Logs from Portal
                (async () => {
                    const historyBody = new URLSearchParams({
                        page: "1", rp: "100", sortname: "COS_STA_DT_TM", sortorder: "DESC",
                        query: "", qtype: "fld_Persian_Note"
                    });
                    const historyRes = await fetchWithTimeout(`https://portal.chaparnet.com/OBJ/List/ConsignmentHistory.php?cons_no=${internalId}&__Method=Internal&`, {
                        method: 'POST',
                        headers: { 
                            'accept': 'application/json, text/javascript, */*', 
                            'content-type': 'application/x-www-form-urlencoded',
                            'x-requested-with': 'XMLHttpRequest'
                        },
                        credentials: 'include',
                        body: historyBody.toString()
                    }, 12000);
                    const historyText = await historyRes.text();
                    return parseSloppyJSON(historyText);
                })(),
                // 2c. Detailed Popup Form from Portal (FormConsignmentHistory)
                fetchChaparConsignmentPopup(internalId),
                // 2d. Detailed Consignment Form from Portal (FormCons) for ReferenceCause & ThirdCourier
                fetchChaparConsignmentDetail(internalId)
            ]);

            // Process Items result
            if (itemsResult.status === 'fulfilled' && itemsResult.value && itemsResult.value.rows) {
                itemsResult.value.rows.forEach(r => {
                    if (r.cell && r.cell[1]) {
                        const pkg = stripHtml(r.cell[1]).trim();
                        if (pkg && !packageIds.includes(pkg)) packageIds.push(pkg);
                    }
                });
                if (packageIds.length > 0) packageNo = packageIds[0];
            } else if (itemsResult.status === 'rejected') {
                logDebug("Portal Items Fetch Failed", itemsResult.reason?.message);
            }

            // Process History result
            if (historyResult.status === 'fulfilled' && historyResult.value && historyResult.value.rows) {
                combinedHistory = historyResult.value.rows.map(row => {
                    const cell = row.cell;
                    const dateStr = stripHtml(cell[3]);
                    return {
                        row: stripHtml(cell[0]),
                        package: stripHtml(cell[1]),
                        status: stripHtml(cell[2]),
                        date: dateStr,
                        by: stripHtml(cell[4]),
                        receiver: stripHtml(cell[5]),
                        branch: stripHtml(cell[6]),
                        action: stripHtml(cell[7]),
                        sortKey: parseShamsiSortKey(dateStr)
                    };
                });
            } else if (historyResult.status === 'rejected') {
                logDebug("Portal History Fetch Failed", historyResult.reason?.message);
            }

            // Process Popup result (FormConsignmentHistory)
            if (popupResult.status === 'fulfilled') {
                popupData = popupResult.value;
            } else if (popupResult.status === 'rejected') {
                logDebug("Portal Popup Fetch Failed", popupResult.reason?.message);
            }

            // Process Consignment Detail result (FormCons)
            let consignmentDetail = null;
            if (detailResult.status === 'fulfilled' && detailResult.value) {
                consignmentDetail = detailResult.value;
            } else if (detailResult.status === 'rejected') {
                logDebug("Portal Consignment Detail Fetch Failed", detailResult.reason?.message);
            }

            // Ensure chronological ordering: newest event always on top
            if (combinedHistory.length > 0) {
                combinedHistory.sort((a, b) => (b.sortKey || 0) - (a.sortKey || 0));
            }

            // Rigorously determine authoritative delivery info without false positives
            const deliveryInfo = checkDeliveryStatus(portalMetadata.status, popupData, combinedHistory);
            const isDelivered = deliveryInfo.isDelivered;
            const deliveryDate = deliveryInfo.deliveryDate;
            const maxDeliveryTime = popupData?.maxDeliveryTime || null;

            // Classify shipment safely
            const classificationInfo = classifyShipment(
                {
                    isDelivered,
                    service: portalMetadata.service,
                    method: popupData?.method,
                    referenceCause: consignmentDetail?.referenceCause,
                    thirdCourier: consignmentDetail?.thirdCourier,
                    thirdCourierName: consignmentDetail?.thirdCourierName
                },
                waybill,
                packageNo,
                portalMetadata.service,
                combinedHistory,
                packageIds
            );

            const finalData = {
                waybill: waybill,
                portalWaybill: portalMetadata.portalWaybill || waybill,
                internalId: internalId,
                packageNo: packageNo || (packageIds.length > 0 ? packageIds[0] : null),
                packageIds: packageIds,
                referenceCause: consignmentDetail?.referenceCause ?? null,
                hasReferenceField: consignmentDetail?.hasReferenceField ?? false,
                referenceError: detailResult.status === 'rejected',
                thirdCourier: consignmentDetail?.thirdCourier || null,
                thirdCourierName: consignmentDetail?.thirdCourierName || null,
                manifestItems: popupData?.manifestItems || [],
                probableTrackingNumber: (popupData?.manifestItems && popupData.manifestItems.length > 0)
                    ? popupData.manifestItems.join('، ')
                    : null,
                origin: popupData?.origin || portalMetadata.origin || null,
                dest: popupData?.dest || portalMetadata.dest || null,
                service: popupData?.method || portalMetadata.service || null,
                method: popupData?.method || portalMetadata.service || null,
                statusCode: (portalMetadata.statusCode || portalMetadata.status || '').toUpperCase(),
                portalStatus: portalMetadata.status || null,
                status: (combinedHistory.length > 0 && combinedHistory[0]?.status)
                    ? combinedHistory[0].status
                    : (portalMetadata.status || 'وضعیت نامشخص'),
                pickupDate: popupData?.pickupDate || portalMetadata.pickupDate || null,
                pickupTime: popupData?.pickupTime || null,
                maxDeliveryTime: maxDeliveryTime,
                weight: popupData?.weight || portalMetadata.weight || null,
                pieces: popupData?.pieces || portalMetadata.pieces || null,
                contents: popupData?.contents || null,
                reference: popupData?.reference || null,
                paymentMethod: popupData?.paymentMethod || portalMetadata.paymentMethod || null,
                pickupAgent: popupData?.pickupAgent || null,
                deliveryAgent: popupData?.deliveryAgent || null,
                createdAt: popupData?.createdAt || null,
                modifiedAt: popupData?.modifiedAt || null,
                sender: popupData?.sender || portalMetadata.sender || null,
                receiver: popupData?.receiver || portalMetadata.receiver || null,
                isDelivered: isDelivered,
                deliveryDate: deliveryDate,
                deliveredTo: isDelivered ? (deliveryInfo.deliveredTo || popupData?.deliveredInfo || portalMetadata.receiver) : null,
                classification: classificationInfo.state,
                classificationLabel: classificationInfo.label,
                postalTrackingNumber: classificationInfo.postalBarcode || (consignmentDetail?.thirdCourier === '11' && consignmentDetail?.referenceCause ? consignmentDetail.referenceCause : null),
                isPostal: classificationInfo.isPostal || consignmentDetail?.thirdCourier === '11',
                history: combinedHistory
            };

            // Store in 45s LRU cache
            setCachedShipment(waybill, finalData);

            return { success: true, data: finalData };
        }

        // 4. Authenticated internal lookup genuine zero-row result:
        // Because authentication was positively confirmed in step 1, no session expiration occurred during lookup,
        // and internal DB query genuinely returned 0 rows, fallback to public tracking!
        return {
            success: true,
            data: {
                isPublicOnly: true,
                waybill: waybill,
                classification: 'PUBLIC_CHAPAR',
                classificationLabel: 'سامانه عمومی چاپار'
            }
        };

    } catch (error) {
        logDebug("❌ Chapar Fetch Error", error.message);
        return { success: false, error: error.message || 'خطا در ارتباط با سرور چاپار' };
    }
}

/**
 * Uses the internal Chapar Portal Flexigrid API to get a list of waybills for a phone number.
 */
async function handleChaparPhoneSearch(phone, forceRefresh = false) {
    const cleanPhone = toAsciiDigits(String(phone || '')).trim();

    // Verify auth first
    const authStatus = await checkChaparAuthStatus(forceRefresh === true);
    if (authStatus.state === 'NEEDS_LOGIN') {
        invalidateChaparAuth();
        return {
            success: false,
            error: 'AUTH_REQUIRED',
            message: authStatus.message || 'نشست کاربری شما در پورتال چاپار فعال نیست. لطفاً وارد پورتال چاپار شوید.'
        };
    }
    if (authStatus.state === 'PORTAL_UNAVAILABLE') {
        return {
            success: false,
            error: 'PORTAL_UNAVAILABLE',
            message: authStatus.message || 'پورتال چاپار در دسترس نیست.'
        };
    }
    if (authStatus.state !== 'AUTHENTICATED') {
        return {
            success: false,
            error: 'CHECK_FAILED',
            message: authStatus.message || 'وضعیت ارتباط با پورتال چاپار نامشخص است.'
        };
    }

    const endpoint = "https://portal.chaparnet.com/OBJ/List/Consignment.php?Filter=&__Method=Internal&";
    
    const bodyParams = new URLSearchParams({
        page: "1",
        rp: "100",
        sortname: "tbl_cons.fld_Cons_No",
        sortorder: "DESC",
        query: cleanPhone,
        qtype: "ReceiverName,ReceiverContact,ReceiverCompany,ReceiverRef,fld_Receiver_Mobile,fld_Receiver_Telephone1,ReceiverADDRESS_LINE_1,ReceiverADDRESS_LINE_2"
    });

    logDebug("Executing Phone Search via Portal", { phone: cleanPhone, endpoint });

    try {
        const response = await fetchWithTimeout(endpoint, {
            method: 'POST',
            headers: {
                'accept': 'application/json, text/javascript, */*',
                'content-type': 'application/x-www-form-urlencoded',
                'x-requested-with': 'XMLHttpRequest'
            },
            credentials: 'include',
            body: bodyParams.toString()
        }, 15000);

        const rawText = await response.text();
        const sessionCheck = analyzeChaparPortalAuth(response, rawText);

        if (sessionCheck.state === 'NEEDS_LOGIN') {
            invalidateChaparAuth();
            return {
                success: false,
                error: 'AUTH_REQUIRED',
                message: sessionCheck.message || 'نشست کاربری شما در پورتال چاپار فعال نیست. لطفاً وارد پورتال چاپار شوید.'
            };
        }

        if (sessionCheck.state === 'PORTAL_UNAVAILABLE') {
            return {
                success: false,
                error: 'PORTAL_UNAVAILABLE',
                message: sessionCheck.message || 'پورتال چاپار در دسترس نیست.'
            };
        }

        let jsonData;
        try {
            jsonData = parseSloppyJSON(rawText);
        } catch (e) {
            return { success: false, error: 'PARSE_ERROR', message: 'خطای فرمت سرور (' + e.message + '): ' + rawText.substring(0, 150) };
        }

        // Must strictly confirm that response is a valid Flexigrid object with a rows array
        if (!jsonData || typeof jsonData !== 'object' || !Array.isArray(jsonData.rows)) {
            return {
                success: false,
                error: 'PARSE_ERROR',
                message: 'پاسخ دریافتی از سرور چاپار فاقد ساختار معتبر است.'
            };
        }

        // Valid completed Flexigrid response with 0 rows: confirmed no shipment records for this number
        if (jsonData.rows.length === 0) {
            return { success: false, error: 'NOT_FOUND', message: 'شماره در چاپار یافت نشد' };
        }

        const parsedResults = jsonData.rows
            .filter(row => row && row.id && String(row.id).trim() !== '' && row.cell && row.cell.length > 2)
            .map(row => {
                const cell = row.cell;
                const pDate = stripHtml(cell[1]);
                const wb = stripHtml(cell[2]);
                return {
                    id: row.id,
                    date: pDate,
                    pickupDate: pDate,
                    waybill: wb,
                    origin: stripHtml(cell[3]),
                    dest: stripHtml(cell[4]),
                    service: stripHtml(cell[5]),
                    status: stripHtml(cell[6])
                };
            })
            .filter(item => item.waybill && item.waybill.trim() !== '');

        // Valid response where rows contained no valid waybill or usable mobile records
        if (parsedResults.length === 0) {
            return { success: false, error: 'NOT_FOUND', message: 'شماره در چاپار یافت نشد' };
        }

        return { 
            success: true, 
            isPhoneList: true, 
            data: parsedResults 
        };

    } catch (e) {
        logDebug("Phone Search Error", e.message);
        const isTimeout = e.name === 'AbortError' || (e.message && e.message.toLowerCase().includes('timeout'));
        const isNetwork = e.message && (e.message.includes('Failed to fetch') || e.message.includes('NetworkError') || e.message.includes('ERR_'));
        return {
            success: false,
            error: (isTimeout || isNetwork) ? 'PORTAL_UNAVAILABLE' : 'LOOKUP_ERROR',
            message: isTimeout ? 'مهلت زمان ارتباط با پورتال چاپار به پایان رسید.' : (e.message || 'خطا در جستجوی شماره تماس')
        };
    }
}

/**
 * Opens or reuses a tab for Iran Post and injects the tracking number into local storage.
 */
async function handlePostTab(trackingNo) {
    let cleanNo = toAsciiDigits(String(trackingNo || '')).trim();
    if (cleanNo.includes('،')) {
        cleanNo = cleanNo.split('،')[0].trim();
    } else if (cleanNo.includes(',')) {
        cleanNo = cleanNo.split(',')[0].trim();
    }
    if (!cleanNo) {
        logDebug("handlePostTab: No tracking number provided");
        return { success: false, error: 'NO_TRACKING_NUMBER' };
    }
    await chrome.storage.local.set({ postTrackingTask: cleanNo });
    const tabs = await chrome.tabs.query({ url: "*://tracking.post.ir/*" });
    
    if (tabs.length > 0) {
        const targetTab = tabs[0];
        await chrome.tabs.update(targetTab.id, { active: true });
        await chrome.windows.update(targetTab.windowId, { focused: true });
        
        // Attempt direct injection first for instant response
        try {
            const resp = await chrome.tabs.sendMessage(targetTab.id, {
                action: 'INJECT_POST_TRACKING',
                trackingNo: cleanNo
            });
            if (resp && resp.success) {
                logDebug("Direct message injection succeeded for Post tracking tab");
                return { success: true };
            }
        } catch (e) {
            logDebug("Direct message injection failed, reloading tab:", e.message);
        }

        await chrome.tabs.reload(targetTab.id); 
    } else {
        await chrome.tabs.create({ url: "https://tracking.post.ir/" });
    }
    return { success: true };
}

/**
 * Opens or reuses a tab for public Chapar tracking and navigates to the tracking URL with the given tracking number.
 */
async function handlePublicChaparTab(trackingNo) {
    let cleanQuery = toAsciiDigits(String(trackingNo || '')).trim();
    if (cleanQuery.includes('،')) {
        cleanQuery = cleanQuery.split('،')[0].trim();
    } else if (cleanQuery.includes(',')) {
        cleanQuery = cleanQuery.split(',')[0].trim();
    }
    if (!cleanQuery) {
        logDebug("handlePublicChaparTab: No tracking number provided");
        return { success: false, error: 'NO_TRACKING_NUMBER' };
    }
    const query = encodeURIComponent(cleanQuery);
    const targetUrl = `https://www.chaparnet.com/track/${query}`;
    const tabs = await chrome.tabs.query({ url: "*://www.chaparnet.com/track/*" });
    
    if (tabs.length > 0) {
        await chrome.tabs.update(tabs[0].id, { url: targetUrl, active: true });
        await chrome.windows.update(tabs[0].windowId, { focused: true });
    } else {
        await chrome.tabs.create({ url: targetUrl });
    }
    return { success: true };
}

/**
 * Handles opening the Chapar portal and passing the internalId to the content script via storage.
 */
async function handleChaparTab(internalId, waybill) {
    if (internalId || waybill) {
        await chrome.storage.local.set({ 
            chaparTrackingTask: internalId || null,
            chaparTrackingWaybill: waybill || null
        });
    }
    const tabs = await chrome.tabs.query({ url: "*://portal.chaparnet.com/*" });
    
    if (tabs.length > 0) {
        const tab = tabs[0];
        await chrome.tabs.update(tab.id, { active: true });
        if (tab.windowId) {
            await chrome.windows.update(tab.windowId, { focused: true });
        }
        // Ping tab to check responsiveness; only reload if unresponsive
        try {
            const pong = await chrome.tabs.sendMessage(tab.id, { action: 'PING_PORTAL_SESSION' });
            if (!pong) {
                await chrome.tabs.reload(tab.id);
            }
        } catch (e) {
            // Tab is unresponsive (e.g. content script not loaded or discarded)
            await chrome.tabs.reload(tab.id);
        }
    } else {
        await chrome.tabs.create({ url: "https://portal.chaparnet.com/index.php?P=Operation&Tab=Consignment" });
    }
    return { success: true };
}

/**
 * Checks if a string is a valid shipment or tracking identifier.
 * Rejects Persian/Arabic text (e.g. 'حضوری', 'پیک', 'تحویل حضوری'),
 * placeholder strings ('null', 'none', '-', 'undefined'),
 * and repeated dummy characters ('111111111111111111', '000000').
 * Accepts pure numeric codes >= 4 digits or valid alphanumeric tracking codes.
 */
function isValidShipmentIdentifier(token) {
    if (!token || typeof token !== 'string') return false;
    const clean = token.trim();
    if (clean.length < 4 || clean.length > 35) return false;

    // Reject any Persian or Arabic letters
    if (/[\u0600-\u06FF]/.test(clean)) return false;

    // Reject common placeholder words
    const lower = clean.toLowerCase();
    if (/^(null|undefined|none|n\/a|na|-+)$/i.test(lower)) return false;

    // Reject repeated dummy characters
    if (/^([0-9a-zA-Z])\1{4,}$/.test(clean)) return false;

    // Valid format: pure digits (4-30 digits) or alphanumeric tracking code with at least one digit
    if (/^\d{4,30}$/.test(clean)) return true;
    if (/^[A-Za-z0-9\-_]{4,35}$/.test(clean) && /\d/.test(clean)) return true;

    return false;
}

/**
 * Searches Jira for existing tickets associated with parcelId and/or waybill.
 * STRICTLY READ-ONLY: Only executes GET /rest/api/2/search queries.
 */
async function handleJiraTicketSearch(parcelId, waybill) {
    const rawTerms = [parcelId, waybill];
    const validTerms = [];

    for (const raw of rawTerms) {
        if (!raw) continue;
        const ascii = toAsciiDigits(String(raw)).trim();
        // Split on common delimiters: slash, comma, Persian comma, pipe, whitespace
        const tokens = ascii.split(/[\/،,\|\s]+/);
        for (let token of tokens) {
            token = token.trim();
            if (isValidShipmentIdentifier(token) && !validTerms.includes(token)) {
                validTerms.push(token);
            }
        }
    }

    if (validTerms.length === 0) {
        return {
            success: false,
            error: 'MISSING_SHIPMENT_NUMBER',
            message: 'شماره مرسوله یا بارنامه معتبر برای این سفارش یافت نشد.'
        };
    }

    // Build read-only JQL query matching tracking custom field, summary, and text
    const clauses = validTerms.map(t => `(cf[10402] ~ "${t}" OR summary ~ "${t}" OR text ~ "${t}")`);
    const jql = `(${clauses.join(' OR ')}) ORDER BY updated DESC`;
    const searchUrl = `https://jira.automoby.ir/rest/api/2/search?jql=${encodeURIComponent(jql)}&maxResults=50&fields=key,summary,description,status,resolution,customfield_10402,project,updated`;

    try {
        const res = await fetchWithTimeout(searchUrl, {
            method: 'GET',
            credentials: 'include',
            headers: {
                'Accept': 'application/json'
            }
        }, 12000);

        if (!res.ok) {
            if (res.status === 401) {
                return {
                    success: false,
                    error: 'AUTH_REQUIRED',
                    message: 'نشست کاربری شما در Jira فعال نیست. لطفاً وارد سامانه Jira شوید.'
                };
            }
            if (res.status === 403) {
                return {
                    success: false,
                    error: 'FORBIDDEN',
                    message: 'عدم دسترسی به جستجوی Jira (خطای ۴۰۳).'
                };
            }
            return {
                success: false,
                error: `HTTP_${res.status}`,
                message: `سرور Jira پاسخ خطای ${res.status} بازگرداند.`
            };
        }

        // Check for redirects to login or auth endpoints
        if (res.redirected && res.url && (res.url.includes('login') || res.url.includes('auth'))) {
            return {
                success: false,
                error: 'AUTH_REQUIRED',
                message: 'نشست کاربری شما در Jira فعال نیست. لطفاً وارد سامانه Jira شوید.'
            };
        }

        const contentType = (res.headers.get('content-type') || '').toLowerCase();
        const rawText = await res.text();

        // Check if response is HTML login page instead of JSON
        if (contentType.includes('text/html') || rawText.includes('<!DOCTYPE') || rawText.includes('<html') || rawText.includes('login.jsp') || rawText.includes('Log in')) {
            return {
                success: false,
                error: 'AUTH_REQUIRED',
                message: 'نشست کاربری شما در Jira فعال نیست. لطفاً وارد سامانه Jira شوید.'
            };
        }

        let data;
        try {
            data = JSON.parse(rawText);
        } catch (jsonErr) {
            return {
                success: false,
                error: 'INVALID_RESPONSE',
                message: 'فرمت پاسخ سرور Jira نامعتبر است.'
            };
        }

        if (!data || !Array.isArray(data.issues)) {
            return {
                success: false,
                error: 'INVALID_RESPONSE',
                message: 'فرمت پاسخ سرور Jira نامعتبر است.'
            };
        }

        // Bounded exact-token verification to prevent partial digit false-positives
        // Normalize issue fields to ASCII digits to match regardless of Persian numerals
        const regexes = validTerms.map(t => new RegExp(`(^|[^0-9A-Za-z])${t}([^0-9A-Za-z]|$)`));
        const matchedIssues = data.issues.filter(issue => {
            const summary = toAsciiDigits(issue.fields?.summary || '');
            const tracking = toAsciiDigits(String(issue.fields?.customfield_10402 || ''));
            const description = toAsciiDigits(issue.fields?.description || '');

            // Priority 1: Direct match in authoritative tracking field cf[10402]
            if (tracking && regexes.some(r => r.test(tracking))) return true;
            // Priority 2: Direct match in issue summary (title)
            if (summary && regexes.some(r => r.test(summary))) return true;
            // Priority 3: Match in description
            if (description && regexes.some(r => r.test(description))) return true;

            return false;
        });

        const tickets = matchedIssues.map(issue => {
            const statusObj = issue.fields?.status || {};
            const statusCategoryObj = statusObj.statusCategory || {};
            const statusName = (statusObj.name || '').trim() || 'وضعیت نامشخص';
            const statusCategoryKey = statusCategoryObj.key || 'unknown';
            const resolutionName = issue.fields?.resolution?.name || null;
            const isResolved = !!issue.fields?.resolution || statusCategoryKey === 'done';

            return {
                key: issue.key,
                url: `https://jira.automoby.ir/browse/${issue.key}`,
                summary: (issue.fields?.summary || '').trim(),
                status: statusName,
                statusCategory: statusCategoryKey,
                statusCategoryName: statusCategoryObj.name || '',
                resolution: resolutionName,
                isResolved: isResolved,
                tracking: issue.fields?.customfield_10402 || null,
                project: issue.fields?.project?.key || null,
                updated: issue.fields?.updated || null
            };
        });

        const isIncomplete = !!(data.total && data.total > data.maxResults);

        return {
            success: true,
            tickets: tickets,
            total: data.total || tickets.length,
            isIncomplete: isIncomplete
        };
    } catch (e) {
        return {
            success: false,
            error: 'NETWORK_ERROR',
            message: e.message || 'خطا در برقراری ارتباط با Jira'
        };
    }
}

/**
 * Validates and safely opens a canonical Jira ticket URL in a new tab.
 */
async function handleOpenJiraTab(rawUrl) {
    if (!rawUrl || typeof rawUrl !== 'string') {
        return { success: false, error: 'آدرس تیکت نامعتبر است.' };
    }
    try {
        const parsed = new URL(rawUrl);
        if (parsed.origin !== 'https://jira.automoby.ir') {
            return { success: false, error: 'آدرس مقصد خارج از سرور Jira است.' };
        }
        if (!/^\/browse\/[A-Z0-9]+-\d+$/.test(parsed.pathname)) {
            return { success: false, error: 'الگوی آدرس تیکت نامعتبر است.' };
        }
        await chrome.tabs.create({ url: rawUrl, active: true });
        return { success: true };
    } catch (e) {
        return { success: false, error: e.message };
    }
}

/**
 * Orchestrates Jira tab focus and issue preparation for GoJira.
 * TAB ISOLATION INVARIANT:
 * Every deliberate GoJira template action opens a NEW, dedicated Jira tab.
 * Existing Jira tabs (including those with unfinished drafts) are NEVER reused,
 * redirected, updated, reloaded, or mutated.
 */
async function handlePrepareGojiraIssue(payload, isLiveQATest = false) {
    if (!payload || !payload.trackingNumber) {
        return { success: false, error: 'MISSING_DATA', message: 'شماره مرسوله برای انتقال به GoJira ناموجود است.' };
    }

    const operationId = 'gojira_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    const targetUrl = `https://jira.automoby.ir/secure/Dashboard.jspa#gojira-op=${operationId}`;

    // Always create a new isolated Jira tab for this workflow
    const targetTab = await chrome.tabs.create({ url: targetUrl, active: true });

    if (targetTab && targetTab.windowId) {
        try {
            await chrome.windows.update(targetTab.windowId, { focused: true });
        } catch (_) {}
    }

    // Persist pending task scoped to this operation and target tab
    const taskData = {
        payload,
        timestamp: Date.now(),
        isLiveQATest,
        operationId,
        targetTabId: targetTab.id
    };
    await chrome.storage.local.set({
        [`gojiraPendingTask_${operationId}`]: taskData,
        gojiraPendingTask: taskData
    });

    // Wait for the new tab to complete loading before dispatching messages
    await new Promise((resolve) => {
        let settled = false;
        const timer = setTimeout(() => {
            if (!settled) {
                settled = true;
                chrome.tabs.onUpdated.removeListener(onTabUpdated);
                resolve();
            }
        }, 12000);

        function onTabUpdated(tabId, changeInfo) {
            if (tabId === targetTab.id && changeInfo.status === 'complete') {
                if (!settled) {
                    settled = true;
                    clearTimeout(timer);
                    chrome.tabs.onUpdated.removeListener(onTabUpdated);
                    resolve();
                }
            }
        }
        chrome.tabs.onUpdated.addListener(onTabUpdated);

        chrome.tabs.get(targetTab.id).then(tab => {
            if (tab && tab.status === 'complete' && !settled) {
                settled = true;
                clearTimeout(timer);
                chrome.tabs.onUpdated.removeListener(onTabUpdated);
                resolve();
            }
        }).catch(() => {});
    });

    // Try direct tab message delivery targeted strictly to targetTab.id
    const action = isLiveQATest ? 'EXECUTE_AUTHORIZED_QA_TEST_ISSUE' : 'PREPARE_GOJIRA_ISSUE';
    try {
        const response = await chrome.tabs.sendMessage(targetTab.id, { action, payload, operationId });
        if (response && response.success) {
            await chrome.storage.local.remove([`gojiraPendingTask_${operationId}`, 'gojiraPendingTask']);
            return response;
        }
    } catch (e) {
        logDebug("Direct tab message to new Jira tab timed out or tab loading, attempting injection/storage fallback:", e.message);
        if (chrome.scripting && targetTab.id) {
            try {
                await chrome.scripting.executeScript({
                    target: { tabId: targetTab.id },
                    files: ['jira-assistant.js']
                });
                const retryResp = await chrome.tabs.sendMessage(targetTab.id, { action, payload, operationId });
                if (retryResp && retryResp.success) {
                    await chrome.storage.local.remove([`gojiraPendingTask_${operationId}`, 'gojiraPendingTask']);
                    return retryResp;
                }
            } catch (injErr) {
                logDebug("Script injection or retry notice:", injErr.message);
            }
        }
    }

    return {
        success: true,
        mode: 'TASK_QUEUED',
        operationId,
        tabId: targetTab.id,
        message: 'در حال باز کردن و آماده‌سازی فرم تیکت در Jira...'
    };
}

