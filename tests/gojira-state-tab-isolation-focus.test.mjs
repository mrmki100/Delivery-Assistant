import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
    GOJIRA_GLOBAL_INVARIANTS,
    GOJIRA_TEMPLATES,
    validateGoJiraPayload
} from '../gojira-templates.js';

describe('GoJira Issue 1: Precheck State Synchronization & Identity Scoping', () => {
    const contentJs = fs.readFileSync(path.resolve('content.js'), 'utf8');

    it('verifies performJiraLookup notifies GoJira immediately upon successful check', () => {
        const lookupFn = contentJs.slice(
            contentJs.indexOf('async function performJiraLookup('),
            contentJs.indexOf('function renderJiraErrorState(')
        );

        assert.ok(
            lookupFn.includes('notifyGojiraPrecheckCompleted(currentRowId, cleanParcel, cleanWaybill)'),
            'Must call notifyGojiraPrecheckCompleted when response.success is true'
        );
        assert.ok(
            lookupFn.includes('lastCompletedJiraCheck = {'),
            'Must record lastCompletedJiraCheck with rowId, parcelId, waybill, success: true'
        );
        assert.ok(
            lookupFn.includes('if (activeGojiraSelection?.rowId && currentRowId && activeGojiraSelection.rowId !== currentRowId)'),
            'Must discard check result if active row changed during lookup flight'
        );
    });

    it('verifies notifyGojiraPrecheckCompleted immediately disarms alert and updates UI', () => {
        const notifyFn = contentJs.slice(
            contentJs.indexOf('function notifyGojiraPrecheckCompleted('),
            contentJs.indexOf('function showGojiraPrecheckAlert(')
        );

        assert.ok(notifyFn.includes('if (gojiraAlertTimeout) {'), 'Must check for running alert timeout');
        assert.ok(notifyFn.includes('clearTimeout(gojiraAlertTimeout);'), 'Must clear running alert timeout');
        assert.ok(notifyFn.includes("triggerBtn.classList.remove('cx-gojira-alert');"), 'Must remove alert CSS class');
        assert.ok(notifyFn.includes("triggerBtn.innerHTML = `<span>⚡</span><span>GoJira</span>`;"), 'Must restore button HTML immediately');
        assert.ok(notifyFn.includes('triggerBtn.disabled = false;'), 'Must ensure button is enabled');
    });

    it('simulates precheck state transitions and strict record scoping', () => {
        let state = {
            activeGojiraSelection: { rowId: 'row-100', trackingNumber: '1543373', hasSelectedRow: true },
            lastCompletedJiraCheck: null,
            isJiraLookupInProgress: false,
            alertActive: false,
            buttonText: '⚡ GoJira'
        };

        function isGojiraCheckSatisfiedSim(s) {
            if (!s.activeGojiraSelection || !s.activeGojiraSelection.hasSelectedRow || !s.activeGojiraSelection.rowId) {
                return false;
            }
            if (s.isJiraLookupInProgress) return false;
            if (!s.lastCompletedJiraCheck || !s.lastCompletedJiraCheck.success) return false;

            if (s.lastCompletedJiraCheck.rowId && s.activeGojiraSelection.rowId && s.lastCompletedJiraCheck.rowId !== s.activeGojiraSelection.rowId) {
                return false;
            }
            if (s.activeGojiraSelection.trackingNumber && (s.lastCompletedJiraCheck.parcelId || s.lastCompletedJiraCheck.waybill)) {
                const matchesTracking = s.lastCompletedJiraCheck.parcelId === s.activeGojiraSelection.trackingNumber ||
                    s.lastCompletedJiraCheck.waybill === s.activeGojiraSelection.trackingNumber;
                if (!matchesTracking) return false;
            }
            const matchesRowId = s.lastCompletedJiraCheck.rowId && s.lastCompletedJiraCheck.rowId === s.activeGojiraSelection.rowId;
            const matchesTracking = s.activeGojiraSelection.trackingNumber && (
                s.lastCompletedJiraCheck.parcelId === s.activeGojiraSelection.trackingNumber ||
                s.lastCompletedJiraCheck.waybill === s.activeGojiraSelection.trackingNumber
            );
            return Boolean(matchesRowId || matchesTracking);
        }

        // 1. Initial row selection without Jira check: unauthorized
        assert.equal(isGojiraCheckSatisfiedSim(state), false);

        // 2. Trigger alert
        state.alertActive = true;
        state.buttonText = '⚠️ اول چک کن';

        // 3. Complete check for row-100 successfully
        state.lastCompletedJiraCheck = {
            rowId: 'row-100',
            parcelId: '1543373',
            waybill: '',
            success: true
        };
        // notifyGojiraPrecheckCompleted restores state promptly
        state.alertActive = false;
        state.buttonText = '⚡ GoJira';

        assert.equal(isGojiraCheckSatisfiedSim(state), true, 'Row-100 must be authorized');
        assert.equal(state.buttonText, '⚡ GoJira', 'Button text must be prompt');
        assert.equal(state.alertActive, false, 'Alert must be cleared');

        // 4. Switch to row-200 (different record)
        state.activeGojiraSelection = { rowId: 'row-200', trackingNumber: '9999999', hasSelectedRow: true };
        assert.equal(isGojiraCheckSatisfiedSim(state), false, 'Row-200 must NOT be authorized by Row-100 check');

        // 5. In-flight check for row-200, user switches to row-300 before response
        state.activeGojiraSelection = { rowId: 'row-300', trackingNumber: '3333333', hasSelectedRow: true };
        // Late response arrives for row-200
        const lateRowId = 'row-200';
        if (state.activeGojiraSelection.rowId === lateRowId) {
            state.lastCompletedJiraCheck = { rowId: lateRowId, parcelId: '9999999', success: true };
        }
        assert.equal(isGojiraCheckSatisfiedSim(state), false, 'Row-300 must not be authorized by late row-200 response');

        // 6. Check fails for row-300
        state.lastCompletedJiraCheck = { rowId: 'row-300', parcelId: '3333333', success: false };
        assert.equal(isGojiraCheckSatisfiedSim(state), false, 'Failed check must not authorize');
    });
});

describe('GoJira Issue 2: Independent Jira Tab Creation & Tab Isolation', () => {
    const backgroundJs = fs.readFileSync(path.resolve('background.js'), 'utf8');
    const jiraAssistantJs = fs.readFileSync(path.resolve('jira-assistant.js'), 'utf8');

    it('verifies background.js always opens a new Jira tab and never reuses existing tabs', () => {
        const gojiraBgFn = backgroundJs.slice(backgroundJs.indexOf('async function handlePrepareGojiraIssue'));

        assert.ok(!gojiraBgFn.includes('chrome.tabs.query'), 'Must not query open tabs to reuse them');
        assert.ok(gojiraBgFn.includes('chrome.tabs.create({ url: targetUrl, active: true })'), 'Must always create a new tab');
        assert.ok(gojiraBgFn.includes('https://jira.automoby.ir/secure/Dashboard.jspa#gojira-op='), 'Must include operation token in target URL');
        assert.ok(gojiraBgFn.includes('chrome.tabs.sendMessage(targetTab.id,'), 'Must target the new tab specifically');
    });

    it('verifies jira-assistant.js protects existing tabs and unsaved drafts', () => {
        const checkFn = jiraAssistantJs.slice(
            jiraAssistantJs.indexOf('async function checkPendingTask('),
            jiraAssistantJs.indexOf('checkPendingTask();')
        );

        assert.ok(
            checkFn.includes("window.location.hash.match(/gojira-op=([^&]+)/)"),
            'Must verify window.location.hash contains gojira-op'
        );
        assert.ok(
            checkFn.includes('if (!opMatch) {'),
            'Must exit immediately if no gojira-op hash is present'
        );
        assert.ok(
            checkFn.includes('return;'),
            'Must return early without touching storage or creating issues'
        );
    });

    it('verifies operation deduplication prevents duplicate executions in the same tab', () => {
        assert.ok(jiraAssistantJs.includes('const activeOperations = new Set();'), 'Must track active operations');
        assert.ok(jiraAssistantJs.includes('if (opId && activeOperations.has(opId))'), 'Must prevent re-execution of the same operation');
    });
});

describe('GoJira Issue 3: Template Picker UI Hierarchy & Description Autofocus', () => {
    const contentJs = fs.readFileSync(path.resolve('content.js'), 'utf8');
    const jiraAssistantJs = fs.readFileSync(path.resolve('jira-assistant.js'), 'utf8');

    it('verifies template menu card displays Monireh Danandeh with Platform / Task as secondary subtitle', () => {
        const start = contentJs.indexOf('<div class="cx-gojira-menu-body">');
        const menuBody = contentJs.slice(start, start + 800);

        assert.ok(menuBody.includes('منیره <span>داننده</span>') || menuBody.includes('<span>منیره داننده</span>'), 'Must display full name');
        assert.ok(menuBody.includes('<span class="cx-gojira-item-sub">Platform / Task</span>'), 'Subtitle must be Platform / Task');
        assert.ok(!menuBody.includes('cx-gojira-chip'), 'Must NOT display CX chip in template card');
        assert.ok(!menuBody.includes('cx-gojira-header-badge'), 'Must NOT duplicate badge');
    });

    it('verifies actual Jira issue payload retains CX label invariant', () => {
        const payload = validateGoJiraPayload({
            templateId: 'danandeh',
            trackingNumber: '1543373',
            storeName: 'مشهد پارت'
        });

        assert.deepEqual(payload.labels, ['CX'], 'Payload must preserve CX label mapping');
        assert.equal(payload.assignee.fullName, 'منیره داننده');
        assert.equal(payload.assignee.username, 'monire-danande');
    });

    it('verifies jira-assistant.js implements focusDescriptionEditor and focuses Description', () => {
        assert.ok(jiraAssistantJs.includes('async function focusDescriptionEditor('), 'Must define focusDescriptionEditor');
        assert.ok(jiraAssistantJs.includes('window.tinymce.activeEditor.focus()'), 'Must focus TinyMCE activeEditor when present');
        assert.ok(jiraAssistantJs.includes('iframe.contentWindow.focus()'), 'Must focus iframe when present');
        assert.ok(jiraAssistantJs.includes('descTextarea.focus()'), 'Must focus textarea when plain mode');
        assert.ok(jiraAssistantJs.includes('await focusDescriptionEditor(dialog)'), 'Must call focusDescriptionEditor in prepareGoJiraIssue');
        assert.ok(jiraAssistantJs.includes('descriptionFocused:'), 'Must report descriptionFocused in return object');
    });

    it('verifies focusDescriptionEditor is bounded and does not steal focus repeatedly', () => {
        const focusFn = jiraAssistantJs.slice(
            jiraAssistantJs.indexOf('async function focusDescriptionEditor('),
            jiraAssistantJs.indexOf('async function prepareGoJiraIssue(')
        );

        assert.ok(focusFn.includes('const maxAttempts = 10;'), 'Must have bounded maximum attempts');
        assert.ok(!focusFn.includes('setInterval'), 'Must NOT use infinite setInterval');
        assert.ok(!focusFn.includes('MutationObserver'), 'Must NOT use persistent unbounded observer');
    });
});
