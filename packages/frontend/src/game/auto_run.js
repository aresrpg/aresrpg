// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// AUTO-RUN — MAP-CLICK steer-to-target + auto-interact ("clicking a mob group or a resource on the
// big map should make the character auto run towards it and start the fight or gathering upon reach if
// conditions are respected, like a tool"). The MAP lane emits `context.events.emit('map/auto_run', { type,
// id, position })` on a marker click (type: 'mob' | 'resource'; position: world x/z); THIS module is the
// consumer — an input-level STEERER that beelines the character to the target and, on arrival, fires the
// EXACT SAME prompt a manual [R]/[G] press fires. The interaction lives in ONE home (world_spawns arms the
// prompt at PROXIMITY_M; the [G]/[R] on_trigger owns the tool + proximity gates and their honest refusals) —
// this module NEVER re-checks a rule, it only steers there and pulls the same lever.
//
// v1 LIMITATION (declared, acceptable — Cube World shipped beeline click-to-move too): NO pathfinding. The
// steerer runs a straight line + the controller's built-in auto-step for small rises + a blocked-hop for low
// walls. Cliffs, water, and tall walls it cannot clear → the STUCK DETECTOR cancels with an honest toast.
// The camera stays the PLAYER'S (mouse orbit never cancels); the player ALWAYS wins — any movement key/stick,
// a jump press, or Esc cancels instantly (wired in embed_voxel_player.js).
//
// STEERING MATH: the controller consumes CAMERA-RELATIVE input — move_direction(forward,strafe,yaw) sends
// forward=1 along (-sin yaw, -cos yaw). So feeding forward=1 with yaw = atan2(-dx, -dz) points the forward
// axis straight at the target WITHOUT touching the camera. The pure math (steer_to / is_arrived / is_stuck)
// is exported and unit-tested; the factory wires it to the live controller + prompt stack + a subtle chip.

import i18n from '../i18n'
import { use_prompt_stack } from '../world-shell/prompt_stack.js'
import { push_event_toast } from './core/toast.js'
import { is_mobile } from './core/mobile_mode.js'

// ── tunables ─────────────────────────────────────────────────────────────────────────────────────────────
const ARRIVE_RADIUS_M = 2.5 // stop steering within this many blocks of the marker — comfortably inside the
// [F]/[G]/[R] PROXIMITY_M (6, world_spawns.js) so the interact prompt is already armed when we stop.
const INTERACT_GRACE_MS = 2500 // after arrival, wait this long for the prompt to arm before giving up honestly
// (covers the React-effect tick that registers [G] off action/gather_target; a healthy arrival fires in <100ms).
const STUCK_WINDOW_MS = 3000 // no net progress across this window while steering = stuck (cliff / water / wall)
const STUCK_MIN_PROGRESS_M = 2 // …"no progress" = the beeline travelled less than this (m) across the window.
const BLOCK_SPEED = 1.5 // steering yet crawling slower than this (m/s) = blocked by an obstacle…
const BLOCK_HOP_DELAY_S = 0.35 // …for at least this long → pulse a jump (the controller auto-steps small rises;
const HOP_COOLDOWN_S = 0.6 //     this clears a low wall; the controller's double-jump fires if a 2nd edge lands mid-air).

/** type → the prompt_stack id its manual press owns (the ONE interaction home this module pulls). */
const INTERACT_ID = /** @type {const} */ ({ mob: 'attack', resource: 'gather' })

/**
 * World-space steer yaw so the controller's forward axis (forward=1, strafe=0) points from (fx,fz) at the
 * target (tx,tz). move_direction sends forward along (-sin yaw, -cos yaw), so yaw = atan2(-(tx-fx), -(tz-fz)).
 * @param {number} fx @param {number} fz @param {number} tx @param {number} tz
 * @returns {{ yaw: number, dist: number }} yaw (radians) + horizontal distance to the target (m)
 */
export function steer_to(fx, fz, tx, tz) {
  const dx = tx - fx
  const dz = tz - fz
  return { yaw: Math.atan2(-dx, -dz), dist: Math.hypot(dx, dz) }
}

/** Arrived once within `radius` blocks of the marker. @param {number} dist @param {number} [radius] */
export function is_arrived(dist, radius = ARRIVE_RADIUS_M) {
  return dist <= radius
}

/**
 * Stuck when the position samples (ascending {t,x,z}) span at least `window_ms` yet the travel from the
 * ~window-old sample to the latest is under `min_progress` — the beeline made no headway (wall/cliff/water).
 * @param {{ t: number, x: number, z: number }[]} samples @param {number} now
 * @param {number} [window_ms] @param {number} [min_progress] @returns {boolean}
 */
export function is_stuck(samples, now, window_ms = STUCK_WINDOW_MS, min_progress = STUCK_MIN_PROGRESS_M) {
  // ref = the NEWEST sample that is still at least a full window old (samples are t-ascending) — so the
  // measured span is ≈ window_ms, never the whole (possibly longer) buffer.
  let ref = null
  for (const s of samples) {
    if (now - s.t >= window_ms) ref = s
    else break
  }
  if (!ref) return false // not enough history yet — never a false stuck on the first seconds
  const last = samples[samples.length - 1]
  return Math.hypot(last.x - ref.x, last.z - ref.z) < min_progress
}

/** Every steerable payload type. 'point' is a BARE leg — walk there and stop, no interaction on arrival
 *  (the auto-search scouter's zone/group legs: it must never engage anything by walking onto it). */
const STEER_TYPES = new Set(['mob', 'resource', 'point'])

/** Normalise a marker-click payload into a steer target, or null when it isn't a valid steerable marker.
 *  Accepts position as {x,z} · {x,y,z} · {x,y} (map convention: y = world Z) · [x,z] · [x,y,z].
 *  @param {any} ev @returns {{ type: 'mob'|'resource'|'point', id: any, x: number, z: number } | null} */
export function normalize_target(ev) {
  if (!ev || !STEER_TYPES.has(ev.type)) return null
  const pos = ev.position
  let x
  let z
  if (Array.isArray(pos)) {
    x = pos[0]
    z = pos.length >= 3 ? pos[2] : pos[1] // [x,y,z] → z ; [x,z] → z
  } else if (pos && typeof pos === 'object') {
    x = pos.x
    z = pos.z ?? pos.y // {x,y,z}/{x,z} → z ; {x,y} (map: y is world Z) → y
  }
  if (!Number.isFinite(x) || !Number.isFinite(z)) return null
  return { type: ev.type, id: ev.id ?? null, x: Number(x), z: Number(z) }
}

/** THE interaction reuse: fire the armed [R]/[G] prompt for this target type — the SAME lever the manual
 *  press pulls (tool + proximity gates live inside its on_trigger). @param {'mob'|'resource'} type */
function default_trigger_interact(type) {
  const id = INTERACT_ID[type]
  if (!id) return false
  const st = use_prompt_stack.getState()
  if (!st.prompts[id]) return false // the manual prompt isn't armed yet (not close enough / not resolved)
  st.trigger_prompt(id) // fires on_trigger — attack → engage() (proximity-gated), gather → the tool-gated [G]
  return true
}

/** The one honest failure toast (stuck, or arrived with nothing interactable). */
function default_notify_blocked() {
  push_event_toast({ state: 'info', title: i18n.t('world.auto_run_blocked') })
}

/**
 * Build the auto-run steerer. Effects (prompt trigger / toast / chip) are injectable so the factory is
 * headless-testable; the defaults wire the live prompt stack + toast + i18n.
 * @param {object} deps
 * @param {() => ArrayLike<number>} deps.get_pos live player feet position [x,y,z]
 * @param {(type: 'mob'|'resource') => boolean} [deps.trigger_interact] fire the armed prompt; true iff it fired
 * @param {() => void} [deps.notify_blocked] the honest "can't reach it" toast
 * @param {() => number} [deps.now] monotonic clock (ms) — injectable for tests
 */
export function create_auto_run({
  get_pos,
  trigger_interact = default_trigger_interact,
  notify_blocked = default_notify_blocked,
  now = () => performance.now(),
}) {
  /** @type {{ type: 'mob'|'resource', id: any, x: number, z: number } | null} */
  let target = null
  /** @type {'idle' | 'steer' | 'arrive'} */
  let phase = 'idle'
  /** @type {{ t: number, x: number, z: number }[]} */
  let samples = []
  /** @type {[number, number] | null} */
  let last_pos = null // previous frame XZ (instantaneous-speed estimate for the block-hop)
  let block_time = 0 // seconds crawling below BLOCK_SPEED while steering
  let hop_cd = 0 // seconds until the next auto-hop is allowed (edge-spacing so the controller re-triggers)
  let arrive_t0 = 0 // clock at which the arrive grace started
  /** @type {HTMLElement | null} */
  let chip = null

  // ── the subtle on-screen indicator (self-contained DOM — house gold-glass, sharp corners, monospace) ──
  const show_chip = () => {
    if (chip || typeof document === 'undefined') return
    chip = document.createElement('div')
    chip.style.cssText =
      'position:fixed;top:64px;left:50%;transform:translateX(-50%);z-index:20;pointer-events:none;' +
      'display:flex;align-items:center;gap:9px;padding:5px 12px;' +
      'font:600 10px/1.4 "JetBrains Mono",monospace;letter-spacing:.28em;text-transform:uppercase;' +
      'color:#f5d0a9;background:rgba(10,10,15,.78);border:1px solid rgba(200,150,60,.5);' +
      'text-shadow:0 0 6px rgba(200,150,60,.6);box-shadow:0 0 20px rgba(200,150,60,.25)'
    const dot = document.createElement('span') // a small gold SQUARE (no border-radius — house sharp-edge law)
    dot.style.cssText = 'width:6px;height:6px;background:#c8963c;box-shadow:0 0 8px #c8963c'
    dot.animate?.([{ opacity: 1 }, { opacity: 0.25 }, { opacity: 1 }], { duration: 1600, iterations: Infinity })
    const label = document.createElement('span')
    label.textContent = i18n.t('world.auto_run')
    const hint = document.createElement('span')
    hint.textContent = i18n.t(is_mobile() ? 'world.auto_run_hint_touch' : 'world.auto_run_hint')
    hint.style.cssText = 'opacity:.5;letter-spacing:.18em'
    chip.append(dot, label, hint)
    document.body.appendChild(chip)
  }
  const hide_chip = () => {
    chip?.remove()
    chip = null
  }

  const cancel = () => {
    if (phase === 'idle') return
    phase = 'idle'
    target = null
    samples = []
    last_pos = null
    block_time = 0
    hop_cd = 0
    hide_chip()
  }

  /** Begin steering to a marker-click payload ({ type, id, position }). A no-op on a malformed payload.
   *  `{ type: 'cancel' }` stops an in-flight run — the seam a headless caller (auto-search) uses to halt
   *  the body without reaching into this closure. */
  const start = (/** @type {any} */ ev) => {
    if (ev?.type === 'cancel') return cancel()
    const next = normalize_target(ev)
    if (!next) return
    cancel() // drop any in-flight run (retarget)
    target = next
    phase = 'steer'
    arrive_t0 = 0
    show_chip()
  }

  /**
   * Advance one frame. Returns the steering input to feed the controller this frame, or null when auto-run
   * isn't driving (idle, or it just finished/cancelled — the caller then runs its normal input path).
   * @param {number} dt seconds @returns {{ forward: number, strafe: number, yaw: number, jump: boolean } | null}
   */
  const update = (dt) => {
    if (phase === 'idle' || !target) return null
    const p = get_pos()
    const px = Number(p[0])
    const pz = Number(p[2])
    const t = now()
    const { yaw, dist } = steer_to(px, pz, target.x, target.z)

    if (phase === 'steer') {
      if (is_arrived(dist)) {
        phase = 'arrive'
        arrive_t0 = t
        return { forward: 0, strafe: 0, yaw, jump: false } // plant and hand off to the interact grace
      }
      // stuck detection — sample, bound the buffer to ~2 windows, then test the ~window-old reference.
      samples.push({ t, x: px, z: pz })
      const horizon = t - STUCK_WINDOW_MS * 2
      while (samples.length > 2 && samples[0].t < horizon) samples.shift()
      if (is_stuck(samples, t)) {
        notify_blocked()
        cancel()
        return null
      }
      // block-hop: sustained crawl while steering → a jump pulse (edge-spaced by hop_cd so the controller
      // re-triggers each rising edge; its own double-jump adds reach on the 2nd hop against a taller lip).
      const inst_speed = last_pos ? Math.hypot(px - last_pos[0], pz - last_pos[1]) / Math.max(dt, 1e-3) : 999
      last_pos = [px, pz]
      hop_cd = Math.max(0, hop_cd - dt)
      let jump = false
      if (inst_speed < BLOCK_SPEED) {
        block_time += dt
        if (block_time > BLOCK_HOP_DELAY_S && hop_cd <= 0) {
          jump = true
          hop_cd = HOP_COOLDOWN_S
          block_time = 0
        }
      } else block_time = 0
      return { forward: 1, strafe: 0, yaw, jump }
    }

    // phase === 'arrive': a BARE point leg is already done — stand still, never look for a lever to pull.
    if (!INTERACT_ID[target.type]) {
      cancel()
      return null
    }
    // stand on the target and pull the SAME [R]/[G] lever the moment it's armed.
    if (trigger_interact(target.type)) {
      cancel()
      return null
    }
    if (t - arrive_t0 > INTERACT_GRACE_MS) {
      notify_blocked() // arrived but nothing interactable armed in time (despawned / just out of range)
      cancel()
      return null
    }
    return { forward: 0, strafe: 0, yaw, jump: false }
  }

  return {
    start,
    cancel,
    update,
    active: () => phase !== 'idle',
    /** The live target (for tests / an external readout), or null. */
    target: () => target,
    dispose: () => {
      cancel()
      hide_chip()
    },
  }
}
