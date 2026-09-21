import * as THREE from 'three';
import { ghostPosition } from './ghost-motion.js?v=234';
import { buildMinigameProp } from './minigame-models.js?v=238';
import { disposeObject } from './game-utils.js';

const UP = new THREE.Vector3(0, 1, 0);
const DOWN = new THREE.Vector3(0, -1, 0);
export function createGhostCatching(world) {
  const ghosts = new Map(), guns = new Map();
  let pressed = false, input = '', aim = new THREE.Vector3(0, 0, 1), target = null;
  let heldTarget = null, heldTime = 0, sentAt = -1, elapsed = 0, haloTexture = null;
  const active = () => world.getState()?.mode === 'ghost-catching';
  const vacuuming = () => active() && pressed && world.canUse();
  function setVacuum(value, source = '') {
    if (!value && source && source !== input) return;
    if (value && (!active() || world.menuOpen())) return;
    pressed = value; input = value ? source : '';
    if (!value) { heldTarget = null; heldTime = 0; }
  }
  function halo() {
    if (world.disableGlow) return null;
    if (!haloTexture) {
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 64;
      const context = canvas.getContext('2d'), gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32);
      gradient.addColorStop(0, 'rgba(205,255,255,0.65)'); gradient.addColorStop(1, 'rgba(205,255,255,0)');
      context.fillStyle = gradient; context.fillRect(0, 0, 64, 64);
      haloTexture = new THREE.CanvasTexture(canvas);
    }
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: haloTexture, transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, opacity: 0.65 }));
    sprite.position.y = 1.2; sprite.scale.set(1.8, 1.8, 1); return sprite;
  }
  function sync() {
    const state = world.getState();
    const ids = new Set(active() ? (state.ghosts || []).map(g => g.id) : []);
    for (const [id, actor] of ghosts) if (!ids.has(id)) { disposeObject(actor.mesh); ghosts.delete(id); }
    if (!ghosts.size) haloTexture = null;
    if (!ids.size) { haloTexture = null; setVacuum(false); }
    for (const ghost of active() ? state.ghosts || [] : []) if (!ghosts.has(ghost.id)) {
      const mesh = buildMinigameProp('ghost', { floating: true });
      const glow = halo(); if (glow) mesh.add(glow);
      world.globePivot.add(mesh); ghosts.set(ghost.id, { mesh, center: new THREE.Vector3() });
    }
    if (!active()) for (const [id, gun] of guns) { gun.arm.rotation.set(0, 0, -0.15); disposeObject(gun.model); disposeObject(gun.beam); guns.delete(id); }
  }
  function ensureGun(id, camper) {
    if (guns.has(id)) return guns.get(id);
    const model = buildMinigameProp('ghost-gun');
    camper.mesh.userData.rightArm.add(model);
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.025, 1, 10, 1, true),
      new THREE.MeshBasicMaterial({ color: 0x88ddff, transparent: true, opacity: 0.2,
        side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
    beam.visible = false; world.scene.add(beam);
    const entry = { model, beam, arm: camper.mesh.userData.rightArm }; guns.set(id, entry); return entry;
  }
  function findTarget(origin, direction, useCamera) {
    let best = null, score = Infinity;
    const cameraOrigin = useCamera ? world.camera.position : origin;
    const rayDirection = useCamera ? world.camera.getWorldDirection(new THREE.Vector3()) : direction;
    for (const [id, actor] of ghosts) {
      if (!actor.mesh.visible || actor.center.distanceTo(origin) > 10) continue;
      const offset = actor.center.clone().sub(cameraOrigin), along = offset.dot(rayDirection);
      if (along <= 0) continue;
      const cross = Math.sqrt(Math.max(0, offset.lengthSq() - along * along));
      if (cross > 0.5 + along * 0.025 || cross >= score) continue;
      best = { id, actor }; score = cross;
    }
    if (best && useCamera) {
      const delta = best.actor.center.clone().sub(origin);
      const ray = new THREE.Raycaster(origin, delta.clone().normalize(), 0, Math.max(0, delta.length() - 0.35));
      if (ray.intersectObjects(world.getObstacles(), true).length) return null;
    }
    return best;
  }
  function update(delta) {
    elapsed += delta;
    if (!active()) return;
    const state = world.getState(), now = world.now(), rotation = world.getRotation();
    for (const ghost of state.ghosts || []) {
      const actor = ghosts.get(ghost.id); if (!actor) continue;
      const p = new THREE.Vector3(...ghostPosition(ghost, now)), normal = p.clone().normalize();
      actor.center.copy(p).applyQuaternion(rotation);
      actor.mesh.position.copy(p).addScaledVector(normal, -1.2);
      actor.mesh.quaternion.setFromUnitVectors(UP, normal);
      actor.mesh.rotateY(elapsed * 0.2 + ghost.phase);
      actor.mesh.visible = ghost.hiddenUntil <= now;
      actor.mesh.scale.lerp(new THREE.Vector3(1, 1, 1), 1 - Math.exp(-6 * delta));
    }
    const origin = world.player.position.clone().addScaledVector(UP, 0.8);
    const view = world.camera.getWorldDirection(new THREE.Vector3());
    target = findTarget(origin, view, true);
    aim.copy(target ? target.actor.center : world.camera.position.clone().addScaledVector(view, 12)).sub(origin).normalize();
    const on = vacuuming();
    if (on && target) {
      heldTime = heldTarget === target.id ? heldTime + delta : 0;
      heldTarget = target.id;
      target.actor.mesh.scale.setScalar(Math.max(0.35, 1 - heldTime / 1.2 * 0.55));
    } else { heldTarget = null; heldTime = 0; }
    if (elapsed - sentAt >= 0.2) {
      sentAt = elapsed;
      if (on && target) world.send({ type: 'minigame-ghost-vacuum', target: target.id });
    }
    const campers = [[world.localId, { mesh: world.player }], ...Object.entries(world.getPeers())];
    const live = new Set(campers.map(([id]) => id));
    for (const [id, gun] of guns) if (!live.has(id)) { disposeObject(gun.model); disposeObject(gun.beam); guns.delete(id); }
    for (const [id, camper] of campers) {
      const member = state.roster[id]; if (!member || member.spectator) continue;
      const local = id === world.localId, gun = ensureGun(id, camper);
      gun.model.visible = camper.mesh.visible;
      const fresh = !local && performance.now() - camper.motionReceivedAt < 1500;
      const direction = local ? aim.clone() : fresh && camper.motion?.ghostAim
        ? new THREE.Vector3(...camper.motion.ghostAim).applyQuaternion(rotation)
        : new THREE.Vector3(0, 0, 1).applyQuaternion(camper.mesh.quaternion);
      const localAim = direction.clone().applyQuaternion(camper.mesh.quaternion.clone().invert());
      camper.mesh.userData.rightArm.quaternion.setFromUnitVectors(DOWN, localAim);
      camper.mesh.updateWorldMatrix(true, true);
      const muzzle = gun.model.localToWorld(gun.model.userData.muzzle.clone());
      const firing = local ? on : fresh && camper.motion?.ghostVacuum === true;
      gun.beam.visible = !!firing && gun.model.visible;
      if (gun.beam.visible) {
        const victim = local ? target : findTarget(muzzle, direction, false);
        const end = victim ? victim.actor.center : muzzle.clone().addScaledVector(direction, 8);
        const span = end.clone().sub(muzzle);
        gun.beam.position.copy(muzzle).add(end).multiplyScalar(0.5);
        gun.beam.quaternion.setFromUnitVectors(UP, span.clone().normalize());
        gun.beam.scale.y = span.length();
        gun.beam.material.opacity = 0.17 + Math.sin(elapsed * 18) * 0.04;
      }
    }
  }
  return { sync, update, setVacuum, vacuuming, getAim: () => aim.clone(), active };
}
