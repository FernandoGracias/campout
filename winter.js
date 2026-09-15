// Winter coordinates are planet-local: tracks and projectiles stay put as campers walk.
export function createWinter(THREE, world) {
  const { scene, globePivot, globe, trees, waterSphere, radius, waterRadius } = world;
  const up = new THREE.Vector3(0, 1, 0);
  const iceRadius = waterRadius + 0.05; // 25 cm shell: 5 cm above water, 20 cm below.
  let enabled = false, cover = 0.75, snowfall = 0.4, elapsed = 0;
  let held = false, packing = 0, lastAction = -10, throwPose = 0;
  const velocity = new THREE.Vector2();
  const button = document.getElementById('btn-snowball');
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
  ice.material.onBeforeCompile = shader => {
    shader.vertexShader = 'varying vec3 icePoint;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nicePoint = position;');
    shader.fragmentShader = 'varying vec3 icePoint;\n' + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
      vec3 p = icePoint * 2.1;
      float vein = abs(sin(p.x + sin(p.z * 1.7) + cos(p.y * 1.3)));
      float crack = 1.0 - smoothstep(0.008, 0.035, vein);
      float frost = 0.5 + 0.5 * sin(p.x * 0.7 + p.y) * cos(p.z * 0.8);
      diffuseColor.rgb = mix(diffuseColor.rgb * (0.83 + frost * 0.17), vec3(0.8,0.94,1.0), crack * 0.65);
    `);
  };
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
          new THREE.MeshBasicMaterial({ color: 0x536d85, map: soleTexture, transparent: true, opacity: 0.4,
            alphaTest: 0.02, depthWrite: false, side: THREE.DoubleSide }));
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

  const ballGeo = new THREE.IcosahedronGeometry(0.12, 1);
  const heldBall = new THREE.Mesh(ballGeo, snowMaterial);
  heldBall.visible = false; scene.add(heldBall);
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
    balls.push({ owner, mesh, velocity, age: 0 });
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
    const inverse = world.getRotation().clone().invert();
    const forward = new THREE.Vector3(Math.sin(world.getFacing()), 0, Math.cos(world.getFacing()));
    const position = player.position.clone().addScaledVector(up, 0.85).addScaledVector(forward, 0.45).applyQuaternion(inverse);
    const speed = forward.multiplyScalar(15).addScaledVector(up, 3.4).applyQuaternion(inverse);
    launch(world.localId, position, speed);
    world.send({ type: 'snowball', position: position.toArray(), velocity: speed.toArray() });
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
  function updateBalls(delta, inverse) {
    const campers = [[world.localId, world.getPlayer()], ...Object.entries(world.getPeers()).map(([id, p]) => [id, p.mesh])];
    for (let i = balls.length - 1; i >= 0; i--) {
      const ball = balls[i]; let impact = false;
      // Short swept segments avoid tunnelling through a camper or thin branches.
      const steps = Math.ceil(delta / 0.016), dt = delta / steps;
      for (let step = 0; step < steps && !impact; step++) {
        const from = ball.mesh.position.clone();
        ball.velocity.addScaledVector(from.clone().normalize(), -12 * dt);
        const to = from.clone().addScaledVector(ball.velocity, dt);
        const segment = new THREE.Line3(from, to);
        for (const [id, mesh] of campers) {
          if (id === ball.owner || !mesh.visible) continue;
          const center = mesh.position.clone().addScaledVector(mesh.position.clone().normalize(), 0.65).applyQuaternion(inverse);
          if (segment.closestPointToPoint(center, true, new THREE.Vector3()).distanceTo(center) < 0.48) {
            impact = true; mesh.userData.snowHitUntil = elapsed + 0.45;
            if (id === world.localId) world.toast('Snowball hit! ❄');
            else if (ball.owner === world.localId) world.toast('Direct hit! ❄');
            break;
          }
        }
        const travel = to.clone().sub(from), length = travel.length();
        ray.set(from.clone().applyQuaternion(world.getRotation()), travel.normalize().applyQuaternion(world.getRotation()));
        ray.far = length + 0.12;
        const nearby = trees.filter(t => t.obj.position.clone().normalize().distanceTo(from.clone().normalize()) * radius < 2.5);
        const targets = [globe, ice, ...nearby.map(t => t.obj)];
        const hit = ray.intersectObjects(targets, true)[0];
        ray.far = Infinity;
        if (hit) { to.copy(hit.point).applyQuaternion(inverse); impact = true; }
        if (to.length() < iceRadius) impact = true;
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
    for (const [, mesh] of campers) if (mesh.userData.snowHitUntil > elapsed) {
      mesh.rotateZ(Math.sin((mesh.userData.snowHitUntil - elapsed) * 24) * 0.12);
    }
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
      for (const flake of flakes) flake.height = 0;
      for (const ball of balls) globePivot.remove(ball.mesh);
      balls.length = 0;
    }
    button.style.display = enabled ? 'block' : 'none';
  }
  function movement(forward, strafe, facing, delta, locked) {
    if (locked) { velocity.set(0, 0); return velocity; }
    const target = new THREE.Vector2(forward * Math.cos(facing) - strafe * Math.sin(facing),
      forward * Math.sin(facing) + strafe * Math.cos(facing));
    if (target.length() > 1) target.normalize();
    target.multiplyScalar(0.2);
    if (enabled && world.getPlayer().userData.onIce) {
      const steering = target.lengthSq() > 0 ? 1.7 : 0.65;
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
    heldBall.visible = enabled && held && world.canAct();
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
    if (!world.canAct()) { packing = 0; heldBall.visible = false; }
    if (packing > 0) {
      packing -= delta;
      player.userData.leftArm.rotation.x = player.userData.rightArm.rotation.x = -1.1;
      if (packing <= 0) held = true;
    }
    if (held && world.canAct()) {
      player.userData.rightArm.rotation.x = -1.2;
      heldBall.position.set(-0.25, 0.8, 0.32).applyQuaternion(player.quaternion).add(player.position);
    }
    if (throwPose > 0) { throwPose -= delta; player.userData.rightArm.rotation.x = -2.2 * Math.max(0, throwPose / 0.3); }
    const label = packing > 0 ? '❄ Packing…' : held ? '❄ Throw snowball · Q / RB' : '❄ Pack snowball · Q / RB';
    if (button.textContent !== label) button.textContent = label;
    button.disabled = !world.canAct();
    updateTrack(world.localId, player, inverse, delta);
    for (const [id, peer] of Object.entries(world.getPeers())) updateTrack(id, peer.mesh, inverse, delta);
    for (const [id, track] of tracks) if (id !== world.localId && !world.getPeers()[id]) {
      for (const print of track.prints) { globePivot.remove(print); print.geometry.dispose(); print.material.dispose(); }
      tracks.delete(id); receiveTimes.delete(id);
    }
    updateBalls(delta, inverse);
  }
  return { configure, movement, update, action, receive, stop: () => velocity.set(0, 0),
    get enabled() { return enabled; }, iceRadius };
}
