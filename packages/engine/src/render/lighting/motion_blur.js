// [D258 — the character must never visibly duplicate itself; screen borders should blur in a
// VIGNETTE instead] RADIAL EDGE (vignette) motion blur. The old D214 effect blurred the
// whole frame with directional taps along the pan axis — at speed those 6 taps became 6 discrete COPIES
// of high-contrast subjects (the character duplicating) = the observed ghosting. This replaces it with a single-frame RADIAL
// blur: each pixel samples toward the SCREEN CENTRE, scaled by its distance from centre, so the centre
// (where the avatar sits) stays razor sharp and only the borders smear outward — a speed-modulated
// vignette. ZERO temporal accumulation (rtt is the CURRENT frame only), zero directional duplication.
//
// Modulated by COMBINED camera MOTION (translation for roaming + rotation for panning) so it engages
// whenever the view moves and folds to a byte-identical crisp frame at rest. One rtt + a short radial
// tap loop; tier-gated (high); ?blur=0 kills it; set_enabled(false) is the per-fight runtime gate.
//
// [ENG camera-feel 2026-07-12 — a motion-blur vignette while RUNNING] a second,
// explicit trigger: the player's horizontal ground speed (threaded per-frame from engine.js — the same
// value the shoulder camera reads for its speed-FOV, see camera_rig.js), gated to engage only above
// RUN_ENGAGE_FRAC of run pace. DELIBERATELY NOT a new module: this effect already IS the radial vignette
// blur the ask describes (inner-sharp/outer-smear, low tap count, exp-damped fade) — a second parallel
// blur pass would double-sample the same screen for the same visual family and risk the D258 ghosting
// regression this file exists to prevent. The two triggers combine via max() (never sum, so simultaneous
// running+whip-pan can't exceed max_radial) — the ORIGINAL camera-motion trigger (translation + rotation)
// is untouched, so the D258 anti-ghost-on-fast-pan fix keeps working exactly as before.
import { Vector3 } from 'three'
import { Fn, float, length, mix, rtt, screenUV, smoothstep, uniform, vec2, vec4 } from 'three/tsl'

/** Combined-motion units (m/s + weighted rad/s) where the blur starts to engage. */
const ENGAGE = 1.2
/** Motion units at which the edge blur reaches full strength. */
const FULL = 9.0
/** Rotation weight — rad/s scaled into the same metric as translation m/s (a fast whip ≈ a fast run). */
const ROT_WEIGHT = 2.5
/** Max radial smear (fraction of screen) at the very edge, at full motion. [D263 — blur while
 *  turning/walking barely read] bumped 0.05→0.14 so both read clearly. ?blurmax=<n> overrides live (tunable). */
const MAX_RADIAL = 0.14
/** Screen radius (from centre, 0..~0.71) where the blur STARTS — everything inside stays sharp. */
const INNER_RADIUS = 0.34
/** Screen radius where the edge blur is FULL. */
const OUTER_RADIUS = 0.9
/** Radial samples toward centre. */
const TAPS = 6
/** Exponential damp half-life (s) — smooths the intensity so it can't strobe frame-to-frame. */
const DAMP_HALFLIFE = 0.06
/** [ENG camera-feel] player-speed trigger: engages above this fraction of RUN_SPEED_REF (target: "~40%
 *  run speed"), ramping to full strength by RUN_SPEED_REF itself. */
const RUN_ENGAGE_FRAC = 0.4
/** Mirrors controller.js's RUN_SPEED (10.5 m/s) — duplicated-with-a-comment rather than imported, the
 *  same precedent camera_rig.js's BOB_RUN_SPEED already set (render/lighting never imports player/). */
const RUN_SPEED_REF = 10.5

/** Clamp `x` into [0,1]. @param {number} x */
const clamp01 = (x) => Math.min(1, Math.max(0, x))

/**
 * Creates the radial edge (vignette) motion-blur output effect (the post stack's `output_effect`
 * contract: `build(final_node, ctx) → vec4` + `update(camera)` per frame). Named for its legacy import.
 */
export function create_camera_rotation_blur() {
  const u_mag = uniform(0) // radial smear scale at the edge (0 = off / crisp)
  // [D263] live taste tune: ?blurmax=<n> overrides the ceiling for hands-on convergence.
  let max_radial = MAX_RADIAL
  if (typeof location !== 'undefined') {
    const q = parseFloat(new URLSearchParams(location.search).get('blurmax') ?? '')
    if (Number.isFinite(q) && q >= 0) max_radial = q
  }

  const prev_pos = new Vector3()
  const cur_pos = new Vector3()
  const prev_forward = new Vector3(0, 0, -1)
  const cur_forward = new Vector3()
  let last_t = typeof performance !== 'undefined' ? performance.now() : 0
  let damped = 0
  let primed = false
  let enabled = true // [D251-2] runtime gate — the dapp kills the blur during fights (constraint: no fight blur)

  return {
    // [ENG camera-feel] the live radial-smear uniform — exposed on the handle itself (not just via
    // window.__motion_blur) so both the bench hook and pure-math tests can read the current magnitude
    // without rendering a frame (the same idiom auto_exposure.js/god_rays.js use for their uniforms).
    u_mag,
    /** [D251-2] runtime enable/disable (constraint: NO motion blur in fights). Off ⇒ u_mag pinned to 0. */
    set_enabled(/** @type {boolean} */ on) {
      enabled = !!on
      if (!enabled) {
        damped = 0
        u_mag.value = 0
      }
    },
    /** @param {import('three').PerspectiveCamera} camera @param {number} [speed] horizontal player
     *  ground speed (m/s) — the SAME value the shoulder camera reads (camera_rig.js speed-FOV), threaded
     *  per-frame from engine.js. Optional/defaults to 0 so any caller still passing camera-only is
     *  byte-identical to before (no run contribution ⇒ the original camera-motion trigger alone). */
    update(camera, speed = 0) {
      if (!enabled) {
        u_mag.value = 0
        return
      }
      const now = typeof performance !== 'undefined' ? performance.now() : last_t + 16.6
      const dt = Math.max(1e-3, (now - last_t) / 1000)
      last_t = now
      cur_pos.copy(camera.position)
      camera.getWorldDirection(cur_forward)
      if (!primed) {
        primed = true
        prev_pos.copy(cur_pos)
        prev_forward.copy(cur_forward)
        return
      }
      // combined motion: translation (m/s) + rotation (rad/s, weighted into the same scale).
      const trans_speed = cur_pos.distanceTo(prev_pos) / dt
      const dot = Math.min(1, Math.max(-1, prev_forward.dot(cur_forward)))
      const ang_speed = Math.acos(dot) / dt
      const motion = trans_speed + ang_speed * ROT_WEIGHT
      // ramp ENGAGE→FULL into 0→MAX_RADIAL (the original D258 pan/roam trigger — untouched).
      const cam_target = clamp01((motion - ENGAGE) / (FULL - ENGAGE)) * max_radial
      // [ENG camera-feel] explicit RUN-SPEED trigger: 0 below RUN_ENGAGE_FRAC·RUN_SPEED_REF, full by
      // RUN_SPEED_REF. Combined via max() (never sum) so running WHILE whip-panning can't exceed max_radial.
      const run_target =
        clamp01((speed - RUN_ENGAGE_FRAC * RUN_SPEED_REF) / (RUN_SPEED_REF * (1 - RUN_ENGAGE_FRAC))) * max_radial
      const target = Math.max(cam_target, run_target)
      // exponential-damp the combined target (no strobing).
      const k = 1 - Math.pow(0.5, dt / DAMP_HALFLIFE)
      damped += (target - damped) * k
      u_mag.value = damped < 0.0004 ? 0 : damped
      prev_pos.copy(cur_pos)
      prev_forward.copy(cur_forward)
    },

    /** @param {*} final_node the graded display-space vec4 @param {*} _ctx reconstruction handles */
    build(final_node, _ctx) {
      // The taps need a TEXTURE of the finished frame — rtt renders the graded node once (current frame
      // only; NO previous-frame accumulation, so nothing can ghost). Each fragment then averages TAPS
      // samples marched TOWARD the screen centre, the march length scaled by the fragment's edge weight.
      const frame = rtt(final_node)
      return Fn(() => {
        const centre = vec2(0.5, 0.5)
        const to_centre = centre.sub(screenUV) // radial direction (toward centre)
        const d = length(screenUV.sub(centre)) // 0 at centre → ~0.71 at a corner
        // vignette weight: 0 inside INNER_RADIUS (sharp centre — the avatar), ramping to 1 by OUTER_RADIUS.
        const edge = smoothstep(float(INNER_RADIUS), float(OUTER_RADIUS), d)
        const amt = edge.mul(/** @type {*} */ (u_mag)) // per-pixel radial smear length
        const acc = frame.sample(screenUV).toVar()
        for (let i = 1; i < TAPS; i += 1) {
          const t = float(i / (TAPS - 1)) // 0..1 across the march toward centre
          acc.addAssign(frame.sample(screenUV.add(to_centre.mul(amt).mul(t))))
        }
        const blurred = acc.div(float(TAPS))
        // centre (edge≈0) shows the crisp frame; the borders (edge→1) show the radial blur. At rest u_mag=0
        // ⇒ amt=0 ⇒ blurred==crisp, so this mix is a byte-identical no-op until the camera moves.
        return vec4(mix(frame.sample(screenUV).rgb, blurred.rgb, edge), 1)
      })()
    },
  }
}
