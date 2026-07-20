// Character movement controller (ENG-8) — the locomotion brain. Ports the *feel constants* of the
// shipped dapp controller (aresrpg-legacy player_movement.js + packages/frontend player-controller.js)
// onto our voxel collision solver: WASD relative to the camera yaw, linear accel/brake ground curves
// with a minecraft-style multiplicative no-input stop (S-73v2), sprint, a real jump (asymmetric
// gravity + coyote-time + jump-buffer + release-to-cut +
// landing), air control that preserves momentum, and swim-float when the head is in water. It owns
// ONLY player state + math; it takes an `env` of pure oracles (solid_at / liquid_at) so it's fully
// unit-testable with a synthetic world and carries no three.js. The camera rig reads its position;
// the avatar reads its animation state (+ gait_scale for foot-slide-free clip cadence).
//
// [2026-07-07 pro-feel pass] Movement felt too fast in the still→run transition, with sliding and
// imprecise control in tight spaces that made single-block parkour difficult. The exponential accel/decel damp was the root: exp FRONT-LOADS
// velocity (a 100 ms tap peaked at 7.3 m/s and traveled 1.35 m; a full-run release slid 1.22 m over
// 580 ms). Replaced with the modern standard: LINEAR accel / brake / friction rates (m/s²), gravity
// asymmetry (fall > rise; jump force DERIVED from JUMP_APEX_M so the approved height is a
// mathematical invariant), variable jump height (release-to-cut), and corner forgiveness in the
// collision solver. TOP SPEED and JUMP APEX are unchanged — feel, not reach, was re-tuned.
// Measured by the headless parkour oracle (game_feel.test.js): single-block course 26% → >90%.
//
// 2026-07-03 owner feel-polish: FALL_ANIM_THRESHOLD (fall pose only past a >3-block drop) +
//   STEP_SMOOTH_MS (auto-step rise rendered as a ~100 ms visual ease instead of a snap).

import { CHARACTER_HEIGHT } from '../config/world_config.js'

import { resolve_movement, ground_height_below } from './collision.js'

/** @typedef {import('./collision.js').SolidFn} SolidFn */

// ═══ GAME-FEEL TUNABLES — every knob is one line; dial here, everything downstream follows ═══════
// [2026-07-03 live-drive tune] WALK 4.8 / RUN 10.5 (approved top speeds — do not change).
const WALK_SPEED = 4.8
const RUN_SPEED = 10.5
const SWIM_SPEED = 10
// ── Ground curves (m/s², linear — constant rates, frame-rate independent by construction) ──────────
// [2026-07-09 S-73 FEEL v2] Tightened acceleration and deceleration response, removing residual sliding. Snappier
// still→run, a tighter planted stop (less glide = the "sliding"/ice complaint), and a hard low-speed
// SNAP that guarantees a clean plant. These are a FEEL BASELINE to grade against — the OLD values
// are kept inline for a quick A/B. Air authority is DECOUPLED below so this ground tune can't drift it.
const GROUND_ACCEL = 50 // was 45 — still→run in ~0.21 s (was 0.23 s); a 100 ms tap peaks ~5.0 m/s. Capped
// here by the headless parkour fixture: 52+ overshoots single-block jumps (fixture <90%) because the air
// authority below is deliberately unchanged — live tuning can push higher if trading parkour margin.
const GROUND_BRAKE = 160 // was 120 — counter-steer (input opposing velocity): direction changes bite harder
// No-input STOP curve (S-73v2 2026-07-09 — the S-73 hard stop needed a very minimal slide, Minecraft-style,
// not a hard cliff): the linear-140 stop read as a CLIFF (planted in 5 frames, zero
// tail). Now MINECRAFT-STYLE multiplicative damping — v *= MC_STOP_FACTOR^(dt·20) (MC's ground stop is
// friction 0.6 × drag 0.91 ≈ 0.546 per 1/20 s tick; frame-rate independent via the dt·20 exponent). Raw
// 0.546 at our RUN 10.5 (~2× MC sprint) glides ~0.85 m — too icy; tuned down by the trace oracle so the
// run-speed glide lands the target band (~0.30–0.45 m) with a soft 3–5-frame visible tail, not a cliff.
// A/B ladder — the three stop variants graded so far:
//   v0 linear GROUND_FRICTION 90  → 0.61 m glide / ~0.13 s  (verdict: "feels sliding")
//   S-73 linear GROUND_FRICTION 140 → 0.31 m / 5-frame cliff (verdict: "too abrupt — want minimal slide")
//   S-73v2 MC_STOP_FACTOR 0.30 → ~0.34 m with a soft visible tail (current)
const MC_STOP_FACTOR = 0.3 // per-1/20s velocity keep-fraction (MC raw ≈ 0.546, tuned for our 2× speeds)
const STOP_SNAP_SPEED = 0.2 // was 0.5 — kills ONLY the imperceptible sub-0.2 m/s crawl the multiplicative
// decay never finishes on its own; never the felt tail (the visible tail lives between ~2 and 0.2 m/s).
const AIR_ACCEL = 31.5 // absolute airborne steer rate (m/s²). Was GROUND_ACCEL(45) × AIR_CONTROL(0.7);
// DECOUPLED from GROUND_ACCEL (2026-07-09) so raising ground responsiveness can't drift the swept
// air authority (verdict: "keep air control as-is"). Oracle sweep that fixed the old 0.7 (= 31.5 m/s²): 22.5
// starved mid-air correction (64% parkour), 31.5 = 97.5%, 38+ nears full ground authority (floaty/cheaty).
// Jump — the apex height is the approved reach; JUMP_FORCE is DERIVED from it so retuning
// gravity can never change how high the character jumps:
const JUMP_APEX_M = 1.44 // approved jump height (the legacy 12²/(2·50) apex — unchanged)
const RISE_GRAVITY = 40 // gravity while ascending — a slightly floatier rise = an aimable arc
const FALL_GRAVITY_MULT = 1.6 // fall gravity = RISE_GRAVITY × this — snappy, floaty-proof descent
const JUMP_FORCE = Math.sqrt(2 * RISE_GRAVITY * JUMP_APEX_M) // ≈ 10.73 — height invariant
const JUMP_CUT_MULT = 0.5 // release-to-cut: releasing jump mid-rise scales vy → variable jump height
const JUMP_FORWARD_IMPULSE = 3 // launch kick along the move direction (running jumps carry — ported)
// [2026-07-13] Adds a double jump with a proper bounce, sized so the total jump height reaches ~4 blocks. ONE mid-air
// second jump: its vertical impulse is AIR_JUMP_MULT× JUMP_FORCE, REPLACING vy (a falling body bounces cleanly)
// while horizontal momentum is kept. Edge-triggered on the key-DOWN, one per airborne phase, charge refills on
// landing (the ONE grounded signal). No triple jump.
// HEIGHT MATH: the base ground jump is UNTOUCHED (tuned muscle memory — declared). The air impulse adds
// AIR_JUMP_MULT²·JUMP_APEX_M of apex above wherever it fires, so chained OPTIMALLY (air-jump at the ground apex,
// vy≈0) the TOTAL apex = JUMP_APEX_M·(1 + AIR_JUMP_MULT²). 1.45 ⇒ 1.44·(1+2.10) ≈ 4.47 m ≈ 4.5 blocks → clears a
// 4-block wall with margin (target bar ≥ ~4.05). Retune the double-jump HEIGHT here only; the ground jump never moves.
const AIR_JUMP_MULT = 1.45
const GRAVITY_UNDERWATER = 5
const SWIM_LAMBDA = 12 // swim accel damp (the legacy exp form — water is MEANT to feel gliding)
const SWIM_UP_SPEED = 1.5 * GRAVITY_UNDERWATER // hold jump underwater = buoyant rise (ported)
const TERMINAL_FALL = -60 // clamp fall speed so a long drop can't tunnel / read jarring
// Forgiveness windows (the parkour enablers):
const COYOTE_TIME = 0.12 // s after leaving ground during which a jump still fires
const JUMP_BUFFER = 0.12 // s a jump press is remembered so a press just before landing still jumps
// [2026-07-03 owner feel-polish] "avoid triggering the fall animation if we don't fall more than 3
// blocks": FALL plays only past a REAL drop — small hops / terrace descents / normal jump arcs keep the
// brief airborne coast (JUMP/JUMP_RUN) instead of flashing the fall pose. Exported knob.
const FALL_ANIM_THRESHOLD = 3 // blocks of accumulated drop (airborne peak y − current y) before FALL
// [2026-07-03 owner feel-polish] "improve the step on high block with some smoothness instead of a
// sudden teleport": the COLLISION step stays instant (position authority unchanged — no gameplay
// change); only the RENDERED feet (avatar + camera pivot both ride visual_y) absorb the vertical snap
// into a decaying offset that eases out over ~STEP_SMOOTH_MS. Exported knob.
const STEP_SMOOTH_MS = 100 // ms for the visual rise to settle ≈95% (target band 80–120)
const STEP_SMOOTH_LAMBDA = 3000 / STEP_SMOOTH_MS // exp-damp λ: settle ≈ 3τ with τ = 1/λ
const STEP_OFFSET_MAX = 1.5 // safety cap on the absorbed offset (stacked steps sprinting up stairs)

/**
 * Frame-rate-independent exponential smoothing (the dapp's `damp`). @param {number} current
 * @param {number} target @param {number} lambda @param {number} dt @returns {number}
 */
export function damp(current, target, lambda, dt) {
  return current + (target - current) * (1 - Math.exp(-lambda * dt))
}

/**
 * @typedef {object} ControllerEnv the pure world oracles the controller resolves against.
 * @property {SolidFn} solid_at true iff the voxel floor-cell (x,y,z) is a SOLID collider.
 * @property {(x: number, y: number, z: number) => boolean} liquid_at true iff (x,y,z) is liquid.
 */

/**
 * @typedef {object} ControllerInput per-frame intent, camera-relative. `forward`/`strafe` ∈ [-1,1]
 *   (the dapp axis form); the controller rotates them into world space by `yaw`.
 * @property {number} forward +1 ahead (camera look dir), -1 back
 * @property {number} strafe +1 right, -1 left
 * @property {boolean} jump jump held/pressed this frame
 * @property {boolean} [walk] force walk speed (slow) instead of run
 * @property {number} yaw camera yaw (radians) — the movement basis; forward = −Z rotated by yaw
 * @property {number} [speed_scale] roam ground-locomotion multiplier (default 1). The app's ONE speed
 *   knob for equip-driven movement bonuses (the mount slot rides ×1.5 here); airborne momentum inherits
 *   it through the already-scaled velocity. Never touches SWIM or the fight board.
 */

/** @typedef {'IDLE'|'WALK'|'RUN'|'JUMP'|'JUMP_RUN'|'FALL'|'SWIM'} PlayerAnim */

/**
 * @typedef {object} ControllerState (opaque) the mutable player body the controller advances.
 * @property {[number, number, number]} position feet-centre world position (authoritative sim y)
 * @property {[number, number, number]} velocity m/s
 * @property {number} visual_y smoothed feet y for rendering (lags sim y over an auto-step so the
 *   camera + avatar rise smoothly instead of snapping a full block)
 * @property {number} facing_yaw the direction the avatar faces (radians), turned smoothly toward motion
 * @property {boolean} on_ground
 * @property {boolean} in_water head-submerged this frame (drives swim mode + anim)
 * @property {PlayerAnim} anim current animation state
 * @property {number} speed current horizontal speed (m/s) — camera FOV + anim crossfade read this
 * @property {number} gait_scale clip-cadence multiplier for the ACTIVE loco clip (actual speed ÷ the
 *   speed the clip is authored for) — scale the avatar mixer's dt by this so feet never slide during
 *   accel ramps / speed boosts. 1 for non-locomotion states. (2026-07-07 pro-feel pass)
 * @property {number} _since_ground s since last grounded (coyote)
 * @property {number} _jump_buffer s remaining on a buffered jump press
 * @property {boolean} _jump_was_down edge-detect so holding jump doesn't machine-gun
 * @property {boolean} _air_jumped the single mid-air jump has been spent this airborne phase (refills on
 *   landing) — the no-triple-jump guard
 * @property {boolean} _air_jump_fired transient: TRUE only on the step an air-jump impulse fires; reset at the
 *   top of every step, so a consumer (the facade) reads it as a one-shot event (the dust-puff VFX cue)
 * @property {number} _fall_peak_y highest y reached this airborne phase — FALL plays only once
 *   (_fall_peak_y − y) exceeds FALL_ANIM_THRESHOLD (2026-07-03 owner feel-polish)
 * @property {number} _step_offset decaying visual y offset absorbing auto-step snaps; visual_y =
 *   position[1] + _step_offset (2026-07-03 owner feel-polish)
 */

/**
 * Creates a fresh controller state at a spawn feet-position.
 * @param {[number, number, number]} spawn feet-centre
 * @param {number} [yaw] initial facing
 * @returns {ControllerState}
 */
export function create_controller_state(spawn, yaw = 0) {
  return {
    position: [spawn[0], spawn[1], spawn[2]],
    velocity: [0, 0, 0],
    visual_y: spawn[1],
    facing_yaw: yaw,
    on_ground: false,
    in_water: false,
    anim: 'IDLE',
    speed: 0,
    gait_scale: 1,
    _since_ground: 999,
    _jump_buffer: 0,
    _jump_was_down: false,
    _air_jumped: false,
    _air_jump_fired: false,
    _fall_peak_y: spawn[1],
    _step_offset: 0,
  }
}

/**
 * World-space horizontal move direction from camera-relative input + yaw. forward = the camera's
 * flattened look direction (−Z rotated by yaw, matching fly_camera/demo's `[sin(yaw)·-1, 0, cos(yaw)·-1]`);
 * right = 90° clockwise. Returns a unit-or-zero vector (normalised when any input is pressed).
 * @param {number} forward @param {number} strafe @param {number} yaw
 * @returns {[number, number]} [wx, wz] world XZ direction
 */
export function move_direction(forward, strafe, yaw) {
  // camera forward (XZ), matches the demo fly basis: fwd = [-sin? ] — use the same convention as
  // fly_camera's Euler YXZ: forward = (−sin yaw, −cos yaw) on (x,z); right = (cos yaw, −sin yaw).
  const fwd_x = -Math.sin(yaw)
  const fwd_z = -Math.cos(yaw)
  const right_x = Math.cos(yaw)
  const right_z = -Math.sin(yaw)
  let wx = fwd_x * forward + right_x * strafe
  let wz = fwd_z * forward + right_z * strafe
  const len = Math.hypot(wx, wz)
  if (len > 1e-6) {
    wx /= len
    wz /= len
  } else {
    wx = 0
    wz = 0
  }
  return [wx, wz]
}

/**
 * Moves the horizontal velocity toward a target vector at a CONSTANT rate (m/s²) — the modern ground
 * curve. Linear (not exponential) on purpose: exp front-loads velocity, which read as "instant run"
 * and "sliding" (2026-07-07 pro-feel pass). Frame-rate independent by construction. Mutates `vel`.
 * @param {[number, number, number]} vel @param {number} tx target vx @param {number} tz target vz
 * @param {number} rate m/s² @param {number} dt
 */
function accelerate_horizontal(vel, tx, tz, rate, dt) {
  const dx = tx - vel[0]
  const dz = tz - vel[2]
  const dist = Math.hypot(dx, dz)
  if (dist < 1e-9) return
  const step = Math.min(dist, rate * dt)
  vel[0] += (dx / dist) * step
  vel[2] += (dz / dist) * step
}

/**
 * Turns `facing` toward a target yaw by the shortest arc, smoothed. @param {number} facing
 * @param {number} target @param {number} lambda @param {number} dt @returns {number}
 */
function turn_toward(facing, target, lambda, dt) {
  let delta = target - facing
  while (delta > Math.PI) delta -= 2 * Math.PI
  while (delta < -Math.PI) delta += 2 * Math.PI
  return facing + delta * (1 - Math.exp(-lambda * dt))
}

/**
 * Advances the controller one fixed step. Pure w.r.t. `env` (no globals, no three). Mutates + returns
 * `state`. Order mirrors the dapp: resolve intent → accel/decel (ground full control, air reduced) →
 * jump (coyote + buffer) → gravity/buoyancy → collide → post-physics ground/anim.
 * @param {ControllerState} state
 * @param {ControllerInput} input
 * @param {ControllerEnv} env
 * @param {number} dt seconds (fixed step recommended; clamped internally)
 * @returns {ControllerState}
 */
export function step_controller(state, input, env, dt) {
  dt = Math.min(0.05, Math.max(1e-4, dt)) // clamp: a huge hitch must not launch the body
  state._air_jump_fired = false // per-step transient (the air-jump VFX cue) — set true only if one fires below
  const { solid_at, liquid_at } = env
  const [pos_x, pos_y, pos_z] = state.position
  const vel = state.velocity

  // Head-submerged check: water at the head cell (feet y + height, minus a touch) = swim mode. Using
  // the head (not feet) matches the dapp's `position.y < seaLevel` intent for a head-centred avatar.
  const head_y = pos_y + CHARACTER_HEIGHT * 0.9
  const in_water = liquid_at(Math.floor(pos_x), Math.floor(head_y), Math.floor(pos_z))
  state.in_water = in_water

  const [dir_x, dir_z] = move_direction(input.forward, input.strafe, input.yaw)
  const has_move = dir_x !== 0 || dir_z !== 0
  const run = !input.walk
  // ONE speed home: the base gait × the app's roam multiplier (mount ×1.5; 1 when unset). Ground only —
  // swim keeps SWIM_SPEED, and airborne velocity carries the already-scaled ground momentum on its own.
  const ground_speed = (run ? RUN_SPEED : WALK_SPEED) * (input.speed_scale ?? 1)

  // ── horizontal velocity: linear accel/brake + MC-style no-input stop on ground, reduced air authority ──
  if (in_water) {
    // water keeps the legacy exponential glide — swimming is MEANT to feel fluid, not crisp
    const tx = dir_x * SWIM_SPEED
    const tz = dir_z * SWIM_SPEED
    vel[0] = damp(vel[0], tx, SWIM_LAMBDA, dt)
    vel[2] = damp(vel[2], tz, SWIM_LAMBDA, dt)
  } else if (state.on_ground) {
    if (has_move) {
      // linear rates while steering: BRAKE when the stick opposes current motion (crisp turnarounds),
      // ACCEL otherwise — unchanged from the S-73 pass.
      const rate = vel[0] * dir_x + vel[2] * dir_z < -0.01 ? GROUND_BRAKE : GROUND_ACCEL
      accelerate_horizontal(vel, dir_x * ground_speed, dir_z * ground_speed, rate, dt)
    } else {
      // No input: MINECRAFT-STYLE stop (S-73v2 owner verdict — "slide should be there, very minimal").
      // Multiplicative decay leaves a small, PRESENT glide with a soft visible tail instead of the
      // linear cliff; the snap then kills only the imperceptible sub-0.2 m/s crawl (multiplicative
      // decay never reaches zero on its own) so the body still plants instead of micro-creeping.
      const keep = Math.pow(MC_STOP_FACTOR, dt * 20)
      vel[0] *= keep
      vel[2] *= keep
      if (Math.hypot(vel[0], vel[2]) < STOP_SNAP_SPEED) {
        vel[0] = 0
        vel[2] = 0
      }
    }
  } else if (has_move) {
    // air: steer with the DECOUPLED absolute air rate; NO decel toward zero when no input (momentum kept)
    accelerate_horizontal(vel, dir_x * ground_speed, dir_z * ground_speed, AIR_ACCEL, dt)
  }

  // ── jump: coyote-time + input-buffer + release-to-cut (variable height) ──
  const jump_pressed = input.jump && !state._jump_was_down
  const jump_released = !input.jump && state._jump_was_down
  state._jump_was_down = input.jump
  if (jump_pressed) state._jump_buffer = JUMP_BUFFER
  state._jump_buffer = Math.max(0, state._jump_buffer - dt)

  if (in_water) {
    // buoyant swim: hold jump to rise, otherwise sink slowly (dapp underwater model)
    vel[1] = input.jump ? SWIM_UP_SPEED : -GRAVITY_UNDERWATER
  } else {
    // variable jump height: releasing jump while still rising cuts the ascent (tap = short hop,
    // hold = the full approved apex). One-shot by nature — the release edge fires once.
    if (jump_released && !state.on_ground && vel[1] > 0) vel[1] *= JUMP_CUT_MULT
    const can_jump = state.on_ground || state._since_ground < COYOTE_TIME
    if (state._jump_buffer > 0 && can_jump) {
      vel[1] = JUMP_FORCE
      // launch impulse in the move direction (dapp JUMP_FORWARD_IMPULSE) so a running jump carries
      if (has_move) {
        vel[0] += dir_x * JUMP_FORWARD_IMPULSE
        vel[2] += dir_z * JUMP_FORWARD_IMPULSE
      }
      state._jump_buffer = 0
      state._since_ground = 999 // consume coyote
      state.on_ground = false
    } else if (jump_pressed && !can_jump && !state._air_jumped) {
      // AIR JUMP (double-jump): a single mid-air second bounce. Edge-triggered on the key-DOWN
      // (jump_pressed — never a held/buffered re-fire), fires ONLY when a ground/coyote jump is impossible and
      // the one air-jump is unspent (refills on landing below). REPLACES vy at AIR_JUMP_MULT× the ground apex so
      // a falling body bounces cleanly, keeps horizontal momentum, and carries the same running-jump forward kick.
      vel[1] = JUMP_FORCE * AIR_JUMP_MULT
      if (has_move) {
        vel[0] += dir_x * JUMP_FORWARD_IMPULSE
        vel[2] += dir_z * JUMP_FORWARD_IMPULSE
      }
      state._air_jumped = true // one air-jump per airborne phase — no triple jump
      state._jump_buffer = 0 // consume this press so it can't ALSO land a buffered ground-jump on touchdown
      state._air_jump_fired = true // one-shot cue: the facade latches this into the dust-puff VFX event
    } else {
      // gravity asymmetry: rising uses RISE_GRAVITY, falling FALL_GRAVITY_MULT× it — the arc floats
      // up (aimable) and bites down (planted), never balloon-floaty. Apex height unaffected (rise-side).
      const g = vel[1] > 0 ? RISE_GRAVITY : RISE_GRAVITY * FALL_GRAVITY_MULT
      vel[1] = Math.max(TERMINAL_FALL, vel[1] - g * dt)
    }
  }

  // ── collide + integrate ──
  const res = resolve_movement(solid_at, [pos_x, pos_y, pos_z], vel, dt, {})
  state.position = res.position
  state.velocity = res.velocity

  // ground bookkeeping (coyote timer counts up while airborne, resets on contact)
  if (res.on_ground) {
    state._since_ground = 0
    state._air_jumped = false // the air-jump charge refills on landing — the ONE grounded signal, reused
  } else state._since_ground += dt
  state.on_ground = res.on_ground

  // Fall-distance anchor (2026-07-03 owner feel-polish): reset to the feet on contact, ratchet up to
  // the apex while airborne. classify_anim gates FALL on (_fall_peak_y − y) > FALL_ANIM_THRESHOLD.
  if (res.on_ground) [, state._fall_peak_y] = state.position
  else state._fall_peak_y = Math.max(state._fall_peak_y, state.position[1])

  // Auto-step visual smoothing (2026-07-03 owner feel-polish — was: damp on the single stepped frame,
  // then snap next frame = a teleport read). The frame a step-up snaps the sim y, the SAME height is
  // subtracted into _step_offset so the rendered feet don't move yet; the offset then decays to 0 over
  // ~STEP_SMOOTH_MS, easing avatar + camera up the block. Falls/jumps/landings stay glued (offset only
  // absorbs upward step snaps and is capped at STEP_OFFSET_MAX on stacked staircase sprints).
  if (res.stepped && state.position[1] > pos_y) {
    state._step_offset = Math.max(-STEP_OFFSET_MAX, state._step_offset - (state.position[1] - pos_y))
  }
  state._step_offset = damp(state._step_offset, 0, STEP_SMOOTH_LAMBDA, dt)
  state.visual_y = state.position[1] + state._step_offset

  // horizontal speed + facing
  const sp = Math.hypot(state.velocity[0], state.velocity[2])
  state.speed = sp
  if (has_move) {
    const target_face = Math.atan2(dir_x, dir_z) // face the movement direction (atan2(x,z))
    state.facing_yaw = turn_toward(state.facing_yaw, target_face, 12, dt)
  }

  state.anim = classify_anim(state)
  // Anim cadence sync (2026-07-07 pro-feel pass): the loco clips are authored at the gait's top speed
  // (WALK clip ↔ WALK_SPEED, RUN clip ↔ RUN_SPEED). During accel ramps / speed boosts the feet would
  // slide at fixed clip rate — the avatar scales its mixer dt by this instead (clamped so extreme
  // ratios never look cartoon). Non-locomotion states play at their authored rate.
  state.gait_scale =
    state.anim === 'RUN'
      ? Math.min(1.6, Math.max(0.5, sp / RUN_SPEED))
      : state.anim === 'WALK'
        ? Math.min(1.6, Math.max(0.5, sp / WALK_SPEED))
        : 1
  return state
}

/**
 * Chooses the animation state from the resolved body. Priority mirrors player-model.js: swimming →
 * SWIM; airborne rising → JUMP(_RUN); airborne falling far → FALL; grounded moving → RUN/WALK; else
 * IDLE. Exposed for direct unit-testing of the state machine.
 * @param {ControllerState} state
 * @returns {PlayerAnim}
 */
export function classify_anim(state) {
  const moving = state.speed > 0.5
  if (state.in_water) return 'SWIM'
  if (!state.on_ground) {
    if (state.velocity[1] > 0.5) return moving ? 'JUMP_RUN' : 'JUMP'
    // [2026-07-03 owner feel-polish] FALL only past a REAL drop (> FALL_ANIM_THRESHOLD blocks below the
    // airborne peak): 1–2-block hops, terrace descents and normal jump arcs coast on JUMP/JUMP_RUN
    // instead of flashing the fall pose. (No LAND state exists — landing is a plain 0.2 s crossfade back
    // to the grounded cycle, so a small hop already carries no land-thud to scale.)
    if (state.velocity[1] < -2 && state._fall_peak_y - state.position[1] > FALL_ANIM_THRESHOLD) return 'FALL'
    return moving ? 'JUMP_RUN' : 'JUMP' // brief apex/coast — hold the air pose rather than flicker
  }
  if (moving) return state.speed > (WALK_SPEED + RUN_SPEED) / 2 ? 'RUN' : 'WALK'
  return 'IDLE'
}

/**
 * Snaps the controller to stand on the ground directly below its current position (spawn helper).
 * @param {ControllerState} state @param {ControllerEnv} env @param {number} [from_y] scan start
 */
export function ground_controller(state, env, from_y) {
  const [x, , z] = state.position
  const y0 = from_y ?? state.position[1]
  const gy = ground_height_below(env.solid_at, x, y0, z)
  if (gy !== null) {
    state.position[1] = gy
    state.visual_y = gy
    state.velocity[1] = 0
    state.on_ground = true
    state._since_ground = 0
  }
}

export const CONTROLLER_CONSTANTS = /** @type {const} */ ({
  WALK_SPEED,
  RUN_SPEED,
  SWIM_SPEED,
  // 2026-07-07 pro-feel pass + 2026-07-09 S-73 feel-v2 knobs (TUNABLES block at the top has the details):
  GROUND_ACCEL,
  GROUND_BRAKE,
  MC_STOP_FACTOR, // S-73v2 — minecraft-style multiplicative no-input stop (replaced GROUND_FRICTION)
  STOP_SNAP_SPEED, // S-73v2 — kills only the sub-0.2 m/s crawl the multiplicative decay leaves
  AIR_ACCEL, // S-73 — absolute air steer rate (was GROUND_ACCEL × AIR_CONTROL), decoupled from ground
  RISE_GRAVITY,
  FALL_GRAVITY_MULT,
  JUMP_APEX_M,
  JUMP_FORCE,
  JUMP_CUT_MULT,
  AIR_JUMP_MULT, // 2026-07-13 owner double-jump — mid-air 2nd impulse ×JUMP_FORCE; total apex = JUMP_APEX_M·(1+this²) ≈ 4.5 blocks
  COYOTE_TIME,
  JUMP_BUFFER,
  FALL_ANIM_THRESHOLD, // 2026-07-03 owner feel-polish knob
  STEP_SMOOTH_MS, // 2026-07-03 owner feel-polish knob
})
