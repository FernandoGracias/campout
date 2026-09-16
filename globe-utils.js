import * as THREE from 'three';

export function createGlobeUtils(GLOBE_RADIUS, rng) {
  function placeOnGlobe(obj, lat, lon, offset = 0) {
    const pos = latLonToWorld(lat, lon);
    const normal = pos.clone().normalize();
    obj.position.copy(pos).addScaledVector(normal, offset);
    const up = new THREE.Vector3(0, 1, 0);
    const quat = new THREE.Quaternion().setFromUnitVectors(up, normal);
    obj.quaternion.copy(quat);
  }
  function latLonToWorld(lat, lon) {
    const x = GLOBE_RADIUS * Math.cos(lat) * Math.cos(lon);
    const y = GLOBE_RADIUS * Math.sin(lat);
    const z = GLOBE_RADIUS * Math.cos(lat) * Math.sin(lon);
    return new THREE.Vector3(x, y, z);
  }
  function worldToLatLon(pos) {
    const n = pos.clone().normalize();
    const lat = Math.asin(n.y);
    const lon = Math.atan2(n.z, n.x);
    return { lat, lon };
  }
  function randomPointOnSphere() {
    const u = rng();
    const v = rng();
    const lat = Math.asin(2 * u - 1);
    const lon = 2 * Math.PI * v;
    return { lat, lon };
  }
  return { placeOnGlobe, latLonToWorld, worldToLatLon, randomPointOnSphere };
}
