import * as THREE from 'three';

export const WEB_STRAND_RADIUS = 0.022;

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
    return { center: a.clone().add(b).multiplyScalar(0.5), segments: [[a, b]], boundary: [a, b] };
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
  const segments = boundary.map(p => [center.clone(), p.clone()]);
  for (const fraction of [0.2, 0.4, 0.6, 0.8, 1]) for (let i = 0; i < boundary.length; i++) {
    const a = center.clone().lerp(boundary[i], fraction);
    const b = center.clone().lerp(boundary[(i + 1) % boundary.length], fraction);
    const inward = a.clone().add(b).multiplyScalar(0.5).lerp(center, fraction === 1 ? 0 : 0.09);
    let previous = a;
    for (let step = 1; step <= 3; step++) {
      const t = step / 3;
      const p = a.clone().multiplyScalar((1 - t) ** 2).addScaledVector(inward, 2 * t * (1 - t)).addScaledVector(b, t * t);
      segments.push([previous, p]); previous = p;
    }
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
