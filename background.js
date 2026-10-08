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
});

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
        
        handleChaparFetch(message).then(response => {
            logDebug("5. Final Response sent back to UI", { success: response?.success });
            sendResponse(response);
        }).catch(err => {
            logDebug("FETCH_CHAPAR unhandled rejection", err.message);
            sendResponse({ success: false, error: err.message || 'خطا در ارتباط با سرور' });
        });
        
        return true; // Keep message channel open for async sendResponse
    }
    
    if (message.action === 'OPEN_POST_TAB') {
        handlePostTab(message.query)
            .then(sendResponse)
            .catch(err => sendResponse({ success: false, error: err.message }));
        return true; 
    }
    
    if (message.action === 'OPEN_CHAPAR_TAB') {
        handleChaparTab(message.internalId, message.waybill)
            .then(sendResponse)
            .catch(err => sendResponse({ success: false, error: err.message }));
        return true; 
    }

    if (message.action === 'OPEN_PUBLIC_CHAPAR_TAB') {
        const cleanQuery = toAsciiDigits(String(message.query || '')).trim();
        const query = encodeURIComponent(cleanQuery);
        chrome.tabs.create({ url: `https://www.chaparnet.com/track/${query}` })
            .then(() => sendResponse({ success: true }))
            .catch(err => sendResponse({ success: false, error: err.message }));
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
 * Rigorously checks delivery status from live Chapar responses.
 * Negative guards prevent false positives (e.g. WA: عدم تحویل بدلیل آدرس یا تلفن اشتباه).
 */
function checkDeliveryStatus(portalStatus, popupData, historyLogs) {
    if (popupData?.isDelivered) {
        return {
            isDelivered: true,
            deliveryDate: popupData.deliveredInfo || null,
            deliveredTo: popupData.receiver || null
        };
    }
    
    const st = String(portalStatus || '').trim();
    const isNegative = st.includes('عدم تحویل') || st.includes('عدم') || st.includes('امتناع') || st.includes('برگشت') || st.includes('عودت');
    if (!isNegative && (st === 'OK' || st.startsWith('OK ') || st.startsWith('OK(') || st.includes('سالم تحویل شد') || st.includes('تحویل شد'))) {
        return {
            isDelivered: true,
            deliveryDate: st,
            deliveredTo: null
        };
    }

    if (Array.isArray(historyLogs) && historyLogs.length > 0) {
        for (const log of historyLogs) {
            const lst = String(log.status || '').trim();
            if (lst.includes('عدم تحویل') || lst.includes('عدم') || lst.includes('امتناع') || lst.includes('برگشت') || lst.includes('عودت')) {
                continue;
            }
            if (lst.includes('سالم تحویل شد') || lst.includes('تحویل شد') || lst === 'OK' || lst.startsWith('OK ') || lst.startsWith('OK(')) {
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

function deriveDeliveryDate(orderData, historyLogs) {
    // 1. Direct authoritative delivery_time field from Chapar API
    if (orderData && orderData.delivery_time && typeof orderData.delivery_time === 'string') {
        const dt = orderData.delivery_time.trim();
        if (dt && dt !== '0000/00/00' && dt !== '0000/00/00 00:00:00' && dt !== '-' && !dt.startsWith('0000')) {
            return {
                isDelivered: true,
                deliveryDate: dt,
                deliveredTo: orderData.delivered_to || null,
                source: 'api_delivery_time'
            };
        }
    }

    // 2. Verified delivery status event in history logs
    if (Array.isArray(historyLogs) && historyLogs.length > 0) {
        for (const log of historyLogs) {
            const st = String(log.status || '').trim();
            // Negative guards against false positive matches (e.g., WA: عدم تحویل بدلیل آدرس یا تلفن اشتباه)
            if (st.includes('عدم تحویل') || st.includes('عدم') || st.includes('امتناع') || st.includes('برگشت') || st.includes('عودت')) {
                continue;
            }
            if (st.includes('سالم تحویل شد') || st.includes('تحویل شد') || st === 'OK' || st.startsWith('OK ') || st.startsWith('OK(')) {
                return {
                    isDelivered: true,
                    deliveryDate: log.date || null,
                    deliveredTo: log.receiver || orderData?.delivered_to || null,
                    source: 'history_ok_event'
                };
            }
        }
    }

    // 3. Not delivered yet
    return {
        isDelivered: false,
        deliveryDate: null,
        deliveredTo: null,
        source: 'not_delivered'
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
    } else if (/^\d{20,24}$/.test(pkgNo) && pkgNo !== waybill) {
        detectedPostalBarcode = pkgNo;
    } else if (Array.isArray(packageIds)) {
        const found = packageIds.find(p => /^\d{20,24}$/.test(String(p).trim()) && String(p).trim() !== waybill);
        if (found) detectedPostalBarcode = String(found).trim();
    }

    const isMarkedPostal = method === '11' || service.includes('پستی') || service.includes('پست') || deliveryAgentCode === 'post' || deliveryAgent.includes('پست');

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

    // Check delivered
    const isDelivered = html.includes('SmallTickGreen.png') || (html.includes('تحویل') && html.includes('color:green'));
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
 * Handles fetching Chapar shipment details.
 * Prioritizes the authenticated Chapar portal (portal.chaparnet.com) to extract
 * all verified operational fields, delivery status, and chronological history.
 * If not available in the authenticated portal, falls back to a clean public-tracking safe action.
 */
async function handleChaparFetch(data) {
    try {
        if (data.type === 'گیرنده') {
            return await handleChaparPhoneSearch(data.query);
        }

        const waybill = toAsciiDigits(String(data.query || '')).trim();
        const phone = toAsciiDigits(String(data.phone || '')).trim();

        // Check in-memory cache first to avoid duplicate network load
        const cached = getCachedShipment(waybill);
        if (cached) {
            logDebug("Returning cached shipment data for waybill", waybill);
            return { success: true, data: cached };
        }

        let portalMetadata = {};
        let internalId = null;
        let packageNo = null;
        let packageIds = [];
        let combinedHistory = [];
        let popupData = null;

        // 1. Search Authenticated Chapar Portal (portal.chaparnet.com)
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
                return await res.text();
            };

            // Search attempt 1: by waybill directly
            let searchText = await doPortalSearch(waybill, "ConsignmentNo");

            // Check if user is logged out
            if (searchText.includes('name="password"') && searchText.includes('name="username"')) {
                return { success: false, error: 'AUTH_REQUIRED' };
            }

            let searchJson = parseSloppyJSON(searchText);
            let row = (searchJson && searchJson.rows && searchJson.rows.length > 0 && searchJson.rows[0].id) ? searchJson.rows[0] : null;

            // Search attempt 2: if no row found and waybill looks like package barcode, try suffix wildcard
            if (!row && waybill.length > 10) {
                const suffix = waybill.slice(3);
                searchText = await doPortalSearch("%" + suffix, "ConsignmentNo");
                searchJson = parseSloppyJSON(searchText);
                if (searchJson && searchJson.rows && searchJson.rows.length > 0 && searchJson.rows[0].id) {
                    row = searchJson.rows[0];
                }
            }

            // Search attempt 3: if still no row and customer phone is available, search by receiver phone
            if (!row && phone && phone.length >= 7) {
                searchText = await doPortalSearch(phone, "ReceiverName,ReceiverContact,ReceiverCompany,ReceiverRef,fld_Receiver_Mobile,fld_Receiver_Telephone1,ReceiverADDRESS_LINE_1,ReceiverADDRESS_LINE_2");
                searchJson = parseSloppyJSON(searchText);
                if (searchJson && searchJson.rows && searchJson.rows.length > 0 && searchJson.rows[0].id) {
                    row = searchJson.rows[0];
                }
            }

            if (row && row.id) {
                internalId = row.id;
                const cell = row.cell || [];
                portalMetadata = {
                    pickupDate: stripHtml(cell[1]),
                    portalWaybill: stripHtml(cell[2]),
                    origin: stripHtml(cell[3]),
                    dest: stripHtml(cell[4]),
                    service: stripHtml(cell[5]),
                    status: stripHtml(cell[6]),
                    sender: stripHtml(cell[7]),
                    receiver: stripHtml(cell[8]),
                    pieces: stripHtml(cell[9]),
                    weight: stripHtml(cell[10]),
                    paymentMethod: stripHtml(cell[11])
                };
            }
        } catch (e) {
            logDebug("Portal Consignment Fetch Failed", e.message);
        }

        // 2. If consignment found in authenticated portal, fetch Items, History, and Detail Popup concurrently
        if (internalId) {
            const [itemsResult, historyResult, popupResult] = await Promise.allSettled([
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
                fetchChaparConsignmentPopup(internalId)
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

            // Process Popup result
            if (popupResult.status === 'fulfilled') {
                popupData = popupResult.value;
            } else if (popupResult.status === 'rejected') {
                logDebug("Portal Popup Fetch Failed", popupResult.reason?.message);
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
                { isDelivered, service: portalMetadata.service, method: popupData?.method },
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
                manifestItems: popupData?.manifestItems || [],
                probableTrackingNumber: (popupData?.manifestItems && popupData.manifestItems.length > 0)
                    ? popupData.manifestItems.join('، ')
                    : null,
                origin: popupData?.origin || portalMetadata.origin || null,
                dest: popupData?.dest || portalMetadata.dest || null,
                service: popupData?.method || portalMetadata.service || null,
                method: popupData?.method || portalMetadata.service || null,
                status: portalMetadata.status || (combinedHistory[0]?.status || 'در حال پیگیری'),
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
                postalTrackingNumber: classificationInfo.postalBarcode || null,
                isPostal: classificationInfo.isPostal,
                history: combinedHistory
            };

            // Store in 45s LRU cache
            setCachedShipment(waybill, finalData);

            return { success: true, data: finalData };
        }

        // 3. Fallback when consignment is NOT in authenticated portal (Public-Chapar safe action)
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
async function handleChaparPhoneSearch(phone) {
    const cleanPhone = toAsciiDigits(String(phone || '')).trim();
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

        if ((response.redirected && response.url.includes('login')) || response.status === 401 || response.status === 403) {
            return { success: false, error: 'شما باید در تب دیگری در سایت چاپار لاگین باشید' };
        }

        const rawText = await response.text();
        
        if (rawText.includes('name="password"') && rawText.includes('name="username"')) {
            return { success: false, error: 'شما باید در تب دیگری در سایت چاپار لاگین باشید' };
        }

        let jsonData;
        try {
            jsonData = parseSloppyJSON(rawText);
        } catch (e) {
            return { success: false, error: 'خطای فرمت سرور (' + e.message + '): ' + rawText.substring(0, 150) };
        }

        if (!jsonData || !jsonData.rows || jsonData.rows.length === 0) {
            return { success: false, error: 'هیچ بارنامه‌ای برای این شماره یافت نشد' };
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

        if (parsedResults.length === 0) {
            return { success: false, error: 'هیچ بارنامه‌ای برای این شماره یافت نشد' };
        }

        return { 
            success: true, 
            isPhoneList: true, 
            data: parsedResults 
        };

    } catch (e) {
        logDebug("Phone Search Error", e.message);
        return { success: false, error: e.message || 'خطا در جستجوی شماره تماس' };
    }
}

/**
 * Opens or reuses a tab for Iran Post and injects the tracking number into local storage.
 */
async function handlePostTab(trackingNo) {
    await chrome.storage.local.set({ postTrackingTask: trackingNo });
    const tabs = await chrome.tabs.query({ url: "*://tracking.post.ir/*" });
    
    if (tabs.length > 0) {
        await chrome.tabs.update(tabs[0].id, { active: true });
        await chrome.windows.update(tabs[0].windowId, { focused: true });
        await chrome.tabs.reload(tabs[0].id); 
    } else {
        await chrome.tabs.create({ url: "https://tracking.post.ir/" });
    }
    return { success: true };
}

/**
 * Handles opening the Chapar portal and passing the internalId to the content script via storage.
 */
async function handleChaparTab(internalId, waybill) {
    if (internalId || waybill) {
        await chrome.storage.local.set({ 
            chaparTrackingTask: internalId,
            chaparTrackingWaybill: waybill 
        });
    }
    const tabs = await chrome.tabs.query({ url: "*://portal.chaparnet.com/*" });
    
    if (tabs.length > 0) {
        await chrome.tabs.update(tabs[0].id, { active: true });
        await chrome.windows.update(tabs[0].windowId, { focused: true });
        if (internalId) {
            await chrome.tabs.reload(tabs[0].id); 
        }
    } else {
        await chrome.tabs.create({ url: "https://portal.chaparnet.com/index.php?P=Operation&Tab=Consignment" });
    }
    return { success: true };
}
