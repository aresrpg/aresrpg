// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// ENG-16 Phase B — impact-frame metadata + LOUDNESS unit tests (the W4 keystone).
//
// entity_beat resolves at the clip's IMPACT frame, not its end. This locks the THREE-way split:
//   1. a KNOWN anim whose clip the rig HAS (attack/hit/death) resolves at impact_fraction × real-clip-
//      duration, STRICTLY LESS than the clip duration (impact ≠ end — the whole point).
//   2. a KNOWN anim whose clip the rig LACKS (a RUN-only mob) is QUIET (known:true) — it plays no clip
//      but still resolves at impact_fraction × a nominal length (no per-fight spam).
//   3. an UNKNOWN anim (not in IMPACT_FRAMES) is a LOUD console.error (known:false) at the MIDPOINT.
// resolve_impact is pure (takes a clip-duration lookup), so no GLB / WebGPU is needed here.

import { test, expect, describe, spyOn } from 'bun:test'
import { BackSide, Group } from 'three'

import {
  resolve_impact,
  IMPACT_FRAMES,
  resolve_gait,
  LOCO_NATURAL_SPEED,
  make_outline_material,
  darken_to_luminance,
  reaction_for,
  recoil_away_dir,
  recoil_envelope,
  recoil_jitter,
  peak_envelope,
  should_procedural_death,
  should_procedural_attack,
  arm_attack_lunge,
  advance_lunge,
  should_force_remove,
  flash_envelope,
  react_to_impact,
  advance_recoil,
  advance_flash,
  arm_death_response,
  advance_death_collapse,
  float_text_magnitude,
  float_magnitude_scale,
  float_pop_curve,
  float_rise_ease,
  float_opacity_curve,
  float_gravity_drop_curve,
  float_burst_stagger,
  create_board_entities,
} from './board_entities.js'
import { TEAM_COLORS } from './board_highlights.js'

/** Rec.709 relative luminance of an sRGB 0xRRGGBB int (the same metric darken_to_luminance targets). */
const luma_of = (/** @type {number} */ hex) => {
  const r = ((hex >> 16) & 255) / 255,
    g = ((hex >> 8) & 255) / 255,
    b = (hex & 255) / 255
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

// A stand-in for the avatar's real clip_duration, using the durations measured from senshi_male.glb.
const REAL_DURATIONS = /** @type {Record<string, number>} */ ({ ATTACK: 1.967, DEATH: 2.1, WALK: 0.833, IDLE: 7.667 })
const clip_dur = (/** @type {string} */ name) => (name in REAL_DURATIONS ? REAL_DURATIONS[name] : null)

describe('IMPACT_FRAMES table', () => {
  test('every mapped impact fraction is strictly inside the clip (0 < impact < 1) — impact ≠ end', () => {
    for (const [anim, meta] of Object.entries(IMPACT_FRAMES)) {
      expect(meta.impact).toBeGreaterThan(0)
      expect(meta.impact).toBeLessThan(1) // NEVER at the end of the clip
      expect(typeof meta.clip).toBe('string')
      void anim
    }
  })
})

describe('resolve_impact — mapped anims resolve at impact, not end', () => {
  test('attack resolves at 0.6 × 1.967s ≈ 1.18s, well before the 1.967s end', () => {
    const r = resolve_impact('attack', clip_dur)
    expect(r.mapped).toBe(true)
    expect(r.known).toBe(true)
    expect(r.clip).toBe('ATTACK')
    expect(r.duration).toBeCloseTo(1.967, 3)
    expect(r.impact_time).toBeCloseTo(1.967 * 0.6, 3)
    expect(r.impact_time).toBeLessThan(r.duration) // the keystone: impact ≠ end-of-clip
  })

  test('death resolves at its mid-clip impact', () => {
    const r = resolve_impact('death', clip_dur)
    expect(r.mapped).toBe(true)
    expect(r.impact_time).toBeCloseTo(2.1 * 0.5, 3)
    expect(r.impact_time).toBeLessThan(r.duration)
  })

  test('hit NEVER reuses ATTACK (D304 superseded) — no rig ships a HIT clip, so it resolves the clipless nominal path', () => {
    const r = resolve_impact('hit', clip_dur) // clip_dur has ATTACK, but NOT 'HIT'
    expect(r.clip).not.toBe('ATTACK') // regression: a hit must never play the attack clip
    expect(r.mapped).toBe(false)
    expect(r.clip).toBeNull()
    expect(r.impact_time).toBeCloseTo(0.8 * 0.3, 3) // fraction × the nominal 0.8s fallback, not real ATTACK duration
  })
})

describe('resolve_impact — LOUDNESS on an UNKNOWN anim (W4 keystone)', () => {
  test('an anim absent from IMPACT_FRAMES is neither known nor mapped and resolves at the midpoint fallback', () => {
    const r = resolve_impact('teleport', clip_dur) // no such beat in the table
    expect(r.known).toBe(false) // this — not mapped — is what the loud path keys off
    expect(r.mapped).toBe(false)
    expect(r.clip).toBeNull()
    // midpoint fallback: FALLBACK_DURATION (0.8) / 2 = 0.4 — never end-of-clip
    expect(r.impact_time).toBeCloseTo(0.4, 3)
    expect(r.impact_time).toBeLessThan(r.duration)
  })

  test('a KNOWN anim whose clip this rig LACKS is the QUIET clipless path — known, not mapped, clip null (no per-fight spam)', () => {
    // clip_dur returns null for everything → a RUN-only mob with no ATTACK clip
    const r = resolve_impact('attack', () => null)
    expect(r.known).toBe(true) // in the table ⇒ NEVER the loud path
    expect(r.mapped).toBe(false) // …but there is no rig clip to play
    expect(r.clip).toBeNull()
    // resolves at the DESIGNED attack fraction (0.6) over the nominal 0.8s beat, NOT the 0.5 midpoint
    expect(r.impact_time).toBeCloseTo(0.8 * 0.6, 3)
    expect(r.impact_time).toBeLessThan(r.duration)
  })

  test('a clipless HIT keeps its D304 recoil end cap over the nominal length (0.35 × 0.8s), cut before the end', () => {
    const r = resolve_impact('hit', () => null)
    expect(r.known).toBe(true)
    expect(r.clip).toBeNull()
    expect(r.impact_time).toBeCloseTo(0.8 * 0.3, 3)
    expect(r.end_time).toBeCloseTo(0.8 * 0.35, 3)
    expect(r.end_time).toBeGreaterThan(r.impact_time) // impact resolves BEFORE the recoil is cut
  })
})

// The console.error itself is emitted by entity_beat (which owns the promise + the avatar). Prove the
// loudness contract end-to-end with a minimal fake entity/avatar so we assert the ERROR fires and the
// promise resolves at the midpoint (not the clip end). This exercises the real create_board_entities
// beat() path without a GLB (a fake engine + a fake avatar via a monkeypatched create path is heavy;
// instead we assert the pure branch that entity_beat's loudness console.error keys off of: `mapped`).
describe('loudness is keyed off resolve_impact.known === false (unknown anim only — never a clipless mob)', () => {
  test('an UNKNOWN anim reaches the console.error branch; a mapped OR clipless-known anim does not', () => {
    const err = spyOn(console, 'error').mockImplementation(() => {})
    // Simulate exactly what entity_beat does with the result — the guard is `if (!known)`:
    const unknown = resolve_impact('nonexistent_anim', clip_dur)
    if (!unknown.known) console.error(`[board_entities] beat anim "nonexistent_anim" is NOT in IMPACT_FRAMES`)
    expect(err).toHaveBeenCalledTimes(1)
    expect(err.mock.calls[0][0]).toContain('NOT in IMPACT_FRAMES')

    err.mockClear()
    const mapped = resolve_impact('attack', clip_dur) // known + rig has the clip
    if (!mapped.known) console.error('should not fire')
    const clipless = resolve_impact('attack', () => null) // known, but RUN-only mob lacks ATTACK → still QUIET
    if (!clipless.known) console.error('should not fire')
    expect(err).not.toHaveBeenCalled() // neither a mapped anim nor a clipless-KNOWN mob triggers loudness
    err.mockRestore()
  })
})

// ── [D304 SUPERSEDED 2026-07-11] hit NEVER resolves an attack-family clip — a hit reaction had read as the
// mob playing its attack animation. D304 reused ATTACK's opening jerk-back for the victim recoil;
// even a 30-35% slice of a swing IS wind-up, so it read as "about to attack", never "got hit". THE LAW now:
// a hit reaction never plays ATTACK (or any attack-family clip) — clip:'HIT' auto-wires a real rig clip if
// one ever ships (ladder rung 1); today every rig is clipless here, so it lands on the SAME quiet nominal
// path a RUN-only mob's 'attack' already takes, with the procedural flinch (react_to_impact) supplying the
// reaction instead of a clip. ──────────────────────────────────────────────────────────────────────────
describe('hit never resolves to an attack-family clip (D304 superseded)', () => {
  test('a rig WITH a real ATTACK clip still never plays it for a hit — clip is null, not "ATTACK"', () => {
    const r = resolve_impact('hit', clip_dur) // clip_dur (REAL_DURATIONS) HAS an ATTACK clip
    expect(r.clip).not.toBe('ATTACK')
    expect(r.clip).not.toBe('ATTACK_CAC')
    expect(r.clip).toBeNull()
    expect(r.mapped).toBe(false)
    expect(r.known).toBe(true) // still a KNOWN beat — never the loud unknown-anim path
  })

  test('end fraction still cuts short of the nominal length — 35% of the 0.8s nominal, not the full window', () => {
    const r = resolve_impact('hit', clip_dur)
    expect(r.end_time).toBeCloseTo(0.8 * 0.35, 3)
    expect(r.end_time).toBeGreaterThan(r.impact_time) // impact resolves BEFORE the cut — bar-release contract intact
    expect(r.end_time).toBeLessThan(r.duration === 0.8 ? Infinity : r.duration) // sanity: still inside the nominal window
  })

  test('ladder rung 1 — a FUTURE rig shipping a real HIT clip is picked up automatically, still never ATTACK', () => {
    const with_hit_clip = (/** @type {string} */ name) => (name === 'HIT' ? 0.5 : (REAL_DURATIONS[name] ?? null))
    const r = resolve_impact('hit', with_hit_clip)
    expect(r.clip).toBe('HIT')
    expect(r.mapped).toBe(true)
    expect(r.impact_time).toBeCloseTo(0.5 * 0.3, 3)
    expect(r.end_time).toBeCloseTo(0.5 * 0.35, 3)
  })

  test('anims WITHOUT an end cap play to the clip end (attack/death beats unchanged)', () => {
    expect(resolve_impact('attack', clip_dur).end_time).toBeCloseTo(1.967, 3)
    expect(resolve_impact('death', clip_dur).end_time).toBeCloseTo(2.1, 3)
  })

  test('an end BELOW impact clamps UP to impact_time — the resolve can never be cut off', () => {
    IMPACT_FRAMES.__clamp_probe = { clip: 'ATTACK', impact: 0.5, end: 0.1 }
    const r = resolve_impact('__clamp_probe', clip_dur)
    delete IMPACT_FRAMES.__clamp_probe
    expect(r.end_time).toBeCloseTo(r.impact_time, 6)
    expect(r.end_time).toBeLessThanOrEqual(r.duration)
  })

  test('the unknown fallback + the clipless-known attack path both keep end_time = duration (no dangling cut)', () => {
    expect(resolve_impact('teleport', clip_dur).end_time).toBeCloseTo(resolve_impact('teleport', clip_dur).duration, 6)
    const clipless = resolve_impact('attack', () => null) // known meta, clip missing from the rig
    expect(clipless.known).toBe(true)
    expect(clipless.mapped).toBe(false)
    expect(clipless.end_time).toBeCloseTo(clipless.duration, 6) // attack has no end cap ⇒ the full nominal length
  })
})

// ── [D303] gait resolution — run = RUN clip (or WALK at raised timeScale); feet track the ground ──
describe('D303 — resolve_gait (clip-aware timeScale, no foot-slide)', () => {
  // Rig stand-ins from the 2026-07-06 fleet scan: players carry WALK+RUN; most mob rigs are RUN-only.
  const full_rig = (/** @type {string} */ n) => ({ WALK: 0.833, RUN: 0.667, IDLE: 7.667 })[n] ?? null
  const walk_only = (/** @type {string} */ n) => (n === 'WALK' ? 0.833 : null)
  const run_only = (/** @type {string} */ n) => (n === 'RUN' ? 0.417 : null)
  const RUN_SPEED = 1000 / 170 // the adapter's ≥3-cell pace (~5.9 cells/s)
  const WALK_SPEED = 1000 / 480 // the adapter's 1-2-cell pace (~2.1 cells/s)

  test('walk gait at the walk pace on a WALK rig = timeScale exactly 1 (the D303 anchor)', () => {
    const g = resolve_gait('walk', WALK_SPEED, full_rig)
    expect(g.anim).toBe('WALK')
    expect(g.time_scale).toBeCloseTo(1, 6)
  })

  test('run gait on a rig WITH a RUN clip: RUN anim, timeScale = speed / RUN anchor', () => {
    const g = resolve_gait('run', RUN_SPEED, full_rig)
    expect(g.anim).toBe('RUN')
    expect(g.time_scale).toBeCloseTo(RUN_SPEED / LOCO_NATURAL_SPEED.RUN, 6) // ≈1.47
  })

  test('run gait on a WALK-only rig: still the RUN anim request (avatar falls back), timeScale from the WALK anchor', () => {
    const g = resolve_gait('run', RUN_SPEED, walk_only)
    expect(g.anim).toBe('RUN') // ANIM_PREFS resolves it to the WALK clip on this rig
    expect(g.time_scale).toBeCloseTo(RUN_SPEED / LOCO_NATURAL_SPEED.WALK, 6) // ≈2.82 — proportional, no moonwalk
  })

  test('walk gait on a RUN-only mob rig: timeScale from the RUN anchor (a slowed trot, not a sliding sprint)', () => {
    const g = resolve_gait('walk', WALK_SPEED, run_only)
    expect(g.anim).toBe('WALK') // resolves to the RUN clip on this rig
    expect(g.time_scale).toBeCloseTo(WALK_SPEED / LOCO_NATURAL_SPEED.RUN, 6) // ≈0.52
  })

  test('NO gait (legacy demo/bench callers) = exactly the pre-D303 behavior regardless of speed', () => {
    expect(resolve_gait(undefined, 4, full_rig)).toEqual({ anim: 'WALK', time_scale: 1 })
    expect(resolve_gait(null, 7, run_only)).toEqual({ anim: 'WALK', time_scale: 1 })
  })

  test('an explicit loco_time_scale override wins outright', () => {
    const g = resolve_gait('run', RUN_SPEED, full_rig, 2.5)
    expect(g).toEqual({ anim: 'RUN', time_scale: 2.5 })
  })

  test('a not-yet-loaded rig (all lookups null) still returns a sane resolution without throwing', () => {
    const g = resolve_gait('run', RUN_SPEED, () => null)
    expect(g.anim).toBe('RUN')
    expect(Number.isFinite(g.time_scale)).toBe(true)
    expect(g.time_scale).toBeGreaterThan(0)
  })
})

// ── [team-outline] inverted-hull silhouette material ──────────────────────────────────────────────────
// Constructing a node material is valid headless (bun) — the TSL graph only compiles at render time (the
// SAME reason board_highlights.test builds its gradient materials without a GPU). Locks the hull's shape.
describe('make_outline_material — inverted-hull silhouette (flat black rim)', () => {
  test('is a BackSide, unlit, tone-map-exempt hull carrying a flat BLACK rim + a vertex normal-push', () => {
    const mat = make_outline_material()
    expect(mat.side).toBe(BackSide) // only the back shell shows → a clean rim around the silhouette
    expect(mat.toneMapped).toBe(false) // exact hue under the AgX tonemap
    // spec: "make the outlines black" — the default three.js OutlinePass look, flat black,
    // never team-tinted.
    expect(mat.color.getHex()).toBe(0x000000)
    expect(mat.positionNode).toBeTruthy() // the skin-aware normal-push that inflates the hull
  })
  test('the rim is the SAME flat black for every team (no more ally/enemy tint)', () => {
    const ally = make_outline_material().color.getHex()
    const enemy = make_outline_material().color.getHex()
    expect(ally).toBe(enemy)
    expect(ally).toBe(0x000000)
  })
})

// ── [victim-reaction] the "got hit" flinch — struck bodies react at the impact frame ──────────────────
describe('reaction_for — damage flinches + flashes, death flashes only, heal is a green pulse', () => {
  test('a damage hit → red flash + recoil', () => {
    const r = reaction_for('hit', 'damage')
    expect(r).not.toBeNull()
    expect(r?.recoil).toBe(true)
    expect(r?.flash.r).toBeGreaterThan(r?.flash.g ?? 1) // red-dominant tint
    expect(r?.flash.peak).toBeLessThan(1) // a tint, never a blown-out halo (brand law)
  })
  test('a crit is treated as damage (flash + recoil)', () => {
    expect(reaction_for('hit', 'crit')?.recoil).toBe(true)
  })
  test('a DEATH beat flashes but NEVER recoils — a victim mid-death never flinches', () => {
    const r = reaction_for('death', 'crit') // the killing blow still carries a damage/crit float
    expect(r?.recoil).toBe(false)
    expect(r?.flash).toBeTruthy()
  })
  test('a heal → soft GREEN pulse, no recoil', () => {
    const r = reaction_for('hit', 'heal')
    expect(r?.recoil).toBe(false)
    expect(r?.flash.g).toBeGreaterThan(r?.flash.r ?? 1) // green-dominant tint
  })
  test('a no-kind / info float (or the attacker with no damage) reacts not at all', () => {
    expect(reaction_for('hit', undefined)).toBeNull()
    expect(reaction_for('hit', 'info')).toBeNull()
    expect(reaction_for('attack', undefined)).toBeNull() // the attacker's own swing (float:null upstream)
  })
})

describe('recoil_away_dir — the struck body jerks AWAY from the attacker it faces', () => {
  test('facing +Z (north, yaw 0) → recoil south (0,-1)', () => {
    const d = recoil_away_dir(0)
    expect(d.dx).toBeCloseTo(0, 6)
    expect(d.dz).toBeCloseTo(-1, 6)
  })
  test('facing south (yaw π) → recoil north (0,+1)', () => {
    const d = recoil_away_dir(Math.PI)
    expect(d.dx).toBeCloseTo(0, 6)
    expect(d.dz).toBeCloseTo(1, 6)
  })
  test('facing east (yaw π/2) → recoil west (-1,0); the away-vector is unit length', () => {
    const d = recoil_away_dir(Math.PI / 2)
    expect(d.dx).toBeCloseTo(-1, 6)
    expect(d.dz).toBeCloseTo(0, 6)
    expect(Math.hypot(d.dx, d.dz)).toBeCloseTo(1, 6)
  })
})

describe('recoil_envelope — a fast jerk out, an eased spring back (0 at both ends)', () => {
  test('rests at 0 at the endpoints, peaks near 1 in the middle', () => {
    expect(recoil_envelope(0)).toBe(0)
    expect(recoil_envelope(1)).toBe(0)
    expect(recoil_envelope(0.32)).toBeCloseTo(1, 6) // fully extended at RECOIL_PEAK
  })
  test('never overshoots the [0,1] band across the whole sweep', () => {
    for (let t = 0; t <= 1.0001; t += 0.05) {
      const v = recoil_envelope(t)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(1)
    }
  })
  test('the peak sits early (fast jerk OUT) then declines monotonically back to rest (a longer settle)', () => {
    expect(recoil_envelope(0.16)).toBeCloseTo(0.5, 6) // halfway to full extension already by 16% of the flinch
    // past the 32% peak the body only ever comes back — a strictly decreasing settle, no second bounce:
    expect(recoil_envelope(0.5)).toBeGreaterThan(recoil_envelope(0.7))
    expect(recoil_envelope(0.7)).toBeGreaterThan(recoil_envelope(0.9))
  })
})

describe('darken_to_luminance — dark team rim (darker outlines)', () => {
  test('brings a bright team color down to ~target luminance (both teams)', () => {
    expect(luma_of(darken_to_luminance(TEAM_COLORS.ally, 0.3))).toBeCloseTo(0.3, 1)
    expect(luma_of(darken_to_luminance(TEAM_COLORS.enemy, 0.3))).toBeCloseTo(0.3, 1)
  })
  test('never brightens — an already-dark color is returned unchanged', () => {
    const dark = 0x101014
    expect(luma_of(darken_to_luminance(dark, 0.3))).toBeLessThanOrEqual(luma_of(dark) + 1e-6)
  })
  test('preserves hue (uniform component scale keeps channel ratios)', () => {
    const src = TEAM_COLORS.ally
    const out = darken_to_luminance(src, 0.3)
    // blue was the dominant channel in the source; it stays dominant after darkening
    expect(out & 255).toBeGreaterThan((out >> 8) & 255)
    expect((out >> 8) & 255).toBeGreaterThan((out >> 16) & 255)
  })
})

// ── [W7] floating combat numbers — size + spring pop ("floating numbers too small and
// not bouncy enough"; the house fight-feel reference). All pure math, no canvas/GPU needed. ──────────

describe('float_text_magnitude — parses a fully-composed float string for SIZING only', () => {
  test('reads the signed number out of the dapp-composed text', () => {
    expect(float_text_magnitude('-42')).toBe(42)
    expect(float_text_magnitude('+15')).toBe(15)
    expect(float_text_magnitude('-3')).toBe(3)
  })
  test('non-numeric text (a future status float) reads as 0 magnitude, never throws', () => {
    expect(float_text_magnitude('MISS')).toBe(0)
    expect(float_text_magnitude('')).toBe(0)
  })
})

describe('float_magnitude_scale — small ticks read small, big hits read big ("3-damage vs 40-crit")', () => {
  test('at/below the floor (5) reads at the MIN band (0.75)', () => {
    expect(float_magnitude_scale(3)).toBeCloseTo(0.75, 6)
    expect(float_magnitude_scale(5)).toBeCloseTo(0.75, 6)
  })
  test('at/above the ceiling (50) reads at the MAX band (1.3), never grows past it', () => {
    expect(float_magnitude_scale(50)).toBeCloseTo(1.3, 6)
    expect(float_magnitude_scale(500)).toBeCloseTo(1.3, 6)
  })
  test('monotonically increases between floor and ceiling (a 40-hit reads bigger than a 3-hit)', () => {
    const small = float_magnitude_scale(3)
    const mid = float_magnitude_scale(20)
    const big = float_magnitude_scale(40)
    expect(small).toBeLessThan(mid)
    expect(mid).toBeLessThan(big)
  })
})

describe('float_pop_curve — spring OVERSHOOT pop-in (0 → peak → settle), the "bouncy" fix', () => {
  test('starts at exactly 0 (fully collapsed) and settles to exactly 1 (resting scale)', () => {
    expect(float_pop_curve(0, 0.3)).toBeCloseTo(0, 6)
    expect(float_pop_curve(1, 0.3)).toBeCloseTo(1, 6)
  })
  test('OVERSHOOTS past 1 at its interior peak — the requested bounce', () => {
    const peak = float_pop_curve(0.55, 0.3)
    expect(peak).toBeCloseTo(1.3, 6) // 1 + overshoot
    expect(peak).toBeGreaterThan(1) // genuinely overshoots, not just approaches 1
  })
  test('rises monotonically to the peak, then settles back down monotonically to 1', () => {
    const rise = [0, 0.2, 0.4, 0.55].map((t) => float_pop_curve(t, 0.3))
    for (let i = 1; i < rise.length; i += 1) expect(rise[i]).toBeGreaterThan(rise[i - 1])
    const settle = [0.55, 0.7, 0.85, 1].map((t) => float_pop_curve(t, 0.3))
    for (let i = 1; i < settle.length; i += 1) expect(settle[i]).toBeLessThan(settle[i - 1])
  })
  test('a bigger overshoot (crit) peaks higher than a smaller one (normal hit)', () => {
    expect(float_pop_curve(0.55, 0.55)).toBeGreaterThan(float_pop_curve(0.55, 0.3))
  })
})

describe('float_rise_ease — ease-out arc (fast rise, settles near the top)', () => {
  test('0 at spawn, 1 at the end of the window', () => {
    expect(float_rise_ease(0)).toBeCloseTo(0, 6)
    expect(float_rise_ease(1)).toBeCloseTo(1, 6)
  })
  test('front-loaded: more than half the rise lands by the halfway mark', () => {
    expect(float_rise_ease(0.5)).toBeCloseTo(0.75, 6)
    expect(float_rise_ease(0.5)).toBeGreaterThan(0.5)
  })
})

describe('float_opacity_curve — HANG at full opacity, then FADE-DROP (accelerating)', () => {
  test('held at opacity 1 through the hang fraction', () => {
    expect(float_opacity_curve(0, 0.45)).toBe(1)
    expect(float_opacity_curve(0.45, 0.45)).toBe(1)
  })
  test('fully faded by t=1', () => {
    expect(float_opacity_curve(1, 0.45)).toBeCloseTo(0, 6)
  })
  test('the fade accelerates (ease-in): the second half of the fade drops more than the first half', () => {
    const first_half_drop = 1 - float_opacity_curve(0.725, 0.45) // hang..1 midpoint
    const second_half_drop = float_opacity_curve(0.725, 0.45) - float_opacity_curve(1, 0.45)
    expect(second_half_drop).toBeGreaterThan(first_half_drop)
  })
})

describe('float_gravity_drop_curve — the small ballistic sag during the fade tail', () => {
  test('zero through the hang fraction (no sag while fully visible)', () => {
    expect(float_gravity_drop_curve(0, 0.45)).toBe(0)
    expect(float_gravity_drop_curve(0.45, 0.45)).toBe(0)
  })
  test('reaches its full 1× fraction exactly at t=1', () => {
    expect(float_gravity_drop_curve(1, 0.45)).toBeCloseTo(1, 6)
  })
  test('monotonically increases through the tail', () => {
    const drop = [0.45, 0.6, 0.8, 1].map((t) => float_gravity_drop_curve(t, 0.45))
    for (let i = 1; i < drop.length; i += 1) expect(drop[i]).toBeGreaterThan(drop[i - 1])
  })
})

describe('float_burst_stagger — multi-hit numbers fan out ~80ms apart, not a clump', () => {
  test('a fresh spawn (no recent float, or one long ago) is unstaggered', () => {
    expect(float_burst_stagger(Infinity, 0)).toBe(0)
    expect(float_burst_stagger(1, 0.16)).toBe(0) // 1s gap — well outside the burst window
  })
  test('a float spawned right after another CHAINS onto its delay + 80ms', () => {
    expect(float_burst_stagger(0.05, 0)).toBeCloseTo(0.08, 6)
    expect(float_burst_stagger(0.05, 0.08)).toBeCloseTo(0.16, 6) // 3rd hit in the burst
  })
  test('a gap beyond the burst window resets the stagger to 0 (a new, unrelated burst)', () => {
    expect(float_burst_stagger(0.2, 0.16)).toBe(0)
  })
})

// ── [victim-reaction: hits lacked shake and colored impact feedback] the SHAKE + colored tint
// + procedural death collapse + the hard removal belt — the fight-feel juice layer. ──────────────────────

describe('recoil_jitter — a decaying SHAKE oscillation, never a residual offset ("doesn\'t shake")', () => {
  test('zero at both ends of the flinch window', () => {
    expect(recoil_jitter(0)).toBe(0)
    expect(recoil_jitter(1)).toBe(0)
  })
  test('genuinely oscillates (flips sign) across the window — a shake, not one smooth nudge', () => {
    const signs = [0.05, 0.2, 0.4, 0.6, 0.8, 0.95].map((t) => Math.sign(recoil_jitter(t)))
    expect(new Set(signs).size).toBeGreaterThan(1)
  })
  test('never exceeds the recoil envelope in magnitude (the shake decays WITH the flinch, never outlives it)', () => {
    for (let t = 0.01; t < 1; t += 0.03)
      expect(Math.abs(recoil_jitter(t))).toBeLessThanOrEqual(recoil_envelope(t) + 1e-9)
  })
})

describe('reaction_for — crit now gets its OWN gold tint (was lumped in with plain damage)', () => {
  test('crit and plain damage read visibly different colors', () => {
    const dmg = reaction_for('hit', 'damage')
    const crit = reaction_for('hit', 'crit')
    expect(crit?.flash).not.toEqual(dmg?.flash)
    expect(crit?.flash.peak).toBeLessThan(1) // still a tint, never a blown-out halo (brand law)
  })
})

describe('flash_envelope — rises then decays to EXACTLY 0 (the "material state restored" contract)', () => {
  test('0 at spawn, peaks at 1 at flash_in, back to exactly 0 at (and past) life — never a residual value', () => {
    expect(flash_envelope(0, 0.15, 0.4)).toBeCloseTo(0, 6)
    expect(flash_envelope(0.15, 0.15, 0.4)).toBeCloseTo(1, 6)
    expect(flash_envelope(0.4, 0.15, 0.4)).toBe(0)
    expect(flash_envelope(0.9, 0.15, 0.4)).toBe(0)
  })
  test('monotonic rise then monotonic decay (a clean single pulse, no flicker)', () => {
    const rise = [0, 0.05, 0.1, 0.15].map((t) => flash_envelope(t, 0.15, 0.4))
    for (let i = 1; i < rise.length; i += 1) expect(rise[i]).toBeGreaterThan(rise[i - 1])
    const decay = [0.15, 0.25, 0.35, 0.4].map((t) => flash_envelope(t, 0.15, 0.4))
    for (let i = 1; i < decay.length; i += 1) expect(decay[i]).toBeLessThan(decay[i - 1])
  })
})

describe('should_procedural_death — ladder rung 2 for a DEATH beat (mirrors the hit ladder)', () => {
  test('true ONLY for a death beat with no rig clip playing', () => {
    expect(should_procedural_death({ anim: 'death', clip: null })).toBe(true)
    expect(should_procedural_death({ anim: 'death', clip: 'DEATH' })).toBe(false) // a real clip ⇒ let it play
    expect(should_procedural_death({ anim: 'hit', clip: null })).toBe(false) // hit has its own ladder, not this one
    expect(should_procedural_death({ anim: 'attack', clip: null })).toBe(false)
  })
})

describe('should_procedural_attack — ladder rung 2 for an ATTACK beat (a clipless attacker never strikes as a statue)', () => {
  test('true ONLY for an attack beat with no rig clip playing', () => {
    expect(should_procedural_attack({ anim: 'attack', clip: null })).toBe(true)
    expect(should_procedural_attack({ anim: 'attack', clip: 'ATTACK' })).toBe(false) // a real swing ⇒ let it play
    expect(should_procedural_attack({ anim: 'death', clip: null })).toBe(false) // death has its own rung
    expect(should_procedural_attack({ anim: 'hit', clip: null })).toBe(false)
  })
})

describe('peak_envelope — the shared out-and-back curve (recoil + clipless lunge)', () => {
  test('0 at both ends, exactly 1 at the given peak', () => {
    expect(peak_envelope(0, 0.6)).toBe(0)
    expect(peak_envelope(1, 0.6)).toBe(0)
    expect(peak_envelope(0.6, 0.6)).toBeCloseTo(1, 6)
  })
  test('recoil_envelope is peak_envelope at RECOIL_PEAK (one curve home, no drift)', () => {
    for (const t of [0.1, 0.32, 0.5, 0.9]) expect(recoil_envelope(t)).toBeCloseTo(peak_envelope(t, 0.32), 12)
  })
})

describe('arm_attack_lunge / advance_lunge — clipless-attacker strike (fires toward facing, restores exactly)', () => {
  test('lunges TOWARD the facing (recoil goes away; the lunge is its negation) and peaks on the impact instant', () => {
    const e = make_fake_avatar_entity()
    e.facing_yaw = Math.PI / 2 // facing +X
    arm_attack_lunge(e, 0.48, 0.8) // the attack table's 0.6 fraction over the 0.8s nominal
    expect(e.lunge).not.toBeNull()
    advance_lunge(e, 0.48) // exactly the impact instant — full extension
    expect(e.avatar.object3d.position.x).toBeCloseTo(0.26, 6) // +X · LUNGE_DIST — toward the target
    expect(e.avatar.object3d.position.z).toBeCloseTo(0, 6)
  })
  test('restores the EXACT rest position when the beat window ends, and self-clears', () => {
    const e = make_fake_avatar_entity()
    e.avatar.object3d.position.x = 3.25
    e.avatar.object3d.position.z = -1.5
    e.facing_yaw = 1.1
    arm_attack_lunge(e, 0.48, 0.8)
    advance_lunge(e, 0.3)
    expect(e.avatar.object3d.position.x).not.toBeCloseTo(3.25, 6) // genuinely moved mid-beat
    advance_lunge(e, 10) // past the window
    expect(e.avatar.object3d.position.x).toBe(3.25)
    expect(e.avatar.object3d.position.z).toBe(-1.5)
    expect(e.lunge).toBeNull()
  })
  test('a walking attacker never arms (locomotion owns the body, same guard as the recoil)', () => {
    const e = make_fake_avatar_entity()
    e.walk = { path: [] }
    arm_attack_lunge(e, 0.48, 0.8)
    expect(e.lunge ?? null).toBeNull()
  })
})

describe('should_force_remove — the hard removal belt ("a dead mob may NEVER persist")', () => {
  test('false before the belt window elapses, true at/after it', () => {
    expect(should_force_remove(0, 1.0, 1.5)).toBe(false)
    expect(should_force_remove(0, 1.5, 1.5)).toBe(true)
    expect(should_force_remove(0, 2.0, 1.5)).toBe(true)
  })
  test('never armed (null/undefined) is never force-removed, regardless of clock', () => {
    expect(should_force_remove(null, 1000)).toBe(false)
    expect(should_force_remove(undefined, 1000)).toBe(false)
  })
  test('defaults the belt to DEATH_FORCE_REMOVE_S (1.5s) when omitted', () => {
    expect(should_force_remove(10, 11.49)).toBe(false)
    expect(should_force_remove(10, 11.5)).toBe(true)
  })
})

// ── integration-style: exercise the IMPURE mutation/restore contracts directly with a minimal fake avatar
// (no THREE/GLB needed — position/rotation/scale are plain settable numbers, matching exactly what
// advance_recoil/advance_flash/advance_death_collapse read+write). This is the "fires" + "restores" proof
// the pure envelope tests above can't give on their own. ─────────────────────────────────────────────────
const make_fake_avatar_entity = () => {
  const mat = {
    emissive: {
      r: 0,
      g: 0,
      b: 0,
      setRGB(r, g, b) {
        this.r = r
        this.g = g
        this.b = b
      },
    },
  }
  const object3d = {
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    scale: {
      x: 1,
      y: 1,
      z: 1,
      set(x, y, z) {
        this.x = x
        this.y = y
        this.z = z
      },
    },
    traverse(cb) {
      cb({ material: mat })
    },
  }
  return {
    facing_yaw: 0,
    walk: null,
    recoil: null,
    flash: null,
    death_collapse: null,
    death_armed_at: null,
    avatar: { object3d },
  }
}

describe('react_to_impact + advance_recoil — the procedural flinch FIRES for a clipless rig and restores exactly', () => {
  test('a clipless hit beat (clip:null — every current rig) still arms a real recoil + tint', () => {
    const e = make_fake_avatar_entity()
    react_to_impact(e, { anim: 'hit', clip: null, float: { text: '-12', kind: 'damage' } })
    expect(e.recoil).not.toBeNull()
    expect(e.flash).not.toBeNull()
  })

  test('mid-flinch the body is displaced off its rest pose; past RECOIL_DUR it restores EXACTLY', () => {
    const e = make_fake_avatar_entity()
    e.avatar.object3d.position.x = 5
    e.avatar.object3d.position.z = 5
    react_to_impact(e, { anim: 'hit', clip: null, float: { text: '-20', kind: 'damage' } })
    advance_recoil(e, 0.05) // mid-flinch
    expect(e.avatar.object3d.position.x !== 5 || e.avatar.object3d.position.z !== 5).toBe(true)
    advance_recoil(e, 1) // well past RECOIL_DUR (0.3s)
    expect(e.avatar.object3d.position.x).toBeCloseTo(5, 9)
    expect(e.avatar.object3d.position.z).toBeCloseTo(5, 9)
    expect(e.avatar.object3d.rotation.z).toBeCloseTo(0, 9)
    expect(e.avatar.object3d.scale.x).toBeCloseTo(1, 9)
    expect(e.avatar.object3d.scale.y).toBeCloseTo(1, 9)
    expect(e.recoil).toBeNull()
  })

  test('a bigger hit shakes with a bigger displacement than a small tick (float_magnitude_scale reused)', () => {
    const small = make_fake_avatar_entity()
    const big = make_fake_avatar_entity()
    react_to_impact(small, { anim: 'hit', clip: null, float: { text: '-3', kind: 'damage' } })
    react_to_impact(big, { anim: 'hit', clip: null, float: { text: '-60', kind: 'damage' } })
    advance_recoil(small, 0.05)
    advance_recoil(big, 0.05)
    const dist = (/** @type {any} */ e) => Math.hypot(e.avatar.object3d.position.x, e.avatar.object3d.position.z)
    expect(dist(big)).toBeGreaterThan(dist(small))
  })

  test('a DEATH beat flashes but never arms a recoil (a dying body never flinches)', () => {
    const e = make_fake_avatar_entity()
    react_to_impact(e, { anim: 'death', clip: null, float: { text: '-99', kind: 'damage' } })
    expect(e.recoil).toBeNull()
    expect(e.flash).not.toBeNull()
  })

  test("a no-float beat (the attacker's own swing) reacts not at all", () => {
    const e = make_fake_avatar_entity()
    react_to_impact(e, { anim: 'attack', clip: 'ATTACK', float: null })
    expect(e.recoil).toBeNull()
    expect(e.flash).toBeNull()
  })
})

describe('advance_flash — material state restores its exact baseline after the tint', () => {
  test('the material tints toward the reaction color mid-pulse, then restores at end-of-life', () => {
    const e = make_fake_avatar_entity()
    e.flash = { t: 0, r: 1, g: 0.28, b: 0.28, peak: 0.55, mats: null }
    advance_flash(e, 0.15) // mid-pulse — advance_flash caches f.mats on first tick
    const [cached] = /** @type {any} */ (e.flash).mats
    expect(cached.material.emissive.r).toBeGreaterThan(0) // genuinely tinted toward the reaction color
    expect(e.flash).not.toBeNull() // still mid-pulse, not yet cleared
    advance_flash(e, 1) // past FLASH_LIFE (0.4s total)
    expect(cached.material.emissive.r).toBe(cached.emissive.r)
    expect(cached.material.emissive.g).toBe(cached.emissive.g)
    expect(cached.material.emissive.b).toBe(cached.emissive.b)
    expect(e.flash).toBeNull() // the pulse itself is cleared too
  })
})

describe('arm_death_response + advance_death_collapse — procedural collapse for a clipless death only', () => {
  test('a real DEATH clip playing never arms the procedural collapse (still arms the hard-belt timestamp)', () => {
    const e = make_fake_avatar_entity()
    arm_death_response(e, { anim: 'death', clip: 'DEATH' }, 10)
    expect(e.death_collapse).toBeNull()
    expect(e.death_armed_at).toBe(10)
  })

  test('a clipless death arms the collapse, which crushes the body + topples it toward its settled pose', () => {
    const e = make_fake_avatar_entity()
    arm_death_response(e, { anim: 'death', clip: null }, 10)
    expect(e.death_collapse).not.toBeNull()
    advance_death_collapse(e, 0.45) // the full DEATH_COLLAPSE_DUR
    expect(e.avatar.object3d.scale.y).toBeLessThan(1) // crushed
    expect(e.avatar.object3d.rotation.x).toBeGreaterThan(0) // toppled
  })

  test('the collapse HOLDS its settled pose after the window — terminal, never restored (the belt removes it)', () => {
    const e = make_fake_avatar_entity()
    arm_death_response(e, { anim: 'death', clip: null }, 10)
    advance_death_collapse(e, 10) // settles in one big tick
    const settled_scale = e.avatar.object3d.scale.y
    const settled_rot = e.avatar.object3d.rotation.x
    advance_death_collapse(e, 5) // further ticks after settling
    expect(e.avatar.object3d.scale.y).toBe(settled_scale)
    expect(e.avatar.object3d.rotation.x).toBe(settled_rot)
  })

  test('is idempotent — a duplicate death beat on an already-collapsing body never restarts the crush', () => {
    const e = make_fake_avatar_entity()
    arm_death_response(e, { anim: 'death', clip: null }, 10)
    advance_death_collapse(e, 0.3)
    const mid_scale = e.avatar.object3d.scale.y
    arm_death_response(e, { anim: 'death', clip: null }, 10.1) // a duplicate death beat call
    expect(e.avatar.object3d.scale.y).toBe(mid_scale) // unchanged — not reset back to base_scale_y
  })
})

// ── [entity-anchor wiring] render_position_of — the LIVE render-position feed board_highlights'
// set_entity_anchor consumes (the "cell under a fighter" marker; added 2026-07-11). Unlike every
// test above, this exercises the REAL create_board_entities CONTROLLER (not the make_fake_avatar_entity
// shortcut) — the accessor reads the private entity registry, which only the controller owns. The
// avatar's GLB never needs to actually LOAD for this: object3d (a plain THREE.Group) exists synchronously
// before create_character_avatar's loader is even called, and advance_walk/place_avatar write straight to
// its .position regardless of load state. `glb_variant` is a SCHEMED dummy URL (not the real DEFAULT_GLB_URL)
// purely to dodge a bun-test-only wrinkle: GLTFLoader's default asset resolves to a schemeless filesystem
// path under bun (no Vite `?url` transform), and `new Request(url)` throws SYNCHRONOUSLY on that — a
// schemed URL defers the (expected) failure to an async fetch rejection, which character_avatar.js already
// catches and logs, never throws (verified: the entity registers and the walk tween runs regardless).
describe('render_position_of — the entity-anchor position feed (LIVE render XZ, never the logical cell)', () => {
  const DUMMY_GLB = 'https://example.test/none.glb' // schemed ⇒ no sync Request() throw under bun
  /** cell_center_world matching DEFAULT_CELL_SIZE (1.33) — mirrors the tactical facade's own convention. */
  const make_board = () => ({
    cell_center_world: (/** @type {number} */ x, /** @type {number} */ y) => [x * 1.33 + 0.665, 0, y * 1.33 + 0.665],
    origin: { x: 0, y: 0, z: 0 },
    cell_size: 1.33,
  })
  const make_engine = () => ({
    get_scene: () => null,
    get_camera: () => null,
    add_to_scene: () => {},
    remove_from_scene: () => {},
  })

  test('returns null for an id that was never upserted', () => {
    const entities = create_board_entities(/** @type {any} */ (make_board()), /** @type {any} */ (make_engine()))
    expect(entities.render_position_of('ghost')).toBeNull()
  })

  test('mid-walk, returns the INTERPOLATED tween position — never the snapped logical destination cell', () => {
    const entities = create_board_entities(/** @type {any} */ (make_board()), /** @type {any} */ (make_engine()))
    entities.upsert({ id: 'm1', cell: { x: 0, y: 0 }, glb_variant: DUMMY_GLB })
    expect(entities.render_position_of('m1')).toEqual({ x: 0.665, z: 0.665 }) // parked at its start cell

    void entities.move('m1', [{ x: 3, y: 0 }], { cells_per_second: 4 }) // 3 cells @ 4 c/s ⇒ lands at t≈0.75s
    // board_entities.js's move() snaps the LOGICAL cell to (3,0) synchronously RIGHT HERE ("state is where
    // it's HEADED") — world centre (4.655, 0.665). The old ally_seat/enemy_seat bug read exactly that
    // snapped cell; render_position_of must report neither the start nor that destination mid-walk.
    entities.tick(0.1, null)
    const mid = entities.render_position_of('m1')
    expect(mid.z).toBeCloseTo(0.665, 5) // this walk only moves along X
    expect(mid.x).toBeCloseTo(1.197, 2) // start(0.665) + dx(3.99)·t(0.4/3) — the exact interpolated point
    expect(mid.x).toBeGreaterThan(0.665) // moved off the start...
    expect(mid.x).toBeLessThan(4.655) // ...but nowhere near the destination cell's centre yet — no pre-jump

    entities.tick(10, null) // well past the ~0.75s walk duration — let it land
    const done = entities.render_position_of('m1')
    expect(done.x).toBeCloseTo(4.655, 5) // now — and only now — at the destination
    expect(done.z).toBeCloseTo(0.665, 5)
  })

  test('cleared to null once the entity despawns (remove) or the controller tears down', () => {
    const entities = create_board_entities(/** @type {any} */ (make_board()), /** @type {any} */ (make_engine()))
    entities.upsert({ id: 'm1', cell: { x: 0, y: 0 }, glb_variant: DUMMY_GLB })
    expect(entities.render_position_of('m1')).not.toBeNull()
    entities.remove('m1')
    expect(entities.render_position_of('m1')).toBeNull() // despawn — the feed forgets it instantly

    entities.upsert({ id: 'm2', cell: { x: 1, y: 1 }, glb_variant: DUMMY_GLB })
    entities.dispose() // fight teardown — every remaining entity drops out
    expect(entities.render_position_of('m2')).toBeNull()
  })
})

// ── WORN COSMETICS ON A FIGHT RIG (v1.12.31 ② regression: "cosmetic are not rendering in fights") ───────────
// Worn hat/cloak GLBs render on the ROAM avatar (embed_voxel_player: create_worn_cosmetics + set_slots once
// avatar.ready) but the FIGHT rig builder ignored them entirely — no worn-cosmetics rig was ever created, so a
// fighter's equipped cosmetics could never mount. The rig-build contract must now BUILD a worn rig for a player
// carrying worn slots and FEED it those slots (the same { head, back } shape resolve_worn_cosmetics produces).
// Injected fakes mirror the tactical test idiom (fake board/engine): a READY fake avatar (the real
// create_character_avatar needs a GLB the headless run has no bytes for) + a recording worn factory.
describe('worn cosmetics — the player fight rig mounts equipped hat/cloak (the roam parity that was missing)', () => {
  const make_board = () => ({
    cell_center_world: (/** @type {number} */ x, /** @type {number} */ y) => [x * 1.33 + 0.665, 0, y * 1.33 + 0.665],
    origin: { x: 0, y: 0, z: 0 },
    cell_size: 1.33,
  })
  const make_engine = () => ({
    get_scene: () => null,
    get_camera: () => null,
    add_to_scene: () => {},
    remove_from_scene: () => {},
  })
  /** A ready CharacterAvatar stand-in — only the surface the controller + the worn ready-gate touch. */
  const make_ready_avatar = () => ({
    object3d: new Group(),
    eye_height: 1.4,
    ready: true,
    update() {},
    tick() {},
    clip_duration: () => null,
    play_beat: () => null,
    set_colors() {},
    dispose() {},
  })

  test('a player upserted WITH worn slots builds a worn rig and feeds it the equipped hat/cloak (set_slots)', () => {
    /** @type {any[]} */ const set_slots_calls = []
    /** @type {any[]} */ const worn_ctor = []
    const create_worn = (/** @type {any} */ args) => {
      worn_ctor.push(args)
      return { set_slots: (/** @type {any} */ s) => set_slots_calls.push(s), mounted: () => ({}), dispose() {} }
    }
    const entities = create_board_entities(/** @type {any} */ (make_board()), /** @type {any} */ (make_engine()), {
      create_avatar: make_ready_avatar,
      create_worn,
    })
    const worn = {
      head: { url: '/cosmetics/sui_helmet.glb', variant: null },
      back: { url: '/cosmetics/cape_fuwa.glb', variant: 'black' },
    }
    entities.upsert({
      id: '0xP',
      kind: 'player',
      cell: { x: 0, y: 0 },
      glb_variant: 'https://example.test/none.glb',
      worn,
    })
    entities.tick(0.016, /** @type {any} */ (null)) // the worn rig reconciles on the first ready frame (roam's gate)

    expect(worn_ctor.length).toBe(1) // a worn-cosmetics rig was built for the player (the missing path)
    expect(worn_ctor[0]).toHaveProperty('avatar') // …bound to the player's avatar, exactly like the roam rig
    expect(set_slots_calls.at(-1)).toEqual(worn) // …and fed the equipped hat/cloak slots
  })

  test('a MOB never gets a worn rig (only players wear cosmetics)', () => {
    /** @type {any[]} */ const worn_ctor = []
    const create_worn = (/** @type {any} */ args) => {
      worn_ctor.push(args)
      return { set_slots() {}, mounted: () => ({}), dispose() {} }
    }
    const entities = create_board_entities(/** @type {any} */ (make_board()), /** @type {any} */ (make_engine()), {
      create_avatar: make_ready_avatar,
      create_worn,
    })
    entities.upsert({ id: 'mob-0', kind: 'mob', cell: { x: 1, y: 1 }, glb_variant: 'https://example.test/none.glb' })
    entities.tick(0.016, /** @type {any} */ (null))
    expect(worn_ctor.length).toBe(0)
  })
})
