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
