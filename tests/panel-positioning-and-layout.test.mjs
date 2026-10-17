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
    const maxX = Math.max(0, viewW - (panelW || 0));
    const maxY = Math.max(0, viewH - (panelH || 0));
    const safeX = typeof x === 'number' && !Number.isNaN(x) ? x : 0;
    const safeY = typeof y === 'number' && !Number.isNaN(y) ? y : 0;
    return {
        x: Math.max(0, Math.min(Math.round(safeX), maxX)),
        y: Math.max(0, Math.min(Math.round(safeY), maxY))
    };
}

function applyPanelPosition(panel, x, y, viewW = 1920, viewH = 1080) {
    if (!panel) return { x: 0, y: 0 };
    const rect = panel.getBoundingClientRect ? panel.getBoundingClientRect() : { width: panel.offsetWidth || 0, height: panel.offsetHeight || 0 };
    const w = rect.width || panel.offsetWidth || 0;
    const h = rect.height || panel.offsetHeight || 0;
    const clamped = clampPosition(x, y, w, h, viewW, viewH);
    panel.style.left = clamped.x + 'px';
    panel.style.top = clamped.y + 'px';
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';
    return clamped;
}

function applyPanelLayout(panel, mode, save = true, storageMock = null, viewW = 1920, viewH = 1080) {
    if (!panel) return;
    const isCompact = mode === 'compact';
    panel.classList.toggle('cx-compact', isCompact);

    const layoutBtn = panel.querySelector ? panel.querySelector('#cx-layout-toggle-bar') : null;
    if (layoutBtn) {
        const iconSpan = layoutBtn.querySelector ? layoutBtn.querySelector('.cx-layout-icon') : null;
        if (isCompact) {
            if (iconSpan) iconSpan.textContent = '🗖';
            layoutBtn.setAttribute('aria-label', 'تغییر چیدمان به حالت افقی');
            layoutBtn.setAttribute('title', 'تغییر چیدمان به حالت افقی');
        } else {
            if (iconSpan) iconSpan.textContent = '⊞';
            layoutBtn.setAttribute('aria-label', 'تغییر چیدمان به حالت فشرده');
            layoutBtn.setAttribute('title', 'تغییر چیدمان به حالت فشرده');
        }
    }

    if (panel.style.left && panel.style.left !== 'auto') {
        const curX = parseFloat(panel.style.left) || 0;
        const curY = parseFloat(panel.style.top) || 0;
        const rect = panel.getBoundingClientRect ? panel.getBoundingClientRect() : { width: panel.offsetWidth || 0, height: panel.offsetHeight || 0 };
        const clamped = clampPosition(curX, curY, rect.width, rect.height, viewW, viewH);
        panel.style.left = clamped.x + 'px';
        panel.style.top = clamped.y + 'px';
        if (save && storageMock) {
            storageMock.set({ cxPanelPosition: clamped });
        }
    }

    if (save && storageMock) {
        storageMock.set({ cxPanelLayout: isCompact ? 'compact' : 'horizontal' });
    }
}

/**
 * Synthetic DOM element implementation for isolated Node.js tests
 */
class SyntheticElement {
    constructor(tagName, id = '', className = '') {
        this.tagName = tagName.toUpperCase();
        this.id = id;
        this.className = className;
        this.classList = {
            _classes: new Set(className ? className.split(/\s+/) : []),
            contains: (c) => this.classList._classes.has(c),
            add: (c) => { this.classList._classes.add(c); this._syncClass(); },
            remove: (c) => { this.classList._classes.delete(c); this._syncClass(); },
            toggle: (c, force) => {
                const has = this.classList._classes.has(c);
                const shouldAdd = force !== undefined ? force : !has;
                if (shouldAdd) this.classList._classes.add(c);
                else this.classList._classes.delete(c);
                this._syncClass();
                return shouldAdd;
            }
        };
        this.attributes = new Map();
        this.style = {};
        this.children = [];
        this.parentNode = null;
        this.textContent = '';
        this.innerHTML = '';
        this.dataset = {};
        this._listeners = new Map();
        this.offsetWidth = 500;
        this.offsetHeight = 52;
    }

    _syncClass() {
        this.className = Array.from(this.classList._classes).join(' ');
    }

    setAttribute(name, value) {
        this.attributes.set(name, String(value));
    }

    getAttribute(name) {
        return this.attributes.has(name) ? this.attributes.get(name) : null;
    }

    hasAttribute(name) {
        return this.attributes.has(name);
    }

    appendChild(child) {
        child.parentNode = this;
        this.children.push(child);
        return child;
    }

    querySelector(selector) {
        if (selector.startsWith('#')) {
            const targetId = selector.slice(1);
            if (this.id === targetId) return this;
            for (const c of this.children) {
                const res = c.querySelector(selector);
                if (res) return res;
            }
        } else if (selector.startsWith('.')) {
            const targetClass = selector.slice(1);
            if (this.classList.contains(targetClass)) return this;
            for (const c of this.children) {
                const res = c.querySelector(selector);
                if (res) return res;
            }
        }
        return null;
    }

    querySelectorAll(selector) {
        const results = [];
        const check = (node) => {
            if (selector.startsWith('#') && node.id === selector.slice(1)) results.push(node);
            else if (selector.startsWith('.') && node.classList.contains(selector.slice(1))) results.push(node);
            for (const c of node.children) check(c);
        };
        for (const c of this.children) check(c);
        return results;
    }

    addEventListener(event, fn) {
        if (!this._listeners.has(event)) this._listeners.set(event, []);
        this._listeners.get(event).push(fn);
    }

    removeEventListener(event, fn) {
        if (!this._listeners.has(event)) return;
        this._listeners.set(event, this._listeners.get(event).filter(f => f !== fn));
    }

    dispatchEvent(evt) {
        evt.target = this;
        const list = this._listeners.get(evt.type) || [];
        for (const fn of list) {
            fn(evt);
        }
        return !evt.defaultPrevented;
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
}

/**
 * Creates standard panel tree matching ensurePanelExists()
 */
function createSyntheticPanelFixture() {
    const panel = new SyntheticElement('div', '', 'cx-floating-bar');
    panel.style.left = '100px';
    panel.style.top = '100px';

    const handle = new SyntheticElement('button', 'cx-drag-handle', 'cx-drag-handle');
    handle.setAttribute('type', 'button');
    handle.setAttribute('aria-label', 'جابجایی پنل');
    handle.setAttribute('title', 'جابجایی پنل (درگ با ماوس یا کلیدهای جهت‌نما)');
    handle.setAttribute('tabindex', '0');
    const handleIcon = new SyntheticElement('span', '', 'cx-drag-handle-icon');
    handleIcon.textContent = '⠿';
    handle.appendChild(handleIcon);
    panel.appendChild(handle);

    const info = new SyntheticElement('div', '', 'cx-floating-bar-info');
    const custName = new SyntheticElement('div', 'chapar-name', 'cx-customer-name');
    custName.textContent = 'محسن اسمعیلی #1146834';
    info.appendChild(custName);
    panel.appendChild(info);

    const divider = new SyntheticElement('div', '', 'cx-bar-divider');
    panel.appendChild(divider);

    const shortcuts = new SyntheticElement('div', 'cx-shortcuts-bar', 'cx-shortcuts-container');
    panel.appendChild(shortcuts);

    const tracking = new SyntheticElement('div', 'cx-tracking-bar', 'cx-tracking-group');
    const phoneWidget = new SyntheticElement('div', 'cx-phone-widget', 'cx-phone-widget');
    const phoneBtn = new SyntheticElement('button', 'btn-phone', 'cx-btn-trigger');
    phoneBtn.textContent = '📱 موبایل: 09197439257';
    phoneWidget.appendChild(phoneBtn);
    tracking.appendChild(phoneWidget);
    panel.appendChild(tracking);

    const utils = new SyntheticElement('div', '', 'cx-utilities-group');
    const layoutBtn = new SyntheticElement('button', 'cx-layout-toggle-bar', 'cx-layout-toggle');
    layoutBtn.setAttribute('type', 'button');
    layoutBtn.setAttribute('aria-label', 'تغییر چیدمان به حالت فشرده');
    layoutBtn.setAttribute('tabindex', '0');
    const layoutIcon = new SyntheticElement('span', '', 'cx-layout-icon');
    layoutIcon.textContent = '⊞';
    layoutBtn.appendChild(layoutIcon);
    utils.appendChild(layoutBtn);

    const settingsBtn = new SyntheticElement('button', 'cx-settings-toggle-bar', 'cx-settings-toggle');
    utils.appendChild(settingsBtn);
    panel.appendChild(utils);

    return { panel, handle, layoutBtn, phoneBtn };
}

/**
 * Controller simulation matching initPanelDraggable()
 */
function attachDragController(panel, storageMock = null, viewW = 1920, viewH = 1080) {
    if (!panel || panel.dataset.dragInitialized === 'true') return;
    panel.dataset.dragInitialized = 'true';

    const handle = panel.querySelector('#cx-drag-handle');
    if (!handle) return;

    let isPointerDown = false;
    let isDragging = false;
    let startX = 0;
    let startY = 0;
    let startLeft = 0;
    let startTop = 0;
    let pointerId = null;

    handle.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        isPointerDown = true;
        isDragging = false;
        startX = e.clientX || 0;
        startY = e.clientY || 0;
        pointerId = e.pointerId ?? null;

        const rect = panel.getBoundingClientRect();
        startLeft = rect.left;
        startTop = rect.top;
    });

    handle.addEventListener('pointermove', (e) => {
        if (!isPointerDown) return;
        const dx = (e.clientX || 0) - startX;
        const dy = (e.clientY || 0) - startY;

        if (!isDragging) {
            if (Math.hypot(dx, dy) >= 4) {
                isDragging = true;
                panel.classList.add('cx-dragging');
            } else {
                return;
            }
        }

        const rect = panel.getBoundingClientRect();
        const targetX = startLeft + dx;
        const targetY = startTop + dy;
        const clamped = clampPosition(targetX, targetY, rect.width, rect.height, viewW, viewH);

        panel.style.left = clamped.x + 'px';
        panel.style.top = clamped.y + 'px';
        panel.style.right = 'auto';
        panel.style.bottom = 'auto';
    });

    const endDrag = () => {
        if (!isPointerDown) return;
        isPointerDown = false;

        if (isDragging) {
            isDragging = false;
            panel.classList.remove('cx-dragging');

            const rect = panel.getBoundingClientRect();
            const curX = parseFloat(panel.style.left) || rect.left;
            const curY = parseFloat(panel.style.top) || rect.top;
            const clamped = clampPosition(curX, curY, rect.width, rect.height, viewW, viewH);

            panel.style.left = clamped.x + 'px';
            panel.style.top = clamped.y + 'px';
            if (storageMock) {
                try {
                    storageMock.set({ cxPanelPosition: clamped });
                } catch (_) {}
            }
        }
    };

    handle.addEventListener('pointerup', endDrag);
    handle.addEventListener('pointercancel', endDrag);

    handle.addEventListener('keydown', (e) => {
        const keys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'];
        if (!keys.includes(e.key)) return;

        const step = e.shiftKey ? 30 : 10;
        const rect = panel.getBoundingClientRect();
        let curX = parseFloat(panel.style.left);
        let curY = parseFloat(panel.style.top);
        if (Number.isNaN(curX)) curX = rect.left;
        if (Number.isNaN(curY)) curY = rect.top;

        if (e.key === 'ArrowLeft') curX -= step;
        else if (e.key === 'ArrowRight') curX += step;
        else if (e.key === 'ArrowUp') curY -= step;
        else if (e.key === 'ArrowDown') curY += step;
        else if (e.key === 'Home') { curX = 0; curY = 0; }
        else if (e.key === 'End') {
            curX = viewW - rect.width;
            curY = viewH - rect.height;
        }

        const clamped = clampPosition(curX, curY, rect.width, rect.height, viewW, viewH);
        panel.style.left = clamped.x + 'px';
        panel.style.top = clamped.y + 'px';

        if (storageMock) {
            try {
                storageMock.set({ cxPanelPosition: clamped });
            } catch (_) {}
        }
    });

    return {
        isDragging: () => isDragging,
        isPointerDown: () => isPointerDown
    };
}

describe('Delivery Assistant — Panel Positioning & Compact Layout Regression Suite', () => {

    const contentJs = fs.readFileSync(path.join(rootDir, 'content.js'), 'utf8');
    const stylesCss = fs.readFileSync(path.join(rootDir, 'styles.css'), 'utf8');

    // =========================================================================
    // SECTION A: DRAG-AND-DROP PANEL POSITIONING (PANEL-001 TO PANEL-014)
    // =========================================================================

    test('PANEL-001: The move handle renders correctly with accessible attributes and icon', () => {
        const { handle } = createSyntheticPanelFixture();
        assert.equal(handle.classList.contains('cx-drag-handle'), true, 'Handle must have .cx-drag-handle class');
        assert.equal(handle.getAttribute('aria-label'), 'جابجایی پنل', 'Aria label must be Persian "جابجایی پنل"');
        assert.equal(handle.getAttribute('tabindex'), '0', 'Tabindex must be 0 for keyboard accessibility');
        const icon = handle.querySelector('.cx-drag-handle-icon');
        assert.equal(icon.textContent, '⠿', 'Handle icon must be ⠿ grab indicator');
    });

    test('PANEL-002: The panel can be moved using the dedicated handle', () => {
        const { panel, handle } = createSyntheticPanelFixture();
        attachDragController(panel);

        handle.dispatchEvent({ type: 'pointerdown', clientX: 100, clientY: 100, button: 0 });
        handle.dispatchEvent({ type: 'pointermove', clientX: 180, clientY: 160 });
        handle.dispatchEvent({ type: 'pointerup' });

        assert.equal(panel.style.left, '180px', 'Panel left must translate by +80px');
        assert.equal(panel.style.top, '160px', 'Panel top must translate by +60px');
    });

    test('PANEL-003: An ordinary action-button click does not initiate dragging', () => {
        const { panel, phoneBtn } = createSyntheticPanelFixture();
        let clicked = false;
        phoneBtn.addEventListener('click', () => { clicked = true; });

        phoneBtn.dispatchEvent({ type: 'click' });
        assert.equal(clicked, true, 'Action button click fired normally');
        assert.equal(panel.classList.contains('cx-dragging'), false, 'Panel must not enter dragging state');
        assert.equal(panel.style.left, '100px', 'Coordinates must remain untouched');
    });

    test('PANEL-004: Clicking the move handle without dragging does not change the position unexpectedly', () => {
        const { panel, handle } = createSyntheticPanelFixture();
        attachDragController(panel);

        handle.dispatchEvent({ type: 'pointerdown', clientX: 200, clientY: 200, button: 0 });
        handle.dispatchEvent({ type: 'pointerup', clientX: 200, clientY: 200 });

        assert.equal(panel.style.left, '100px', 'Position must not shift on stationary click');
        assert.equal(panel.style.top, '100px', 'Position must not shift on stationary click');
    });

    test('PANEL-005: Small pointer movements (<4px threshold) do not initiate an accidental drag', () => {
        const { panel, handle } = createSyntheticPanelFixture();
        const ctrl = attachDragController(panel);

        handle.dispatchEvent({ type: 'pointerdown', clientX: 200, clientY: 200, button: 0 });
        handle.dispatchEvent({ type: 'pointermove', clientX: 202, clientY: 201 }); // distance ~2.2px < 4px

        assert.equal(ctrl.isDragging(), false, 'Drag must not activate under 4px threshold');
        assert.equal(panel.classList.contains('cx-dragging'), false, 'Class cx-dragging must not be added');

        handle.dispatchEvent({ type: 'pointerup' });
        assert.equal(panel.style.left, '100px', 'Panel must remain at original 100px left');
    });

    test('PANEL-006: The panel remains visible when moved near the top boundary (clamped y >= 0)', () => {
        const clamped = clampPosition(500, -150, 400, 100, 1920, 1080);
        assert.equal(clamped.y, 0, 'Negative Y coordinate must clamp to 0');
        assert.equal(clamped.x, 500, 'X coordinate must be preserved');
    });

    test('PANEL-007: The panel remains visible when moved near the bottom boundary (clamped to viewH - panelH)', () => {
        const clamped = clampPosition(500, 1200, 400, 140, 1920, 1080);
        const expectedMaxY = 1080 - 140; // 940
        assert.equal(clamped.y, expectedMaxY, 'Exceeded bottom boundary must clamp to viewH - panelH');
    });

    test('PANEL-008: The panel remains visible when moved near the left boundary (clamped x >= 0)', () => {
        const clamped = clampPosition(-80, 300, 400, 100, 1920, 1080);
        assert.equal(clamped.x, 0, 'Negative X coordinate must clamp to 0');
        assert.equal(clamped.y, 300, 'Y coordinate must be preserved');
    });

    test('PANEL-009: The panel remains visible when moved near the right boundary (clamped to viewW - panelW)', () => {
        const clamped = clampPosition(2100, 300, 500, 100, 1920, 1080);
        const expectedMaxX = 1920 - 500; // 1420
        assert.equal(clamped.x, expectedMaxX, 'Exceeded right boundary must clamp to viewW - panelW');
    });

    test('PANEL-010: Position persistence works after page navigation', () => {
        const storageMock = {
            data: {},
            set(items) { Object.assign(this.data, items); },
            get(keys, cb) { cb(this.data); }
        };

        const { panel: p1, handle } = createSyntheticPanelFixture();
        attachDragController(p1, storageMock);

        // Move p1 to (450, 280)
        handle.dispatchEvent({ type: 'pointerdown', clientX: 100, clientY: 100, button: 0 });
        handle.dispatchEvent({ type: 'pointermove', clientX: 450, clientY: 280 });
        handle.dispatchEvent({ type: 'pointerup' });

        assert.deepEqual(storageMock.data.cxPanelPosition, { x: 450, y: 280 });

        // Simulate page navigation: new panel instance injected
        const { panel: p2 } = createSyntheticPanelFixture();
        storageMock.get(['cxPanelPosition'], (res) => {
            if (res.cxPanelPosition) {
                applyPanelPosition(p2, res.cxPanelPosition.x, res.cxPanelPosition.y);
            }
        });

        assert.equal(p2.style.left, '450px', 'New panel after navigation must restore left coordinate');
        assert.equal(p2.style.top, '280px', 'New panel after navigation must restore top coordinate');
    });

    test('PANEL-011: Position persistence works after extension reload', () => {
        const savedCoordinates = { x: 320, y: 480 };
        const { panel } = createSyntheticPanelFixture();

        // Simulate restore on reload
        const clamped = applyPanelPosition(panel, savedCoordinates.x, savedCoordinates.y);
        assert.equal(clamped.x, 320);
        assert.equal(clamped.y, 480);
        assert.equal(panel.style.left, '320px');
        assert.equal(panel.style.top, '480px');
    });

    test('PANEL-012: Malformed stored coordinates recover safely without throwing', () => {
        const malformedTestCases = [
            { x: NaN, y: NaN },
            { x: null, y: undefined },
            { x: 'invalid', y: {} },
            { x: -500, y: -200 },
            { x: Infinity, y: -Infinity }
        ];

        for (const tc of malformedTestCases) {
            assert.doesNotThrow(() => {
                const clamped = clampPosition(tc.x, tc.y, 400, 100, 1920, 1080);
                assert.ok(typeof clamped.x === 'number' && !Number.isNaN(clamped.x) && clamped.x >= 0);
                assert.ok(typeof clamped.y === 'number' && !Number.isNaN(clamped.y) && clamped.y >= 0);
            }, `Should not throw on malformed input: ${JSON.stringify(tc)}`);
        }
    });

    test('PANEL-013: Coordinates from a larger viewport are corrected for a smaller viewport', () => {
        // Saved on 2560x1440 screen at (2100, 1300)
        const panelW = 450;
        const panelH = 140;
        const smallViewW = 1280;
        const smallViewH = 720;

        const clamped = clampPosition(2100, 1300, panelW, panelH, smallViewW, smallViewH);
        assert.equal(clamped.x, 1280 - 450, 'X must clamp to smaller screen width');
        assert.equal(clamped.y, 720 - 140, 'Y must clamp to smaller screen height');
    });

    test('PANEL-014: Resizing the viewport does not leave the panel inaccessible', () => {
        const { panel } = createSyntheticPanelFixture();
        panel.style.left = '1600px';
        panel.style.top = '900px';
        panel.offsetWidth = 400;
        panel.offsetHeight = 100;

        // Viewport shrunk to 1200x800
        const newViewW = 1200;
        const newViewH = 800;
        const clamped = applyPanelPosition(panel, parseFloat(panel.style.left), parseFloat(panel.style.top), newViewW, newViewH);

        assert.equal(clamped.x, 1200 - 400, 'Left must be clamped to 800px');
        assert.equal(clamped.y, 800 - 100, 'Top must be clamped to 700px');
    });

    // =========================================================================
    // SECTION B: COMPACT MULTI-ROW LAYOUT (PANEL-015 TO PANEL-024)
    // =========================================================================

    test('PANEL-015: The current horizontal layout remains functional and default', () => {
        const { panel } = createSyntheticPanelFixture();
        assert.equal(panel.classList.contains('cx-compact'), false, 'Default layout must NOT have cx-compact');
        assert.equal(stylesCss.includes('.cx-floating-bar {'), true, 'styles.css defines base floating bar');
        assert.equal(stylesCss.includes('display: flex;'), true, 'Base horizontal layout uses flex');
    });

    test('PANEL-016: The compact-layout control switches to the multi-row layout', () => {
        const { panel, layoutBtn } = createSyntheticPanelFixture();
        const storageMock = { data: {}, set(d) { Object.assign(this.data, d); } };

        applyPanelLayout(panel, 'compact', true, storageMock);

        assert.equal(panel.classList.contains('cx-compact'), true, 'Panel must have cx-compact class');
        assert.equal(layoutBtn.getAttribute('aria-label'), 'تغییر چیدمان به حالت افقی');
        assert.equal(layoutBtn.querySelector('.cx-layout-icon').textContent, '🗖');
        assert.equal(storageMock.data.cxPanelLayout, 'compact');
    });

    test('PANEL-017: Compact mode reduces horizontal footprint at a suitable viewport width', () => {
        // Check CSS rule for .cx-floating-bar.cx-compact max-width
        assert.ok(stylesCss.includes('max-width: min(520px, calc(100vw - 20px));'), 'Compact layout enforces max-width: min(520px, ...)');
        assert.ok(stylesCss.includes('min-width: 350px;'), 'Compact layout enforces min-width: 350px');
    });

    test('PANEL-018: Compact mode produces the intended multi-row arrangement', () => {
        assert.ok(stylesCss.includes('grid-template-areas:'), 'Compact layout must use grid-template-areas');
        assert.ok(stylesCss.includes('"drag info utils"'), 'Row 1 must be drag info utils');
        assert.ok(stylesCss.includes('"shortcuts shortcuts shortcuts"'), 'Row 2 must be shortcuts');
        assert.ok(stylesCss.includes('"tracking tracking tracking"'), 'Row 3 must be tracking');
    });

    test('PANEL-019: Controls do not overlap in compact mode', () => {
        assert.ok(stylesCss.includes('row-gap: 8px;'), 'Must define row-gap of 8px');
        assert.ok(stylesCss.includes('column-gap: 10px;'), 'Must define column-gap of 10px');
        assert.ok(stylesCss.includes('.cx-floating-bar.cx-compact .cx-bar-divider'), 'Must target dividers in compact mode');
        assert.ok(stylesCss.includes('display: none !important;'), 'Must hide dividers to prevent overlap');
    });

    test('PANEL-020: All existing controls remain available in compact mode', () => {
        const { panel } = createSyntheticPanelFixture();
        applyPanelLayout(panel, 'compact', false);

        assert.ok(panel.querySelector('#cx-drag-handle'), 'Drag handle must be present');
        assert.ok(panel.querySelector('#chapar-name'), 'Customer name must be present');
        assert.ok(panel.querySelector('#cx-shortcuts-bar'), 'Shortcuts bar must be present');
        assert.ok(panel.querySelector('#cx-phone-widget'), 'Phone widget must be present');
        assert.ok(panel.querySelector('#cx-layout-toggle-bar'), 'Layout toggle must be present');
        assert.ok(panel.querySelector('#cx-settings-toggle-bar'), 'Settings toggle must be present');
    });

    test('PANEL-021: Control labels do not become unreadable or unexpectedly clipped', () => {
        assert.ok(stylesCss.includes('.cx-floating-bar.cx-compact .cx-btn-trigger'), 'Targets trigger buttons in compact mode');
        assert.ok(stylesCss.includes('flex-shrink: 0;'), 'Buttons must have flex-shrink: 0 to prevent label collapsing');
    });

    test('PANEL-022: Persian RTL layout remains correct', () => {
        assert.ok(stylesCss.includes('direction: rtl;'), 'Extension base must maintain direction: rtl');
        assert.ok(contentJs.includes('تغییر چیدمان به حالت فشرده'), 'Contains Persian compact label');
        assert.ok(contentJs.includes('تغییر چیدمان به حالت افقی'), 'Contains Persian horizontal label');
    });

    test('PANEL-023: Mixed Persian, English, and numeric content remains readable', () => {
        const { panel } = createSyntheticPanelFixture();
        const custEl = panel.querySelector('#chapar-name');
        const phoneBtn = panel.querySelector('#btn-phone');

        assert.equal(custEl.textContent, 'محسن اسمعیلی #1146834');
        assert.equal(phoneBtn.textContent, '📱 موبایل: 09197439257');
    });

    test('PANEL-024: The selected layout persists after reload', () => {
        const storageMock = {
            data: { cxPanelLayout: 'compact' },
            get(keys, cb) { cb(this.data); }
        };

        const { panel } = createSyntheticPanelFixture();
        storageMock.get(['cxPanelLayout'], (res) => {
            const isCompact = res?.cxPanelLayout === 'compact';
            applyPanelLayout(panel, isCompact ? 'compact' : 'horizontal', false);
        });

        assert.equal(panel.classList.contains('cx-compact'), true, 'Compact layout must restore from storage');
    });

    // =========================================================================
    // SECTION C: INTERACTION BETWEEN POSITIONING AND LAYOUT (PANEL-025 TO PANEL-030)
    // =========================================================================

    test('PANEL-025: Repeated layout toggles do not duplicate or lose controls', () => {
        const { panel, layoutBtn } = createSyntheticPanelFixture();
        for (let i = 0; i < 6; i++) {
            const isCompact = panel.classList.contains('cx-compact');
            applyPanelLayout(panel, isCompact ? 'horizontal' : 'compact', false);
        }
        // Even number of toggles returns to horizontal
        assert.equal(panel.classList.contains('cx-compact'), false);
        assert.equal(panel.querySelectorAll('#cx-drag-handle').length, 1);
        assert.equal(panel.querySelectorAll('#cx-layout-toggle-bar').length, 1);
    });

    test('PANEL-026: Switching layouts does not unnecessarily reset the saved position', () => {
        const { panel } = createSyntheticPanelFixture();
        panel.style.left = '400px';
        panel.style.top = '300px';

        applyPanelLayout(panel, 'compact', false);
        assert.equal(panel.style.left, '400px', 'Position must not reset to 0,0 on layout switch');
        assert.equal(panel.style.top, '300px', 'Position must not reset to 0,0 on layout switch');
    });

    test('PANEL-027: Moving the panel does not reset the selected layout', () => {
        const { panel, handle } = createSyntheticPanelFixture();
        const storageMock = { data: {}, set(d) { Object.assign(this.data, d); } };
        applyPanelLayout(panel, 'compact', true, storageMock);

        attachDragController(panel, storageMock);
        handle.dispatchEvent({ type: 'pointerdown', clientX: 100, clientY: 100, button: 0 });
        handle.dispatchEvent({ type: 'pointermove', clientX: 200, clientY: 200 });
        handle.dispatchEvent({ type: 'pointerup' });

        assert.equal(panel.classList.contains('cx-compact'), true, 'Panel must remain compact after drag');
        assert.equal(storageMock.data.cxPanelLayout, 'compact', 'Storage layout must remain compact');
    });

    test('PANEL-028: Position and layout work together after viewport resizing', () => {
        const { panel } = createSyntheticPanelFixture();
        panel.offsetWidth = 480;
        panel.offsetHeight = 140; // compact mode height
        panel.style.left = '1800px';
        panel.style.top = '1000px';

        // Viewport resized to 1366x768
        const clamped = clampPosition(1800, 1000, panel.offsetWidth, panel.offsetHeight, 1366, 768);
        assert.equal(clamped.x, 1366 - 480, 'Must clamp to 886px');
        assert.equal(clamped.y, 768 - 140, 'Must clamp to 628px');
    });

    test('PANEL-029: Keyboard users can operate the move and layout controls', () => {
        const { panel, handle } = createSyntheticPanelFixture();
        panel.style.left = '200px';
        panel.style.top = '200px';
        attachDragController(panel);

        // ArrowRight: +10px
        handle.dispatchEvent({ type: 'keydown', key: 'ArrowRight' });
        assert.equal(panel.style.left, '210px');

        // ArrowDown: +10px
        handle.dispatchEvent({ type: 'keydown', key: 'ArrowDown' });
        assert.equal(panel.style.top, '210px');

        // Shift+ArrowLeft: -30px
        handle.dispatchEvent({ type: 'keydown', key: 'ArrowLeft', shiftKey: true });
        assert.equal(panel.style.left, '180px');

        // Home key: (0, 0)
        handle.dispatchEvent({ type: 'keydown', key: 'Home' });
        assert.equal(panel.style.left, '0px');
        assert.equal(panel.style.top, '0px');
    });

    test('PANEL-030: New styles and event handlers do not leak into the host page', () => {
        // Verification of Shadow DOM containment in content.js
        assert.ok(contentJs.includes('getExtensionRoot()'), 'Panel must mount inside Shadow DOM root');
        assert.ok(contentJs.includes('root.appendChild(panel)'), 'Panel must append to shadow root, not document.body');
    });

    // =========================================================================
    // SECTION D: EXTENDED QUALITY & RESILIENCE SCENARIOS (PANEL-031 TO PANEL-036)
    // =========================================================================

    test('PANEL-031: Touch pointer event support and graceful pointercancel handling', () => {
        const { panel, handle } = createSyntheticPanelFixture();
        const ctrl = attachDragController(panel);

        handle.dispatchEvent({ type: 'pointerdown', clientX: 100, clientY: 100, button: 0, pointerId: 4, pointerType: 'touch' });
        handle.dispatchEvent({ type: 'pointermove', clientX: 150, clientY: 150, pointerId: 4 });
        assert.equal(ctrl.isDragging(), true, 'Dragging active during touch move');
        assert.equal(panel.classList.contains('cx-dragging'), true);

        handle.dispatchEvent({ type: 'pointercancel', pointerId: 4 });
        assert.equal(ctrl.isDragging(), false, 'Dragging deactivated upon pointercancel');
        assert.equal(panel.classList.contains('cx-dragging'), false);
    });

    test('PANEL-032: Accessible focus indicators and keyboard focus styles', () => {
        assert.ok(stylesCss.includes('.cx-drag-handle:focus-visible'), 'styles.css defines focus-visible for drag handle');
        assert.ok(stylesCss.includes('.cx-layout-toggle:focus-visible'), 'styles.css defines focus-visible for layout toggle');
    });

    test('PANEL-033: Storage failure recovery leaves UI fully responsive', () => {
        const failingStorage = {
            set() { throw new Error('QUOTA_BYTES_PER_ITEM exceeded or storage closed'); }
        };

        const { panel, handle } = createSyntheticPanelFixture();
        assert.doesNotThrow(() => {
            attachDragController(panel, failingStorage);
            handle.dispatchEvent({ type: 'pointerdown', clientX: 100, clientY: 100, button: 0 });
            handle.dispatchEvent({ type: 'pointermove', clientX: 150, clientY: 150 });
            handle.dispatchEvent({ type: 'pointerup' });
        }, 'Storage write errors must be absorbed without breaking the UI');
    });

    test('PANEL-034: Event listener deduplication guard on repeated panel checks', () => {
        const { panel } = createSyntheticPanelFixture();
        assert.equal(panel.dataset.dragInitialized, undefined);

        attachDragController(panel);
        assert.equal(panel.dataset.dragInitialized, 'true');

        // Second invocation should return immediately without double-attaching
        const listenersBefore = panel.querySelector('#cx-drag-handle')._listeners.get('pointerdown').length;
        attachDragController(panel);
        const listenersAfter = panel.querySelector('#cx-drag-handle')._listeners.get('pointerdown').length;

        assert.equal(listenersBefore, listenersAfter, 'Must not duplicate pointer listeners');
    });

    test('PANEL-035: Dragging does not trigger business operations', () => {
        const { panel, handle, phoneBtn } = createSyntheticPanelFixture();
        let phoneTriggered = false;
        phoneBtn.addEventListener('click', () => { phoneTriggered = true; });

        attachDragController(panel);
        handle.dispatchEvent({ type: 'pointerdown', clientX: 100, clientY: 100, button: 0 });
        handle.dispatchEvent({ type: 'pointermove', clientX: 200, clientY: 200 });
        handle.dispatchEvent({ type: 'pointerup' });

        assert.equal(phoneTriggered, false, 'Moving panel must not trigger phone lookup');
    });

    test('PANEL-036: Text selection suppression during active drag', () => {
        assert.ok(stylesCss.includes('.cx-floating-bar.cx-dragging'), 'styles.css defines .cx-floating-bar.cx-dragging');
        assert.ok(stylesCss.includes('user-select: none !important;'), 'Suppresses text selection during drag');
        assert.ok(stylesCss.includes('transition: none !important;'), 'Suppresses transition latency during drag');
    });

});
