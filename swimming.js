// Radial swimming works in the same way for local and remote campers.
export function createSwimming(THREE, WATER_RADIUS, SWIM_DEPTH) {
  function updateSwimming(mesh, terrainRadius, moving, delta, winterSurface = null) {
    const state = mesh.userData;
    if (winterSurface?.enabled) {
      state.swimming = false;
      state.swimBlend = 0;
      state.onIce = terrainRadius < winterSurface.iceRadius;
      return Math.max(terrainRadius, winterSurface.iceRadius) + (state.skating ? 0.07 : 0);
    }
    state.onIce = false;
    const depth = WATER_RADIUS - terrainRadius;
    // Hysteresis keeps tiny shoreline changes from toggling the stroke each frame.
    state.swimming = depth > (state.swimming ? SWIM_DEPTH - 0.1 : SWIM_DEPTH);
    const blend = 1 - Math.exp(-8 * delta);
    state.swimBlend = THREE.MathUtils.lerp(state.swimBlend || 0, state.swimming ? 1 : 0, blend);
    state.swimMoving = THREE.MathUtils.lerp(state.swimMoving || 0, moving ? 1 : 0, blend);
    state.swimPhase = ((state.swimPhase || 0) + delta * (3 + 4 * state.swimMoving)) % (Math.PI * 2);
    const bob = Math.sin(state.swimPhase * 2) * 0.025 * state.swimBlend;
    // Compensate for the lean around shoulder height, keeping the water at the shoulders.
    const lean = 0.85 * state.swimMoving * state.swimBlend;
    const floatRadius = WATER_RADIUS - SWIM_DEPTH + 0.78 * (1 - Math.cos(lean)) + bob;
    return Math.max(terrainRadius, floatRadius);
  }

  function resetSwimLimbs(mesh) {
    mesh.userData.leftArm.rotation.z = 0.15;
    mesh.userData.rightArm.rotation.z = -0.15;
    mesh.userData.leftLeg.rotation.z = 0;
    mesh.userData.rightLeg.rotation.z = 0;
  }

  // Blend over the ordinary walking pose so entering/leaving water stays fluid.
  function applySwimPose(mesh) {
    const s = mesh.userData;
    const weight = s.swimBlend || 0;
    if (weight < 0.001) return;
    const phase = s.swimPhase;
    const moving = s.swimMoving;
    mesh.rotateX(0.85 * moving * weight);
    mesh.rotateZ(Math.sin(phase) * 0.045 * weight * (1 - moving));
    // Both arms reach together, pull back slowly, then recover forward quickly.
    const cycle = phase / (Math.PI * 2);
    const pulling = cycle < 0.7;
    const strokeProgress = pulling ? cycle / 0.7 : (cycle - 0.7) / 0.3;
    const easedStroke = (1 - Math.cos(strokeProgress * Math.PI)) / 2;
    const paddle = pulling
      ? THREE.MathUtils.lerp(-2.4, 0.45, easedStroke)
      : THREE.MathUtils.lerp(0.45, -2.4, easedStroke);
    const recoverySpread = pulling ? 0 : Math.sin(strokeProgress * Math.PI) * 0.75;
    for (const [side, sign] of [['left', 1], ['right', -1]]) {
      const arm = s[side + 'Arm'];
      const leg = s[side + 'Leg'];
      const stroke = phase + (sign < 0 ? Math.PI : 0);
      const tread = -0.25 + Math.sin(stroke) * 0.3;
      arm.rotation.x = THREE.MathUtils.lerp(arm.rotation.x, THREE.MathUtils.lerp(tread, paddle, moving), weight);
      const armSpread = THREE.MathUtils.lerp(0.65 + Math.cos(stroke) * 0.1, 0.15 + recoverySpread, moving);
      arm.rotation.z = THREE.MathUtils.lerp(sign * 0.15, sign * armSpread, weight);
      leg.rotation.x = THREE.MathUtils.lerp(leg.rotation.x, Math.sin(stroke) * (0.22 + moving * 0.25), weight);
      leg.rotation.z = sign * (0.12 + Math.cos(stroke) * 0.06) * weight;
    }
  }
  return { updateSwimming, resetSwimLimbs, applySwimPose };
}
