// Mouse and trackpad secondary clicks are indistinguishable in Pointer Events.
// Support both a latched click and a hold/drag/release gesture on either device.
export function createSnowballPointer(winter) {
  let gesture = null;
  return {
    down(event) {
      if (event.pointerType !== 'mouse' || event.button !== 2 || !winter.enabled) return false;
      if (!winter.holding) {
        winter.action();
        return true;
      }
      gesture = { id: event.pointerId, x: event.clientX, y: event.clientY,
        at: event.timeStamp, latched: winter.aimSelected, moved: false };
      winter.setAim(true);
      return true;
    },
    move(event) {
      if (gesture?.id !== event.pointerId) return;
      gesture.moved ||= Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) > 3;
    },
    up(event) {
      if (!gesture || gesture.id !== event.pointerId || event.button !== 2) return;
      const completed = gesture;
      gesture = null;
      // The first quick click latches aim. Subsequent clicks, or releasing a
      // deliberate hold/drag, fire. Never let release reload after another shot.
      if (winter.aimSelected && winter.holding &&
          (completed.latched || completed.moved || event.timeStamp - completed.at >= 250)) winter.action();
    },
    cancel() { gesture = null; winter.setAim(false); },
  };
}
