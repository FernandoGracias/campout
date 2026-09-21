import * as THREE from 'three';

// Compound oriented boxes follow the visible mesh parts, rather than a single
// large radius or an axis-aligned box enclosing an entire hanging decoration.
export function createPropCollisions() {
  const objects = new Map();
  const up = new THREE.Vector3(0, 1, 0);
  const identity = new THREE.Matrix4();
  function update(id, root) {
    if (root.userData.noPlayerCollision) { objects.delete(id); return; }
    const parts = [], broad = new THREE.Box3();
    function add(bounds, matrix, ignorePlayer) {
      const scale = new THREE.Vector3().setFromMatrixScale(matrix);
      const part = { bounds, inverse: matrix.clone().invert(), minScale: Math.min(scale.x, scale.y, scale.z), ignorePlayer };
      if (part.minScale < 0.001) return;
      parts.push(part); broad.union(bounds.clone().applyMatrix4(matrix));
    }
    function visit(node, parent) {
      if (!node.visible) return;
      node.updateMatrix();
      const matrix = new THREE.Matrix4().multiplyMatrices(parent, node.matrix);
      if (node.userData.webStrands) {
        for (const [a, b] of node.userData.webStrands) {
          const direction = b.clone().sub(a), length = direction.length(), radius = node.userData.strandRadius;
          if (length < 0.001) continue;
          const strand = new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5),
            new THREE.Quaternion().setFromUnitVectors(up, direction.normalize()), new THREE.Vector3(1, 1, 1));
          add(new THREE.Box3(new THREE.Vector3(-radius, -length / 2, -radius), new THREE.Vector3(radius, length / 2, radius)), matrix.clone().multiply(strand));
        }
      } else if (node.isMesh) {
        if (!node.geometry.boundingBox) node.geometry.computeBoundingBox();
        add(node.geometry.boundingBox.clone(), matrix, node.userData.rollingHolder);
      } else if (node.isLineSegments) {
        const p = node.geometry.attributes.position;
        for (let i = 0; i + 1 < p.count; i += 2) {
          const a = new THREE.Vector3().fromBufferAttribute(p, i), b = new THREE.Vector3().fromBufferAttribute(p, i + 1);
          const direction = b.clone().sub(a), length = direction.length();
          if (length < 0.001) continue;
          const lineMatrix = new THREE.Matrix4().compose(a.add(b).multiplyScalar(0.5),
            new THREE.Quaternion().setFromUnitVectors(up, direction.normalize()), new THREE.Vector3(1, 1, 1));
          add(new THREE.Box3(new THREE.Vector3(-0.018, -length / 2, -0.018), new THREE.Vector3(0.018, length / 2, 0.018)), matrix.clone().multiply(lineMatrix));
        }
      }
      for (const child of node.children) visit(child, matrix);
    }
    visit(root, identity);
    objects.set(id, { parts, broad, soft: root.userData.softCollision === true });
  }
  function intersectsSegment(a, b, box) {
    let start = 0, end = 1;
    for (const axis of ['x', 'y', 'z']) {
      const delta = b[axis] - a[axis];
      if (Math.abs(delta) < 1e-9) { if (a[axis] < box.min[axis] || a[axis] > box.max[axis]) return false; continue; }
      const t1 = (box.min[axis] - a[axis]) / delta, t2 = (box.max[axis] - a[axis]) / delta;
      start = Math.max(start, Math.min(t1, t2)); end = Math.min(end, Math.max(t1, t2));
      if (start > end) return false;
    }
    return true;
  }
  function contact(from, to, playerId, soft) {
    const radius = 0.24;
    const fromUp = from.clone().normalize(), toUp = to.clone().normalize();
    const fromMid = from.clone().addScaledVector(fromUp, 0.65), toMid = to.clone().addScaledVector(toUp, 0.65);
    for (const object of objects.values()) {
      if (object.soft !== soft) continue;
      const { broad, parts } = object;
      if (!intersectsSegment(fromMid, toMid, broad.clone().expandByScalar(0.9))) continue;
      for (const part of parts) {
        if (part.ignorePlayer && part.ignorePlayer === playerId) continue;
        const r = radius / part.minScale;
        const expanded = part.bounds.clone().expandByScalar(r);
        for (const height of [0.24, 0.65, 1.06]) {
          const a = from.clone().addScaledVector(fromUp, height).applyMatrix4(part.inverse);
          const b = to.clone().addScaledVector(toUp, height).applyMatrix4(part.inverse);
          const before = part.bounds.distanceToPoint(a), after = part.bounds.distanceToPoint(b);
          // If someone placed a prop against us, permit escape without allowing
          // movement farther into it. The swept test catches even thin posts.
          if (!soft && before <= r && after >= before - 1e-6) continue;
          if (intersectsSegment(a, b, expanded)) return true;
        }
      }
    }
    return false;
  }
  return { update,
    blocks: (from, to, playerId) => contact(from, to, playerId, false),
    speedFactor: (from, to, playerId) => contact(from, to, playerId, true) ? 0.4 : 1,
    remove: id => objects.delete(id) };
}
