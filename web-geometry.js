import * as THREE from 'three';

export const WEB_STRAND_RADIUS = 0.022;
export function strandControl(a, b, ratio = 0.22, limit = 0.8, floor = -Infinity) {
  const delta = b.clone().sub(a), length2 = delta.lengthSq();
  const middle = a.clone().add(b).multiplyScalar(0.5);
  if (length2 < 0.000001) return middle;
  // Only gravity perpendicular to a span bends it. A vertical thread has no
  // transverse load, so stays straight with no downward parameter distortion.
  const bend = new THREE.Vector3(0, -1, 0).addScaledVector(delta, delta.y / length2)
    .multiplyScalar(Math.min(limit, Math.sqrt(length2) * ratio));
  if (bend.y < 0 && middle.y + bend.y < floor) bend.multiplyScalar(Math.max(0, (floor - middle.y) / bend.y));
  return middle.add(bend);
}
const curvePoint = (a, control, b, t) => a.clone().multiplyScalar((1 - t) ** 2)
  .addScaledVector(control, 2 * t * (1 - t)).addScaledVector(b, t * t);
function curveSegments(a, control, b, steps) {
  const segments = [];
  let previous = a;
  for (let step = 1; step <= steps; step++) {
    const point = curvePoint(a, control, b, step / steps);
    segments.push([previous, point]); previous = point;
  }
  return segments;
}

// Clip the web to the convex outline of real attachment points. Radial threads
// end at supported corners; no full-circle spokes terminate in empty space.
export function webLayout(anchors) {
  const points = [];
  for (const anchor of anchors) for (const point of [anchor.point, anchor.foot]) {
    if (point && !points.some(p => p.distanceToSquared(point) < 0.000001)) points.push(point.clone());
  }
  if (points.length < 2) return { center: points[0] || new THREE.Vector3(), segments: [], boundary: points };
  const origin = points[0], across = points[1].clone().sub(origin).normalize();
  let normal = new THREE.Vector3(), area = 0;
  for (const p of points.slice(2)) {
    const n = new THREE.Vector3().crossVectors(across, p.clone().sub(origin));
    if (n.lengthSq() > area) { normal.copy(n); area = n.lengthSq(); }
  }
  if (area < 0.000001) {
    const ordered = points.sort((a, b) => a.clone().sub(origin).dot(across) - b.clone().sub(origin).dot(across));
    const a = ordered[0], b = ordered.at(-1);
    const control = strandControl(a, b);
    return { center: curvePoint(a, control, b, 0.5), segments: curveSegments(a, control, b, 10), boundary: [a, b] };
  }
  const up = new THREE.Vector3().crossVectors(normal.normalize(), across).normalize();
  const projected = points.map(point => { const p = point.clone().sub(origin); return { x: p.dot(across), y: p.dot(up), point }; })
    .sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  function half(list) {
    const hull = [];
    for (const p of list) {
      while (hull.length > 1 && cross(hull.at(-2), hull.at(-1), p) <= 0.000001) hull.pop();
      hull.push(p);
    }
    hull.pop(); return hull;
  }
  const boundary = [...half(projected), ...half([...projected].reverse())].map(p => p.point);
  const center = boundary.reduce((sum, p) => sum.add(p), new THREE.Vector3()).divideScalar(boundary.length);
  // Anchor positions still define the weave. Do not pull arbitrary spans
  // toward its center; any sideways displacement comes from a connected spoke.
  const floor = Math.min(0, ...points.map(p => p.y));
  const radialControls = boundary.map(p => strandControl(center, p, 0.12, 0.22, floor));
  const radialPoint = (i, fraction) => curvePoint(center, radialControls[i], boundary[i], fraction);
  const segments = boundary.flatMap((p, i) => curveSegments(center.clone(), radialControls[i], p, 10));
  for (const fraction of [0.2, 0.4, 0.6, 0.8, 1]) for (let i = 0; i < boundary.length; i++) {
    // Rings join the curved spokes at the same samples, rather than leaving
    // floating junctions when the radial threads sag.
    const a = radialPoint(i, fraction);
    const b = radialPoint((i + 1) % boundary.length, fraction);
    segments.push(...curveSegments(a, strandControl(a, b, 0.22, 0.8, floor), b, 6));
  }
  return { center, segments, boundary };
}

// One mesh/draw call for actual round threads, instead of unsupported WebGL
// line widths or dozens of separate cylinder draw calls.
export function buildWebGeometry(segments) {
  const template = new THREE.CylinderGeometry(WEB_STRAND_RADIUS, WEB_STRAND_RADIUS, 1, 5, 1, true);
  const vertices = template.attributes.position, normals = template.attributes.normal;
  const positions = [], normalValues = [], indices = [];
  for (const [a, b] of segments) {
    const delta = b.clone().sub(a), length = delta.length();
    if (length < 0.00001) continue;
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize());
    const center = a.clone().add(b).multiplyScalar(0.5), offset = positions.length / 3;
    for (let i = 0; i < vertices.count; i++) {
      const p = new THREE.Vector3().fromBufferAttribute(vertices, i); p.y *= length;
      p.applyQuaternion(q).add(center); positions.push(p.x, p.y, p.z);
      const n = new THREE.Vector3().fromBufferAttribute(normals, i).applyQuaternion(q); normalValues.push(n.x, n.y, n.z);
    }
    for (const index of template.index.array) indices.push(index + offset);
  }
  template.dispose();
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normalValues, 3));
  geometry.setIndex(indices); geometry.computeBoundingSphere();
  return geometry;
}
