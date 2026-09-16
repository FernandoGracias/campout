import { advanceFireParticle, advanceSmokeParticle } from './fire-particles.js';

// Particle positions live in the planet frame, not under the moving pinecone:
// emitted smoke/embers stay behind as the projectile moves or disappears.
export function createPineconeFire(THREE, globePivot, mobile = false) {
  const up = new THREE.Vector3(0, 1, 0);
  const emitters = new WeakMap();
  const scale = { value: 1 };
  const vertexShader = `
    attribute float particleSize;
    attribute float particleAlpha;
    attribute vec3 particleColor;
    uniform float pointScale;
    varying vec3 vColor;
    varying float vAlpha;
    void main() {
      vec4 view = modelViewMatrix * vec4(position, 1.0);
      gl_Position = projectionMatrix * view;
      gl_PointSize = particleAlpha > 0.0 ? clamp(particleSize * pointScale / max(0.1, -view.z), 1.0, 80.0) : 0.0;
      vColor = particleColor;
      vAlpha = particleAlpha;
    }`;
  const fragmentShader = `
    varying vec3 vColor;
    varying float vAlpha;
    void main() {
      float radius = length(gl_PointCoord - vec2(0.5));
      float alpha = vAlpha * (1.0 - smoothstep(0.15, 0.5, radius));
      if (alpha < 0.005) discard;
      gl_FragColor = vec4(vColor, alpha);
      #include <colorspace_fragment>
    }`;
  function pool(count, smoke = false) {
    const positions = new Float32Array(count * 3), offsets = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3), sizes = new Float32Array(count), alphas = new Float32Array(count);
    const geometry = new THREE.BufferGeometry();
    for (const [name, values, size] of [['position', positions, 3], ['particleColor', colors, 3], ['particleSize', sizes, 1], ['particleAlpha', alphas, 1]]) {
      geometry.setAttribute(name, new THREE.BufferAttribute(values, size).setUsage(THREE.DynamicDrawUsage));
    }
    const material = new THREE.ShaderMaterial({ vertexShader, fragmentShader,
      uniforms: { pointScale: scale }, transparent: true, depthWrite: false, toneMapped: false,
      blending: smoke ? THREE.NormalBlending : THREE.AdditiveBlending });
    const mesh = new THREE.Points(geometry, material);
    mesh.name = smoke ? 'pinecone-black-smoke' : 'pinecone-fire-particles';
    mesh.frustumCulled = false;
    globePivot.add(mesh);
    return { count, positions, offsets, colors, sizes, alphas, geometry, mesh, cursor: 0,
      particles: Array.from({ length: count }, () => ({ life: 0, age: 0, origin: new THREE.Vector3(),
        velocity: new THREE.Vector3(), rotation: new THREE.Quaternion() })) };
  }
  const fire = pool(mobile ? 512 : 1024);
  const smoke = pool(mobile ? 768 : 1536, true);
  const embers = pool(mobile ? 128 : 256);
  embers.mesh.name = 'pinecone-impact-embers';
  const yellow = new THREE.Color(0xffce44), orange = new THREE.Color(0xff4a08), red = new THREE.Color(0xff2400);
  const offset = new THREE.Vector3();

  function spawn(target, origin, direction, life, size, color, velocity = null, spark = false) {
    const i = target.cursor++ % target.count, particle = target.particles[i];
    particle.origin.copy(origin);
    particle.rotation.setFromUnitVectors(up, direction);
    particle.velocity.copy(velocity || up).multiplyScalar(velocity ? 1 : 0);
    particle.life = life; particle.age = 0; particle.size = size; particle.spark = spark;
    const angle = Math.random() * Math.PI * 2, radius = Math.random() * 0.08;
    target.offsets.set([Math.cos(angle) * radius, 0, Math.sin(angle) * radius], i * 3);
    target.colors.set([color.r, color.g, color.b], i * 3);
  }

  function update(object, burning, time, velocity = null) {
    if (!burning) { emitters.delete(object); return; }
    const position = globePivot.worldToLocal(object.getWorldPosition(new THREE.Vector3()));
    let emitter = emitters.get(object);
    if (!emitter) {
      emitter = { position: position.clone(), time: time - 1 / 30, fire: 0, smoke: 0 };
      emitters.set(object, emitter);
    }
    const delta = Math.min(0.1, Math.max(0, time - emitter.time));
    const radial = position.clone().normalize();
    const flying = velocity && velocity.lengthSq() > 1;
    // Flame motion follows the airflow, opposite flight; held flames rise.
    const direction = flying ? velocity.clone().normalize().negate().addScaledVector(radial, 0.12).normalize() : radial;
    emitter.fire += delta * 110;
    emitter.smoke += delta * (flying ? 45 : 20);
    const emit = (target, count, isSmoke) => {
      for (let i = 0; i < count; i++) {
        // Fill the segment travelled this frame so fast throws have no gaps.
        const origin = emitter.position.clone().lerp(position, (i + 1) / count);
        if (isSmoke) {
          const drift = radial.clone().multiplyScalar(0.012 + Math.random() * 0.012);
          if (flying) drift.addScaledVector(direction, 0.008);
          drift.add(new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(0.007));
          spawn(smoke, origin, up, 1.6 + Math.random() * 1.2, 0.24, { r: 0.004, g: 0.004, b: 0.004 }, drift);
        } else {
          spawn(fire, origin, direction, flying ? 0.14 + Math.random() * 0.12 : 0.3 + Math.random() * 0.3,
            0.11 + Math.random() * 0.08, Math.random() < 0.3 ? yellow : orange, null, Math.random() < 0.08);
        }
      }
    };
    const fireCount = Math.floor(emitter.fire), smokeCount = Math.floor(emitter.smoke);
    emit(fire, fireCount, false); emit(smoke, smokeCount, true);
    emitter.fire -= fireCount; emitter.smoke -= smokeCount;
    emitter.position.copy(position); emitter.time = time;
  }

  function impact(position, velocity = null) {
    const radial = position.clone().normalize();
    for (let i = 0; i < 24; i++) {
      const drift = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5)
        .multiplyScalar(1.4).addScaledVector(radial, 0.6 + Math.random() * 0.6);
      if (velocity) drift.addScaledVector(velocity, -0.025);
      spawn(embers, position, up, 0.55 + Math.random() * 0.65, 0.045 + Math.random() * 0.035,
        Math.random() < 0.35 ? yellow : red, drift, true);
    }
  }

  function advance(delta, camera, viewportHeight) {
    scale.value = viewportHeight * camera.projectionMatrix.elements[5] * 0.5;
    for (const target of [fire, smoke, embers]) {
      let active = false;
      for (let i = 0; i < target.count; i++) {
        const p = target.particles[i];
        p.age += delta;
        if (p.age >= p.life) { target.alphas[i] = 0; continue; }
        active = true;
        const progress = p.age / p.life;
        if (target === fire) {
          advanceFireParticle(target.offsets, i, p.spark, delta * 30);
          offset.fromArray(target.offsets, i * 3).applyQuaternion(p.rotation).add(p.origin);
        } else if (target === smoke) {
          advanceSmokeParticle(target.offsets, i, p.velocity, delta * 30);
          offset.fromArray(target.offsets, i * 3).add(p.origin);
        } else {
          p.velocity.addScaledVector(p.origin.clone().normalize(), -1.8 * delta);
          p.origin.addScaledVector(p.velocity, delta);
          offset.copy(p.origin);
        }
        target.positions.set([offset.x, offset.y, offset.z], i * 3);
        target.alphas[i] = (target === smoke ? 0.65 : 1) * (1 - progress);
        target.sizes[i] = p.size * (target === smoke ? 1 + progress * 2.5 : 1 - progress * 0.45);
      }
      target.mesh.visible = active;
      for (const attribute of Object.values(target.geometry.attributes)) attribute.needsUpdate = true;
    }
  }
  return { update, impact, advance };
}
