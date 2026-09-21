import * as THREE from 'three';

// A fixed globe-space lighting volume. Bulb placement changes its contents;
// walking/camera movement only changes the coordinate transform used to sample
// it. One GPU lookup replaces view-dependent reassignment of colored lights.
export function createDecorationLightField(world) {
  const size = world.mobile ? 48 : 64, extent = 32, cell = extent * 2 / size;
  const values = new Float32Array(size * size * size * 3);
  const data = new Uint8Array(size * size * size * 4);
  const texture = new THREE.Data3DTexture(data, size, size, size);
  texture.format = THREE.RGBAFormat; texture.type = THREE.UnsignedByteType;
  texture.minFilter = texture.magFilter = THREE.LinearFilter;
  texture.unpackAlignment = 1; texture.needsUpdate = true;
  const field = { value: texture }, inverse = { value: new THREE.Matrix4() }, strength = { value: 0 };
  const materials = new WeakSet();
  let bulbs = [], dirty = false, clock = 0, nextMaterials = 0, nextBake = 0;
  function hookMaterials() {
    world.scene.traverse(object => {
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        if (!material?.isMeshStandardMaterial || materials.has(material)) continue;
        materials.add(material);
        const previous = material.onBeforeCompile, key = material.customProgramCacheKey();
        material.onBeforeCompile = (shader, renderer) => {
          previous.call(material, shader, renderer);
          shader.uniforms.decorationField = field;
          shader.uniforms.decorationInverse = inverse;
          shader.uniforms.decorationStrength = strength;
          shader.vertexShader = 'uniform mat4 decorationInverse; uniform float decorationStrength; varying vec3 vDecorationPosition;\n' + shader.vertexShader;
          shader.vertexShader = shader.vertexShader.replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
            if (decorationStrength > 0.0) {
            #ifdef USE_INSTANCING
              vDecorationPosition = (decorationInverse * modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
            #else
              vDecorationPosition = (decorationInverse * modelMatrix * vec4(transformed, 1.0)).xyz;
            #endif
            } else { vDecorationPosition = vec3(0.0); }`);
          shader.fragmentShader = 'uniform highp sampler3D decorationField; uniform float decorationStrength; varying vec3 vDecorationPosition;\n' + shader.fragmentShader;
          shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
            if (decorationStrength > 0.0) {
              totalEmissiveRadiance += texture(decorationField, (vDecorationPosition + 32.0) / 64.0).rgb * decorationStrength * diffuseColor.rgb;
            }`);
        };
        material.customProgramCacheKey = () => `${key}|decoration-field-2`;
        material.needsUpdate = true;
      }
    });
  }
  function bake() {
    values.fill(0); data.fill(0);
    const range = 3.8;
    for (const bulb of bulbs) {
      const p = bulb.point, tint = bulb.tint;
      const low = [p.x, p.y, p.z].map(n => Math.max(0, Math.floor((n - range + extent) / cell)));
      const high = [p.x, p.y, p.z].map(n => Math.min(size - 1, Math.ceil((n + range + extent) / cell)));
      for (let z = low[2]; z <= high[2]; z++) for (let y = low[1]; y <= high[1]; y++) for (let x = low[0]; x <= high[0]; x++) {
        const dx = (x + 0.5) * cell - extent - p.x, dy = (y + 0.5) * cell - extent - p.y, dz = (z + 0.5) * cell - extent - p.z;
        const distance2 = dx * dx + dy * dy + dz * dz;
        if (distance2 >= range * range) continue;
        const fade = 1 - Math.sqrt(distance2) / range;
        const light = (bulb.power || 0.6) * fade * fade / (0.4 + distance2);
        const i = (x + size * (y + size * z)) * 3;
        values[i] += tint.r * light; values[i + 1] += tint.g * light; values[i + 2] += tint.b * light;
      }
    }
    for (let i = 0, j = 0; i < values.length; i += 3, j += 4) {
      // Compress overlapping lamps together, preserving their RGB proportions
      // instead of clipping each channel into a broad white patch.
      const scale = 255 / (1 + Math.max(values[i], values[i + 1], values[i + 2]));
      data[j] = Math.round(values[i] * scale);
      data[j + 1] = Math.round(values[i + 1] * scale);
      data[j + 2] = Math.round(values[i + 2] * scale);
    }
    texture.needsUpdate = true; dirty = false;
  }
  function setBulbs(next) {
    bulbs = next; dirty = true;
    if (bulbs.length && world.getDaylight() <= 0) hookMaterials();
  }
  function update(delta) {
    clock += delta;
    // Keep the self-lit bulb/ghost materials and halos, but switch projected
    // light off in daylight. Skip both CPU work and the shader texture lookup.
    const casting = bulbs.length > 0 && world.getDaylight() <= 0;
    strength.value = casting ? 0.22 : 0;
    if (!casting) return;
    inverse.value.copy(world.globePivot.matrixWorld).invert();
    if (dirty && clock >= nextBake) { bake(); nextBake = clock + 0.15; }
    if (bulbs.length && clock >= nextMaterials) { hookMaterials(); nextMaterials = clock + 1; }
  }
  return { setBulbs, update };
}
