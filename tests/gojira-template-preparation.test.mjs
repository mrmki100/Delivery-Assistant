import { describe, it } from 'node:test';
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

describe('GoJira: Template Registry & Invariant Rules', () => {
    it('enforces global project invariant Platform (10512)', () => {
        assert.equal(GOJIRA_GLOBAL_INVARIANTS.PROJECT_NAME, 'Platform');
        assert.equal(GOJIRA_GLOBAL_INVARIANTS.PROJECT_ID, '10512');
        assert.equal(GOJIRA_GLOBAL_INVARIANTS.PROJECT_KEY, 'PLATFORM');
    });

    it('enforces global issue type invariant Task (10002)', () => {
        assert.equal(GOJIRA_GLOBAL_INVARIANTS.ISSUE_TYPE_NAME, 'Task');
        assert.equal(GOJIRA_GLOBAL_INVARIANTS.ISSUE_TYPE_ID, '10002');
    });

    it('exposes exactly ONE template in initial registry named داننده', () => {
        const templates = getAvailableTemplates();
        assert.equal(templates.length, 1, 'Only one template must be exposed initially');
        assert.equal(templates[0].id, 'danandeh');
        assert.equal(templates[0].displayName, 'داننده', 'Display name must be strictly داننده');
    });

    it('verifies داننده template contract and verified Jira assignee', () => {
        const t = getTemplateById('danandeh');
        assert.equal(t.displayName, 'داننده');
        assert.equal(t.assignee.username, 'monire-danande');
        assert.equal(t.assignee.fullName, 'منیره داننده');
        assert.equal(t.assignee.email, 'monire-danande@automoby.ir');
        assert.deepEqual(t.labels, ['CX']);
        assert.equal(t.trackingNumberField, 'customfield_10402');
        assert.equal(t.requestSubjectField, 'customfield_10401');
    });

    it('formats Summary with tracking number only (no prefix, suffix, store name, or customer info)', () => {
        const summary = formatGoJiraSummary('1543245');
        assert.equal(summary, '1543245');

        assert.throws(() => formatGoJiraSummary(''), /معتبر نیست/);
        assert.throws(() => formatGoJiraSummary('null'), /معتبر نیست/);
        assert.throws(() => formatGoJiraSummary('تهران'), /معتبر نیست/);
    });

    it('formats Description with exact store name followed by newline', () => {
        const desc = formatGoJiraDescription('مشهد پارت');
        assert.equal(desc, 'مشهد پارت\n');

        assert.throws(() => formatGoJiraDescription(''), /معتبر نیست/);
        assert.throws(() => formatGoJiraDescription('   '), /معتبر نیست/);
    });

    it('validates complete GoJira payload and prevents template overriding Platform and Task', () => {
        const payload = validateGoJiraPayload({
            templateId: 'danandeh',
            trackingNumber: '54807199275779101',
            storeName: 'مشهد پارت'
        });

        assert.equal(payload.summary, '54807199275779101');
        assert.equal(payload.description, 'مشهد پارت\n');
        assert.equal(payload.project.name, 'Platform');
        assert.equal(payload.project.id, '10512');
        assert.equal(payload.issueType.name, 'Task');
        assert.equal(payload.issueType.id, '10002');
        assert.deepEqual(payload.labels, ['CX']);
        assert.equal(payload.customfield_10402, '54807199275779101');
        assert.equal(payload.customfield_10401, '', 'Request subject must remain unselected');
        assert.equal(payload.assignee.username, 'monire-danande');
    });

    it('rejects invalid or placeholder tracking identifiers', () => {
        assert.equal(isValidTrackingNumber('1543245'), true);
        assert.equal(isValidTrackingNumber('54807199275779101'), true);
        assert.equal(isValidTrackingNumber('IR-99283-A1'), true);

        // Rejections:
        assert.equal(isValidTrackingNumber(''), false);
        assert.equal(isValidTrackingNumber('123'), false, 'Too short');
        assert.equal(isValidTrackingNumber('null'), false);
        assert.equal(isValidTrackingNumber('undefined'), false);
        assert.equal(isValidTrackingNumber('none'), false);
        assert.equal(isValidTrackingNumber('0000000000'), false, 'Repeated dummy digits');
        assert.equal(isValidTrackingNumber('حضوری'), false, 'Persian letters rejected');
        assert.equal(isValidTrackingNumber('تحویل حضوری'), false);
    });
});

describe('GoJira: UI Integration & Architecture Parity', () => {
    const contentJs = fs.readFileSync(path.resolve('content.js'), 'utf8');
    const stylesCss = fs.readFileSync(path.resolve('styles.css'), 'utf8');
    const manifestJson = JSON.parse(fs.readFileSync(path.resolve('manifest.json'), 'utf8'));
    const backgroundJs = fs.readFileSync(path.resolve('background.js'), 'utf8');

    it('verifies GoJira button exists with exact name and casing in content.js', () => {
        assert.ok(contentJs.includes('id="btn-gojira-trigger"'), 'Must render #btn-gojira-trigger');
        assert.ok(contentJs.includes('<span>GoJira</span>'), 'Must display exact label "GoJira"');
        assert.ok(!contentJs.includes('<span>Gojira</span>'), 'Must NOT use lowercase J in Gojira');
        assert.ok(!contentJs.includes('<span>GOJIRA</span>'), 'Must NOT use ALL-CAPS GOJIRA');
    });

    it('verifies existing بررسی تیکت Jira button is 100% preserved and untouched', () => {
        assert.ok(contentJs.includes('id="btn-jira-lookup"'), 'Must retain #btn-jira-lookup');
        assert.ok(contentJs.includes('<span>بررسی تیکت Jira</span>'), 'Must retain "بررسی تیکت Jira" label');
        assert.ok(contentJs.includes('id="cx-jira-widget"'), 'Must retain #cx-jira-widget');
    });

    it('verifies template selector menu in content.js offers strictly داننده', () => {
        assert.ok(contentJs.includes('id="cx-gojira-menu"'), 'Must render #cx-gojira-menu');
        assert.ok(contentJs.includes('data-template-id="danandeh"'), 'Must offer danandeh template');
        assert.ok(contentJs.includes('<span>داننده</span>'), 'Template label must be strictly داننده');
        assert.ok(!contentJs.includes('data-template-id="placeholder"'), 'Must NOT include dummy templates');
    });

    it('verifies store name extraction from expanded details in content.js', () => {
        assert.ok(contentJs.includes('extractStoreNameForSelectedRow'), 'Must define extractStoreNameForSelectedRow');
        assert.ok(contentJs.includes('MuiDataGrid-detailPanelToggleCell'), 'Must support clicking detailPanel toggle');
        assert.ok(contentJs.includes('data-field="supplier_title"'), 'Must extract from supplier_title cell');
    });

    it('verifies stale-state and cross-record protection in content.js', () => {
        assert.ok(contentJs.includes('activeGojiraSelection.rowId !== initialRowId'), 'Must check if row changed during async expansion');
    });

    it('verifies styles.css defines GoJira button, menu, and dark theme', () => {
        assert.ok(stylesCss.includes('.cx-btn-trigger.btn-gojira'), 'styles.css must include .btn-gojira');
        assert.ok(stylesCss.includes('.cx-gojira-menu'), 'styles.css must include .cx-gojira-menu');
        assert.ok(stylesCss.includes('.cx-gojira-menu-item'), 'styles.css must include .cx-gojira-menu-item');
        assert.ok(stylesCss.includes(':host(.cx-dark) .cx-btn-trigger.btn-gojira'), 'styles.css must support dark theme for GoJira button');
        assert.ok(stylesCss.includes(':host(.cx-dark) .cx-gojira-menu'), 'styles.css must support dark theme for GoJira menu');
    });

    it('verifies background.js handles PREPARE_GOJIRA_ISSUE and EXECUTE_AUTHORIZED_QA_TEST_ISSUE', () => {
        assert.ok(backgroundJs.includes("action === 'PREPARE_GOJIRA_ISSUE'"), 'Must handle PREPARE_GOJIRA_ISSUE');
        assert.ok(backgroundJs.includes("action === 'EXECUTE_AUTHORIZED_QA_TEST_ISSUE'"), 'Must handle EXECUTE_AUTHORIZED_QA_TEST_ISSUE');
        assert.ok(backgroundJs.includes("handlePrepareGojiraIssue"), 'Must define handlePrepareGojiraIssue');
        assert.ok(backgroundJs.includes("gojiraPendingTask"), 'Must persist task in storage for tab hydration');
    });

    it('verifies manifest.json registers jira-assistant.js for jira.automoby.ir', () => {
        const jiraScript = manifestJson.content_scripts.find(cs => cs.matches.includes('*://jira.automoby.ir/*'));
        assert.ok(jiraScript, 'manifest.json must have content_script for *://jira.automoby.ir/*');
        assert.ok(jiraScript.js.includes('jira-assistant.js'), 'Must include jira-assistant.js');
        assert.ok(manifestJson.host_permissions.includes('*://jira.automoby.ir/*'), 'Must include jira host permission');
    });
});

describe('GoJira: Jira Assistant Automation Contract (jira-assistant.js)', () => {
    const jiraAssistantJs = fs.readFileSync(path.resolve('jira-assistant.js'), 'utf8');

    it('enforces Platform project (10512) and Task issue type (10002) in jira-assistant.js', () => {
        assert.ok(jiraAssistantJs.includes("PROJECT_ID: '10512'"), 'Must define PROJECT_ID 10512');
        assert.ok(jiraAssistantJs.includes("PROJECT_NAME: 'Platform'"), 'Must define PROJECT_NAME Platform');
        assert.ok(jiraAssistantJs.includes("ISSUE_TYPE_ID: '10002'"), 'Must define ISSUE_TYPE_ID 10002');
        assert.ok(jiraAssistantJs.includes("ISSUE_TYPE_NAME: 'Task'"), 'Must define ISSUE_TYPE_NAME Task');
        assert.ok(jiraAssistantJs.includes("selectAndVerifyProject"), 'Must select and verify Platform');
        assert.ok(jiraAssistantJs.includes("selectAndVerifyIssueType"), 'Must select and verify Task');
    });

    it('maps tracking customfield_10402 and leaves request subject customfield_10401 unselected in production', () => {
        assert.ok(jiraAssistantJs.includes("TRACKING_FIELD_ID: 'customfield_10402'"), 'Must target customfield_10402');
        assert.ok(jiraAssistantJs.includes("REQUEST_SUBJECT_FIELD_ID: 'customfield_10401'"), 'Must target customfield_10401');
        assert.ok(jiraAssistantJs.includes("reqSubjectSelect.value = ''"), 'Must leave request subject unselected in production');
    });

    it('commits CX label and prevents duplicate chips', () => {
        assert.ok(jiraAssistantJs.includes("commitCXLabel"), 'Must define commitCXLabel');
        assert.ok(jiraAssistantJs.includes("existingItems.includes('CX')"), 'Must check if CX already exists');
    });

    it('assigns Monireh Danandeh in production and preserves Priority unchanged', () => {
        assert.ok(jiraAssistantJs.includes("monire-danande"), 'Must target username monire-danande');
        assert.ok(jiraAssistantJs.includes("منیره داننده"), 'Must target display name منیره داننده');
        assert.ok(jiraAssistantJs.includes("Priority Invariant: Left untouched"), 'Must leave priority untouched');
    });

    it('guarantees production issues are NEVER automatically submitted', () => {
        assert.ok(jiraAssistantJs.includes("Production GoJira NEVER submits!"), 'Must contain zero-submission guard');
        assert.ok(jiraAssistantJs.includes("mode: 'PREPARED_UNSUBMITTED'"), 'Must return PREPARED_UNSUBMITTED mode');
    });

    it('authorizes live QA test issue exclusively for current user with Summary Delivery Assistant', () => {
        assert.ok(jiraAssistantJs.includes("summaryValue = isLiveQATest ? 'Delivery Assistant'"), 'QA issue summary must be Delivery Assistant');
        assert.ok(jiraAssistantJs.includes("assignToMeBtn"), 'QA issue must assign to current user');
        assert.ok(jiraAssistantJs.includes("authUser.username"), 'QA issue must verify current user');
    });
});
