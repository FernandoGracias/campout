import * as THREE from 'three';

// Find real attachment surfaces near the placement point. Two supports mean no
// posts; one support needs only one fallback post. Endpoints are stored by the
// room in globe coordinates, so every camper builds the same hanging prop.
export function collectDecorationSupports(position, world) {
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
  return supports;
}
export function findDecorationAnchors(position, forward, world) {
  const normal = position.clone().normalize();
  const supports = collectDecorationSupports(position, world);
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

export function findWebAnchors(position, forward, world) {
  const normal = position.clone().normalize();
  let anchors = findDecorationAnchors(position, forward, world);
  if (!anchors) {
    const right = new THREE.Vector3().crossVectors(forward, normal).normalize();
    const directions = [-0.8, 0.8].map(offset => position.clone().addScaledVector(right, offset).normalize());
    if (directions.some(d => world.canPlantPost?.(d) === false)) return null;
    anchors = directions.map(direction => {
      const foot = world.groundPosition(direction);
      return { point: foot.clone().addScaledVector(direction, 1.4).toArray(), foot: foot.toArray() };
    });
  }
  return expandWebAnchors(position, anchors, world);
}

export function expandWebAnchors(position, original, world) {
  const anchors = original.map(a => ({ point: [...a.point], foot: a.foot ? [...a.foot] : null }));
  const normal = position.clone().normalize();
  const a = new THREE.Vector3(...anchors[0].point), b = new THREE.Vector3(...anchors[1].point);
  const center = a.clone().add(b).multiplyScalar(0.5), across = b.clone().sub(a).normalize();
  const up = normal.clone().addScaledVector(across, -normal.dot(across)).normalize();
  if (up.lengthSq() < 0.01) return anchors;
  const rotation = world.getRotation(), inverse = rotation.clone().invert();
  const origin = center.clone().applyQuaternion(rotation);
  const reach = Math.min(3.2, Math.max(2.4, a.distanceTo(b) * 0.7));
  const surfaces = world.getWebSupportMeshes();
  for (const mesh of surfaces) mesh.updateWorldMatrix(true, true);
  // Search each potential spoke for an actual attachment. Missing rays are
  // omitted, particularly the old unsupported top spokes of the circular orb.
  for (let i = 0; i < 8 && anchors.length < 8; i++) {
    const angle = i * Math.PI / 4;
    const direction = across.clone().multiplyScalar(Math.cos(angle)).addScaledVector(up, Math.sin(angle)).applyQuaternion(rotation).normalize();
    const hit = new THREE.Raycaster(origin, direction, 0.12, reach).intersectObjects(surfaces, true)[0];
    if (!hit) continue;
    const point = hit.point.clone().applyQuaternion(inverse);
    if (point.length() < 17 || point.length() > 28 || point.distanceTo(position) > 6) continue;
    if (anchors.some(anchor => {
      const distance = point.distanceTo(new THREE.Vector3(...anchor.point));
      return distance < 0.18 || distance > 6.5;
    })) continue;
    anchors.push({ point: point.toArray(), foot: null });
  }
  return anchors;
}
