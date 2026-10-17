/**
 * gojira-templates.js
 * 
 * GoJira Template Registry and Invariant Rules for Delivery Assistant.
 * Strictly enforces global invariants: Project must always be Platform (10512)
 * and Issue Type must always be Task (10002).
 */

const GOJIRA_GLOBAL_INVARIANTS = Object.freeze({
    PROJECT_NAME: 'Platform',
    PROJECT_ID: '10512',
    PROJECT_KEY: 'PLATFORM',
    ISSUE_TYPE_NAME: 'Task',
    ISSUE_TYPE_ID: '10002'
});

const GOJIRA_TEMPLATES = Object.freeze({
    danandeh: Object.freeze({
        id: 'danandeh',
        displayName: 'داننده',
        assignee: Object.freeze({
            username: 'monire-danande',
            fullName: 'منیره داننده',
            email: 'monire-danande@automoby.ir',
            searchQuery: 'داننده',
            expectedLinkPattern: /منیره\s*داننده|monire-danande/i,
            verifiedLinkId: 'منیره-داننده-1-link'
        }),
        labels: Object.freeze(['CX']),
        summaryRule: 'TRACKING_NUMBER_ONLY',
        descriptionRule: 'STORE_NAME_WITH_NEWLINE',
        trackingNumberField: 'customfield_10402',
        requestSubjectField: 'customfield_10401',
        requesterTeamField: 'customfield_10400',
        priorityBehavior: 'PRESERVE_INITIAL'
    })
});

/**
 * Validates a shipment tracking identifier.
 * Discards non-numeric strings, placeholders, and strings with Persian/Arabic script.
 */
function isValidTrackingNumber(token) {
    if (!token || typeof token !== 'string') return false;
    const clean = token.trim();
    if (clean.length < 4 || clean.length > 35) return false;
    if (/[\u0600-\u06FF]/.test(clean)) return false;
    const lower = clean.toLowerCase();
    if (/^(null|undefined|none|n\/a|na|-+)$/i.test(lower)) return false;
    if (/^([0-9a-zA-Z])\1{4,}$/.test(clean)) return false;
    if (/^\d{4,30}$/.test(clean)) return true;
    if (/^[A-Za-z0-9\-_]{4,35}$/.test(clean) && /\d/.test(clean)) return true;
    return false;
}

/**
 * Validates extracted store name.
 */
function isValidStoreName(name) {
    if (!name || typeof name !== 'string') return false;
    const clean = name.trim();
    if (clean.length < 2) return false;
    if (/^(null|undefined|none|n\/a|-+)$/i.test(clean)) return false;
    return true;
}

/**
 * Returns list of usable templates for the template selector UI.
 * Initially returns exactly one template: داننده.
 */
function getAvailableTemplates() {
    return Object.values(GOJIRA_TEMPLATES).map(t => ({
        id: t.id,
        displayName: t.displayName
    }));
}

/**
 * Retrieves a template by its ID.
 */
function getTemplateById(id) {
    if (!id || !GOJIRA_TEMPLATES[id]) {
        throw new Error(`الگوی GoJira با شناسه "${id}" یافت نشد.`);
    }
    return GOJIRA_TEMPLATES[id];
}

/**
 * Formats the Description field for the production داننده template.
 * Rule: Exactly the store name followed by a single newline \n. Remainder empty.
 */
function formatGoJiraDescription(storeName) {
    if (!isValidStoreName(storeName)) {
        throw new Error('نام فروشگاه برای ساخت توضیحات تیکت معتبر نیست.');
    }
    return `${storeName.trim()}\n`;
}

/**
 * Formats the Summary field for the production داننده template.
 * Rule: Exactly the tracking number only.
 */
function formatGoJiraSummary(trackingNumber) {
    if (!isValidTrackingNumber(trackingNumber)) {
        throw new Error('شماره مرسوله برای خلاصه تیکت معتبر نیست.');
    }
    return trackingNumber.trim();
}

/**
 * Validates payload before sending to Jira form preparation.
 */
function validateGoJiraPayload(payload) {
    if (!payload || typeof payload !== 'object') {
        throw new Error('داده‌های ارسالی به GoJira نامعتبر است.');
    }
    const template = getTemplateById(payload.templateId || 'danandeh');
    const trackingNumber = formatGoJiraSummary(payload.trackingNumber);
    const storeName = payload.storeName ? payload.storeName.trim() : '';
    if (!isValidStoreName(storeName)) {
        throw new Error('نام فروشگاه ناموجود یا نامعتبر است. لطفاً از باز شدن جزئیات ردیف اطمینان حاصل کنید.');
    }

    return {
        templateId: template.id,
        trackingNumber,
        storeName,
        summary: trackingNumber,
        description: formatGoJiraDescription(storeName),
        labels: [...template.labels],
        project: {
            name: GOJIRA_GLOBAL_INVARIANTS.PROJECT_NAME,
            id: GOJIRA_GLOBAL_INVARIANTS.PROJECT_ID,
            key: GOJIRA_GLOBAL_INVARIANTS.PROJECT_KEY
        },
        issueType: {
            name: GOJIRA_GLOBAL_INVARIANTS.ISSUE_TYPE_NAME,
            id: GOJIRA_GLOBAL_INVARIANTS.ISSUE_TYPE_ID
        },
        assignee: { ...template.assignee },
        customfield_10402: trackingNumber,
        customfield_10401: '' // Must remain unselected
    };
}

// Universal module export
const GoJiraModule = {
    GOJIRA_GLOBAL_INVARIANTS,
    GOJIRA_TEMPLATES,
    isValidTrackingNumber,
    isValidStoreName,
    getAvailableTemplates,
    getTemplateById,
    formatGoJiraDescription,
    formatGoJiraSummary,
    validateGoJiraPayload
};

if (typeof window !== 'undefined') {
    window.GOJIRA_MODULE = GoJiraModule;
}
if (typeof module !== 'undefined' && module.exports) {
    module.exports = GoJiraModule;
}
export {
    GOJIRA_GLOBAL_INVARIANTS,
    GOJIRA_TEMPLATES,
    isValidTrackingNumber,
    isValidStoreName,
    getAvailableTemplates,
    getTemplateById,
    formatGoJiraDescription,
    formatGoJiraSummary,
    validateGoJiraPayload
};
export default GoJiraModule;
