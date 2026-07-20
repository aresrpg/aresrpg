export const TOUCH_RUN_MAGNITUDE = 0.72

/**
 * Merge touch onto the exact keyboard intent shape consumed by ctl.set_input(). A false mobile gate returns
 * keyboard values verbatim; on mobile, max-magnitude axes preserve a paired Bluetooth keyboard, jump is the
 * same held bit, and stick throw selects the engine's existing walk/run gait.
 */
export function merge_movement_intent(keys, touch, mobile_active) {
  const merged = {
    forward: keys.forward,
    strafe: keys.strafe,
    jump: keys.jump,
    walk: keys.walk,
  }
  if (!mobile_active || !touch) return merged

  if (Math.abs(touch.forward) > Math.abs(merged.forward)) merged.forward = touch.forward
  if (Math.abs(touch.strafe) > Math.abs(merged.strafe)) merged.strafe = touch.strafe
  merged.jump = merged.jump || touch.jump
  const throw_magnitude = Math.hypot(touch.forward, touch.strafe)
  if (throw_magnitude > 1e-3) merged.walk = throw_magnitude < TOUCH_RUN_MAGNITUDE
  return merged
}
