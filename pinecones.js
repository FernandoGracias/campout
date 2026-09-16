// Inventory, geometry and surface placement are separate from projectile flight.
export function createPinecones(THREE, { world, treeColumns, terrainPatches, surface, getEnabled, getElapsed }) {
  const { globePivot, radius, waterRadius, waterSphere } = world;
  const up = new THREE.Vector3(0, 1, 0);
  const profile = [new THREE.Vector2(0.015, -0.12)];
  for (let row = 0; row < 6; row++) {
    const y = -0.105 + row * 0.04, width = 0.075 * Math.sin((row + 1) / 7 * Math.PI);
    profile.push(new THREE.Vector2(width * 0.65, y), new THREE.Vector2(width, y + 0.015));
  }
  profile.push(new THREE.Vector2(0.008, 0.15));
  const coneGeo = new THREE.LatheGeometry(profile, 10);
  const coneMaterial = new THREE.MeshStandardMaterial({ color: 0x89512e, roughness: 1, flatShading: true });
  const PICKUP_DISTANCE = 0.65;
  const MAX_PINECONES = 100;
  const cones = [];
  // Deterministic positions let every camper refer to the same cone by index.
  for (let i = 0; i < treeColumns.length && cones.length < MAX_PINECONES; i++) {
    const normal = treeColumns[i].direction;
    const basis = new THREE.Quaternion().setFromUnitVectors(up, normal);
    const angle = i * 2.399963229728653;
    const direction = normal.clone().multiplyScalar(radius).add(
      new THREE.Vector3(Math.cos(angle) * 0.85, 0, Math.sin(angle) * 0.85).applyQuaternion(basis)).normalize();
    const floor = surface(direction);
    if (floor <= waterRadius + 0.06) continue;
    cones.push({ position: direction.clone().multiplyScalar(floor + 0.075), direction, availableAt: 0 });
  }
  const groundCones = new THREE.InstancedMesh(coneGeo, coneMaterial, cones.length);
  groundCones.name = 'ground-pinecones'; groundCones.castShadow = true;
  groundCones.frustumCulled = false; globePivot.add(groundCones);
  const coneTransform = new THREE.Object3D();
  const ray = new THREE.Raycaster();
  // Match the rendered water triangles in planet-local coordinates, rather than
  // the ideal sphere radius (which floats above the faceted water between vertices).
  const waterSurface = new THREE.Mesh(waterSphere.geometry, waterSphere.material);
  waterSurface.updateMatrixWorld();
  function waterPoint(direction) {
    if (getEnabled()) return null;
    ray.set(direction.clone().multiplyScalar(radius + 12), direction.clone().negate());
    const hit = ray.intersectObjects([...terrainPatches, waterSurface], false)[0];
    return hit?.object === waterSurface ? hit.point : null;
  }
  function restingPosition(direction) {
    // The laid-down cone is radially symmetric: its center on the water plane
    // leaves half below the surface. On land retain the existing support offset.
    return waterPoint(direction) || direction.clone().multiplyScalar(surface(direction) + 0.075);
  }
  function settleInWater(position) {
    return waterPoint(position.clone().normalize()) || position.clone();
  }
  function orientCone(object, index, direction) {
    object.quaternion.setFromUnitVectors(up, direction);
    object.rotateZ(Math.PI / 2); object.rotateY(index * 1.7);
  }
  function drawCone(index, visible) {
    const cone = cones[index];
    coneTransform.position.copy(cone.position);
    orientCone(coneTransform, index, cone.direction);
    coneTransform.scale.setScalar(visible ? 1 : 0);
    coneTransform.updateMatrix(); groundCones.setMatrixAt(index, coneTransform.matrix);
    groundCones.instanceMatrix.needsUpdate = true;
    groundCones.boundingSphere = null;
  }
  // Generated positions initialize a new room; show only the server's inventory.
  cones.forEach((cone, index) => drawCone(index, false));
  function nearbyCone(preferred = null) {
    const foot = world.getPlayer().position.clone().applyQuaternion(world.getRotation().clone().invert());
    let nearest = null, distance = PICKUP_DISTANCE;
    for (const [id, cone] of cones.entries()) {
      if ((preferred !== null && preferred !== id) || cone.availableAt > getElapsed()) continue;
      const separation = foot.distanceTo(cone.position);
      if (separation <= distance) { nearest = id; distance = separation; }
    }
    return nearest;
  }
  function takeCone(id) {
    cones[id].availableAt = Infinity;
    drawCone(id, false);
  }
  function landCone(id, position) {
    const cone = cones[id];
    if (!cone) return;
    cone.direction.copy(position).normalize();
    // Reconcile old snapshots and bounce endpoints using the same water raycast.
    cone.position.copy(settleInWater(position));
    cone.availableAt = 0; drawCone(id, true);
  }
  return { cones, coneGeo, coneMaterial, groundCones, drawCone, nearbyCone, takeCone, landCone,
    restingPosition, settleInWater, orientCone };
}
