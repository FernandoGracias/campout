import * as THREE from 'three';

export function buildTent(tentStyle, tentColor) {
  const campGroup = new THREE.Group();
  const tentMat = new THREE.MeshStandardMaterial({ color: tentColor, roughness: 0.7 });
  if (tentStyle === 'aframe') {
    const shape = new THREE.Shape();
    shape.moveTo(-0.6, 0);
    shape.lineTo(0, 0.9);
    shape.lineTo(0.6, 0);
    shape.closePath();
    const geo = new THREE.ExtrudeGeometry(shape, { depth: 1.2, bevelEnabled: false });
    const tent = new THREE.Mesh(geo, tentMat);
    tent.position.set(-0.8, -0.1, -0.6);
    tent.scale.setScalar(1.25);
    tent.castShadow = true;
    tent.userData.needsRaycast = true;
    tent.userData.groundSink = 0.1;
    campGroup.add(tent);
  } else if (tentStyle === 'dome') {
    const geo = new THREE.SphereGeometry(0.8, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2);
    tentMat.side = THREE.DoubleSide;
    const tent = new THREE.Mesh(geo, tentMat);
    tent.position.set(-0.8, -0.1, 0);
    tent.scale.setScalar(1.25);
    tent.castShadow = true;
    tent.userData.needsRaycast = true;
    tent.userData.groundSink = 0.1;
    campGroup.add(tent);
  } else if (tentStyle === 'cabin') {
    const geo = new THREE.ConeGeometry(0.7, 1.4, 8);
    geo.translate(0, 0.7, 0);
    const tent = new THREE.Mesh(geo, tentMat);
    tent.position.set(-0.8, -0.1, 0);
    tent.scale.setScalar(1.25);
    tent.castShadow = true;
    tent.userData.needsRaycast = true;
    tent.userData.groundSink = 0.1;
    campGroup.add(tent);
  } else if (tentStyle === 'tunnel') {
    const geo = new THREE.CylinderGeometry(0.6, 0.6, 1.4, 10, 1, false);
    const tent = new THREE.Mesh(geo, tentMat);
    tent.position.set(-0.8, 0, 0);
    tent.scale.setScalar(1.25);
    tent.rotation.x = Math.PI / 2;
    tent.castShadow = true;
    tent.userData.needsRaycast = true;
    tent.userData.groundSink = 0.6 * 1.25 * 0.5;
    campGroup.add(tent);
  }
  const tent = campGroup.children[0];
  if (tentStyle === 'aframe') tent.geometry.translate(0, 0, -0.6);
  tent.removeFromParent();
  return tent;
}
