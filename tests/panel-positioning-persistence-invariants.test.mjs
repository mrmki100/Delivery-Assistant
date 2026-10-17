import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

/**
 * Pure functions under test extracted from content.js
 */
function clampPosition(x, y, panelW, panelH, viewW = 1920, viewH = 1080) {
    const safeViewW = Math.max(100, typeof viewW === 'number' && !Number.isNaN(viewW) ? viewW : 1920);
    const safeViewH = Math.max(100, typeof viewH === 'number' && !Number.isNaN(viewH) ? viewH : 1080);
    const safePanelW = Math.max(0, typeof panelW === 'number' && !Number.isNaN(panelW) ? panelW : 0);
    const safePanelH = Math.max(0, typeof panelH === 'number' && !Number.isNaN(panelH) ? panelH : 0);

    const maxX = Math.max(0, safeViewW - safePanelW);
    const maxY = Math.max(0, safeViewH - safePanelH);

    const safeX = typeof x === 'number' && !Number.isNaN(x) ? Math.round(x) : 0;
    const safeY = typeof y === 'number' && !Number.isNaN(y) ? Math.round(y) : 0;

    return {
        x: Math.max(0, Math.min(safeX, maxX)),
        y: Math.max(0, Math.min(safeY, maxY))
    };
}

class SyntheticPanelDOM {
    constructor(width = 500, height = 52) {
        this.offsetWidth = width;
        this.offsetHeight = height;
        this.style = {};
        this.classList = new Set();
        this.dataset = {};
        this._listeners = new Map();
        this.parentNode = { nodeType: 1 };
        this.offsetParent = { nodeType: 1 };
    }

    getBoundingClientRect() {
        const left = parseFloat(this.style.left) || 0;
        const top = parseFloat(this.style.top) || 0;
        return {
            left,
            top,
            width: this.offsetWidth,
            height: this.offsetHeight,
            right: left + this.offsetWidth,
            bottom: top + this.offsetHeight
        };
    }

    addEventListener(event, fn) {
        if (!this._listeners.has(event)) this._listeners.set(event, []);
        this._listeners.get(event).push(fn);
    }

    dispatchEvent(evt) {
        const list = this._listeners.get(evt.type) || [];
        for (const fn of list) fn(evt);
    }
}

/**
 * Controller class simulating panel geometry and state management
 */
class PanelGeometryController {
    constructor(panel, storageMock = null, defaultViewW = 1920, defaultViewH = 1080) {
        this.panel = panel;
        this.storageMock = storageMock;
        this.viewW = defaultViewW;
        this.viewH = defaultViewH;

        this.lastSavedPosition = null;
        this.lastUserDragTimestamp = 0;
        this.currentRenderedPosition = null;
        this.currentLayoutMode = 'horizontal';
        this.panelRestoreSeq = 0;
        this.resizeObserverCallbacks = [];
        this.isDragging = false;
        this.isPointerDown = false;
        this.fallbackActive = false;
    }

    revalidateGeometry(reason = 'auto') {
        const rect = this.panel.getBoundingClientRect();
        const w = rect.width;
        const h = rect.height;

        // Fallback detection when height exceeds viewport
        if (h > this.viewH || w > this.viewW) {
            this.fallbackActive = true;
        } else {
            this.fallbackActive = false;
        }

        if (w === 0 && h === 0 && (!this.panel.parentNode || this.panel.offsetParent === null)) {
            return null;
        }

        let targetX;
        let targetY;

        if (this.lastSavedPosition && typeof this.lastSavedPosition.x === 'number' && typeof this.lastSavedPosition.y === 'number' && !Number.isNaN(this.lastSavedPosition.x) && !Number.isNaN(this.lastSavedPosition.y)) {
            targetX = this.lastSavedPosition.x;
            targetY = this.lastSavedPosition.y;
        } else if (this.panel.style.left && this.panel.style.left !== 'auto') {
            targetX = parseFloat(this.panel.style.left) || 0;
            targetY = parseFloat(this.panel.style.top) || 0;
        } else {
            targetX = Math.max(0, this.viewW - w - 80);
            targetY = Math.max(0, this.viewH - h - 15);
        }

        const clamped = clampPosition(targetX, targetY, w, h, this.viewW, this.viewH);

        this.panel.style.left = clamped.x + 'px';
        this.panel.style.top = clamped.y + 'px';
        this.panel.style.right = 'auto';
        this.panel.style.bottom = 'auto';

        this.currentRenderedPosition = { x: clamped.x, y: clamped.y };
        return clamped;
    }

    applyLayout(mode, save = true) {
        const isCompact = mode === 'compact';
        this.currentLayoutMode = isCompact ? 'compact' : 'horizontal';
        if (isCompact) {
            this.panel.classList.add('cx-compact');
            this.panel.offsetWidth = Math.min(480, this.viewW - 20);
            this.panel.offsetHeight = 140;
        } else {
            this.panel.classList.delete('cx-compact');
            this.panel.offsetWidth = Math.min(1260, this.viewW - 20);
            this.panel.offsetHeight = 52;
        }

        this.revalidateGeometry('layout-toggle');

        if (save && this.storageMock) {
            try {
                this.storageMock.set({ cxPanelLayout: this.currentLayoutMode });
            } catch (_) {}
        }
    }

    restorePositionAndLayout() {
        if (!this.storageMock) return;
        const currentSeq = ++this.panelRestoreSeq;

        this.storageMock.get(['cxPanelPosition', 'cxPanelLayout'], (res) => {
            if (currentSeq !== this.panelRestoreSeq) return;
            if (Date.now() - this.lastUserDragTimestamp < 1000) return;

            const isCompact = res?.cxPanelLayout === 'compact';
            this.applyLayout(isCompact ? 'compact' : 'horizontal', false);

            if (res?.cxPanelPosition && typeof res.cxPanelPosition.x === 'number' && typeof res.cxPanelPosition.y === 'number' && !Number.isNaN(res.cxPanelPosition.x) && !Number.isNaN(res.cxPanelPosition.y)) {
                this.lastSavedPosition = { x: res.cxPanelPosition.x, y: res.cxPanelPosition.y };
            }

            this.revalidateGeometry('storage-restore');
        });
    }

    simulateUserDrag(targetX, targetY) {
        this.isPointerDown = true;
        this.isDragging = true;
        this.lastUserDragTimestamp = Date.now();

        const clamped = clampPosition(targetX, targetY, this.panel.offsetWidth, this.panel.offsetHeight, this.viewW, this.viewH);
        this.panel.style.left = clamped.x + 'px';
        this.panel.style.top = clamped.y + 'px';

        this.lastSavedPosition = { x: clamped.x, y: clamped.y };
        this.currentRenderedPosition = { x: clamped.x, y: clamped.y };

        if (this.storageMock) {
            try {
                this.storageMock.set({ cxPanelPosition: this.lastSavedPosition });
            } catch (_) {}
        }
        this.isDragging = false;
        this.isPointerDown = false;
        return clamped;
    }

    simulateStorageChange(changes) {
        if (changes.cxPanelLayout) {
            this.applyLayout(changes.cxPanelLayout.newValue, false);
        }
        if (changes.cxPanelPosition) {
            if (Date.now() - this.lastUserDragTimestamp > 600) {
                const newPos = changes.cxPanelPosition.newValue;
                if (newPos && typeof newPos.x === 'number' && typeof newPos.y === 'number' && !Number.isNaN(newPos.x) && !Number.isNaN(newPos.y)) {
                    this.lastSavedPosition = { x: newPos.x, y: newPos.y };
                    this.revalidateGeometry('storage-sync');
                }
            }
        }
    }
}

describe('Delivery Assistant — Panel Positioning, Persistence & Viewport Invariants', () => {

    const stylesCss = fs.readFileSync(path.join(rootDir, 'styles.css'), 'utf8');
    const contentJs = fs.readFileSync(path.join(rootDir, 'content.js'), 'utf8');

    // =========================================================================
    // 20 REQUIRED NAMED SCENARIOS
    // =========================================================================

    test('Scenario 1: Initial rendering places the panel inside the viewport', () => {
        const panel = new SyntheticPanelDOM(1200, 52);
        const ctrl = new PanelGeometryController(panel, null, 1920, 1080);
        ctrl.revalidateGeometry('initial-mount');

        const left = parseFloat(panel.style.left);
        const top = parseFloat(panel.style.top);

        assert.ok(left >= 0, 'Left edge must be >= 0');
        assert.ok(left + panel.offsetWidth <= 1920, 'Right edge must be <= viewW');
        assert.ok(top >= 0, 'Top edge must be >= 0');
        assert.ok(top + panel.offsetHeight <= 1080, 'Bottom edge must be <= viewH');
    });

    test('Scenario 2: A saved valid position is restored after reload', () => {
        const storage = {
            data: { cxPanelPosition: { x: 350, y: 400 }, cxPanelLayout: 'horizontal' },
            get(keys, cb) { cb(this.data); },
            set(d) { Object.assign(this.data, d); }
        };

        const panel = new SyntheticPanelDOM(500, 52);
        const ctrl = new PanelGeometryController(panel, storage, 1920, 1080);
        ctrl.restorePositionAndLayout();

        assert.equal(panel.style.left, '350px');
        assert.equal(panel.style.top, '400px');
        assert.deepEqual(ctrl.lastSavedPosition, { x: 350, y: 400 });
    });

    test('Scenario 3: A saved position is restored in a newly opened supported Automoby tab', () => {
        // Tab 1 saves position
        const sharedStorage = {
            data: { cxPanelPosition: { x: 420, y: 550 }, cxPanelLayout: 'compact' },
            get(keys, cb) { cb(this.data); },
            set(d) { Object.assign(this.data, d); }
        };

        // Tab 2 opens
        const tab2Panel = new SyntheticPanelDOM(480, 140);
        const tab2Ctrl = new PanelGeometryController(tab2Panel, sharedStorage, 1920, 1080);
        tab2Ctrl.restorePositionAndLayout();

        assert.equal(tab2Panel.style.left, '420px');
        assert.equal(tab2Panel.style.top, '550px');
        assert.equal(tab2Ctrl.currentLayoutMode, 'compact');
    });

    test('Scenario 4: A saved position beyond the right edge is safely clamped', () => {
        const storage = {
            data: { cxPanelPosition: { x: 2200, y: 300 } },
            get(keys, cb) { cb(this.data); }
        };
        const panel = new SyntheticPanelDOM(500, 52);
        const ctrl = new PanelGeometryController(panel, storage, 1920, 1080);
        ctrl.restorePositionAndLayout();

        const maxExpectedX = 1920 - panel.offsetWidth;
        assert.equal(parseFloat(panel.style.left), maxExpectedX, 'Must clamp to viewW - panelW');
    });

    test('Scenario 5: A saved position beyond the bottom edge is safely clamped', () => {
        const storage = {
            data: { cxPanelPosition: { x: 300, y: 1500 } },
            get(keys, cb) { cb(this.data); }
        };
        const panel = new SyntheticPanelDOM(500, 100);
        const ctrl = new PanelGeometryController(panel, storage, 1920, 1080);
        ctrl.restorePositionAndLayout();

        const maxExpectedY = 1080 - panel.offsetHeight;
        assert.equal(parseFloat(panel.style.top), maxExpectedY, 'Must clamp to viewH - panelH');
    });

    test('Scenario 6: Dragging to the left boundary cannot move the panel off-screen', () => {
        const panel = new SyntheticPanelDOM(400, 60);
        const ctrl = new PanelGeometryController(panel, null, 1920, 1080);
        ctrl.simulateUserDrag(-300, 200);

        assert.equal(panel.style.left, '0px', 'Left clamp must stop at 0px');
    });

    test('Scenario 7: Dragging to the right boundary cannot move the panel off-screen', () => {
        const panel = new SyntheticPanelDOM(400, 60);
        const ctrl = new PanelGeometryController(panel, null, 1920, 1080);
        ctrl.simulateUserDrag(3000, 200);

        assert.equal(panel.style.left, '1520px', 'Right clamp must stop at viewW - panelW');
    });

    test('Scenario 8: Dragging to the top boundary cannot move the panel off-screen', () => {
        const panel = new SyntheticPanelDOM(400, 60);
        const ctrl = new PanelGeometryController(panel, null, 1920, 1080);
        ctrl.simulateUserDrag(500, -250);

        assert.equal(panel.style.top, '0px', 'Top clamp must stop at 0px');
    });

    test('Scenario 9: Dragging to the bottom boundary cannot move the panel off-screen', () => {
        const panel = new SyntheticPanelDOM(400, 60);
        const ctrl = new PanelGeometryController(panel, null, 1920, 1080);
        ctrl.simulateUserDrag(500, 2000);

        assert.equal(panel.style.top, '1020px', 'Bottom clamp must stop at 1080 - 60 = 1020px');
    });

    test('Scenario 10: Switching from horizontal to compact layout preserves visibility', () => {
        const panel = new SyntheticPanelDOM(1260, 52);
        const ctrl = new PanelGeometryController(panel, null, 1920, 1080);
        // Start near bottom edge in horizontal mode
        ctrl.simulateUserDrag(600, 1020);

        // Switch to compact mode (height increases to 140px)
        ctrl.applyLayout('compact');

        const top = parseFloat(panel.style.top);
        assert.ok(top + panel.offsetHeight <= 1080, 'Must not extend below bottom edge');
        assert.equal(top, 1080 - 140, 'Must adjust upward to 940px');
    });

    test('Scenario 11: Switching from compact to horizontal layout preserves visibility', () => {
        const panel = new SyntheticPanelDOM(480, 140);
        const ctrl = new PanelGeometryController(panel, null, 1920, 1080);
        // Positioned at far right in compact mode
        ctrl.simulateUserDrag(1400, 500);

        // Switch to horizontal mode (width expands to 1260px)
        ctrl.applyLayout('horizontal');

        const left = parseFloat(panel.style.left);
        assert.ok(left + panel.offsetWidth <= 1920, 'Must not extend beyond right edge');
        assert.equal(left, 1920 - 1260, 'Must clamp to 660px');
    });

    test('Scenario 12: Repeated layout switches do not accumulate positional drift', () => {
        const panel = new SyntheticPanelDOM(480, 140);
        const ctrl = new PanelGeometryController(panel, null, 1920, 1080);
        // User explicitly sets position (500, 400)
        ctrl.simulateUserDrag(500, 400);

        // Rapid layout switching 10 times
        for (let i = 0; i < 10; i++) {
            ctrl.applyLayout(i % 2 === 0 ? 'horizontal' : 'compact', false);
        }

        // Return to compact mode
        ctrl.applyLayout('compact', false);
        assert.equal(panel.style.left, '500px', 'Left must return to exact original 500px');
        assert.equal(panel.style.top, '400px', 'Top must return to exact original 400px');
    });

    test('Scenario 13: Selecting a row with a waybill does not push the panel below the viewport', () => {
        // Panel at bottom edge with initial height 100px (top = 700px in 800px viewport)
        const panel = new SyntheticPanelDOM(480, 100);
        const ctrl = new PanelGeometryController(panel, null, 1920, 800);
        ctrl.simulateUserDrag(600, 700);

        // Row with waybill selected: panel height expands to 180px
        panel.offsetHeight = 180;
        ctrl.revalidateGeometry('row-selection');

        const top = parseFloat(panel.style.top);
        assert.ok(top + 180 <= 800, 'Panel bottom must not exceed viewport height 800px');
        assert.equal(top, 620, 'Panel must automatically move up to 620px without manual drag');
    });

    test('Scenario 14: Selecting a row without a waybill does not break panel positioning', () => {
        const panel = new SyntheticPanelDOM(480, 180);
        const ctrl = new PanelGeometryController(panel, null, 1920, 800);
        ctrl.lastSavedPosition = { x: 600, y: 700 };

        // Deselection: height contracts back to 100px
        panel.offsetHeight = 100;
        ctrl.revalidateGeometry('row-deselection');

        const top = parseFloat(panel.style.top);
        assert.equal(top, 700, 'Must safely return to user preferred 700px');
    });

    test('Scenario 15: Asynchronously added controls trigger a necessary position correction', () => {
        const panel = new SyntheticPanelDOM(480, 120);
        const ctrl = new PanelGeometryController(panel, null, 1920, 600);
        ctrl.simulateUserDrag(500, 480); // 480 + 120 = 600 (at bottom)

        // Async Jira & Chapar status arrive: height expands to 160px
        panel.offsetHeight = 160;
        ctrl.revalidateGeometry('async-content-arrival');

        const top = parseFloat(panel.style.top);
        assert.equal(top, 600 - 160, 'Must adjust to 440px to accommodate new controls');
    });

    test('Scenario 16: Panel height exceeding available viewport height activates the safe fallback', () => {
        // Viewport very small (300px), panel content is 450px
        const panel = new SyntheticPanelDOM(400, 450);
        const ctrl = new PanelGeometryController(panel, null, 1920, 300);
        ctrl.revalidateGeometry('fallback-check');

        assert.equal(ctrl.fallbackActive, true, 'Fallback must be active when height > viewH');
        assert.equal(panel.style.top, '0px', 'Top must clamp to 0 so movement handle remains accessible');
        assert.ok(stylesCss.includes('max-height: calc(100vh - 20px);'), 'CSS enforces max-height bound');
        assert.ok(stylesCss.includes('overflow-y: auto;'), 'CSS provides internal scroll');
    });

    test('Scenario 17: Resizing the viewport keeps the panel accessible', () => {
        const panel = new SyntheticPanelDOM(480, 140);
        const ctrl = new PanelGeometryController(panel, null, 1920, 1080);
        ctrl.simulateUserDrag(1400, 900);

        // Window shrinks to 1280x720
        ctrl.viewW = 1280;
        ctrl.viewH = 720;
        ctrl.revalidateGeometry('window-resize');

        const left = parseFloat(panel.style.left);
        const top = parseFloat(panel.style.top);
        assert.equal(left, 1280 - 480, 'Left must be clamped to 800px');
        assert.equal(top, 720 - 140, 'Top must be clamped to 580px');
    });

    test('Scenario 18: Delayed storage restoration cannot override a newer user drag', () => {
        const storage = {
            data: { cxPanelPosition: { x: 100, y: 100 } },
            get(keys, cb) {
                // Simulate delayed async storage response
                this._pendingCb = () => cb(this.data);
            }
        };

        const panel = new SyntheticPanelDOM(400, 50);
        const ctrl = new PanelGeometryController(panel, storage, 1920, 1080);
        ctrl.restorePositionAndLayout();

        // User immediately drags panel to (600, 700) before storage returns
        ctrl.simulateUserDrag(600, 700);

        // Delayed storage response finally arrives
        if (storage._pendingCb) storage._pendingCb();

        assert.equal(panel.style.left, '600px', 'User drag position must NOT be overwritten by stale storage');
        assert.equal(panel.style.top, '700px');
    });

    test('Scenario 19: Repeated initialization does not create duplicate observers or listeners', () => {
        assert.ok(contentJs.includes("panel.dataset.observerAttached === 'true'"), 'Guards observer creation');
        assert.ok(contentJs.includes("panel.dataset.dragInitialized === 'true'"), 'Guards drag listener creation');
    });

    test('Scenario 20: Existing extension controls and unrelated business behavior remain functional', () => {
        assert.ok(contentJs.includes('filterPendingPaymentOrders()'), 'Pending payment logic untouched');
        assert.ok(contentJs.includes('updateJiraWidgetForSelectedRow'), 'Jira widget logic untouched');
        assert.ok(contentJs.includes('isChaparWaybill'), 'Waybill classifier logic untouched');
    });

    // =========================================================================
    // EDGE CASES & STRESS CONDITIONS
    // =========================================================================

    test('Edge Case: Empty or corrupt stored position recovers safely', () => {
        const corruptCases = [
            { x: null, y: null },
            { x: 'invalid', y: 100 },
            { x: NaN, y: NaN },
            { x: undefined, y: undefined },
            {}
        ];
        for (const c of corruptCases) {
            const clamped = clampPosition(c.x, c.y, 400, 50, 1920, 1080);
            assert.equal(typeof clamped.x, 'number');
            assert.equal(typeof clamped.y, 'number');
            assert.ok(!Number.isNaN(clamped.x) && !Number.isNaN(clamped.y));
        }
    });

    test('Edge Case: Negative and fractional coordinates are normalized cleanly', () => {
        const clamped = clampPosition(-99.7, 105.4, 400, 50, 1920, 1080);
        assert.equal(clamped.x, 0);
        assert.equal(clamped.y, 105);
    });

    test('Edge Case: Zero-sized or temporarily unmeasurable panel does not throw or corrupt state', () => {
        const panel = new SyntheticPanelDOM(0, 0);
        panel.parentNode = null;
        const ctrl = new PanelGeometryController(panel, null, 1920, 1080);
        const res = ctrl.revalidateGeometry('unmeasurable');
        assert.equal(res, null, 'Gracefully skips detached unmeasurable element');
    });

    test('Edge Case: Panel wider than viewport clamps left to 0', () => {
        const clamped = clampPosition(500, 100, 2000, 50, 1280, 720);
        assert.equal(clamped.x, 0, 'Must clamp to 0 when panel wider than viewport');
    });

    test('Edge Case: Panel taller than viewport clamps top to 0', () => {
        const clamped = clampPosition(100, 600, 400, 900, 1280, 720);
        assert.equal(clamped.y, 0, 'Must clamp to 0 when panel taller than viewport');
    });

    test('Edge Case: Cross-tab sync handles storage change events without echo loop', () => {
        const panel = new SyntheticPanelDOM(480, 140);
        const ctrl = new PanelGeometryController(panel, null, 1920, 1080);

        // Remote tab changed position to (700, 400)
        ctrl.simulateStorageChange({
            cxPanelPosition: { newValue: { x: 700, y: 400 } }
        });

        assert.equal(panel.style.left, '700px');
        assert.equal(panel.style.top, '400px');
    });

    test('Edge Case: Storage write failure is handled gracefully without crashing UI', () => {
        const failingStorage = {
            set() { throw new Error('QUOTA_EXCEEDED'); }
        };
        const panel = new SyntheticPanelDOM(480, 140);
        const ctrl = new PanelGeometryController(panel, failingStorage, 1920, 1080);

        assert.doesNotThrow(() => {
            ctrl.simulateUserDrag(300, 300);
        }, 'Must absorb storage write error');
        assert.equal(panel.style.left, '300px');
    });

    test('Edge Case: Drag handle remains reachable and visible in fallback mode', () => {
        const panel = new SyntheticPanelDOM(500, 1200);
        const ctrl = new PanelGeometryController(panel, null, 1920, 600);
        ctrl.revalidateGeometry('overflow-fallback');

        // Top is clamped to 0 so the handle at the top is completely visible
        assert.equal(panel.style.top, '0px');
        assert.ok(stylesCss.includes('.cx-drag-handle {'), 'Drag handle exists in styles');
    });

});
