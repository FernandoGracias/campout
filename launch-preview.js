import * as THREE from 'three';
import { buildPlayer, setPlayerGender } from './character.js';
import { buildTent } from './tent.js';
import { createWorld } from './world.js';
import { createSeasonalSky } from './seasonal-sky.js';
import { skyLighting } from './sky-lighting.js';
import { createNameLabel, updateNameLabel } from './player-labels.js?v=221';
import { mulberry32, TEAM_COLORS, teamLabelColor, disposeObject } from './game-utils.js?v=221';

// The preview owns its renderer and resources, and is disposed before gameplay.
// It reads room state but never joins networking or simulates gameplay actions.
export function createLaunchPreview(container, getState) {
  const status = document.getElementById('preview-status');
  const caption = document.getElementById('preview-caption');
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.2;
  renderer.domElement.setAttribute('aria-label', 'Live world preview');
  container.appendChild(renderer.domElement);
  let scene, camera, content, seed, frame, disposed = false, mode = 'campsite';
  let previousTime = 0;
  const events = new AbortController();
  for (const view of ['campsite', 'world']) {
    document.getElementById('preview-' + view).addEventListener('click', () => {
      mode = view;
      for (const name of ['campsite', 'world']) {
        document.getElementById('preview-' + name).setAttribute('aria-pressed', String(name === mode));
      }
    }, { signal: events.signal });
  }
  function resize() {
    const width = Math.max(1, container.clientWidth), height = Math.max(1, container.clientHeight);
    renderer.setSize(width, height, false);
    if (camera) { camera.aspect = width / height; camera.updateProjectionMatrix(); }
  }
  const observer = new ResizeObserver(resize);
  observer.observe(container);

  function build(state) {
    if (scene) disposeObject(scene);
    seed = state.seed;
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(45, 1, 0.1, 500);
    const radius = 20, pivot = new THREE.Group();
    scene.add(pivot);
    const world = createWorld(pivot, radius, mulberry32(seed));
    const player = buildPlayer(state.gender);
    const label = createNameLabel(state.name, teamLabelColor(state.team));
    pivot.add(player, label);
    const sun = new THREE.DirectionalLight(0xfff4e0, 1.2);
    const hemi = new THREE.HemisphereLight(0x88bbff, 0x446622, 0.6);
    const fill = new THREE.AmbientLight(0xaaaacc, 0.3);
    scene.add(sun, sun.target, hemi, fill);
    const starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 0.5, transparent: true });
    const starPositions = new Float32Array(500 * 3), random = mulberry32(seed ^ 0x52ab);
    for (let i = 0; i < 500; i++) {
      const direction = new THREE.Vector3(random() - 0.5, random() - 0.5, random() - 0.5).normalize();
      starPositions.set(direction.multiplyScalar(150).toArray(), i * 3);
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
    scene.add(new THREE.Points(starGeo, starMat));
    const sky = createSeasonalSky(THREE, { scene, camera, starMat, radius, seed, mobile: matchMedia('(pointer: coarse)').matches });
    const terrainColors = world.globe.geometry.attributes.color;
    const baseColors = terrainColors.array.slice();
    const foliage = [];
    for (const tree of world.trees) tree.obj.traverse(child => {
      if (child.geometry?.type === 'ConeGeometry') foliage.push({ material: child.material, color: child.material.color.clone() });
    });
    const ice = new THREE.Mesh(new THREE.SphereGeometry(world.WATER_RADIUS + 0.05, 48, 48),
      new THREE.MeshStandardMaterial({ color: 0x9bcbdc, roughness: 0.22, metalness: 0.22 }));
    pivot.add(ice);
    const flakePositions = new Float32Array(600 * 3);
    for (let i = 0; i < 600; i++) flakePositions.set([(random() - 0.5) * 18, radius + random() * 10, (random() - 0.5) * 18], i * 3);
    const flakeGeo = new THREE.BufferGeometry();
    flakeGeo.setAttribute('position', new THREE.BufferAttribute(flakePositions, 3));
    const snow = new THREE.Points(flakeGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.055, transparent: true, opacity: 0.85 }));
    pivot.add(snow);
    const ray = new THREE.Raycaster();
    const up = new THREE.Vector3(0, 1, 0);
    function ground(object, x, z, winter, sink = 0) {
      const direction = new THREE.Vector3(x, radius, z).normalize();
      ray.set(direction.clone().multiplyScalar(radius + 12), direction.clone().negate());
      pivot.updateMatrixWorld(true);
      const hit = ray.intersectObject(world.globe, false)[0];
      let floor = hit?.point.length() || radius;
      if (winter) floor = Math.max(floor, world.WATER_RADIUS + 0.05);
      object.position.copy(direction).multiplyScalar(floor - sink);
      object.quaternion.premultiply(new THREE.Quaternion().setFromUnitVectors(up, direction));
    }
    let tent, tentKey, appearanceKey, weatherKey;
    function update(state, delta, time) {
      pivot.quaternion.identity();
      const env = state.environment || {};
      const winter = env.winter === true;
      const nextTent = `${state.style}:${state.color}:${winter}`;
      if (nextTent !== tentKey) {
        if (tent) disposeObject(tent);
        tent = buildTent(state.style, parseInt(state.color, 16));
        pivot.add(tent);
        // The tunnel's origin is its center; other tent origins are at their base.
        ground(tent, 1.25, -0.5, winter, (tent.userData.groundSink || 0) - (state.style === 'tunnel' ? 0.75 : 0));
        tentKey = nextTent;
      }
      const nextAppearance = `${state.gender}:${state.color}:${state.team}:${winter}`;
      if (nextAppearance !== appearanceKey) {
        setPlayerGender(player, state.gender);
        player.traverse(child => {
          if (child.material?.userData.playerTint) child.material.color.setHex(parseInt(state.color, 16));
          if (child.material?.userData.isHatMaterial) child.material.color.setHex(TEAM_COLORS[state.team] || 0x5c3d1e);
        });
        player.quaternion.identity();
        ground(player, -1, 0.5, winter);
        player.rotateY(0.3);
        label.position.copy(player.position).addScaledVector(player.position.clone().normalize(), 1.65);
        label.scale.set(2.4, 0.6, 1);
        appearanceKey = nextAppearance;
      }
      updateNameLabel(label, state.name, teamLabelColor(state.team));
      const cover = winter ? (env.snowCover ?? 0.75) : 0;
      const nextWeather = `${winter}:${cover}`;
      if (nextWeather !== weatherKey) {
        const white = new THREE.Color(0xeaf5ff);
        for (let i = 0; i < terrainColors.count; i++) {
          for (let c = 0; c < 3; c++) terrainColors.array[i * 3 + c] = THREE.MathUtils.lerp(baseColors[i * 3 + c], [white.r, white.g, white.b][c], cover);
        }
        terrainColors.needsUpdate = true;
        for (const item of foliage) item.material.color.copy(item.color).lerp(white, cover);
        ice.visible = winter;
        for (const flower of world.flowers) flower.visible = !winter;
        world.waterSphere.visible = !winter;
        weatherKey = nextWeather;
      }
      snow.visible = winter && mode === 'campsite';
      flakeGeo.setDrawRange(0, Math.round((env.snowfall ?? 0.4) * 600));
      for (let i = 0; i < 600; i++) {
        flakePositions[i * 3 + 1] -= delta * (1.2 + (i % 7) * 0.1);
        if (flakePositions[i * 3 + 1] < radius) flakePositions[i * 3 + 1] += 10;
      }
      flakeGeo.attributes.position.needsUpdate = true;
      const light = skyLighting(state.hour, winter);
      const { daylight, sunAngle, skyColor } = light;
      sun.position.set(Math.cos(sunAngle) * 30, radius + Math.sin(sunAngle) * 30, 10);
      sun.target.position.set(0, radius, 0);
      sun.intensity = 1.2 * daylight;
      hemi.intensity = 0.2 + daylight * 0.4;
      hemi.groundColor.setHex(cover > 0 ? 0xa6adb3 : 0x446622);
      scene.background = skyColor;
      scene.fog = env.fog > 0 ? new THREE.FogExp2(skyColor, env.fog * (mode === 'world' ? 0.025 : 0.15)) : null;
      if (mode === 'world') {
        pivot.rotation.y = time * 0.08;
        const distance = 58 / Math.min(1, camera.aspect);
        camera.position.set(distance * 0.55, distance * 0.45, distance * 0.75);
        camera.lookAt(0, 0, 0);
      } else {
        const distance = Math.max(5.4, 4.5 / camera.aspect);
        camera.position.set(1.2, radius + 2.7, distance);
        camera.lookAt(0, radius + 0.65, 0);
      }
      label.visible = mode === 'campsite';
      sky.update({ ...light, rotation: pivot.quaternion, playerPosition: player.position,
        winter, time });
      const hours = Math.floor(state.hour) % 24, minutes = Math.floor((state.hour % 1) * 60);
      caption.textContent = `${state.team ? state.team[0].toUpperCase() + state.team.slice(1) + ' team' : 'Waiting for team'} · ${winter ? 'Winter' : 'Summer'} · ${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
    }
    content = { update };
    resize();
  }

  function animate(now) {
    if (disposed) return;
    frame = requestAnimationFrame(animate);
    if (document.hidden) { previousTime = now; return; }
    try {
      const state = getState();
      if (state.seed === null || state.seed === undefined) return;
      if (seed !== state.seed || !content) build(state);
      const delta = Math.min(0.05, Math.max(0, (now - previousTime) / 1000));
      previousTime = now;
      content.update(state, delta, now / 1000);
      renderer.render(scene, camera);
      status.hidden = true;
    } catch (error) {
      console.error('Launch preview failed', error);
      dispose();
      status.hidden = false;
      status.textContent = 'Preview unavailable. You can still enter the world.';
    }
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    cancelAnimationFrame(frame);
    observer.disconnect();
    events.abort();
    if (scene) disposeObject(scene);
    renderer.dispose();
    renderer.forceContextLoss();
    renderer.domElement.remove();
  }
  resize();
  frame = requestAnimationFrame(animate);
  return { dispose };
}
