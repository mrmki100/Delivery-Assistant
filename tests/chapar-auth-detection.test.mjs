import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// Import or recreate the exact analyzeChaparPortalAuth and parseSloppyJSON logic from background.js
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
        body.includes('خروج از حساب') || body.includes('خوش آمدید') || body.includes('سطح دسترسی');

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

describe('Chapar Authentication Detection', () => {
    it('detects HTTP 401 Unauthorized as NEEDS_LOGIN', () => {
        const res = { status: 401, redirected: false, url: 'https://portal.chaparnet.com/OBJ/List/Consignment.php' };
        const result = analyzeChaparPortalAuth(res, 'Unauthorized');
        assert.equal(result.state, 'NEEDS_LOGIN');
        assert.match(result.message, /نشست کاربری شما در پورتال چاپار فعال نیست/);
    });

    it('detects HTTP 403 Forbidden as NEEDS_LOGIN', () => {
        const res = { status: 403, redirected: false, url: 'https://portal.chaparnet.com/OBJ/List/Consignment.php' };
        const result = analyzeChaparPortalAuth(res, 'Forbidden');
        assert.equal(result.state, 'NEEDS_LOGIN');
        assert.match(result.message, /نشست کاربری شما در پورتال چاپار فعال نیست/);
    });

    it('detects redirect to login page as NEEDS_LOGIN', () => {
        const res = { status: 200, redirected: true, url: 'https://portal.chaparnet.com/login.php' };
        const result = analyzeChaparPortalAuth(res, '<html>Login</html>');
        assert.equal(result.state, 'NEEDS_LOGIN');
    });

    it('detects redirect to index.php?P=Login as NEEDS_LOGIN', () => {
        const res = { status: 200, redirected: true, url: 'https://portal.chaparnet.com/index.php?P=Login' };
        const result = analyzeChaparPortalAuth(res, '<html>Please Login</html>');
        assert.equal(result.state, 'NEEDS_LOGIN');
    });

    it('detects HTML body with password input field as NEEDS_LOGIN', () => {
        const res = { status: 200, redirected: false, url: 'https://portal.chaparnet.com/OBJ/List/Consignment.php' };
        const html = `
            <!DOCTYPE html>
            <html>
            <body>
                <form action="login.php" method="POST">
                    <input type="text" name="username" id="username" />
                    <input type="password" name="password" id="password" />
                    <button type="submit">ورود</button>
                </form>
            </body>
            </html>
        `;
        const result = analyzeChaparPortalAuth(res, html);
        assert.equal(result.state, 'NEEDS_LOGIN');
    });

    it('detects HTML body with Persian login prompt as NEEDS_LOGIN', () => {
        const res = { status: 200, redirected: false, url: 'https://portal.chaparnet.com/OBJ/List/Consignment.php' };
        const html = '<div><h2>ورود به سامانه پورتال چاپار</h2><form><input type="password" /></form></div>';
        const result = analyzeChaparPortalAuth(res, html);
        assert.equal(result.state, 'NEEDS_LOGIN');
    });

    it('detects xajax XML redirect to login as NEEDS_LOGIN', () => {
        const res = { status: 200, redirected: false, url: 'https://portal.chaparnet.com/index.php' };
        const xml = '<xjx><cmd n="js">window.location.href="login.php";</cmd></xjx>';
        const result = analyzeChaparPortalAuth(res, xml);
        assert.equal(result.state, 'NEEDS_LOGIN');
    });

    it('detects HTTP 500/502/503 as PORTAL_UNAVAILABLE', () => {
        for (const status of [500, 502, 503, 504]) {
            const res = { status, redirected: false, url: 'https://portal.chaparnet.com/' };
            const result = analyzeChaparPortalAuth(res, 'Server Error');
            assert.equal(result.state, 'PORTAL_UNAVAILABLE', `Failed for status ${status}`);
            assert.match(result.message, /در دسترس نیست/);
        }
    });

    it('does NOT treat empty Flexigrid JSON (0 rows) as proof of AUTHENTICATED (returns UNKNOWN)', () => {
        const res = { status: 200, redirected: false, url: 'https://portal.chaparnet.com/OBJ/List/Consignment.php' };
        const json = '{page:1,total:0,rows:[]}';
        const result = analyzeChaparPortalAuth(res, json);
        assert.equal(result.state, 'UNKNOWN');
    });

    it('detects valid populated Flexigrid JSON with rows as AUTHENTICATED', () => {
        const res = { status: 200, redirected: false, url: 'https://portal.chaparnet.com/OBJ/List/Consignment.php' };
        const json = '{page:1,total:1,rows:[{id:"31448975",cell:["1","1403/07/20","54807199259898101","تهران","شیراز","پیش کرایه","OD","شرکت","گیرنده","1","2","نقدی"]}]}';
        const result = analyzeChaparPortalAuth(res, json);
        assert.equal(result.state, 'AUTHENTICATED');
    });

    it('detects authenticated xajax operational HTML as AUTHENTICATED', () => {
        const res = { status: 200, redirected: false, url: 'https://portal.chaparnet.com/index.php?P=Operation' };
        const html = '<div id="FormConsignmentHistory"><table id="tbl_cons"><tr><td>fld_Cons_No</td></tr></table></div>';
        const result = analyzeChaparPortalAuth(res, html);
        assert.equal(result.state, 'AUTHENTICATED');
    });

    it('detects authenticated operational HTML containing background frm_IDLELogin as AUTHENTICATED', () => {
        const res = { status: 200, redirected: false, url: 'https://portal.chaparnet.com/index.php?P=Operation' };
        const html = `
            <div>
                <form id="frm_IDLELogin" name="frm_IDLELogin">
                    <input type="password" name="fld_Idle_Password" id="fld_Idle_Password" />
                </form>
                <div id="tbl_cons">
                    <a href="index.php?P=Logout">خروج از سامانه</a>
                    <span>P=Operation</span>
                </div>
            </div>
        `;
        const result = analyzeChaparPortalAuth(res, html);
        assert.equal(result.state, 'AUTHENTICATED');
    });

    it('detects authenticated portal page with welcome and logout links as AUTHENTICATED', () => {
        const res = { status: 200, redirected: false, url: 'https://portal.chaparnet.com/' };
        const html = '<div>خوش آمدید!, نیروانا فناوران پارت<a href="#">خروج</a>سطح دسترسی: Customer-User</div>';
        const result = analyzeChaparPortalAuth(res, html);
        assert.equal(result.state, 'AUTHENTICATED');
    });

    it('returns UNKNOWN for unrecognized 200 responses without auth evidence', () => {
        const res = { status: 200, redirected: false, url: 'https://portal.chaparnet.com/' };
        const result = analyzeChaparPortalAuth(res, 'Something totally unexpected');
        assert.equal(result.state, 'UNKNOWN');
    });
});
