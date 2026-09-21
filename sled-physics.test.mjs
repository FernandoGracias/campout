import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createSledFlight } from './sled-physics.js';

test('flat terrain does not launch a sled, even at full speed', () => {
  const flight = createSledFlight();
  for (let i = 0; i < 300; i++) {
    const pose = flight.step(20, 9.2, 1 / 30);
    assert.equal(pose.lift, 0);
    assert.equal(pose.airborne, false);
  }
});

test('a hill crest produces low-gravity airtime and a stable landing across frame rates', () => {
  const peaks = [];
  for (const fps of [30, 60, 120]) {
    const flight = createSledFlight();
    let peak = 0, airborneTime = 0, pose;
    for (let i = 0; i <= fps * 4; i++) {
      const time = i / fps;
      pose = flight.step(20 + Math.min(time, 1) * 1.8, 6, 1 / fps);
      peak = Math.max(peak, pose.lift);
      if (pose.airborne) airborneTime += 1 / fps;
      assert.ok(pose.height >= 20 + Math.min(time, 1) * 1.8);
      assert.ok(Math.abs(pose.pitch) <= 0.6);
    }
    assert.ok(peak > 0.5 && peak < 0.8, `peak ${peak}`);
    assert.ok(airborneTime > 1.2 && airborneTime < 1.7, `airtime ${airborneTime}`);
    assert.equal(pose.lift, 0);
    assert.equal(pose.airborne, false);
    peaks.push(peak);
  }
  assert.ok(Math.max(...peaks) - Math.min(...peaks) < 0.04);
});

test('dismount/reset removes flight energy before mounting elsewhere', () => {
  const flight = createSledFlight();
  flight.step(20, 6, 1 / 30);
  flight.step(20.1, 6, 1 / 30);
  assert.ok(flight.step(20.1, 6, 1 / 30).airborne);
  flight.reset();
  assert.deepEqual(flight.step(23, 0, 1 / 30), { height: 23, lift: 0, pitch: 0, airborne: false });
});
