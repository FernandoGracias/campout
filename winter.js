import { iceImpulse, advanceOrbit, ballisticArcs } from './winter-physics.js?v=190';

// Seasonal equipment uses planet-local coordinates, including summer pinecones.
export function createWinter(THREE, world) {
  const { scene, globePivot, globe, trees, waterSphere, radius, waterRadius } = world;
  const mobile = world.mobile === true;
  const up = new THREE.Vector3(0, 1, 0);
  const iceRadius = waterRadius + 0.05; // 25 cm shell: 5 cm above water, 20 cm below.
  let enabled = false, cover = 0.75, snowfall = 0.4, elapsed = 0;
  let held = false, heldCone = null, packing = 0, lastAction = -10, throwPose = 0;
  let inputMode = 'keyboard', skates = false;
  let hintState = '';
  const BALL_RADIUS = 0.08, FLIGHT_STEP = 1 / 60, GRAVITY_MU = 12 * radius * radius;
  const throwPower = 20;
  const SKY_CLIMB_TIME = 2, SKY_DECAY_TURNS = 50;
  const MAX_PROJECTILES = 100;
  const ORBIT_TRAIL_LENGTH = Math.PI * 2 * radius / 5, ORBIT_TRAIL_SECONDS = 2;
  const ORBIT_TRAIL_POINTS = Math.ceil(ORBIT_TRAIL_SECONDS / FLIGHT_STEP) + 2;
  const velocity = new THREE.Vector2();
  const button = document.getElementById('btn-snowball');
  const skatesButton = document.getElementById('btn-skates');
  const crosshair = document.getElementById('snow-crosshair');
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
  const snowTime = { value: 0 }, snowView = { value: new THREE.Vector3(0, 1, 0) }, snowBrightness = { value: 1.0 };
  const snowVelocity = { value: new THREE.Vector3(0, 0, 0) };
  const snowFlashPos = { value: new THREE.Vector3(0, 0, 0) };
  const snowFlashDir = { value: new THREE.Vector3(0, 0, 1) };
  const snowFlashOn = { value: 0.0 };
  const fallingMaterial = flakeMat.clone();
  fallingMaterial.onBeforeCompile = shader => {
    flakeMat.onBeforeCompile(shader);
    shader.uniforms.snowTime = snowTime;
    shader.uniforms.snowView = snowView;
    shader.uniforms.snowBrightness = snowBrightness;
    shader.uniforms.snowVelocity = snowVelocity;
    shader.uniforms.snowFlashPos = snowFlashPos;
    shader.uniforms.snowFlashDir = snowFlashDir;
    shader.uniforms.snowFlashOn = snowFlashOn;
    shader.vertexShader = 'attribute vec4 weather; uniform float snowTime; uniform vec3 snowView; uniform vec3 snowVelocity;\nuniform vec3 snowFlashPos; uniform vec3 snowFlashDir; uniform float snowFlashOn;\nvarying float vFlashLight;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `
      // Base fall animation along spawn direction
      float fallProgress = mod(weather.w - snowTime * weather.z, max(weather.y, 1.0));
      vec3 transformed = position * (weather.x + fallProgress);
      // Velocity-relative offset: flakes appear to rush past when moving fast
      float velocityScale = 12.0 * (1.0 - fallProgress / max(weather.y, 1.0));
      transformed += snowVelocity * velocityScale;
      // Calculate flashlight illumination per-flake
      vFlashLight = 0.0;
      if (snowFlashOn > 0.5) {
        vec3 toFlake = transformed - snowFlashPos;
        float dist = length(toFlake);
        if (dist < 25.0 && dist > 0.1) {
          vec3 toFlakeDir = toFlake / dist;
          float cone = dot(toFlakeDir, snowFlashDir);
          // Flashlight cone angle ~0.08 rad, so cos(0.08) ~ 0.997, widen to ~0.92 for visibility
          if (cone > 0.92) {
            float coneAttn = smoothstep(0.92, 0.98, cone);
            float distAttn = 1.0 - dist / 25.0;
            vFlashLight = coneAttn * distAttn * distAttn;
          }
        }
      }
    `);
    shader.vertexShader = shader.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>
      // No rasterization for uninitialized flakes or the far side of the globe.
      if (weather.y < 0.5 || dot(position, snowView) < 0.12) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    `);
    shader.fragmentShader = 'uniform float snowBrightness;\nvarying float vFlashLight;\n' + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>',
      '#include <color_fragment>\ndiffuseColor.rgb *= snowBrightness + vFlashLight * 0.8;');
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
  const coneProfile = [new THREE.Vector2(0.015, -0.12)];
  for (let row = 0; row < 6; row++) {
    const y = -0.105 + row * 0.04, width = 0.075 * Math.sin((row + 1) / 7 * Math.PI);
    coneProfile.push(new THREE.Vector2(width * 0.65, y), new THREE.Vector2(width, y + 0.015));
  }
  coneProfile.push(new THREE.Vector2(0.008, 0.15));
  const coneGeo = new THREE.LatheGeometry(coneProfile, 10);
  const coneMaterial = new THREE.MeshStandardMaterial({ color: 0x89512e, roughness: 1, flatShading: true });
  const PICKUP_DISTANCE = 0.65;
  const cones = [];
  // Deterministic positions let every camper refer to the same cone by index.
  for (let i = 0; i < treeColumns.length; i++) {
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
  function drawCone(index, visible) {
    const cone = cones[index];
    coneTransform.position.copy(cone.position);
    coneTransform.quaternion.setFromUnitVectors(up, cone.direction);
    coneTransform.rotateZ(Math.PI / 2); coneTransform.rotateY(index * 1.7);
    coneTransform.scale.setScalar(visible ? 1 : 0);
    coneTransform.updateMatrix(); groundCones.setMatrixAt(index, coneTransform.matrix);
    groundCones.instanceMatrix.needsUpdate = true;
    groundCones.boundingSphere = null;
  }
  cones.forEach((cone, index) => drawCone(index, true));
  function nearbyCone(preferred = null) {
    const foot = world.getPlayer().position.clone().applyQuaternion(world.getRotation().clone().invert());
    let nearest = null, distance = PICKUP_DISTANCE;
    for (const [id, cone] of cones.entries()) {
      if ((preferred !== null && preferred !== id) || cone.availableAt > elapsed) continue;
      const separation = foot.distanceTo(cone.position);
      if (separation <= distance) { nearest = id; distance = separation; }
    }
    return nearest;
  }
  function takeCone(id) {
    cones[id].availableAt = Infinity;
    drawCone(id, false);
  }
  function receivePickup(id, message) {
    const peer = world.getPeers()[id], cone = cones[message.cone];
    if (enabled || !peer || !Number.isSafeInteger(message.cone) || !cone || cone.availableAt > elapsed) return;
    const foot = up.clone().applyQuaternion(peer.currentGlobeRotation.clone().invert()).multiplyScalar(peer.mesh.position.length());
    if (foot.distanceTo(cone.position) > PICKUP_DISTANCE + 0.25) return;
    takeCone(message.cone);
  }
  const balls = [], receiveTimes = new Map();
  let moonFlareTexture = null;
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
  function landCone(id, position) {
    const cone = cones[id];
    if (!cone) return;
    cone.direction.copy(position).normalize();
    cone.position.copy(cone.direction).multiplyScalar(surface(cone.direction) + 0.075);
    cone.availableAt = 0; drawCone(id, true);
  }
  function createOrbitTrail(position, kind) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(ORBIT_TRAIL_POINTS * 3), 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(ORBIT_TRAIL_POINTS * 3), 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setDrawRange(0, 0);
    const material = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true,
      opacity: 0.65, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    const line = new THREE.Line(geometry, material);
    line.frustumCulled = false; globePivot.add(line);
    return { line, color: new THREE.Color(kind === 'pinecone' ? 0xffc477 : 0xaaddff), distance: 0,
      points: [{ position: position.clone(), age: 0, distance: 0 }] };
  }
  function updateOrbitTrail(ball) {
    const trail = ball.trail;
    if (!trail) return;
    const points = trail.points, position = ball.mesh.position;
    trail.distance += position.distanceTo(points[points.length - 1].position);
    points.push({ position: position.clone(), age: ball.age, distance: trail.distance });
    // Bound actual path length, not orbital angle: high-altitude trails must
    // also stay shorter than one fifth of the globe's surface circumference.
    while (points.length > 1 && (points.length > ORBIT_TRAIL_POINTS ||
        ball.age - points[0].age > ORBIT_TRAIL_SECONDS ||
        trail.distance - points[0].distance > ORBIT_TRAIL_LENGTH)) points.shift();
    const positions = trail.line.geometry.attributes.position, colors = trail.line.geometry.attributes.color;
    const length = Math.max(1e-6, trail.distance - points[0].distance);
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      const fade = (p.distance - points[0].distance) / length;
      positions.setXYZ(i, p.position.x, p.position.y, p.position.z);
      // Additive black at the tail fades smoothly into the scene background.
      colors.setXYZ(i, trail.color.r * fade * fade, trail.color.g * fade * fade, trail.color.b * fade * fade);
    }
    positions.needsUpdate = colors.needsUpdate = true;
    trail.line.geometry.setDrawRange(0, points.length);
  }
  function removeOrbitTrail(ball) {
    if (!ball.trail) return;
    const { line } = ball.trail;
    globePivot.remove(line); line.geometry.dispose(); line.material.dispose();
    ball.trail = null;
  }
  function removeProjectileVisuals(ball) {
    removeOrbitTrail(ball);
    removeMoonFlare(ball);
    globePivot.remove(ball.mesh);
  }
  function createMoonFlare(mesh) {
    if (!moonFlareTexture) {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 64;
      const ctx = canvas.getContext('2d');
      const glow = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
      glow.addColorStop(0, 'rgba(255,255,255,1)');
      glow.addColorStop(0.12, 'rgba(220,235,255,0.9)');
      glow.addColorStop(0.4, 'rgba(160,195,255,0.25)');
      glow.addColorStop(1, 'rgba(140,180,255,0)');
      ctx.fillStyle = glow; ctx.fillRect(0, 0, 64, 64);
      moonFlareTexture = new THREE.CanvasTexture(canvas);
    }
    // Only orbital snowballs get an individual reflective material. The shared
    // snow material also belongs to held balls, snowfall, and scenery.
    mesh.material = snowMaterial.clone();
    mesh.material.roughness = 0.22;
    mesh.material.emissive.set(0x9dbfff);
    mesh.material.emissiveIntensity = 0;
    const flare = new THREE.Sprite(new THREE.SpriteMaterial({ map: moonFlareTexture,
      color: 0xddeaff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending,
      depthWrite: false, depthTest: true, toneMapped: false }));
    flare.visible = false; mesh.add(flare);
    return flare;
  }
  function removeMoonFlare(ball) {
    if (!ball.flare) return;
    ball.mesh.remove(ball.flare); ball.flare.material.dispose();
    ball.mesh.material.dispose(); ball.mesh.material = snowMaterial;
    ball.flare = null;
  }
  function updateMoonFlares(lighting, inverse) {
    const moonDirection = lighting?.moonDirection?.clone().applyQuaternion(inverse).normalize();
    const cameraPosition = world.camera.getWorldPosition(new THREE.Vector3());
    globePivot.worldToLocal(cameraPosition);
    // Keep a little reflected light even with the room's moonlight slider low.
    const moonStrength = moonDirection ? (1 - lighting.daylight) * (0.25 + lighting.moonlight * 0.75) : 0;
    const shadowRadius = Math.max(radius, enabled ? iceRadius : waterRadius);
    for (const ball of balls) {
      if (!ball.flare) continue;
      ball.flare.visible = false;
      ball.mesh.material.emissiveIntensity = 0;
      if (moonStrength <= 0) continue;
      const position = ball.mesh.position;
      const alongMoon = position.dot(moonDirection);
      const shadowDistance = Math.sqrt(Math.max(0, position.lengthSq() - alongMoon * alongMoon));
      const exposure = alongMoon >= 0 ? 1 : THREE.MathUtils.smoothstep(shadowDistance, shadowRadius, shadowRadius + 0.35);
      if (exposure <= 0) continue;
      const view = cameraPosition.clone().sub(position).normalize();
      const half = moonDirection.clone().add(view).normalize();
      const radial = position.clone().normalize();
      const tangent = ball.orbit.normal.clone().cross(radial);
      // A slowly tumbling icy facet gives a short reflection only when the
      // moon, facet and this viewer align, rather than a constant blinking lamp.
      const tumble = ball.age * 1.7;
      const facet = radial.multiplyScalar(Math.cos(tumble)).addScaledVector(tangent, Math.sin(tumble))
        .addScaledVector(ball.orbit.normal, Math.sin(tumble * 0.63) * 0.6).normalize();
      const glint = Math.pow(Math.abs(facet.dot(half)), 48);
      const phase = 0.15 + 0.85 * Math.pow((1 + moonDirection.dot(view)) / 2, 2);
      const reflected = moonStrength * exposure;
      ball.mesh.material.emissiveIntensity = reflected * (0.12 * phase + glint * 1.5);
      ball.flare.material.opacity = reflected * (0.025 * phase + glint * 0.9);
      ball.flare.scale.setScalar(0.2 + Math.sqrt(glint) * 1.1);
      ball.flare.visible = true;
    }
  }
  function launch(owner, position, velocity, kind = enabled ? 'snowball' : 'pinecone', cone = null, skyOrbit = false) {
    if (balls.length >= MAX_PROJECTILES) {
      const oldest = balls.shift();
      if (oldest.kind === 'pinecone') landCone(oldest.cone, oldest.mesh.position);
      removeProjectileVisuals(oldest);
    }
    const mesh = new THREE.Mesh(kind === 'pinecone' ? coneGeo : ballGeo, kind === 'pinecone' ? coneMaterial : snowMaterial);
    mesh.position.copy(position); globePivot.add(mesh);
    let orbit = null;
    if (skyOrbit) {
      const radial = position.clone().normalize();
      const radialSpeed = velocity.dot(radial);
      const tangent = velocity.clone().addScaledVector(radial, -radialSpeed);
      // Exactly vertical throws still need a repeatable orbital plane on peers.
      if (tangent.lengthSq() < 1e-8) {
        tangent.set(Math.abs(radial.x) < 0.8 ? 1 : 0, 0, Math.abs(radial.x) < 0.8 ? 0 : 1);
        tangent.addScaledVector(radial, -tangent.dot(radial));
      }
      orbit = {
        normal: radial.clone().cross(tangent).normalize(),
        radialSpeed,
        tangentSpeed: Math.max(6, velocity.clone().addScaledVector(radial, -radialSpeed).length()),
        // Lose the eventual altitude over roughly fifty clear revolutions.
        decayPerRadian: Math.max(0.1, position.length() + Math.max(0, radialSpeed) * SKY_CLIMB_TIME -
          (enabled ? iceRadius : waterRadius)) / (Math.PI * 2 * SKY_DECAY_TURNS)
      };
    }
    const trail = orbit ? createOrbitTrail(position, kind) : null;
    const flare = orbit && kind === 'snowball' ? createMoonFlare(mesh) : null;
    balls.push({ owner, mesh, velocity, kind, cone, orbit, trail, flare, age: 0, accumulator: 0 });
  }
  function throwState() {
    const inverse = world.getRotation().clone().invert();
    const facing = world.getFacing();
    const player = world.getPlayer(), ball = player.userData.winterEquipment?.ball;
    const hand = ball ? ball.getWorldPosition(new THREE.Vector3())
      : new THREE.Vector3(-0.25, 0.7, 0.3).applyAxisAngle(up, facing).add(player.position);
    // The fixed crosshair chooses the destination. Solve the launch arc in the
    // planet's frame so gravity and curvature carry the ball to that point.
    const centerRay = new THREE.Raycaster();
    centerRay.setFromCamera(new THREE.Vector2(0, 0), world.camera);
    const hit = pointerHit(centerRay);
    const viewDirection = world.camera.getWorldDirection(new THREE.Vector3());
    const position = hand.clone().applyQuaternion(inverse);
    if (hit && hit.point.clone().sub(hand).dot(viewDirection) > 0.2) {
      const target = hit.point.clone().applyQuaternion(inverse);
      flightObstacles = world.getObstacles();
      let fallback = null;
      for (const arc of ballisticArcs(position, target, GRAVITY_MU, enabled ? iceRadius : waterRadius, throwPower)) {
        const velocity = new THREE.Vector3(arc.velocity.x, arc.velocity.y, arc.velocity.z);
        fallback ??= velocity;
        let blocked = false;
        for (let i = 1; i < arc.points.length; i++) {
          const from = arc.points[i-1], to = arc.points[i];
          const contact = flightHit(new THREE.Vector3(from.x,from.y,from.z), new THREE.Vector3(to.x,to.y,to.z),
            i <= 24 ? world.localId : null, inverse);
          if (contact) {
            blocked = contact.point.distanceTo(target) > BALL_RADIUS*2+0.04;
            break;
          }
        }
        if (!blocked) return { position, velocity };
      }
      // Cover may block every route. Still use a globe-clearing arc, never the
      // straight underground chord. Real collisions remain authoritative.
      if (fallback) return { position, velocity: fallback };
      const radial = position.clone().normalize();
      const tangent = target.clone().addScaledVector(radial,-target.dot(radial)).normalize();
      return { position, velocity: tangent.add(radial).normalize().multiplyScalar(throwPower), skyOrbit: true };
    }
    // Looking into empty sky has no surface destination to compensate toward.
    return { position, velocity: viewDirection.multiplyScalar(throwPower).applyQuaternion(inverse), skyOrbit: true };
  }
  function action(preferredCone = null) {
    if (!world.canAct() || elapsed - lastAction < 0.3 || packing > 0) return;
    const player = world.getPlayer();
    if (!held) {
      if (!enabled) {
        const id = nearbyCone(Number.isInteger(preferredCone) ? preferredCone : null);
        if (id === null) return;
        takeCone(id); held = true; heldCone = id; lastAction = elapsed;
        world.send({ type: 'pinecone-pickup', cone: id });
        updateCrosshair(); refreshHints();
        return;
      }
      const d = player.position.clone().applyQuaternion(world.getRotation().clone().invert()).normalize();
      if (player.userData.onIce || cover * exposureAt(d) < 0.08) {
        world.toast('Find snowy ground to pack a snowball.'); return;
      }
      packing = 0.55; lastAction = elapsed; return;
    }
    const shot = throwState();
    held = false; lastAction = elapsed; throwPose = 0.3;
    updateCrosshair();
    launch(world.localId, shot.position, shot.velocity, enabled ? 'snowball' : 'pinecone', heldCone, shot.skyOrbit);
    world.send({ type: enabled ? 'snowball' : 'pinecone', cone: heldCone, position: shot.position.toArray(), velocity: shot.velocity.toArray(), skyOrbit: shot.skyOrbit === true });
    heldCone = null;
  }
  function pointerHit(pointerRay) {
    const campers = Object.values(world.getPeers()).map(peer => peer.mesh).filter(mesh => mesh.visible);
    const roots = [globe, enabled ? ice : waterSphere, groundCones, ...trees.map(tree => tree.obj), ...world.getObstacles(), ...campers].filter(mesh => mesh.visible);
    return pointerRay.intersectObjects(roots, true).find(hit => {
      if (hit.object.isSprite) return false;
      if (hit.object === groundCones && cones[hit.instanceId]?.availableAt > elapsed) return false;
      for (let mesh = hit.object; mesh; mesh = mesh.parent) if (!mesh.visible) return false;
      return true;
    });
  }
  function interact(pointerRay) {
    if (!world.canAct()) return false;
    if (held) { action(); return true; }
    const hit = pointerHit(pointerRay);
    if (!enabled) {
      const id = nearbyCone(hit?.object === groundCones ? hit.instanceId : null);
      if (id === null) return false;
      action(id); return true;
    }
    if (!hit) return false;
    const direction = hit.point.clone().applyQuaternion(world.getRotation().clone().invert()).normalize();
    if (hit.object !== globe || cover * exposureAt(direction) < 0.08) return false;
    action();
    return true;
  }
  function receive(id, message) {
    if (!world.getPeers()[id] || elapsed - (receiveTimes.get(id) ?? -10) < 0.3) return;
    if (message.type !== (enabled ? 'snowball' : 'pinecone')) return;
    if (message.skyOrbit !== undefined && typeof message.skyOrbit !== 'boolean') return;
    if (![message.position, message.velocity].every(v => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite))) return;
    const position = new THREE.Vector3(...message.position), speed = new THREE.Vector3(...message.velocity);
    const peer = world.getPeers()[id];
    const direction = up.clone().applyQuaternion(peer.currentGlobeRotation.clone().invert());
    if (position.length() < (enabled ? iceRadius : waterRadius) || position.length() > radius + 9 || speed.length() > 20.01 || speed.length() < 2.99 ||
        direction.distanceTo(position.clone().normalize()) * radius > 2) return;
    if (message.type === 'pinecone') {
      if (!Number.isSafeInteger(message.cone) || !cones[message.cone]) return;
      takeCone(message.cone);
    }
    receiveTimes.set(id, elapsed); launch(id, position, speed, message.type, message.cone, message.skyOrbit === true);
  }
  const flightRay = new THREE.Raycaster();
  const iceBounds = new THREE.Sphere(new THREE.Vector3(), iceRadius);
  let flightObstacles = [];
  // Swept collisions and a fixed timestep keep fast throws from tunneling.
  function flightHit(from, to, owner, inverse) {
    if (Math.min(from.length(), to.length()) > radius + 12) return null;
    const travel = to.clone().sub(from), length = travel.length();
    flightRay.set(from, travel.clone().normalize());
    flightRay.far = length + BALL_RADIUS;
    const terrainHit = flightRay.intersectObjects(terrainPatches, false)[0];
    let nearest = terrainHit ? { distance: terrainHit.distance, point: terrainHit.point, mesh: null, tent: null } : null;
    const accept = (point, mesh = null, tent = null) => {
      if (!point) return;
      const distance = from.distanceTo(point);
      if (distance <= length + BALL_RADIUS && (!nearest || distance < nearest.distance)) nearest = { distance, point, mesh, tent };
    };
    iceBounds.radius = enabled ? iceRadius : waterRadius;
    accept(flightRay.ray.intersectSphere(iceBounds, new THREE.Vector3()));
    const campers = [[world.localId, world.getPlayer()], ...Object.entries(world.getPeers()).map(([id, p]) => [id, p.mesh])];
    for (const [id, mesh] of campers) {
      if (id === owner || !mesh.visible) continue;
      const radial = mesh.position.clone().normalize();
      // Match both the torso and visible head. The old torso-only sphere ended
      // at chin height, so a correctly calculated head shot could pass through.
      for (const [height, bodyRadius] of [[0.65, 0.32], [1.05, 0.18]]) {
        const center = mesh.position.clone().addScaledVector(radial, height).applyQuaternion(inverse);
        const bounds = new THREE.Sphere(center, bodyRadius + BALL_RADIUS);
        accept(bounds.containsPoint(from) ? from.clone() : flightRay.ray.intersectSphere(bounds, new THREE.Vector3()), mesh);
      }
    }
    const direction = from.clone().normalize();
    const nearby = treeColumns.filter(t => t.direction.distanceTo(direction) * radius < 2.5);
    if (nearby.length || flightObstacles.length) {
      flightRay.set(from.clone().applyQuaternion(world.getRotation()), travel.normalize().applyQuaternion(world.getRotation()));
      // Check trees first
      const treeHit = flightRay.intersectObjects(nearby.map(t => t.object), true)[0];
      if (treeHit) accept(treeHit.point.applyQuaternion(inverse));
      // Check obstacles (tents, rocks) - track which tent was hit
      const obstacleHit = flightRay.intersectObjects(flightObstacles, true)[0];
      if (obstacleHit) {
        // Find which tent this obstacle belongs to
        let hitTent = null;
        for (const obs of flightObstacles) {
          if (obstacleHit.object === obs || obstacleHit.object.parent === obs) {
            const tentOwner = world.getTentOwner?.(obs);
            if (tentOwner) hitTent = { mesh: obs, owner: tentOwner };
            break;
          }
        }
        accept(obstacleHit.point.applyQuaternion(inverse), null, hitTent);
      }
    }
    if (!nearest && to.length() < iceBounds.radius) nearest = { point: to.clone().normalize().multiplyScalar(iceBounds.radius), mesh: null, tent: null };
    return nearest;
  }
  function advanceFlight(position, speed, orbit) {
    const next = position.clone();
    if (!orbit) {
      // Must match ballisticArcs exactly: no sky-only forces on solved shots.
      advanceOrbit(next, speed, FLIGHT_STEP, GRAVITY_MU);
      return next;
    }
    // Arcade circular gravity: inward acceleration is vt²/r, rather than a
    // fixed inverse-square field that turns elevated launches into ellipses.
    // Integrate the rotation exactly to avoid numerical decay across 50 laps.
    // The launch's outward speed fades without reversing into a plunging return.
    const r = position.length();
    const damping = Math.exp(-FLIGHT_STEP / SKY_CLIMB_TIME);
    const climb = orbit.radialSpeed * SKY_CLIMB_TIME * (1 - damping);
    const angle = orbit.tangentSpeed * FLIGHT_STEP / Math.max(1, r + climb / 2);
    const nextRadius = Math.max(0.1, r + climb - orbit.decayPerRadian * angle);
    const radial = next.divideScalar(r).applyAxisAngle(orbit.normal, angle);
    orbit.radialSpeed *= damping;
    speed.copy(orbit.normal).cross(radial).multiplyScalar(orbit.tangentSpeed)
      .addScaledVector(radial, orbit.radialSpeed - orbit.decayPerRadian * orbit.tangentSpeed / nextRadius);
    next.multiplyScalar(nextRadius);
    return next;
  }
  function updateCrosshair() {
    let canShow = false;
    try { canShow = world.canAct(); } catch { /* not yet initialized */ }
    crosshair.style.display = canShow ? 'block' : 'none';
    if (canShow) crosshair.innerHTML = held ? targetIcon : dotIcon;
  }
  const scoreTextures = new Map(), scoreFloats = [];
  function removeScore(index) {
    const { sprite } = scoreFloats[index];
    scene.remove(sprite); sprite.material.dispose(); scoreFloats.splice(index, 1);
  }
  function floatScore(mesh, amount) {
    if (!scoreTextures.has(amount)) {
      const canvas = document.createElement('canvas');
      canvas.width = 128; canvas.height = 96;
      const ctx = canvas.getContext('2d');
      ctx.font = 'bold 64px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.strokeStyle = 'rgba(0,0,0,.65)'; ctx.lineWidth = 5;
      ctx.fillStyle = amount > 0 ? '#62ef88' : '#ff6969';
      const text = amount > 0 ? '+1' : '−1';
      ctx.strokeText(text, 64, 48); ctx.fillText(text, 64, 48);
      scoreTextures.set(amount, new THREE.CanvasTexture(canvas));
    }
    if (scoreFloats.length >= 24) removeScore(0);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: scoreTextures.get(amount),
      transparent: true, depthTest: false, depthWrite: false, toneMapped: false }));
    sprite.name = amount > 0 ? 'projectile-score-plus' : 'projectile-score-minus';
    sprite.scale.set(0.85, 0.64, 1); sprite.renderOrder = 1001;
    sprite.position.copy(mesh.position).addScaledVector(mesh.position.clone().normalize(), 1.65);
    scene.add(sprite); scoreFloats.push({ sprite, mesh, age: 0 });
  }
  function floatScoreAt(position, amount) {
    if (!scoreTextures.has(amount)) {
      const canvas = document.createElement('canvas');
      canvas.width = 128; canvas.height = 96;
      const ctx = canvas.getContext('2d');
      ctx.font = 'bold 64px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.strokeStyle = 'rgba(0,0,0,.65)'; ctx.lineWidth = 5;
      ctx.fillStyle = amount > 0 ? '#62ef88' : '#ff6969';
      const text = amount > 0 ? '+1' : '−1';
      ctx.strokeText(text, 64, 48); ctx.fillText(text, 64, 48);
      scoreTextures.set(amount, new THREE.CanvasTexture(canvas));
    }
    if (scoreFloats.length >= 24) removeScore(0);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: scoreTextures.get(amount),
      transparent: true, depthTest: false, depthWrite: false, toneMapped: false }));
    sprite.name = amount > 0 ? 'projectile-score-plus' : 'projectile-score-minus';
    sprite.scale.set(0.85, 0.64, 1); sprite.renderOrder = 1001;
    const startPos = position.clone().addScaledVector(position.clone().normalize(), 1.65);
    sprite.position.copy(startPos);
    scene.add(sprite);
    // Static position score - use null mesh and store basePosition
    scoreFloats.push({ sprite, mesh: null, basePosition: startPos.clone(), age: 0 });
  }
  function updateScores(delta) {
    for (let i = scoreFloats.length - 1; i >= 0; i--) {
      const score = scoreFloats[i]; score.age += delta;
      if (score.age >= 1.6) { removeScore(i); continue; }
      if (score.mesh) {
        // Mesh-attached score
        if (!score.mesh.visible || !score.mesh.parent) { removeScore(i); continue; }
        score.sprite.position.copy(score.mesh.position).addScaledVector(score.mesh.position.clone().normalize(), 1.65 + score.age * 0.7);
      } else if (score.basePosition) {
        // Position-based score (for tents)
        score.sprite.position.copy(score.basePosition).addScaledVector(score.basePosition.clone().normalize(), score.age * 0.7);
      }
      score.sprite.material.opacity = Math.min(1, (1.6 - score.age) / 0.8);
    }
  }
  function updateBalls(delta, inverse) {
    for (let i = balls.length - 1; i >= 0; i--) {
      const ball = balls[i]; let impact = false;
      if (ball.bounce) {
        ball.bounce.age += delta;
        const t = Math.min(1, ball.bounce.age / 0.45);
        ball.mesh.position.lerpVectors(ball.bounce.from, ball.bounce.to, t)
          .addScaledVector(ball.bounce.to.clone().normalize(), Math.sin(Math.PI * t) * 0.3);
        ball.mesh.rotateX(delta * 9);
        if (t === 1) {
          landCone(ball.cone, ball.bounce.to);
          removeProjectileVisuals(ball); balls.splice(i, 1);
        }
        continue;
      }
      ball.accumulator += delta;
      while (ball.accumulator >= FLIGHT_STEP && !impact) {
        ball.accumulator -= FLIGHT_STEP;
        const from = ball.mesh.position.clone();
        const to = advanceFlight(from, ball.velocity, ball.orbit);
        const hit = flightHit(from, to, ball.age < 0.4 ? ball.owner : null, inverse);
        if (hit) {
          to.copy(hit.point); impact = true;
          removeOrbitTrail(ball);
          if (hit.mesh) {
            // Hit a player
            hit.mesh.userData.snowHitUntil = elapsed + 0.45;
            if (hit.mesh === world.getPlayer()) {
              floatScore(hit.mesh, -1);
              // Team scoring: other team gets a point
              const myTeam = world.getPlayerTeam?.(world.localId);
              if (myTeam) world.addTeamScore?.(myTeam === 'red' ? 'blue' : 'red', 1);
            } else if (ball.owner === world.localId) {
              floatScore(hit.mesh, 1);
              // Team scoring: my team gets a point
              const myTeam = world.getPlayerTeam?.(world.localId);
              if (myTeam) world.addTeamScore?.(myTeam, 1);
            }
          } else if (hit.tent && ball.owner === world.localId) {
            // Hit a tent - check if occupied
            const tentOwner = hit.tent.owner;
            if (world.isTentOccupied?.(tentOwner)) {
              // Show +1/-1 animation at tent position
              const tentPos = hit.tent.mesh.position.clone();
              floatScoreAt(tentPos, 1);
              // Team scoring
              const myTeam = world.getPlayerTeam?.(world.localId);
              if (myTeam) world.addTeamScore?.(myTeam, 1);
            }
          }
          if (ball.kind === 'pinecone') {
            const base = hit.mesh ? hit.mesh.position.clone().applyQuaternion(inverse) : to.clone();
            const radial = base.clone().normalize();
            const away = ball.velocity.clone().negate().addScaledVector(radial, ball.velocity.dot(radial)).normalize();
            const direction = base.addScaledVector(away, 0.4).normalize();
            ball.bounce = { from: to.clone(), to: direction.clone().multiplyScalar(surface(direction) + 0.075), age: 0 };
          }
        }
        ball.mesh.position.copy(to);
        ball.age += FLIGHT_STEP;
        updateOrbitTrail(ball);
      }
      if (impact) {
        if (ball.kind === 'pinecone') continue;
        if (ball.kind === 'snowball') splat(ball.mesh.position);
        removeProjectileVisuals(ball); balls.splice(i, 1);
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
  function equip(mesh, carrying, skating, moving, kind = enabled ? 'snowball' : 'pinecone') {
    const s = mesh.userData;
    if (!carrying && !skating && !s.winterEquipment) return;
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
    s.winterEquipment.ball.geometry = kind === 'pinecone' ? coneGeo : ballGeo;
    s.winterEquipment.ball.material = kind === 'pinecone' ? coneMaterial : snowMaterial;
    s.winterEquipment.ball.visible = carrying && mesh.visible;
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
  const icon = paths => `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
  // Tall laced boot, rounded toe, sole, blade supports and an upturned runner.
  const skatePaths = '<path d="M5 3h7v5c0 2 2 3 5 4l2 .6c1.3.4 2 1.4 2 2.4v1H4V9z" fill="currentColor" fill-opacity=".15"/><path d="M9 6h3M9 9h3M11 12l2-1M7 16v4M17 16v4M3 20h16q3 0 3-3"/>';
  const skateIcon = icon(skatePaths);
  const skateNoIcon = icon(skatePaths + '<path d="M3 3l18 18" stroke="#e32636" stroke-width="2.3"/>');
  // Only the solid half has an arc; the flake half has three branching arms.
  const snowballIcon = icon('<path d="M12 2a10 10 0 0 1 0 20Z" fill="currentColor" fill-opacity=".3"/><path d="M12 2v20M12 12L3.34 7M12 12l-8.66 5M12 6l-3-2M12 18l-3 2M6.8 9l-.2-3.5M6.8 9l-3.2 1.5M6.8 15l-3.2-1.5M6.8 15l-.2 3.5"/>');
  const pineconeIcon = icon('<path d="M12 3c-3 0-7 7-7 12s3 7 7 7 7-2 7-7S15 3 12 3Z" fill="#89512e" fill-opacity=".7"/><path d="M12 3V1M8 7l4 3 4-3M6 11l6 4 6-4M5 16l7 4 7-4M12 10v5M8 13v5M16 13v5"/>');
  button.innerHTML = snowballIcon;
  const targetIcon = icon('<circle cx="12" cy="12" r="7"/><path d="M12 1v22M1 12h22"/>');
  const dotIcon = icon('<circle cx="12" cy="12" r="3" fill="#e32636" stroke="none"/>');
  crosshair.innerHTML = dotIcon;
  const actionHint = document.createElement('span');
  actionHint.className = 'winter-hint';
  button.append(actionHint);
  const skatesHint = document.createElement('span');
  skatesHint.className = 'winter-hint';
  skatesButton.append(skatesHint);
  button.setAttribute('aria-label', 'Load or throw snowball');
  skatesButton.setAttribute('aria-label', 'Toggle ice skates');
  function refreshHints() {
    const next = [enabled, packing > 0, held, skates, inputMode].join(':');
    if (hintState === next) return;
    hintState = next;
    button.querySelector('svg').outerHTML = enabled ? snowballIcon : pineconeIcon;
    button.setAttribute('aria-label', enabled ? 'Load or throw snowball' : 'Pick up nearby pinecone or throw');
    skatesButton.innerHTML = skates ? skateNoIcon : skateIcon;
    skatesButton.append(skatesHint);  // Re-append after innerHTML replacement
    // Update border colors to indicate active states
    button.style.borderColor = packing > 0 ? '#f0c040' : 'rgba(255,255,255,0.15)';
    skatesButton.style.borderColor = skates ? '#f0c040' : 'rgba(255,255,255,0.15)';
    actionHint.textContent = inputMode === 'gamepad' ? 'RT' : 'Q';
    actionHint.style.display = inputMode === 'touch' ? 'none' : 'block';
    skatesHint.textContent = inputMode === 'gamepad' ? 'LB' : 'I';
    skatesHint.style.display = inputMode === 'touch' ? 'none' : 'block';
    skatesHint.style.borderRadius = '4px';  // LB/I are both squirkles (bumpers, keyboard)
    button.title = inputMode === 'gamepad' ? 'Right trigger: load / throw. Right stick: look.' : 'Left-click: load / throw. Move the camera to aim at the center crosshair.';
    if (!enabled) button.title += ' Stand within arm’s reach of a pinecone to pick it up.';
    skatesButton.setAttribute('aria-pressed', String(skates));
  }
  function updateHints(mode) {
    inputMode = mode;
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
      if (heldCone !== null) {
        landCone(heldCone, world.getPlayer().position.clone().applyQuaternion(world.getRotation().clone().invert()));
        heldCone = null;
      }
      clearTracks(); velocity.set(0, 0); held = false; packing = 0;
      for (const id of skateTracks.keys()) disposeCuts(id);
      if (!enabled) { skates = false; world.getPlayer().userData.skating = false; }
      for (const flake of flakes) flake.live = false;
      flakeWeather.fill(0); flakePositions.fill(0); floorCache.clear(); flakeCursor = 0;
      flakeGeo.attributes.position.needsUpdate = flakeGeo.attributes.weather.needsUpdate = true;
      for (const ball of balls) {
        if (ball.kind === 'pinecone') landCone(ball.cone, ball.mesh.position);
        removeProjectileVisuals(ball);
      }
      balls.length = 0;
      while (scoreFloats.length) removeScore(0);
    }
    if (cover === 0 && wasCover > 0) clearTracks();
    button.style.display = 'flex';
    groundCones.visible = !enabled;
    updateCrosshair();
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
    spray.visible = true;
    const player = world.getPlayer();
    const canAct = world.canAct();
    if (!canAct) packing = 0;
    equip(player, held && canAct, enabled && skates, velocity.lengthSq() > 0.0001);
    for (const peer of Object.values(world.getPeers())) {
      const fresh = performance.now() - peer.motionReceivedAt < 2000;
      equip(peer.mesh, fresh && !!(peer.motion?.snowball || peer.motion?.pinecone),
        enabled && peer.mesh.userData.skating, peer.isWalking && peer.interpT < 1,
        peer.motion?.pinecone ? 'pinecone' : 'snowball');
      if (peer.torch?.visible) peer.mesh.userData.flashlightLens.getWorldPosition(peer.torch.position);
    }
    skatesButton.style.display = enabled && (skates || player.userData.onIce) ? 'flex' : 'none';
    skatesButton.disabled = !canAct;
    const inverse = world.getRotation().clone().invert();
    flightObstacles = world.getObstacles();
    const lighting = world.getLighting?.();
    if (enabled) {
    const count = Math.round(flakeCount * snowfall);
    flakeGeo.setDrawRange(0, count);
    snowTime.value = elapsed;
    snowView.value.copy(world.camera.position).normalize().applyQuaternion(inverse);
    // Player velocity in globe-local coords for relative snowfall motion
    // velocity is in world-local XZ, convert to globe-local direction
    const speed = velocity.length();
    if (speed > 0.01) {
      const facing = world.getFacing();
      // Convert velocity to world direction then to globe-local
      const worldVel = new THREE.Vector3(
        velocity.x * Math.sin(facing) + velocity.y * Math.cos(facing),
        0,
        velocity.x * Math.cos(facing) - velocity.y * Math.sin(facing)
      ).applyQuaternion(inverse);
      snowVelocity.value.copy(worldVel);
    } else {
      snowVelocity.value.set(0, 0, 0);
    }
    // Snowflake brightness: dim at night, bright in daylight. Flashlight is per-flake in shader.
    if (lighting) {
      // Base brightness from daylight (0.15 at night with moonlight, up to 1.0 in full day)
      const baseBrightness = 0.12 + lighting.daylight * 0.88 + (1 - lighting.daylight) * lighting.moonlight * 0.08;
      snowBrightness.value = baseBrightness;
      // Pass flashlight position and direction for per-flake lighting
      if (lighting.flashlightOn && lighting.flashlightPos && lighting.flashlightDir) {
        snowFlashOn.value = 1.0;
        snowFlashPos.value.copy(lighting.flashlightPos).applyQuaternion(inverse);
        snowFlashDir.value.copy(lighting.flashlightDir).applyQuaternion(inverse);
      } else {
        snowFlashOn.value = 0.0;
      }
    }
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
    }
    if (packing > 0) {
      packing -= delta;
      player.userData.leftArm.rotation.x = player.userData.rightArm.rotation.x = -1.1;
      if (packing <= 0) held = true;
    }
    if (throwPose > 0) { throwPose -= delta; player.userData.rightArm.rotation.x = -2.2 * Math.max(0, throwPose / 0.3); }
    refreshHints();
    button.disabled = !canAct || (!enabled && !held && nearbyCone() === null);
    if (enabled) {
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
    }
    updateCrosshair();
    updateBalls(delta, inverse);
    updateMoonFlares(lighting, inverse);
    updateScores(delta);
  }
  return { configure, movement, update, action, interact, receive, receivePickup, updateHints, toggleSkates,
    collide, receiveIceContact, sharedVelocity,
    get snowy() { return enabled && (cover > 0 || snowfall > 0); },
    stop: () => velocity.set(0, 0),
    get holding() { return held && world.canAct(); },
    get skating() { return enabled && skates; },
    get enabled() { return enabled; }, iceRadius };
}
