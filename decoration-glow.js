import * as THREE from 'three';

export function isIOSDevice(device) {
  return /iPhone|iPad|iPod/i.test(device.userAgent || '') ||
    /Macintosh|MacIntel/i.test(`${device.userAgent || ''} ${device.platform || ''}`) && device.maxTouchPoints > 1;
}

export function createDecorationGlow(world) {
  // iOS keeps the inexpensive self-lit bulbs, without allocating halo buffers
  // or adding point lights to the scene's lighting shader.
  if (world.disableDecorationGlow) return { setModels() {}, update() {} };
  const capacity = 3072;
  const geometry = new THREE.BufferGeometry();
  const position = new THREE.BufferAttribute(new Float32Array(capacity * 3), 3);
  const color = new THREE.BufferAttribute(new Float32Array(capacity * 3), 3);
  geometry.setAttribute('position', position); geometry.setAttribute('color', color);
  geometry.setDrawRange(0, 0);
  const viewport = { value: 1 }, strength = { value: 0.3 };
  const material = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, depthTest: true,
    blending: THREE.AdditiveBlending, toneMapped: false,
    uniforms: { viewportHeight: viewport, glowStrength: strength },
    vertexShader: `attribute vec3 color; varying vec3 glowColor; uniform float viewportHeight;
      void main() {
        vec4 view = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * view;
        gl_PointSize = clamp(0.45 * viewportHeight * projectionMatrix[1][1] / max(0.1, -2.0 * view.z), 1.0, 96.0);
        glowColor = color;
      }`,
    fragmentShader: `varying vec3 glowColor; uniform float glowStrength;
      void main() {
        vec2 point = gl_PointCoord * 2.0 - 1.0;
        float radius = dot(point, point);
        if (radius >= 1.0) discard;
        gl_FragColor = vec4(glowColor, pow(1.0 - radius, 3.0) * glowStrength);
        #include <colorspace_fragment>
      }` });
  const halos = new THREE.Points(geometry, material);
  halos.frustumCulled = false; world.globePivot.add(halos);
  // Fixed shader light count; choose only nearby, spaced-out bulbs. No shadows
  // or post-processing pass. Extra decorations never allocate extra lights.
  const lights = Array.from({ length: world.mobile ? 2 : 4 }, () => {
    const light = new THREE.PointLight(0xffffff, 0, 4.5, 2);
    light.castShadow = false; world.scene.add(light); return light;
  });
  let bulbs = [], chosen = [], clock = 0, nextSelection = 0;
  function setModels(models) {
    bulbs = [];
    world.globePivot.updateWorldMatrix(true, true);
    const inverse = world.globePivot.matrixWorld.clone().invert();
    for (const model of models.values()) for (const bulb of model.userData.glowBulbs || []) {
      if (bulbs.length >= capacity) break;
      const point = bulb.getWorldPosition(new THREE.Vector3()).applyMatrix4(inverse);
      const tint = bulb.material.color.clone();
      position.setXYZ(bulbs.length, point.x, point.y, point.z);
      color.setXYZ(bulbs.length, tint.r, tint.g, tint.b);
      bulbs.push({ point, tint });
    }
    geometry.setDrawRange(0, bulbs.length);
    position.needsUpdate = color.needsUpdate = true;
    chosen = []; nextSelection = 0;
  }
  function update(delta) {
    clock += delta;
    const daylight = THREE.MathUtils.clamp(world.getDaylight(), 0, 1);
    strength.value = 0.18 + (1 - daylight) * 0.3;
    viewport.value = world.getViewportHeight();
    if (clock >= nextSelection) {
      nextSelection = clock + 0.2;
      const here = world.player.position.clone().add(new THREE.Vector3(0, 0.6, 0)).applyQuaternion(world.getRotation().clone().invert());
      const nearby = bulbs.map(b => ({ ...b, distance: b.point.distanceToSquared(here) }))
        .filter(b => b.distance < 64).sort((a, b) => a.distance - b.distance);
      chosen = [];
      for (const bulb of nearby) {
        if (chosen.some(other => other.point.distanceToSquared(bulb.point) < 1.7)) continue;
        chosen.push(bulb);
        if (chosen.length === lights.length) break;
      }
    }
    for (let i = 0; i < lights.length; i++) {
      const light = lights[i], bulb = chosen[i];
      light.intensity = bulb ? 1.6 + (1 - daylight) * 1.4 : 0;
      if (bulb) { light.position.copy(bulb.point).applyQuaternion(world.getRotation()); light.color.copy(bulb.tint); }
    }
  }
  return { setModels, update };
}
