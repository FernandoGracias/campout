import assert from 'node:assert/strict';
import { test } from 'node:test';
import { advanceOrbit, targetThrows } from './winter-physics.js';

const mu = 12 * 20 * 20;
test('explicit targeting reaches nearby, uphill, downhill and lateral targets with real orbital physics', () => {
  const origin = { x: -0.2, y: 21.1, z: 0.3 };
  for (const target of [{ x:0,y:20.7,z:5 }, { x:3,y:24,z:6 }, { x:-4,y:20,z:7 }, { x:1,y:21,z:1.8 }]) {
    const solutions = targetThrows(origin, target, mu);
    assert.ok(solutions.length, JSON.stringify(target));
    for (const shot of solutions) {
      const position = { ...origin }, velocity = { ...shot.velocity };
      assert.ok(Math.hypot(velocity.x, velocity.y, velocity.z) <= 20);
      for (let i = 0; i < shot.steps; i++) advanceOrbit(position, velocity, 1/60, mu);
      assert.ok(Math.hypot(position.x-target.x, position.y-target.y, position.z-target.z) < .06);
    }
  }
});

test('higher arcs are available for cover and targeting is planet-rotation invariant', () => {
  const origin = { x:0,y:21,z:0 }, target = { x:0,y:20,z:6 };
  const shots = targetThrows(origin, target, mu);
  assert.ok(shots.length > 2);
  assert.ok(shots.at(-1).steps > shots[0].steps);
  const rotate = p => ({ x:p.y, y:-p.x, z:p.z });
  const rotated = targetThrows(rotate(origin), rotate(target), mu);
  assert.equal(rotated.length, shots.length);
  const expected = rotate(shots[0].velocity);
  for (const axis of ['x', 'y', 'z']) assert.ok(Math.abs(rotated[0].velocity[axis] - expected[axis]) < 1e-9);
});

test('unreachable targets do not produce overpowered or nonfinite shots', () => {
  assert.deepEqual(targetThrows({x:0,y:21,z:0},{x:0,y:100,z:200},mu), []);
});
