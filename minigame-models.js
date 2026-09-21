import * as THREE from 'three';
import { webLayout, buildWebGeometry, WEB_STRAND_RADIUS } from './web-geometry.js?v=237';

// Small, static world props. No per-prop lights or per-frame geometry uploads.
export function buildMinigameProp(kind, options = {}) {
  const group = new THREE.Group();
  group.userData.softCollision = kind === 'web';
  group.userData.noPlayerCollision = kind === 'lights';
  group.userData.glowBulbs = [];
  const materials = new Map();
  const mat = (color, glow = false) => {
    const key = `${color}:${glow}`;
    if (!materials.has(key)) materials.set(key, glow ? new THREE.MeshBasicMaterial({ color }) :
      new THREE.MeshStandardMaterial({ color, roughness: 0.8 }));
    return materials.get(key);
  };
  const mesh = (geo, color, x, y, z, glow = false) => {
    const m = new THREE.Mesh(geo, mat(color, glow));
    m.position.set(x, y, z); m.castShadow = !glow; m.receiveShadow = !glow;
    group.add(m); return m;
  };
  const ball = (r, color, x, y, z, glow = false) => mesh(new THREE.SphereGeometry(r, 10, 8), color, x, y, z, glow);
  const bulb = (r, color, x, y, z) => {
    const m = ball(r, color, x, y, z, true);
    m.material.toneMapped = false;
    group.userData.glowBulbs.push(m);
    return m;
  };
  const box = (w, h, d, color, x, y, z) => mesh(new THREE.BoxGeometry(w, h, d), color, x, y, z);
  const pole = (height, x = 0, z = 0) => mesh(new THREE.CylinderGeometry(0.035, 0.05, height, 6), 0x69452c, x, height / 2, z);
  const rod = (a, b, radius, color) => {
    const delta = b.clone().sub(a);
    const m = mesh(new THREE.CylinderGeometry(radius, radius, delta.length(), 6), color, 0, 0, 0);
    m.position.copy(a).add(b).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize());
    return m;
  };
  const anchors = options.anchors;
  if (kind === 'lights') {
    const ends = anchors || [{ point: new THREE.Vector3(-0.9, 1.7, 0), foot: new THREE.Vector3(-0.9, 0, 0) },
      { point: new THREE.Vector3(0.9, 1.7, 0), foot: new THREE.Vector3(0.9, 0, 0) }];
    for (const a of ends) if (a.foot) rod(a.foot, a.point, 0.04, 0x69452c);
    const span = ends[0].point.distanceTo(ends[1].point), count = Math.max(8, Math.ceil(span / 0.24));
    let last = ends[0].point;
    for (let i = 1; i <= count; i++) {
      const t = i / count;
      const p = ends[0].point.clone().lerp(ends[1].point, t);
      p.y -= Math.sin(t * Math.PI) * Math.min(0.55, span * 0.12);
      rod(last, p, 0.012, 0x233526);
      if (i < count) bulb(0.06, [0xff5959, 0xffd664, 0x00ff00, 0x0000ff][i % 4], p.x, p.y - 0.06, p.z);
      last = p;
    }
  } else if (kind === 'ornament') {
    pole(1.5);
    const ornament = ball(0.25, 0xd82f45, 0, 1.2, 0.22);
    ornament.material.roughness = 0.2;
    mesh(new THREE.TorusGeometry(0.06, 0.015, 4, 10), 0xf1c559, 0, 1.48, 0.22);
  } else if (kind === 'wreath') {
    pole(1.6);
    mesh(new THREE.TorusGeometry(0.35, 0.12, 6, 16), 0x20613c, 0, 1.1, 0.08);
    for (let i = 0; i < 8; i++) ball(0.045, 0xdc3344, Math.cos(i * Math.PI / 4) * 0.35, 1.1 + Math.sin(i * Math.PI / 4) * 0.35, 0.2);
    box(0.32, 0.13, 0.08, 0xe53442, 0, 0.77, 0.22);
  } else if (kind === 'christmas-tree') {
    pole(0.6);
    for (let i = 0; i < 3; i++) mesh(new THREE.ConeGeometry(0.65 - i * 0.16, 0.85, 9), 0x23683b, 0, 0.7 + i * 0.45, 0);
    for (let i = 0; i < 15; i++) {
      const y = 0.5 + i * 0.09, angle = i * 2.4, r = 0.54 - i * 0.023;
      bulb(0.055, [0xe6464c, 0xffd95c, 0x0000ff, 0x00ff00][i % 4], Math.cos(angle) * r, y, Math.sin(angle) * r);
    }
    mesh(new THREE.OctahedronGeometry(0.16), 0xffdf6e, 0, 2.08, 0, true);
  } else if (kind === 'pumpkin') {
    const pumpkin = ball(0.38, 0xe98622, 0, 0.3, 0); pumpkin.scale.y = 0.8;
    box(0.08, 0.15, 0.08, 0x47642b, 0, 0.64, 0);
    for (const x of [-0.13, 0.13]) mesh(new THREE.ConeGeometry(0.075, 0.11, 3), 0xffe57c, x, 0.37, 0.34, true);
    box(0.22, 0.055, 0.03, 0xffcf50, 0, 0.2, 0.36);
  } else if (kind === 'lantern') {
    pole(1.4);
    box(0.36, 0.06, 0.36, 0x292734, 0, 0.83, 0);
    mesh(new THREE.BoxGeometry(0.24, 0.32, 0.24), 0xffbb55, 0, 1.02, 0, true);
    mesh(new THREE.ConeGeometry(0.3, 0.2, 4), 0x292734, 0, 1.3, 0);
    for (const x of [-0.16, 0.16]) for (const z of [-0.16, 0.16]) box(0.035, 0.4, 0.035, 0x292734, x, 1.05, z);
  } else if (kind === 'ghost') {
    if (!options.floating) pole(1.6);
    const head = bulb(0.3, 0xf0f0ec, 0, 1.4, 0);
    head.userData.glowSize = 1.6; head.userData.glowPower = 2;
    mesh(new THREE.CylinderGeometry(0.28, 0.42, 0.6, 10, 1, true), 0xf0f0ec, 0, 1.08, 0, true);
    for (const x of [-0.1, 0.1]) ball(0.055, 0x242333, x, 1.45, 0.27);
    ball(0.07, 0x242333, 0, 1.26, 0.28);
  } else if (kind === 'web') {
    const ends = anchors || [{ point: new THREE.Vector3(-0.8, 1.05, 0), foot: new THREE.Vector3(-0.8, 0, 0) },
      { point: new THREE.Vector3(0.8, 1.05, 0), foot: new THREE.Vector3(0.8, 0, 0) }];
    for (const a of ends) if (a.foot) rod(a.foot, a.point, 0.04, 0x69452c);
    const { center, segments } = webLayout(ends);
    const threads = new THREE.Mesh(buildWebGeometry(segments), mat(0xdedee9, true));
    threads.userData.webStrands = segments;
    threads.userData.strandRadius = WEB_STRAND_RADIUS;
    group.add(threads);
    ball(0.06, 0xffffff, center.x, center.y, center.z, true);
  } else if (kind === 'snowman') {
    group.userData.balls = [0.55, 0.4, 0.28].map((r, i) => ball(r, 0xf5f9ff, 0, [0.5, 1.24, 1.79][i], 0));
    const accessories = new THREE.Group();
    group.userData.accessories = accessories;
    const before = new Set(group.children);
    for (const x of [-0.095, 0.095]) ball(0.033, 0x252530, x, 1.86, 0.24);
    const nose = mesh(new THREE.ConeGeometry(0.045, 0.26, 6), 0xef852a, 0, 1.78, 0.34); nose.rotation.x = Math.PI / 2;
    for (const y of [1.12, 1.28, 1.44]) ball(0.04, 0x252530, 0, y, 0.37);
    mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.22, 8), 0x252530, 0, 2.1, 0);
    mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.04, 10), 0x252530, 0, 1.98, 0);
    for (const side of [-1, 1]) {
      const arm = box(0.65, 0.055, 0.055, 0x785332, side * 0.58, 1.28, 0); arm.rotation.z = side * 0.25;
    }
    for (const child of [...group.children]) if (!before.has(child)) accessories.add(child);
    group.add(accessories);
  } else if (kind === 'ghost-gun') {
    box(0.2, 0.3, 0.22, 0x447799, 0, -0.22, 0);
    mesh(new THREE.CylinderGeometry(0.1, 0.15, 0.27, 10, 1, true), 0xaebdc4, 0, -0.47, 0);
    mesh(new THREE.TorusGeometry(0.12, 0.025, 5, 12), 0x66ddff, 0, -0.6, 0, true).rotation.x = Math.PI / 2;
    group.userData.muzzle = new THREE.Vector3(0, -0.62, 0);
  } else if (kind === 'sled') {
    box(0.6, 0.09, 1, 0xb95732, 0, 0.12, 0.1);
    for (const x of [-0.25, 0.25]) {
      box(0.04, 0.08, 1.2, 0x718494, x, 0.02, 0.1);
      const tip = box(0.04, 0.08, 0.25, 0x718494, x, 0.08, 0.76); tip.rotation.x = -0.65;
    }
  } else if (kind === 'gate') {
    pole(1.5, -1); pole(1.5, 1);
    for (const x of [-1, 1]) mesh(new THREE.BoxGeometry(0.35, 0.4, 0.025), 0xf0c040, x + 0.17, 1.28, 0);
  }
  return group;
}
