import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// Verify Jira source in background.js and content.js
describe('Jira Integration Regression Tests', () => {
    it('verifies Jira error handler renders exact Jira badge in content.js', () => {
        const contentJs = fs.readFileSync(path.resolve('content.js'), 'utf8');

        // Confirm Jira error handler is untouched and uses its original label
        assert.ok(contentJs.includes("⚠️ نیاز به ورود Jira"), 'content.js must retain original Jira login required label');
        assert.ok(contentJs.includes("cx-jira-error-badge"), 'content.js must retain cx-jira-error-badge');
        assert.ok(contentJs.includes("btn-jira-login"), 'content.js must retain btn-jira-login');
        assert.ok(contentJs.includes("btn-jira-retry"), 'content.js must retain btn-jira-retry');
        assert.ok(contentJs.includes("https://jira.automoby.ir/login.jsp"), 'content.js must retain Jira login destination');
    });

    it('verifies Jira styles exist in styles.css without breakage', () => {
        const stylesCss = fs.readFileSync(path.resolve('styles.css'), 'utf8');

        // Must retain .cx-jira-error-badge and all Jira classes
        assert.ok(stylesCss.includes('.cx-jira-error-badge'), 'styles.css must retain .cx-jira-error-badge');
        assert.ok(stylesCss.includes('.cx-jira-login-btn'), 'styles.css must retain .cx-jira-login-btn');
        assert.ok(stylesCss.includes('.cx-jira-refresh-btn'), 'styles.css must retain .cx-jira-refresh-btn');
        assert.ok(stylesCss.includes('.cx-jira-widget'), 'styles.css must retain .cx-jira-widget');
        assert.ok(stylesCss.includes(':host(.cx-dark) .cx-jira-error-badge'), 'styles.css must retain dark theme for Jira badge');
    });

    it('verifies Jira search ticket handler in background.js remains read-only and intact', () => {
        const backgroundJs = fs.readFileSync(path.resolve('background.js'), 'utf8');

        assert.ok(backgroundJs.includes("action === 'JIRA_SEARCH_TICKETS'"), 'background.js must handle JIRA_SEARCH_TICKETS');
        assert.ok(backgroundJs.includes("https://jira.automoby.ir/rest/api/2/search"), 'background.js must query Jira search endpoint');
        assert.ok(backgroundJs.includes("error: 'AUTH_REQUIRED'"), 'background.js must detect Jira 401 AUTH_REQUIRED');
        assert.ok(backgroundJs.includes("error: 'FORBIDDEN'"), 'background.js must detect Jira 403 FORBIDDEN');
    });

    it('verifies Jira login button is preserved across all error states (both AUTH_REQUIRED and connection failure)', () => {
        const contentJs = fs.readFileSync(path.resolve('content.js'), 'utf8');

        // Extract renderJiraErrorState
        const fnMatch = contentJs.match(/function renderJiraErrorState[\s\S]*?^    }/m);
        assert.ok(fnMatch, 'renderJiraErrorState must be defined');
        const fnBody = fnMatch[0];

        // Must render btn-jira-login unconditionally on non-missing error badge
        assert.ok(fnBody.includes('id="btn-jira-login"'), 'renderJiraErrorState must include btn-jira-login');
        assert.ok(fnBody.includes('id="btn-jira-retry"'), 'renderJiraErrorState must include btn-jira-retry');
        assert.ok(fnBody.includes('window.open(\'https://jira.automoby.ir/login.jsp\', \'_blank\')'), 'loginBtn must open Jira login page');
        assert.ok(fnBody.includes('performJiraLookup(parcelId, waybill)'), 'retryBtn must re-execute performJiraLookup');
    });

    it('verifies background.js detects Jira login redirects and HTML responses as AUTH_REQUIRED', () => {
        const backgroundJs = fs.readFileSync(path.resolve('background.js'), 'utf8');

        // Must check for login redirect and html responses
        assert.ok(backgroundJs.includes("res.redirected && res.url && (res.url.includes('login')"), 'background.js must check for Jira login redirect');
        assert.ok(backgroundJs.includes("contentType.includes('text/html')"), 'background.js must check for HTML response from Jira');
    });
});
