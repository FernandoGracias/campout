import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { iceImpulse, advanceOrbit } from './winter-physics.js?v=176';

// Winter coordinates are planet-local: tracks and projectiles stay put as campers walk.
export function createWinter(THREE, world) {
  const { scene, globePivot, globe, trees, waterSphere, radius, waterRadius } = world;
  const mobile = world.mobile === true;
  const up = new THREE.Vector3(0, 1, 0);
  const iceRadius = waterRadius + 0.05; // 25 cm shell: 5 cm above water, 20 cm below.
  let enabled = false, cover = 0.75, snowfall = 0.4, elapsed = 0;
  let held = false, packing = 0, lastAction = -10, throwPose = 0;
  let aiming = false, aimPitch = 0.3, aimYaw = 0, inputMode = 'keyboard', skates = false;
  let hintState = '';
  const BALL_RADIUS = 0.08, FLIGHT_STEP = 1 / 60, GRAVITY_MU = 12 * radius * radius;
  let throwPower = 9.5;
  const velocity = new THREE.Vector2();
  const button = document.getElementById('btn-snowball');
  const aimButton = document.getElementById('btn-aim');
  const skatesButton = document.getElementById('btn-skates');
  const crosshair = document.getElementById('snow-crosshair');
  const distancePanel = document.getElementById('aim-distance');
  const powerSlider = document.getElementById('throw-power');
  function setPower(value) {
    throwPower = THREE.MathUtils.clamp(value, 3, 20);
    powerSlider.value = throwPower;
    document.getElementById('throw-power-value').textContent = `${Math.round((throwPower - 3) / 17 * 100)}%`;
  }
  powerSlider.addEventListener('input', () => setPower(Number(powerSlider.value)));
  document.getElementById('throw-closer').addEventListener('click', () => setPower(throwPower - 0.75));
  document.getElementById('throw-farther').addEventListener('click', () => setPower(throwPower + 0.75));
  const snowAmount = { value: 0 };
  // Small static terrain patches let raycasts reject most of the globe cheaply.
  // This matters for dense snowfall and full-orbit previews; triangles stay exact.
  const terrainGroups = new Map(), terrainVertices = globe.geometry.attributes.position;
  const terrainIndices = globe.geometry.index.array;
  for (let i = 0; i < terrainIndices.length; i += 3) {
    const triangle = [0, 1, 2].map(j => new THREE.Vector3().fromBufferAttribute(terrainVertices, terrainIndices[i + j]));
    const center = triangle.reduce((sum, p) => sum.add(p), new THREE.Vector3()).normalize();
    const key = Math.min(7, Math.floor(Math.acos(THREE.MathUtils.clamp(center.y, -1, 1)) / Math.PI * 8)) * 16 +
      Math.min(15, Math.floor((Math.atan2(center.z, center.x) + Math.PI) / (Math.PI * 2) * 16));
    if (!terrainGroups.has(key)) terrainGroups.set(key, []);
    for (const p of triangle) terrainGroups.get(key).push(p.x, p.y, p.z);
  }
  const terrainPatches = [...terrainGroups.values()].map(positions => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry, globe.material); mesh.updateMatrixWorld(); return mesh;
  });
  const ray = new THREE.Raycaster();
  const snowMaterial = new THREE.MeshStandardMaterial({ color: 0xeaf5ff, roughness: 0.95, flatShading: true });
  const snowCaps = [];
  const shelters = [];
  const mobileFoliage = [];
  const treeColumns = trees.map(tree => ({ object: tree.obj, direction: tree.obj.position.clone().normalize() }));

  // Overlapping cones intercept vertical snowfall. Only the exposed outer skirt
  // of each lower tier is capped; open-ended meshes never whiten the undersides.
  for (const tree of trees) {
    const cones = tree.obj.children.filter(child => child.geometry?.type === 'ConeGeometry');
    for (let i = 0; i < cones.length; i++) {
      const cone = cones[i], p = cone.geometry.parameters;
      const top = i === cones.length - 1;
      if (mobile) {
        // camping-sim's vertex tinting, on the original cones and original shadows.
        const positions = cone.geometry.attributes.position, normals = cone.geometry.attributes.normal;
        const weights = new Float32Array(positions.count);
        for (let v = 0; v < positions.count; v++) {
          const heightRatio = (positions.getY(v) + p.height / 2) / p.height;
          weights[v] = normals.getY(v) < 0 ? 0 : top ? 1 : Math.max(0, 1 - heightRatio * 1.5);
        }
        cone.geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(positions.count * 3), 3));
        mobileFoliage.push({ cone, green: cone.material.color.clone(), weights });
        continue;
      }
      const exposed = top ? 1 : 0.1;
      const height = p.height * exposed;
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(
        top ? 0 : p.radius * (1 - exposed), p.radius, height, p.radialSegments, 1, true), snowMaterial);
      cap.position.y = cone.position.y - p.height / 2 + height / 2 + 0.018;
      cap.rotation.y = cone.rotation.y;
      cap.castShadow = true;
      cap.visible = false;
      tree.obj.add(cap);
      snowCaps.push(cap);
    }
    if (cones.length) shelters.push({ direction: tree.obj.position.clone().normalize(), radius: cones[0].geometry.parameters.radius });
  }

  // Bake the static caps into one draw call, rather than doubling forest draw calls.
  const capPositions = [], capNormals = [];
  for (const cap of snowCaps) {
    cap.parent.updateMatrix(); cap.updateMatrix();
    const transform = new THREE.Matrix4().multiplyMatrices(cap.parent.matrix, cap.matrix);
    const geometry = cap.geometry.toNonIndexed().applyMatrix4(transform);
    for (const n of geometry.attributes.position.array) capPositions.push(n);
    for (const n of geometry.attributes.normal.array) capNormals.push(n);
    cap.parent.remove(cap); cap.geometry.dispose(); geometry.dispose();
  }
  const capGeo = new THREE.BufferGeometry();
  capGeo.setAttribute('position', new THREE.Float32BufferAttribute(capPositions, 3));
  capGeo.setAttribute('normal', new THREE.Float32BufferAttribute(capNormals, 3));
  const capMaterial = snowMaterial.clone(); capMaterial.transparent = true;
  const canopySnow = new THREE.Mesh(capGeo, capMaterial);
  canopySnow.castShadow = true; canopySnow.visible = false; globePivot.add(canopySnow);
  snowCaps.length = 0;

  // A single spherical exposure texture avoids a per-fragment loop over the forest.
  // Gradients leave a little wind-blown snow beneath the lowest branches.
  const canvas = document.createElement('canvas');
  canvas.width = mobile ? 512 : 1024; canvas.height = mobile ? 256 : 512;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  for (const shelter of shelters) {
    const d = shelter.direction;
    const u = ((Math.atan2(d.z, -d.x) / (2 * Math.PI)) + 1) % 1;
    const v = Math.acos(THREE.MathUtils.clamp(d.y, -1, 1)) / Math.PI;
    const ry = shelter.radius / radius / Math.PI * canvas.height;
    const rx = ry / Math.max(0.08, Math.sqrt(1 - d.y * d.y));
    for (const wrap of [-1, 0, 1]) {
      ctx.save(); ctx.translate((u + wrap) * canvas.width, v * canvas.height); ctx.scale(rx, ry);
      const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, 1.25);
      gradient.addColorStop(0, 'rgba(0,0,0,0.98)');
      gradient.addColorStop(0.52, 'rgba(0,0,0,0.92)');
      gradient.addColorStop(0.8, 'rgba(0,0,0,0.35)');
      gradient.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = gradient; ctx.fillRect(-1.25, -1.25, 2.5, 2.5); ctx.restore();
    }
  }
  const exposure = new THREE.CanvasTexture(canvas);
  exposure.wrapS = THREE.RepeatWrapping;
  const originalColors = globe.geometry.attributes.color.array.slice();
  let groundDirty = false, lastBake = -1;
  let groundTexture = null, groundPixels = null, groundContext = null, shelterPixels = null;
  if (mobile) {
    const groundCanvas = document.createElement('canvas');
    groundCanvas.width = canvas.width; groundCanvas.height = canvas.height;
    groundContext = groundCanvas.getContext('2d');
    groundPixels = groundContext.createImageData(canvas.width, canvas.height);
    shelterPixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    groundTexture = new THREE.CanvasTexture(groundCanvas);
    groundTexture.generateMipmaps = false;
    groundTexture.minFilter = THREE.LinearFilter;
    groundTexture.wrapS = THREE.RepeatWrapping;
  }
  function bakeGround() {
    if (!mobile || !groundDirty || elapsed - lastBake < 0.12) return;
    lastBake = elapsed; groundDirty = false;
    const coated = enabled && cover > 0;
    for (const { cone, green, weights } of mobileFoliage) {
      const colors = cone.geometry.attributes.color;
      for (let v = 0; v < weights.length; v++) {
        const snow = coated ? weights[v] * cover : 0;
        colors.setXYZ(v, green.r + (1 - green.r) * snow, green.g + (1 - green.g) * snow, green.b + (1 - green.b) * snow);
      }
      colors.needsUpdate = true;
      if (cone.material.vertexColors !== coated) {
        cone.material.vertexColors = coated; cone.material.needsUpdate = true;
      }
      if (coated) cone.material.color.setHex(0xffffff);
      else cone.material.color.copy(green);
    }
    if (coated) {
      const w = canvas.width, h = canvas.height, cols = globe.geometry.parameters.widthSegments;
      const rows = globe.geometry.parameters.heightSegments, strength = cover * cover * (3 - 2 * cover);
      const snowRGB = [0.83, 0.91, 0.98];
      for (let y = 0; y < h; y++) {
        const gy = y / (h - 1) * rows, y0 = Math.min(rows - 1, Math.floor(gy)), fy = gy - y0;
        for (let x = 0; x < w; x++) {
          const gx = x / (w - 1) * cols, x0 = Math.min(cols - 1, Math.floor(gx)), fx = gx - x0;
          const base = (y0 * (cols + 1) + x0) * 3, lower = base + (cols + 1) * 3;
          const pixel = (y * w + x) * 4, snow = strength * shelterPixels[pixel] / 255;
          for (let c = 0; c < 3; c++) {
            const a = originalColors[base + c] * (1 - fx) + originalColors[base + 3 + c] * fx;
            const b = originalColors[lower + c] * (1 - fx) + originalColors[lower + 3 + c] * fx;
            const terrain = a * (1 - fy) + b * fy;
            groundPixels.data[pixel + c] = Math.round(255 * (terrain * (1 - snow) + snowRGB[c] * snow));
          }
          groundPixels.data[pixel + 3] = 255;
        }
      }
      groundContext.putImageData(groundPixels, 0, 0); groundTexture.needsUpdate = true;
    }
    // Keep the original terrain material, lighting and shadows; only bake our coating.
    if (globe.material.map !== (coated ? groundTexture : null)) {
      globe.material.map = coated ? groundTexture : null;
      globe.material.vertexColors = !coated;
      globe.material.needsUpdate = true;
    }
  }
  if (!mobile) globe.material.onBeforeCompile = shader => {
    shader.uniforms.winterSnow = snowAmount;
    shader.uniforms.snowExposure = { value: exposure };
    shader.vertexShader = 'varying vec2 snowUV;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <uv_vertex>', '#include <uv_vertex>\nsnowUV = uv;');
    shader.fragmentShader = 'uniform float winterSnow; uniform sampler2D snowExposure; varying vec2 snowUV;\n' + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
      float exposure = texture2D(snowExposure, snowUV).r;
      float grain = fract(sin(dot(floor(snowUV * vec2(4096.0, 2048.0)), vec2(12.9898,78.233))) * 43758.5453);
      float coating = smoothstep(0.0, 1.0, winterSnow) * exposure;
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.83, 0.91, 0.98) + grain * 0.035, coating);
    `);
  };
  globe.material.needsUpdate = true;

  const ice = new THREE.Mesh(new THREE.SphereGeometry(iceRadius, 128, 96),
    new THREE.MeshStandardMaterial({ color: 0x9bcbdc, roughness: 0.22, metalness: 0.22 }));
  ice.visible = false; ice.receiveShadow = true; globePivot.add(ice);

  function surface(direction) {
    ray.set(direction.clone().multiplyScalar(radius + 12), direction.clone().negate());
    const hit = ray.intersectObjects(terrainPatches, false)[0];
    return Math.max(hit ? hit.point.length() : radius, enabled ? iceRadius : waterRadius);
  }
  function exposureAt(direction) {
    let amount = 1;
    for (const shelter of shelters) {
      const distance = direction.distanceTo(shelter.direction) * radius / shelter.radius;
      amount = Math.min(amount, THREE.MathUtils.smoothstep(distance, 0.55, 1.3));
    }
    return amount;
  }

  // Fixed particle budget. Spawn in a cap over the viewer, then fall radially in
  // the shared planet frame. Each flake stops at its first tree/terrain surface.
  const flakeCount = 6400;
  const flakePositions = new Float32Array(flakeCount * 3);
  const flakeWeather = new Float32Array(flakeCount * 4);
  const flakes = Array.from({ length: flakeCount }, () => ({ direction: new THREE.Vector3(), live: false, floor: 0, speed: 0 }));
  const flakeGeo = new THREE.BufferGeometry();
  flakeGeo.setAttribute('position', new THREE.BufferAttribute(flakePositions, 3));
  flakeGeo.setAttribute('weather', new THREE.BufferAttribute(flakeWeather, 4));
  flakeGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), radius + 16);
  const flakeMat = new THREE.PointsMaterial({ color: 0xeaf5ff, size: 0.075, transparent: true, opacity: 0.85, depthWrite: false });
  flakeMat.onBeforeCompile = shader => {
    shader.fragmentShader = shader.fragmentShader.replace('#include <clipping_planes_fragment>',
      '#include <clipping_planes_fragment>\nif (length(gl_PointCoord - vec2(0.5)) > 0.5) discard;');
  };
  const snowTime = { value: 0 }, snowView = { value: new THREE.Vector3(0, 1, 0) };
  const fallingMaterial = flakeMat.clone();
  fallingMaterial.onBeforeCompile = shader => {
    flakeMat.onBeforeCompile(shader);
    shader.uniforms.snowTime = snowTime;
    shader.uniforms.snowView = snowView;
    shader.vertexShader = 'attribute vec4 weather; uniform float snowTime; uniform vec3 snowView;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>',
      'vec3 transformed = position * (weather.x + mod(weather.w - snowTime * weather.z, max(weather.y, 1.0)));');
    shader.vertexShader = shader.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>
      // No rasterization for uninitialized flakes or the far side of the globe.
      if (weather.y < 0.5 || dot(position, snowView) < 0.12) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    `);
  };
  const falling = new THREE.Points(flakeGeo, fallingMaterial);
  falling.visible = false; globePivot.add(falling);
  const floorCache = new Map();
  let flakeCursor = 0;
  function spawnFlake(flake, index, inverse) {
    flake.direction.set((Math.random() - 0.5) * 32, radius, (Math.random() - 0.5) * 32).normalize().applyQuaternion(inverse);
    const d = flake.direction;
    const key = `${Math.round(d.x * 128)},${Math.round(d.y * 128)},${Math.round(d.z * 128)}`;
    if (mobile && floorCache.has(key)) flake.floor = floorCache.get(key);
    else {
      flake.floor = surface(flake.direction);
      const nearby = treeColumns.filter(t => t.direction.distanceTo(flake.direction) * radius < 2);
      if (nearby.length) {
        const direction = flake.direction.clone().applyQuaternion(world.getRotation());
        ray.set(direction.clone().multiplyScalar(radius + 12), direction.clone().negate());
        const hit = ray.intersectObjects(nearby.map(t => t.object), true)[0];
        if (hit) flake.floor = Math.max(flake.floor, hit.point.length());
      }
      if (mobile) {
        if (floorCache.size >= 16000) floorCache.delete(floorCache.keys().next().value);
        floorCache.set(key, flake.floor);
      }
    }
    flake.speed = 1.5 + Math.random() * 1.8;
    const span = Math.max(2, radius + 15 - flake.floor);
    flakePositions.set([d.x, d.y, d.z], index * 3);
    flakeWeather.set([flake.floor, span, flake.speed, Math.random() * span + elapsed * flake.speed], index * 4);
    flake.live = true;
  }

  // Fifty prints per camper, recycled. Each subdivided sole follows the actual
  // terrain triangles instead of floating above hills or cutting into slopes.
  const soleCanvas = document.createElement('canvas');
  soleCanvas.width = 64; soleCanvas.height = 128;
  const sole = soleCanvas.getContext('2d');
  sole.fillStyle = '#fff';
  sole.beginPath(); sole.ellipse(32, 40, 25, 36, 0, 0, Math.PI * 2); sole.fill();
  sole.beginPath(); sole.roundRect(12, 83, 40, 37, 10); sole.fill();
  sole.globalCompositeOperation = 'destination-out'; sole.globalAlpha = 0.4;
  for (const y of [23, 40, 57, 96, 108]) sole.fillRect(9, y, 46, 4);
  const soleTexture = new THREE.CanvasTexture(soleCanvas);
  const tracks = new Map();
  function disposeTrack(track) {
    if (!track.batch) return;
    globePivot.remove(track.batch); track.batch.geometry.dispose(); track.batch.material.dispose();
  }
  function clearTracks() {
    for (const track of tracks.values()) disposeTrack(track);
    tracks.clear();
  }
  function updateTrack(id, mesh, inverse, delta) {
    const direction = mesh.position.clone().applyQuaternion(inverse).normalize();
    let track = tracks.get(id);
    if (!track) { track = { last: direction.clone(), distance: 0, count: 0, prints: [], batch: null }; tracks.set(id, track); }
    const distance = track.last.distanceTo(direction) * radius;
    track.last.copy(direction);
    const active = mesh.visible && !mesh.userData.skating && !mesh.userData.onIce && !mesh.userData.swimming && cover > 0.05;
    if (distance > 2 || !active) track.distance = 0;
    else track.distance += distance;
    if (active && track.distance > 0.42 && exposureAt(direction) * cover > 0.08) {
      track.distance %= 0.42;
      const index = track.count++ % 50;
      if (!track.batch) {
        const sole = new THREE.PlaneGeometry(0.14, 0.3, 2, 3), geometry = new THREE.BufferGeometry();
        const uvs = new Float32Array(50 * 12 * 2), indices = [];
        for (let i = 0; i < 50; i++) {
          uvs.set(sole.attributes.uv.array, i * 24);
          for (const vertex of sole.index.array) indices.push(vertex + i * 12);
        }
        geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(50 * 12 * 3), 3));
        geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
        geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(50 * 12 * 4), 4));
        geometry.setIndex(indices); sole.dispose();
        track.batch = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: 0x000000, map: soleTexture,
          vertexColors: true, transparent: true, opacity: 0.42, fog: false, toneMapped: false,
          alphaTest: 0.02, depthWrite: false, side: THREE.DoubleSide }));
        track.batch.frustumCulled = false; globePivot.add(track.batch);
      }
      const basis = mesh.quaternion.clone().premultiply(inverse);
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(basis);
      const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(basis);
      const center = direction.clone().multiplyScalar(radius).addScaledVector(right, track.count % 2 ? 0.13 : -0.13);
      const position = track.batch.geometry.attributes.position;
      for (let i = 0; i < 12; i++) {
        const x = (i % 3 / 2 - 0.5) * 0.14;
        const z = (0.5 - Math.floor(i / 3) / 3) * 0.3;
        const d = center.clone().addScaledVector(right, x).addScaledVector(forward, z).normalize();
        const point = d.multiplyScalar(surface(d) + 0.012);
        position.setXYZ(index * 12 + i, point.x, point.y, point.z);
      }
      position.needsUpdate = true;
      track.prints[index] = { born: track.count, at: elapsed };
    }
    if (track.batch) {
      const colors = track.batch.geometry.attributes.color;
      for (let i = 0; i < track.prints.length; i++) {
        const print = track.prints[i];
        const alpha = Math.min(1, (50 - track.count + print.born) / 12) *
          Math.max(0, 1 - (elapsed - print.at) / (snowfall > 0 ? 45 : 90));
        for (let v = 0; v < 12; v++) colors.setXYZW(i * 12 + v, 1, 1, 1, alpha);
      }
      colors.needsUpdate = true;
    }
  }

  const ballGeo = new THREE.IcosahedronGeometry(BALL_RADIUS, 1);
  const balls = [], receiveTimes = new Map();
  const burstCount = 160, burstPositions = new Float32Array(burstCount * 3);
  const bursts = Array.from({ length: burstCount }, () => ({ life: 0, p: new THREE.Vector3(), v: new THREE.Vector3() }));
  let burstCursor = 0;
  const burstGeo = new THREE.BufferGeometry();
  burstGeo.setAttribute('position', new THREE.BufferAttribute(burstPositions, 3));
  const spray = new THREE.Points(burstGeo, flakeMat); spray.frustumCulled = false; globePivot.add(spray);
  function splat(position) {
    for (let i = 0; i < 16; i++) {
      const b = bursts[burstCursor++ % burstCount];
      b.life = 0.3 + Math.random() * 0.3; b.p.copy(position);
      b.v.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(5);
    }
  }
  function launch(owner, position, velocity) {
    if (balls.length >= 32) globePivot.remove(balls.shift().mesh);
    const mesh = new THREE.Mesh(ballGeo, snowMaterial);
    mesh.position.copy(position); globePivot.add(mesh);
    balls.push({ owner, mesh, velocity, age: 0, accumulator: 0 });
  }
  function throwState() {
    const inverse = world.getRotation().clone().invert();
    const facing = aiming ? aimYaw : world.getFacing();
    const forward = new THREE.Vector3(Math.sin(facing), 0, Math.cos(facing));
    const pitch = aiming ? aimPitch : 0.3;
    const player = world.getPlayer(), ball = player.userData.winterEquipment?.ball;
    const hand = ball ? ball.getWorldPosition(new THREE.Vector3())
      : new THREE.Vector3(-0.25, 0.7, 0.3).applyAxisAngle(up, facing).add(player.position);
    return {
      position: hand.applyQuaternion(inverse),
      velocity: forward.multiplyScalar(Math.cos(pitch) * throwPower).addScaledVector(up, Math.sin(pitch) * throwPower).applyQuaternion(inverse),
    };
  }
  function action() {
    if (!enabled || !world.canAct() || elapsed - lastAction < 0.3 || packing > 0) return;
    const player = world.getPlayer();
    if (!held) {
      const d = player.position.clone().applyQuaternion(world.getRotation().clone().invert()).normalize();
      if (player.userData.onIce || cover * exposureAt(d) < 0.08) {
        world.toast('Find snowy ground to pack a snowball.'); return;
      }
      packing = 0.55; lastAction = elapsed; return;
    }
    held = false; lastAction = elapsed; throwPose = 0.3;
    const shot = throwState();
    launch(world.localId, shot.position, shot.velocity);
    world.send({ type: 'snowball', position: shot.position.toArray(), velocity: shot.velocity.toArray() });
  }
  function receive(id, message) {
    if (!enabled || !world.getPeers()[id] || elapsed - (receiveTimes.get(id) ?? -10) < 0.65) return;
    if (![message.position, message.velocity].every(v => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite))) return;
    const position = new THREE.Vector3(...message.position), speed = new THREE.Vector3(...message.velocity);
    const peer = world.getPeers()[id];
    const direction = up.clone().applyQuaternion(peer.currentGlobeRotation.clone().invert());
    if (position.length() < iceRadius || position.length() > radius + 9 || speed.length() > 20.01 || speed.length() < 2.99 ||
        direction.distanceTo(position.clone().normalize()) * radius > 2) return;
    receiveTimes.set(id, elapsed); launch(id, position, speed);
  }
  const flightRay = new THREE.Raycaster();
  const iceBounds = new THREE.Sphere(new THREE.Vector3(), iceRadius);
  let flightObstacles = [];
  // Preview and real throws use this same swept collision and fixed timestep.
  function flightHit(from, to, owner, inverse) {
    if (Math.min(from.length(), to.length()) > radius + 12) return null;
    const travel = to.clone().sub(from), length = travel.length();
    flightRay.set(from, travel.clone().normalize());
    flightRay.far = length + BALL_RADIUS;
    const terrainHit = flightRay.intersectObjects(terrainPatches, false)[0];
    let nearest = terrainHit ? { distance: terrainHit.distance, point: terrainHit.point, mesh: null } : null;
    const accept = (point, mesh = null) => {
      if (!point) return;
      const distance = from.distanceTo(point);
      if (distance <= length + BALL_RADIUS && (!nearest || distance < nearest.distance)) nearest = { distance, point, mesh };
    };
    accept(flightRay.ray.intersectSphere(iceBounds, new THREE.Vector3()));
    const campers = [[world.localId, world.getPlayer()], ...Object.entries(world.getPeers()).map(([id, p]) => [id, p.mesh])];
    for (const [id, mesh] of campers) {
      if (id === owner || !mesh.visible) continue;
      const center = mesh.position.clone().addScaledVector(mesh.position.clone().normalize(), 0.65).applyQuaternion(inverse);
      const bounds = new THREE.Sphere(center, 0.32 + BALL_RADIUS);
      accept(bounds.containsPoint(from) ? from.clone() : flightRay.ray.intersectSphere(bounds, new THREE.Vector3()), mesh);
    }
    const direction = from.clone().normalize();
    const nearby = treeColumns.filter(t => t.direction.distanceTo(direction) * radius < 2.5);
    if (nearby.length || flightObstacles.length) {
      flightRay.set(from.clone().applyQuaternion(world.getRotation()), travel.normalize().applyQuaternion(world.getRotation()));
      const hit = flightRay.intersectObjects([...nearby.map(t => t.object), ...flightObstacles], true)[0];
      if (hit) accept(hit.point.applyQuaternion(inverse));
    }
    if (!nearest && to.length() < iceRadius) nearest = { point: to.clone().normalize().multiplyScalar(iceRadius), mesh: null };
    return nearest;
  }
  function advanceFlight(position, speed) {
    const next = position.clone();
    advanceOrbit(next, speed, FLIGHT_STEP, GRAVITY_MU);
    return next;
  }
  const PREVIEW_STEPS = 240;
  const arcGeo = new LineGeometry().setPositions(new Float32Array((PREVIEW_STEPS + 1) * 3));
  const arc = new Line2(arcGeo, new LineMaterial({ color: 0xe32636, linewidth: 5, dashed: true,
    dashSize: 0.24, gapSize: 0.16, alphaToCoverage: true, depthWrite: false, toneMapped: false }));
  arc.computeLineDistances();
  arcGeo.instanceCount = 0;
  arc.frustumCulled = false; arc.visible = false; globePivot.add(arc);
  let previewAt = -10, impactPoint = null;
  let preview = null;
  const previewPoints = new Float32Array((PREVIEW_STEPS + 1) * 3);
  const previewDistances = new Float32Array(PREVIEW_STEPS + 1);
  function updateAim(inverse) {
    arc.visible = enabled && aiming && held && world.canAct();
    arc.material.resolution.set(innerWidth, innerHeight);
    crosshair.style.display = 'none';
    if (!arc.visible) return;
    if (!preview && elapsed - previewAt >= (mobile ? 0.14 : 0.08)) {
      previewAt = elapsed;
      const shot = throwState();
      preview = { position: shot.position, velocity: shot.velocity, count: 0, distance: 0 };
      previewPoints.set(shot.position.toArray(), 0); previewDistances[0] = 0;
    }
    if (preview) {
      // Finish into staging buffers; never show a half-updated arc or spend an
      // unbounded frame tracing an orbit on a phone.
      for (let work = 0; work < (mobile ? 32 : PREVIEW_STEPS); work++) {
        const i = preview.count, next = advanceFlight(preview.position, preview.velocity);
        const hit = flightHit(preview.position, next, i < 24 ? world.localId : null, inverse);
        if (hit) next.copy(hit.point);
        preview.distance += next.distanceTo(preview.position);
        preview.count++; preview.position = next;
        previewPoints.set(next.toArray(), preview.count * 3);
        previewDistances[preview.count] = preview.distance;
        if (hit || preview.count === PREVIEW_STEPS) {
          const { instanceStart: starts, instanceEnd: ends, instanceDistanceStart: distances, instanceDistanceEnd: endDistances } = arcGeo.attributes;
          for (let j = 0; j < preview.count; j++) {
            starts.setXYZ(j, previewPoints[j * 3], previewPoints[j * 3 + 1], previewPoints[j * 3 + 2]);
            ends.setXYZ(j, previewPoints[j * 3 + 3], previewPoints[j * 3 + 4], previewPoints[j * 3 + 5]);
            distances.setX(j, previewDistances[j]); endDistances.setX(j, previewDistances[j + 1]);
          }
          arcGeo.instanceCount = preview.count;
          starts.data.needsUpdate = distances.data.needsUpdate = true;
          impactPoint = hit ? next.clone() : null;
          preview = null;
          break;
        }
      }
    }
    {
      // The forecast never controls the camera or the movement basis.
      const shot = throwState();
      const target = impactPoint ?? shot.position.addScaledVector(shot.velocity.normalize(), 4);
      const screen = target.clone().applyQuaternion(world.getRotation()).project(world.camera);
      if (screen.z >= -1 && screen.z <= 1 && Math.abs(screen.x) < 1 && Math.abs(screen.y) < 1) {
        crosshair.style.display = 'block';
        crosshair.style.left = `${(screen.x * 0.5 + 0.5) * innerWidth}px`;
        crosshair.style.top = `${(-screen.y * 0.5 + 0.5) * innerHeight}px`;
      }
    }
  }
  function setAim(value) {
    const next = !!value && enabled && world.canAct();
    if (next !== aiming) {
      if (next) aimYaw = world.getFacing();
      aiming = next; preview = null; previewAt = -10; impactPoint = null;
      arcGeo.instanceCount = 0; refreshHints();
    }
    if (!aiming) { arc.visible = false; crosshair.style.display = 'none'; }
  }
  function adjustAim(change) { aimPitch = THREE.MathUtils.clamp(aimPitch + change, -0.35, 1.1); }
  function turnAim(change) { aimYaw = THREE.MathUtils.euclideanModulo(aimYaw + change + Math.PI, Math.PI * 2) - Math.PI; }
  function updateBalls(delta, inverse) {
    for (let i = balls.length - 1; i >= 0; i--) {
      const ball = balls[i]; let impact = false;
      ball.accumulator += delta;
      while (ball.accumulator >= FLIGHT_STEP && !impact) {
        ball.accumulator -= FLIGHT_STEP;
        const from = ball.mesh.position.clone();
        const to = advanceFlight(from, ball.velocity);
        const hit = flightHit(from, to, ball.age < 0.4 ? ball.owner : null, inverse);
        if (hit) {
          to.copy(hit.point); impact = true;
          if (hit.mesh) {
            hit.mesh.userData.snowHitUntil = elapsed + 0.45;
            if (hit.mesh === world.getPlayer()) world.toast('Snowball hit! ❄');
            else if (ball.owner === world.localId) world.toast('Direct hit! ❄');
          }
        }
        ball.mesh.position.copy(to);
        ball.age += FLIGHT_STEP;
      }
      if (impact) {
        if (impact) splat(ball.mesh.position);
        globePivot.remove(ball.mesh); balls.splice(i, 1);
      }
    }
    for (let i = 0; i < burstCount; i++) {
      const b = bursts[i]; b.life -= delta;
      if (b.life > 0) { b.v.addScaledVector(b.p.clone().normalize(), -8 * delta); b.p.addScaledVector(b.v, delta); }
      burstPositions.set(b.life > 0 ? b.p.toArray() : [0, 0, 0], i * 3);
    }
    burstGeo.attributes.position.needsUpdate = true;
    for (const mesh of [world.getPlayer(), ...Object.values(world.getPeers()).map(p => p.mesh)]) if (mesh.userData.snowHitUntil > elapsed) {
      mesh.rotateZ(Math.sin((mesh.userData.snowHitUntil - elapsed) * 24) * 0.12);
    }
  }

  const bladeGeo = new THREE.BoxGeometry(0.025, 0.045, 0.25);
  const bladeMaterial = new THREE.MeshStandardMaterial({ color: 0xa8b4be, roughness: 0.3, metalness: 0.7 });
  function equip(mesh, carrying, skating, moving) {
    const s = mesh.userData;
    if (!enabled && !s.winterEquipment) return;
    if (!s.winterEquipment) {
      const ball = new THREE.Mesh(ballGeo, snowMaterial);
      ball.position.set(0, -0.3, 0.015); s.rightArm.add(ball);
      const blades = [s.leftLeg, s.rightLeg].map(leg => {
        const blade = new THREE.Mesh(bladeGeo, bladeMaterial);
        blade.position.set(0, -0.42, 0.025); leg.add(blade); return blade;
      });
      s.winterEquipment = { ball, blades };
    }
    const hand = carrying ? s.leftArm : s.rightArm;
    if (s.flashlightStick.parent !== hand) {
      hand.add(s.flashlightStick);
      s.flashlightStick.position.x = carrying ? 0.01 : -0.01;
    }
    s.winterEquipment.ball.visible = enabled && carrying && mesh.visible;
    if (carrying) s.rightArm.rotation.x = -1.2;
    for (const blade of s.winterEquipment.blades) blade.visible = enabled && skating;
    if (enabled && skating && s.onIce) {
      const push = moving ? Math.sin(elapsed * 5) : 0;
      s.leftLeg.rotation.set(-0.08 + Math.max(0, push) * 0.18, 0, 0.04 + Math.max(0, push) * 0.16);
      s.rightLeg.rotation.set(-0.08 + Math.max(0, -push) * 0.18, 0, -0.04 - Math.max(0, -push) * 0.16);
      if (moving) mesh.rotateX(-0.06);
    }
  }
  const skateTracks = new Map(), MAX_CUTS = 512;
  function disposeCuts(id) {
    const track = skateTracks.get(id);
    if (!track) return;
    globePivot.remove(track.mesh); track.mesh.geometry.dispose(); track.mesh.material.dispose(); skateTracks.delete(id);
  }
  function updateSkateTracks(id, mesh, inverse, active) {
    let track = skateTracks.get(id);
    if (!track && !active) return;
    if (!track) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX_CUTS * 18), 3));
      geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(MAX_CUTS * 24), 4));
      const cuts = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0x000000, vertexColors: true,
        transparent: true, opacity: 0.22, depthWrite: false, fog: false, toneMapped: false, side: THREE.DoubleSide }));
      cuts.frustumCulled = false; globePivot.add(cuts);
      track = { mesh: cuts, last: null, cursor: 0, born: new Float64Array(MAX_CUTS).fill(-100) };
      skateTracks.set(id, track);
    }
    if (active) {
      mesh.updateMatrixWorld(true);
      const feet = mesh.userData.winterEquipment.blades.map(blade => {
        const direction = blade.getWorldPosition(new THREE.Vector3()).applyQuaternion(inverse).normalize();
        return direction.multiplyScalar(surface(direction) + 0.014);
      });
      const distance = track.last ? Math.max(...feet.map((foot, i) => foot.distanceTo(track.last[i]))) : 0;
      if (!track.last || distance > 1) track.last = feet;
      else if (distance > 0.07) {
        const positions = track.mesh.geometry.attributes.position;
        for (let side = 0; side < 2; side++) {
          const a = track.last[side], b = feet[side];
          const across = new THREE.Vector3().crossVectors(b.clone().sub(a), b.clone().normalize()).normalize()
            .multiplyScalar(mesh.userData.onIce ? 0.008 : 0.022);
          const corners = [a.clone().sub(across), a.clone().add(across), b.clone().sub(across), b.clone().add(across)];
          const index = track.cursor++ % MAX_CUTS;
          for (const [i, corner] of [0, 1, 2, 2, 1, 3].entries()) {
            const p = corners[corner].clone().normalize();
            p.multiplyScalar(surface(p) + 0.014);
            positions.setXYZ(index * 6 + i, p.x, p.y, p.z);
          }
          track.born[index] = elapsed;
        }
        positions.needsUpdate = true; track.last = feet;
      }
    } else track.last = null;
    const colors = track.mesh.geometry.attributes.color;
    for (let i = 0; i < MAX_CUTS; i++) {
      const alpha = THREE.MathUtils.clamp((35 - elapsed + track.born[i]) / 12, 0, 1);
      for (let v = 0; v < 6; v++) colors.setXYZW(i * 6 + v, 1, 1, 1, alpha);
    }
    colors.needsUpdate = true;
  }
  function toggleSkates() {
    if (!enabled || !world.canAct()) return;
    if (!skates && !world.getPlayer().userData.onIce) return;
    skates = !skates; world.getPlayer().userData.skating = skates;
    refreshHints();
  }
  function refreshHints() {
    const next = [packing > 0, held, aiming, skates, inputMode].join(':');
    if (hintState === next) return;
    hintState = next;
    const suffix = key => inputMode === 'touch' ? '' : ` · ${key}`;
    button.textContent = packing > 0 ? '❄ Packing…' :
      `❄ ${held ? 'Throw' : 'Pack'} snowball${suffix(inputMode === 'gamepad' ? 'RT' : 'Q')}`;
    aimButton.textContent = inputMode === 'touch' ? (aiming ? 'Stop aiming' : 'Aim')
      : `${aiming ? 'Aiming' : 'Aim'} · ${aiming ? 'Release' : 'Hold'} ${inputMode === 'gamepad' ? 'LT' : 'right mouse'}`;
    skatesButton.textContent = `${skates ? 'Remove' : 'Equip'} skates${suffix(inputMode === 'gamepad' ? 'LB' : 'C')}`;
    aimButton.setAttribute('aria-pressed', String(aiming));
    skatesButton.setAttribute('aria-pressed', String(skates));
  }
  function updateHints(mode) {
    if (inputMode !== mode) { inputMode = mode; setAim(false); }
    refreshHints();
  }
  function configure(state) {
    const wasEnabled = enabled, wasCover = cover;
    enabled = state.winter === true;
    cover = state.snowCover ?? 0.75; snowfall = state.snowfall ?? 0.4;
    snowAmount.value = enabled ? cover : 0;
    ice.visible = enabled; waterSphere.visible = !enabled;
    groundDirty ||= wasEnabled !== enabled || wasCover !== cover;
    canopySnow.visible = !mobile && enabled && cover > 0;
    capMaterial.opacity = Math.min(1, cover * 2);
    document.getElementById('winter-enabled').checked = enabled;
    for (const [id, value] of [['snow-cover', cover], ['snow-fall', snowfall]]) {
      document.getElementById(id).value = Math.round(value * 100);
      document.getElementById(id + '-value').textContent = `${Math.round(value * 100)}%`;
    }
    if (wasEnabled !== enabled) {
      clearTracks(); velocity.set(0, 0); held = false; packing = 0;
      for (const id of skateTracks.keys()) disposeCuts(id);
      if (!enabled) { skates = false; world.getPlayer().userData.skating = false; setAim(false); }
      for (const flake of flakes) flake.live = false;
      flakeWeather.fill(0); flakePositions.fill(0); floorCache.clear(); flakeCursor = 0;
      flakeGeo.attributes.position.needsUpdate = flakeGeo.attributes.weather.needsUpdate = true;
      for (const ball of balls) globePivot.remove(ball.mesh);
      balls.length = 0;
    }
    if (cover === 0 && wasCover > 0) clearTracks();
    button.style.display = enabled ? 'block' : 'none';
    refreshHints();
  }
  const iceContacts = new Map();
  let contactSerial = 0;
  function sharedVelocity() {
    return new THREE.Vector3(-velocity.y, 0, -velocity.x).applyQuaternion(world.getRotation().clone().invert()).toArray();
  }
  function addImpulse(impulse) {
    const local = new THREE.Vector3(...impulse).applyQuaternion(world.getRotation());
    velocity.x -= local.z; velocity.y -= local.x;
    if (velocity.length() > 0.6) velocity.setLength(0.6);
  }
  function iceContact(id) {
    const peer = world.getPeers()[id];
    if (!enabled || !world.canAct() || !world.getPlayer().userData.onIce || !peer?.mesh.visible ||
        !peer.mesh.userData.onIce || peer.motion?.sitting) return null;
    const here = up.clone().applyQuaternion(world.getRotation().clone().invert());
    const there = up.clone().applyQuaternion(peer.currentGlobeRotation.clone().invert());
    if (here.distanceTo(there) * radius > 1.2) return null;
    let state = iceContacts.get(id);
    if (!state) { state = { requestAt: -1000, solvedAt: -1000, serial: -1 }; iceContacts.set(id, state); }
    return { peer, state, normal: there.sub(here).normalize().toArray() };
  }
  function solveIceContact(id, contact) {
    const { peer, state, normal } = contact;
    const now = performance.now();
    if (now - state.solvedAt < 300) return;
    const otherVelocity = peer.motion?.iceVelocity ?? [0, 0, 0];
    const impulse = iceImpulse(sharedVelocity(), otherVelocity, normal);
    if (Math.hypot(...impulse) < 0.00001) return;
    state.solvedAt = now;
    addImpulse(impulse.map(n => -n));
    if (peer.motion) peer.motion.iceVelocity = otherVelocity.map((n, i) => n + impulse[i]);
    world.sendTo(id, { type: 'ice-contact', serial: ++contactSerial, impulse });
  }
  function collide(id) {
    const contact = iceContact(id);
    if (!contact) return false;
    // One authority per pair prevents two simultaneous detections doubling the impulse.
    if (world.localId < id) solveIceContact(id, contact);
    else if (performance.now() - contact.state.requestAt > 200) {
      contact.state.requestAt = performance.now();
      world.sendTo(id, { type: 'ice-contact', request: true });
    }
    return true;
  }
  function receiveIceContact(id, message) {
    const contact = iceContact(id);
    if (!contact) return;
    if (message.request === true) {
      if (world.localId < id) solveIceContact(id, contact);
      return;
    }
    const impulse = message.impulse;
    if (id >= world.localId || !Number.isSafeInteger(message.serial) || message.serial <= contact.state.serial ||
        !Array.isArray(impulse) || impulse.length !== 3 || !impulse.every(Number.isFinite) ||
        Math.hypot(...impulse) > 0.6 || impulse.reduce((sum, n, i) => sum + n * contact.normal[i], 0) > 0.001) return;
    contact.state.serial = message.serial;
    addImpulse(impulse);
  }
  function movement(forward, strafe, facing, delta, locked) {
    if (locked) { velocity.set(0, 0); return velocity; }
    const target = new THREE.Vector2(forward * Math.cos(facing) - strafe * Math.sin(facing),
      forward * Math.sin(facing) + strafe * Math.cos(facing));
    if (target.length() > 1) target.normalize();
    target.multiplyScalar(enabled && skates && world.getPlayer().userData.onIce ? 0.26 : 0.2);
    if (enabled && world.getPlayer().userData.onIce) {
      const steering = target.lengthSq() > 0 ? (skates ? 8 : 1.7) : (skates ? 2.8 : 0.65);
      velocity.lerp(target, 1 - Math.exp(-steering * delta));
      if (velocity.lengthSq() < 0.000001) velocity.set(0, 0);
    } else velocity.copy(target);
    return velocity;
  }
  function update(delta) {
    elapsed += delta;
    bakeGround();
    falling.visible = enabled && snowfall > 0;
    spray.visible = enabled;
    const player = world.getPlayer();
    const canAct = world.canAct();
    if (!canAct) { packing = 0; setAim(false); }
    equip(player, enabled && held && canAct, enabled && skates, velocity.lengthSq() > 0.0001);
    for (const peer of Object.values(world.getPeers())) {
      const fresh = performance.now() - peer.motionReceivedAt < 2000;
      equip(peer.mesh, enabled && fresh && !!peer.motion?.snowball,
        enabled && peer.mesh.userData.skating, peer.isWalking && peer.interpT < 1);
      if (peer.torch?.visible) peer.mesh.userData.flashlightLens.getWorldPosition(peer.torch.position);
    }
    aimButton.style.display = enabled ? 'block' : 'none';
    distancePanel.style.display = enabled && aiming && canAct ? 'block' : 'none';
    skatesButton.style.display = enabled && (skates || player.userData.onIce) ? 'block' : 'none';
    aimButton.disabled = !canAct;
    skatesButton.disabled = !canAct;
    if (!enabled) return;
    const inverse = world.getRotation().clone().invert();
    flightObstacles = world.getObstacles();
    const count = Math.round(flakeCount * snowfall);
    flakeGeo.setDrawRange(0, count);
    snowTime.value = elapsed;
    snowView.value.copy(world.camera.position).normalize().applyQuaternion(inverse);
    const here = up.clone().applyQuaternion(inverse);
    let spawnBudget = mobile ? 48 : 192, changed = false;
    // Once initialized, snowfall needs only a time uniform. Inspect a bounded
    // slice for cells left behind by walking; falling itself never raycasts.
    for (let scan = 0; scan < Math.min(count, mobile ? 192 : 768) && spawnBudget > 0; scan++) {
      const i = flakeCursor++ % count;
      const f = flakes[i];
      if (!f.live || f.direction.dot(here) < 0.6) {
        spawnBudget--; spawnFlake(f, i, inverse); changed = true;
      }
    }
    if (changed) flakeGeo.attributes.position.needsUpdate = flakeGeo.attributes.weather.needsUpdate = true;
    if (packing > 0) {
      packing -= delta;
      player.userData.leftArm.rotation.x = player.userData.rightArm.rotation.x = -1.1;
      if (packing <= 0) held = true;
    }
    if (throwPose > 0) { throwPose -= delta; player.userData.rightArm.rotation.x = -2.2 * Math.max(0, throwPose / 0.3); }
    refreshHints();
    button.disabled = !canAct;
    updateTrack(world.localId, player, inverse, delta);
    updateSkateTracks(world.localId, player, inverse, skates && (player.userData.onIce || cover > 0.05) && canAct);
    for (const [id, peer] of Object.entries(world.getPeers())) {
      updateTrack(id, peer.mesh, inverse, delta);
      updateSkateTracks(id, peer.mesh, inverse, peer.mesh.visible && peer.mesh.userData.skating && (peer.mesh.userData.onIce || cover > 0.05));
    }
    for (const [id, track] of tracks) if (id !== world.localId && !world.getPeers()[id]) {
      disposeTrack(track);
      tracks.delete(id); receiveTimes.delete(id);
      disposeCuts(id);
      iceContacts.delete(id);
    }
    updateAim(inverse);
    updateBalls(delta, inverse);
  }
  return { configure, movement, update, action, receive, setAim, adjustAim, turnAim, updateHints, toggleSkates,
    collide, receiveIceContact, sharedVelocity,
    moveFacing() {
      return world.getCameraAngle() + Math.PI;
    },
    get facing() { return aimYaw; },
    get snowy() { return enabled && (cover > 0 || snowfall > 0); },
    stop: () => velocity.set(0, 0), get aiming() { return aiming; },
    get holding() { return enabled && held && world.canAct(); },
    get skating() { return enabled && skates; },
    get enabled() { return enabled; }, iceRadius };
}
