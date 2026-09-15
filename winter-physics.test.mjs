import assert from 'node:assert/strict';
import { test } from 'node:test';
import { iceImpulse, advanceOrbit } from './winter-physics.js';

test('ice contact shares forward momentum without reversing or destroying sideways motion', () => {
  const a = [0.25, 0, 0.06], b = [0.1, 0, 0.06];
  const impulse = iceImpulse(a, b, [1, 0, 0]);
  const afterA = a.map((n, i) => n - impulse[i]);
  const afterB = b.map((n, i) => n + impulse[i]);
  assert.ok(afterA[0] > 0 && afterB[0] > 0);
  assert.ok(afterB[0] >= afterA[0], 'front camper separates gently instead of repeated contacts');
  for (let i = 0; i < 3; i++) assert.ok(Math.abs(afterA[i] + afterB[i] - a[i] - b[i]) < 1e-12);
  assert.equal(afterA[2], a[2]); assert.equal(afterB[2], b[2]);
  assert.deepEqual(iceImpulse(afterA, afterB, [1, 0, 0]), [0, 0, 0]);
});

test('contact pushes a stationary camper forward while the moving camper keeps sliding', () => {
  const impulse = iceImpulse([0.2, 0, 0], [0, 0, 0], [1, 0, 0]);
  assert.ok(impulse[0] > 0 && impulse[0] < 0.2);
  assert.equal(iceImpulse([0, 0, 0], [0.2, 0, 0], [1, 0, 0])[0], 0);
});

test('an unobstructed snowball maintains its orbit for ten revolutions', () => {
  const mu = 4800, radius = 21;
  const position = { x: 0, y: radius, z: 0 };
  const velocity = { x: Math.sqrt(mu / radius), y: 0, z: 0 };
  const period = 2 * Math.PI * Math.sqrt(radius ** 3 / mu);
  const energy = -mu / (2 * radius);
  for (let i = 0; i < Math.ceil(period * 10 * 60); i++) {
    advanceOrbit(position, velocity, 1 / 60, mu);
    const r = Math.hypot(position.x, position.y, position.z);
    const e = (velocity.x ** 2 + velocity.y ** 2 + velocity.z ** 2) / 2 - mu / r;
    assert.ok(Math.abs(r - radius) < 0.003);
    assert.ok(Math.abs(e - energy) < 0.001);
  }
});
