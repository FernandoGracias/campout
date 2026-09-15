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

// Two-point trajectories in the planet's inverse-square gravity field.
// In the launch plane, Binet's orbit equation is:
// 1/r(theta) = mu/h² + (1/r0 - mu/h²) cos(theta) - (vr/h) sin(theta).
// Substituting vr = vt*tan(elevation) gives the tangential launch speed
// required to reach the exact target radius and central angle. This accounts
// for the planet between the endpoints, unlike flat-ground projectile math.
export function* ballisticArcs(origin, target, mu, minRadius, maxSpeed = 20) {
  const dot = (a, b) => a.x*b.x + a.y*b.y + a.z*b.z;
  const length = v => Math.hypot(v.x, v.y, v.z);
  const r0 = length(origin), r1 = length(target);
  const up = { x: origin.x/r0, y: origin.y/r0, z: origin.z/r0 };
  const cosine = Math.max(-1, Math.min(1, dot(up, target)/r1));
  const tangent = { x: target.x-up.x*r1*cosine, y: target.y-up.y*r1*cosine, z: target.z-up.z*r1*cosine };
  const tangentLength = length(tangent);
  if (tangentLength < 1e-6 && cosine > 0) {
    // Directly overhead/below: the radial line itself is the gravity path.
    const direction = r1 >= r0 ? 1 : -1;
    const velocity = { x:up.x*maxSpeed*direction, y:up.y*maxSpeed*direction, z:up.z*maxSpeed*direction };
    const p = { x:origin.x, y:origin.y, z:origin.z }, v = { ...velocity }, points = [{ ...p }];
    for (let i = 0; i < 20*60; i++) {
      advanceOrbit(p,v,1/60,mu); points.push({ ...p });
      if ((length(p)-r1)*direction >= 0) { yield { velocity, points, error:0 }; break; }
      if (dot(v,up)*direction <= 0 || length(p) < minRadius) break;
    }
    return;
  }
  if (tangentLength < 1e-6) {
    // At the antipode every tangent plane is a valid route around the globe.
    const seed = Math.abs(up.x) < 0.8 ? {x:1,y:0,z:0} : {x:0,y:0,z:1};
    const projection = dot(seed,up);
    for (const axis of ['x','y','z']) tangent[axis] = seed[axis]-up[axis]*projection;
    const scale = length(tangent);
    for (const axis of ['x','y','z']) tangent[axis] /= scale;
  } else {
    for (const axis of ['x','y','z']) tangent[axis] /= tangentLength;
  }
  const theta = Math.atan2(tangentLength, r1*cosine), sine = Math.sin(theta);
  const oneMinusCosine = 2*Math.sin(theta/2)**2;
  const directElevation = Math.atan2(r1*cosine-r0, tangentLength);
  const start = Math.max(-1.45, directElevation), end = Math.PI/2-0.02;
  const dt = 1/60, maxSteps = 20*60;

  // Start with the lowest arc and increase elevation only if terrain/cover
  // blocks it. The generator stops doing work as soon as the caller accepts one.
  for (let sample = 1; sample <= 80; sample++) {
    const elevation = start+(end-start)*sample/80;
    const denominator = (r0-r1)/r1 + oneMinusCosine + Math.tan(elevation)*sine;
    if (denominator <= 0) continue;
    const vt = Math.sqrt(mu*oneMinusCosine/(r0*denominator));
    let vr = vt*Math.tan(elevation);
    if (!Number.isFinite(vt+vr) || Math.hypot(vt,vr) > maxSpeed || Math.hypot(vt,vr) < 3) continue;
    const h = r0*vt, inverseP = mu/(h*h);
    let crossesPlanet = false;
    for (let i = 1; i < 32; i++) {
      const angle = theta*i/32;
      const inverseR = inverseP+(1/r0-inverseP)*Math.cos(angle)-vr/h*Math.sin(angle);
      if (inverseR <= 0 || 1/inverseR < minRadius) { crossesPlanet = true; break; }
    }
    if (crossesPlanet) continue;

    const trace = radialSpeed => {
      const velocity = { x: tangent.x*vt+up.x*radialSpeed, y: tangent.y*vt+up.y*radialSpeed, z: tangent.z*vt+up.z*radialSpeed };
      const p = { x:origin.x, y:origin.y, z:origin.z }, v = { ...velocity };
      const points = [{ ...p }];
      let previousAngle = 0;
      for (let step = 0; step < maxSteps; step++) {
        const previous = { ...p };
        advanceOrbit(p, v, dt, mu);
        if (!Number.isFinite(length(p))) return null;
        points.push({ ...p });
        let angle = Math.atan2(dot(p,tangent),dot(p,up));
        if (angle < 0) angle += Math.PI*2;
        if (angle >= theta) {
          const fraction = (theta-previousAngle)/(angle-previousAngle);
          const crossing = { x:previous.x+(p.x-previous.x)*fraction, y:previous.y+(p.y-previous.y)*fraction, z:previous.z+(p.z-previous.z)*fraction };
          return { velocity, points, error:length(crossing)-r1 };
        }
        if (length(p) < minRadius-0.1) return null;
        previousAngle = angle;
      }
      return null;
    };

    // Correct the tiny discretization error against actual 60 Hz Verlet flight,
    // so the analytical conic and the game's collision segments agree.
    let arc = trace(vr);
    for (let correction = 0; arc && Math.abs(arc.error) > 0.015 && correction < 3; correction++) {
      const probe = trace(vr+0.02);
      if (!probe) break;
      const derivative = (probe.error-arc.error)/0.02;
      if (Math.abs(derivative) < 1e-6) break;
      vr -= Math.max(-1,Math.min(1,arc.error/derivative));
      if (Math.hypot(vt,vr) > maxSpeed) { arc = null; break; }
      arc = trace(vr);
    }
    if (arc && Math.abs(arc.error) <= 0.03 && length(arc.velocity) >= 3 && length(arc.velocity) <= maxSpeed) yield arc;
  }
}
