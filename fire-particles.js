// The campfire's inward pull, rising sparks and smoke drift, shared with gear.
// A step of 1 retains the existing campfire animation; gear uses delta * 30.
export function advanceFireParticle(positions, i, spark, step = 1) {
  const x = positions[i * 3], z = positions[i * 3 + 2];
  const distance = Math.sqrt(x * x + z * z);
  if (spark) {
    positions[i * 3] += (Math.random() - 0.5) * 0.004 * step;
    positions[i * 3 + 1] += (0.039 + Math.random() * 0.026) * step;
    positions[i * 3 + 2] += (Math.random() - 0.5) * 0.004 * step;
  } else if (distance > 0.06) {
    const pull = (0.008 + distance * 0.016) * step;
    positions[i * 3] -= (x / distance) * pull;
    positions[i * 3 + 2] -= (z / distance) * pull;
    positions[i * 3 + 1] += (0.008 + (1 - distance) * 0.01) * step;
  } else {
    positions[i * 3] += (Math.random() - 0.5) * 0.004 * step;
    positions[i * 3 + 1] += (0.016 + Math.random() * 0.01) * step;
    positions[i * 3 + 2] += (Math.random() - 0.5) * 0.004 * step;
  }
}

export function advanceSmokeParticle(positions, i, velocity, step = 1) {
  positions[i * 3] += velocity.x * step;
  positions[i * 3 + 1] += velocity.y * step;
  positions[i * 3 + 2] += velocity.z * step;
}
