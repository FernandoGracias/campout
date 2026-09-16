import * as THREE from 'three';

export function updateNameLabel(sprite, name, color) {
  if (sprite.userData.name === name && sprite.userData.teamColor === color) return;
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  ctx.font = '100 28px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = color;
  ctx.fillText(name.substring(0, 15), 128, 32);
  sprite.material.map?.dispose();
  sprite.material.map = new THREE.CanvasTexture(canvas);
  sprite.material.map.minFilter = THREE.LinearFilter;
  sprite.material.needsUpdate = true;
  sprite.userData.name = name;
  sprite.userData.teamColor = color;
}

export function createNameLabel(name, color = '#dddddd') {
  const mat = new THREE.SpriteMaterial({ transparent: true, depthTest: false, depthWrite: false });
  const sprite = new THREE.Sprite(mat);
  sprite.renderOrder = 999;
  updateNameLabel(sprite, name, color);
  return sprite;
}
