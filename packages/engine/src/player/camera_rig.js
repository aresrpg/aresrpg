// Immersive shoulder camera rig (ENG-8). A hand-rolled over-the-shoulder third-person orbit — NO
// camera-controls dependency (house law: port the technique, never import the lib). It reproduces the
// FEEL of the shipped dapp camera (packages/frontend player-camera.js): a spring-damped follow of the
// character at head height, a slight lateral SHOULDER offset, spring-arm smoothing, dynamic FOV that
// widens with speed, camera COLLISION (sphere-march the arm so a wall never clips through), and the
// "free mouse except when rotating" input scheme (cursor free; hold LEFT + drag → pointer-lock → the
// camera rotates via movementX/Y; release → cursor free). It OUTPUTS a camera pose (position + look
// yaw/pitch) + an FOV each frame; the demo pushes them through engine.set_camera_position/orientation/
// set_camera_fov (so the bench's seize_camera + the fly camera coexist unchanged).
//
// FEEL PARITY (ported constants from player-camera.js — do not "improve" without a deliberate design decision):
//   BASE_FOV 65 · MAX_FOV_BOOST 10 · MAX_SPEED 12 · FOV_LAMBDA 8 · HEAD_HEIGHT 1.0 · FOLLOW_HALFLIFE
//   0.15 (critically-damped spring, verbatim) · polar clamp 12°..88° (never look under the ground) ·
//   default shoulder distance ~4.5 m (a close over-the-shoulder frame, tighter than the dapp's 10 m
//   free-orbit start — a SHOULDER cam was the ask) · wheel dolly within [MIN,MAX].
//
// The "rotate only while a button is held" nuance is the load-bearing UX detail that was called out
// ("free mouse except when rotating, what is already implemented"): between drags the OS cursor is
// visible and the world does not orbit; the moment LEFT is held and dragged past a threshold we grab
// pointer lock and consume movementX/Y as azimuth/polar deltas, exactly as the shipped controller does.

import { PointerLockControls } from './pointer_lock.js'

/** @typedef {[number, number, number]} Vec3 */

// ── ported feel constants ────────────────────────────────────────────────────────────────────────
const BASE_FOV = 65
const MAX_FOV_BOOST = 10
const MAX_SPEED = 12
const FOV_LAMBDA = 8
const HEAD_HEIGHT = 1.0
const FOLLOW_HALFLIFE = 0.15
// [ENG camera-feel 2026-07-12 — the world camera should feel smoother while running] the
// follow spring's halflife eases UP from FOLLOW_HALFLIFE toward this at RUN pace only (see the
// speed_ratio scaling in update()) — idle/walk stay byte-identical at 0.15 (crisp); running trails a
// touch more (smoother). Conservative bump (not the CINE_FOLLOW_HALFLIFE 0.4 cinematic dolly-glide).
const RUN_FOLLOW_HALFLIFE = 0.22
const ROTATE_SENSITIVITY = 0.0025 // rad per pixel of movementX/Y while pointer-locked (dapp-ish feel)
const MIN_POLAR = (12 * Math.PI) / 180 // from straight UP (camera-controls parity): top-down cap (eye high)
const MAX_POLAR = (135 * Math.PI) / 180 // [D223 — the camera must be able to look further up] the
// eye may now swing well BELOW the head-plane (down to ~45° under it) to look steeply up at the sky/
// canopy/wall tops — the sphere-cast ground collision keeps the arm honest near the floor. (was 88°)
// shoulder framing
const SHOULDER_OFFSET = 0.5 // lateral (right) offset of the orbit pivot — the "over-the-shoulder" bias
const MIN_DIST = 1.2 // classic close-third-person floor; S-75 first person engages below it (= FP_ENTER_DIST)
const MAX_DIST = 8
/** [D223] zoom ease rate (damp λ): higher = snappier glide; ~8 reads smooth without lag. */
const ZOOM_LAMBDA = 8
const START_DIST = 4.5 // default over-the-shoulder distance
// ── CAMERA↔WALL MARGIN (S-76b 2026-07-10 — the camera saw through blocks when too close, especially
// in first person) — the near-plane x-ray class. The camera must keep every solid FACE
// outside the near-plane FRUSTUM CORNERS, not just outside the near distance. Derivation (the (c)
// verification, from the real pipeline numbers — renderer.js create_renderer near = 0.1):
//   corner = near · √(1 + tan²(fov_v/2) · (1 + aspect²))
//   worst case: fov 75° (BASE 65 + MAX_FOV_BOOST 10), aspect ≤ 2.4 (ultrawide) → 0.1·√4.98 ≈ 0.223 m
// CAM_WALL_MARGIN = 0.3 covers that with slack that also swallows the ±0.06 m head-bob (applied to eye
// y after the clamp). Enforced as an L∞ CUBE margin (cube_overlaps_solid): a clean cube ⇒ every solid
// face ≥ margin in L∞ ⇒ ≥ margin in Euclidean — conservative at block corners, which is exactly where
// the old 7-sample sphere probe leaked (a diagonal approach could rest a face inside the near corner).
// DECLARED residual: FP inside a 1-block doorway leaves side faces ~0.1 m off the eye (the BODY owns
// x/z there — 0.8 wide in a 1.0 gap); geometrically unfixable with near 0.1 (corner ≥ near). No render
// tricks — the fight board's deliberate see-through (D267 board_occlusion) is a separate system.
const CAM_WALL_MARGIN = 0.3 // L∞ margin (m) every camera anchor keeps off solid faces (was the 0.3 "sphere")
const FP_WALL_BACKOFF_MAX = 0.6 // FP nose-to-wall: pull the eye back along the view axis at most this far
// (< 1 block — the clamp can never cross THROUGH a wall to its far side); no clean spot ⇒ keep the head.
const FP_WALL_BACKOFF_STEP = 0.05 // back-march granularity (m)
const ARM_LAMBDA = 18 // how fast the collided arm length eases back out when the wall clears (no snap)

// ── HEAD-BOB (S-73 2026-07-09 — target: a slight subtle up and down movement while running) ─────────
// A speed-scaled vertical sine on the CAMERA EYE ONLY (never the avatar mesh): the view breathes up/down
// while grounded + moving, ZERO when idle or airborne, with a ~0.2 s eased amplitude envelope so starts
// and stops never pop. Applied as a PURE VERTICAL translation of the returned eye AFTER yaw/pitch are
// derived (from the un-bobbed eye), so the frame bobs without nodding/re-aiming (no motion-sickness).
// DEV kill-switch: set `window.__ARES_BOB = false`. One constants block — the whole feel dials here.
const BOB_WALK_HZ = 1.6 // vertical bob frequency (Hz) at walk pace…
const BOB_RUN_HZ = 2.2 // …and at run pace (speed-lerped between the two)
const BOB_WALK_AMP = 0.035 // half-amplitude (m) of the vertical sine at walk…
const BOB_RUN_AMP = 0.06 // …and at run (target band ~0.04–0.07 m at the camera)
const BOB_MIN_SPEED = 0.5 // below this horizontal speed (m/s) = idle → no bob (matches classify_anim's gate)
const BOB_WALK_SPEED = 4.8 // speed the walk freq/amp anchor to (= controller WALK_SPEED)
const BOB_RUN_SPEED = 10.5 // …and the run anchor (= controller RUN_SPEED); the ratio lerps freq + amp
const BOB_EASE_LAMBDA = 15 // exp-damp λ on the amplitude envelope → ~0.2 s ease in/out (no pop on start/stop)

// ── FIRST PERSON (S-75 2026-07-09 — target: fully zooming in should enter first person view) ───────
// Wheeling fully in crosses FP_ENTER_DIST and BLENDS the eye onto the avatar's head anchor (the same
// eye the head-bob rides — the bob carries into FP naturally); wheeling back out past FP_EXIT_DIST
// restores the shoulder view (the hysteresis band = no flicker at the boundary). Mode follows the
// USER'S TARGET distance only — never the collision-shortened arm, so a wall squeezing the camera
// close can never flip modes. The look math here is position-independent (yaw = azimuth, pitch =
// f(polar) — the arm cancels in the atan2), so the blend is a PURE eye translation: mouse look is
// byte-identical in both modes, zero look pop. The reported pose.distance collapses with the blend
// (arm × (1 − ease)), so the app's EXISTING `distance > 1.0` own-mesh hide fires while the eye is
// still ~1 m behind the head — the camera never sees inside the skull. ROAM camera only: cinematic
// (TR-1) keeps its own continuous CINE_MIN_DIST glide (FP mode forced OFF while recording), and the
// fight camera never routes through this rig. DEV kill-switch: window.__ARES_FP = false.
const FP_ENTER_DIST = 1.2 // target-dist below this ⇒ first person (== the classic MIN_DIST TP floor)
const FP_EXIT_DIST = 1.4 // target-dist above this ⇒ back to third person (0.2 m hysteresis band)
const FP_MIN_DIST = 1.0 // normal-mode dolly floor (was MIN_DIST 1.2): ONE wheel notch (0.5 m) below the
// old floor lands exactly here — inside FP — and one notch out lands 1.5 > FP_EXIT: single-notch in AND out.
const FP_BLEND_S = 0.2 // s of smoothstepped eye travel shoulder↔head (target band 0.15–0.25 — no pop)

// ── TR-1 CINEMATIC (trailer-recording) mode ──────────────────────────────────────────────────────
// A key-toggled "smooth recording" feel: heavily damped look, a slower trailing follow, reduced look
// speed and gentler speed-FOV — the classic eased-accel/decel dolly. OFF instantly restores the exact
// normal params (the follow halflife resets, the rendered look angles snap back to the raw input next
// frame). Roam camera ONLY — the tactical board camera never routes through this rig.
const CINE_LOOK_SCALE = 0.5 // ×0.5 look sensitivity while recording (the brief's ~0.5× reduced look speed)
const CINE_LOOK_LAMBDA = 3.5 // exp-damp λ on the RENDERED look angles (~0.057 lerp/frame @60fps) — softer ease-in/out (target: "more smooth")
const CINE_FOLLOW_HALFLIFE = 0.4 // slower trailing follow (normal FOLLOW_HALFLIFE 0.15) — the dolly-on-rails glide
const CINE_FOV_LAMBDA = 3 // gentler speed-FOV easing (normal FOV_LAMBDA 8) — no snappy zoom on speed changes
// TR-1 v2 (refinements). All cinematic-SCOPED — toggle OFF re-clamps every value to the normal range.
// CONSTANT-PACE PAN (target: "keep the same pace no matter how fast I move my mouse"): on top of the exp
// damp, the per-frame rendered look step is hard-capped to a fixed angular velocity, so whipping the mouse
// never accelerates the pan — a big delta just pans LONGER at the same rate. Damp still shapes the ease
// in/out under the ceiling; the clamp only bites on fast input.
const CINE_MAX_LOOK_RATE = 0.45 // rad/s — the constant capped pan speed (~26°/s; a full 360° ≈ 14 s), tuned for a slower rotation
const CINE_MAX_DIST = 16 // cinematic zoom-OUT ceiling (2× the normal MAX_DIST 8) — wide establishing pull-back
const CINE_MIN_DIST = 0.05 // cinematic zoom-IN floor → FIRST PERSON (eye at the head; avatar auto-hides < ~1.0 m)

/**
 * Critically-damped spring on a 3D target — Game Programming Gems 4 style, frame-rate independent.
 * Ported VERBATIM from the dapp's player-camera.js (pure math, zero coupling) so the follow feel is
 * identical.
 */
class CriticallyDampedSpring3D {
  /** @param {number} halflife */
  constructor(halflife = 0.2) {
    this.halflife = halflife
    this.vx = 0
    this.vy = 0
    this.vz = 0
    this.x = 0
    this.y = 0
    this.z = 0
    this.initialized = false
  }

  /** @param {number} tx @param {number} ty @param {number} tz @param {number} dt @returns {Vec3} */
  update(tx, ty, tz, dt) {
    if (!this.initialized) {
      this.x = tx
      this.y = ty
      this.z = tz
      this.initialized = true
      return [this.x, this.y, this.z]
    }
    const omega = 4 / this.halflife
    const exp = Math.exp(-omega * dt)
    const dt_exp = dt * exp
    const pp = (1 + omega * dt) * exp
    const pv = dt_exp
    const vp = -omega * omega * dt_exp
    const vv = (1 - omega * dt) * exp
    // Inline the identical scalar recurrence: the old inner closure + three `[position, velocity]`
    // return arrays allocated four objects on every camera update and fed turn-time GC pressure.
    let d = this.x - tx
    let np = pp * d + pv * this.vx
    this.vx = vp * d + vv * this.vx
    this.x = np + tx
    d = this.y - ty
    np = pp * d + pv * this.vy
    this.vy = vp * d + vv * this.vy
    this.y = np + ty
    d = this.z - tz
    np = pp * d + pv * this.vz
    this.vz = vp * d + vv * this.vz
    this.z = np + tz
    return [this.x, this.y, this.z]
  }

  reset() {
    this.initialized = false
    this.vx = this.vy = this.vz = 0
  }
}

/** Exponential damp (dapp form). @param {number} c @param {number} t @param {number} l @param {number} dt */
function damp(c, t, l, dt) {
  return c + (t - c) * (1 - Math.exp(-l * dt))
}

/** TR-1 v2 — exp-damp toward a target, then HARD-CAP the per-frame step to `max_rate·dt` (a fixed angular
 *  velocity ceiling). Small deltas ease under the cap (damp shapes them); big deltas advance at the constant
 *  capped pace, frame after frame, until caught up. @param {number} c current @param {number} t target
 *  @param {number} l damp λ @param {number} max_rate rad/s ceiling @param {number} dt @returns {number} */
function approach_capped(c, t, l, max_rate, dt) {
  const eased_step = (t - c) * (1 - Math.exp(-l * dt))
  const cap = max_rate * dt
  return c + clamp(eased_step, -cap, cap)
}

/**
 * @typedef {object} CameraPose the per-frame output the demo pushes to the engine.
 * @property {Vec3} position world-space eye position (collision-resolved).
 * @property {number} yaw look yaw (radians) — feed engine.set_camera_orientation.
 * @property {number} pitch look pitch (radians).
 * @property {number} fov vertical FOV (degrees) — feed engine.set_camera_fov.
 * @property {number} distance the EFFECTIVE eye distance: the (collided) arm length × (1 − FP blend), so
 *   it collapses to 0 in first person — the app's existing `distance > 1.0` avatar-hide gates both the
 *   close-wall squeeze AND the S-75 first-person entry off this one number.
 * @property {boolean} first_person true while the S-75 first-person zoom mode is latched (the eye blend
 *   may still be in flight — drive visibility off `distance`, mode-aware UI off this flag).
 */

/**
 * @typedef {object} ShoulderCamera
 * @property {(opts: { feet: Vec3, eye_height: number, speed: number, solid_at: (x:number,y:number,z:number)=>boolean, dt: number, on_ground?: boolean }) => CameraPose}
 *   update advances the rig one frame around the player and returns the camera pose. `feet` = player
 *   feet-centre; `eye_height` = avatar head height above feet; `speed` = horizontal m/s (dynamic FOV +
 *   head-bob); `solid_at` = the collision oracle for the arm sphere-march; `on_ground` (default true) =
 *   grounded flag gating the head-bob (bob is zeroed while airborne). Call once per rendered frame.
 * @property {() => number} get_yaw current azimuth (radians) — the controller reads this as the
 *   movement basis so WASD stays screen-relative as the player orbits.
 * @property {(canvas: HTMLElement) => void} attach wires the hold-to-rotate pointer-lock listeners.
 * @property {() => void} detach removes them + releases any active lock.
 * @property {() => boolean} is_rotating true while a hold-drag pointer-lock rotate is active.
 * @property {(dx: number, dy: number) => void} rotate applies a rotate delta as if from a pointer-lock
 *   drag (dx/dy in the same pixel units as movementX/Y). BENCH HOOK: pointer lock is blocked under
 *   automation, so the acceptance spec drives the 180° turn (motion-blur proof) through this.
 * @property {(meters: number) => void} dolly programmatic zoom (+ out / − in) — mirrors the wheel and
 *   honours the cinematic-widened distance range. TR-1 v2.
 * @property {(on: boolean) => void} set_cinematic TR-1 — toggle the trailer-recording camera (damped
 *   look + slower trailing follow + reduced look speed + gentler FOV). OFF restores the exact normal params.
 * @property {() => boolean} is_cinematic true while cinematic mode is engaged.
 * @property {() => number} get_bob_offset the last pose's synthetic vertical eye offset (head-bob); overhead
 *   plates add it to their anchor Y before projecting to stay world-locked (bob removed at the source).
 * @property {() => void} dispose
 */

/**
 * Creates the shoulder camera rig. @param {object} [opts]
 * @param {number} [opts.yaw] initial azimuth (radians) — face the same way the player spawns.
 * @param {number} [opts.distance] initial arm length (default START_DIST).
 * @returns {ShoulderCamera}
 */
export function create_shoulder_camera({ yaw = 0, distance = START_DIST } = {}) {
  // Orbit state. `azimuth` = yaw around the player; `polar` = angle from straight-UP (camera-controls
  // parity, spherical). We keep polar near ~70° (a gentle look-down-at-the-shoulder) by default.
  let azimuth = yaw
  let polar = (72 * Math.PI) / 180
  let target_dist = clamp(distance, MIN_DIST, MAX_DIST)
  /** [D223] the EASED zoom distance — damped toward target_dist so wheel notches glide. */
  let zoom_dist = target_dist
  let arm = target_dist // the collision-eased current arm length
  const follow = new CriticallyDampedSpring3D(FOLLOW_HALFLIFE)
  let fov = BASE_FOV
  // TR-1 — cinematic mode + the SMOOTHED (rendered) look angles. In normal mode az_view/pol_view TRACK
  // the raw azimuth/polar exactly (snapped each update), so every downstream value is byte-identical to
  // pre-TR-1; in cinematic mode they exp-ease toward the raw input for the damped trailer pan.
  let cinematic = false
  let az_view = azimuth
  let pol_view = polar
  // HEAD-BOB state (S-73): the accumulating sine phase + the eased amplitude envelope (→ 0 when idle/air).
  let bob_phase = 0
  let bob_amp_env = 0
  let last_bob_y = 0 // the last frame's SYNTHETIC vertical eye offset — exposed so overhead plates can un-bob
  //                    their projection (world-lock them, no swim) instead of the deleted screen-Y damper
  // FIRST-PERSON state (S-75): the hysteresis mode latch + the 0→1 blend fraction (smoothstepped on use).
  let fp_mode = false
  let fp_blend = 0

  /** Applies a rotate delta (pixel units, like pointer-lock movementX/Y) to the orbit angles.
   *  @param {number} dx @param {number} dy */
  const apply_rotate = (dx, dy) => {
    // TR-1 — reduced look speed while recording (the raw angles still accumulate; the rendered smoothing
    // happens in update()). Normal mode uses the unchanged sensitivity → identical feel.
    const sens = cinematic ? ROTATE_SENSITIVITY * CINE_LOOK_SCALE : ROTATE_SENSITIVITY
    azimuth -= dx * sens
    // Polar from straight-UP, `polar − dy` sign VERIFIED identical to camera-controls' locked-pointer
    // path (deltaY = −movementY → phi += −movementY): drag DOWN (movementY>0) lowers polar → eye rises →
    // look down; drag UP (movementY<0) raises polar → eye descends toward the horizon.
    polar = clamp(polar - dy * sens, MIN_POLAR, MAX_POLAR)
  }

  // TR-1 v2 — the live dolly range: normal [FP_MIN,MAX] (S-75 dropped the floor below FP_ENTER so the
  // wheel can reach first person); cinematic widens BOTH ends (deeper zoom-out ceiling + its own
  // continuous FP floor). Everything else reads these so the whole rig stays mode-scoped.
  const dist_lo = () => (cinematic ? CINE_MIN_DIST : FP_MIN_DIST)
  const dist_hi = () => (cinematic ? CINE_MAX_DIST : MAX_DIST)

  /** Dolly the TARGET distance by `meters` (+ = out, − = in), clamped to the live [lo,hi] range. The wheel
   *  feeds ±0.5 m notches; also the public programmatic zoom (bench/test hook). @param {number} meters */
  const dolly = (meters) => {
    target_dist = clamp(target_dist + meters, dist_lo(), dist_hi())
    // [D223] the wheel only moves the TARGET — zoom_dist eases toward it in update() (both directions),
    // so notches never snap; only WALL collision shortens instantly.
  }

  const controls = PointerLockControls({
    on_rotate: apply_rotate,
    on_wheel: (delta) => dolly(Math.sign(delta) * 0.5), // scroll down (delta>0) = zoom out
  })

  /** @type {ShoulderCamera['update']} */
  function update({ feet, eye_height, speed, solid_at, dt, on_ground = true }) {
    // [ENG camera-feel] walk→run speed ratio (0 at/under WALK pace, 1 at/over RUN pace) — ONE formula,
    // shared with the S-73 head-bob ratio below (was duplicated inline; single source of truth). Scales
    // the FOLLOW spring's halflife toward RUN_FOLLOW_HALFLIFE at run pace (idle/walk stay untouched —
    // see the constant's comment). Cinematic keeps its own hand-tuned CINE_FOLLOW_HALFLIFE (set once by
    // set_cinematic) — never overridden here.
    const speed_ratio = clamp((speed - BOB_WALK_SPEED) / (BOB_RUN_SPEED - BOB_WALK_SPEED), 0, 1)
    if (!cinematic) follow.halflife = FOLLOW_HALFLIFE + (RUN_FOLLOW_HALFLIFE - FOLLOW_HALFLIFE) * speed_ratio
    // [D223] ease the (pre-collision) zoom distance FIRST — the FP shoulder-fade below reads it.
    zoom_dist = damp(zoom_dist, target_dist, ZOOM_LAMBDA, dt)
    // FIRST-PERSON gate (S-75): hysteresis on the USER'S TARGET distance — never the collided arm (a
    // wall squeezing the camera close must not flip modes). Cinematic keeps its own proven
    // continuous glide, so FP mode is forced OFF while recording; dev kill: window.__ARES_FP = false.
    const fp_allowed = (typeof window === 'undefined' || /** @type {any} */ (window).__ARES_FP !== false) && !cinematic
    if (!fp_allowed) fp_mode = false
    else if (!fp_mode && target_dist < FP_ENTER_DIST) fp_mode = true
    else if (fp_mode && target_dist > FP_EXIT_DIST) fp_mode = false
    fp_blend = fp_mode ? Math.min(1, fp_blend + dt / FP_BLEND_S) : Math.max(0, fp_blend - dt / FP_BLEND_S)
    // TR-1 — resolve the RENDERED look angles. cinematic: exp-ease toward the raw input (damped trailer pan),
    // then HARD-CAP the per-frame step to CINE_MAX_LOOK_RATE·dt so fast mouse never accelerates the pan
    // (constant pace — a big delta just pans longer). normal: SNAP (az_view===azimuth) so the whole frame
    // below is byte-identical to pre-TR-1. Both angles accumulate the same continuous form → plain damp.
    if (cinematic) {
      az_view = approach_capped(az_view, azimuth, CINE_LOOK_LAMBDA, CINE_MAX_LOOK_RATE, dt)
      pol_view = approach_capped(pol_view, polar, CINE_LOOK_LAMBDA, CINE_MAX_LOOK_RATE, dt)
    } else {
      az_view = azimuth
      pol_view = polar
    }
    // Orbit PIVOT = the character's head, spring-smoothed, biased laterally for the shoulder framing. TR-1 v2
    // FIRST PERSON: the lateral shoulder bias fades out as the zoom crosses below the normal MIN_DIST, so a
    // cinematic full zoom-in lands a CENTERED first-person eye; at/above MIN_DIST it is 1 (the normal
    // shoulder framing, byte-identical). [S-75] normal mode now floors at FP_MIN_DIST (1.0, shoulder ~0.42)
    // — the S-75 blend overrides toward the RAW centered head anyway, so the residual bias never shows.
    const shoulder = SHOULDER_OFFSET * clamp(zoom_dist / MIN_DIST, 0, 1)
    const [head_x, feet_y, head_z] = feet
    const head_y = feet_y + Math.max(eye_height, HEAD_HEIGHT)
    // right vector (perp to the look azimuth on the ground plane) for the shoulder offset
    const right_x = Math.cos(az_view)
    const right_z = -Math.sin(az_view)
    const pivot_tx = head_x + right_x * shoulder
    const pivot_ty = head_y
    const pivot_tz = head_z + right_z * shoulder
    const [pivot_x, pivot_y, pivot_z] = follow.update(pivot_tx, pivot_ty, pivot_tz, dt)

    // Spherical → the eye sits `arm` behind the pivot along (azimuth, polar). polar measured from
    // straight-UP (like camera-controls): dir from pivot to eye.
    const sin_p = Math.sin(pol_view)
    const cos_p = Math.cos(pol_view)
    // eye direction FROM pivot (points back+up toward the camera): behind = +sin along −forward, up = +cos
    const dir_x = Math.sin(az_view) * sin_p
    // polar measured from straight-UP (camera-controls parity): polar 90° → level; <90° → eye ABOVE the
    // pivot → camera looks DOWN. [2026-07-03 bug: was −cos_p, which put the eye BELOW the pivot for
    // small polar, so the camera could look up near the ground but never look down. Anchor was on the wrong pole.]
    const dir_y = cos_p
    const dir_z = Math.cos(az_view) * sin_p

    // Camera collision (S-76b rework): march the CAM_WALL_MARGIN cube from the pivot outward and stop
    // the arm at the LAST margin-clean distance — the returned length GUARANTEES every solid face sits
    // ≥ margin off the eye (L∞ cube ⇒ Euclidean), frustum corners included. The old sphere probe (7
    // samples, half-step back-off from an already-overlapping point, march starting past the pivot)
    // could rest a face inside the near-plane corner on diagonal approaches = the 3P x-ray.
    // [D223 zoom smoothing root]: zoom-IN used to ride the instant-shorten branch below (built for
    // wall safety) — every wheel-in notch SNAPPED. The zoom now eases separately (both directions, damped
    // at the TOP of update); the instant branch remains collision-only.
    const free_dist = wall_march(solid_at, pivot_x, pivot_y, pivot_z, dir_x, dir_y, dir_z, zoom_dist, CAM_WALL_MARGIN)
    // shorten instantly (never let the wall poke through), ease back out smoothly when it clears
    arm = free_dist < arm ? free_dist : damp(arm, free_dist, ARM_LAMBDA, dt)

    // Look angles straight from the orbit spherical (S-76b): the old eye→pivot vector derivation reduced
    // to EXACTLY these (yaw = atan2(dir_x·arm, dir_z·arm) — the arm cancels; same for pitch), but it
    // degenerated to atan2(0,0) once the margin march can legitimately return arm = 0 (pivot squeezed
    // against a face). Angle-derived look is position-independent by construction — no snap, ever.
    const yaw = az_view
    const pitch = Math.atan2(-cos_p, sin_p) // polar < 90° → eye above → looking down (negative), D223 sense

    // S-76b SAFE ANCHOR — the head pulled BACK ALONG THE VIEW AXIS (+dir = behind) to the first
    // margin-clean point, never further than FP_WALL_BACKOFF_MAX (< 1 block, so the clamp can never
    // cross a wall to its far side). Serves BOTH margin rescues below: the FP anchor (nose-to-wall /
    // ceiling graze) and the degenerate-pivot 3P case. No clean point within the bound (a doorway's
    // SIDE faces ~0.1 m off — the body owns x/z there, declared residual) ⇒ keep the raw head.
    const pivot_dirty = free_dist === 0 && cube_overlaps_solid(solid_at, pivot_x, pivot_y, pivot_z, CAM_WALL_MARGIN)
    let fp_x = head_x
    let fp_y = head_y
    let fp_z = head_z
    if ((fp_blend > 0 || pivot_dirty) && cube_overlaps_solid(solid_at, fp_x, fp_y, fp_z, CAM_WALL_MARGIN)) {
      for (let back = FP_WALL_BACKOFF_STEP; back <= FP_WALL_BACKOFF_MAX + 1e-9; back += FP_WALL_BACKOFF_STEP) {
        if (
          !cube_overlaps_solid(
            solid_at,
            head_x + dir_x * back,
            head_y + dir_y * back,
            head_z + dir_z * back,
            CAM_WALL_MARGIN
          )
        ) {
          fp_x = head_x + dir_x * back
          fp_y = head_y + dir_y * back
          fp_z = head_z + dir_z * back
          break
        }
      }
    }

    // The 3P eye — or, when the PIVOT ITSELF sits inside the wall margin (head squeezed against a face:
    // the arm march has no clean t at all), the safe anchor above instead of the dirty pivot. Both blend
    // endpoints are then margin-clean, so a straight mix against a face plane stays clean throughout.
    const eye_x = pivot_dirty ? fp_x : pivot_x + dir_x * arm
    const eye_y = pivot_dirty ? fp_y : pivot_y + dir_y * arm
    const eye_z = pivot_dirty ? fp_z : pivot_z + dir_z * arm

    // Dynamic FOV: widen with speed (ratio² easing), spring-damped — the dapp's speed rush. TR-1 slows
    // the ease in cinematic so speed changes never snap the zoom (normal uses the unchanged FOV_LAMBDA).
    const ratio = Math.min(speed / MAX_SPEED, 1)
    fov = damp(fov, BASE_FOV + ratio * ratio * MAX_FOV_BOOST, cinematic ? CINE_FOV_LAMBDA : FOV_LAMBDA, dt)

    // HEAD-BOB: speed-lerp the frequency + amplitude, ease the amplitude envelope toward its grounded/
    // moving target (0 when idle/airborne/disabled), advance the phase only while bobbing, and translate
    // the eye vertically by amp·sin(phase). yaw/pitch above were derived from the UN-bobbed eye, so this
    // is a pure vertical view translation — the frame bobs, it never nods.
    const bob_on = typeof window === 'undefined' || /** @type {any} */ (window).__ARES_BOB !== false
    // speed_ratio computed once at the top of update() (shared with the follow-halflife scaling above).
    const bob_target =
      bob_on && on_ground && speed > BOB_MIN_SPEED ? BOB_WALK_AMP + (BOB_RUN_AMP - BOB_WALK_AMP) * speed_ratio : 0
    if (bob_target > 0) {
      const bob_hz = BOB_WALK_HZ + (BOB_RUN_HZ - BOB_WALK_HZ) * speed_ratio
      bob_phase = (bob_phase + 2 * Math.PI * bob_hz * dt) % (2 * Math.PI)
    }
    bob_amp_env = damp(bob_amp_env, bob_target, BOB_EASE_LAMBDA, dt)
    const bob_y = bob_amp_env * Math.sin(bob_phase)
    last_bob_y = bob_y // publish for get_bob_offset() (plates cancel this to stay glued to the world)

    // FIRST-PERSON blend (S-75): mix the eye from the shoulder pose onto the SAFE ANCHOR (the raw head,
    // wall-clamped above — unsprung: first person is glued to the body; the spring keeps running
    // underneath for a lag-free exit). yaw/pitch above are position-independent (angle-derived), so this
    // is a pure eye translation: zero look pop across the whole transition. The reported distance
    // collapses with the blend, so the app's existing `distance > 1.0` own-mesh hide fires while the eye
    // is still ~1 m behind the head — never a visible head clip. The bob (above) rides both modes.
    const fp_e = fp_blend * fp_blend * (3 - 2 * fp_blend) // smoothstep — eased both ends, no pop
    const out_x = eye_x + (fp_x - eye_x) * fp_e
    const out_y = eye_y + (fp_y - eye_y) * fp_e
    const out_z = eye_z + (fp_z - eye_z) * fp_e

    return {
      position: [out_x, out_y + bob_y, out_z],
      yaw,
      pitch,
      fov,
      distance: arm * (1 - fp_e),
      first_person: fp_mode,
    }
  }

  /** TR-1 — toggle cinematic (trailer-recording) mode. ON: damped look + slower trailing follow +
   *  ×0.5 look speed + gentler speed-FOV. OFF: instantly restores the exact normal params — the follow
   *  halflife resets here and the rendered look angles snap back to the raw input on the next update().
   *  @param {boolean} on */
  const set_cinematic = (on) => {
    cinematic = !!on
    follow.halflife = cinematic ? CINE_FOLLOW_HALFLIFE : FOLLOW_HALFLIFE
    // TR-1 v2 byte-exact restore: a cinematic-only zoom (the 0.05 FP glide or the wide 16 m ceiling) must
    // never leak into normal mode — re-clamp target + eased distance into the normal range. [S-75] the
    // normal floor is now FP_MIN_DIST: a cinematic FP user (0.05) lands at 1.0 < FP_ENTER, so the normal
    // hysteresis re-latches first person on the next update — the eye STAYS at the head (continuity).
    if (!cinematic) {
      target_dist = clamp(target_dist, FP_MIN_DIST, MAX_DIST)
      zoom_dist = clamp(zoom_dist, FP_MIN_DIST, MAX_DIST)
    }
  }

  return {
    update,
    // In cinematic the movement basis follows the RENDERED (smoothed) azimuth so WASD stays relative to
    // what's on screen; normal mode returns the raw azimuth (byte-identical, fresh within the frame).
    get_yaw: () => (cinematic ? az_view : azimuth),
    attach: (canvas) => controls.attach(canvas),
    detach: () => controls.detach(),
    is_rotating: () => controls.is_locked(),
    rotate: apply_rotate,
    dolly, // programmatic zoom (meters; + out / − in) — mirrors the wheel, honours the cinematic range
    set_cinematic,
    is_cinematic: () => cinematic,
    // The SYNTHETIC vertical eye offset baked into the last pose (head-bob sine; 0 when idle/airborne). Overhead
    // nameplates add this to their world anchor Y before projecting, exactly cancelling the bob → the plate is
    // world-locked with zero smoothing lag (replaces the damp_plate_y screen-Y filter that lagged all motion).
    get_bob_offset: () => last_bob_y,
    dispose: () => controls.detach(),
  }
}

/**
 * S-76b — marches the CAM_WALL_MARGIN cube from an origin along a unit direction up to `max_dist` and
 * returns the LAST distance whose margin-cube was fully clean (0 when even the origin overlaps — a
 * degenerate buried pivot, the entombment guard's domain). Returning a PROVEN-clean t (instead of the
 * old "hit t minus half a step", which was still overlapping) is what guarantees the eye keeps every
 * solid face ≥ margin away — frustum corners included (L∞ cube ⇒ Euclidean). Coarse fixed-step march —
 * conservative by up to one STEP, which only ever stops the camera slightly shorter (never closer).
 * @param {(x:number,y:number,z:number)=>boolean} solid_at
 * @param {number} ox @param {number} oy @param {number} oz @param {number} dx @param {number} dy
 * @param {number} dz @param {number} max_dist @param {number} margin @returns {number}
 */
function wall_march(solid_at, ox, oy, oz, dx, dy, dz, max_dist, margin) {
  const STEP = 0.25
  let clear = 0
  for (let t = 0; ; t = Math.min(t + STEP, max_dist)) {
    if (cube_overlaps_solid(solid_at, ox + dx * t, oy + dy * t, oz + dz * t, margin)) return clear
    clear = t
    if (t >= max_dist) return max_dist
  }
}

/**
 * S-76b — true iff ANY solid voxel intersects the axis-aligned cube [p−r, p+r]³. A clean cube means
 * every solid face is ≥ r away in L∞ (hence ≥ r in Euclidean) — the conservative margin test that
 * replaced the 7-sample sphere probe (which missed diagonal/corner approaches = the x-ray leak). At
 * r < 0.5 this scans at most 2×2×2 cells — trivially cheap against the block-class oracle.
 * @param {(x:number,y:number,z:number)=>boolean} solid_at @param {number} x @param {number} y
 * @param {number} z @param {number} r @returns {boolean}
 */
function cube_overlaps_solid(solid_at, x, y, z, r) {
  const x1 = Math.floor(x + r)
  const y1 = Math.floor(y + r)
  const z1 = Math.floor(z + r)
  for (let cy = Math.floor(y - r); cy <= y1; cy += 1)
    for (let cz = Math.floor(z - r); cz <= z1; cz += 1)
      for (let cx = Math.floor(x - r); cx <= x1; cx += 1) if (solid_at(cx, cy, cz)) return true
  return false
}

/** @param {number} v @param {number} lo @param {number} hi @returns {number} */
function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v))
}

export const CAMERA_RIG_CONSTANTS = /** @type {const} */ ({
  BASE_FOV,
  MAX_FOV_BOOST,
  START_DIST,
  MIN_DIST,
  MAX_DIST,
  SHOULDER_OFFSET,
  FOLLOW_HALFLIFE,
  RUN_FOLLOW_HALFLIFE,
  // TR-1 v2 cinematic-scoped knobs (exposed for the acceptance test + the trailer report).
  CINE_MAX_LOOK_RATE,
  CINE_MAX_DIST,
  CINE_MIN_DIST,
  // S-73 head-bob knobs (exposed for the feel report / A-B testing).
  BOB_WALK_HZ,
  BOB_RUN_HZ,
  BOB_WALK_AMP,
  BOB_RUN_AMP,
  // S-76b camera↔wall margin (the near-plane x-ray fix — tests + the corner-radius verification).
  CAM_WALL_MARGIN,
  FP_WALL_BACKOFF_MAX,
  // S-75 first-person zoom knobs (threshold/hysteresis/floor/blend — tests + A-B testing).
  FP_ENTER_DIST,
  FP_EXIT_DIST,
  FP_MIN_DIST,
  FP_BLEND_S,
})
