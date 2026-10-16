import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

describe('Chapar & Jira UI Parity Tests', () => {
    const contentJs = fs.readFileSync(path.resolve('content.js'), 'utf8');
    const stylesCss = fs.readFileSync(path.resolve('styles.css'), 'utf8');

    it('confirms exact required Persian label "نیاز به ورود" in Chapar error state', () => {
        // Must contain the exact text "نیاز به ورود" (without Jira suffix) for Chapar
        assert.ok(contentJs.includes('<span>⚠️ نیاز به ورود</span>'), 'Chapar error badge must display exact label: <span>⚠️ نیاز به ورود</span>');
    });

    it('confirms Chapar reuses the Jira CSS classes for badge, login button, and refresh button', () => {
        // Chapar error badge must reuse .cx-jira-error-badge
        assert.ok(contentJs.includes('class="cx-jira-error-badge"'), 'Chapar must reuse cx-jira-error-badge');
        assert.ok(contentJs.includes('class="cx-jira-login-btn"'), 'Chapar must reuse cx-jira-login-btn');
        assert.ok(contentJs.includes('class="cx-jira-refresh-btn"'), 'Chapar must reuse cx-jira-refresh-btn');
    });

    it('confirms widget containers for phone and waybill share .cx-jira-widget styling', () => {
        assert.ok(stylesCss.includes('.cx-waybill-widget'), 'styles.css must include .cx-waybill-widget');
        assert.ok(stylesCss.includes('.cx-phone-widget'), 'styles.css must include .cx-phone-widget');
        assert.ok(contentJs.includes('id="cx-waybill-widget"'), 'content.js must create #cx-waybill-widget container');
        assert.ok(contentJs.includes('id="cx-phone-widget"'), 'content.js must create #cx-phone-widget container');
    });

    it('confirms official Chapar portal destination is used for login button', () => {
        assert.ok(contentJs.includes("window.open('https://portal.chaparnet.com', '_blank')"), 'Chapar login button must open https://portal.chaparnet.com');
    });

    it('confirms dark theme styles are defined for error badge', () => {
        assert.ok(stylesCss.includes(':host(.cx-dark) .cx-jira-error-badge'), 'styles.css must support dark theme for error badge');
        assert.ok(stylesCss.includes('rgba(153, 27, 27, 0.3)'), 'Dark theme must use red hue background');
        assert.ok(stylesCss.includes('#fca5a5'), 'Dark theme must use readable red text');
    });

    it('confirms loading spinner on Chapar button uses existing spinner component', () => {
        assert.ok(contentJs.includes('<div class="cx-spinner"></div>'), 'Chapar loading state must use existing cx-spinner');
        assert.ok(contentJs.includes('در حال بررسی چاپار...'), 'Chapar loading state must display informative Persian text');
    });

    it('confirms Chapar authentication state is independent from Jira', () => {
        // Ensure Jira sequence counter and Chapar sequence counter are separate
        assert.ok(contentJs.includes('currentJiraSeq'), 'Must have separate currentJiraSeq');
        assert.ok(contentJs.includes('currentRoutingSeq'), 'Must have separate currentRoutingSeq');
    });

    it('confirms exact required Persian label "شماره در چاپار یافت نشد" for empty lookup result', () => {
        assert.ok(contentJs.includes('<span>شماره در چاپار یافت نشد</span>'), 'Must display exact required Persian label for empty phone lookup');
    });

    it('confirms empty badge class and theme styling exist for Chapar empty state', () => {
        assert.ok(stylesCss.includes('.cx-jira-empty-badge'), 'styles.css must include .cx-jira-empty-badge');
        assert.ok(stylesCss.includes(':host(.cx-dark) .cx-jira-empty-badge'), 'styles.css must define dark theme support for empty badge');
    });
});
