import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createSnowballPointer } from './winter-input.js';

function setup() {
  const winter = { enabled: true, holding: true, aimSelected: false, shots: 0, loads: 0,
    setAim(value) { this.aimSelected = value && (this.holding || this.aimSelected); },
    action() { if (this.holding) { this.shots++; this.holding = false; } else this.loads++; } };
  const pointer = createSnowballPointer(winter);
  const event = (overrides = {}) => ({ pointerType: 'mouse', pointerId: 1, button: 2, clientX: 100, clientY: 100, timeStamp: 0, ...overrides });
  return { winter, pointer, event };
}

test('secondary click latches aim, subsequent click fires, next press reloads only once', () => {
  const { winter, pointer, event } = setup();
  pointer.down(event()); pointer.up(event({ timeStamp: 100 }));
  assert.equal(winter.aimSelected, true); assert.equal(winter.shots, 0);
  pointer.down(event({ timeStamp: 200 })); pointer.up(event({ timeStamp: 250 }));
  assert.equal(winter.shots, 1); assert.equal(winter.aimSelected, true);
  pointer.down(event({ timeStamp: 600 })); pointer.up(event({ timeStamp: 650 }));
  assert.equal(winter.loads, 1); assert.equal(winter.shots, 1);
});

test('trackpad or mouse hold/release fires without requiring a simultaneous primary click', () => {
  const { winter, pointer, event } = setup();
  pointer.down(event()); pointer.up(event({ timeStamp: 500 }));
  assert.equal(winter.shots, 1); assert.equal(winter.aimSelected, true);
});

test('short secondary drag fires on release; tiny click jitter still latches', () => {
  for (const [distance, shots] of [[2, 0], [12, 1]]) {
    const { winter, pointer, event } = setup();
    pointer.down(event()); pointer.move(event({ clientX: 100 + distance }));
    pointer.up(event({ timeStamp: 150 })); assert.equal(winter.shots, shots);
  }
});

test('cancel, foreign pointer release, and a primary shot cannot cause an extra shot/reload', () => {
  const { winter, pointer, event } = setup();
  pointer.down(event()); pointer.up(event({ pointerId: 2, timeStamp: 500 }));
  assert.equal(winter.shots, 0);
  winter.action(); pointer.up(event({ timeStamp: 600 }));
  assert.equal(winter.shots, 1); assert.equal(winter.loads, 0);
  winter.holding = true;
  pointer.down(event()); pointer.cancel(); pointer.up(event({ timeStamp: 700 }));
  assert.equal(winter.shots, 1); assert.equal(winter.aimSelected, false);
});

test('touch and primary clicks are left to their own interaction handlers', () => {
  const { winter, pointer, event } = setup();
  assert.equal(pointer.down(event({ pointerType: 'touch' })), false);
  assert.equal(pointer.down(event({ button: 0 })), false);
  assert.equal(winter.aimSelected, false); assert.equal(winter.shots, 0);
});
