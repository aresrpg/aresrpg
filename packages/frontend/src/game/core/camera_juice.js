// WALK-CAMERA FOV PULSE — a brief zoom-punch on the roam shoulder rig for reward beats (the search-zone
// juice — screen camera effects need strong feedback). Decoupled from the engine handle: the
// walk frame (embed_voxel_player.js) ADDS walk_fov_pulse(dt) to the shoulder-rig fov each frame, a gameplay
// seam FIRES pulse_walk_fov() to start a one-shot sin-bump. The frame reads the transient offset, the seam
// writes the trigger — no camera handle crosses the seam boundary (effects at the edges). The kin of the
// fight cam's your-turn zoom-punch (embed_voxel_fight_camera.js), for the WALK rig. prefers-reduced-motion
// is respected at the CALL site (the seam skips pulse_walk_fov) — this module stays a pure transform.

const PULSE_DUR = 0.32 // s — the whole punch (~300ms per the brief)
const PULSE_PEAK = -6 // deg — a subtle push-IN at the peak (negative = narrower fov = zoom-in emphasis)

let t = PULSE_DUR // start finished (idle) — no offset until a seam fires the pulse

/** Fire a one-shot walk-camera FOV punch (idempotent restart if one is mid-flight). @returns {void} */
export function pulse_walk_fov() {
  t = 0
}

/**
 * Advance the pulse by `dt` (seconds) and return the additive FOV offset for THIS frame (0 when idle). A
 * single sin bump over PULSE_DUR: ease in to the peak, ease back to 0. The walk frame adds this to pose.fov.
 * @param {number} dt frame delta in seconds
 * @returns {number} degrees to add to the rig fov (0 when no pulse is running)
 */
export function walk_fov_pulse(dt) {
  if (t >= PULSE_DUR) return 0
  t += dt
  const u = Math.min(1, t / PULSE_DUR)
  return PULSE_PEAK * Math.sin(Math.PI * u)
}
