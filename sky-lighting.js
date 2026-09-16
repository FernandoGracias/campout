import * as THREE from 'three';

export function skyLighting(hour, winter) {
  const sunAngle = (hour - 6) / 24 * Math.PI * 2;
  const sunAltitude = Math.sin(sunAngle);
  const daylight = THREE.MathUtils.smoothstep(sunAltitude, -0.12, 0.22);
  const twilight = Math.exp(-Math.pow(sunAltitude / 0.12, 2)) * 0.65;
  const skyColor = new THREE.Color(0x0a0a1e).lerp(new THREE.Color(winter ? 0xc3ccd1 : 0x68b8e8), daylight)
    .lerp(new THREE.Color(winter ? 0xcdd0d2 : 0xffaa55), twilight);
  return { sunAngle, sunAltitude, daylight, twilight, skyColor };
}
