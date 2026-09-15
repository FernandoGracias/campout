// Winter coordinates are planet-local: tracks and projectiles stay put as campers walk.
export function createWinter(THREE, world) {
  const { scene, globePivot, globe, trees, waterSphere, radius, waterRadius } = world;
  const up = new THREE.Vector3(0, 1, 0);
  const iceRadius = waterRadius + 0.05; // 25 cm shell: 5 cm above water, 20 cm below.
  let enabled = false, cover = 0.75, snowfall = 0.4, elapsed = 0;
  let held = false, packing = 0, lastAction = -10, throwPose = 0;
  let aiming = false, aimPitch = Math.atan2(3.4, 15), inputMode = 'keyboard', skates = false;
  let hintState = '';
  const BALL_RADIUS = 0.08, FLIGHT_STEP = 1 / 60, THROW_SPEED = 10.5;
  const velocity = new THREE.Vector2();
  const button = document.getElementById('btn-snowball');
  const aimButton = document.getElementById('btn-aim');
  const skatesButton = document.getElementById('btn-skates');
  const crosshair = document.getElementById('snow-crosshair');
  const snowAmount = { value: 0 };
  const terrain = new THREE.Mesh(globe.geometry, globe.material);
  terrain.updateMatrixWorld();
  const ray = new THREE.Raycaster();
  const snowMaterial = new THREE.MeshStandardMaterial({ color: 0xeaf5ff, roughness: 0.95, flatShading: true });
  const snowCaps = [];
  const shelters = [];

  // Overlapping cones intercept vertical snowfall. Only the exposed outer skirt
  // of each lower tier is capped; open-ended meshes never whiten the undersides.
  for (const tree of trees) {
    const cones = tree.obj.children.filter(child => child.geometry?.type === 'ConeGeometry');
    for (let i = 0; i < cones.length; i++) {
      const cone = cones[i], p = cone.geometry.parameters;
      const top = i === cones.length - 1;
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
  canvas.width = 1024; canvas.height = 512;
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
  globe.material.onBeforeCompile = shader => {
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
    const hit = ray.intersectObject(terrain, false)[0];
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
  const flakeCount = 1600;
  const flakePositions = new Float32Array(flakeCount * 3);
  const flakes = Array.from({ length: flakeCount }, () => ({ direction: new THREE.Vector3(), height: 0, floor: 0, speed: 0 }));
  const flakeGeo = new THREE.BufferGeometry();
  flakeGeo.setAttribute('position', new THREE.BufferAttribute(flakePositions, 3));
  const flakeMat = new THREE.PointsMaterial({ color: 0xeaf5ff, size: 0.075, transparent: true, opacity: 0.85, depthWrite: false });
  flakeMat.onBeforeCompile = shader => {
    shader.fragmentShader = shader.fragmentShader.replace('#include <clipping_planes_fragment>',
      '#include <clipping_planes_fragment>\nif (length(gl_PointCoord - vec2(0.5)) > 0.5) discard;');
  };
  const falling = new THREE.Points(flakeGeo, flakeMat);
  falling.frustumCulled = false; falling.visible = false; globePivot.add(falling);
  function spawnFlake(flake, initial, inverse) {
    flake.direction.set((Math.random() - 0.5) * 32, radius, (Math.random() - 0.5) * 32).normalize().applyQuaternion(inverse);
    flake.floor = surface(flake.direction);
    // Raycast only nearby canopies, in their rendered world frame.
    const nearby = trees.filter(t => t.obj.position.clone().normalize().distanceTo(flake.direction) * radius < 2);
    if (nearby.length) {
      const direction = flake.direction.clone().applyQuaternion(world.getRotation());
      ray.set(direction.clone().multiplyScalar(radius + 12), direction.clone().negate());
      const hit = ray.intersectObjects(nearby.map(t => t.obj), true)[0];
      if (hit) flake.floor = Math.max(flake.floor, hit.point.length());
    }
    flake.height = initial ? flake.floor + Math.random() * 12 : radius + 13 + Math.random() * 2;
    flake.speed = 1.5 + Math.random() * 1.8;
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
  function clearTracks() {
    for (const track of tracks.values()) for (const print of track.prints) {
      globePivot.remove(print); print.geometry.dispose(); print.material.dispose();
    }
    tracks.clear();
  }
  function updateTrack(id, mesh, inverse, delta) {
    const direction = mesh.position.clone().applyQuaternion(inverse).normalize();
    let track = tracks.get(id);
    if (!track) { track = { last: direction.clone(), distance: 0, count: 0, prints: [] }; tracks.set(id, track); }
    const distance = track.last.distanceTo(direction) * radius;
    track.last.copy(direction);
    const active = mesh.visible && !mesh.userData.onIce && !mesh.userData.swimming && cover > 0.05;
    if (distance > 2 || !active) track.distance = 0;
    else track.distance += distance;
    if (active && track.distance > 0.42 && exposureAt(direction) * cover > 0.08) {
      track.distance %= 0.42;
      const index = track.count++ % 50;
      let print = track.prints[index];
      if (!print) {
        print = new THREE.Mesh(new THREE.PlaneGeometry(0.14, 0.3, 2, 3),
          // Black alpha compositing only darkens the existing surface, even in fog/night.
          new THREE.MeshBasicMaterial({ color: 0x000000, map: soleTexture, transparent: true, opacity: 0.4,
            fog: false, toneMapped: false, alphaTest: 0.02, depthWrite: false, side: THREE.DoubleSide }));
        print.frustumCulled = false;
        track.prints[index] = print; globePivot.add(print);
      }
      const basis = mesh.quaternion.clone().premultiply(inverse);
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(basis);
      const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(basis);
      const center = direction.clone().multiplyScalar(radius).addScaledVector(right, track.count % 2 ? 0.13 : -0.13);
      const position = print.geometry.attributes.position;
      for (let i = 0; i < position.count; i++) {
        const x = (i % 3 / 2 - 0.5) * 0.14;
        const z = (0.5 - Math.floor(i / 3) / 3) * 0.3;
        const d = center.clone().addScaledVector(right, x).addScaledVector(forward, z).normalize();
        const point = d.multiplyScalar(surface(d) + 0.012);
        position.setXYZ(i, point.x, point.y, point.z);
      }
      position.needsUpdate = true;
      print.userData.born = track.count; print.userData.age = 0;
    }
    for (const print of track.prints) {
      print.userData.age += delta;
      print.material.opacity = 0.42 * Math.min(1, (50 - track.count + print.userData.born) / 12) *
        Math.max(0, 1 - print.userData.age / (snowfall > 0 ? 45 : 90));
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
    if (balls.length >= 32) return;
    const mesh = new THREE.Mesh(ballGeo, snowMaterial);
    mesh.position.copy(position); globePivot.add(mesh);
    balls.push({ owner, mesh, velocity, age: 0, accumulator: 0 });
  }
  function throwState() {
    const inverse = world.getRotation().clone().invert();
    const forward = new THREE.Vector3(Math.sin(world.getFacing()), 0, Math.cos(world.getFacing()));
    const pitch = aiming ? aimPitch : Math.atan2(3.4, 15);
    return {
      position: world.getPlayer().position.clone().addScaledVector(up, 0.85).addScaledVector(forward, 0.45).applyQuaternion(inverse),
      // Keep throws comfortably below this miniature planet's orbital speed.
      velocity: forward.multiplyScalar(Math.cos(pitch) * THROW_SPEED).addScaledVector(up, Math.sin(pitch) * THROW_SPEED).applyQuaternion(inverse),
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
    if (position.length() < iceRadius || position.length() > radius + 9 || speed.length() > 17 || speed.length() < 10 ||
        direction.distanceTo(position.clone().normalize()) * radius > 2) return;
    receiveTimes.set(id, elapsed); launch(id, position, speed);
  }
  const flightRay = new THREE.Raycaster();
  const iceBounds = new THREE.Sphere(new THREE.Vector3(), iceRadius);
  // Preview and real throws use this same swept collision and fixed timestep.
  function flightHit(from, to, owner, inverse) {
    const travel = to.clone().sub(from), length = travel.length();
    flightRay.set(from, travel.clone().normalize());
    flightRay.far = length + BALL_RADIUS;
    const terrainHit = flightRay.intersectObject(terrain, false)[0];
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
    const nearby = trees.filter(t => t.obj.position.clone().normalize().distanceTo(from.clone().normalize()) * radius < 2.5);
    if (nearby.length) {
      flightRay.set(from.clone().applyQuaternion(world.getRotation()), travel.normalize().applyQuaternion(world.getRotation()));
      const hit = flightRay.intersectObjects(nearby.map(t => t.obj), true)[0];
      if (hit) accept(hit.point.applyQuaternion(inverse));
    }
    if (!nearest && to.length() < iceRadius) nearest = { point: to.clone().normalize().multiplyScalar(iceRadius), mesh: null };
    return nearest;
  }
  function advanceFlight(position, speed) {
    speed.addScaledVector(position.clone().normalize(), -12 * FLIGHT_STEP);
    return position.clone().addScaledVector(speed, FLIGHT_STEP);
  }
  const arcGeo = new THREE.BufferGeometry();
  arcGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(241 * 3), 3));
  arcGeo.setAttribute('lineDistance', new THREE.BufferAttribute(new Float32Array(241), 1));
  const arc = new THREE.Line(arcGeo, new THREE.LineDashedMaterial({ color: 0xffffff, dashSize: 0.2, gapSize: 0.14,
    transparent: true, opacity: 0.85, depthWrite: false, toneMapped: false }));
  arc.frustumCulled = false; arc.visible = false; globePivot.add(arc);
  let previewAt = -10, impactPoint = null;
  const previewBounds = new THREE.Box3(), previewCenter = new THREE.Vector3();
  let previewRadius = 3;
  function updateAim(inverse) {
    arc.visible = enabled && aiming && held && world.canAct();
    crosshair.style.display = 'none';
    if (!arc.visible) return;
    if (elapsed - previewAt >= 0.08) {
      previewAt = elapsed;
      const shot = throwState();
      let position = shot.position, distance = 0, count = 1;
      const positions = arcGeo.attributes.position, distances = arcGeo.attributes.lineDistance;
      positions.setXYZ(0, position.x, position.y, position.z); distances.setX(0, 0);
      previewBounds.setFromPoints([position, world.getPlayer().position.clone().applyQuaternion(inverse)]);
      for (let i = 1; i <= 240; i++) {
        const next = advanceFlight(position, shot.velocity);
        const hit = flightHit(position, next, world.localId, inverse);
        if (hit) next.copy(hit.point);
        distance += next.distanceTo(position);
        positions.setXYZ(i, next.x, next.y, next.z); distances.setX(i, distance);
        count++; position = next;
        previewBounds.expandByPoint(position);
        if (hit) break;
      }
      impactPoint = position;
      previewBounds.getCenter(previewCenter);
      previewRadius = previewBounds.getSize(new THREE.Vector3()).length() / 2;
      arcGeo.setDrawRange(0, count); positions.needsUpdate = distances.needsUpdate = true;
    }
    if (impactPoint) {
      // Frame the arc from above and slightly over the shoulder. On a little
      // planet, an ordinary chase camera hides long throws behind the horizon.
      const center = previewCenter.clone().applyQuaternion(world.getRotation());
      const normal = center.clone().normalize();
      const backward = new THREE.Vector3(-Math.sin(world.getFacing()), 0, -Math.cos(world.getFacing()));
      backward.addScaledVector(normal, -backward.dot(normal)).normalize();
      const side = new THREE.Vector3().crossVectors(normal, backward).normalize();
      const view = normal.multiplyScalar(0.85).addScaledVector(backward, 0.45).addScaledVector(side, 0.25).normalize();
      const halfFov = THREE.MathUtils.degToRad(world.camera.fov / 2);
      const limitingFov = Math.min(halfFov, Math.atan(Math.tan(halfFov) * world.camera.aspect));
      const distance = Math.max(6, previewRadius * 1.15 / Math.sin(limitingFov));
      world.camera.position.copy(center).addScaledVector(view, distance);
      world.camera.lookAt(center); world.camera.updateMatrixWorld(true);
      const screen = impactPoint.clone().applyQuaternion(world.getRotation()).project(world.camera);
      if (screen.z >= -1 && screen.z <= 1 && Math.abs(screen.x) < 1 && Math.abs(screen.y) < 1) {
        crosshair.style.display = 'block';
        crosshair.style.left = `${(screen.x * 0.5 + 0.5) * innerWidth}px`;
        crosshair.style.top = `${(-screen.y * 0.5 + 0.5) * innerHeight}px`;
      }
    }
  }
  function setAim(value) {
    const next = !!value && enabled && world.canAct();
    if (next !== aiming) { aiming = next; previewAt = -10; refreshHints(); }
    if (!aiming) { arc.visible = false; crosshair.style.display = 'none'; }
  }
  function adjustAim(change) { aimPitch = THREE.MathUtils.clamp(aimPitch + change, -0.35, 1.1); previewAt = -10; }
  function updateBalls(delta, inverse) {
    for (let i = balls.length - 1; i >= 0; i--) {
      const ball = balls[i]; let impact = false;
      ball.accumulator += delta;
      while (ball.accumulator >= FLIGHT_STEP && !impact) {
        ball.accumulator -= FLIGHT_STEP;
        const from = ball.mesh.position.clone();
        const to = advanceFlight(from, ball.velocity);
        const hit = flightHit(from, to, ball.owner, inverse);
        if (hit) {
          to.copy(hit.point); impact = true;
          if (hit.mesh) {
            hit.mesh.userData.snowHitUntil = elapsed + 0.45;
            if (hit.mesh === world.getPlayer()) world.toast('Snowball hit! ❄');
            else if (ball.owner === world.localId) world.toast('Direct hit! ❄');
          }
        }
        ball.mesh.position.copy(to);
      }
      ball.age += delta;
      if (impact || ball.age > 4) {
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
    if (enabled && skating) {
      const push = moving ? Math.sin(elapsed * 5) : 0;
      s.leftLeg.rotation.set(-0.08 + Math.max(0, push) * 0.18, 0, 0.04 + Math.max(0, push) * 0.16);
      s.rightLeg.rotation.set(-0.08 + Math.max(0, -push) * 0.18, 0, -0.04 - Math.max(0, -push) * 0.16);
      if (moving) mesh.rotateX(-0.06);
    }
  }
  const skateTracks = new Map(), MAX_CUTS = 256;
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
      const feet = mesh.userData.winterEquipment.blades.map(blade => blade.getWorldPosition(new THREE.Vector3())
        .applyQuaternion(inverse).normalize().multiplyScalar(iceRadius + 0.012));
      const distance = track.last ? Math.max(...feet.map((foot, i) => foot.distanceTo(track.last[i]))) : 0;
      if (!track.last || distance > 1) track.last = feet;
      else if (distance > 0.07) {
        const positions = track.mesh.geometry.attributes.position;
        for (let side = 0; side < 2; side++) {
          const a = track.last[side], b = feet[side];
          const across = new THREE.Vector3().crossVectors(b.clone().sub(a), b.clone().normalize()).normalize().multiplyScalar(0.008);
          const corners = [a.clone().sub(across), a.clone().add(across), b.clone().sub(across), b.clone().add(across)];
          const index = track.cursor++ % MAX_CUTS;
          for (const [i, corner] of [0, 1, 2, 2, 1, 3].entries()) {
            const p = corners[corner]; positions.setXYZ(index * 6 + i, p.x, p.y, p.z);
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
      `❄ ${held ? 'Throw' : 'Pack'} snowball${suffix(inputMode === 'gamepad' ? (aiming ? 'RT' : 'RB') : (aiming ? 'Click' : 'Q'))}`;
    aimButton.textContent = inputMode === 'touch' ? (aiming ? 'Stop aiming' : 'Aim')
      : `${aiming ? 'Aiming' : 'Aim'} · ${aiming ? 'Release' : 'Hold'} ${inputMode === 'gamepad' ? 'LT' : 'right mouse'}`;
    skatesButton.textContent = `${skates ? 'Remove' : 'Equip'} skates${suffix(inputMode === 'gamepad' ? 'LB' : 'C')}`;
    aimButton.setAttribute('aria-pressed', String(aiming));
    skatesButton.setAttribute('aria-pressed', String(skates));
    document.getElementById('winter-input-help').textContent = inputMode === 'gamepad'
      ? 'RB: pack a snowball. Hold LT to aim; right stick adjusts the arc; RT throws. LB: equip/remove skates on ice.'
      : inputMode === 'touch'
        ? 'Tap Pack snowball, then Aim. Drag the scene to adjust the arc; tap Throw. Equip skates while on ice.'
        : 'Q: pack/throw. Hold right mouse to aim; move the mouse to adjust the arc; left click throws. C: equip/remove skates on ice.';
  }
  function updateHints(mode) {
    if (inputMode !== mode) { inputMode = mode; setAim(false); }
    refreshHints();
  }
  function configure(state) {
    const wasEnabled = enabled;
    enabled = state.winter === true;
    cover = state.snowCover ?? 0.75; snowfall = state.snowfall ?? 0.4;
    snowAmount.value = enabled ? cover : 0;
    ice.visible = enabled; waterSphere.visible = !enabled;
    canopySnow.visible = enabled && cover > 0;
    capMaterial.opacity = Math.min(1, cover * 2);
    document.getElementById('winter-enabled').checked = enabled;
    for (const [id, value] of [['snow-cover', cover], ['snow-fall', snowfall]]) {
      document.getElementById(id).value = Math.round(value * 100);
      document.getElementById(id + '-value').textContent = `${Math.round(value * 100)}%`;
    }
    if (wasEnabled !== enabled || cover === 0) {
      clearTracks(); velocity.set(0, 0); held = false; packing = 0;
      for (const id of skateTracks.keys()) disposeCuts(id);
      if (!enabled) { skates = false; world.getPlayer().userData.skating = false; setAim(false); }
      for (const flake of flakes) flake.height = 0;
      for (const ball of balls) globePivot.remove(ball.mesh);
      balls.length = 0;
    }
    button.style.display = enabled ? 'block' : 'none';
    refreshHints();
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
    falling.visible = enabled && snowfall > 0;
    spray.visible = enabled;
    const player = world.getPlayer();
    const canAct = world.canAct();
    if (!canAct) { packing = 0; setAim(false); }
    equip(player, enabled && held && canAct, enabled && skates && player.userData.onIce, velocity.lengthSq() > 0.0001);
    for (const peer of Object.values(world.getPeers())) {
      const fresh = performance.now() - peer.motionReceivedAt < 2000;
      equip(peer.mesh, enabled && fresh && !!peer.motion?.snowball,
        enabled && peer.mesh.userData.skating && peer.mesh.userData.onIce, peer.isWalking && peer.interpT < 1);
      if (peer.torch?.visible) peer.mesh.userData.flashlightLens.getWorldPosition(peer.torch.position);
    }
    aimButton.style.display = enabled ? 'block' : 'none';
    skatesButton.style.display = enabled && (skates || player.userData.onIce) ? 'block' : 'none';
    aimButton.disabled = !canAct;
    skatesButton.disabled = !canAct;
    if (!enabled) return;
    const inverse = world.getRotation().clone().invert();
    const count = Math.round(flakeCount * snowfall);
    flakeGeo.setDrawRange(0, count);
    for (let i = 0; i < count; i++) {
      const f = flakes[i];
      const relative = f.direction.clone().applyQuaternion(world.getRotation());
      if (f.height <= f.floor || relative.y < 0.65) spawnFlake(f, f.height === 0, inverse);
      f.height -= f.speed * delta;
      flakePositions.set(f.direction.clone().multiplyScalar(f.height).toArray(), i * 3);
    }
    flakeGeo.attributes.position.needsUpdate = true;
    if (packing > 0) {
      packing -= delta;
      player.userData.leftArm.rotation.x = player.userData.rightArm.rotation.x = -1.1;
      if (packing <= 0) held = true;
    }
    if (throwPose > 0) { throwPose -= delta; player.userData.rightArm.rotation.x = -2.2 * Math.max(0, throwPose / 0.3); }
    refreshHints();
    button.disabled = !canAct;
    updateTrack(world.localId, player, inverse, delta);
    updateSkateTracks(world.localId, player, inverse, skates && player.userData.onIce && canAct);
    for (const [id, peer] of Object.entries(world.getPeers())) {
      updateTrack(id, peer.mesh, inverse, delta);
      updateSkateTracks(id, peer.mesh, inverse, peer.mesh.visible && peer.mesh.userData.skating && peer.mesh.userData.onIce);
    }
    for (const [id, track] of tracks) if (id !== world.localId && !world.getPeers()[id]) {
      for (const print of track.prints) { globePivot.remove(print); print.geometry.dispose(); print.material.dispose(); }
      tracks.delete(id); receiveTimes.delete(id);
      disposeCuts(id);
    }
    updateAim(inverse);
    updateBalls(delta, inverse);
  }
  return { configure, movement, update, action, receive, setAim, adjustAim, updateHints, toggleSkates,
    stop: () => velocity.set(0, 0), get aiming() { return aiming; },
    get holding() { return enabled && held && world.canAct(); },
    get skating() { return enabled && skates && world.getPlayer().userData.onIce; },
    get enabled() { return enabled; }, iceRadius };
}
