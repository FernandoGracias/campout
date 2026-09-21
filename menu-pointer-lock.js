// Pointer lock must be requested from the selection's user gesture, not from a
// later server vote/round update. Never acquire it for someone who wasn't locked.
export function createMenuPointerLock(canvas, document, onDenied = () => {}) {
  let wasLocked = false;
  function request() {
    try { canvas.requestPointerLock()?.catch(onDenied); }
    catch { onDenied(); }
  }
  return {
    open() {
      wasLocked = document.pointerLockElement === canvas;
      if (wasLocked) document.exitPointerLock();
    },
    close(restore) {
      const resume = restore && wasLocked;
      wasLocked = false;
      if (resume && document.pointerLockElement !== canvas) request();
    },
    request,
  };
}
