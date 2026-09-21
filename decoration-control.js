// Uses the existing circular action button and active-input hint patterns.
const ICONS = {
  lights: '<path d="M2 5q10 7 20 0M5 7v4m7-2v4m7-6v4"/><path d="M3 12h4v4H3zm7 2h4v4h-4zm7-2h4v4h-4z"/>',
  ornament: '<circle cx="12" cy="14" r="7"/><path d="M10 7V4h4v3m-2-3V2M6 12l12 4"/>',
  wreath: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><path d="M12 18l-5-2v5l5-3 5 3v-5z"/>',
  'christmas-tree': '<path d="M12 2L6 9h3l-5 6h4l-5 5h18l-5-5h4l-5-6h3zM12 20v3"/><circle cx="11" cy="11" r=".8"/><circle cx="14" cy="16" r=".8"/>',
  pumpkin: '<path d="M12 6V3l3-1M12 6C1 1-3 21 10 21h4C27 21 23 1 12 6z"/><path d="M6 12l3-3 1 3zm8 0 1-3 3 3zM7 16l3 2 2-1 2 1 3-2"/>',
  lantern: '<path d="M9 5V3h6v2M5 8l7-4 7 4H5zm1 0v12h12V8M4 21h16M9 9v10m6-10v10M12 12v4"/>',
  ghost: '<path d="M5 21V10a7 7 0 0114 0v11l-4-3-3 3-3-3z"/><circle cx="9" cy="10" r="1"/><circle cx="15" cy="10" r="1"/><ellipse cx="12" cy="15" rx="1" ry="2"/>',
  web: '<path d="M12 2v20M2 12h20M5 5l14 14M5 19L19 5M12 4l6 2 2 6-2 6-6 2-6-2-2-6 2-6zM12 8l3 1 1 3-1 3-3 1-3-1-1-3 1-3z"/>',
  remove: '<path d="M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7"/>',
};
export function createDecorationControl(getSelection, cycle) {
  const button = document.getElementById('btn-decoration');
  const hint = document.createElement('span'); hint.className = 'winter-hint';
  let mode = 'keyboard', last = '';
  button.addEventListener('click', cycle);
  function update(inputMode = mode) {
    mode = inputMode;
    const selection = getSelection();
    button.style.display = selection ? 'flex' : 'none';
    if (!selection) { last = ''; return; }
    button.disabled = selection.disabled;
    const key = `${selection.id}:${mode}`;
    if (key === last) return;
    last = key;
    // SVG content is exclusively from this fixed allowlist, never room data.
    button.innerHTML = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[selection.id]}</svg>`;
    hint.textContent = mode === 'gamepad' ? 'RB' : 'C';
    hint.style.display = mode === 'touch' ? 'none' : 'block';
    button.append(hint);
    const input = mode === 'gamepad' ? 'RB' : mode === 'touch' ? 'Tap' : 'C';
    button.title = `${selection.name} · ${input} to cycle`;
    button.setAttribute('aria-label', `${selection.name}. Cycle decoration.`);
  }
  return { update };
}
