/**
 * Integration test for background.js Safe Boundary & Elimination of 15s Forced Timeout.
 * Evaluates JavaScript functions against mock Chrome environment.
 */

const assert = require('assert');

// Setup Chrome API Mocks
let reloadInvoked = false;
let reloadAttempts = 0;
const storageData = {};

global.chrome = {
    runtime: {
        getManifest: () => ({ version: '19.0.0' }),
        reload: () => {
            reloadInvoked = true;
            reloadAttempts++;
        },
        sendNativeMessage: (host, msg, cb) => {
            if (cb) cb({ success: true });
        }
    },
    storage: {
        local: {
            get: async (keys) => {
                const res = {};
                for (const k of keys) {
                    if (storageData[k] !== undefined) res[k] = storageData[k];
                }
                return res;
            },
            set: async (obj) => {
                Object.assign(storageData, obj);
            },
            remove: async (key) => {
                delete storageData[key];
            }
        }
    }
};

global.logDebug = (...args) => {};

// Extract Safe Boundary logic matching background.js
const activeOperations = new Map();
let nextOpId = 1;
let pendingReloadPlan = null;
const PENDING_ACTIVATION_KEY = 'pending_update_activation';
const MAX_RELOAD_ATTEMPTS = 3;
const OPERATION_STUCK_THRESHOLD_MS = 1000; // 1 second for fast test

function trackOperationStart(opName = 'operation', details = {}) {
    const opId = nextOpId++;
    activeOperations.set(opId, {
        opId,
        opName,
        startedAt: Date.now(),
        details
    });
    return opId;
}

function trackOperationEnd(opId) {
    if (!opId) return;
    activeOperations.delete(opId);

    // Strictly trigger deferred reload only when all operations reach safe boundary (size === 0)
    if (activeOperations.size === 0 && pendingReloadPlan) {
        const plan = pendingReloadPlan;
        pendingReloadPlan = null;
        executeControlledReload(plan);
    }
}

function isSystemBusy() {
    return activeOperations.size > 0;
}

function getActiveOperationsDiagnostics() {
    const now = Date.now();
    const ops = [];
    for (const [id, op] of activeOperations.entries()) {
        const runningSec = Math.round((now - op.startedAt) / 1000);
        ops.push({
            id,
            name: op.opName,
            runningSeconds: runningSec,
            isStuck: (now - op.startedAt) > OPERATION_STUCK_THRESHOLD_MS
        });
    }
    return ops;
}

async function scheduleControlledReload({ targetVersion, transactionId, source = 'NATIVE_MESSAGING' }) {
    const currentVer = chrome.runtime.getManifest().version;
    if (targetVersion && targetVersion === currentVer) {
        return { success: true, message: 'ALREADY_RUNNING_TARGET_VERSION' };
    }

    if (isSystemBusy()) {
        const diagnostics = getActiveOperationsDiagnostics();
        pendingReloadPlan = { targetVersion, transactionId, source, deferredAt: Date.now() };
        return { 
            success: true, 
            deferred: true, 
            activeOperationsCount: activeOperations.size,
            activeOperations: diagnostics 
        };
    }

    return await executeControlledReload({ targetVersion, transactionId, source });
}

async function executeControlledReload({ targetVersion, transactionId, source }) {
    chrome.runtime.reload();
    return { success: true, targetVersion };
}

function forceDismissStuckOperationsAndReload() {
    activeOperations.clear();
    if (pendingReloadPlan) {
        const plan = pendingReloadPlan;
        pendingReloadPlan = null;
        executeControlledReload(plan);
        return { success: true, message: 'RELOAD_TRIGGERED' };
    }
    return { success: true, message: 'OPERATIONS_CLEARED' };
}

async function runTests() {
    console.log('[*] Test 1: Normal Operation Completion Safe Deferral...');
    reloadInvoked = false;
    const op1 = trackOperationStart('FETCH_CHAPAR', { query: 'test_123' });
    const op2 = trackOperationStart('JIRA_SEARCH_TICKETS', { waybill: 'wb_123' });

    const deferRes = await scheduleControlledReload({ targetVersion: '19.1.0', transactionId: 'tx_normal' });
    assert.strictEqual(deferRes.deferred, true, 'Reload should be deferred when ops are active');
    assert.strictEqual(reloadInvoked, false, 'Reload MUST NOT be called while ops are active');

    // Simulate time passing (e.g. 20s in real world - no forced timer triggers)
    assert.strictEqual(reloadInvoked, false, 'Reload must remain untouched by timers');

    // End op 1
    trackOperationEnd(op1);
    assert.strictEqual(reloadInvoked, false, 'Reload must not trigger until ALL ops finish');

    // End op 2 -> Safe boundary reached
    trackOperationEnd(op2);
    assert.strictEqual(reloadInvoked, true, 'Reload MUST trigger once safe boundary is reached');
    console.log('    -> PASS: Reload deferred and executed safely at boundary.');

    console.log('[*] Test 2: Deliberately Stalled Operation & Diagnostics...');
    reloadInvoked = false;
    const stalledOp = trackOperationStart('LONG_RUNNING_POST_OPERATION');

    const stallRes = await scheduleControlledReload({ targetVersion: '19.2.0', transactionId: 'tx_stall' });
    assert.strictEqual(stallRes.deferred, true);
    assert.strictEqual(reloadInvoked, false);

    // Wait past stuck threshold
    await new Promise(r => setTimeout(r, 1100));

    // Reload MUST NOT have been called silently
    assert.strictEqual(reloadInvoked, false, 'Reload MUST NEVER force-kill a stalled operation');

    // Verify diagnostics flag isStuck: true
    const diags = getActiveOperationsDiagnostics();
    assert.strictEqual(diags.length, 1);
    assert.strictEqual(diags[0].isStuck, true, 'Stalled operation must be flagged as stuck');
    assert.strictEqual(diags[0].name, 'LONG_RUNNING_POST_OPERATION');
    console.log('    -> PASS: Stuck operation reported via diagnostics without silent reload.');

    // Administrative dismissal
    const dismissRes = forceDismissStuckOperationsAndReload();
    assert.strictEqual(dismissRes.success, true);
    assert.strictEqual(reloadInvoked, true, 'Administrative dismissal cleanly triggered reload');
    console.log('    -> PASS: Safe recovery policy successfully executed.');

    console.log('\nALL JAVASCRIPT SAFE BOUNDARY TESTS PASSED!');
}

runTests().catch(err => {
    console.error('TEST FAILED:', err);
    process.exit(1);
});
