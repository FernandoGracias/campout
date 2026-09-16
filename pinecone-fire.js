// Shared, lightweight flame visuals for carried, thrown and resting pinecones.
export function createPineconeFire(THREE) {
  const geometry = new THREE.ConeGeometry(0.11, 0.34, 5);
  geometry.translate(0, 0.16, 0);
  const outer = new THREE.MeshBasicMaterial({ color: 0xff5500, transparent: true,
    opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
  const inner = new THREE.MeshBasicMaterial({ color: 0xffdd33, transparent: true,
    opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
  const up = new THREE.Vector3(0, 1, 0);
  const position = new THREE.Vector3(), rotation = new THREE.Quaternion();
  function update(object, burning, time) {
    let flame = object.userData.pineconeFlame;
    if (!flame && burning) {
      flame = new THREE.Group();
      flame.name = 'pinecone-flame';
      for (let i = 0; i < 3; i++) {
        const tongue = new THREE.Mesh(geometry, i === 1 ? inner : outer);
        tongue.position.set((i - 1) * 0.065, 0, i === 1 ? 0.025 : 0);
        flame.add(tongue);
      }
      object.add(flame);
      object.userData.pineconeFlame = flame;
    }
    if (!flame) return;
    flame.visible = burning;
    if (!burning) return;
    // Fire rises away from the planet, even while its pinecone tumbles.
    object.getWorldPosition(position).normalize();
    object.getWorldQuaternion(rotation).invert();
    flame.quaternion.setFromUnitVectors(up, position).premultiply(rotation);
    for (let i = 0; i < flame.children.length; i++) {
      const pulse = Math.sin(time * 17 + i * 2.1);
      flame.children[i].scale.set(0.7 + pulse * 0.12, 0.8 + pulse * 0.3, 0.7);
      flame.children[i].rotation.z = Math.sin(time * 11 + i) * 0.14;
    }
  }
  return { update };
}
