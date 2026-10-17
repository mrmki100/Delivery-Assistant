/**
 * jira-assistant.js
 * 
 * Content script running exclusively on https://jira.automoby.ir/*
 * Automates the preparation of Jira issue forms for Delivery Assistant (GoJira).
 * 
 * STRICT INVARIANTS:
 * 1. Global Project is ALWAYS Platform (pid: 10512).
 * 2. Global Issue Type is ALWAYS Task (issuetype: 10002).
 * 3. Priority is NEVER explicitly modified (preserved as Jira sets it).
 * 4. Request Subject (customfield_10401) is NEVER automatically selected for production tickets.
 * 5. Production issues are NEVER submitted automatically. The form remains open for operator review.
 */

(function () {
    'use strict';

    if (window.__GOJIRA_ASSISTANT_INJECTED__) return;
    window.__GOJIRA_ASSISTANT_INJECTED__ = true;

    const CONSTANTS = {
        PROJECT_ID: '10512',
        PROJECT_NAME: 'Platform',
        ISSUE_TYPE_ID: '10002',
        ISSUE_TYPE_NAME: 'Task',
        TRACKING_FIELD_ID: 'customfield_10402',
        REQUEST_SUBJECT_FIELD_ID: 'customfield_10401',
        PROD_ASSIGNEE_USERNAME: 'monire-danande',
        PROD_ASSIGNEE_NAME: 'منیره داننده',
        PROD_ASSIGNEE_SUGGESTION_ID: 'منیره-داننده-1-link'
    };

    /**
     * Checks if current user is authenticated on Jira.
     */
    function getAuthenticatedUser() {
        const metaUser = document.querySelector('meta[name="ajs-remote-user"]')?.content || null;
        const metaFullName = document.querySelector('meta[name="ajs-remote-user-fullname"]')?.content || null;
        return {
            isAuthenticated: !!metaUser,
            username: metaUser,
            fullName: metaFullName
        };
    }

    /**
     * Sleeps for given milliseconds.
     */
    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Waits for an element to appear in DOM satisfying predicate.
     */
    async function waitForElement(selector, timeoutMs = 7000, root = document) {
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
            const el = root.querySelector(selector);
            if (el && (el.offsetParent !== null || window.getComputedStyle(el).display !== 'none')) {
                return el;
            }
            await sleep(150);
        }
        return null;
    }

    /**
     * Opens or reveals the Create Issue dialog.
     */
    async function ensureCreateIssueDialogOpen() {
        let dialog = document.querySelector('#create-issue-dialog');
        const isDialogOpen = (el) => {
            if (!el) return false;
            const style = window.getComputedStyle(el);
            return (
                el.classList.contains('jira-dialog-open') || 
                el.classList.contains('jira-dialog-content-ready')
            ) && style.display !== 'none' && style.visibility !== 'hidden';
        };

        if (isDialogOpen(dialog)) {
            return dialog;
        }

        const createBtn = await waitForElement('#create_link, a.create-issue, #create-issue', 8000);
        if (!createBtn) {
            throw new Error('دکمه Create در نوار ناوبری Jira یافت نشد.');
        }

        createBtn.click();

        dialog = await waitForElement('#create-issue-dialog.jira-dialog-content-ready', 8000);
        if (!dialog) {
            // Check if dialog exists without the ready class yet
            dialog = await waitForElement('#create-issue-dialog', 4000);
            if (!dialog) {
                throw new Error('پنجره ساخت تیکت (Create Issue) در Jira پس از کلیک باز نشد.');
            }
        }

        // Wait a moment for dynamic fields inside dialog to settle
        await sleep(600);
        return dialog;
    }

    /**
     * Selects and verifies Project is Platform (10512).
     */
    async function selectAndVerifyProject(dialog) {
        const pSelect = dialog.querySelector('#project');
        const pField = dialog.querySelector('#project-field');

        if (!pField) {
            throw new Error('فیلد انتخاب پروژه در فرم Jira یافت نشد.');
        }

        // Check if already Platform (10512)
        if (pSelect && pSelect.value === CONSTANTS.PROJECT_ID) {
            return true;
        }

        pField.focus();
        pField.value = 'Platform';
        pField.dispatchEvent(new Event('input', { bubbles: true }));
        pField.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'm' }));

        const suggestion = await waitForElement('#project-suggestions a[id*="platform"], #project-suggestions .aui-list-item-link', 4000);
        if (!suggestion) {
            throw new Error('گزینه پروژه Platform در لیست پیشنهادات Jira یافت نشد.');
        }

        suggestion.click();
        await sleep(1200); // Allow Jira form fields to re-render for Platform

        const updatedSelect = dialog.querySelector('#project');
        if (updatedSelect && updatedSelect.value !== CONSTANTS.PROJECT_ID) {
            throw new Error(`تایید پروژه Platform ناموفق بود (شناسه فعلی: ${updatedSelect.value}).`);
        }
        return true;
    }

    /**
     * Selects and verifies Issue Type is Task (10002).
     */
    async function selectAndVerifyIssueType(dialog) {
        const itSelect = dialog.querySelector('#issuetype');
        const itField = dialog.querySelector('#issuetype-field');

        if (!itField) {
            throw new Error('فیلد انتخاب نوع درخواست (Issue Type) در فرم Jira یافت نشد.');
        }

        // Check if already Task (10002)
        if (itSelect && itSelect.value === CONSTANTS.ISSUE_TYPE_ID) {
            return true;
        }

        itField.focus();
        itField.value = 'Task';
        itField.dispatchEvent(new Event('input', { bubbles: true }));
        itField.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'k' }));

        const suggestion = await waitForElement('#issuetype-suggestions a[id*="task"], #issuetype-suggestions .aui-list-item-link', 3000);
        if (suggestion) {
            suggestion.click();
            await sleep(1000); // Allow form to settle after issuetype change
        }

        const updatedSelect = dialog.querySelector('#issuetype');
        if (updatedSelect && updatedSelect.value !== CONSTANTS.ISSUE_TYPE_ID && itField.value.trim().toLowerCase() !== 'task') {
            throw new Error(`تایید نوع درخواست Task ناموفق بود (شناسه فعلی: ${updatedSelect?.value}).`);
        }
        return true;
    }

    /**
     * Sets value and dispatches input/change events.
     */
    function setInputValue(input, val) {
        if (!input) return;
        input.value = val;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
    }

    /**
     * Commits CX label into Jira's MultiSelect component.
     */
    async function commitCXLabel(dialog) {
        const labelsContainer = dialog.querySelector('#labels-multi-select');
        const labelsSelect = dialog.querySelector('#labels');

        // Check if already committed
        const existingItems = Array.from(dialog.querySelectorAll('#labels-multi-select .items li')).map(li => li.innerText?.trim());
        const existingOptions = Array.from(labelsSelect?.options || []).map(o => o.value);
        if (existingItems.includes('CX') || existingOptions.includes('CX')) {
            return true;
        }

        const textarea = dialog.querySelector('#labels-textarea');
        if (!textarea) {
            throw new Error('فیلد ورودی برچسب‌ها (Labels) در فرم یافت نشد.');
        }

        textarea.focus();
        textarea.value = 'CX';
        textarea.dispatchEvent(new Event('input', { bubbles: true }));

        // Trigger Enter key via jQuery if available, otherwise native KeyboardEvent
        if (window.jQuery) {
            const $ = window.jQuery;
            const $ta = $(textarea);
            $ta.val('CX');
            const e = $.Event('keydown', { which: 13, keyCode: 13, key: 'Enter' });
            $ta.trigger(e);
        } else {
            textarea.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter', keyCode: 13, which: 13 }));
            textarea.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'Enter', keyCode: 13, which: 13 }));
        }

        await sleep(400);

        // Verify committed
        const afterItems = Array.from(dialog.querySelectorAll('#labels-multi-select .items li')).map(li => li.innerText?.trim());
        const afterOptions = Array.from(labelsSelect?.options || []).map(o => o.value);
        if (!afterItems.includes('CX') && !afterOptions.includes('CX')) {
            console.warn('[GoJira] CX label chip commit check was unconfirmed in DOM representation, ensuring select option');
            if (labelsSelect) {
                const opt = document.createElement('option');
                opt.value = 'CX';
                opt.text = 'CX';
                opt.selected = true;
                labelsSelect.appendChild(opt);
                labelsSelect.dispatchEvent(new Event('change', { bubbles: true }));
            }
        }
        return true;
    }

    /**
     * Selects and verifies Assignee.
     */
    async function selectAssignee(dialog, isLiveQATest = false) {
        const assigneeField = dialog.querySelector('#assignee-field');
        const assigneeSelect = dialog.querySelector('#assignee');

        if (isLiveQATest) {
            // QA Test Issue: strictly assign to current user
            const authUser = getAuthenticatedUser();
            if (!authUser.isAuthenticated || !authUser.username) {
                throw new Error('کاربر فعلی Jira احراز هویت نشده است. صدور تیکت آزمایشی متوقف شد.');
            }

            const assignToMeBtn = dialog.querySelector('#assign-to-me-trigger');
            if (assignToMeBtn) {
                assignToMeBtn.click();
                await sleep(500);
            } else if (assigneeField) {
                assigneeField.focus();
                assigneeField.value = authUser.fullName || authUser.username;
                assigneeField.dispatchEvent(new Event('input', { bubbles: true }));
                const mySuggestion = await waitForElement('#assignee-suggestions .aui-list-item-link', 3000);
                if (mySuggestion) mySuggestion.click();
                await sleep(500);
            }

            const finalVal = assigneeSelect?.value;
            if (finalVal !== authUser.username) {
                throw new Error(`تخصیص تیکت تستی به کاربر جاری (${authUser.username}) تایید نشد (مقدار فعلی: ${finalVal}).`);
            }
            return { username: authUser.username, fullName: authUser.fullName };
        }

        // Production داننده template:
        if (assigneeSelect && assigneeSelect.value === CONSTANTS.PROD_ASSIGNEE_USERNAME) {
            return { username: CONSTANTS.PROD_ASSIGNEE_USERNAME, fullName: CONSTANTS.PROD_ASSIGNEE_NAME };
        }

        if (!assigneeField) {
            throw new Error('فیلد انتخاب مسئول (Assignee) در فرم Jira یافت نشد.');
        }

        assigneeField.focus();
        assigneeField.value = 'داننده';
        assigneeField.dispatchEvent(new Event('input', { bubbles: true }));
        assigneeField.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ه' }));
        assigneeField.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'ه' }));

        const suggestionLink = await waitForElement(`#${CONSTANTS.PROD_ASSIGNEE_SUGGESTION_ID}, #assignee-suggestions a[id*="داننده"], #assignee-suggestions a[id*="danande"]`, 4000);
        if (!suggestionLink) {
            throw new Error(`حساب کاربری Jira برای منیره داننده (${CONSTANTS.PROD_ASSIGNEE_USERNAME}) در پیشنهادات یافت نشد.`);
        }

        suggestionLink.click();
        await sleep(500);

        const updatedVal = assigneeSelect?.value;
        if (updatedVal !== CONSTANTS.PROD_ASSIGNEE_USERNAME) {
            // Direct select fallback
            if (assigneeSelect) {
                let opt = Array.from(assigneeSelect.options).find(o => o.value === CONSTANTS.PROD_ASSIGNEE_USERNAME);
                if (!opt) {
                    opt = document.createElement('option');
                    opt.value = CONSTANTS.PROD_ASSIGNEE_USERNAME;
                    opt.text = CONSTANTS.PROD_ASSIGNEE_NAME;
                    assigneeSelect.appendChild(opt);
                }
                opt.selected = true;
                assigneeSelect.value = CONSTANTS.PROD_ASSIGNEE_USERNAME;
                assigneeSelect.dispatchEvent(new Event('change', { bubbles: true }));
            }
            if (assigneeField) assigneeField.value = CONSTANTS.PROD_ASSIGNEE_NAME;
        }

        return { username: CONSTANTS.PROD_ASSIGNEE_USERNAME, fullName: CONSTANTS.PROD_ASSIGNEE_NAME };
    }

    /**
     * Bounded, safe autofocus for the editable Description control in Jira.
     * Ensures initial keyboard focus does not remain on Assignee.
     * Never steals focus repeatedly after the user has begun interacting.
     */
    async function focusDescriptionEditor(dialog) {
        if (!dialog) return { focused: false, error: 'NO_DIALOG' };

        const maxAttempts = 10;
        const intervalMs = 200;

        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            // Priority 1: Active TinyMCE visual rich-text editor
            if (window.tinymce && window.tinymce.activeEditor && !window.tinymce.activeEditor.isHidden()) {
                try {
                    window.tinymce.activeEditor.focus();
                    if (window.tinymce.activeEditor.selection) {
                        try {
                            const body = window.tinymce.activeEditor.getBody();
                            if (body) {
                                window.tinymce.activeEditor.selection.select(body, true);
                                window.tinymce.activeEditor.selection.collapse(false);
                            }
                        } catch (_) {}
                    }
                    return { focused: true, target: 'tinymce_activeEditor' };
                } catch (e) {
                    console.warn('[GoJira Assistant] TinyMCE activeEditor focus notice:', e);
                }
            }

            // Priority 2: Description editor iframe (tox-edit-area__iframe / mce_ifr)
            const iframe = dialog.querySelector(
                '#description-wiki-edit iframe, #description_ifr, iframe[id*="description"], iframe[id*="mce"]'
            );
            if (iframe && iframe.contentWindow) {
                try {
                    iframe.contentWindow.focus();
                    const doc = iframe.contentDocument || iframe.contentWindow.document;
                    if (doc && doc.body) {
                        doc.body.focus();
                        return { focused: true, target: 'iframe_editor_body' };
                    }
                } catch (e) {
                    console.warn('[GoJira Assistant] Description iframe focus notice:', e);
                }
            }

            // Priority 3: Plain textarea (#description)
            const descTextarea = dialog.querySelector('#description');
            if (descTextarea && (descTextarea.offsetParent !== null || !dialog.querySelector('iframe'))) {
                try {
                    descTextarea.focus();
                    const len = descTextarea.value.length;
                    descTextarea.setSelectionRange(len, len);
                    return { focused: true, target: 'textarea_description' };
                } catch (e) {
                    console.warn('[GoJira Assistant] Description textarea focus notice:', e);
                }
            }

            // Wait before next bounded check
            await sleep(intervalMs);
        }

        console.warn('[GoJira Assistant] Description editor could not be focused within bounded readiness window.');
        return { focused: false, error: 'TIMEOUT_WAITING_FOR_DESCRIPTION' };
    }

    /**
     * Prepares Jira Create Issue form with exact contract values.
     * NEVER automatically submits production issues.
     */
    async function prepareGoJiraIssue(payload, isLiveQATest = false) {
        const authUser = getAuthenticatedUser();
        if (!authUser.isAuthenticated) {
            return {
                success: false,
                error: 'AUTH_REQUIRED',
                message: 'نشست کاربری شما در Jira فعال نیست. لطفاً وارد سامانه شوید.'
            };
        }

        const dialog = await ensureCreateIssueDialogOpen();

        // 1. Enforce Global Invariants (Platform + Task)
        await selectAndVerifyProject(dialog);
        await selectAndVerifyIssueType(dialog);

        // 2. Summary
        const summaryInput = dialog.querySelector('#summary');
        if (!summaryInput) {
            throw new Error('فیلد Summary در فرم یافت نشد.');
        }
        const summaryValue = isLiveQATest ? 'Delivery Assistant' : String(payload.trackingNumber).trim();
        setInputValue(summaryInput, summaryValue);

        // 3. Description
        const descTextarea = dialog.querySelector('#description');
        if (descTextarea) {
            const currentDesc = descTextarea.value.trim();
            // Preserve manual edits if user has already written something custom
            if (!currentDesc || isLiveQATest) {
                const descValue = isLiveQATest 
                    ? 'Automated E2E Verification Test Issue for Delivery Assistant GoJira integration. Safe test-only issue.\n'
                    : `${String(payload.storeName).trim()}\n`;
                setInputValue(descTextarea, descValue);

                // Sync with TinyMCE if visual editor is active
                if (window.tinymce && window.tinymce.editors) {
                    window.tinymce.editors.forEach(ed => {
                        try {
                            ed.setContent(`<p>${descValue.trim()}</p><p><br></p>`);
                            ed.fire('change');
                        } catch (e) {
                            console.warn('[GoJira Assistant] TinyMCE sync notice:', e);
                        }
                    });
                }
            }
        }

        // 4. Labels (CX)
        await commitCXLabel(dialog);

        // 5. Assignee
        const assignedAccount = await selectAssignee(dialog, isLiveQATest);

        // 6. Tracking Number Custom Field (customfield_10402)
        const trackingInput = dialog.querySelector(`#${CONSTANTS.TRACKING_FIELD_ID}`);
        if (!trackingInput) {
            throw new Error(`فیلد شماره مرسوله (${CONSTANTS.TRACKING_FIELD_ID}) در فرم پروژه Platform یافت نشد.`);
        }
        setInputValue(trackingInput, summaryValue);

        // 7. Request Subject (customfield_10401)
        const reqSubjectSelect = dialog.querySelector(`#${CONSTANTS.REQUEST_SUBJECT_FIELD_ID}`);
        if (!isLiveQATest) {
            // In production, MUST remain unselected for operator review
            if (reqSubjectSelect) {
                reqSubjectSelect.value = '';
                reqSubjectSelect.dispatchEvent(new Event('change', { bubbles: true }));
            }
        } else {
            // For live QA test issue: select neutral internal request option if available
            if (reqSubjectSelect && reqSubjectSelect.value === '') {
                const internalOpt = Array.from(reqSubjectSelect.options).find(o => o.value === '10200' || o.text.includes('داخلی'));
                if (internalOpt) {
                    reqSubjectSelect.value = internalOpt.value;
                    reqSubjectSelect.dispatchEvent(new Event('change', { bubbles: true }));
                }
            }
        }

        // 8. Priority Invariant: Left untouched
 
        // 9. Focus Description Editor (Issue 3 Requirement: Initial focus must not remain on Assignee)
        let focusResult = null;
        try {
            focusResult = await focusDescriptionEditor(dialog);
        } catch (fErr) {
            console.warn('[GoJira Assistant] Non-fatal focus error:', fErr);
        }

        // 10. Submission Control
        if (!isLiveQATest) {
            // Production GoJira NEVER submits!
            return {
                success: true,
                mode: 'PREPARED_UNSUBMITTED',
                summary: summaryValue,
                storeName: payload.storeName,
                trackingNumber: payload.trackingNumber,
                project: CONSTANTS.PROJECT_NAME,
                issueType: CONSTANTS.ISSUE_TYPE_NAME,
                assignee: assignedAccount.fullName,
                labels: ['CX'],
                descriptionFocused: focusResult?.focused || false,
                message: 'فرم تیکت Jira در پروژه Platform با موفقیت آماده شد و جهت بررسی در انتظار شماست.'
            };
        }

        // ONE authorized QA test issue submission only
        const submitBtn = dialog.querySelector('#create-issue-submit');
        if (!submitBtn) {
            throw new Error('دکمه ثبت نهایی تیکت یافت نشد.');
        }

        submitBtn.click();
        await sleep(2500);

        // Extract created issue key if toast/link exists
        const issueLink = document.querySelector('.aui-message a[href*="/browse/"], #aui-flag-container a[href*="/browse/"]');
        const issueKey = issueLink ? issueLink.innerText.trim() : 'CREATED';

        return {
            success: true,
            mode: 'QA_TEST_ISSUE_SUBMITTED',
            issueKey,
            summary: summaryValue,
            assignee: authUser.fullName || authUser.username,
            project: CONSTANTS.PROJECT_NAME,
            issueType: CONSTANTS.ISSUE_TYPE_NAME
        };
    }

    const activeOperations = new Set();

    /**
     * Message Listener for Extension Commands
     */
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message.action === 'PING_JIRA_ASSISTANT') {
            const user = getAuthenticatedUser();
            sendResponse({ success: true, ...user });
            return true;
        }

        if (message.action === 'PREPARE_GOJIRA_ISSUE') {
            const opId = message.operationId;
            if (opId && activeOperations.has(opId)) {
                sendResponse({ success: true, mode: 'ALREADY_PREPARED', message: 'عملیات برای این برگه قبلاً آغاز شده است.' });
                return true;
            }
            if (opId) activeOperations.add(opId);

            prepareGoJiraIssue(message.payload, false)
                .then(res => sendResponse(res))
                .catch(err => {
                    console.error('[GoJira Assistant] Error preparing issue:', err);
                    sendResponse({ success: false, error: 'PREPARATION_ERROR', message: err.message });
                });
            return true;
        }

        if (message.action === 'EXECUTE_AUTHORIZED_QA_TEST_ISSUE') {
            const opId = message.operationId;
            if (opId && activeOperations.has(opId)) {
                sendResponse({ success: true, mode: 'ALREADY_PREPARED', message: 'عملیات برای این برگه قبلاً آغاز شده است.' });
                return true;
            }
            if (opId) activeOperations.add(opId);

            prepareGoJiraIssue(message.payload, true)
                .then(res => sendResponse(res))
                .catch(err => {
                    console.error('[GoJira Assistant] Error executing QA test issue:', err);
                    sendResponse({ success: false, error: 'QA_EXECUTION_ERROR', message: err.message });
                });
            return true;
        }
    });

    /**
     * Check storage for pending tasks on load
     * TAB ISOLATION GUARD:
     * Only dedicated GoJira tabs carrying a #gojira-op= hash are permitted to
     * consume pending tasks. Existing Jira tabs or manual drafts are NEVER touched.
     */
    async function checkPendingTask() {
        if (!chrome.storage || !chrome.storage.local) return;
        try {
            const opMatch = window.location.hash.match(/gojira-op=([^&]+)/);
            if (!opMatch) {
                // Not a GoJira-initiated tab! Leave existing drafts untouched!
                return;
            }

            const operationId = opMatch[1];
            if (activeOperations.has(operationId)) {
                return;
            }
            activeOperations.add(operationId);

            const opKey = `gojiraPendingTask_${operationId}`;
            const data = await chrome.storage.local.get([opKey, 'gojiraPendingTask']);
            const task = data[opKey] || data.gojiraPendingTask;

            if (task) {
                await chrome.storage.local.remove([opKey, 'gojiraPendingTask']);
                // Clean hash from URL without reloading page
                try {
                    history.replaceState(null, document.title, window.location.pathname + window.location.search);
                } catch (_) {}

                if (Date.now() - (task.timestamp || 0) < 60000) {
                    await prepareGoJiraIssue(task.payload, !!task.isLiveQATest);
                }
            }
        } catch (e) {
            console.warn('[GoJira Assistant] Error checking pending task:', e);
        }
    }

    checkPendingTask();
})();
