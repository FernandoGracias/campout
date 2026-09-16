// These controls publish the same room environment used by the in-game sidebar.
export function createLobbyWeather({ getEnvironment, getHour, canEdit, publish }) {
  const fields = [
    ['lobby-hour', 'hour', 1], ['lobby-snow-cover', 'snowCover', 100],
    ['lobby-snowfall', 'snowfall', 100], ['lobby-fog', 'fog', 100],
  ];
  function output(id, value) {
    document.getElementById(id + '-value').textContent = id === 'lobby-hour'
      ? `${String(Math.floor(value) % 24).padStart(2, '0')}:${String(Math.floor((value % 1) * 60)).padStart(2, '0')}`
      : `${Math.round(value)}%`;
  }
  for (const [id, key, scale] of fields) {
    document.getElementById(id).addEventListener('input', event => {
      if (!canEdit() || !getEnvironment()) return;
      const value = Number(event.target.value);
      output(id, value);
      publish({ [key]: value / scale });
    });
  }
  document.getElementById('lobby-winter').addEventListener('change', event => {
    if (canEdit() && getEnvironment()) publish({ winter: event.target.checked });
  });
  let previous;
  function sync() {
    const env = getEnvironment();
    document.getElementById('lobby-weather').disabled = !env || !canEdit();
    if (!env || previous === env) return;
    previous = env;
    document.getElementById('lobby-winter').checked = env.winter === true;
    for (const [id, key, scale] of fields) {
      const input = document.getElementById(id);
      if (document.activeElement !== input) input.value = (key === 'hour' ? getHour() : env[key]) * scale;
      output(id, Number(input.value));
    }
  }
  return { sync };
}
