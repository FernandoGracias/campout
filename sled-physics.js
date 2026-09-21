// Ground supplies vertical velocity on an uphill; gravity takes over when the
// surface falls away at a crest. Heights are radial, so this works globe-wide.
const GRAVITY = 2.4;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export function createSledFlight() {
  let height = null, lastGround = null, velocity = 0, airborne = false;
  function reset() { height = lastGround = null; velocity = 0; airborne = false; }
  function step(ground, speed, delta) {
    if (height === null || lastGround === null || Math.abs(ground - lastGround) > 3) {
      height = lastGround = ground; velocity = 0; airborne = false;
      return { height, lift: 0, pitch: 0, airborne };
    }
    const dt = clamp(delta, 0.001, 0.1);
    const projected = height + velocity * dt - GRAVITY * dt * dt * 0.5;
    if (airborne || speed > 0.6 && projected > ground + 0.012) {
      height = projected; velocity -= GRAVITY * dt; airborne = true;
      if (height <= ground) { height = ground; velocity = 0; airborne = false; }
    } else {
      velocity = speed > 0.6 ? clamp((ground - lastGround) / dt, -6, 3.5) : 0;
      height = ground;
    }
    // Bound the visual/network lift even when a steep cliff drops below us.
    height = Math.min(height, ground + 8);
    lastGround = ground;
    const pitch = speed > 0.2 ? clamp(-Math.atan2(velocity, speed), -0.6, 0.6) : 0;
    return { height, lift: Math.max(0, height - ground), pitch, airborne };
  }
  return { step, reset, get airborne() { return airborne; } };
}
