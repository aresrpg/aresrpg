// TOUCH INPUT STATE — the plain mutable singleton the touch scheme WRITES and the walk loop READS
// each frame. State + accessors stay separate from the React gesture layer and world-session adapter.
//
// ── THE FEED SEAM this module's shape must match — embed_voxel_player.js:336-343:
//     ctl.set_input({
//       forward: inert ? 0 : keys.forward,   // :337
//       strafe:  inert ? 0 : keys.strafe,    // :338
//       jump:    inert ? false : keys.jump,  // :339
//       walk, speed_scale, yaw,
//     })
//   M-04 will MERGE this module's { forward, strafe, jump } with keys{} at that exact call
//   (max-magnitude wins, so a Bluetooth keyboard on a tablet still works). `forward`/`strafe` are the
//   engine's documented [-1,1] camera-relative axes (controller.js:103-104); the engine normalizes the
//   DIRECTION itself (move_direction, controller.js:179-182) — so this module owns the per-axis [-1,1]
//   invariant ONLY and must NOT re-normalize magnitude (that fact has one home: the engine).
//
// ── LOOK / PINCH drain → the roam camera rig's PUBLIC api (camera_rig.js:454 rotate(dx,dy), :455
//   dolly(meters)): drag handlers ACCUMULATE via add_look/add_pinch; the frame loop DRAINS via
//   consume_look/consume_pinch (accumulate → consume → zeroed) and applies to cam.rotate/cam.dolly.

/** Clamp one movement axis to the documented [-1,1]; a non-finite calc collapses to 0 so a bad stick
 *  computation can never poison set_input. @param {number} v @returns {number} */
const clamp_axis = (v) => (!Number.isFinite(v) ? 0 : v > 1 ? 1 : v < -1 ? -1 : v)

/** Module-level touch state. Consumers READ these via the accessors below; the exported mutators are
 *  the ONLY sanctioned writers. */
const state = {
  forward: 0, // [-1,1] — +toward camera-forward. Written by the stick (M-03) via set_move.
  strafe: 0, // [-1,1] — +right.
  jump: false, // right-cluster JUMP button → the keys.jump equivalent (embed_voxel_player.js:339).
  look_dx: 0, // look-delta ACCUMULATOR (px) — drained by consume_look → cam.rotate.
  look_dy: 0,
  pinch_d: 0, // pinch scale-delta ACCUMULATOR — drained by consume_pinch → cam.dolly.
  armed: false, // the mobile scheme owns the canvas (roam, not fight/text input). The session adapter sets it.
  text_focused: false, // mirrors the D154 gate (embed_voxel_player.js:49-54): overlay hides, input inert.
  mount_toggle: false, // one-shot MOUNT-button intent — drained by consume_mount_toggle (see below).
}

// ── the is_active() CHANGE feed (M-04). The gate below is written by the ENGINE's frame loop (which alone
//   knows is_fight / text-focus / coarse-pointer) but READ by the React overlay, which must unmount when the
//   scheme stands down. Rather than duplicate the gate into a store — two homes for one fact — the module
//   publishes its OWN transitions and TouchControls subscribes (useSyncExternalStore, the same idiom
//   mobile_mode consumers use for live viewport changes). Edge-triggered: a per-frame set_armed(true) re-write with
//   an unchanged value notifies nobody, so this costs a 120 Hz loop one boolean compare.
/** @type {Set<() => void>} */
const listeners = new Set()
let last_active = false

/** Recompute the gate; on a CHANGE, reset the transient input (a fight/chat that opens under a held thumb
 *  must not leave a stale stick vector to re-apply when it closes — the ghost-walk defect) and notify. */
const publish_active = () => {
  const now = state.armed && !state.text_focused
  if (now === last_active) return
  last_active = now
  reset() // both directions: arming starts from a clean slate, disarming drops whatever the thumb held
  for (const listener of listeners) listener()
}

/** Subscribe to is_active() transitions. @param {() => void} listener @returns {() => void} unsubscribe */
export const subscribe_active = (listener) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/**
 * Set the normalized movement vector. Clamps each axis to the documented [-1,1] (a pure STATE-invariant
 * guard) — the STICK (M-03 touch_stick.js) owns the dead-zone + radial mapping; this module deliberately
 * does NOT absorb that. A full diagonal (1,1) is PRESERVED, not shrunk: the engine normalizes direction
 * (controller.js:179-182), so shrinking here would be a wrong second home for that fact.
 * @param {number} forward @param {number} strafe
 */
export const set_move = (forward, strafe) => {
  state.forward = clamp_axis(forward)
  state.strafe = clamp_axis(strafe)
}

/** Set the JUMP intent (right-cluster button: pointerdown→true, pointerup→false). HELD, not one-shot —
 *  the controller edge-detects the press AND reads release-to-cut / swim-rise / double-jump off the same
 *  held bit (controller.js:294-305), so a fire-once pulse would break variable jump height. @param {boolean} down */
export const set_jump = (down) => {
  state.jump = !!down
}

/** Signal a one-shot MOUNT toggle (right-cluster button tap). Drained ONCE by the frame loop, which fires
 *  the SAME toggle_mount() the keyboard's Digit1 fires — the engine stays the single owner of ride logic. */
export const set_mount_toggle = () => {
  state.mount_toggle = true
}

/** DRAIN the pending mount toggle and clear it. @returns {boolean} true iff a toggle was queued this frame */
export const consume_mount_toggle = () => {
  const out = state.mount_toggle
  state.mount_toggle = false
  return out
}

/** ACCUMULATE a look delta (drag move). Events between frames SUM; the frame loop drains once/frame.
 *  Non-finite components are ignored. @param {number} dx @param {number} dy */
export const add_look = (dx, dy) => {
  if (Number.isFinite(dx)) state.look_dx += dx
  if (Number.isFinite(dy)) state.look_dy += dy
}

/** DRAIN the accumulated look delta and ZERO it (accumulate → consume → zeroed). @returns {{dx:number,dy:number}} */
export const consume_look = () => {
  const out = { dx: state.look_dx, dy: state.look_dy }
  state.look_dx = 0
  state.look_dy = 0
  return out
}

/** ACCUMULATE a pinch scale delta (two-finger). Non-finite ignored. @param {number} d */
export const add_pinch = (d) => {
  if (Number.isFinite(d)) state.pinch_d += d
}

/** DRAIN the accumulated pinch delta and ZERO it. @returns {number} */
export const consume_pinch = () => {
  const out = state.pinch_d
  state.pinch_d = 0
  return out
}

/** Arm / disarm the scheme (the session adapter arms it during mobile roam only). @param {boolean} on */
export const set_armed = (on) => {
  state.armed = !!on
  publish_active()
}

/** Mirror the D154 text-focus gate (M-04/M-05 set it from the same focus signal). @param {boolean} on */
export const set_text_focused = (on) => {
  state.text_focused = !!on
  publish_active()
}

/** READ the current movement intent in the exact shape set_input consumes (embed_voxel_player.js:337-339).
 *  Returns a COPY so a consumer can't mutate state by reference. @returns {{forward:number,strafe:number,jump:boolean}} */
export const read_movement = () => ({ forward: state.forward, strafe: state.strafe, jump: state.jump })

/** The ONE gate M-04 reads before applying touch input: armed AND not suppressed by text focus
 *  (overlay hides while typing — mirrors embed_voxel_player.js:294's inert gate). @returns {boolean} */
export const is_active = () => state.armed && !state.text_focused

/** Zero ALL transient state (movement, look, pinch, jump) — call on disarm / overlay unmount so a stale
 *  look-delta or held stick never leaks into the next session. Deliberately does NOT touch the armed /
 *  text_focused gate flags (those are lifecycle, not transient input). */
export const reset = () => {
  state.forward = 0
  state.strafe = 0
  state.jump = false
  state.look_dx = 0
  state.look_dy = 0
  state.pinch_d = 0
  state.mount_toggle = false
}
