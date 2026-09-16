// Shared deterministic random source. Keep its call order stable when building worlds.
export function mulberry32(a) {
  return function() {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

export const TEAM_COLORS = { red: 0xcc3333, blue: 0x3366cc };
export function teamLabelColor(team) {
  return team === 'red' ? '#ff2020' : team === 'blue' ? '#0080ff' : '#dddddd';
}

// Dispose each shared resource once, even when several meshes use it.
export function disposeObject(object) {
  object.removeFromParent();
  const resources = new Set();
  object.traverse(child => {
    if (child.geometry) resources.add(child.geometry);
    for (const material of (Array.isArray(child.material) ? child.material : [child.material])) {
      if (!material) continue;
      if (material.map) resources.add(material.map);
      resources.add(material);
    }
    if (child.shadow) resources.add(child.shadow);
  });
  for (const resource of resources) resource.dispose();
}
