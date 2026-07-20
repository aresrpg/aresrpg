import { test, expect, describe } from 'bun:test'

import { sun_dir_from_tod } from '../sky/sky_node.js'
import { EARTH_ATMOSPHERE } from '../sky_hillaire/atmosphere_params.js'

import {
  couple_lighting,
  sun_transmittance,
  sky_irradiance,
  extinction_at,
  luminance,
  shadow_intensity_for,
  moon_dir_of,
  is_moon_key,
  configure_night_lighting,
  current_night_lighting,
} from './sky_light_coupling.js'

// linear-rgb baseline mirroring renderer.js's tuned lights (values measured via three Color → linear).
const BASE = {
  sun_color: [1.0, 0.888, 0.723],
  sun_intensity: 3.0,
  fill_color: [1.0, 0.72, 0.48],
  fill_intensity: 1.35,
  hemi_sky: [0.503, 0.445, 0.352],
  hemi_ground: [0.309, 0.212, 0.093],
  hemi_intensity: 0.9,
}
/** @param {number} tod @returns {number[]} unit sun dir */
const dir = (tod) => {
  const v = sun_dir_from_tod(tod)
  return [v.x, v.y, v.z]
}
const rb = (c) => c[0] - c[2] // linear red − blue (>0 warm, <0 blue)

describe('extinction_at — the physical medium (mirror of physics.js sample_medium)', () => {
  test('Rayleigh makes blue extinguish more than red at sea level', () => {
    const e = extinction_at(EARTH_ATMOSPHERE, 0)
    expect(e[2]).toBeGreaterThan(e[1]) // blue > green
    expect(e[1]).toBeGreaterThan(e[0]) // green > red
  })
  test('ozone tent is zero outside its half-width, positive at the centre', () => {
    const centre = extinction_at(EARTH_ATMOSPHERE, EARTH_ATMOSPHERE.ozone_center_km)
    const far = extinction_at(EARTH_ATMOSPHERE, EARTH_ATMOSPHERE.ozone_center_km + EARTH_ATMOSPHERE.ozone_width_km + 5)
    // at the tent centre the green channel carries the ozone peak; far above it there is none.
    expect(centre[1]).toBeGreaterThan(far[1])
  })
})

describe('sun_transmittance — transmittance-filtered direct sun', () => {
  test('noon (sun near zenith) is bright and near-white, slightly warm', () => {
    const T = sun_transmittance(0.98)
    expect(luminance(T)).toBeGreaterThan(0.8)
    expect(T[0]).toBeGreaterThan(T[2]) // red transmits better than blue ⇒ warm-white
    expect(T[2]).toBeGreaterThan(0.6) // still mostly white at noon
  })
  test('low sun (near horizon) is dim and deeply reddened', () => {
    const T = sun_transmittance(0.05)
    expect(luminance(T)).toBeLessThan(0.4)
    expect(T[0]).toBeGreaterThan(T[1])
    expect(T[1]).toBeGreaterThan(T[2])
    expect(T[0] / Math.max(T[2], 1e-4)).toBeGreaterThan(4) // strong red-over-blue
  })
  test('sun below the horizon is fully extinguished (planet shadow = 0)', () => {
    expect(sun_transmittance(-0.2)).toEqual([0, 0, 0])
    expect(sun_transmittance(-0.5)).toEqual([0, 0, 0])
  })
  test('transmittance luminance is monotonically non-increasing as the sun drops', () => {
    let prev = Infinity
    for (const mu of [0.98, 0.8, 0.6, 0.4, 0.2, 0.1, 0.02]) {
      const l = luminance(sun_transmittance(mu))
      expect(l).toBeLessThanOrEqual(prev + 1e-9)
      prev = l
    }
  })
})

describe('sky_irradiance — low-order hemisphere ambient luminance', () => {
  test('noon irradiance is brighter than dusk irradiance', () => {
    const noon = luminance(sky_irradiance(dir(0.375)))
    const dusk = luminance(sky_irradiance(dir(0.72)))
    expect(noon).toBeGreaterThan(dusk)
  })
  test('night irradiance is far dimmer than noon', () => {
    expect(luminance(sky_irradiance(dir(0.85)))).toBeLessThan(0.2 * luminance(sky_irradiance(dir(0.375))))
  })
})

describe('couple_lighting — NOON is the fixed point (tuned look preserved)', () => {
  const L = couple_lighting(dir(0.375), BASE)
  test('sun colour + intensity equal the baseline at noon', () => {
    for (let i = 0; i < 3; i++) expect(L.sun_color[i]).toBeCloseTo(BASE.sun_color[i], 2)
    expect(L.sun_intensity).toBeCloseTo(BASE.sun_intensity, 2)
  })
  test('hemisphere sky + ground + intensity equal the baseline at noon', () => {
    for (let i = 0; i < 3; i++) expect(L.hemi_sky[i]).toBeCloseTo(BASE.hemi_sky[i], 2)
    for (let i = 0; i < 3; i++) expect(L.hemi_ground[i]).toBeCloseTo(BASE.hemi_ground[i], 2)
    expect(L.hemi_intensity).toBeCloseTo(BASE.hemi_intensity, 2)
  })
})

describe('couple_lighting — the sun follows the sky story', () => {
  test('the sun reddens monotonically from noon → golden → sunset', () => {
    const ratio = (tod) => {
      const c = couple_lighting(dir(tod), BASE).sun_color
      return c[0] / Math.max(c[2], 1e-4)
    }
    expect(ratio(0.7)).toBeGreaterThan(ratio(0.375)) // golden redder than noon
    expect(ratio(0.735)).toBeGreaterThan(ratio(0.7)) // sunset redder than golden
  })
  test('the sun dims from noon → golden → sunset', () => {
    const i = (tod) => couple_lighting(dir(tod), BASE).sun_intensity
    expect(i(0.7)).toBeLessThan(i(0.375))
    expect(i(0.735)).toBeLessThan(i(0.7))
  })
})

describe('shadow_intensity_for — cast shadows follow the sun and fade at the horizon', () => {
  test('full strength (≈1) while the sun is comfortably up', () => {
    expect(shadow_intensity_for(dir(0.375)[1])).toBeCloseTo(1, 5) // noon
    expect(shadow_intensity_for(0.5)).toBeCloseTo(1, 5)
  })
  test('zero at and below the horizon (no upside-down night shadows)', () => {
    expect(shadow_intensity_for(0)).toBe(0)
    expect(shadow_intensity_for(-0.2)).toBe(0)
    expect(shadow_intensity_for(dir(0.85)[1])).toBe(0) // deep night, sun below horizon
  })
  test('ramps monotonically through the dawn/dusk band [0, 0.12]', () => {
    const a = shadow_intensity_for(0.03)
    const b = shadow_intensity_for(0.06)
    const c = shadow_intensity_for(0.1)
    expect(a).toBeGreaterThan(0)
    expect(b).toBeGreaterThan(a)
    expect(c).toBeGreaterThan(b)
    expect(c).toBeLessThan(1)
  })
  test('couple_lighting returns the same shadow_intensity as the exported curve', () => {
    for (const tod of [0.28, 0.375, 0.7, 0.74, 0.85]) {
      const [, y] = dir(tod)
      expect(couple_lighting(dir(tod), BASE).shadow_intensity).toBeCloseTo(shadow_intensity_for(y), 6)
    }
  })
})

describe('grazing-band robustness — the shadow/lighting math never blows up at a low sun', () => {
  // GPU-DEATH investigation (2026-07-12): the sun-follow re-aim was suspected of a degenerate/enormous
  // shadow frustum at a grazing dusk sun (near-horizontal light ⇒ projection blow-up ⇒ NaN/huge extents ⇒
  // device loss). A headless scan of the full tod range proved the math stays finite and well-conditioned;
  // this test LOCKS that invariant for the pure functions feeding the shadow so a future edit can't
  // reintroduce a NaN/Inf at a grazing sun. (The shadow-BASIS azimuth snap in renderer.js sync_shadow is a
  // closure internal; a full-tod scan showed its worst cross-basis length ≈0.199 occurs at NOON — the sun's
  // most-overhead point — not at dusk, and never reaches 0, so the lookAt basis stays non-degenerate.)
  const finite = (n) => Number.isFinite(n)
  test('shadow_intensity_for is finite and in [0,1] across the whole sun_y sweep incl. grazing [0,0.2]', () => {
    for (let y = -0.5; y <= 1.0001; y += 0.01) {
      const s = shadow_intensity_for(y)
      expect(finite(s)).toBe(true)
      expect(s).toBeGreaterThanOrEqual(0)
      expect(s).toBeLessThanOrEqual(1)
    }
  })
  test('couple_lighting outputs stay finite + bounded for every tod, esp. the grazing dusk band 0.66–0.76', () => {
    for (let tod = 0; tod < 1; tod += 0.002) {
      const L = couple_lighting(dir(tod), BASE)
      for (const c of [L.sun_color, L.fill_color, L.hemi_sky, L.hemi_ground])
        for (const ch of c) {
          expect(finite(ch)).toBe(true)
          expect(ch).toBeGreaterThanOrEqual(0)
          expect(ch).toBeLessThanOrEqual(8) // clamped path (day_sun_color clamps to 4); never Inf/huge
        }
      for (const i of [L.sun_intensity, L.fill_intensity, L.hemi_intensity, L.shadow_intensity]) {
        expect(finite(i)).toBe(true)
        expect(i).toBeGreaterThanOrEqual(0)
      }
    }
  })
})

describe('couple_lighting — ambient never re-cyans the risers in daylight', () => {
  test('hemisphere sky colour stays warm (r ≥ b) for every above-horizon sun', () => {
    for (const tod of [0.02, 0.1, 0.2, 0.375, 0.5, 0.6, 0.7, 0.735]) {
      const hs = couple_lighting(dir(tod), BASE).hemi_sky
      expect(rb(hs)).toBeGreaterThanOrEqual(0)
    }
  })
})

describe('moon_dir_of / is_moon_key — the sun↔moon handover', () => {
  test('the moon is the antipode of the sun (unit-in ⇒ unit-out)', () => {
    const s = sun_dir_from_tod(0.375) // noon
    const m = moon_dir_of([s.x, s.y, s.z])
    expect(m[0]).toBeCloseTo(-s.x, 6)
    expect(m[1]).toBeCloseTo(-s.y, 6)
    expect(m[2]).toBeCloseTo(-s.z, 6)
    expect(Math.hypot(m[0], m[1], m[2])).toBeCloseTo(1, 6) // unit
  })
  test('by day the moon is below the horizon; at night it is above (overhead at midnight)', () => {
    expect(moon_dir_of(dir(0.375))[1]).toBeLessThan(0) // noon sun up ⇒ moon down
    expect(moon_dir_of(dir(0.875))[1]).toBeGreaterThan(0) // midnight sun down ⇒ moon up
  })
  test('the moon becomes the directional key only once the sun drops below the horizon', () => {
    expect(is_moon_key(dir(0.375)[1])).toBe(false) // noon: sun keys
    expect(is_moon_key(dir(0.5)[1])).toBe(false) // afternoon: sun keys
    expect(is_moon_key(dir(0.85)[1])).toBe(true) // night: moon keys
    expect(is_moon_key(dir(0.95)[1])).toBe(true) // deep night: moon keys
  })
})

describe('couple_lighting — night reads as blue night, not desaturated day', () => {
  const L = couple_lighting(dir(0.85), BASE)
  test('ambient goes blue (r < b) and dims to the comfort floor, never black', () => {
    expect(rb(L.hemi_sky)).toBeLessThan(0)
    expect(L.hemi_intensity).toBeGreaterThan(0.3 * BASE.hemi_intensity) // floored (legible)
    expect(L.hemi_intensity).toBeLessThan(0.6 * BASE.hemi_intensity) // but clearly night
  })
  test('the sun becomes a faint cool moonlight key (b > r, heavily dimmed)', () => {
    expect(L.sun_color[2]).toBeGreaterThan(L.sun_color[0]) // cool
    // bound lifted 0.15 → 0.3 alongside the shipped MOON_MUL_DEFAULT raise (0.13 → 0.26, pick 2026-07-19
    // "Night Look A") — still comfortably < day (1.0×), the spirit of 'faint' the original bound protected.
    expect(L.sun_intensity).toBeLessThan(0.3 * BASE.sun_intensity)
  })
})

describe('MOON_MUL_DEFAULT — shipped night-look default (pick 2026-07-19, Night Look A cell: moon_mul 0.26)', () => {
  test('the unconfigured default moon_mul is 0.26 (was 0.13 pre-ship)', () => {
    expect(current_night_lighting().moon_mul).toBe(0.26)
  })
})

describe('configure_night_lighting — the taste dial (2026-07-19; default byte-identical)', () => {
  test('raising moon_mul + ambient_night_floor lifts the night key + ambient; reset restores the shipped default', () => {
    const base_night = couple_lighting(dir(0.85), BASE) // computed with the byte-identical defaults (0.26 / 0.5)
    configure_night_lighting({ moon_mul: 0.3, ambient_night_floor: 0.58 })
    expect(current_night_lighting()).toEqual({ moon_mul: 0.3, ambient_night_floor: 0.58 })
    const lifted = couple_lighting(dir(0.85), BASE)
    expect(lifted.sun_intensity).toBeGreaterThan(base_night.sun_intensity) // brighter moonlight key (terrain form)
    expect(lifted.hemi_intensity).toBeGreaterThan(base_night.hemi_intensity) // brighter ambient floor
    expect(lifted.fill_intensity).toBeGreaterThan(base_night.fill_intensity) // the back-fill tracks the moon key too
    // RESET to the shipped baseline so no other test/file inherits the raised dials (module state is process-global in bun).
    configure_night_lighting({ moon_mul: 0.26, ambient_night_floor: 0.5 })
    expect(current_night_lighting()).toEqual({ moon_mul: 0.26, ambient_night_floor: 0.5 })
    // the DEFAULT night stays 'faint' (< 0.3× the day sun) — the frozen invariant a baked candidate would breach.
    expect(couple_lighting(dir(0.85), BASE).sun_intensity).toBeLessThan(0.3 * BASE.sun_intensity)
    // null/omitted keeps the current values (no throw, no change).
    configure_night_lighting()
    expect(current_night_lighting()).toEqual({ moon_mul: 0.26, ambient_night_floor: 0.5 })
  })
})
