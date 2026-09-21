import * as THREE from 'three';
import { createDecorationLightField } from './decoration-light-field.js?v=234';

export function isIOSDevice(device) {
  return /iPhone|iPad|iPod/i.test(device.userAgent || '') ||
    /Macintosh|MacIntel/i.test(`${device.userAgent || ''} ${device.platform || ''}`) && device.maxTouchPoints > 1;
}

export function createDecorationGlow(world) {
  // iOS keeps the inexpensive self-lit bulbs, without allocating halo buffers
  // or allocating the projected lighting field.
  if (world.disableDecorationGlow) return { setModels() {}, update() {} };
  const capacity = 3072;
  const geometry = new THREE.BufferGeometry();
  const position = new THREE.BufferAttribute(new Float32Array(capacity * 3), 3);
  const color = new THREE.BufferAttribute(new Float32Array(capacity * 3), 3);
  const sizes = new THREE.BufferAttribute(new Float32Array(capacity), 1);
  geometry.setAttribute('position', position); geometry.setAttribute('color', color);
  geometry.setAttribute('glowSize', sizes);
  geometry.setDrawRange(0, 0);
  const viewport = { value: 1 }, strength = { value: 0.3 };
  const material = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, depthTest: true,
    blending: THREE.AdditiveBlending, toneMapped: false,
    uniforms: { viewportHeight: viewport, glowStrength: strength },
    vertexShader: `attribute vec3 color; attribute float glowSize; varying vec3 glowColor; uniform float viewportHeight;
      void main() {
        vec4 view = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * view;
        gl_PointSize = clamp(glowSize * viewportHeight * projectionMatrix[1][1] / max(0.1, -2.0 * view.z), 1.0, 128.0);
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
  const lightField = createDecorationLightField(world);
  let bulbs = [];
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
      sizes.setX(bulbs.length, bulb.userData.glowSize || 0.45);
      bulbs.push({ point, tint, power: bulb.userData.glowPower || 0.6 });
    }
    geometry.setDrawRange(0, bulbs.length);
    position.needsUpdate = color.needsUpdate = sizes.needsUpdate = true;
    lightField.setBulbs(bulbs);
  }
  function update(delta) {
    const daylight = THREE.MathUtils.clamp(world.getDaylight(), 0, 1);
    strength.value = 0.18 + (1 - daylight) * 0.3;
    viewport.value = world.getViewportHeight();
    lightField.update(delta);
  }
  return { setModels, update };
}
