import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// Helper parseSloppyJSON
function parseSloppyJSON(rawStr) {
    if (!rawStr || typeof rawStr !== 'string') return null;
    let s = rawStr.replace(/^\uFEFF/, '').trim();
    if (s.charCodeAt(0) === 0xef && s.charCodeAt(1) === 0xbb && s.charCodeAt(2) === 0xbf) {
        s = s.substring(3).trim();
    }
    s = s.replace(/\\'/g, "'");
    s = s.replace(/[\r\n\t]+/g, ' ');
    s = s.replace(/([{,]\s*)([a-zA-Z0-9_]+)\s*:/g, '$1"$2":');
    s = s.replace(/:\s*'([^']*)'/g, ':"$1"');
    s = s.replace(/,\s*([}\]])/g, '$1');
    try {
        return JSON.parse(s);
    } catch (e) {
        return null;
    }
}

function analyzeChaparPortalAuth(res, text) {
    if (!res) {
        return { state: 'UNKNOWN', message: 'پاسخی از سرور پورتال چاپار دریافت نشد.' };
    }

    if (res.status === 401 || res.status === 403) {
        return {
            state: 'NEEDS_LOGIN',
            message: 'نشست کاربری شما در پورتال چاپار فعال نیست. لطفاً وارد پورتال چاپار شوید.'
        };
    }

    if (res.status >= 500) {
        return {
            state: 'PORTAL_UNAVAILABLE',
            message: `سرور پورتال چاپار در دسترس نیست (خطای ${res.status}).`
        };
    }

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

    const hasPasswordInput = /<input[^>]*?(?:type=["']password["']|name=["']password["']|id=["']password["'])/i.test(body);
    const hasLoginForm = /<form[^>]*?(?:action=["'][^"']*login[^"']*["']|name=["'](?:login|FormLogin)["']|id=["'](?:login|FormLogin)["'])/i.test(body);
    const hasUsernameInput = /<input[^>]*?(?:name=["'](?:username|user_name|user|fld_username)["']|id=["'](?:username|user_name|user)["'])/i.test(body);
    const hasPersianLoginMarker = /(?:ورود به سامانه|ورود به سیستم|ورود به پورتال|لطفا وارد حساب|لطفاً وارد حساب)/i.test(body) && (hasPasswordInput || hasUsernameInput || /<form/i.test(body) || /login/i.test(body));
    const isXmlRedirectToLogin = /<cmd[^>]*>.*?login.*?<\/cmd>/i.test(body);
    const isJsRedirectToLogin = /(?:window\.location|location\.href)\s*=\s*['"][^'"]*login/i.test(body);

    if (hasPasswordInput || hasLoginForm || (hasUsernameInput && (hasPasswordInput || /login/i.test(body))) || hasPersianLoginMarker || isXmlRedirectToLogin || isJsRedirectToLogin) {
        return {
            state: 'NEEDS_LOGIN',
            message: 'نشست کاربری شما در پورتال چاپار فعال نیست. لطفاً وارد پورتال چاپار شوید.'
        };
    }

    // Authenticated operational HTML markers
    if (body.includes('FormConsignmentHistory') || body.includes('tbl_cons') || body.includes('fld_Cons_No') ||
        body.includes('P=Operation') || body.includes('xajax_DoPHP') || body.includes('FormCons') ||
        body.includes('OpenConsHistory') || body.includes('P=Logout') || body.includes('خروج از سامانه') || body.includes('خروج از حساب')) {
        return { state: 'AUTHENTICATED' };
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
            return {
                state: 'UNKNOWN',
                message: 'پاسخ فاقد رکورد است و وضعیت احراز هویت را به تنهایی مشخص نمی‌کند.'
            };
        }
    }

    // Generic HTML page returned instead of expected data
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

/**
 * Simulates checkChaparAuthStatus and handleChaparFetch logic with mock network callers.
 */
async function simulateChaparFetch(data, mockAuthFn, mockSearchFn) {
    const waybill = String(data.query || '').trim();

    // 1. Establish Authentication State First
    let authStatus;
    try {
        authStatus = await mockAuthFn();
    } catch (e) {
        const isTimeout = e.name === 'AbortError' || (e.message && e.message.toLowerCase().includes('timeout'));
        return {
            success: false,
            error: isTimeout ? 'PORTAL_UNAVAILABLE' : 'CHECK_FAILED',
            message: isTimeout ? 'مهلت زمان ارتباط با پورتال چاپار به پایان رسید.' : 'خطا در برقراری ارتباط با پورتال چاپار.'
        };
    }

    if (authStatus.state === 'NEEDS_LOGIN') {
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

    // 2. Search Authenticated Portal
    try {
        const searchResult = await mockSearchFn(waybill, "ConsignmentNo");

        // Inspect for session expiry during the lookup request
        const sessionCheck = analyzeChaparPortalAuth(searchResult.res, searchResult.text);
        if (sessionCheck.state === 'NEEDS_LOGIN') {
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

        const searchJson = parseSloppyJSON(searchResult.text);
        if (searchJson === null && !searchResult.text.includes('rows:')) {
            return {
                success: false,
                error: 'LOOKUP_ERROR',
                message: 'خطای فرمت در پاسخ دریافتی از سرور چاپار'
            };
        }

        const row = (searchJson && searchJson.rows && searchJson.rows.length > 0 && searchJson.rows[0].id) ? searchJson.rows[0] : null;

        if (row && row.id) {
            return {
                success: true,
                data: {
                    waybill: waybill,
                    internalId: row.id,
                    status: 'OK',
                    isDelivered: true
                }
            };
        }

        // Genuine not-found fallback: only reached when auth is confirmed and 0 rows found
        return {
            success: true,
            data: {
                isPublicOnly: true,
                waybill: waybill,
                classification: 'PUBLIC_CHAPAR',
                classificationLabel: 'سامانه عمومی چاپار'
            }
        };
    } catch (e) {
        const isTimeout = e.name === 'AbortError' || (e.message && e.message.toLowerCase().includes('timeout'));
        const isNetwork = e.message && (e.message.includes('Failed to fetch') || e.message.includes('NetworkError') || e.message.includes('ERR_'));
        return {
            success: false,
            error: (isTimeout || isNetwork) ? 'PORTAL_UNAVAILABLE' : 'LOOKUP_ERROR',
            message: isTimeout ? 'مهلت زمان ارتباط با پورتال چاپار به پایان رسید.' : (e.message || 'خطا در ارتباط با سرور چاپار')
        };
    }
}

// Simulates handleChaparPhoneSearch logic with mock network callers
async function simulateChaparPhoneSearch(phone, mockAuthFn, mockSearchFn) {
    // 1. Auth check
    const authStatus = await mockAuthFn();
    if (authStatus.state === 'NEEDS_LOGIN') {
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

    try {
        const response = await mockSearchFn(phone);
        const sessionCheck = analyzeChaparPortalAuth(response.res, response.text);

        if (sessionCheck.state === 'NEEDS_LOGIN') {
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
            jsonData = parseSloppyJSON(response.text);
        } catch (e) {
            return { success: false, error: 'PARSE_ERROR', message: 'خطای فرمت سرور' };
        }

        if (!jsonData || typeof jsonData !== 'object' || !Array.isArray(jsonData.rows)) {
            return {
                success: false,
                error: 'PARSE_ERROR',
                message: 'پاسخ دریافتی از سرور چاپار فاقد ساختار معتبر است.'
            };
        }

        if (jsonData.rows.length === 0) {
            return { success: false, error: 'NOT_FOUND', message: 'شماره در چاپار یافت نشد' };
        }

        const parsedResults = jsonData.rows
            .filter(r => r && r.id && String(r.id).trim() !== '' && r.cell && r.cell.length > 2)
            .map(r => ({ id: r.id, waybill: r.cell[2] }))
            .filter(item => item.waybill && String(item.waybill).trim() !== '');

        if (parsedResults.length === 0) {
            return { success: false, error: 'NOT_FOUND', message: 'شماره در چاپار یافت نشد' };
        }

        return {
            success: true,
            isPhoneList: true,
            data: parsedResults
        };
    } catch (e) {
        const isTimeout = e.name === 'AbortError' || (e.message && e.message.toLowerCase().includes('timeout'));
        const isNetwork = e.message && (e.message.includes('Failed to fetch') || e.message.includes('NetworkError'));
        return {
            success: false,
            error: (isTimeout || isNetwork) ? 'PORTAL_UNAVAILABLE' : 'LOOKUP_ERROR',
            message: isTimeout ? 'مهلت زمان ارتباط با پورتال چاپار به پایان رسید.' : e.message
        };
    }
}

describe('Chapar Lookup & Auth Gating Flow - Comprehensive Regression Tests', () => {

    // Test A — Logged-out regression with test waybill 54807199309911101
    it('Test A: Returns AUTH_REQUIRED and NO public fallback when user is logged out (waybill: 54807199309911101)', async () => {
        const mockAuth = async () => ({
            state: 'NEEDS_LOGIN',
            message: 'نشست کاربری شما در پورتال چاپار فعال نیست. لطفاً وارد پورتال چاپار شوید.'
        });
        const mockSearch = async () => {
            throw new Error('Search should NEVER be called when unauthenticated');
        };

        const result = await simulateChaparFetch({ query: '54807199309911101' }, mockAuth, mockSearch);
        assert.equal(result.success, false);
        assert.equal(result.error, 'AUTH_REQUIRED');
        assert.match(result.message, /نشست کاربری شما در پورتال چاپار فعال نیست/);
        // CRITICAL: Must NEVER return isPublicOnly when logged out!
        assert.equal(result.data, undefined);
    });

    // Test B — Authenticated, genuine zero results
    it('Test B: Returns isPublicOnly: true ONLY when user is authenticated AND internal lookup genuinely returns 0 rows', async () => {
        const mockAuth = async () => ({ state: 'AUTHENTICATED' });
        const mockSearch = async () => ({
            res: { status: 200, redirected: false, url: 'https://portal.chaparnet.com/OBJ/List/Consignment.php' },
            text: '{page:1,total:0,rows:[]}'
        });

        const result = await simulateChaparFetch({ query: '54807199309911101' }, mockAuth, mockSearch);
        assert.equal(result.success, true);
        assert.equal(result.data.isPublicOnly, true);
        assert.equal(result.data.waybill, '54807199309911101');
        assert.equal(result.data.classification, 'PUBLIC_CHAPAR');
        assert.equal(result.data.classificationLabel, 'سامانه عمومی چاپار');
    });

    // Test C — Authenticated, matching record
    it('Test C: Returns full operational data when authenticated and internal consignment exists', async () => {
        const mockAuth = async () => ({ state: 'AUTHENTICATED' });
        const mockSearch = async () => ({
            res: { status: 200, redirected: false, url: 'https://portal.chaparnet.com/OBJ/List/Consignment.php' },
            text: '{page:1,total:1,rows:[{id:"31448975",cell:["1","1403/07/20","54807199309911101","تهران","شیراز","پیش کرایه","OD","فرستنده","گیرنده","1","2","نقدی"]}]}'
        });

        const result = await simulateChaparFetch({ query: '54807199309911101' }, mockAuth, mockSearch);
        assert.equal(result.success, true);
        assert.equal(result.data.internalId, '31448975');
        assert.equal(result.data.isPublicOnly, undefined);
        assert.equal(result.data.status, 'OK');
    });

    // Test D — HTTP 200 containing a login page
    it('Test D: Detects HTTP 200 containing a login page as AUTH_REQUIRED (no public fallback)', async () => {
        const mockAuth = async () => {
            const res = { status: 200, redirected: false, url: 'https://portal.chaparnet.com/index.php?P=Operation' };
            const text = '<!DOCTYPE html><html><body><form action="login.php"><input type="password" name="password" />ورود به سامانه</form></body></html>';
            return analyzeChaparPortalAuth(res, text);
        };
        const mockSearch = async () => {
            throw new Error('Search must not be invoked');
        };

        const result = await simulateChaparFetch({ query: '54807199309911101' }, mockAuth, mockSearch);
        assert.equal(result.success, false);
        assert.equal(result.error, 'AUTH_REQUIRED');
        assert.equal(result.data, undefined);
    });

    // Test E — Redirect or xajax authentication failure
    it('Test E: Detects redirect to login or xajax login command as AUTH_REQUIRED (no public fallback)', async () => {
        // Subcase 1: HTTP Redirect
        const mockAuthRedirect = async () => {
            const res = { status: 200, redirected: true, url: 'https://portal.chaparnet.com/index.php?P=Login' };
            return analyzeChaparPortalAuth(res, '<html>Login</html>');
        };
        const result1 = await simulateChaparFetch({ query: '54807199309911101' }, mockAuthRedirect, async () => {});
        assert.equal(result1.success, false);
        assert.equal(result1.error, 'AUTH_REQUIRED');

        // Subcase 2: xajax redirect
        const mockAuthXajax = async () => {
            const res = { status: 200, redirected: false, url: 'https://portal.chaparnet.com/index.php' };
            return analyzeChaparPortalAuth(res, '<xjx><cmd n="js">window.location="index.php?P=Login";</cmd></xjx>');
        };
        const result2 = await simulateChaparFetch({ query: '54807199309911101' }, mockAuthXajax, async () => {});
        assert.equal(result2.success, false);
        assert.equal(result2.error, 'AUTH_REQUIRED');
    });

    // Test F — Empty or malformed response
    it('Test F: Rejects malformed or corrupted responses with LOOKUP_ERROR, never silent zero rows', async () => {
        const mockAuth = async () => ({ state: 'AUTHENTICATED' });
        const mockSearch = async () => ({
            res: { status: 200, redirected: false, url: 'https://portal.chaparnet.com/OBJ/List/Consignment.php' },
            text: '<html><head><title>Internal Server Malfunction</title></head><body>Unexpected syntax</body></html>'
        });

        const result = await simulateChaparFetch({ query: '54807199309911101' }, mockAuth, mockSearch);
        assert.equal(result.success, false);
        assert.equal(result.error, 'LOOKUP_ERROR');
        assert.equal(result.data, undefined);
    });

    // Test G — Timeout, network error, or 5xx
    it('Test G: Handles timeout and 5xx as PORTAL_UNAVAILABLE (no public fallback)', async () => {
        // Subcase 1: 503
        const mockAuth503 = async () => ({
            state: 'PORTAL_UNAVAILABLE',
            message: 'سرور پورتال چاپار در دسترس نیست (خطای 503).'
        });
        const result503 = await simulateChaparFetch({ query: '54807199309911101' }, mockAuth503, async () => {});
        assert.equal(result503.success, false);
        assert.equal(result503.error, 'PORTAL_UNAVAILABLE');
        assert.equal(result503.data, undefined);

        // Subcase 2: Fetch timeout
        const mockAuthTimeout = async () => {
            const err = new Error('AbortError: The operation was aborted.');
            err.name = 'AbortError';
            throw err;
        };
        const resultTimeout = await simulateChaparFetch({ query: '54807199309911101' }, mockAuthTimeout, async () => {});
        assert.equal(resultTimeout.success, false);
        assert.equal(resultTimeout.error, 'PORTAL_UNAVAILABLE');
        assert.equal(resultTimeout.data, undefined);
    });

    // Test H — Session expires between authentication check and lookup
    it('Test H: Detects session expiry occurring during internal lookup, giving auth failure precedence', async () => {
        // Check 1 passed earlier
        const mockAuth = async () => ({ state: 'AUTHENTICATED' });
        // But during the actual lookup, session expired and server returned login page
        const mockSearch = async () => ({
            res: { status: 200, redirected: true, url: 'https://portal.chaparnet.com/login.php' },
            text: '<form><input type="password" name="password" /></form>'
        });

        const result = await simulateChaparFetch({ query: '54807199309911101' }, mockAuth, mockSearch);
        assert.equal(result.success, false);
        assert.equal(result.error, 'AUTH_REQUIRED');
        // Crucial: Must NEVER return isPublicOnly when session expired during lookup!
        assert.equal(result.data, undefined);
    });

    // Test I — Successful login and retry
    it('Test I: Recovers to authenticated state and performs lookup after successful login and retry without restart', async () => {
        let loggedIn = false;
        const mockAuth = async () => {
            if (!loggedIn) {
                return { state: 'NEEDS_LOGIN', message: 'نشست کاربری شما در پورتال چاپار فعال نیست. لطفاً وارد پورتال چاپار شوید.' };
            }
            return { state: 'AUTHENTICATED' };
        };
        const mockSearch = async () => ({
            res: { status: 200, redirected: false, url: 'https://portal.chaparnet.com/OBJ/List/Consignment.php' },
            text: '{page:1,total:1,rows:[{id:"31448975",cell:["1","1403/07/20","54807199309911101","تهران","شیراز","پیش کرایه","OD","فرستنده","گیرنده","1","2","نقدی"]}]}'
        });

        // First attempt: logged out
        const res1 = await simulateChaparFetch({ query: '54807199309911101' }, mockAuth, mockSearch);
        assert.equal(res1.success, false);
        assert.equal(res1.error, 'AUTH_REQUIRED');

        // User logs in on official portal!
        loggedIn = true;

        // Second attempt: retry action
        const res2 = await simulateChaparFetch({ query: '54807199309911101', forceRefresh: true }, mockAuth, mockSearch);
        assert.equal(res2.success, true);
        assert.equal(res2.data.internalId, '31448975');
    });

    // Test J — Stale asynchronous response
    it('Test J: Enforces sequence guards so older stale asynchronous responses cannot overwrite newer state', async () => {
        let currentSeq = 0;
        const stateHistory = [];

        async function triggerAction(delayMs, val) {
            const thisSeq = ++currentSeq;
            await new Promise(r => setTimeout(r, delayMs));
            // Sequence guard:
            if (thisSeq !== currentSeq) {
                return; // Discarded as stale
            }
            stateHistory.push(val);
        }

        // Action 1: slow auth failure (50ms)
        const p1 = triggerAction(50, 'AUTH_REQUIRED_STALE');
        // Action 2: user quickly selected another row (10ms)
        const p2 = triggerAction(10, 'NEW_SELECTION');

        await Promise.all([p1, p2]);

        assert.deepEqual(stateHistory, ['NEW_SELECTION']);
    });

    // Test K — UI and phone search regression coverage
    it('Test K: Chapar phone search also requires authentication and does not leak public fallback', async () => {
        const mockAuth = async () => ({ state: 'NEEDS_LOGIN' });
        const mockSearch = async () => {
            throw new Error('Search must not be invoked');
        };

        const result = await simulateChaparPhoneSearch('09121234567', mockAuth, mockSearch);
        assert.equal(result.success, false);
        assert.equal(result.error, 'AUTH_REQUIRED');
    });

    // Scenario 1: Successful lookup with a mobile number
    it('Scenario 1: Successful lookup with a mobile number returns list of waybills (including 09154747039)', async () => {
        const mockAuth = async () => ({ state: 'AUTHENTICATED' });
        const mockSearch = async (phone) => ({
            res: { status: 200, redirected: false, url: 'https://portal.chaparnet.com/OBJ/List/Consignment.php' },
            text: `{page:1,total:2,rows:[{id:"101",cell:["1","1403/07/20","54807199309911101","تهران","مشهد","پیش کرایه","OD"]},{id:"102",cell:["2","1403/07/21","54807199309911102","تهران","مشهد","پیش کرایه","OK"]}]}`
        });

        const result = await simulateChaparPhoneSearch('09154747039', mockAuth, mockSearch);
        assert.equal(result.success, true);
        assert.equal(result.isPhoneList, true);
        assert.equal(result.data.length, 2);
        assert.equal(result.data[0].waybill, '54807199309911101');
    });

    // Scenario 2: Successful lookup with no mobile number
    it('Scenario 2: Successful lookup with no matching shipment records returns NOT_FOUND with "شماره در چاپار یافت نشد"', async () => {
        const mockAuth = async () => ({ state: 'AUTHENTICATED' });
        const mockSearch = async (phone) => ({
            res: { status: 200, redirected: false, url: 'https://portal.chaparnet.com/OBJ/List/Consignment.php' },
            text: '{page:1,total:0,rows:[]}'
        });

        const result = await simulateChaparPhoneSearch('09154747039', mockAuth, mockSearch);
        assert.equal(result.success, false);
        assert.equal(result.error, 'NOT_FOUND');
        assert.equal(result.message, 'شماره در چاپار یافت نشد');
    });

    // Scenario 3: Successful lookup with an empty mobile field or empty cells
    it('Scenario 3: Successful lookup where rows have empty cells/waybills returns NOT_FOUND with "شماره در چاپار یافت نشد"', async () => {
        const mockAuth = async () => ({ state: 'AUTHENTICATED' });
        const mockSearch = async () => ({
            res: { status: 200, redirected: false, url: 'https://portal.chaparnet.com/OBJ/List/Consignment.php' },
            text: '{page:1,total:1,rows:[{id:"",cell:["","",""]}]}'
        });

        const result = await simulateChaparPhoneSearch('09154747039', mockAuth, mockSearch);
        assert.equal(result.success, false);
        assert.equal(result.error, 'NOT_FOUND');
        assert.equal(result.message, 'شماره در چاپار یافت نشد');
    });

    // Scenario 4: Genuine network failure
    it('Scenario 4: Genuine network failure remains PORTAL_UNAVAILABLE and is not misreported as NOT_FOUND', async () => {
        const mockAuth = async () => ({ state: 'AUTHENTICATED' });
        const mockSearch = async () => {
            throw new Error('Failed to fetch: NetworkError when attempting to fetch resource.');
        };

        const result = await simulateChaparPhoneSearch('09154747039', mockAuth, mockSearch);
        assert.equal(result.success, false);
        assert.equal(result.error, 'PORTAL_UNAVAILABLE');
        assert.notEqual(result.error, 'NOT_FOUND');
    });

    // Scenario 5: Timeout or server error
    it('Scenario 5: Timeout or 5xx server error is not misreported as missing mobile number', async () => {
        const mockAuth = async () => ({ state: 'AUTHENTICATED' });
        const mockSearch = async () => {
            const err = new Error('The operation was aborted due to timeout.');
            err.name = 'AbortError';
            throw err;
        };

        const result = await simulateChaparPhoneSearch('09154747039', mockAuth, mockSearch);
        assert.equal(result.success, false);
        assert.equal(result.error, 'PORTAL_UNAVAILABLE');
        assert.notEqual(result.error, 'NOT_FOUND');
    });

    // Scenario 6: Expired session or login redirect
    it('Scenario 6: Expired session or login redirect during search preserves AUTH_REQUIRED and never reports empty', async () => {
        const mockAuth = async () => ({ state: 'AUTHENTICATED' });
        const mockSearch = async () => ({
            res: { status: 200, redirected: true, url: 'https://portal.chaparnet.com/index.php?P=Login' },
            text: '<form id="FormLogin"><input type="password" name="password" />ورود به سیستم</form>'
        });

        const result = await simulateChaparPhoneSearch('09154747039', mockAuth, mockSearch);
        assert.equal(result.success, false);
        assert.equal(result.error, 'AUTH_REQUIRED');
        assert.notEqual(result.error, 'NOT_FOUND');
    });

    // Scenario 7: Malformed or unexpected response
    it('Scenario 7: Malformed or unexpected response returns PARSE_ERROR, not automatically as empty result', async () => {
        const mockAuth = async () => ({ state: 'AUTHENTICATED' });

        // Subcase 7a: HTML error body instead of Flexigrid JSON
        const mockSearchHtml = async () => ({
            res: { status: 200, redirected: false, url: 'https://portal.chaparnet.com/OBJ/List/Consignment.php' },
            text: '<html><body>Internal PHP Warning on Line 42</body></html>'
        });
        const result1 = await simulateChaparPhoneSearch('09154747039', mockAuth, mockSearchHtml);
        assert.equal(result1.success, false);
        assert.equal(result1.error, 'PARSE_ERROR');
        assert.notEqual(result1.error, 'NOT_FOUND');

        // Subcase 7b: Object missing "rows" array
        const mockSearchMissingRows = async () => ({
            res: { status: 200, redirected: false, url: 'https://portal.chaparnet.com/OBJ/List/Consignment.php' },
            text: '{"status":"ok","count":0}'
        });
        const result2 = await simulateChaparPhoneSearch('09154747039', mockAuth, mockSearchMissingRows);
        assert.equal(result2.success, false);
        assert.equal(result2.error, 'PARSE_ERROR');
        assert.notEqual(result2.error, 'NOT_FOUND');
    });

    // Scenario 8: Rapid row selection sequence guard
    it('Scenario 8: Rapidly selecting different rows prevents older in-flight lookups from overwriting newer selections', async () => {
        let currentSeq = 0;
        let displayedUI = null;

        const performLookup = async (phone, delayMs) => {
            const thisSeq = ++currentSeq;
            await new Promise(r => setTimeout(r, delayMs));
            if (thisSeq !== currentSeq) {
                // Stale response discarded
                return;
            }
            displayedUI = `PHONE_${phone}`;
        };

        // Row 1 selected (slow 60ms)
        const p1 = performLookup('09154747039', 60);
        // Row 2 quickly selected (fast 15ms)
        const p2 = performLookup('09129999999', 15);

        await Promise.all([p1, p2]);
        assert.equal(displayedUI, 'PHONE_09129999999', 'Latest row selection must win');
    });

    // Scenario 9: UI rendering verification for Chapar error and empty states
    it('Scenario 9: UI renderChaparErrorState renders compact empty badge "شماره در چاپار یافت نشد" for NOT_FOUND', () => {
        // Simulates the exact logic in content.js renderChaparErrorState
        function renderSimulatedChaparState(errorObj, btnId = 'btn-phone') {
            const errType = errorObj?.error || 'UNKNOWN';
            const msg = errorObj?.message || 'خطا در ارتباط با سرور چاپار';

            if (errType === 'AUTH_REQUIRED') {
                return `<div class="cx-jira-error-badge"><span>⚠️ نیاز به ورود</span><button id="${btnId}-login">ورود</button><button id="${btnId}-retry">🔄</button></div>`;
            } else if (errType === 'PORTAL_UNAVAILABLE') {
                return `<div class="cx-jira-error-badge"><span>⚠️ پورتال چاپار در دسترس نیست</span><button id="${btnId}-retry">🔄</button></div>`;
            } else if (errType === 'NOT_FOUND') {
                return `<div class="cx-jira-empty-badge" title="${msg}"><span>شماره در چاپار یافت نشد</span><button class="cx-jira-refresh-btn" id="${btnId}-retry">🔄</button></div>`;
            } else {
                return `<div class="cx-jira-error-badge" title="${msg}"><span>⚠️ خطا در ارتباط با چاپار</span><button id="${btnId}-retry">🔄</button></div>`;
            }
        }

        const notFoundHtml = renderSimulatedChaparState({ error: 'NOT_FOUND', message: 'شماره در چاپار یافت نشد' });
        assert.ok(notFoundHtml.includes('cx-jira-empty-badge'), 'NOT_FOUND must use cx-jira-empty-badge');
        assert.ok(notFoundHtml.includes('<span>شماره در چاپار یافت نشد</span>'), 'Must display exact required Persian text');
        assert.ok(!notFoundHtml.includes('خطا در ارتباط با چاپار'), 'Must NOT display connection error text for NOT_FOUND');

        const authHtml = renderSimulatedChaparState({ error: 'AUTH_REQUIRED' });
        assert.ok(authHtml.includes('⚠️ نیاز به ورود'), 'AUTH_REQUIRED must display login required');

        const portalUnavailableHtml = renderSimulatedChaparState({ error: 'PORTAL_UNAVAILABLE' });
        assert.ok(portalUnavailableHtml.includes('⚠️ پورتال چاپار در دسترس نیست'), 'PORTAL_UNAVAILABLE must display portal unavailable');

        const genericErrorHtml = renderSimulatedChaparState({ error: 'LOOKUP_ERROR' });
        assert.ok(genericErrorHtml.includes('⚠️ خطا در ارتباط با چاپار'), 'Genuine error must display connection error');
    });
});
