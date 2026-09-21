// Matches campout-server/src/ghost-game.js; positions use shared room time.
export function ghostPosition(ghost, now) {
  const t = Math.max(0, (now - ghost.at) / 1000);
  const lat = ghost.latitude + Math.sin(t * 0.45 + ghost.phase) * 0.08;
  const lon = ghost.phase + t * ghost.speed;
  const radius = 26.2 + Math.sin(t * 0.9 + ghost.phase) * 0.3;
  return [Math.cos(lat) * Math.cos(lon) * radius, Math.sin(lat) * radius, Math.cos(lat) * Math.sin(lon) * radius];
}
