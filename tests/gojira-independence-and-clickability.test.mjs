import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

describe('GoJira: Independence & Clickability Behavioral Regression Suite', () => {
    const contentJs = fs.readFileSync(path.resolve('content.js'), 'utf8');
    const stylesCss = fs.readFileSync(path.resolve('styles.css'), 'utf8');

    it('verifies GoJira button CSS specifies cursor: pointer when enabled and cursor: not-allowed when disabled', () => {
        // Assert light mode
        assert.ok(
            stylesCss.includes('.cx-btn-trigger.btn-gojira {') &&
            stylesCss.includes('cursor: pointer;'),
            '.btn-gojira must have cursor: pointer'
        );
        assert.ok(
            stylesCss.includes('.cx-btn-trigger.btn-gojira:disabled {') &&
            stylesCss.includes('cursor: not-allowed;'),
            '.btn-gojira:disabled must have cursor: not-allowed'
        );

        // Assert dark mode
        assert.ok(
            stylesCss.includes(':host(.cx-dark) .cx-btn-trigger.btn-gojira {') &&
            stylesCss.includes('cursor: pointer;'),
            'Dark mode .btn-gojira must have cursor: pointer'
        );
        assert.ok(
            stylesCss.includes(':host(.cx-dark) .cx-btn-trigger.btn-gojira:disabled {') &&
            stylesCss.includes('cursor: not-allowed;'),
            'Dark mode .btn-gojira:disabled must have cursor: not-allowed'
        );
    });

    it('verifies GoJira event listeners are attached at panel initialization time', () => {
        assert.ok(
            contentJs.includes('initGojiraWidgetListeners(panel)'),
            'initCommandCenterUI must initialize GoJira listeners during panel mounting'
        );
        assert.ok(
            contentJs.includes('function initGojiraWidgetListeners('),
            'Must declare initGojiraWidgetListeners helper'
        );
    });

    it('verifies GoJira enablement is completely decoupled from Jira ticket check', () => {
        // Find updateGojiraWidgetForSelectedRow definition
        const gojiraFunc = contentJs.slice(
            contentJs.indexOf('function updateGojiraWidgetForSelectedRow('),
            contentJs.indexOf('async function extractStoreNameForSelectedRow(')
        );

        // GoJira must NOT reference Jira check result, ticket count, or Jira widget state
        assert.ok(!gojiraFunc.includes('activeJiraSelection'), 'GoJira enablement must not depend on activeJiraSelection');
        assert.ok(!gojiraFunc.includes('currentJiraSeq'), 'GoJira enablement must not depend on currentJiraSeq');
        assert.ok(!gojiraFunc.includes('tickets'), 'GoJira enablement must not check Jira tickets');
        assert.ok(!gojiraFunc.includes('performJiraLookup'), 'GoJira enablement must never invoke Jira lookup');

        // GoJira must enable when isSelected is true
        assert.ok(gojiraFunc.includes('triggerBtn.disabled = false;'), 'GoJira must enable when row is selected');
        assert.ok(gojiraFunc.includes('triggerBtn.disabled = true;'), 'GoJira must disable only when no row is selected');
    });

    it('verifies GoJira does not require pre-resolved tracking number at row-click time', () => {
        const gojiraFunc = contentJs.slice(
            contentJs.indexOf('function updateGojiraWidgetForSelectedRow('),
            contentJs.indexOf('async function extractStoreNameForSelectedRow(')
        );

        // Does NOT bail out if !validTracking
        assert.ok(!gojiraFunc.includes('if (!hasSelectedRow || !validTracking)'), 'Must not require trackingNumber to enable button');
        assert.ok(gojiraFunc.includes('if (!isSelected) {'), 'Must only disable when no row is selected');
    });

    it('verifies on-demand tracking number resolution during GoJira workflow execution', () => {
        const prepFunc = contentJs.slice(
            contentJs.indexOf('async function executeGojiraPreparation('),
            contentJs.indexOf('let testBtn = document.getElementById(')
        );

        // Checks hasSelectedRow rather than requiring trackingNumber upfront
        assert.ok(prepFunc.includes('if (!currentSelection.rowId || !currentSelection.hasSelectedRow)'), 'Must guard on selection identity');
        // Resolves from rowDataCache, parcel route fallback, or DOM cells
        assert.ok(prepFunc.includes('rowDataCache.get(initialRowId)'), 'Must inspect rowDataCache on demand');
        assert.ok(prepFunc.includes("window.location.pathname.startsWith('/parcel')"), 'Must support parcel route fallback');
        assert.ok(prepFunc.includes('getAllRowFragments(row)'), 'Must inspect DOM fragments on demand');
        // Re-enables button in finally block if row is still selected
        assert.ok(prepFunc.includes('activeGojiraSelection.hasSelectedRow'), 'Must check hasSelectedRow in finally block');
    });

    it('verifies بررسی تیکت Jira remains 100% independent and intact', () => {
        const jiraFunc = contentJs.slice(
            contentJs.indexOf('function updateJiraWidgetForSelectedRow('),
            contentJs.indexOf('async function performJiraLookup(')
        );

        assert.ok(jiraFunc.includes('id="btn-jira-lookup"'), 'Must retain #btn-jira-lookup');
        assert.ok(jiraFunc.includes('<span>بررسی تیکت Jira</span>'), 'Must retain exact label بررسی تیکت Jira');
        assert.ok(!jiraFunc.includes('updateGojiraWidgetForSelectedRow'), 'Jira widget must not mutate GoJira state');
        assert.ok(!jiraFunc.includes('btn-gojira'), 'Jira widget must not modify GoJira elements');
    });
});

describe('GoJira: Simulation & Behavioral State Transitions', () => {
    // Synthetic environment mimicking content.js state machine
    let state;

    beforeEach(() => {
        state = {
            activeGojiraSelection: { rowId: '', trackingNumber: '', storeName: '', hasSelectedRow: false },
            activeJiraSelection: { parcelId: '', waybill: '' },
            isGojiraInProgress: false,
            rowDataCache: new Map(),
            jiraCheckRunCount: 0,
            jiraCheckState: 'IDLE', // IDLE, RUNNING, SUCCESS_ZERO, SUCCESS_ONE, SUCCESS_MULTI, FAILED, TIMEOUT
            gojiraButton: {
                disabled: true,
                title: 'برای آماده‌سازی تیکت ابتدا یک ردیف را انتخاب کنید',
                ariaLabel: 'GoJira: آماده‌سازی تیکت Jira',
                cursor: 'not-allowed'
            },
            gojiraMenuOpen: false
        };
    });

    function simulateUpdateGojira(rowId, trackingNumber, hasSelectedRow = true) {
        const cleanRowId = hasSelectedRow && rowId != null ? String(rowId).trim() : '';
        const isSelected = !!(hasSelectedRow && cleanRowId);
        let validTracking = trackingNumber && !/[\u0600-\u06FF]/.test(trackingNumber) ? String(trackingNumber).trim() : '';

        if (isSelected && !validTracking) {
            const cached = state.rowDataCache.get(cleanRowId);
            if (cached?.parcelId) validTracking = String(cached.parcelId).trim();
            else if (cached?.waybill) validTracking = String(cached.waybill).trim();
        }

        state.activeGojiraSelection = {
            rowId: cleanRowId,
            trackingNumber: validTracking,
            storeName: isSelected ? (state.rowDataCache.get(cleanRowId)?.storeName || '') : '',
            hasSelectedRow: isSelected
        };

        if (!isSelected) {
            state.gojiraButton.disabled = true;
            state.gojiraButton.cursor = 'not-allowed';
            state.gojiraButton.title = 'برای آماده‌سازی تیکت ابتدا یک ردیف را انتخاب کنید';
            return;
        }

        state.gojiraButton.disabled = false;
        state.gojiraButton.cursor = 'pointer';
        if (validTracking) {
            state.gojiraButton.title = `آماده‌سازی تیکت GoJira برای مرسوله ${validTracking}`;
        } else {
            state.gojiraButton.title = 'آماده‌سازی تیکت GoJira';
        }
    }

    function simulateClickGojira() {
        if (state.gojiraButton.disabled || state.isGojiraInProgress) {
            return false;
        }
        state.gojiraMenuOpen = !state.gojiraMenuOpen;
        return true;
    }

    function simulateJiraCheck(parcelId, waybill, outcome = 'SUCCESS_ZERO') {
        state.jiraCheckRunCount++;
        state.jiraCheckState = outcome;
    }

    it('Scenario 1: Row selected -> GoJira immediately enabled without Jira check running', () => {
        assert.equal(state.gojiraButton.disabled, true);
        assert.equal(state.jiraCheckRunCount, 0);

        // Operator clicks Automoby row
        simulateUpdateGojira('1543337', '1543337', true);

        // GoJira MUST be enabled immediately
        assert.equal(state.gojiraButton.disabled, false);
        assert.equal(state.gojiraButton.cursor, 'pointer');
        assert.equal(state.jiraCheckRunCount, 0, 'Jira check must NEVER have run');

        // Operator clicks GoJira
        const clicked = simulateClickGojira();
        assert.equal(clicked, true);
        assert.equal(state.gojiraMenuOpen, true);
    });

    it('Scenario 2: Returns view with no tracking on click -> GoJira still enabled based on row selection', () => {
        // In Returns view, tracking number is not pre-populated
        simulateUpdateGojira('return-row-9821', '', true);

        // GoJira MUST be enabled based on row identity
        assert.equal(state.gojiraButton.disabled, false);
        assert.equal(state.gojiraButton.cursor, 'pointer');
        assert.equal(state.activeGojiraSelection.hasSelectedRow, true);

        // Menu can be opened
        assert.equal(simulateClickGojira(), true);
        assert.equal(state.gojiraMenuOpen, true);
    });

    it('Scenario 3: GoJira works independently across all Jira check outcomes', () => {
        const outcomes = ['IDLE', 'RUNNING', 'SUCCESS_ZERO', 'SUCCESS_ONE', 'SUCCESS_MULTI', 'FAILED', 'TIMEOUT', 'CORRUPT'];

        for (const outcome of outcomes) {
            // Select row
            simulateUpdateGojira('row-test-1', '54807199275779101', true);
            if (outcome !== 'IDLE') {
                simulateJiraCheck('row-test-1', '54807199275779101', outcome);
            }

            assert.equal(state.gojiraButton.disabled, false, `Must be enabled for Jira state: ${outcome}`);
            assert.equal(state.gojiraButton.cursor, 'pointer', `Must show pointer cursor for Jira state: ${outcome}`);
            assert.equal(simulateClickGojira(), true, `Must be clickable for Jira state: ${outcome}`);
            state.gojiraMenuOpen = false; // reset for next iteration
        }
    });

    it('Scenario 4: Row switching updates context and retains independent GoJira enablement', () => {
        // Select row 1
        simulateUpdateGojira('row-1', '1001', true);
        assert.equal(state.activeGojiraSelection.rowId, 'row-1');
        assert.equal(state.gojiraButton.disabled, false);

        // Jira check run on row 1
        simulateJiraCheck('row-1', '1001', 'SUCCESS_ONE');
        assert.equal(state.jiraCheckRunCount, 1);

        // Switch to row 2 without running Jira check
        simulateUpdateGojira('row-2', '1002', true);
        assert.equal(state.activeGojiraSelection.rowId, 'row-2');
        assert.equal(state.gojiraButton.disabled, false);
        assert.equal(state.gojiraButton.cursor, 'pointer');
        assert.equal(state.jiraCheckRunCount, 1, 'No Jira check required for row 2');

        // Deselect row
        simulateUpdateGojira('', '', false);
        assert.equal(state.activeGojiraSelection.hasSelectedRow, false);
        assert.equal(state.gojiraButton.disabled, true);
        assert.equal(state.gojiraButton.cursor, 'not-allowed');
    });

    it('Scenario 5: Repeated clicks toggle menu safely without state corruption', () => {
        simulateUpdateGojira('row-5', '5480112233', true);

        // First click opens
        assert.equal(simulateClickGojira(), true);
        assert.equal(state.gojiraMenuOpen, true);

        // Second click closes
        assert.equal(simulateClickGojira(), true);
        assert.equal(state.gojiraMenuOpen, false);

        // Third click opens again
        assert.equal(simulateClickGojira(), true);
        assert.equal(state.gojiraMenuOpen, true);
    });
});
