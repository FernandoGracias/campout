import * as THREE from 'three';
import { collectDecorationSupports } from './decoration-anchors.js?v=233';

const UP = new THREE.Vector3(0, 1, 0);
const CLOSE = 0.35;

export function lightEndpoints(object) {
  if (object.anchors) return object.anchors.map(a => new THREE.Vector3(...a.point));
  // Older freestanding strips have no stored anchors. Recover their actual
  // post tops using the same model-space placement as minigame-models.js.
  const origin = new THREE.Vector3(...object.position);
  const q = new THREE.Quaternion().setFromUnitVectors(UP, origin.clone().normalize());
  return [-0.9, 0.9].map(x => new THREE.Vector3(x, 1.7, 0).applyQuaternion(q).add(origin));
}

export function overlappingLightSpan(a, b, spans) {
  const delta = b.clone().sub(a), length = delta.length();
  for (const [c, d] of spans) {
    if (a.distanceTo(c) < CLOSE && b.distanceTo(d) < CLOSE || a.distanceTo(d) < CLOSE && b.distanceTo(c) < CLOSE) return true;
    const axis = d.clone().sub(c), oldLength = axis.length();
    if (oldLength < 0.01 || length < 0.01) continue;
    axis.divideScalar(oldLength);
    if (Math.abs(delta.dot(axis) / length) < 0.96) continue;
    const ac = a.clone().sub(c), bc = b.clone().sub(c);
    const start = ac.dot(axis), end = bc.dot(axis);
    if (ac.addScaledVector(axis, -start).length() > CLOSE || bc.addScaledVector(axis, -end).length() > CLOSE) continue;
    const overlap = Math.min(oldLength, Math.max(start, end)) - Math.max(0, Math.min(start, end));
    if (overlap > Math.min(oldLength, length) * 0.4) return true;
  }
  return false;
}

// Prefer free ends of existing strips, then nearby scenery, then new posts.
// Pending placements participate too, so quick repeated taps cannot stack the
// same span while waiting for the room's acknowledgement.
export function planLightPlacement(wanted, forward, world, lights) {
  const spans = lights.map(lightEndpoints);
  const supports = collectDecorationSupports(wanted, world).map(s => ({ ...s, reused: false, degree: 0 }));
  for (const span of spans) for (const point of span) {
    if (point.distanceTo(wanted) > 6) continue;
    const existing = supports.find(s => s.point.distanceTo(point) < CLOSE);
    if (existing) {
      if (!existing.reused) existing.point = point;
      existing.reused = true; existing.degree++;
    }
    else supports.push({ point, foot: null, reused: true, degree: 1 });
  }
  supports.sort((a, b) => (a.reused ? -2 : 0) - (b.reused ? -2 : 0) +
    a.point.distanceTo(wanted) - b.point.distanceTo(wanted) + (a.degree - b.degree) * 0.3);
  supports.length = Math.min(supports.length, 24);
  const normal = wanted.clone().normalize();
  const right = new THREE.Vector3().crossVectors(forward, normal).normalize();
  const along = new THREE.Vector3().crossVectors(normal, right).normalize();
  const posts = [];
  for (const radius of [0.9, 1.8, 2.7, 3.6]) for (let i = 0; i < 8; i++) {
    const angle = i * Math.PI / 4;
    const direction = wanted.clone().addScaledVector(right, Math.cos(angle) * radius).addScaledVector(along, Math.sin(angle) * radius).normalize();
    if (!world.canPlantPost(direction)) continue;
    const foot = world.groundPosition(direction), point = foot.clone().addScaledVector(direction, 1.7);
    if (supports.some(s => s.point.distanceTo(point) < 0.5)) continue;
    posts.push({ point, foot, reused: false, degree: 0 });
  }
  let best = null, bestScore = Infinity;
  const actor = world.actorPosition.clone().normalize();
  const target = wanted.clone().addScaledVector(normal, 1.5);
  function consider(a, b) {
    const length = a.point.distanceTo(b.point);
    if (length < 1.1 || length > 6.5 || overlappingLightSpan(a.point, b.point, spans)) return;
    const center = a.point.clone().add(b.point).multiplyScalar(0.5);
    // Keep the creation's actual midpoint within the normal placement reach.
    if (center.clone().normalize().distanceTo(actor) * 20 > 1.9) return;
    let score = center.distanceTo(target) + length * 0.08 + (a.foot ? 1.2 : 0) + (b.foot ? 1.2 : 0);
    for (const [s, other] of [[a, b], [b, a]]) if (s.reused) {
      score -= 2;
      score += Math.max(0, s.degree - 1) * 0.7;
      if (s.degree === 1) {
        const old = spans.find(pair => pair.some(p => p.distanceTo(s.point) < CLOSE));
        const back = old?.find(p => p.distanceTo(s.point) >= CLOSE);
        if (back) score -= other.point.clone().sub(s.point).normalize().dot(s.point.clone().sub(back).normalize()) * 0.8;
      }
    }
    if (score < bestScore) { best = [a, b]; bestScore = score; }
  }
  for (let i = 0; i < supports.length; i++) for (let j = i + 1; j < supports.length; j++) consider(supports[i], supports[j]);
  for (const support of supports) for (const post of posts) consider(support, post);
  // Freestanding alternatives also allow placement elsewhere when all nearby
  // support pairs already carry lights.
  for (let i = 0; i < posts.length; i++) for (let j = i + 1; j < posts.length; j++) consider(posts[i], posts[j]);
  if (!best) return null;
  const position = world.groundPosition(best[0].point.clone().add(best[1].point).normalize());
  if (best.some(a => a.point.distanceTo(position) > 6 || a.foot && a.foot.distanceTo(position) > 6)) return null;
  return { position: position.toArray(), anchors: best.map(a => ({ point: a.point.toArray(), foot: a.foot ? a.foot.toArray() : null })) };
}
