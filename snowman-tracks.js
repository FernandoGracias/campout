import * as THREE from 'three';

// One bounded terrain-conforming strip pool for all rolling sections. Only new
// strips upload vertices; existing tracks fade on the GPU using a time uniform.
export function createSnowmanTracks(globePivot, surface, mobile = false) {
  const capacity = mobile ? 768 : 1536;
  const geometry = new THREE.BufferGeometry();
  const positions = new THREE.BufferAttribute(new Float32Array(capacity * 18), 3).setUsage(THREE.DynamicDrawUsage);
  const births = new THREE.BufferAttribute(new Float32Array(capacity * 6).fill(-100000), 1).setUsage(THREE.DynamicDrawUsage);
  const edges = new THREE.BufferAttribute(new Float32Array(capacity * 6), 1);
  for (let i = 0; i < capacity; i++) edges.array.set([0, 1, 0, 0, 1, 1], i * 6);
  geometry.setAttribute('position', positions);
  geometry.setAttribute('trackBorn', births);
  geometry.setAttribute('trackEdge', edges);
  geometry.setDrawRange(0, 0);
  const clock = { value: 0 }, lifetime = { value: 90 };
  const material = new THREE.MeshBasicMaterial({ color: 0x334454, transparent: true, opacity: 0.3,
    depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  material.onBeforeCompile = shader => {
    shader.uniforms.trackClock = clock;
    shader.uniforms.trackLifetime = lifetime;
    shader.vertexShader = 'attribute float trackBorn; attribute float trackEdge; varying float vTrackBorn; varying float vTrackEdge;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvTrackBorn = trackBorn; vTrackEdge = trackEdge;');
    shader.fragmentShader = 'uniform float trackClock; uniform float trackLifetime; varying float vTrackBorn; varying float vTrackEdge;\n' + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
      float fade = clamp((trackLifetime - (trackClock - vTrackBorn)) / 15.0, 0.0, 1.0);
      float edge = smoothstep(0.0, 0.15, vTrackEdge) * (1.0 - smoothstep(0.85, 1.0, vTrackEdge));
      diffuseColor.a *= fade * edge;`);
  };
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false; mesh.visible = false; globePivot.add(mesh);
  const previous = new Map();
  let cursor = 0, count = 0, enabled = false;
  function trace(object) {
    if (!enabled || object.complete || !object.holder) { previous.delete(object.id); return; }
    const point = new THREE.Vector3(...object.position).normalize();
    const width = [0.55, 0.4, 0.28][object.stage] * (0.25 + 0.75 * object.growth) * 1.3;
    const old = previous.get(object.id);
    const distance = old ? old.point.distanceTo(point) * 20 : 0;
    if (!old || old.stage !== object.stage || clock.value - old.at > 2 || distance > 4) {
      previous.set(object.id, { point, width, stage: object.stage, at: clock.value }); return;
    }
    if (distance < 0.08) return;
    const steps = Math.ceil(distance / 0.18);
    let a = old.point;
    for (let step = 1; step <= steps; step++) {
      const t = step / steps;
      const b = old.point.clone().lerp(point, t).normalize();
      const across = new THREE.Vector3().crossVectors(b.clone().sub(a), b).normalize();
      const halfWidthA = (old.width + (width - old.width) * (step - 1) / steps) * 0.5;
      const halfWidthB = (old.width + (width - old.width) * t) * 0.5;
      const corners = [a.clone().multiplyScalar(20).addScaledVector(across, -halfWidthA),
        a.clone().multiplyScalar(20).addScaledVector(across, halfWidthA),
        b.clone().multiplyScalar(20).addScaledVector(across, -halfWidthB),
        b.clone().multiplyScalar(20).addScaledVector(across, halfWidthB)].map(p => {
        p.normalize(); return p.multiplyScalar(surface(p) + 0.018);
      });
      const slot = cursor++ % capacity;
      for (const [i, corner] of [0, 1, 2, 2, 1, 3].entries()) {
        const p = corners[corner];
        positions.setXYZ(slot * 6 + i, p.x, p.y, p.z);
        births.setX(slot * 6 + i, clock.value);
      }
      positions.addUpdateRange(slot * 18, 18); births.addUpdateRange(slot * 6, 6);
      count = Math.min(capacity, count + 1); a = b;
    }
    geometry.setDrawRange(0, count * 6);
    positions.needsUpdate = births.needsUpdate = true;
    previous.set(object.id, { point, width, stage: object.stage, at: clock.value });
  }
  function update(delta, snowy, snowfall) {
    clock.value += delta;
    lifetime.value = snowfall > 0 ? 60 : 120;
    enabled = snowy;
    mesh.visible = snowy && count > 0;
    if (!snowy && count) { count = cursor = 0; geometry.setDrawRange(0, 0); previous.clear(); }
  }
  return { trace, update, forget: id => previous.delete(id) };
}
