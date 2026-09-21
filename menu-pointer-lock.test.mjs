import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createMenuPointerLock } from './menu-pointer-lock.js';

test('opening releases pointer lock and selection restores it synchronously', () => {
  const events = [], document = { pointerLockElement: null, exitPointerLock() { events.push('unlock'); this.pointerLockElement = null; } };
  const canvas = { requestPointerLock() { events.push('lock'); document.pointerLockElement = canvas; return Promise.resolve(); } };
  const lock = createMenuPointerLock(canvas, document);
  document.pointerLockElement = canvas;
  lock.open();
  assert.equal(document.pointerLockElement, null);
  lock.close(true);
  assert.equal(document.pointerLockElement, canvas);
  assert.deepEqual(events, ['unlock', 'lock']);
  lock.close(true);
  assert.deepEqual(events, ['unlock', 'lock'], 'a later server update must not re-request lock');
});

test('selection never acquires a new lock for an unlocked user and cancellation does not relock', () => {
  const document = { pointerLockElement: null, exitPointerLock() { this.pointerLockElement = null; } };
  let requests = 0;
  const canvas = { requestPointerLock() { requests++; } }, lock = createMenuPointerLock(canvas, document);
  lock.open(); lock.close(true);
  assert.equal(requests, 0);
  document.pointerLockElement = canvas;
  lock.open(); lock.close(false);
  assert.equal(requests, 0);
});

test('browser-denied restoration is handled without an unhandled rejection', async () => {
  let denied = 0;
  const document = { pointerLockElement: null, exitPointerLock() { this.pointerLockElement = null; } };
  const canvas = { requestPointerLock: () => Promise.reject(new Error('User activation required')) };
  const lock = createMenuPointerLock(canvas, document, () => denied++);
  document.pointerLockElement = canvas; lock.open(); lock.close(true);
  await Promise.resolve();
  assert.equal(denied, 1);
});
