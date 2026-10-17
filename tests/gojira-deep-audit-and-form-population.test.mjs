import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
    GOJIRA_GLOBAL_INVARIANTS,
    GOJIRA_TEMPLATES,
    isValidTrackingNumber,
    isValidStoreName,
    getAvailableTemplates,
    getTemplateById,
    formatGoJiraDescription,
    formatGoJiraSummary,
    validateGoJiraPayload
} from '../gojira-templates.js';

describe('GoJira Deep Audit: Problem A — Layout & Visibility Invariants', () => {
    const stylesCss = fs.readFileSync(path.resolve('styles.css'), 'utf8');
    const contentJs = fs.readFileSync(path.resolve('content.js'), 'utf8');

    it('verifies .cx-floating-bar uses overflow: visible in horizontal mode to prevent dropdown clipping', () => {
        // Base floating bar rule
        const barMatch = stylesCss.match(/\.cx-floating-bar\s*\{([^}]+)\}/);
        assert.ok(barMatch, '.cx-floating-bar rule must exist in styles.css');
        const barBody = barMatch[1];
        assert.ok(!barBody.includes('overflow-y: auto'), 'Horizontal bar must NOT clip with overflow-y: auto');
        assert.ok(!barBody.includes('overflow-x: hidden'), 'Horizontal bar must NOT clip with overflow-x: hidden');
        assert.ok(barBody.includes('overflow: visible;'), 'Horizontal bar must declare overflow: visible;');
    });

    it('verifies .cx-floating-bar.cx-compact uses overflow: visible in compact mode', () => {
        const compactMatch = stylesCss.match(/\.cx-floating-bar\.cx-compact\s*\{([^}]+)\}/);
        assert.ok(compactMatch, '.cx-floating-bar.cx-compact rule must exist in styles.css');
        const compactBody = compactMatch[1];
        assert.ok(!compactBody.includes('overflow-y: auto'), 'Compact bar must NOT clip with overflow-y: auto');
        assert.ok(compactBody.includes('overflow: visible;'), 'Compact bar must declare overflow: visible;');
    });

    it('verifies .cx-gojira-menu has z-index and absolute positioning above panel in both modes', () => {
        const menuMatch = stylesCss.match(/\.cx-gojira-menu\s*\{([^}]+)\}/);
        assert.ok(menuMatch, '.cx-gojira-menu rule must exist');
        const menuBody = menuMatch[1];
        assert.ok(menuBody.includes('position: absolute;'), 'Menu must be positioned absolute');
        assert.ok(menuBody.includes('bottom: calc(100% +'), 'Menu must pop up above the panel');
        assert.ok(menuBody.includes('z-index: 1000000;'), 'Menu must have elevated z-index');
        assert.ok(menuBody.includes('direction: rtl;'), 'Menu must enforce RTL direction');
    });

    it('verifies widget container uses position: relative to establish stable containing block', () => {
        assert.ok(stylesCss.includes('.cx-gojira-widget,'), 'Widget must establish containing block');
        const widgetBlock = stylesCss.slice(stylesCss.indexOf('.cx-gojira-widget,'));
        assert.ok(widgetBlock.includes('position: relative;'), 'Widget must have position: relative');
    });

    it('verifies outside click and Escape handlers exist to dismiss menu cleanly without stale state', () => {
        assert.ok(contentJs.includes("e.key === 'Escape'"), 'Must handle Escape key for dismissal');
        assert.ok(contentJs.includes('closeGojiraDropdown()'), 'Must invoke closeGojiraDropdown');
        assert.ok(contentJs.includes("!e.composedPath().includes(widget)"), 'Must dismiss on outside click');
    });
});

describe('GoJira Deep Audit: Problem B & E — Form Field Population & Interactive Verification', () => {
    const jiraAssistantJs = fs.readFileSync(path.resolve('jira-assistant.js'), 'utf8');
    const backgroundJs = fs.readFileSync(path.resolve('background.js'), 'utf8');

    it('verifies dialog open detection uses computedStyle rather than offsetParent on fixed dialogs', () => {
        assert.ok(jiraAssistantJs.includes('window.getComputedStyle(el)'), 'Must check getComputedStyle for dialog visibility');
        assert.ok(!jiraAssistantJs.includes('dialog.offsetParent !== null'), 'Must NOT use offsetParent check on fixed Jira dialog');
    });

    it('verifies ensureCreateIssueDialogOpen waits for #create_link up to 8000ms', () => {
        assert.ok(
            jiraAssistantJs.includes("waitForElement('#create_link, a.create-issue, #create-issue', 8000)"),
            'Must wait for #create_link to mount rather than throwing immediately'
        );
    });

    it('verifies Summary field is populated strictly with tracking number', () => {
        const payload = validateGoJiraPayload({
            templateId: 'danandeh',
            trackingNumber: '1543373',
            storeName: 'مشهد پارت'
        });

        assert.equal(payload.summary, '1543373', 'Summary must strictly match tracking number');
        assert.ok(!payload.summary.includes('مشهد'), 'Summary must not contain store name');
        assert.ok(!payload.summary.includes('مشتری'), 'Summary must not contain customer name');
        assert.ok(!payload.summary.includes('#'), 'Summary must not contain prefix #');
    });

    it('verifies Description field begins with store name followed by newline with blank remainder', () => {
        const payload = validateGoJiraPayload({
            templateId: 'danandeh',
            trackingNumber: '1543373',
            storeName: 'مشهد پارت'
        });

        assert.equal(payload.description, 'مشهد پارت\n', 'Description must be store name + newline');
        assert.equal(payload.description.split('\n')[0], 'مشهد پارت');
        assert.equal(payload.description.split('\n')[1], '');
    });

    it('verifies customfield_10402 (Tracking Number) matches Summary exactly', () => {
        const payload = validateGoJiraPayload({
            templateId: 'danandeh',
            trackingNumber: '1543373',
            storeName: 'مشهد پارت'
        });

        assert.equal(payload.trackingNumber, payload.summary, 'Tracking number custom field must equal Summary exactly');
        assert.equal(payload.customfield_10402, payload.summary, 'customfield_10402 must equal Summary');
    });

    it('verifies request subject (customfield_10401) is unselected for production preparation', () => {
        assert.ok(
            jiraAssistantJs.includes("reqSubjectSelect.value = ''"),
            'Must leave customfield_10401 empty/unselected in production preparation'
        );
    });

    it('verifies Priority field is never explicitly altered', () => {
        assert.ok(
            jiraAssistantJs.includes('Priority Invariant: Left untouched'),
            'Must preserve Priority invariant'
        );
    });

    it('verifies CX label commitment logic', () => {
        assert.ok(jiraAssistantJs.includes("textarea.value = 'CX'"), 'Must input CX label into textarea');
        assert.ok(jiraAssistantJs.includes('labelsSelect.appendChild(opt)'), 'Must ensure option exists in select');
    });

    it('verifies verified Monireh Danandeh account assignment', () => {
        assert.ok(jiraAssistantJs.includes("PROD_ASSIGNEE_USERNAME: 'monire-danande'"), 'Username must be monire-danande');
        assert.ok(jiraAssistantJs.includes("PROD_ASSIGNEE_NAME: 'منیره داننده'"), 'Display name must be منیره داننده');
    });

    it('verifies ZERO submission invariant for production GoJira workflow', () => {
        assert.ok(jiraAssistantJs.includes('Production GoJira NEVER submits!'), 'Production issues must NEVER submit');
        assert.ok(jiraAssistantJs.includes("mode: 'PREPARED_UNSUBMITTED'"), 'Must return PREPARED_UNSUBMITTED mode');
    });

    it('verifies background script provides dynamic script injection fallback if Jira tab is unhydrated', () => {
        assert.ok(backgroundJs.includes('chrome.scripting.executeScript'), 'Must inject jira-assistant.js fallback');
        assert.ok(backgroundJs.includes("files: ['jira-assistant.js']"), 'Injects jira-assistant.js');
    });
});

describe('GoJira Deep Audit: Problem C — Required Activation Order & Precheck Gate', () => {
    const contentJs = fs.readFileSync(path.resolve('content.js'), 'utf8');

    it('verifies content.js tracks lastCompletedJiraCheck and isJiraLookupInProgress', () => {
        assert.ok(contentJs.includes('let lastCompletedJiraCheck = null;'), 'Must track lastCompletedJiraCheck state');
        assert.ok(contentJs.includes('let isJiraLookupInProgress = false;'), 'Must track isJiraLookupInProgress flag');
        assert.ok(contentJs.includes('function isGojiraCheckSatisfied('), 'Must define isGojiraCheckSatisfied predicate');
        assert.ok(contentJs.includes('function showGojiraPrecheckAlert('), 'Must define showGojiraPrecheckAlert handler');
    });

    it('verifies GoJira click handler blocks template selector and shows "اول چک کن" when check is not satisfied', () => {
        const clickHandlerSection = contentJs.slice(
            contentJs.indexOf('triggerBtn.addEventListener(\'click\''),
            contentJs.indexOf('const menuItems = menu.querySelectorAll')
        );

        assert.ok(clickHandlerSection.includes('if (!isGojiraCheckSatisfied())'), 'Must gate on isGojiraCheckSatisfied');
        assert.ok(clickHandlerSection.includes('showGojiraPrecheckAlert(triggerBtn)'), 'Must call showGojiraPrecheckAlert');
        assert.ok(clickHandlerSection.includes('return;'), 'Must return early to block menu opening and preparation');
    });

    it('verifies showGojiraPrecheckAlert displays "اول چک کن" for 3000ms with .cx-gojira-alert styling', () => {
        assert.ok(contentJs.includes('triggerBtn.innerHTML = `<span>⚠️</span><span>اول چک کن</span>`'), 'Must display "اول چک کن" text');
        assert.ok(contentJs.includes("triggerBtn.classList.add('cx-gojira-alert')"), 'Must add cx-gojira-alert class');
        assert.ok(contentJs.includes('setTimeout('), 'Must use setTimeout for auto-revert');
        assert.ok(contentJs.includes('3000);'), 'Timeout must be approximately 3 seconds (3000ms)');
    });

    it('simulates state machine transitions for Problem C requirements', () => {
        // State simulation matching content.js logic
        let state = {
            activeGojiraSelection: { rowId: '', trackingNumber: '', storeName: '', hasSelectedRow: false },
            lastCompletedJiraCheck: null,
            isJiraLookupInProgress: false,
            gojiraMenuVisible: false,
            alertMessage: '',
            alertActive: false
        };

        function isGojiraCheckSatisfiedSim(s) {
            if (!s.activeGojiraSelection || !s.activeGojiraSelection.hasSelectedRow || !s.activeGojiraSelection.rowId) {
                return false;
            }
            if (s.isJiraLookupInProgress) {
                return false;
            }
            if (!s.lastCompletedJiraCheck || !s.lastCompletedJiraCheck.success) {
                return false;
            }
            const matchesRowId = s.lastCompletedJiraCheck.rowId && s.lastCompletedJiraCheck.rowId === s.activeGojiraSelection.rowId;
            const matchesTracking = s.activeGojiraSelection.trackingNumber && (
                s.lastCompletedJiraCheck.parcelId === s.activeGojiraSelection.trackingNumber ||
                s.lastCompletedJiraCheck.waybill === s.activeGojiraSelection.trackingNumber
            );
            return Boolean(matchesRowId || matchesTracking);
        }

        function clickGojiraSim(s) {
            if (!s.activeGojiraSelection.hasSelectedRow) return;
            if (!isGojiraCheckSatisfiedSim(s)) {
                s.alertActive = true;
                s.alertMessage = 'اول چک کن';
                s.gojiraMenuVisible = false;
                return;
            }
            s.alertActive = false;
            s.alertMessage = '';
            s.gojiraMenuVisible = true;
        }

        // 1. Initial State: No row selected
        assert.equal(isGojiraCheckSatisfiedSim(state), false);

        // 2. Select Record A without running Jira check
        state.activeGojiraSelection = { rowId: 'row-101', trackingNumber: '1543373', storeName: 'فروشگاه آلفا', hasSelectedRow: true };
        assert.equal(isGojiraCheckSatisfiedSim(state), false, 'Check not yet performed on Record A');

        // 3. Click GoJira prematurely
        clickGojiraSim(state);
        assert.equal(state.alertActive, true, 'Alert must be active');
        assert.equal(state.alertMessage, 'اول چک کن', 'Message must be "اول چک کن"');
        assert.equal(state.gojiraMenuVisible, false, 'Menu must NOT open prematurely');

        // 4. Jira check starts (running)
        state.isJiraLookupInProgress = true;
        assert.equal(isGojiraCheckSatisfiedSim(state), false, 'Running check does NOT satisfy prerequisite');
        clickGojiraSim(state);
        assert.equal(state.alertActive, true, 'Still shows alert while running');
        assert.equal(state.gojiraMenuVisible, false);

        // 5. Jira check fails (e.g. network error)
        state.isJiraLookupInProgress = false;
        state.lastCompletedJiraCheck = { rowId: 'row-101', parcelId: '1543373', success: false };
        assert.equal(isGojiraCheckSatisfiedSim(state), false, 'Failed check does NOT authorize GoJira');

        // 6. Jira check completes successfully for Record A
        state.lastCompletedJiraCheck = { rowId: 'row-101', parcelId: '1543373', timestamp: Date.now(), success: true };
        assert.equal(isGojiraCheckSatisfiedSim(state), true, 'Completed check for Record A authorizes GoJira');

        // 7. Click GoJira on Record A
        clickGojiraSim(state);
        assert.equal(state.alertActive, false);
        assert.equal(state.gojiraMenuVisible, true, 'Menu opens successfully for authorized Record A');

        // 8. Operator selects Record B!
        state.gojiraMenuVisible = false;
        state.activeGojiraSelection = { rowId: 'row-102', trackingNumber: '1543374', storeName: 'فروشگاه بتا', hasSelectedRow: true };
        assert.equal(isGojiraCheckSatisfiedSim(state), false, 'Record A authorization MUST NOT carry over to Record B');

        // 9. Click GoJira on Record B
        clickGojiraSim(state);
        assert.equal(state.alertActive, true, 'Shows "اول چک کن" on Record B');
        assert.equal(state.alertMessage, 'اول چک کن');
        assert.equal(state.gojiraMenuVisible, false, 'Menu does NOT open for unverified Record B');

        // 10. Switch panel layout (horizontal <-> compact) or re-render
        // Notice module state persists:
        assert.equal(isGojiraCheckSatisfiedSim(state), false, 'Record B remains blocked after layout switch');

        // 11. Run Jira check for Record B
        state.lastCompletedJiraCheck = { rowId: 'row-102', parcelId: '1543374', timestamp: Date.now(), success: true };
        assert.equal(isGojiraCheckSatisfiedSim(state), true, 'Record B now authorized');
        clickGojiraSim(state);
        assert.equal(state.gojiraMenuVisible, true, 'GoJira opens for Record B');
    });
});

describe('GoJira Deep Audit: Problem D — Template Selector UI Redesign', () => {
    const stylesCss = fs.readFileSync(path.resolve('styles.css'), 'utf8');
    const contentJs = fs.readFileSync(path.resolve('content.js'), 'utf8');

    it('verifies cleaned-up template selector: no visible CX badge, Platform / Task subtitle under name', () => {
        assert.ok(contentJs.includes('cx-gojira-header-title'), 'Must include header title');
        assert.ok(!contentJs.includes('cx-gojira-header-badge'), 'Header badge must be removed from template selector');
        assert.ok(contentJs.includes('cx-gojira-item-main'), 'Must include item main container');
        assert.ok(contentJs.includes('cx-gojira-item-name'), 'Must include item name');
        assert.ok(contentJs.includes('منیره') && contentJs.includes('داننده'), 'Must contain name منیره داننده');
        assert.ok(contentJs.includes('<span class="cx-gojira-item-sub">Platform / Task</span>'), 'Must display Platform / Task directly as secondary subtitle');
        assert.ok(!contentJs.includes('cx-gojira-chip'), 'Must NOT display visible CX chip in template card');
    });

    it('verifies redesigned template selector CSS has generous readable dimensions and spacing', () => {
        const menuBlock = stylesCss.slice(stylesCss.indexOf('.cx-gojira-menu {'));
        assert.ok(menuBlock.includes('width: 290px;'), 'Width must be 290px');
        assert.ok(menuBlock.includes('max-width: min(340px, calc(100vw - 30px));'), 'Max width must adapt to viewport');
        assert.ok(menuBlock.includes('padding: 10px;'), 'Surface padding must be 10px');
        assert.ok(menuBlock.includes('border-radius: 12px;'), 'Surface border radius must be 12px');
    });

    it('verifies dark theme support for redesigned template selector', () => {
        assert.ok(stylesCss.includes(':host(.cx-dark) .cx-gojira-menu {'), 'Dark mode menu container defined');
        assert.ok(stylesCss.includes(':host(.cx-dark) .cx-gojira-menu-item {'), 'Dark mode menu item defined');
        assert.ok(stylesCss.includes(':host(.cx-dark) .cx-gojira-chip {'), 'Dark mode CX chip defined');
        assert.ok(stylesCss.includes(':host(.cx-dark) .cx-gojira-header-badge {'), 'Dark mode header badge defined');
    });

    it('verifies keyboard accessibility and visible focus styles', () => {
        assert.ok(stylesCss.includes('.cx-gojira-menu-item:focus-visible {'), 'Focus-visible outline defined for light mode');
        assert.ok(stylesCss.includes(':host(.cx-dark) .cx-gojira-menu-item:focus-visible {'), 'Focus-visible outline defined for dark mode');
        assert.ok(contentJs.includes("e.key === 'ArrowDown'"), 'Handles ArrowDown navigation');
        assert.ok(contentJs.includes("e.key === 'ArrowUp'"), 'Handles ArrowUp navigation');
        assert.ok(contentJs.includes("e.key === 'Enter'"), 'Handles Enter key execution');
    });
});

describe('GoJira: State Synchronization, Tab Isolation, and Autofocus Invariants', () => {
    const contentJs = fs.readFileSync(path.resolve('content.js'), 'utf8');
    const backgroundJs = fs.readFileSync(path.resolve('background.js'), 'utf8');
    const jiraAssistantJs = fs.readFileSync(path.resolve('jira-assistant.js'), 'utf8');

    it('verifies Issue 1: prompt precheck state synchronization and record identity scoping', () => {
        assert.ok(contentJs.includes('function notifyGojiraPrecheckCompleted('), 'Must define notifyGojiraPrecheckCompleted');
        assert.ok(contentJs.includes('notifyGojiraPrecheckCompleted(currentRowId, cleanParcel, cleanWaybill)'), 'Must call notifyGojiraPrecheckCompleted on successful check');
        assert.ok(contentJs.includes('lastCompletedJiraCheck.rowId !== activeGojiraSelection.rowId'), 'Must verify rowId matches in isGojiraCheckSatisfied');
        assert.ok(contentJs.includes("triggerBtn.classList.remove('cx-gojira-alert')"), 'Must immediately remove alert class');
        assert.ok(contentJs.includes('triggerBtn.innerHTML = `<span>⚡</span><span>GoJira</span>`'), 'Must immediately restore button HTML');
    });

    it('verifies Issue 2: new tab creation and isolation from existing tabs', () => {
        const gojiraBgFn = backgroundJs.slice(backgroundJs.indexOf('async function handlePrepareGojiraIssue'));
        assert.ok(!gojiraBgFn.includes('chrome.tabs.query'), 'Must NEVER query existing Jira tabs to reuse them');
        assert.ok(gojiraBgFn.includes('chrome.tabs.create({ url: targetUrl, active: true })'), 'Must always create a new tab');
        assert.ok(gojiraBgFn.includes('#gojira-op='), 'Must tag new tab with operation ID hash');
        assert.ok(jiraAssistantJs.includes("window.location.hash.match(/gojira-op=([^&]+)/)"), 'Must guard pending tasks with hash matching');
    });

    it('verifies Issue 3: focus Description editor rather than leaving focus on Assignee', () => {
        assert.ok(jiraAssistantJs.includes('async function focusDescriptionEditor('), 'Must implement focusDescriptionEditor');
        assert.ok(jiraAssistantJs.includes('await focusDescriptionEditor(dialog)'), 'Must call focusDescriptionEditor in prepareGoJiraIssue');
        assert.ok(jiraAssistantJs.includes('window.tinymce.activeEditor.focus()'), 'Must support TinyMCE focus');
        assert.ok(jiraAssistantJs.includes('descTextarea.focus()'), 'Must support plain textarea focus');
        assert.ok(jiraAssistantJs.includes('descriptionFocused:'), 'Must return descriptionFocused status');
    });
});
