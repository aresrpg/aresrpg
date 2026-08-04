// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Pure-math unit tests for water_material.js — the JS reference helpers the TSL nodes mirror
// (no GPU, no TSL evaluation, same discipline as sky_node.test.js). We can't execute the shader
// graph here, so we pin the physical PROPERTIES of the ported math: Fresnel monotonicity + endpoints,
// Beer-Lambert depth-tint darkening + red-dies-first, and shore-foam waterline behavior. If a future
// edit breaks the reflectance ramp or the absorption ordering, these fail before any capture.

import { test, expect, describe } from 'bun:test'

import { SUN_DISC_INTENSITY } from '../../src/render/sky/sky_node.js'
import {
  fresnel_schlick,
  spec_soft_shoulder,
  SPEC_SHOULDER_CAP,
  depth_tint,
  shore_foam,
  cascade_factor,
  cascade_streak_at,
  glint_graze_gate,
  hash_graze_gate,
  surface_alpha,
  shallow_presence_floor,
  shallow_fresnel_floor,
  WATER_SHALLOW_PRESENCE,
  WATER_PRESENCE_FEATHER,
  WATER_PRESENCE_FULL,
  WATER_SHALLOW_SKY_MIN,
  CASCADE_STREAK_FREQ_H,
  CASCADE_STREAK_FREQ_V,
  CASCADE_AERATION,
  CASCADE_FOAM_MAX,
  CASCADE_ALPHA_MIN,
  distance_lake_response,
  distant_reflection_blend,
  WATER_F0,
  REFLECT_MAX,
  WATER_SIGMA,
  WATER_BODY_COLOR,
  WATER_SHALLOW_COLOR,
  WATER_FADE_START,
  WATER_TINT_DEPTH,
  SHORE_FOAM_DEPTH,
  WATER_ALPHA_FLOOR,
  WATER_ALPHA_DEEP,
  WATER_ALPHA_BASE,
  WATER_ALPHA_VIEW_LEAN,
  WATER_ALPHA_VDEPTH_START,
  WATER_ALPHA_VDEPTH_END,
  CASCADE_SPEED_A,
  CASCADE_SPEED_B,
  GLINT_GRAZE_STEEP,
  GLINT_GRAZE_LOW,
  HASH_GRAZE_STEEP,
  HASH_GRAZE_LOW,
  WATER_SWELL_AMP,
  WATER_DISTANT_RIPPLE,
  WATER_DETAIL_FADE_NEAR,
  WATER_DETAIL_FADE_FAR,
  WATER_DISTANT_ROUGHEN,
  WATER_DISTANT_DESAT,
  WATER_DISTANT_ROAD_BROADEN,
  WATER_DISTANT_ROAD_DIM,
  sky_day_factor,
  water_sky_dim_factor,
  configure_water_night_floor,
  current_water_night_floor,
} from '../../src/render/water_material.js'

describe('fresnel_schlick — Schlick reflectance on the flattened normal', () => {
  // 2026-07-03 — anti-chrome fix for overly metallic reflectance: the Fresnel is now anti-chrome — exponent
  // FRESNEL_POWER (>5, steeper) and a grazing peak capped at REFLECT_MAX (<1) so mid-angles show the
  // water's blue-green body and even grazing water isn't a pure chrome mirror. These pin that shape.
  test('normal incidence (cosθ=1) equals F0', () => {
    expect(fresnel_schlick(1)).toBeCloseTo(WATER_F0, 6)
  })

  test('grazing (cosθ=0) reflects at the capped REFLECT_MAX (anti-chrome), not full 1', () => {
    expect(fresnel_schlick(0)).toBeCloseTo(REFLECT_MAX, 6)
    expect(REFLECT_MAX).toBeLessThan(1) // the cap is what keeps grazing water from reading as chrome
  })

  test('mid-angle reflectance stays LOW (body colour wins) — the anti-chrome payoff', () => {
    // At a moderate view angle (cosθ≈0.5) the steepened exponent keeps reflectance well below the
    // grazing peak, so the composite mix(through_water, reflection, fresnel) is body-dominated there.
    expect(fresnel_schlick(0.5)).toBeLessThan(REFLECT_MAX * 0.15)
  })

  test('monotonically increases as the view grazes (cosθ→0)', () => {
    let prev = fresnel_schlick(1)
    for (let c = 0.9; c >= 0; c -= 0.1) {
      const f = fresnel_schlick(c)
      expect(f).toBeGreaterThanOrEqual(prev - 1e-9)
      prev = f
    }
  })

  test('clamps out-of-range cosθ to the endpoints (no NaN / overshoot)', () => {
    expect(fresnel_schlick(2)).toBeCloseTo(WATER_F0, 6)
    expect(fresnel_schlick(-1)).toBeCloseTo(REFLECT_MAX, 6)
  })
})

describe('spec_soft_shoulder — ENG-19 specular white-point compressor (anti-mirror-blowout)', () => {
  // 2026-07-05 — the sun reflection read as a too-perfect mirror; it needed distortion and reduced
  // brightness. The soft-shoulder `s/(1+s/CAP)` is the "lose brightness"
  // lever: it caps the reflected-sky halo + additive glint so the sun-road can never blow to white and sits
  // visibly dimmer than the sun disc. These pin the contract the TSL nodes mirror op-for-op.
  test('dim radiance (s ≪ CAP) passes through ~unchanged — the frozen close-up/dim look is preserved', () => {
    // at s = CAP/50 the compression is < 2 %, so the close-up glitter + dim sky reflection are untouched.
    const s = SPEC_SHOULDER_CAP / 50
    expect(spec_soft_shoulder(s)).toBeGreaterThan(s * 0.98)
    expect(spec_soft_shoulder(s)).toBeLessThanOrEqual(s)
  })

  test('the output is STRICTLY below CAP for every finite input — the road can never reach the cap', () => {
    for (const s of [0, 0.5, SPEC_SHOULDER_CAP, 5, 12, 40, 1e6]) {
      expect(spec_soft_shoulder(s)).toBeLessThan(SPEC_SHOULDER_CAP)
      expect(spec_soft_shoulder(s)).toBeGreaterThanOrEqual(0)
    }
    // and it asymptotes TO the cap for huge input (the white-point).
    expect(spec_soft_shoulder(1e9)).toBeCloseTo(SPEC_SHOULDER_CAP, 2)
  })

  test('the capped road sits VISIBLY below the sun disc — "dimmer than the sun itself"', () => {
    // the reflected sun HALO peaks ≈ GLARE_STRENGTH (~12×tint) and the glint core ~9.5; both compress to
    // < CAP ≪ SUN_DISC_INTENSITY (40). Assert the very brightest specular the shader can feed the shoulder
    // still lands far under the disc (the constraint: the road must not read as bright as the sun).
    expect(SPEC_SHOULDER_CAP).toBeLessThan(SUN_DISC_INTENSITY * 0.2)
    expect(spec_soft_shoulder(12)).toBeLessThan(SUN_DISC_INTENSITY)
    expect(spec_soft_shoulder(1e6)).toBeLessThan(SUN_DISC_INTENSITY)
  })

  test('monotonically increasing (order preserved — a brighter input stays brighter out)', () => {
    let prev = -1
    for (let s = 0; s <= 60; s += 0.5) {
      const y = spec_soft_shoulder(s)
      expect(y).toBeGreaterThanOrEqual(prev - 1e-12)
      prev = y
    }
  })

  test('respects an explicit (distance-eased) cap and clamps negative input to 0', () => {
    expect(spec_soft_shoulder(1e9, 10)).toBeCloseTo(10, 1) // asymptote follows the passed cap
    expect(spec_soft_shoulder(-5)).toBe(0) // guarded (radiance ≥ 0)
    expect(Number.isFinite(spec_soft_shoulder(0))).toBe(true)
    expect(spec_soft_shoulder(0)).toBe(0)
  })
})

describe('depth_tint — Beer-Lambert through-water absorption', () => {
  // SPEC: "I should not be able to see deep water depth, only shallow water
  // should be see-through, it should fade off darker." → steepened WATER_SIGMA + smoothstep ramp over
  // [WATER_FADE_START, WATER_TINT_DEPTH] + darker WATER_BODY_COLOR. These expectations pin that shape.
  test('at the surface (depth 0) reads the shallow color', () => {
    const t = depth_tint(0)
    expect(t[0]).toBeCloseTo(WATER_SHALLOW_COLOR[0], 6)
    expect(t[1]).toBeCloseTo(WATER_SHALLOW_COLOR[1], 6)
    expect(t[2]).toBeCloseTo(WATER_SHALLOW_COLOR[2], 6)
  })

  test('shallow water (≤ fade-start) stays readably brighter than deep — see-through charm zone', () => {
    // Below the ramp start the base tint is still the shallow colour (only mild absorption); past the
    // ramp the bed term is near-black. The shallow water reads many times brighter → the bed shows
    // through the shallows while deep water is opaque-dark.
    const shallow = depth_tint(WATER_FADE_START * 0.8)
    const deep = depth_tint(WATER_TINT_DEPTH + 2)
    const shallow_bright = Math.max(shallow[0], shallow[1], shallow[2])
    const deep_bright = Math.max(deep[0], deep[1], deep[2])
    expect(shallow_bright).toBeGreaterThan(deep_bright * 5)
  })

  test('every channel darkens with depth (absorption)', () => {
    const shallow = depth_tint(0.2)
    const deep = depth_tint(WATER_TINT_DEPTH + 2)
    for (let i = 0; i < 3; i++) expect(deep[i]).toBeLessThan(shallow[i])
  })

  test('fades fast to a DARK body past the ramp — deep bed contribution near-black', () => {
    // By ~6-8 blocks the steepened sigma has crushed every channel of the through-bed term toward 0
    // (the visible deep colour is then the separate WATER_DEEP_FLOOR glow, not this term).
    const deep = depth_tint(WATER_TINT_DEPTH + 2)
    const brightest = Math.max(deep[0], deep[1], deep[2])
    expect(brightest).toBeLessThan(0.02)
  })

  test('red is absorbed fastest → deep water is blue-green (B > R)', () => {
    // sigma.r >> sigma.b, so the blue channel outlives the red one at depth.
    expect(WATER_SIGMA[0]).toBeGreaterThan(WATER_SIGMA[2])
    const deep = depth_tint(5)
    expect(deep[2]).toBeGreaterThan(deep[0])
  })

  test('tends toward the body color × absorption as depth grows past saturation', () => {
    const veryDeep = depth_tint(50)
    // base mix is fully body color by WATER_TINT_DEPTH; absorption then crushes it toward 0.
    for (let i = 0; i < 3; i++) {
      expect(veryDeep[i]).toBeLessThanOrEqual(WATER_BODY_COLOR[i] + 1e-6)
      expect(veryDeep[i]).toBeGreaterThanOrEqual(0)
    }
  })
})

describe('cascade_factor — waterfall gate (flat water must never cascade)', () => {
  // 2026-07-03 — fixes flat chunks intermittently animating like waterfalls. The cascade streak + agitation
  // foam must apply STRICTLY to vertical liquid faces, gated on the decoded face id AND the geometric
  // (pre-perturbation) normal — never on the wave-perturbed normal. These pin that invariant.
  test('TOP-face (id 2) liquid quad has cascade factor 0 — no waterfall on a flat sheet', () => {
    expect(cascade_factor(2, 1)).toBe(0) // +y top, normal straight up
  })

  test('BOTTOM-face (id 3) liquid quad has cascade factor 0', () => {
    expect(cascade_factor(3, -1)).toBe(0) // -y bottom, normal straight down
  })

  test('SIDE-face quads (id 0/1/4/5) with a vertical normal cascade (factor > 0)', () => {
    for (const id of [0, 1, 4, 5]) expect(cascade_factor(id, 0)).toBeGreaterThan(0)
  })

  test('a SIDE face id with a near-horizontal normal (mis-decoded top) is still gated off', () => {
    // belt-and-suspenders: even if a flat top quad were tagged a side id, |normal.y|≈1 blocks it.
    expect(cascade_factor(0, 0.98)).toBe(0)
    expect(cascade_factor(4, -1)).toBe(0)
  })
})

describe('cascade_streak_at — organic falling water (not "old TV" static)', () => {
  // 2026-07-03 owner: the old regular vertical sine bands read as TV static. The rework is TWO
  // downward-scrolling octaves at DIFFERENT speeds + a horizontal wobble. These pin the organic shape.
  test('streak + both octaves stay in [0,1]', () => {
    for (let y = 0; y < 20; y += 1.3) {
      for (let t = 0; t < 3; t += 0.7) {
        const [s, a, b] = cascade_streak_at(y, y * 0.5, t)
        for (const v of [s, a, b]) {
          expect(v).toBeGreaterThanOrEqual(-1e-6)
          expect(v).toBeLessThanOrEqual(1 + 1e-6)
        }
      }
    }
  })

  test('the two octaves scroll at DIFFERENT speeds (no lockstep TV march)', () => {
    // Different speeds ⇒ over a small dt the two octaves advance by different phase — so their values
    // decouple. If they marched in lockstep (a single sine, the old bug) their normalized rates match.
    expect(CASCADE_SPEED_A).not.toBeCloseTo(CASCADE_SPEED_B, 3)
    const t0 = cascade_streak_at(5, 3, 0)
    const t1 = cascade_streak_at(5, 3, 0.03)
    // octA and octB change by different amounts across the same dt (decorrelated motion).
    const dA = Math.abs(t1[1] - t0[1])
    const dB = Math.abs(t1[2] - t0[2])
    expect(Math.abs(dA - dB)).toBeGreaterThan(1e-4)
  })

  test('streaks scroll DOWNWARD over time (was inverted — features must DESCEND, not climb)', () => {
    // A falling pattern means the value now at a fixed height equals what was HIGHER UP a moment ago
    // (content descended). For octave A this is EXACT — phase FREQ_A·y + SPEED_A·FREQ_A·t gives
    // octA(y, t+dt) === octA(y + SPEED_A·dt, t) at the same horiz. An UPWARD (the pre-fix bug) scroll
    // would instead match a LOWER earlier point — so this pins DIRECTION, not just that it animates.
    const y = 4
    const horiz = 2
    const dt = 0.1
    const [, at_fixed_later] = cascade_streak_at(y, horiz, dt) // octA at (y, later)
    const [, at_higher_earlier] = cascade_streak_at(y + CASCADE_SPEED_A * dt, horiz, 0) // octA higher-up, earlier
    expect(at_fixed_later).toBeCloseTo(at_higher_earlier, 6) // content came from ABOVE ⇒ moving DOWN
    // and it must NOT match the lower-earlier point (that would be an upward/inverted scroll).
    const [, at_lower_earlier] = cascade_streak_at(y - CASCADE_SPEED_A * dt, horiz, 0)
    expect(Math.abs(at_fixed_later - at_higher_earlier)).toBeLessThan(Math.abs(at_fixed_later - at_lower_earlier))
    // sanity: genuinely animated (not static).
    expect(Math.abs(cascade_streak_at(y, horiz, 0)[0] - cascade_streak_at(y, horiz, 0.25)[0])).toBeGreaterThan(1e-3)
  })

  test('neighbouring columns decorrelate (horizontal wobble breaks dead-straight verticals)', () => {
    // Two nearby horizontal positions at the same height/time differ → streaks aren't identical
    // vertical lines across the whole face (the TV-scanline tell).
    const [left] = cascade_streak_at(6, 1.0, 0.5)
    const [right] = cascade_streak_at(6, 4.0, 0.5)
    expect(Math.abs(left - right)).toBeGreaterThan(1e-3)
  })
})

describe('glint_graze_gate — steep-down glint kill (anti white-static)', () => {
  // 2026-07-04 ENG-16: on steep-DOWN views the sun-glitter terms rode the noisy glint-normal and painted a
  // boiling WHITE STATIC (the specular road is a grazing phenomenon — meaningless looking straight down).
  // The fix gates the whole glint by the view up-component. These pin its contract: 0 at straight-down, 1 at
  // grazing (so the approved sun road + every eng15 pose keep full glint), monotone between.
  test('straight-DOWN view (up-comp 1.0) fully KILLS the glint — no static where the road is meaningless', () => {
    expect(glint_graze_gate(1.0)).toBeCloseTo(0, 6)
    expect(glint_graze_gate(GLINT_GRAZE_STEEP)).toBeCloseTo(0, 6) // at/above STEEP ⇒ off
  })

  test('GRAZING view keeps the glint fully ON (the real sun road is untouched)', () => {
    expect(glint_graze_gate(GLINT_GRAZE_LOW)).toBeCloseTo(1, 6) // at/below LOW ⇒ full glint
    // every eng15 acceptance pose (pitch ≥ -0.14 ⇒ view up-comp ≲ 0.15) is well below LOW ⇒ exactly 1.
    for (const view_up of [0.0, 0.02, 0.05, 0.1, 0.15]) expect(glint_graze_gate(view_up)).toBeCloseTo(1, 6)
  })

  test('monotonically rises from steep-down (0) to grazing (1) — a clean single transition, no reversal', () => {
    let prev = glint_graze_gate(1.0)
    for (let vu = 0.95; vu >= 0; vu -= 0.05) {
      const g = glint_graze_gate(vu)
      expect(g).toBeGreaterThanOrEqual(prev - 1e-9)
      expect(g).toBeGreaterThanOrEqual(0)
      expect(g).toBeLessThanOrEqual(1)
      prev = g
    }
  })

  test('the gate window is well-ordered (STEEP is steeper-down than LOW) so grazing ≠ steep-down', () => {
    expect(GLINT_GRAZE_STEEP).toBeGreaterThan(GLINT_GRAZE_LOW) // steep-down up-comp > grazing up-comp
    expect(GLINT_GRAZE_LOW).toBeGreaterThan(0) // a real grazing band keeps the glint (not gated at horizon)
  })

  test('ENG-17 CLOSE-STEEP regime (pitch −0.80 ⇒ view_up≈0.717) is FULLY gated OFF — the QA-red pose', () => {
    // The 2026-07-04 QA rig red: pinned static cam [70,150,120] pitch −0.80 (~30 m above spawn water) boiled
    // (frame diff mean 14.18 / 27 % of px). At pitch −0.80 the surface→camera up-component is sin(0.80)≈0.717.
    // The ENG-16 gate (STEEP 0.85) left this ~17 %-OPEN (the leak that boiled); ENG-17 tightened STEEP→0.55
    // so 0.717 is past it ⇒ the whole glint is dead here (no time-varying term ⇒ water diff → terrain-class).
    const view_up_at_pitch_080 = Math.sin(0.8)
    expect(view_up_at_pitch_080).toBeGreaterThan(GLINT_GRAZE_STEEP) // past the hard-close point
    expect(glint_graze_gate(view_up_at_pitch_080)).toBeCloseTo(0, 6) // ⇒ glint fully OFF (was ~0.17 leaking)
  })
})

describe('hash_graze_gate — ENG-17 per-pixel HASH-term kill (the close-steep boil root fix)', () => {
  // 2026-07-04 ENG-17: the CLOSE-STEEP boil (pitch −0.80, ~30 m) was the per-pixel TIME-SEEDED hash glint
  // (sparkle field + glint-normal jitter) firing at full DISTANCE-strength through a partially-open master
  // gate. The root fix gives ONLY those flickering hash terms a SEPARATE, STEEPER elevation gate that dies
  // FIRST (by ~22° down), before the master gate closes — so no per-pixel boil survives past grazing, while
  // the smooth road envelope still fades gently over the wider master band. These pin that contract.
  test('grazing keeps the hash sparkle fully ON — every eng15 pose (view_up ≲ 0.14) is untouched', () => {
    expect(hash_graze_gate(HASH_GRAZE_LOW)).toBeCloseTo(1, 6) // at/below LOW ⇒ full
    for (const view_up of [0.0, 0.05, 0.1, 0.14]) expect(hash_graze_gate(view_up)).toBeCloseTo(1, 6)
  })

  test('the hash terms die EARLIER than the master glint gate (flicker gone before the road even dims)', () => {
    // The whole point: HASH_GRAZE_STEEP < GLINT_GRAZE_STEEP so the boiling components are fully gone while the
    // smooth road envelope is still (partially) alive under the master gate — no per-pixel boil in the band.
    expect(HASH_GRAZE_STEEP).toBeLessThan(GLINT_GRAZE_STEEP)
    expect(HASH_GRAZE_STEEP).toBeGreaterThan(HASH_GRAZE_LOW) // well-ordered window
    expect(HASH_GRAZE_LOW).toBeGreaterThan(0)
    // at HASH_GRAZE_STEEP the hash terms are fully OFF while the master glint gate is still nearly wide open
    // (the smooth road is barely into its fade there), proving the FLICKER is killed strictly before the
    // smooth road envelope meaningfully fades — no per-pixel boil in the master transition band.
    expect(hash_graze_gate(HASH_GRAZE_STEEP)).toBeCloseTo(0, 6)
    expect(glint_graze_gate(HASH_GRAZE_STEEP)).toBeGreaterThan(0.9) // master road still substantially alive
  })

  test('the CLOSE-STEEP QA pose (view_up≈0.717) kills the hash terms too (belt-and-suspenders)', () => {
    expect(hash_graze_gate(Math.sin(0.8))).toBeCloseTo(0, 6)
  })

  test('monotonically rises from steep-down (0) to grazing (1) — a clean single transition', () => {
    let prev = hash_graze_gate(1.0)
    for (let vu = 0.95; vu >= 0; vu -= 0.05) {
      const g = hash_graze_gate(vu)
      expect(g).toBeGreaterThanOrEqual(prev - 1e-9)
      expect(g).toBeGreaterThanOrEqual(0)
      expect(g).toBeLessThanOrEqual(1)
      prev = g
    }
  })
})

describe('distance_lake_response — variance→roughness (anti-mirror distance roll-off)', () => {
  // 2026-07-04 owner REOPEN: "water should not be a strict mirror, there should be dilution and
  // variation… ondulations, and the water shader from the distance still looks repetitive." The landed
  // roll-off deleted the far normal detail WITHOUT converting it to roughness → the distant surface was
  // optically FLAT = a sky mirror with a clean sun ellipse. These pin the fix: the broad SWELL persists
  // to the horizon (undulation never dies), the chop fades to a small floor (no waffle), and the removed
  // variance (distance_rough) grows toward 1 far away to drive the reflection-cone + sun-road roughening.
  test('near water is at FULL chop detail (detail_fade≈1, distance_rough≈0) — close-up untouched', () => {
    const r = distance_lake_response(5) // the close-up framing distance
    expect(r.detail_fade).toBeCloseTo(1, 6)
    expect(r.distance_rough).toBeLessThan(1e-6) // no distance roughening near ⇒ crisp close reflection/road
  })

  test('distant water has faded the high-freq chop toward its floor (no reflection waffle at range)', () => {
    const far = distance_lake_response(WATER_DETAIL_FADE_FAR + 40) // well past the band
    // chop collapses to RIPPLE_AMP·DISTANT_RIPPLE (small); detail_fade→0 so distance_rough→1.
    expect(far.detail_fade).toBeCloseTo(0, 6)
    expect(far.distance_rough).toBeCloseTo(1, 6)
  })

  test('UNDULATION NEVER DIES — the broad swell ramps in with distance and rules the horizon', () => {
    // The swell is RAMPED by distance_rough: ≈0 near (close-up untouched), full WATER_SWELL_AMP at the
    // horizon. This is the term that keeps DISTANT water rocking (drives Fresnel/reflection/road) instead
    // of freezing into a mirror, WITHOUT disturbing the approved close-up (where chop alone is the read).
    const near = distance_lake_response(5)
    const horizon = distance_lake_response(2000)
    expect(WATER_SWELL_AMP).toBeGreaterThan(0)
    expect(near.swell_amp).toBeLessThan(WATER_SWELL_AMP * 1e-4) // ≈0 near ⇒ close-up byte-untouched
    expect(horizon.swell_amp).toBeCloseTo(WATER_SWELL_AMP, 6) // full swell at the horizon
    // the FAR effective normal-tilt is well above zero — the far surface is never optically flat (a flat
    // normal = the mirror defect). The swell alone clears the floor even as the chop bottoms out.
    expect(horizon.effective_amp).toBeGreaterThan(0.02) // hard floor: distinctly non-flat at the horizon
    // and it does NOT collapse to the tiny chop floor — the swell dominates the far tilt.
    expect(horizon.swell_amp).toBeGreaterThan(horizon.chop_amp) // swell rules distant undulation
  })

  test('the roll-off band is WIDE and monotone (no narrow beat band where octaves waffle)', () => {
    // WIDENED band (was 22→72; now 34→150) so the per-metre fade gradient is gentle — a sharp band is
    // where two octaves beat into the visible dot lattice. Assert a genuinely wide, monotone ramp.
    expect(WATER_DETAIL_FADE_FAR - WATER_DETAIL_FADE_NEAR).toBeGreaterThan(90)
    let prev = distance_lake_response(WATER_DETAIL_FADE_NEAR).detail_fade
    for (let d = WATER_DETAIL_FADE_NEAR; d <= WATER_DETAIL_FADE_FAR; d += 8) {
      const f = distance_lake_response(d).detail_fade
      expect(f).toBeLessThanOrEqual(prev + 1e-9) // monotonically fading with distance
      prev = f
    }
  })

  test('distance_rough rises monotonically with distance (the roughness the reflection/road consume)', () => {
    let prev = -1
    for (let d = 0; d <= 200; d += 10) {
      const dr = distance_lake_response(d).distance_rough
      expect(dr).toBeGreaterThanOrEqual(prev - 1e-9)
      expect(dr).toBeGreaterThanOrEqual(0)
      expect(dr).toBeLessThanOrEqual(1)
      prev = dr
    }
  })

  test('distance-dilution knobs are in sane, effective ranges (mirror-cure dials)', () => {
    // 2026-07-04 REGRESSION FIX: ROUGHEN is now the mean-sky UPWARD ELEVATION BIAS (>0 so the mean samples a
    // soft elevated patch, not the grazing horizon = a near-mirror), DESAT is the BLEND FRACTION toward that
    // smooth mean at full distance (0<DESAT<1 — a real dilution that still keeps a hint of the true sky). The
    // sun road broadens (BROADEN>0 → exponents divided down) and dims (0<DIM<1 → peak drops). Each must be a
    // real, bounded effect — 0 would re-introduce the mirror; ≥1 desat/dim would erase the reflection/road.
    expect(WATER_DISTANT_ROUGHEN).toBeGreaterThan(0) // mean-sky elevation bias — 0 would graze the horizon
    expect(WATER_DISTANT_DESAT).toBeGreaterThan(0)
    expect(WATER_DISTANT_DESAT).toBeLessThan(1)
    expect(WATER_DISTANT_ROAD_BROADEN).toBeGreaterThan(0)
    expect(WATER_DISTANT_ROAD_DIM).toBeGreaterThan(0)
    expect(WATER_DISTANT_ROAD_DIM).toBeLessThan(1)
    expect(WATER_DISTANT_RIPPLE).toBeGreaterThan(0) // a chop floor >0 so even faded water isn't dead
    expect(WATER_DISTANT_RIPPLE).toBeLessThan(0.5) // but small so the far waffle is gone
  })
})

describe('distant_reflection_blend — dilution is an AVERAGE, not a per-pixel dice roll (regression pin)', () => {
  // 2026-07-04 REGRESSION: the first distance-dilution cut JITTERED the reflected direction per-pixel with a
  // distance-growing hash → each distant pixel diced bright-sky-vs-dark = a violent white-on-navy boiling
  // static field (measured). The fix replaces the dice roll with a LERP of the sharp sample toward a
  // SMOOTH mean sky. These pin the load-bearing property a jitter can NEVER satisfy: a blend of two FIXED
  // inputs adds ZERO per-pixel variance, so equal neighbours get equal colour ⇒ no static.
  const SHARP = /** @type {[number,number,number]} */ ([0.95, 0.97, 1.0]) // a blown-out bright-sky sample
  const MEAN = /** @type {[number,number,number]} */ ([0.3, 0.42, 0.6]) // the soft elevated mean-sky colour

  test('close-up (5 m) keeps the SHARP sample byte-for-byte — the fix is inert near', () => {
    const out = distant_reflection_blend(SHARP, MEAN, 5)
    for (let i = 0; i < 3; i++) expect(out[i]).toBeCloseTo(SHARP[i], 6)
  })

  test('ZERO added variance: two pixels with the same inputs+distance get IDENTICAL colour (no static)', () => {
    // This is the whole regression. The old jitter, given identical inputs, returned DIFFERENT colours per
    // pixel (that difference WAS the static). A deterministic lerp cannot — same in ⇒ same out.
    const far = WATER_DETAIL_FADE_FAR + 40
    const a = distant_reflection_blend(SHARP, MEAN, far)
    const b = distant_reflection_blend(SHARP, MEAN, far)
    for (let i = 0; i < 3; i++) expect(a[i]).toBe(b[i])
    // and the result is BETWEEN sharp and mean per channel (a true convex blend — never overshoots into a
    // new brighter/darker value the way a random direction sample could).
    for (let i = 0; i < 3; i++) {
      const lo = Math.min(SHARP[i], MEAN[i])
      const hi = Math.max(SHARP[i], MEAN[i])
      expect(a[i]).toBeGreaterThanOrEqual(lo - 1e-9)
      expect(a[i]).toBeLessThanOrEqual(hi + 1e-9)
    }
  })

  test('distant water is DILUTED toward the mean (variance-reducing) — |sharp−out| grows with distance', () => {
    // The blend pulls the bright sharp sample toward the softer mean, so the distant reflection sits closer
    // to the mean than the raw sample does ⇒ the crisp sun/gradient is washed into soft haze.
    const near = distant_reflection_blend(SHARP, MEAN, 5)
    const far = distant_reflection_blend(SHARP, MEAN, WATER_DETAIL_FADE_FAR + 40)
    const gap = (/** @type {[number,number,number]} */ c) =>
      Math.abs(c[0] - SHARP[0]) + Math.abs(c[1] - SHARP[1]) + Math.abs(c[2] - SHARP[2])
    expect(gap(near)).toBeCloseTo(0, 6) // near ⇒ still the sharp sample
    expect(gap(far)).toBeGreaterThan(gap(near)) // far ⇒ pulled toward the mean
  })

  test('the dilution monotonically increases toward the mean with distance (a smooth ramp)', () => {
    // Fraction = distance_rough·DESAT and distance_rough rises monotonically, so the blend marches steadily
    // from sharp → mean with no reversal (a smooth haze onset, not a sudden band).
    const dist_to_mean = (/** @type {number} */ d) => {
      const o = distant_reflection_blend(SHARP, MEAN, d)
      return Math.abs(o[0] - MEAN[0]) + Math.abs(o[1] - MEAN[1]) + Math.abs(o[2] - MEAN[2])
    }
    let prev = dist_to_mean(0)
    for (let d = 0; d <= 200; d += 10) {
      const g = dist_to_mean(d)
      expect(g).toBeLessThanOrEqual(prev + 1e-9) // closes on the mean monotonically
      prev = g
    }
  })
})

describe('shore_foam — waterline foam ring', () => {
  test('full foam at the waterline (depth→0)', () => {
    expect(shore_foam(0)).toBeCloseTo(1, 6)
  })

  test('no foam once past the onset depth', () => {
    expect(shore_foam(SHORE_FOAM_DEPTH)).toBeCloseTo(0, 6)
    expect(shore_foam(SHORE_FOAM_DEPTH * 2)).toBeCloseTo(0, 6)
  })

  test('monotonically fades from shore to deep', () => {
    let prev = shore_foam(0)
    for (let d = 0.05; d <= SHORE_FOAM_DEPTH; d += 0.05) {
      const f = shore_foam(d)
      expect(f).toBeLessThanOrEqual(prev + 1e-9)
      prev = f
    }
  })
})

describe('surface_alpha — ROTATION-INVARIANT transparency (ENG-18 beach-shot fix)', () => {
  // 2026-07-04 owner: standing on a beach, shallow water showed a transparent band then switched OPAQUE BLUE
  // along a boundary that SWEPT with camera rotation. Root cause: the alpha was driven by the steep Fresnel
  // ((1−cosθ)^7) AND the SLANT view-ray depth — both rotation-VARIANT, so the transparent→opaque iso-line
  // moved with yaw/pitch. Fix: key the alpha on VERTICAL (rotation-invariant) depth + a mild FIXED view lean,
  // no Fresnel. These pin the contract: for a FIXED water column, alpha varies with view angle ONLY through
  // the gentle bounded view-lean — never a sweeping boundary.

  // Reconstruct the shader's vertical depth the way the TSL does: slant · |view.y|. For a fixed plumb-line
  // depth D and view up-component u, the ray's slant is D/u, so slant·u = D — the helper takes vertical_depth
  // directly, but these tests drive it through the SAME geometry the shader sees to prove invariance.
  const D_SHALLOW = 1.0 // a 1-block-deep beach — must read glassy at EVERY angle
  const D_DEEP = 8.0 // deep water — must read opaque at EVERY angle
  // view up-components spanning straight-down (1.0) → grazing (0.12), a 360° orbit at fixed pos.
  const VIEW_UPS = [1.0, 0.9, 0.7, 0.5, 0.3, 0.2, 0.12]

  test('THE FIX: shallow water (D=1) stays GLASSY-transparent across the whole rotation sweep', () => {
    // vertical_depth is CONSTANT = D regardless of the view angle, so the depth term is fixed. Alpha only
    // wiggles by the tiny view-lean. It must stay near the floor (transparent) at every yaw/pitch — no jump
    // to opaque anywhere in the sweep (the defect was a hard switch to opaque-blue mid-rotation).
    const alphas = VIEW_UPS.map((u) => surface_alpha(D_SHALLOW, u))
    for (const a of alphas) {
      expect(a).toBeGreaterThanOrEqual(WATER_ALPHA_FLOOR - 1e-9)
      expect(a).toBeLessThan(0.5) // glassy — the bed reads through (opaque would be ≳0.9)
    }
    // and the whole sweep varies by AT MOST the view-lean magnitude — no sweeping boundary.
    const spread = Math.max(...alphas) - Math.min(...alphas)
    expect(spread).toBeLessThanOrEqual(WATER_ALPHA_VIEW_LEAN + 1e-9)
  })

  test('deep water (D=8) stays OPAQUE across the whole rotation sweep (frozen "deep stays dark" law)', () => {
    for (const u of VIEW_UPS) {
      const a = surface_alpha(D_DEEP, u)
      expect(a).toBeGreaterThan(0.95) // fully occluding — no visible deep depth at any angle
    }
  })

  test('rotation-INVARIANCE: for a FIXED depth, |alpha(any angle) − alpha(any other angle)| ≤ view-lean', () => {
    // This is the whole defect. The OLD alpha (Fresnel + slant depth) swung from ~0.12 (down) to ~1.0
    // (grazing) for the same shallow column — a sweeping boundary. The fix bounds that swing by the mild
    // fixed lean for ANY fixed water column.
    for (const D of [0.5, 1, 2, 3, 5, 8, 20]) {
      const alphas = VIEW_UPS.map((u) => surface_alpha(D, u))
      const spread = Math.max(...alphas) - Math.min(...alphas)
      expect(spread).toBeLessThanOrEqual(WATER_ALPHA_VIEW_LEAN + 1e-9)
    }
  })

  test('SOFT gradient: the transparent→opaque transition spans metres (no hard line)', () => {
    // Keyed on vertical depth over a WIDE window, so stepping the depth by 0.25 block never jumps alpha by a
    // hard step — the boundary is a smooth ramp, not the sharp Fresnel line that read as an edge.
    let prev = surface_alpha(0, 0.7)
    for (let d = 0; d <= WATER_ALPHA_VDEPTH_END + 2; d += 0.25) {
      const a = surface_alpha(d, 0.7)
      expect(a - prev).toBeLessThan(0.12) // gentle per-step rise (a soft gradient), never a cliff
      expect(a).toBeGreaterThanOrEqual(prev - 1e-9) // monotone with depth
      prev = a
    }
  })

  test('depth-driven: deeper water is always ≥ as opaque as shallower at the SAME angle', () => {
    for (const u of VIEW_UPS) {
      let prev = surface_alpha(0, u)
      for (let d = 0; d <= WATER_ALPHA_VDEPTH_END + 4; d += 0.5) {
        const a = surface_alpha(d, u)
        expect(a).toBeGreaterThanOrEqual(prev - 1e-9)
        prev = a
      }
    }
  })

  test('a mild grazing lean exists but is bounded (grazing marginally more opaque, never a Fresnel band)', () => {
    // At a mid depth (D=3, so BOTH endpoints clear the floor and the raw linear lean is exposed): grazing
    // (view_up→0) is a touch more opaque than straight-down (view_up→1), by EXACTLY the linear view-lean —
    // a gentle wash, not the steep (1−cosθ)^7 the old alpha used. (For shallow depths the floor clamp swallows
    // part of the lean, shrinking the swing further — the invariance test above covers that regime.)
    const D_MID = 3
    const down = surface_alpha(D_MID, 1.0) // |view.y|=1 ⇒ lean 0
    const grazing = surface_alpha(D_MID, 0.0) // |view.y|=0 ⇒ full lean
    expect(grazing).toBeGreaterThan(down)
    expect(grazing - down).toBeCloseTo(WATER_ALPHA_VIEW_LEAN, 6) // linear, bounded — no sharp ramp
  })

  test('alpha stays within [FLOOR, 1] and never NaNs across the depth × angle matrix', () => {
    for (const D of [0, 0.3, 1, 4, 10, 50]) {
      for (const u of [0, 0.1, 0.5, 1, 2, -1]) {
        // includes out-of-range u (guarded by saturate/abs)
        const a = surface_alpha(D, u, 0.5)
        expect(Number.isFinite(a)).toBe(true)
        expect(a).toBeGreaterThanOrEqual(WATER_ALPHA_FLOOR - 1e-9)
        expect(a).toBeLessThanOrEqual(1 + 1e-9)
      }
    }
  })

  test('the vertical-depth window is well-ordered and the alpha knobs are sane', () => {
    expect(WATER_ALPHA_VDEPTH_END).toBeGreaterThan(WATER_ALPHA_VDEPTH_START)
    expect(WATER_ALPHA_VDEPTH_END - WATER_ALPHA_VDEPTH_START).toBeGreaterThan(2) // a genuinely SOFT (wide) ramp
    expect(WATER_ALPHA_VIEW_LEAN).toBeGreaterThan(0)
    expect(WATER_ALPHA_VIEW_LEAN).toBeLessThan(0.3) // MILD — a fixed wash, not a boundary
    expect(WATER_ALPHA_FLOOR).toBeLessThan(0.5) // shallow floor is glassy
    expect(WATER_ALPHA_BASE + WATER_ALPHA_DEEP).toBeGreaterThan(1) // deep saturates to full occlusion
  })
})

describe('shallow presence — 1-2 block water must be VISIBLE (2026-07-07 owner fix)', () => {
  // A 1-2 block deep lagoon shelf read as DRY SAND with a faint blue haze — the
  // alpha depth term is ≈0 there and the anti-chrome fresnel is ~0.02-0.04 at non-grazing angles, so the
  // surface had no presence at all. The fix: two rotation-invariant floors (alpha presence + a shallow
  // sky-mix minimum), feathered in over the first ~block, faded out before deep water. These pin it.
  test('THE FIX: a 1-2 block shelf gets a visible alpha floor at EVERY view angle', () => {
    for (const d of [1, 1.5, 2]) {
      for (const u of [1.0, 0.7, 0.4, 0.12]) {
        expect(surface_alpha(d, u)).toBeGreaterThanOrEqual(0.3 - 1e-9) // visible presence, was ~0.2-0.24
      }
    }
    expect(shallow_presence_floor(2)).toBeCloseTo(WATER_SHALLOW_PRESENCE, 6) // fully in past the feather
  })

  test('the exact waterline (depth → 0) keeps the old soft edge — no hard opacity rim on the shore', () => {
    expect(shallow_presence_floor(0)).toBe(0)
    expect(shallow_presence_floor(WATER_PRESENCE_FEATHER)).toBe(0)
    expect(surface_alpha(0, 0.7)).toBeCloseTo(WATER_ALPHA_FLOOR, 6) // unchanged pre-fix behaviour
  })

  test('rotation-invariant: the floor has no view input; a fixed column still swings ≤ view-lean', () => {
    for (const d of [0.5, 1, 2]) {
      const alphas = [1.0, 0.7, 0.4, 0.12].map((u) => surface_alpha(d, u))
      expect(Math.max(...alphas) - Math.min(...alphas)).toBeLessThanOrEqual(WATER_ALPHA_VIEW_LEAN + 1e-9)
    }
  })

  test('deep water is byte-untouched: floor ≪ the deep alpha, and the deep ramp still saturates to 1', () => {
    expect(WATER_SHALLOW_PRESENCE).toBeLessThan(0.5) // shallow stays glassy-translucent, never opaque
    for (const u of [1.0, 0.5, 0.12]) expect(surface_alpha(8, u)).toBeGreaterThan(0.95)
  })

  test('SKY FLOOR: shallow non-grazing water catches sky (fresnel_eff ≥ MIN), deep + grazing untouched', () => {
    const steep_fresnel = fresnel_schlick(0.9) // near-overhead view: raw fresnel ≈ 0.02 (invisible sky)
    expect(steep_fresnel).toBeLessThan(0.05)
    // over a 1-2 block shelf the effective sky mix is floored (deep-fade ≈ 1 at these depths):
    for (const d of [1, 1.5]) {
      expect(shallow_fresnel_floor(steep_fresnel, d)).toBeGreaterThan(steep_fresnel * 3)
      expect(shallow_fresnel_floor(steep_fresnel, d)).toBeLessThanOrEqual(WATER_SHALLOW_SKY_MIN + 1e-9)
    }
    // grazing view: raw fresnel is already far above the floor ⇒ returned unchanged.
    const grazing = fresnel_schlick(0.1)
    expect(shallow_fresnel_floor(grazing, 1.5)).toBe(grazing)
    // deep water: the zone fades to 0 by the deep ramp end ⇒ raw fresnel unchanged (approved deep optics).
    expect(shallow_fresnel_floor(steep_fresnel, WATER_ALPHA_VDEPTH_END)).toBe(steep_fresnel)
    expect(shallow_fresnel_floor(steep_fresnel, 20)).toBe(steep_fresnel)
    // and at the exact waterline the floor is inert too (no sky-sheen rim on wet sand).
    expect(shallow_fresnel_floor(steep_fresnel, 0)).toBe(steep_fresnel)
  })

  test('the presence window is well-ordered and feathers over ~a block (soft gradient, no rim)', () => {
    expect(WATER_PRESENCE_FULL).toBeGreaterThan(WATER_PRESENCE_FEATHER)
    expect(WATER_PRESENCE_FULL - WATER_PRESENCE_FEATHER).toBeGreaterThan(0.8)
    // monotone feather
    let prev = 0
    for (let d = 0; d <= 2; d += 0.1) {
      const f = shallow_presence_floor(d)
      expect(f).toBeGreaterThanOrEqual(prev - 1e-9)
      prev = f
    }
  })
})

describe('cascade v3 — VERTICAL streaks, not chevron bands (2026-07-07 owner fix)', () => {
  // Owner: waterfalls read as glass slabs crossed by a repeating horizontal zigzag/chevron pattern —
  // the v2 sin(world_y) octaves WERE horizontal bands. v3 streaks are value noise STRETCHED ALONG the
  // fall: features must decorrelate FAST across the face (horiz) and SLOWLY along it (y).
  test('Y-STRETCH: the streak field varies far more across the face than along the fall', () => {
    // mean |Δ| over a 0.5-block step, sampled across a grid: along-Y steps must change the field much
    // less than across-horiz steps (tall thin rivulets — the chevron/band killer).
    let dy_sum = 0
    let dh_sum = 0
    let n = 0
    for (let y = 0; y < 30; y += 1.7) {
      for (let h = 0; h < 30; h += 1.3) {
        const [s] = cascade_streak_at(y, h, 0)
        dy_sum += Math.abs(cascade_streak_at(y + 0.5, h, 0)[0] - s)
        dh_sum += Math.abs(cascade_streak_at(y, h + 0.5, 0)[0] - s)
        n += 1
      }
    }
    expect(dh_sum / n).toBeGreaterThan((dy_sum / n) * 2.5) // strongly elongated along the fall
    expect(CASCADE_STREAK_FREQ_H / CASCADE_STREAK_FREQ_V).toBeGreaterThanOrEqual(4) // knob-level pin
  })

  test('v4 TRANSLUCENT: a falling sheet keeps the still-water look, not a white milk slab', () => {
    // 2026-07-07 owner REOPEN: "the water flowing is super white — it shouldn't be much different in
    // appearance/colors than the still water, but animated more." v3 whited the fall out (AERATION 0.22 /
    // FOAM_MAX 0.9 / ALPHA_MIN 0.55 = an occluding milk slab). v4 drops the whiteness WAY down so the fall
    // keeps the still-surface water colour (translucent, tinted) and only FAINT moving rivulet highlights
    // read — the MOTION carries it (faster streaks), not whiteness. These pin the v4 intent.
    // foam = AERATION + crest·GAIN, capped at FOAM_MAX. A LOW base + LOW cap ⇒ the fall is mostly water
    // colour with sparse faint highlights, never a solid white sheet.
    expect(CASCADE_AERATION).toBeGreaterThan(0) // a hint of aeration (falling water isn't perfectly glassy)
    expect(CASCADE_AERATION).toBeLessThan(0.15) // but LOW — the base sheet reads as water, not whitewater
    expect(CASCADE_FOAM_MAX).toBeLessThan(0.5) // even the brightest crest rivulet stays mostly water colour
    // Fall alpha ~ the still-surface transparency (bed/cliff reads THROUGH it), NOT the old opaque slab.
    expect(CASCADE_ALPHA_MIN).toBeGreaterThanOrEqual(WATER_ALPHA_FLOOR) // ≥ the still-water floor (a real surface)
    expect(CASCADE_ALPHA_MIN).toBeLessThan(0.5) // translucent — the fall is see-through like still shallow water
    expect(CASCADE_ALPHA_MIN).toBeLessThanOrEqual(WATER_SHALLOW_PRESENCE + 1e-9) // no more opaque than a still shelf
  })

  test('fall speeds are fast (real falling water) and distinct (no lockstep)', () => {
    expect(CASCADE_SPEED_A).toBeGreaterThanOrEqual(4)
    expect(CASCADE_SPEED_B).toBeGreaterThan(CASCADE_SPEED_A)
  })
})

describe('sky_day_factor — NIGHT DIM of the fixed-sky water reflection', () => {
  // ROOT: the shipped water reflects a FIXED analytic sky written to EMISSIVE, so it never darkened with the
  // coupled scene and read as self-luminous at night. This factor scales the self-luminous water terms by the
  // sky's day/night level. The invariant that protects the tuned DAY look: it is EXACTLY 1 across ALL
  // daylight (multiply = identity) and only collapses across the horizon — so a day A/B is byte-identical.
  test('day is byte-identical — factor is exactly 1 for every above-horizon sun (y ≥ 0.04)', () => {
    for (const y of [0.04, 0.05, 0.17, 0.49, 0.75, 0.85, 0.92, 0.98]) {
      expect(sky_day_factor(y)).toBe(1) // exact 1 ⇒ reflection/shimmer/foam multiply is a no-op in daylight
    }
  })

  test('night collapses to 0 below the terminator (y ≤ -0.12) — reflection killed, water goes dark', () => {
    for (const y of [-0.12, -0.25, -0.5, -1]) {
      expect(sky_day_factor(y)).toBe(0)
    }
  })

  test('dusk is a smooth monotone ramp across the horizon (no pop) in (0,1)', () => {
    // Sample the terminator band top→bottom; the factor must strictly DECREASE and stay strictly inside (0,1)
    // — a continuous fade (the "no pop as the factor scales" dusk requirement), never a step.
    const band = [0.03, 0.02, 0.0, -0.04, -0.08, -0.11]
    const vals = band.map((y) => sky_day_factor(y))
    for (const v of vals) {
      expect(v).toBeGreaterThan(0)
      expect(v).toBeLessThan(1)
    }
    for (let i = 1; i < vals.length; i++) expect(vals[i]).toBeLessThan(vals[i - 1]) // strictly decreasing
  })

  test('matches couple_lighting`s own night band (this = 1 − night, single source of truth)', () => {
    // couple_lighting (sky_light_coupling.js) blends to night over night = smooth(0.04, -0.12, y); the water
    // reflection must track the SAME terminator so it darkens in lockstep with the coupled terrain ambient.
    const smooth = (e0, e1, x) => {
      const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)))
      return t * t * (3 - 2 * t)
    }
    for (const y of [0.1, 0.02, 0.0, -0.05, -0.1, -0.2]) {
      const night = smooth(0.04, -0.12, y)
      expect(sky_day_factor(y)).toBeCloseTo(1 - night, 6)
    }
  })
})

describe('water_sky_dim_factor — WATER NIGHT FLOOR ("Night Look A": 0.17)', () => {
  // ROOT: sky_day_factor alone (above) bottoms at an EXACT 0 below the terminator — the reflection killer that
  // made night water read as self-luminous (2026-07-12). Taken bare, that 0 sinks water to pure black, losing
  // the surface. This floors the SAME factor at a configurable minimum (default = the shipped 0.17 pick) so
  // night water stays visibly a surface, never crushes to black. Mirrors sky_light_coupling's moon_mul /
  // ambient_night_floor dial idiom exactly (DEFAULT const + module `let` + configure_*/current_* pair); the
  // real API set_sun_direction (below in water_material.js) writes THIS to sky_dim_u, not the bare factor.
  test('the default floor is the shipped 0.17 pick', () => {
    expect(current_water_night_floor()).toBe(0.17)
  })
  test('deep night never drops below the configured floor (bare sky_day_factor still bottoms at exactly 0)', () => {
    for (const y of [-0.12, -0.25, -0.5, -1]) {
      expect(sky_day_factor(y)).toBe(0) // the un-floored factor is unchanged (protects the existing invariant)
      expect(water_sky_dim_factor(y)).toBe(0.17) // the WATER uniform is floored at the configured minimum
    }
  })
  test('day stays byte-identical — the floor never lifts an already-brighter daylight factor', () => {
    for (const y of [0.04, 0.05, 0.17, 0.49, 0.98]) {
      expect(water_sky_dim_factor(y)).toBe(sky_day_factor(y)) // both exactly 1; floor is a no-op above it
    }
  })
  test('dusk band: the floor only engages once sky_day_factor drops below it, never before', () => {
    for (const y of [0.03, 0.0, -0.05, -0.08]) {
      const bare = sky_day_factor(y)
      const floored = water_sky_dim_factor(y)
      expect(floored).toBe(Math.max(bare, 0.17))
      expect(floored).toBeGreaterThanOrEqual(bare) // never DARKER than the bare factor
    }
  })
  test('configure_water_night_floor live-retunes the floor; reset restores the shipped default', () => {
    configure_water_night_floor({ water_night_floor: 0.4 })
    expect(current_water_night_floor()).toBe(0.4)
    expect(water_sky_dim_factor(-0.5)).toBe(0.4)
    // RESET — module state is process-global in bun; other tests/files must inherit the shipped default.
    configure_water_night_floor({ water_night_floor: 0.17 })
    expect(current_water_night_floor()).toBe(0.17)
    // null/omitted keeps the current value (no throw, no change).
    configure_water_night_floor()
    expect(current_water_night_floor()).toBe(0.17)
  })
})
