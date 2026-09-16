import * as THREE from 'three';

export function setPlayerGender(group, gender) {
  group.userData.gender = gender === 'female' ? 'female' : 'male';
  group.userData.beard.visible = group.userData.gender === 'male';
  group.userData.hair.visible = group.userData.gender === 'female';
}

// Used by both the game and the lobby; limb references remain animation-compatible.
export function buildPlayer(gender = 'male') {
  const group = new THREE.Group();

  const bodyGeo = new THREE.CapsuleGeometry(0.22, 0.3, 4, 8);
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0xd35f3e, roughness: 0.7 });
  bodyMat.userData.playerTint = true;
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.position.y = 0.6;
  body.castShadow = true;
  group.add(body);

  const headGeo = new THREE.SphereGeometry(0.18, 8, 6);
  const headMat = new THREE.MeshStandardMaterial({ color: 0xf4c89b, roughness: 0.6 });
  const head = new THREE.Mesh(headGeo, headMat);
  head.position.y = 1.05;
  head.castShadow = true;
  group.add(head);

  const noseGeo = new THREE.SphereGeometry(0.05, 6, 4);
  const noseMat = headMat;
  const nose = new THREE.Mesh(noseGeo, noseMat);
  nose.position.set(0, 1.03, 0.17);
  group.add(nose);

  const beardGeo = new THREE.SphereGeometry(0.18, 7, 5);
  const beardMat = new THREE.MeshStandardMaterial({ color: 0xaa2200, roughness: 0.85 });
  const beard = new THREE.Mesh(beardGeo, beardMat);
  beard.position.set(0, 0.82, 0.15);
  beard.scale.set(1.1, 1.5, 0.7);
  beard.rotation.x = -0.2;
  beard.castShadow = true;
  group.add(beard);
  group.userData.beard = beard;

  const hair = new THREE.Group();
  // Locks emerge below the brim at the sides and back, leaving the face clear.
  for (const [x, y, z, sx, sy, sz] of [
    [-0.16, 0.98, -0.02, 0.45, 1.3, 0.65],
    [0.16, 0.98, -0.02, 0.45, 1.3, 0.65],
    [0, 0.98, -0.14, 0.95, 1.4, 0.45],
  ]) {
    const lock = new THREE.Mesh(new THREE.SphereGeometry(0.18, 7, 5), beardMat);
    lock.position.set(x, y, z);
    lock.scale.set(sx, sy, sz);
    lock.castShadow = true;
    hair.add(lock);
  }
  group.add(hair);
  group.userData.hair = hair;
  setPlayerGender(group, gender);

  const hatGeo = new THREE.CylinderGeometry(0.12, 0.2, 0.14, 8);
  const hatMat = new THREE.MeshStandardMaterial({ color: 0x5c3d1e, roughness: 0.8 });
  hatMat.userData.isHatMaterial = true;
  const hat = new THREE.Mesh(hatGeo, hatMat);
  hat.position.y = 1.2;
  hat.castShadow = true;
  group.add(hat);
  group.userData.hatMat = hatMat;

  const brimGeo = new THREE.CylinderGeometry(0.24, 0.24, 0.03, 8);
  const brim = new THREE.Mesh(brimGeo, hatMat);
  brim.position.y = 1.14;
  brim.castShadow = true;
  group.add(brim);

  const legMat = new THREE.MeshStandardMaterial({ color: 0x3d5a80, roughness: 0.8 });
  const rightLeg = new THREE.Mesh(new THREE.CapsuleGeometry(0.08, 0.2, 3, 6), legMat);
  rightLeg.geometry.translate(0, -0.18, 0);
  rightLeg.position.set(-0.1, 0.38, 0);
  rightLeg.castShadow = true;
  group.add(rightLeg);
  group.userData.rightLeg = rightLeg;

  const leftLeg = new THREE.Mesh(new THREE.CapsuleGeometry(0.08, 0.2, 3, 6), legMat);
  leftLeg.geometry.translate(0, -0.18, 0);
  leftLeg.position.set(0.1, 0.38, 0);
  leftLeg.castShadow = true;
  group.add(leftLeg);
  group.userData.leftLeg = leftLeg;

  const bootMat = new THREE.MeshStandardMaterial({ color: 0x5c4033, roughness: 0.9 });
  const rightBoot = new THREE.Mesh(new THREE.CapsuleGeometry(0.09, 0.06, 3, 6), bootMat);
  rightBoot.position.set(0, -0.32, 0.02);
  rightBoot.castShadow = true;
  rightLeg.add(rightBoot);
  const leftBoot = new THREE.Mesh(new THREE.CapsuleGeometry(0.09, 0.06, 3, 6), bootMat);
  leftBoot.position.set(0, -0.32, 0.02);
  leftBoot.castShadow = true;
  leftLeg.add(leftBoot);

  const armMat = new THREE.MeshStandardMaterial({ color: 0xd35f3e, roughness: 0.7 });
  armMat.userData.playerTint = true;

  const rightShoulder = new THREE.Mesh(new THREE.SphereGeometry(0.09, 6, 4), armMat);
  rightShoulder.position.set(-0.2, 0.75, 0);
  rightShoulder.castShadow = true;
  group.add(rightShoulder);

  const leftShoulder = new THREE.Mesh(new THREE.SphereGeometry(0.09, 6, 4), armMat);
  leftShoulder.position.set(0.2, 0.75, 0);
  leftShoulder.castShadow = true;
  group.add(leftShoulder);

  const rightArm = new THREE.Mesh(new THREE.CapsuleGeometry(0.06, 0.2, 3, 6), armMat);
  rightArm.geometry.translate(0, -0.16, 0);
  rightArm.position.set(-0.24, 0.78, 0);
  rightArm.rotation.z = -0.15;
  rightArm.castShadow = true;
  group.add(rightArm);
  group.userData.rightArm = rightArm;

  const leftArm = new THREE.Mesh(new THREE.CapsuleGeometry(0.06, 0.2, 3, 6), armMat);
  leftArm.geometry.translate(0, -0.16, 0);
  leftArm.position.set(0.24, 0.78, 0);
  leftArm.rotation.z = 0.15;
  leftArm.castShadow = true;
  group.add(leftArm);
  group.userData.leftArm = leftArm;

  const packGeo = new THREE.BoxGeometry(0.28, 0.32, 0.18);
  const packMat = new THREE.MeshStandardMaterial({ color: 0x3d6b35, roughness: 0.8 });
  const pack = new THREE.Mesh(packGeo, packMat);
  pack.position.set(0, 0.62, -0.22);
  pack.castShadow = true;
  group.add(pack);
  group.userData.pack = pack;

  const packFlap = new THREE.Mesh(
    new THREE.BoxGeometry(0.26, 0.06, 0.16),
    new THREE.MeshStandardMaterial({ color: 0x2d5528, roughness: 0.8 })
  );
  packFlap.position.set(0, 0.8, -0.22);
  group.add(packFlap);
  group.userData.packFlap = packFlap;

  const sleepingBag = new THREE.Mesh(
    new THREE.CylinderGeometry(0.07, 0.07, 0.28, 8),
    new THREE.MeshStandardMaterial({ color: 0x4488aa, roughness: 0.7 })
  );
  sleepingBag.position.set(0, 0.88, -0.22);
  sleepingBag.rotation.z = Math.PI / 2;
  sleepingBag.castShadow = true;
  group.add(sleepingBag);
  group.userData.sleepingBag = sleepingBag;

  // Flashlight stick (held in right hand)
  const stickGroup = new THREE.Group();
  const stickGeo = new THREE.CylinderGeometry(0.025, 0.03, 0.35, 6);
  const stickMat = new THREE.MeshStandardMaterial({ color: 0x3a3a3a, roughness: 0.5, metalness: 0.3 });
  const stick = new THREE.Mesh(stickGeo, stickMat);
  stick.castShadow = true;
  stickGroup.add(stick);
  const headGeo2 = new THREE.CylinderGeometry(0.045, 0.035, 0.08, 8);
  const headMat2 = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.4, metalness: 0.4 });
  const flashHead = new THREE.Mesh(headGeo2, headMat2);
  flashHead.position.y = 0.2;
  stickGroup.add(flashHead);
  const lensMat = new THREE.MeshBasicMaterial({ color: 0xffffcc });
  const lens = new THREE.Mesh(new THREE.CircleGeometry(0.04, 8), lensMat);
  lens.position.y = 0.24;
  lens.rotation.x = -Math.PI / 2;
  stickGroup.add(lens);
  stickGroup.position.set(-0.01, -0.28, -0.08);
  stickGroup.rotation.x = Math.PI / 2 + 0.3;
  stickGroup.visible = false;
  rightArm.add(stickGroup);
  group.userData.flashlightStick = stickGroup;
  group.userData.flashlightLens = lens;

  return group;
}
