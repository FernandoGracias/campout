import * as THREE from 'three';
import { createGlobeUtils } from './globe-utils.js';

// Shared by gameplay and the launch preview. Generation order is deliberately
// unchanged: a seed must retain its trees, rocks, ponds, flowers and collisions.
export function createWorld(globePivot, GLOBE_RADIUS, rng) {
const { placeOnGlobe, latLonToWorld, randomPointOnSphere } = createGlobeUtils(GLOBE_RADIUS, rng);
const globeGeo = new THREE.SphereGeometry(GLOBE_RADIUS, 64, 64);
const globeMat = new THREE.MeshStandardMaterial({
  color: 0xffffff,
  roughness: 0.85,
  flatShading: false,
});
const globe = new THREE.Mesh(globeGeo, globeMat);
globe.receiveShadow = true;
globePivot.add(globe);

// --- TREES ---
function makeTree(height, trunkColor, foliageColor) {
  const group = new THREE.Group();

  const trunkGeo = new THREE.CylinderGeometry(height * 0.025, height * 0.04, height * 0.5, 6);
  const trunkMat = new THREE.MeshStandardMaterial({ color: trunkColor, roughness: 0.9 });
  const trunk = new THREE.Mesh(trunkGeo, trunkMat);
  trunk.position.y = height * 0.25;
  trunk.castShadow = true;
  group.add(trunk);

  const layers = 4 + Math.floor(rng() * 3);
  for (let i = 0; i < layers; i++) {
    const layerHeight = height * 0.15;
    const radius = (height * 0.18) * (1 - i * 0.1);
    const y = height * 0.45 + i * layerHeight * 0.65;
    const coneGeo = new THREE.ConeGeometry(radius, layerHeight, 7);
    const shade = new THREE.Color(foliageColor).offsetHSL(0, 0, (rng() - 0.5) * 0.05);
    const coneMat = new THREE.MeshStandardMaterial({ color: shade, roughness: 0.8, flatShading: true });
    const cone = new THREE.Mesh(coneGeo, coneMat);
    cone.position.y = y;
    cone.rotation.y = rng() * Math.PI;
    cone.castShadow = true;
    group.add(cone);
  }

  return group;
}

const collidables = [];
const trees = [];
for (let i = 0; i < 120; i++) {
  const { lat, lon } = randomPointOnSphere();
  const height = 3 + rng() * 3;
  const trunkColor = new THREE.Color().setHSL(0.07, 0.5 + rng() * 0.2, 0.2 + rng() * 0.1);
  const foliageColor = new THREE.Color().setHSL(0.35 + rng() * 0.05, 0.6 + rng() * 0.15, 0.18 + rng() * 0.08);
  const tree = makeTree(height, trunkColor, foliageColor);
  placeOnGlobe(tree, lat, lon, -0.15);
  globePivot.add(tree);
  trees.push({ obj: tree, lat, lon });
  collidables.push({ lat, lon, radius: 0.08 });
}

// Dense forest area
const forestCenterLat = -0.6;
const forestCenterLon = 3.5;
for (let i = 0; i < 60; i++) {
  const lat = forestCenterLat + (rng() - 0.5) * 1.0;
  const lon = forestCenterLon + (rng() - 0.5) * 1.0;
  const height = 3.5 + rng() * 3.5;
  const trunkColor = new THREE.Color().setHSL(0.07, 0.5 + rng() * 0.2, 0.15 + rng() * 0.1);
  const foliageColor = new THREE.Color().setHSL(0.35 + rng() * 0.04, 0.65 + rng() * 0.15, 0.14 + rng() * 0.06);
  const tree = makeTree(height, trunkColor, foliageColor);
  placeOnGlobe(tree, lat, lon, -0.15);
  globePivot.add(tree);
  trees.push({ obj: tree, lat, lon });
  collidables.push({ lat, lon, radius: 0.08 });
}

// --- ROCKS ---
const rockData = [];
for (let i = 0; i < 40; i++) {
  const { lat, lon } = randomPointOnSphere();
  const size = 0.2 + rng() * 0.5;
  const geo = new THREE.DodecahedronGeometry(size, 0);
  const shade = 0.4 + rng() * 0.2;
  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(shade, shade * 0.95, shade * 0.85),
    roughness: 0.9,
    flatShading: true,
  });
  const rock = new THREE.Mesh(geo, mat);
  rock.scale.set(1, 0.5 + rng() * 0.5, 1);
  rock.castShadow = true;
  placeOnGlobe(rock, lat, lon);
  globePivot.add(rock);
  rockData.push({ obj: rock, lat, lon, radius: size * 0.8 });
  collidables.push({ lat, lon, radius: size * 0.8 });
}

// --- LAKES ---
const lakeData = [];

function buildLake(lat, lon, radius) {
  lakeData.push({ lat, lon, radius });
}

// --- RIVER ---
const riverPaths = [];

function buildRiver(startLat, startLon, endLat, endLon, segments) {
  const waterWidth = 1.2;
  const pathPoints = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const lat = startLat + (endLat - startLat) * t + Math.sin(t * Math.PI * 6) * 0.2 + Math.sin(t * Math.PI * 14) * 0.08 + Math.sin(t * Math.PI * 3) * 0.12;
    const lon = startLon + (endLon - startLon) * t + Math.cos(t * Math.PI * 5) * 0.15 + Math.cos(t * Math.PI * 11) * 0.05 + Math.cos(t * Math.PI * 2.5) * 0.1;
    pathPoints.push({ lat, lon });
  }
  const maxGap = 0.15;
  const dense = [pathPoints[0]];
  for (let i = 1; i < pathPoints.length; i++) {
    const prev = pathPoints[i - 1];
    const cur = pathPoints[i];
    const a = latLonToWorld(prev.lat, prev.lon);
    const b = latLonToWorld(cur.lat, cur.lon);
    const dist = a.distanceTo(b);
    const subdivs = Math.max(1, Math.ceil(dist / maxGap));
    for (let s = 1; s <= subdivs; s++) {
      const t = s / subdivs;
      dense.push({ lat: prev.lat + (cur.lat - prev.lat) * t, lon: prev.lon + (cur.lon - prev.lon) * t });
    }
  }
  riverPaths.push({ points: dense, width: waterWidth });
}

const lakePosArray = [];
// One big proper lake
const bigLakeLat = 0.5;
const bigLakeLon = 1.2;
buildLake(bigLakeLat, bigLakeLon, 18.0);
lakePosArray.push({ lat: bigLakeLat, lon: bigLakeLon });

// A few smaller ponds
for (let i = 0; i < 3; i++) {
  const { lat, lon } = randomPointOnSphere();
  const radius = 1.5 + rng() * 1.5;
  buildLake(lat, lon, radius);
  lakePosArray.push({ lat, lon });
}

// One river: leaves one end of the lake, wraps around the globe, reconnects to the other end
buildRiver(bigLakeLat + 0.3, bigLakeLon, bigLakeLat - 0.3, bigLakeLon + Math.PI * 2, 500);

// Remove trees in water and spread out trees too close together
for (let i = trees.length - 1; i >= 0; i--) {
  const treePos = latLonToWorld(trees[i].lat, trees[i].lon);
  let inWater = false;
  for (const lake of lakeData) {
    const lakePos = latLonToWorld(lake.lat, lake.lon);
    const dist = treePos.distanceTo(lakePos);
    const angle = Math.atan2(treePos.z - lakePos.z, treePos.x - lakePos.x);
    const irregularRadius = lake.radius * (0.7 + 0.3 * Math.sin(angle * 3) + 0.15 * Math.sin(angle * 7 + 1));
    if (dist < irregularRadius) { inWater = true; break; }
  }
  if (!inWater) {
    for (const river of riverPaths) {
      for (let rIdx = 0; rIdx < river.points.length; rIdx += 10) {
        if (treePos.distanceTo(latLonToWorld(river.points[rIdx].lat, river.points[rIdx].lon)) < river.width + 0.3) { inWater = true; break; }
      }
      if (inWater) break;
    }
  }
  if (inWater) {
    globePivot.remove(trees[i].obj);
    trees.splice(i, 1);
    continue;
  }
  for (let j = i - 1; j >= 0; j--) {
    const otherPos = latLonToWorld(trees[j].lat, trees[j].lon);
    if (treePos.distanceTo(otherPos) < 0.8) {
      const pushLat = trees[i].lat + (trees[i].lat - trees[j].lat) * 0.75;
      const pushLon = trees[i].lon + (trees[i].lon - trees[j].lon) * 0.75;
      trees[i].lat = pushLat;
      trees[i].lon = pushLon;
      placeOnGlobe(trees[i].obj, pushLat, pushLon, -0.15);
      break;
    }
  }
}
// Remove rocks in water
for (let i = rockData.length - 1; i >= 0; i--) {
  const rockPos = latLonToWorld(rockData[i].lat, rockData[i].lon);
  let inWater = false;
  for (const lake of lakeData) {
    const lakePos = latLonToWorld(lake.lat, lake.lon);
    const dist = rockPos.distanceTo(lakePos);
    const angle = Math.atan2(rockPos.z - lakePos.z, rockPos.x - lakePos.x);
    const irregularRadius = lake.radius * (0.7 + 0.3 * Math.sin(angle * 3) + 0.15 * Math.sin(angle * 7 + 1));
    if (dist < irregularRadius) { inWater = true; break; }
  }
  if (inWater) {
    globePivot.remove(rockData[i].obj);
    rockData.splice(i, 1);
  }
}
// Rebuild collidables from current tree and rock positions
collidables.length = 0;
for (const t of trees) { collidables.push({ lat: t.lat, lon: t.lon, radius: 0.08 }); }
for (const r of rockData) { collidables.push({ lat: r.lat, lon: r.lon, radius: r.radius }); }

// --- FLOWERS ---
const flowers = [];
for (let i = 0; i < 60; i++) {
  const { lat, lon } = randomPointOnSphere();
  const flowerPos = latLonToWorld(lat, lon);
  let inWater = false;
  for (const lake of lakeData) {
    const lakePos = latLonToWorld(lake.lat, lake.lon);
    const dist = flowerPos.distanceTo(lakePos);
    const angle = Math.atan2(flowerPos.z - lakePos.z, flowerPos.x - lakePos.x);
    const irregularRadius = lake.radius * (0.7 + 0.3 * Math.sin(angle * 3) + 0.15 * Math.sin(angle * 7 + 1));
    if (dist < irregularRadius) { inWater = true; break; }
  }
  if (!inWater) {
    for (const river of riverPaths) {
      for (const rp of river.points) {
        if (flowerPos.distanceTo(latLonToWorld(rp.lat, rp.lon)) < river.width) { inWater = true; break; }
      }
      if (inWater) break;
    }
  }
  if (inWater) { i--; continue; }
  const group = new THREE.Group();
  const stemGeo = new THREE.CylinderGeometry(0.02, 0.02, 0.3, 3);
  const stemMat = new THREE.MeshStandardMaterial({ color: 0x3d7a2a });
  const stem = new THREE.Mesh(stemGeo, stemMat);
  stem.position.y = 0.15;
  group.add(stem);
  const petalColor = [0xff6b9d, 0xffd93d, 0xffffff, 0xc084fc, 0xff8c42][Math.floor(rng() * 5)];
  const petalGeo = new THREE.SphereGeometry(0.08, 5, 4);
  const petalMat = new THREE.MeshStandardMaterial({ color: petalColor });
  const petal = new THREE.Mesh(petalGeo, petalMat);
  petal.position.y = 0.32;
  petal.scale.y = 0.6;
  group.add(petal);
  placeOnGlobe(group, lat, lon);
  globePivot.add(group);
  flowers.push(group);
}

// --- DEFORM GLOBE (hills, lake basins, river channels) ---
// Simple noise function for hills
function noise2D(x, y) {
  const n = Math.sin(x * 1.3 + y * 0.7) * 0.5 + Math.sin(x * 0.5 - y * 1.1) * 0.3 + Math.sin(x * 2.1 + y * 1.9) * 0.2;
  return n;
}

const globePos = globeGeo.attributes.position;
const vertCount = globePos.count;
const colors = new Float32Array(vertCount * 3);
const baseGreen = new THREE.Color(0x4a8c3f);
const sandColor = new THREE.Color(0xe8c870);
const waterLevel = [];

for (let v = 0; v < vertCount; v++) {
  const vx = globePos.getX(v);
  const vy = globePos.getY(v);
  const vz = globePos.getZ(v);
  const vertPos = new THREE.Vector3(vx, vy, vz);
  const vertNorm = vertPos.clone().normalize();

  // Hills: displace outward based on noise
  const hillAmount = noise2D(vx * 0.3, vz * 0.3) * 0.8 + noise2D(vx * 0.7, vy * 0.5) * 0.4;
  let displacement = Math.max(0, hillAmount) * 0.7;

  // One big foothill
  const foothillPos = latLonToWorld(-0.3, 2.5);
  const foothillDist = vertPos.distanceTo(foothillPos);
  const foothillRadius = 6.0;
  if (foothillDist < foothillRadius) {
    const t = 1 - foothillDist / foothillRadius;
    displacement += t * t * 5.0;
  }

  // Lake depressions: irregular shapes using noise-modulated radius
  let isWater = false;
  for (const lake of lakeData) {
    const lakePos = latLonToWorld(lake.lat, lake.lon);
    const dist = vertPos.distanceTo(lakePos);
    const angle = Math.atan2(vertPos.z - lakePos.z, vertPos.x - lakePos.x);
    const irregularRadius = lake.radius * (0.7 + 0.3 * Math.sin(angle * 3) + 0.15 * Math.sin(angle * 7 + 1));
    if (dist < irregularRadius) {
      const t = 1 - dist / irregularRadius;
      const depthScale = lake.radius > 4 ? 5.0 : 1.5;
      displacement = -depthScale * t * t;
      isWater = true;
    } else if (dist < irregularRadius + 0.6) {
      const t = 1 - (dist - irregularRadius) / 0.6;
      displacement = Math.min(displacement, -0.3 * t);
      isWater = false;
      colors[v * 3] = sandColor.r;
      colors[v * 3 + 1] = sandColor.g;
      colors[v * 3 + 2] = sandColor.b;
      continue;
    }
  }

  // River channels
  for (const river of riverPaths) {
    for (let i = 0; i < river.points.length; i++) {
      const rp = latLonToWorld(river.points[i].lat, river.points[i].lon);
      const dist = vertPos.distanceTo(rp);
      if (dist < river.width + 0.3) {
        const t = Math.max(0, 1 - dist / (river.width + 0.3));
        displacement = Math.min(displacement, -1.2 * t);
        if (dist < river.width) isWater = true;
      }
      if (dist < river.width + 0.6 && dist >= river.width + 0.3) {
        const t = 1 - (dist - river.width - 0.3) / 0.3;
        if (t > 0) {
          colors[v * 3] = baseGreen.r + (sandColor.r - baseGreen.r) * t;
          colors[v * 3 + 1] = baseGreen.g + (sandColor.g - baseGreen.g) * t;
          colors[v * 3 + 2] = baseGreen.b + (sandColor.b - baseGreen.b) * t;
          continue;
        }
      }
    }
  }

  const newPos = vertPos.clone().addScaledVector(vertNorm, displacement);
  globePos.setXYZ(v, newPos.x, newPos.y, newPos.z);

  if (isWater) {
    colors[v * 3] = sandColor.r * 0.85;
    colors[v * 3 + 1] = sandColor.g * 0.85;
    colors[v * 3 + 2] = sandColor.b * 0.5;
  } else if (colors[v * 3] === 0) {
    const hillTint = Math.max(0, hillAmount) * 0.15;
    colors[v * 3] = baseGreen.r + hillTint * 0.3;
    colors[v * 3 + 1] = baseGreen.g + hillTint;
    colors[v * 3 + 2] = baseGreen.b + hillTint * 0.2;
  }

  waterLevel.push(isWater);
}

globeGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
globeMat.vertexColors = true;
globeMat.needsUpdate = true;
globePos.needsUpdate = true;
globeGeo.computeVertexNormals();

// Water sphere - sits just below ground level, visible wherever terrain dips
const WATER_RADIUS = GLOBE_RADIUS - 0.25;
const waterSphere = new THREE.Mesh(
  new THREE.SphereGeometry(WATER_RADIUS, 48, 48),
  new THREE.MeshStandardMaterial({
    color: 0x1a6b8a,
    roughness: 0.05,
    metalness: 0.4,
    transparent: true,
    opacity: 0.9,
  })
);
globePivot.add(waterSphere);
return { globe, trees, rockData, collidables, flowers, waterSphere, WATER_RADIUS };
}
