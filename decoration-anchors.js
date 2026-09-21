import * as THREE from 'three';

// Find real attachment surfaces near the placement point. Two supports mean no
// posts; one support needs only one fallback post. Endpoints are stored by the
// room in globe coordinates, so every camper builds the same hanging prop.
export function findDecorationAnchors(position, forward, world) {
  const rotation = world.getRotation(), inverse = rotation.clone().invert();
  const normal = position.clone().normalize();
  const center = position.clone().addScaledVector(normal, 1.6).applyQuaternion(rotation);
  const supports = [];
  for (const object of world.getAttachmentMeshes()) {
    object.updateWorldMatrix(true, true);
    const bounds = new THREE.Box3().setFromObject(object);
    const target = bounds.getCenter(new THREE.Vector3());
    if (center.distanceTo(target) > 6) continue;
    target.y = THREE.MathUtils.clamp(center.y, bounds.min.y + 0.05, Math.max(bounds.min.y + 0.05, bounds.max.y - 0.05));
    const delta = target.clone().sub(center);
    if (delta.length() < 0.1) continue;
    const ray = new THREE.Raycaster(center, delta.clone().normalize(), 0, 6);
    const hit = ray.intersectObject(object, true)[0];
    if (!hit) continue;
    const point = hit.point.clone().applyQuaternion(inverse);
    if (point.distanceTo(position) > 6 || supports.some(s => s.point.distanceTo(point) < 0.5)) continue;
    supports.push({ point, foot: null });
  }
  supports.sort((a, b) => a.point.distanceTo(position) - b.point.distanceTo(position));
  supports.length = Math.min(supports.length, 8);
  let pair = null, score = Infinity;
  for (let i = 0; i < supports.length; i++) for (let j = i + 1; j < supports.length; j++) {
    const a = supports[i], b = supports[j], span = a.point.distanceTo(b.point);
    if (span < 1 || span > 6.5) continue;
    const midpoint = a.point.clone().add(b.point).multiplyScalar(0.5);
    const candidate = midpoint.distanceTo(position.clone().addScaledVector(normal, 1.4)) + (a.point.distanceTo(position) + b.point.distanceTo(position)) * 0.2;
    if (candidate < score) { pair = [a, b]; score = candidate; }
  }
  if (pair) return pair.map(a => ({ point: a.point.toArray(), foot: null }));
  if (!supports.length) return null;
  const attached = supports[0];
  const right = new THREE.Vector3().crossVectors(forward, normal).normalize();
  const sign = attached.point.clone().sub(position).dot(right) > 0 ? -1 : 1;
  const direction = position.clone().addScaledVector(right, sign * 1.1).normalize();
  const foot = world.groundPosition(direction);
  const point = foot.clone().addScaledVector(direction, 1.7);
  if (point.distanceTo(attached.point) < 1 || point.distanceTo(attached.point) > 6.5) return null;
  return [{ point: attached.point.toArray(), foot: null }, { point: point.toArray(), foot: foot.toArray() }];
}
