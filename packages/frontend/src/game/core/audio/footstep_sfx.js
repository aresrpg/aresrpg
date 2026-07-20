// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Procedural footsteps — subtle procedural sounds for steps depending on the block below.
// Zero assets — short filtered-noise bursts synthesized on the SAME shared AudioContext as sfx.js
// (get_ctx/tone, exported from there for exactly this reuse). Cadence is a DISTANCE ACCUMULATOR (a step
// every ~1.6-2m of actual horizontal displacement) rather than a timer or an anim-clip event — robust,
// animation-independent, and "faster cadence while running" falls out for free (more distance covered
// per second ⇒ more steps fire per second, no separate walk/run branch needed).
//
// World-roam only: embed_voxel_player.js's frame2 calls tick_footsteps() from the branch that returns
// early during a fight (board mode already has its own symbolic move cue — sfx.js play_fight_sfx('move')),
// so this never double-voices a tactical step.

import { get_ctx, tone } from './sfx.js'
import { resolve_footstep_class, is_water_block } from './ground_material.js'

/** @typedef {import('./ground_material.js').FootstepTimbre} FootstepTimbre */

const BASE_STRIDE_M = 1.8 // "a step every ~1.6-2m walked"
const STRIDE_JITTER = 0.12 // ±12% per-step timing jitter — no two strides identical
const MOVE_EPSILON_M = 1e-4 // below this, treat as "not displacing" (idle/turning in place)

/** Per-timbre noise-burst synthesis params. SUBTLE: gains stay well under sfx.js's UI/element cues
 *  (0.35-0.5) — steps live under the music/ambience bed, never compete with it.
 *  @type {Record<FootstepTimbre, { dur: number, type: BiquadFilterType, cutoff: number, q: number, gain: number, knock_freq?: number, splash_freq?: number }>} */
const TIMBRE = {
  soft: { dur: 0.09, type: 'lowpass', cutoff: 2200, q: 0.6, gain: 0.055 }, // grass/leaves — a soft "shff"
  dull: { dur: 0.07, type: 'lowpass', cutoff: 1000, q: 0.6, gain: 0.06 }, // dirt (+ the unknown default) — a muted pat
  sharp: { dur: 0.05, type: 'bandpass', cutoff: 2800, q: 1.3, gain: 0.05 }, // stone/rock — a crisp short click
  granular: { dur: 0.11, type: 'bandpass', cutoff: 3400, q: 0.8, gain: 0.045 }, // sand — a grainy hiss, longest tail
  knock: { dur: 0.06, type: 'bandpass', cutoff: 1500, q: 1.5, gain: 0.05, knock_freq: 190 }, // wood/log — noise + a tonal "thock"
  muffled: { dur: 0.12, type: 'lowpass', cutoff: 450, q: 0.5, gain: 0.055 }, // snow — heavy lowpass, soft crunch
  wading: { dur: 0.09, type: 'bandpass', cutoff: 1200, q: 1.0, gain: 0.065, splash_freq: 700 }, // shallow water — a splash "plip"
}

/**
 * Multiply `base` by a random factor in [1-frac, 1+frac]. Pure, injectable rng (matches sfx.js's
 * pick_variant_index convention) so jitter bounds are unit-testable without touching Math.random.
 * @param {number} base @param {number} frac @param {() => number} [rng] @returns {number}
 */
export function jitter(base, frac, rng = Math.random) {
  return base * (1 + (rng() * 2 - 1) * frac)
}

/**
 * Distance-accumulator step trigger: adds `delta_m` (clamped so one huge jump — a teleport/frame hitch —
 * can never queue a burst of backlogged steps) to `acc`, and fires ONE step once the running total
 * reaches a (jittered) stride length, carrying the remainder forward (never resets to 0 — the
 * lazy-accrual remainder-carry law: a dropped remainder would drift the cadence over a long walk). Pure;
 * unit-tested in footstep_sfx.test.js.
 * @param {number} acc previous accumulated distance (m)
 * @param {number} delta_m horizontal distance moved this tick (m, >=0)
 * @param {number} [base_stride] base stride length (m)
 * @param {number} [stride_jitter] ± fractional jitter on the stride threshold
 * @param {() => number} [rng]
 * @returns {{ fired: boolean, acc: number }}
 */
export function accumulate_step(acc, delta_m, base_stride = BASE_STRIDE_M, stride_jitter = STRIDE_JITTER, rng = Math.random) {
  const clamped_delta = Math.min(Math.max(0, delta_m), base_stride * 1.5) // teleport/hitch guard
  const next = acc + clamped_delta
  const stride = jitter(base_stride, stride_jitter, rng)
  if (next >= stride) return { fired: true, acc: next - stride }
  return { fired: false, acc: next }
}

let last_pan_right = false // alternates L/R per fired step

/**
 * Play one synthesized footstep. Best-effort silent if Web Audio is unavailable.
 * @param {FootstepTimbre} cls
 * @returns {void}
 */
export function play_footstep(cls) {
  const ctx = get_ctx()
  if (!ctx) return
  const p = TIMBRE[cls] ?? TIMBRE.dull
  last_pan_right = !last_pan_right
  const pan = Math.max(-1, Math.min(1, jitter(last_pan_right ? 0.22 : -0.22, 0.3)))
  const rate = jitter(1, 0.1) // subtle per-step "pitch" via noise playbackRate — no two steps identical
  const gain = jitter(p.gain, 0.15)
  const cutoff = jitter(p.cutoff, 0.1)

  const t0 = ctx.currentTime
  const len = Math.max(1, Math.floor(ctx.sampleRate * p.dur))
  const buf = ctx.createBuffer(1, len, ctx.sampleRate)
  const data = buf.getChannelData(0)
  for (let i = 0; i < len; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / len) // decay baked into the burst
  const src = ctx.createBufferSource()
  src.buffer = buf
  src.playbackRate.value = rate
  const filter = ctx.createBiquadFilter()
  filter.type = p.type
  filter.frequency.value = cutoff
  filter.Q.value = p.q
  const env = ctx.createGain()
  env.gain.setValueAtTime(gain, t0)
  env.gain.exponentialRampToValueAtTime(0.0001, t0 + p.dur)
  src.connect(filter)
  filter.connect(env)
  if (ctx.createStereoPanner) {
    const panner = ctx.createStereoPanner()
    panner.pan.value = pan
    env.connect(panner)
    panner.connect(ctx.destination)
  } else {
    env.connect(ctx.destination)
  }
  src.start(t0)
  src.stop(t0 + p.dur + 0.02)

  // Layered tonal accents — a knock has a "thock" body, a splash has a "plip" — reusing sfx.js's tone().
  if (p.knock_freq) tone(p.knock_freq, 0.08, 'triangle', gain * 0.7, ctx, 0, p.knock_freq * 0.8)
  if (p.splash_freq) tone(p.splash_freq, 0.07, 'sine', gain * 0.6, ctx, 0.01, p.splash_freq * 0.5)
}

let prev_x = null
let prev_z = null
let acc = 0

/**
 * Movement-tick hook (call once per roam frame — embed_voxel_player.js frame2). Fires a footstep when
 * grounded, actually displacing, and the accumulator crosses a stride. Silent while airborne (no ground
 * contact) or stationary. The wading override checks the FEET cell directly (water sounds.step tag);
 * otherwise the ground block one cell below the feet decides the timbre.
 * @param {{ x: number, y: number, z: number, on_ground: boolean, block_id_at: (x:number,y:number,z:number) => number }} state
 * @returns {void}
 */
export function tick_footsteps({ x, y, z, on_ground, block_id_at }) {
  const dx = prev_x === null ? 0 : x - prev_x
  const dz = prev_z === null ? 0 : z - prev_z
  prev_x = x
  prev_z = z
  if (!on_ground || typeof block_id_at !== 'function') return
  const delta_m = Math.hypot(dx, dz)
  if (delta_m < MOVE_EPSILON_M) return
  const result = accumulate_step(acc, delta_m)
  acc = result.acc
  if (!result.fired) return
  const fx = Math.floor(x)
  const fy = Math.floor(y)
  const fz = Math.floor(z)
  const cls = is_water_block(block_id_at(fx, fy, fz)) ? 'wading' : resolve_footstep_class(block_id_at(fx, fy - 1, fz))
  play_footstep(cls)
}

/** Resets the accumulator/position memory — call on session teardown so a fresh session's first tick
 *  never reads a stale previous-position delta from the last one. @returns {void} */
export function reset_footsteps() {
  prev_x = null
  prev_z = null
  acc = 0
}
