import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDecorationControl } from './decoration-control.js';

test('delete toggle is independent from selection and uses only the active input hint', t => {
  const element = () => ({ style: {}, attrs: {}, listeners: {}, children: [],
    addEventListener(type, fn) { this.listeners[type] = fn; },
    setAttribute(key, value) { this.attrs[key] = value; },
    append(child) { this.children.push(child); } });
  const buttons = new Map();
  const previous = globalThis.document;
  globalThis.document = { createElement: element, getElementById(id) {
    if (!buttons.has(id)) buttons.set(id, element());
    return buttons.get(id);
  } };
  t.after(() => { if (previous === undefined) delete globalThis.document; else globalThis.document = previous; });
  let active = false, visible = true, cycles = 0;
  const control = createDecorationControl(() => visible ? { id: 'lights', name: 'String lights', disabled: active } : null,
    () => cycles++, () => visible ? { active, disabled: false } : null, () => { active = !active; });
  const selector = buttons.get('btn-decoration'), toggle = buttons.get('btn-decoration-delete');
  control.update('keyboard');
  assert.equal(toggle.attrs['aria-pressed'], 'false');
  assert.equal(toggle.children[0].textContent, 'Del');
  toggle.listeners.click(); control.update();
  assert.equal(toggle.attrs['aria-pressed'], 'true');
  assert.equal(selector.disabled, true);
  assert.equal(cycles, 0);
  control.update('gamepad');
  assert.equal(toggle.children[0].textContent, 'Y');
  assert.equal(selector.children.at(-1).textContent, 'RB');
  control.update('touch');
  assert.equal(toggle.children[0].style.display, 'none');
  assert.equal(selector.children.at(-1).style.display, 'none');
  toggle.listeners.click(); control.update();
  assert.equal(toggle.attrs['aria-pressed'], 'false');
  assert.equal(selector.disabled, false);
  visible = false; control.update();
  assert.equal(toggle.style.display, 'none');
});
