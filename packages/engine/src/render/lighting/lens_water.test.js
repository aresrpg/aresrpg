// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Lens-water — pure-math tests for the decay envelope, the FILM drain timeline, and the round-7 BURST
// LIFECYCLE over the chaotic bead field (the CPU twins the GPU shader mirrors term-for-term; see
// lens_water_field.js). The round-8 FLUID-LAW geometry suite (no straight lines, no clean shapes) lives in
// lens_water_field.test.js next to the twins it pins. The TSL node graph is GPU wiring proven by the
// headless build smoke + live capture; here we pin the decay curve, the drain window, inactive=identity,
// the seed-driven field, the bursts (swell→collapse), ejecta splinters, and bead-fed trails (all inside
// the unchanged ~3.5s park). Imports flow through lens_water.js (which re-exports the field surface) so a
// single entry point survives the module split.

import { describe, expect, test } from 'bun:test'

import {
  LENS_WATER,
  build_droplets,
  build_trails,
  burst_shape,
  decay_intensity,
  droplet_alpha,
  droplet_life_fade,
  droplet_state_at,
  film_front_y,
  trail_life_fade,
  trail_state_at,
} from './lens_water.js'

describe('decay_intensity — global envelope', () => {
  test('inactive (never splashed) ⇒ EXACTLY 0 — the identity contract', () => {
    expect(decay_intensity(null)).toBe(0)
    expect(decay_intensity(undefined)).toBe(0)
  })

  test('guards non-finite / negative elapsed time to 0 (never NaN, never a phantom effect)', () => {
    expect(decay_intensity(NaN)).toBe(0)
    expect(decay_intensity(Infinity)).toBe(0)
    expect(decay_intensity(-0.5)).toBe(0)
  })

  test('spikes to exactly 1 at the splash instant (t=0)', () => {
    expect(decay_intensity(0)).toBe(1)
  })

  test('exponential shape: at t=tau the envelope is ~1/e; matches Math.exp exactly', () => {
    const { tau } = LENS_WATER
    expect(decay_intensity(tau, tau)).toBeCloseTo(1 / Math.E, 9)
    expect(decay_intensity(1.3, tau)).toBeCloseTo(Math.exp(-1.3 / tau), 12)
  })

  test('monotonically decreasing as elapsed time grows', () => {
    const { tau } = LENS_WATER
    let prev = Infinity
    for (let t = 0; t <= 10; t += 0.25) {
      const v = decay_intensity(t, tau)
      expect(v).toBeLessThanOrEqual(prev + 1e-12)
      prev = v
    }
  })
})

describe('film_front_y — the top-first macro drain front (round-4 timeline; streams died in round-9)', () => {
  test('OMNIPRESENT window: the front has not entered the frame while the film must cover everything', () => {
    expect(film_front_y(0)).toBeLessThan(0)
    expect(film_front_y(LENS_WATER.drain_start)).toBeCloseTo(0, 12)
    expect(LENS_WATER.drain_start).toBeGreaterThanOrEqual(0.7)
    expect(LENS_WATER.drain_start).toBeLessThanOrEqual(1.1)
    expect(film_front_y(0.3)).toBeLessThan(-LENS_WATER.drain_band)
  })

  test('drains top-to-bottom: the front is monotonically increasing in t', () => {
    let prev = -Infinity
    for (let t = 0; t <= 3; t += 0.1) {
      const y = film_front_y(t)
      expect(y).toBeGreaterThanOrEqual(prev - 1e-12)
      prev = y
    }
  })

  test('MAIN film drained by ~2s: front (with finger + band margin) past the bottom edge', () => {
    const margin = 1 + LENS_WATER.finger_amp * 1.6 + LENS_WATER.drain_band
    expect(film_front_y(2.0)).toBeGreaterThan(margin)
    expect(LENS_WATER.max_active_s).toBeLessThanOrEqual(3.5)
  })
})

describe('droplet_life_fade — per-bead hard OUT-cutoff (the "zero residual" guarantee)', () => {
  test('full strength while young', () => {
    expect(droplet_life_fade(0, 2.5)).toBe(1)
    expect(droplet_life_fade(2.5 * 0.5, 2.5)).toBe(1)
  })

  test('EXACTLY 0 at and after its own lifetime — never a lingering ghost', () => {
    expect(droplet_life_fade(2.5, 2.5)).toBe(0)
    expect(droplet_life_fade(2.501, 2.5)).toBe(0)
    expect(droplet_life_fade(100, 2.5)).toBe(0)
  })

  test('monotonically non-increasing, bounded [0,1]', () => {
    let prev = Infinity
    for (let t = 0; t <= 3.5; t += 0.05) {
      const v = droplet_life_fade(t, 2.5)
      expect(v).toBeLessThanOrEqual(prev + 1e-12)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(1)
      prev = v
    }
  })

  test('the worst-case isolated bead (max birth + max lifetime) is fully zero by max_active_s', () => {
    const worst_birth = LENS_WATER.birth_spread
    const worst_lifetime = LENS_WATER.lifetime_min + LENS_WATER.lifetime_span
    const t_local_at_park = LENS_WATER.max_active_s - worst_birth
    expect(t_local_at_park).toBeGreaterThan(worst_lifetime)
    expect(droplet_life_fade(t_local_at_park, worst_lifetime)).toBe(0)
  })
})

describe('droplet_alpha — round-7 birth fade-IN + the out-fade (what droplet_state_at packs)', () => {
  test('at/ before birth (t_local <= 0) and at/after lifetime ⇒ EXACTLY 0 (never a phantom or a ghost)', () => {
    expect(droplet_alpha(0, 2.5)).toBe(0)
    expect(droplet_alpha(-1, 2.5)).toBe(0)
    expect(droplet_alpha(2.5, 2.5)).toBe(0)
    expect(droplet_alpha(3, 2.5)).toBe(0)
  })

  test('fades IN over birth_fade so a late-born droplet never pops on', () => {
    const half = LENS_WATER.birth_fade / 2
    expect(droplet_alpha(half, 2.5)).toBeCloseTo(0.5, 6) // linear ramp, halfway
    expect(droplet_alpha(LENS_WATER.birth_fade, 2.5)).toBeCloseTo(1, 6) // fully in
    expect(droplet_alpha(half, 2.5)).toBeGreaterThan(droplet_alpha(half / 2, 2.5)) // strictly ramping up
  })

  test('holds at 1 after fade-in through the hold window, then rejoins the out-fade', () => {
    expect(droplet_alpha(1.0, 2.5)).toBe(1) // past fade-in, before the 70% out-tail
    expect(droplet_alpha(2.3, 2.5)).toBeLessThan(1) // into the out-tail
    expect(droplet_alpha(2.3, 2.5)).toBeGreaterThan(0)
  })
})

describe('burst_shape — round-7 pop (swell → collapse)', () => {
  test('no burst (non-finite burst_at) ⇒ identity {1,1} always — an isolated bubble is byte-identical to round-6', () => {
    for (const t of [0, 0.5, 1.5, 3]) {
      expect(burst_shape(t, Infinity)).toEqual({ radius_mul: 1, alpha_mul: 1 })
      expect(burst_shape(t, undefined)).toEqual({ radius_mul: 1, alpha_mul: 1 })
    }
  })

  test('before the swell window ⇒ still identity', () => {
    const bt = 1.0
    expect(burst_shape(bt - LENS_WATER.burst_swell - 0.01, bt)).toEqual({ radius_mul: 1, alpha_mul: 1 })
  })

  test('SWELLS to the peak scale at the instant of the pop, alpha still full', () => {
    const bt = 1.0
    const at_pop = burst_shape(bt - 1e-9, bt)
    expect(at_pop.radius_mul).toBeCloseTo(LENS_WATER.burst_swell_scale, 3)
    expect(at_pop.alpha_mul).toBeCloseTo(1, 6)
  })

  test('COLLAPSES radius and alpha to ~0 across burst_collapse, hard 0 after', () => {
    const bt = 1.0
    const mid = burst_shape(bt + LENS_WATER.burst_collapse / 2, bt)
    expect(mid.radius_mul).toBeLessThan(LENS_WATER.burst_swell_scale)
    expect(mid.alpha_mul).toBeLessThan(1)
    expect(mid.alpha_mul).toBeGreaterThan(0)
    const done = burst_shape(bt + LENS_WATER.burst_collapse + 0.01, bt)
    expect(done).toEqual({ radius_mul: 0, alpha_mul: 0 }) // the bubble is gone
  })

  test('the swelled radius never eats the screen (max bead × swell scale stays a droplet)', () => {
    const max_swelled = (LENS_WATER.radius_min + LENS_WATER.radius_span) * LENS_WATER.burst_swell_scale
    expect(max_swelled).toBeLessThanOrEqual(0.025)
  })
})

describe('build_droplets — round-7 dense field + bursts + ejecta splinters', () => {
  test('returns primary + splinter beads; every field finite and in-range', () => {
    const drops = build_droplets(42)
    expect(drops).toHaveLength(LENS_WATER.count + LENS_WATER.splinter_slots)
    for (const d of drops) {
      expect(d.x0).toBeGreaterThanOrEqual(0)
      expect(d.x0).toBeLessThanOrEqual(1)
      expect(d.birth).toBeGreaterThanOrEqual(0)
      expect(d.lifetime).toBeGreaterThan(0)
      expect(d.radius).toBeGreaterThanOrEqual(LENS_WATER.radius_min)
      expect(d.slide).toBeGreaterThan(0)
      expect(d.sway_freq).toBeGreaterThan(0)
      expect(Number.isFinite(d.sway_phase)).toBe(true)
      expect(Number.isFinite(d.pop_x)).toBe(true)
      expect(Number.isFinite(d.pop_y)).toBe(true)
    }
  })

  test('CHAOS (round-6 base): the PRIMARY field is frame-wide, size-varied, per-bead speeds — never a lane grid', () => {
    for (const seed of [1, 7, 42, 99]) {
      const primaries = build_droplets(seed).slice(0, LENS_WATER.count)
      const xs = primaries.map((d) => d.x0)
      const ys = primaries.map((d) => d.y0)
      const rs = primaries.map((d) => d.radius)
      expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(0.6)
      expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(0.5)
      expect(Math.max(...rs) / Math.min(...rs)).toBeGreaterThan(2)
      expect(new Set(primaries.map((d) => d.slide)).size).toBe(primaries.length)
    }
  })

  test('SOME (not all, not none) primaries burst — the field thins, isolated bubbles survive', () => {
    for (const seed of [1, 7, 42, 99]) {
      const primaries = build_droplets(seed).slice(0, LENS_WATER.count)
      const bursting = primaries.filter((d) => Number.isFinite(d.burst_at))
      expect(bursting.length).toBeGreaterThan(3)
      expect(bursting.length).toBeLessThan(primaries.length) // survivors remain
      for (const d of bursting) {
        expect(d.burst_at).toBeGreaterThanOrEqual(LENS_WATER.burst_min)
        expect(d.burst_at).toBeLessThanOrEqual(LENS_WATER.burst_min + LENS_WATER.burst_span)
      }
    }
  })

  test('SIZE-BIASED bursts: heavy beads pop more than dots (mean bursting radius > mean surviving radius)', () => {
    for (const seed of [1, 7, 42, 99]) {
      const primaries = build_droplets(seed).slice(0, LENS_WATER.count)
      const mean = (/** @type {ReturnType<typeof build_droplets>} */ a) =>
        a.reduce((s, d) => s + d.radius, 0) / a.length
      const burst = primaries.filter((d) => Number.isFinite(d.burst_at))
      const survive = primaries.filter((d) => !Number.isFinite(d.burst_at))
      expect(mean(burst)).toBeGreaterThan(mean(survive))
    }
  })

  test('SPLINTERS: tiny, short-lived, thrown outward, and born AT a bursting parent (never re-burst)', () => {
    const drops = build_droplets(42)
    const splinters = drops.slice(LENS_WATER.count)
    expect(splinters).toHaveLength(LENS_WATER.splinter_slots)
    for (const s of splinters) {
      expect(s.burst_at).toBe(Infinity) // ejecta just fades
      expect(s.radius).toBeLessThanOrEqual(LENS_WATER.radius_min + LENS_WATER.splinter_radius_span)
      expect(s.lifetime).toBeGreaterThanOrEqual(LENS_WATER.splinter_life_min)
      expect(s.lifetime).toBeLessThanOrEqual(LENS_WATER.splinter_life_min + LENS_WATER.splinter_life_span)
      expect(Math.hypot(s.pop_x, s.pop_y)).toBeGreaterThan(0) // genuinely thrown off
      // born when its parent popped (there are always bursts in a 48-bead field ⇒ born inside the window)
      expect(s.birth).toBeGreaterThanOrEqual(LENS_WATER.burst_min)
      expect(s.birth).toBeLessThanOrEqual(LENS_WATER.burst_min + LENS_WATER.burst_span)
    }
  })

  test('a different seed reshuffles positions; the same seed reproduces the exact field (pure)', () => {
    const a = build_droplets(1)
    const b = build_droplets(2)
    expect(a.some((d, i) => Math.abs(d.x0 - b[i].x0) > 1e-6)).toBe(true)
    expect(build_droplets(7)).toEqual(build_droplets(7))
  })

  test('tier-scaled counts honoured (low tier = fewer primaries + fewer splinters)', () => {
    const low = build_droplets(3, LENS_WATER.count_low, Math.round(LENS_WATER.splinter_slots / 2))
    expect(low).toHaveLength(LENS_WATER.count_low + Math.round(LENS_WATER.splinter_slots / 2))
  })
})

describe('droplet_state_at — per-frame packed state (the shader input)', () => {
  const drop = {
    x0: 0.5,
    y0: 0.2,
    birth: 0.1,
    lifetime: 2.5,
    radius: 0.008,
    burst_at: Infinity,
    slide: 0.03,
    sway_phase: 1.2,
    sway_freq: 2.5,
    pop_x: 0,
    pop_y: 0,
  }

  test('round-7: BEFORE its own birth a bead is INVISIBLE (alpha 0), then fades in (no pop)', () => {
    const pre = droplet_state_at(drop, 0.05) // t < birth
    expect(pre.alpha).toBe(0)
    expect(pre.x).toBeCloseTo(0.5, 9) // held at spawn, just not drawn
    const fading_in = droplet_state_at(drop, drop.birth + LENS_WATER.birth_fade / 2)
    expect(fading_in.alpha).toBeGreaterThan(0)
    expect(fading_in.alpha).toBeLessThan(1) // mid fade-in — genuinely ramping, never a hard appearance
  })

  test('a bead SLIDES DOWN-screen (+y) at its own speed, wandering within bounds, life-fading to a hard 0', () => {
    const early = droplet_state_at(drop, 0.6) // t_local 0.5
    const late = droplet_state_at(drop, 2.1) // t_local 2.0
    // this legacy drop carries NO surge fields ⇒ fall(tb) = tb exactly (the round-7 linear descent)
    expect(early.y).toBeCloseTo(drop.y0 + drop.slide * 0.5, 9)
    expect(late.y).toBeGreaterThan(early.y)
    // round-8: TWO wander octaves ride sway_amp (weights 1 + 0.6 ⇒ ×1.6 max)
    expect(Math.abs(early.x - drop.x0)).toBeLessThanOrEqual(LENS_WATER.sway_amp * 1.6 + 1e-12)
    expect(late.alpha).toBeLessThan(early.alpha)
    expect(droplet_state_at(drop, 2.6).alpha).toBe(0)
  })

  test('a BURSTING bead swells then vanishes (radius up before the pop, then radius+alpha to 0)', () => {
    const burst_drop = { ...drop, burst_at: 1.0 }
    const before = droplet_state_at(burst_drop, drop.birth + 0.5) // well before the burst
    const swelling = droplet_state_at(burst_drop, drop.birth + 1.0 - 1e-6) // at the pop instant
    const after = droplet_state_at(burst_drop, drop.birth + 1.0 + LENS_WATER.burst_collapse + 0.05)
    expect(swelling.radius).toBeGreaterThan(before.radius) // swelled
    expect(after.radius).toBeLessThan(before.radius) // collapsed
    expect(after.alpha).toBe(0) // gone
  })

  test('a SPLINTER pops OUTWARD then falls (ejecta): x/y displaced from spawn, easing out', () => {
    const spl = { ...drop, birth: 0.8, pop_x: 0.03, pop_y: -0.02, slide: 0.05 }
    const t0 = droplet_state_at(spl, spl.birth + 0.001) // just born
    const t1 = droplet_state_at(spl, spl.birth + 0.1) // popped outward
    expect(Math.abs(t1.x - spl.x0)).toBeGreaterThan(Math.abs(t0.x - spl.x0)) // thrown out in x
    const t_late = droplet_state_at(spl, spl.birth + 0.3)
    expect(t_late.y).toBeGreaterThan(t1.y) // then gravity (slide) pulls it down
  })
})

describe('build_trails + trail_state_at — round-7 bead-fed water columns', () => {
  test('returns exactly trail_slots trails; filled slots are born at a burst with an irregular length', () => {
    const drops = build_droplets(42)
    const trails = build_trails(drops, 42)
    expect(trails).toHaveLength(LENS_WATER.trail_slots)
    // a 48-bead field always has ≥ trail_slots bursts ⇒ every slot is fed
    for (const tr of trails) {
      expect(tr.birth).toBeGreaterThanOrEqual(LENS_WATER.burst_min)
      expect(tr.birth).toBeLessThanOrEqual(LENS_WATER.burst_min + LENS_WATER.burst_span)
      expect(tr.max_len).toBeGreaterThanOrEqual(LENS_WATER.trail_len_min)
      expect(tr.max_len).toBeLessThanOrEqual(LENS_WATER.trail_len_min + LENS_WATER.trail_len_span)
      expect(tr.lifetime).toBeGreaterThanOrEqual(LENS_WATER.trail_life_min)
    }
    // irregular lengths — not one uniform column lane
    expect(new Set(trails.map((t) => t.max_len)).size).toBeGreaterThan(1)
  })

  test('trails are fed by the HEAVIEST bursting beads (a small synthetic field proves the selection)', () => {
    // three bursting beads of different radii + one non-bursting big bead: the trail must take the big
    // BURSTING one first, and never the (bigger) non-bursting bead.
    const base = {
      x0: 0.5,
      y0: 0.3,
      birth: 0,
      lifetime: 2.5,
      slide: 0,
      sway_phase: 0,
      sway_freq: 2,
      pop_x: 0,
      pop_y: 0,
    }
    const drops = [
      { ...base, radius: 0.02, burst_at: Infinity }, // biggest but NOT bursting → never a trail
      { ...base, radius: 0.015, burst_at: 0.5 }, // heaviest bursting → first trail
      { ...base, radius: 0.006, burst_at: 0.6 },
      { ...base, radius: 0.011, burst_at: 0.7 },
    ]
    const trails = build_trails(drops, 5, 2)
    expect(trails[0].birth).toBe(0.5) // fed by the 0.015 bursting bead
    expect(trails[1].birth).toBe(0.7) // then the 0.011 bursting bead — never the non-bursting 0.02
  })

  test('a trail runs DOWN (length grows to max_len over trail_grow) then fades to a hard 0', () => {
    const trail = { x: 0.4, y_top: 0.3, birth: 0.5, max_len: 0.4, lifetime: 1.5 }
    expect(trail_state_at(trail, 0.4).alpha).toBe(0) // before birth
    const growing = trail_state_at(trail, 0.5 + LENS_WATER.trail_grow / 2)
    expect(growing.length).toBeGreaterThan(0)
    expect(growing.length).toBeLessThan(trail.max_len) // still running down
    const grown = trail_state_at(trail, 0.5 + LENS_WATER.trail_grow + 0.1)
    expect(grown.length).toBeCloseTo(trail.max_len, 6) // reached full length
    expect(trail_state_at(trail, 0.5 + trail.lifetime).alpha).toBe(0) // gone at end of life
  })

  test('unfilled trail slots (fewer bursts than slots) are inert (never visible)', () => {
    const drops = [
      {
        x0: 0.5,
        y0: 0.5,
        birth: 0,
        lifetime: 2.5,
        radius: 0.01,
        burst_at: 0.5,
        slide: 0,
        sway_phase: 0,
        sway_freq: 2,
        pop_x: 0,
        pop_y: 0,
      },
    ]
    const trails = build_trails(drops, 5, 4) // 1 burst, 4 slots ⇒ 3 inert
    let visible = 0
    for (const tr of trails)
      for (let t = 0; t <= LENS_WATER.max_active_s; t += 0.1) if (trail_state_at(tr, t).alpha > 0) visible++
    expect(visible).toBeGreaterThan(0) // the one real trail shows
    expect(trails.filter((t) => t.lifetime === 0)).toHaveLength(3) // the rest are inert
  })
})

describe('trail_life_fade — fade-in + hold + tail', () => {
  test('0 outside [0,lifetime]; ramps in; peaks at 1 in the hold; tails to 0', () => {
    expect(trail_life_fade(0, 1.5)).toBe(0)
    expect(trail_life_fade(1.5, 1.5)).toBe(0)
    expect(trail_life_fade(LENS_WATER.trail_fade_in / 2, 1.5)).toBeCloseTo(0.5, 6) // mid fade-in
    expect(trail_life_fade(1.5 * 0.4, 1.5)).toBe(1) // hold window
    const tail = trail_life_fade(1.5 * 0.9, 1.5)
    expect(tail).toBeGreaterThan(0)
    expect(tail).toBeLessThan(1)
  })
})

describe('LENS_WATER config — the round-7 lifecycle laws as knobs', () => {
  test('DENSITY: round-7 doubles the onset field (way more water), bounded for one flat GPU loop', () => {
    expect(LENS_WATER.count).toBeGreaterThanOrEqual(40) // ~2× round-6's 26 = the ask for "way more water"
    expect(LENS_WATER.count).toBeLessThanOrEqual(64) // … but bounded — burst-only cost, one flat loop
    expect(LENS_WATER.count_low).toBeGreaterThan(0)
    expect(LENS_WATER.count_low).toBeLessThanOrEqual(LENS_WATER.count)
    expect(LENS_WATER.splinter_slots).toBeGreaterThan(0)
    expect(LENS_WATER.trail_slots).toBeGreaterThan(0)
    expect(LENS_WATER.radius_min).toBeGreaterThanOrEqual(0.002)
    expect(LENS_WATER.radius_min + LENS_WATER.radius_span).toBeLessThanOrEqual(0.025)
  })

  test('BURSTS staggered across the window; a real fraction pop but not all', () => {
    expect(LENS_WATER.burst_fraction).toBeGreaterThan(0)
    expect(LENS_WATER.burst_fraction).toBeLessThan(1)
    expect(LENS_WATER.burst_min).toBeGreaterThan(0)
    expect(LENS_WATER.burst_span).toBeGreaterThan(0)
    expect(LENS_WATER.burst_swell_scale).toBeGreaterThan(1) // it genuinely swells
    expect(LENS_WATER.burst_collapse).toBeGreaterThan(0)
    expect(LENS_WATER.birth_fade).toBeGreaterThan(0) // no pop-on
  })

  test('TRAILS are long and irregular but never a uniform lane', () => {
    expect(LENS_WATER.trail_len_min).toBeGreaterThan(0.1) // genuinely LONG
    expect(LENS_WATER.trail_len_span).toBeGreaterThan(0) // irregular
    expect(LENS_WATER.trail_width).toBeGreaterThan(0)
    expect(LENS_WATER.trail_width).toBeLessThan(0.05) // a narrow column, not a wall
    expect(LENS_WATER.trail_crest).toBeGreaterThan(0) // the specular crest exists
    expect(LENS_WATER.trail_grow).toBeGreaterThan(0)
  })

  test('ROUND-8 fluid knobs: meander past the width, real pinch/bulge, ragged caps, wander band', () => {
    // max lateral wander (octaves ×1.85) must exceed the column's own width — the S-bend is VISIBLE
    expect(LENS_WATER.trail_meander * 1.85).toBeGreaterThan(LENS_WATER.trail_width * 1.2)
    expect(LENS_WATER.trail_meander).toBeLessThanOrEqual(0.03) // …but stays a stream, not a scribble
    expect(LENS_WATER.trail_width_var).toBeGreaterThan(0.3) // genuinely pinches and bulges …
    expect(LENS_WATER.trail_width_var).toBeLessThanOrEqual(0.8) // … but the width never hits 0
    expect(LENS_WATER.trail_rag).toBeGreaterThan(0) // caps are never straight cuts
    expect(LENS_WATER.sway_amp).toBeGreaterThan(0)
    expect(LENS_WATER.sway_amp * 1.6).toBeLessThanOrEqual(0.02) // a wander, never a teleport
    // amorphous silhouettes: warp deep enough to kill the circle, shallow enough to keep r_eff > 0.5R
    expect(LENS_WATER.meniscus_amp).toBeGreaterThanOrEqual(0.12)
    expect(LENS_WATER.meniscus_amp * 1.65).toBeLessThan(0.5)
  })

  test('PARK: every bead / splinter / trail worst-case finishes before the unchanged 3.5s park', () => {
    const latest_burst = LENS_WATER.burst_min + LENS_WATER.burst_span
    // isolated survivor bead
    expect(LENS_WATER.birth_spread + LENS_WATER.lifetime_min + LENS_WATER.lifetime_span).toBeLessThanOrEqual(
      LENS_WATER.max_active_s
    )
    // splinter: born at the latest burst, longest life
    expect(latest_burst + LENS_WATER.splinter_life_min + LENS_WATER.splinter_life_span).toBeLessThanOrEqual(
      LENS_WATER.max_active_s
    )
    // trail: born at the latest burst, longest life (the tight one)
    expect(latest_burst + LENS_WATER.trail_life_min + LENS_WATER.trail_life_span).toBeLessThanOrEqual(
      LENS_WATER.max_active_s
    )
    // round-9 remnant law: the lagged region gate has closed on every feature before the park
    expect(LENS_WATER.region_end + LENS_WATER.feature_lag).toBeLessThanOrEqual(LENS_WATER.max_active_s)
    expect(LENS_WATER.max_active_s).toBeLessThanOrEqual(3.5)
    expect(LENS_WATER.tau).toBeGreaterThanOrEqual(1.6)
    expect(LENS_WATER.tau).toBeLessThanOrEqual(1.8)
  })

  test('FILM (round-9): the SHEET owns the opening — strong at t=0, receding to the r4 subtle base', () => {
    expect(LENS_WATER.film_amp).toBeGreaterThanOrEqual(0.003) // the BASE stays in the r4 subtle band …
    expect(LENS_WATER.film_amp).toBeLessThanOrEqual(0.006)
    expect(LENS_WATER.sheet_amp).toBeGreaterThanOrEqual(LENS_WATER.film_amp * 2) // … the OPENING is unmistakable
    expect(LENS_WATER.sheet_amp).toBeLessThanOrEqual(0.03) // but never a nauseating smear
    expect(LENS_WATER.sheet_hold).toBeGreaterThanOrEqual(0.25) // a real full-wet beat …
    expect(LENS_WATER.sheet_hold + LENS_WATER.sheet_fade).toBeLessThanOrEqual(1.5) // … broken by ~0.8-1.5s (target window)
    expect(LENS_WATER.sheen_strength).toBeGreaterThan(0) // the wet glisten exists …
    expect(LENS_WATER.sheen_strength).toBeLessThanOrEqual(0.15) // … but never a white veil
    expect(LENS_WATER.film_flow_speed).toBeGreaterThan(0)
  })

  test('lens kernel keeps the round-3 subtle laws (gentle bend, no chrome; tiny rim/glint) — shared by beads AND trails', () => {
    expect(LENS_WATER.refract_eta).toBeGreaterThan(1)
    expect(LENS_WATER.refract_eta).toBeLessThanOrEqual(1.4) // GENTLE (the chrome ban)
    expect(LENS_WATER.edge_softness).toBeGreaterThan(0)
    expect(LENS_WATER.edge_softness).toBeLessThan(1)
    expect(LENS_WATER.mask_lo).toBeLessThan(LENS_WATER.mask_hi)
    expect(LENS_WATER.rim_darken).toBeGreaterThan(0)
    expect(LENS_WATER.rim_darken).toBeLessThanOrEqual(0.25)
    const glint_len = Math.hypot(LENS_WATER.glint_dir[0], LENS_WATER.glint_dir[1])
    expect(glint_len).toBeCloseTo(1, 1)
    expect(LENS_WATER.glint_strength).toBeGreaterThan(0)
    expect(LENS_WATER.glint_strength).toBeLessThanOrEqual(0.2)
  })
})

describe('ROUND-10 SOFTER EDGES — the flaw reads as a soft lens distortion, not an outlined blob', () => {
  test('rim_darken + trail_rim are MEASURABLY softer than the r9 baseline (refraction/shape untouched)', () => {
    const R9_RIM_DARKEN = 0.25 // the r9 (round-3-halved) value — dark borders read as too intense
    const R9_TRAIL_RIM = 0.18
    expect(LENS_WATER.rim_darken).toBeLessThanOrEqual(R9_RIM_DARKEN * 0.5) // at least halved
    expect(LENS_WATER.rim_darken).toBeGreaterThan(0) // still a discernible edge — just soft
    expect(LENS_WATER.trail_rim).toBeLessThanOrEqual(R9_TRAIL_RIM * 0.5)
    expect(LENS_WATER.trail_rim).toBeGreaterThan(0)
  })

  test('darken_cap bounds even worst-case overlapping rims to a soft shading, never near-black', () => {
    const R9_DARKEN_CAP = 0.85 // the old inline shader constant this replaces
    expect(LENS_WATER.darken_cap).toBeLessThanOrEqual(R9_DARKEN_CAP * 0.6)
    expect(LENS_WATER.darken_cap).toBeGreaterThan(0.25) // a flaw must still read as something, not invisible
  })
})

describe('ROUND-10 UNIVERSAL FADE — no element ever pops (every death is a smoothstep landing)', () => {
  const DT = 1 / 60 // one frame at 60fps — the granularity that's actually watched
  // Measured worst case: isolated burst ~0.074, real seeded population ~0.079 (see round-10 report); the OLD
  // accelerating burst formula measured 0.306 here — this bar cleanly separates a landing from a pop.
  const DEATH_STEP_MAX = 0.15

  /** Walks alpha_of_t from t0 to t1 at DT and returns the delta of the FIRST step that crosses from visible
   * (>1e-4) to gone (<=1e-4) — the "is this a landing or a cliff" measurement — or null if it never dies. */
  function death_step(
    /** @type {(t:number) => number} */ alpha_of_t,
    /** @type {number} */ t0,
    /** @type {number} */ t1
  ) {
    let prev = alpha_of_t(t0)
    for (let t = t0 + DT; t <= t1; t += DT) {
      const a = alpha_of_t(t)
      if (prev > 1e-4 && a <= 1e-4) return prev - a
      prev = a
    }
    return null
  }

  test('BURST collapse eases alpha to 0 (round-10: was an accelerating u² pop, now a smoothstep landing)', () => {
    const bt = 1.0
    const step = death_step((t) => burst_shape(t, bt).alpha_mul, bt - 1e-6, bt + LENS_WATER.burst_collapse + DT * 3)
    expect(step).not.toBeNull()
    expect(step).toBeLessThan(DEATH_STEP_MAX)
  })

  test('per-bead life-fade and the short-lived SPLINTER case land smoothly (size/duration independent)', () => {
    for (const lifetime of [LENS_WATER.splinter_life_min, 2.5, LENS_WATER.lifetime_min + LENS_WATER.lifetime_span]) {
      const step = death_step((t) => droplet_alpha(t, lifetime), lifetime * 0.9, lifetime + DT * 3)
      expect(step).not.toBeNull()
      expect(step).toBeLessThan(DEATH_STEP_MAX)
    }
  })

  test('TRAIL life-fade lands smoothly at end of lifetime', () => {
    for (const lifetime of [0.9, 1.5, 1.8]) {
      const step = death_step((t) => trail_life_fade(t, lifetime), lifetime * 0.9, lifetime + DT * 3)
      expect(step).not.toBeNull()
      expect(step).toBeLessThan(DEATH_STEP_MAX)
    }
  })

  test('a sampled POPULATION of real droplets + trails (seeded field, 4 seeds) never pops — every death lands', () => {
    for (const seed of [1, 7, 42, 99]) {
      const drops = build_droplets(seed)
      const trails = build_trails(drops, seed)
      for (const d of drops) {
        const step = death_step((t) => droplet_state_at(d, t).alpha, 0, LENS_WATER.max_active_s)
        if (step != null) expect(step).toBeLessThan(DEATH_STEP_MAX)
      }
      for (const tr of trails) {
        const step = death_step((t) => trail_state_at(tr, t).alpha, 0, LENS_WATER.max_active_s)
        if (step != null) expect(step).toBeLessThan(DEATH_STEP_MAX)
      }
    }
  })

  test('terminal frame law: alpha reaches EXACTLY 0 at/after death — never a residual ghost post-fade', () => {
    const bt = 1.0
    expect(burst_shape(bt + LENS_WATER.burst_collapse + 0.01, bt).alpha_mul).toBe(0)
    expect(droplet_alpha(2.5, 2.5)).toBe(0)
    expect(trail_life_fade(1.5, 1.5)).toBe(0)
  })
})
