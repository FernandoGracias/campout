// Equal-mass contact: transfer only closing momentum, preserving tangential motion.
export function iceImpulse(a, b, normal) {
  const closing = normal.reduce((sum, n, i) => sum + (a[i] - b[i]) * n, 0);
  const magnitude = Math.max(0, closing) * 0.525; // Almost inelastic on ice.
  return normal.map(n => n * magnitude);
}

// Velocity Verlet conserves orbital energy far better than forward Euler.
// Accepts either plain vectors or THREE.Vector3; updates both in place.
export function advanceOrbit(position, velocity, dt, mu) {
  let scale = -mu / Math.pow(Math.hypot(position.x, position.y, position.z), 3);
  velocity.x += position.x * scale * dt / 2;
  velocity.y += position.y * scale * dt / 2;
  velocity.z += position.z * scale * dt / 2;
  position.x += velocity.x * dt;
  position.y += velocity.y * dt;
  position.z += velocity.z * dt;
  scale = -mu / Math.pow(Math.hypot(position.x, position.y, position.z), 3);
  velocity.x += position.x * scale * dt / 2;
  velocity.y += position.y * scale * dt / 2;
  velocity.z += position.z * scale * dt / 2;
}

// Shooting solutions for explicitly clicked targets only. Refine against the
// same curved-gravity integrator as real throws, rather than a flat-world arc.
// Shorter flight times come first; later solutions offer higher arcs over cover.
export function targetThrows(origin, target, mu, maxSpeed = 20) {
  const solutions = [];
  const distance = Math.hypot(target.x - origin.x, target.y - origin.y, target.z - origin.z);
  const gravity = -mu / Math.pow(Math.hypot(origin.x, origin.y, origin.z), 3);
  const start = Math.max(0.15, distance / maxSpeed);
  for (let duration = start; duration <= 3.6; duration += 0.12) {
    const steps = Math.max(1, Math.round(duration * 60)), time = steps / 60;
    const velocity = {};
    for (const axis of ['x', 'y', 'z']) velocity[axis] = (target[axis] - origin[axis]) / time - origin[axis] * gravity * time / 2;
    let error = Infinity;
    for (let iteration = 0; iteration < 8; iteration++) {
      const p = { ...origin }, v = { ...velocity };
      for (let i = 0; i < steps; i++) advanceOrbit(p, v, 1 / 60, mu);
      error = Math.hypot(target.x - p.x, target.y - p.y, target.z - p.z);
      if (error < 0.025) break;
      for (const axis of ['x', 'y', 'z']) velocity[axis] += (target[axis] - p[axis]) / time;
    }
    const speed = Math.hypot(velocity.x, velocity.y, velocity.z);
    if (error < 0.06 && speed >= 3 && speed <= maxSpeed) solutions.push({ velocity, steps });
  }
  return solutions;
}
