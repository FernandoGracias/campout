import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';

const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
const source = html.slice(html.indexOf('function updateSwimming('), html.indexOf('// --- PLAYER ---'));
const context = vm.createContext({
  WATER_RADIUS: 20,
  SWIM_DEPTH: 0.72,
  THREE: { MathUtils: { lerp: (a, b, t) => a + (b - a) * t } },
});
vm.runInContext(source, context);

function camper() {
  const userData = {};
  for (const limb of ['leftArm', 'rightArm', 'leftLeg', 'rightLeg']) {
    userData[limb] = { rotation: { x: 0, z: 0 } };
  }
  return { userData, pitch: 0, roll: 0,
    rotateX(angle) { this.pitch += angle; },
    rotateZ(angle) { this.roll += angle; } };
}

test('winter supports all campers on lake and river ice, then restores swimming on thaw', () => {
  const winter = { enabled: true, iceRadius: 20.05 };
  for (const bottom of [10, 18.8, 19.9]) {
    const mesh = camper();
    context.updateSwimming(mesh, 10, true, 1);
    assert.equal(context.updateSwimming(mesh, bottom, true, 1 / 30, winter), winter.iceRadius);
    assert.equal(mesh.userData.onIce, true);
    assert.equal(mesh.userData.swimming, false);
    assert.equal(mesh.userData.swimBlend, 0);
    mesh.userData.skating = true;
    assert.equal(context.updateSwimming(mesh, bottom, true, 1 / 30, winter), winter.iceRadius + 0.07);
    mesh.userData.skating = false;
    assert.equal(context.updateSwimming(mesh, 21, true, 1 / 30, winter), 21);
    assert.equal(mesh.userData.onIce, false);
    winter.enabled = false;
    context.updateSwimming(mesh, 10, true, 1 / 30, winter);
    assert.equal(mesh.userData.swimming, true);
    assert.equal(mesh.userData.onIce, false);
    winter.enabled = true;
  }
});

test('shallow water is walkable; deep water supports the camper independently of seabed depth', () => {
  const mesh = camper();
  assert.equal(context.updateSwimming(mesh, 19.5, false, 1 / 60), 19.5);
  assert.equal(mesh.userData.swimming, false);
  for (const bottom of [19.2, 18, 10]) {
    const radius = context.updateSwimming(mesh, bottom, false, 1 / 60);
    assert.equal(mesh.userData.swimming, true);
    assert.ok(radius >= 19.255 && radius <= 19.305);
    assert.ok(radius + 1.05 - 0.18 > 20, 'entire head stays above water while treading');
  }
});

test('shoreline hysteresis avoids flickering and returns the camper to land', () => {
  const mesh = camper();
  context.updateSwimming(mesh, 19.27, false, 1 / 60);
  for (const bottom of [19.29, 19.27, 19.35]) {
    context.updateSwimming(mesh, bottom, false, 1 / 60);
    assert.equal(mesh.userData.swimming, true);
  }
  assert.equal(context.updateSwimming(mesh, 20.2, false, 1 / 60), 20.2);
  assert.equal(mesh.userData.swimming, false);
  for (let i = 0; i < 120; i++) context.updateSwimming(mesh, 20.2, false, 1 / 60);
  assert.ok(mesh.userData.swimBlend < 0.001);
  context.resetSwimLimbs(mesh);
  context.applySwimPose(mesh);
  assert.equal(mesh.pitch, 0);
  assert.equal(mesh.userData.leftArm.rotation.z, 0.15);
});

test('swimming transition is frame-rate independent and the forward stroke keeps the head up', () => {
  const results = [];
  for (const fps of [30, 60, 144]) {
    const mesh = camper();
    for (let i = 0; i < fps * 2; i++) {
      const radius = context.updateSwimming(mesh, 17, true, 1 / fps);
      mesh.pitch = mesh.roll = 0;
      context.resetSwimLimbs(mesh);
      context.applySwimPose(mesh);
      assert.ok(radius + Math.cos(mesh.pitch) * 1.05 - 0.18 > 20, 'head clears water throughout transition');
      assert.ok(Number.isFinite(mesh.userData.leftArm.rotation.x));
    }
    results.push(mesh.userData.swimBlend);
    assert.ok(mesh.pitch > 0.8);
    assert.ok(Math.abs(mesh.userData.leftLeg.rotation.x + mesh.userData.rightLeg.rotation.x) < 1e-10);
  }
  assert.ok(Math.max(...results) - Math.min(...results) < 1e-10);
});

test('stationary swimmers keep sculling and kicking without leaning into a forward stroke', () => {
  const mesh = camper();
  for (let i = 0; i < 120; i++) context.updateSwimming(mesh, 17, false, 1 / 60);
  context.applySwimPose(mesh);
  const firstArm = mesh.userData.leftArm.rotation.x;
  const firstLeg = mesh.userData.leftLeg.rotation.x;
  context.updateSwimming(mesh, 17, false, 0.25);
  context.applySwimPose(mesh);
  assert.notEqual(mesh.userData.leftArm.rotation.x, firstArm);
  assert.notEqual(mesh.userData.leftLeg.rotation.x, firstLeg);
  assert.equal(mesh.pitch, 0);
});
