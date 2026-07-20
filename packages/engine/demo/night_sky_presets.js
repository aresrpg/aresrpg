// NIGHT-SKY OPTION PRESETS — the three fully-styled directions the design pass renders for review to
// pick from (never picked here). Each is a complete NightSkyCfg (see src/render/sky/night_sky.js) fed to
// create_night_sky_node with with_base/with_milky_way true (the MEDIUM/HIGH night actually seen in-game).
// NEUTRAL (today's look) is imported from the engine so the neutral proof renders the SAME code the game
// ships. Once a pick is made, its values become the shipped cfg (a config swap + small follow-up) — this
// file is demo-only and never on a runtime path.
//
// The knobs (all fold to JS constants at build time — see night_sky.js):
//   base_palette      deep dome gradient (nadir/horizon/zenith), linear
//   star_thresh_shift negative = denser stars     star_bright_mul  per-tier brightness ×
//   mw_intensity/rgb/width   milky-way band peak / core colour / gaussian sigma (smaller = thinner+brighter)
//   planet_scale/count/ringed_planet   disc size × / how many (1-2) / index of a Saturn-ringed one (-1 none)
//   nebula { intensity, along_band(0 dome→1 band), orange_core(+k falloff), blue/purple/orange palette }

import { NIGHT_SKY_NEUTRAL, NIGHT_SKY_LIVE } from '../src/render/sky/night_sky.js'

/** (A) RESTRAINED-REAL — "clear mountain night". A cold, believable sky: dense but fine blue-white stars,
 *  a subtle cool milky way, ONE distant planet, and only the faintest blue haze along the band. No purple,
 *  no orange. The "I stepped outside at altitude" read — mesmerizing by depth + star count, not by colour. */
export const OPTION_A = {
  base_palette: { zenith: [0.006, 0.012, 0.035], horizon: [0.02, 0.035, 0.075], nadir: [0.006, 0.01, 0.028] },
  star_thresh_shift: -0.05,
  star_bright_mul: 1.5,
  mw_intensity: 0.28,
  mw_rgb: [0.72, 0.83, 1.0],
  mw_width: 0.14,
  planet_scale: 4.0,
  planet_count: 1,
  ringed_planet: -1,
  nebula: {
    intensity: 0.35,
    along_band: 0.9,
    orange_core: 0.0,
    orange_core_k: 4,
    blue: [0.05, 0.11, 0.3],
    purple: [0.05, 0.11, 0.3],
    orange: [0.4, 0.18, 0.05],
  },
}

/** (B) DEEP-SPACE RICH — "the space exploration panel". The literal reading of the brief: strong
 *  blue+purple nebula clouds, a warm orange galactic-core glow, the brightest/densest milky way, TWO planets
 *  one of them ringed. Maximum colour depth + wow. The risk is "too much" for a game backdrop — that is the
 *  pick's judgment call. */
export const OPTION_B = {
  base_palette: { zenith: [0.01, 0.01, 0.05], horizon: [0.05, 0.03, 0.11], nadir: [0.01, 0.01, 0.04] },
  star_thresh_shift: -0.055,
  star_bright_mul: 1.7,
  mw_intensity: 0.4,
  mw_rgb: [0.82, 0.78, 0.98],
  mw_width: 0.16,
  planet_scale: 5.0,
  planet_count: 2,
  ringed_planet: 0,
  nebula: {
    intensity: 1.1,
    along_band: 0.45,
    orange_core: 1.3,
    orange_core_k: 3.0,
    blue: [0.1, 0.16, 0.45],
    purple: [0.3, 0.1, 0.45],
    orange: [0.7, 0.3, 0.07],
  },
}

/** (C) PAINTERLY-DARK — near-black dome, a very dense FINE starfield, a thin bright milky-way ribbon, and
 *  almost no colour EXCEPT one tight deep-orange nebula pocket at the galactic core. The most restrained and
 *  the most "expensive-looking" — colour as a single deliberate accent, not a wash. Between A's realism and
 *  B's saturation. */
export const OPTION_C = {
  base_palette: { zenith: [0.003, 0.005, 0.014], horizon: [0.01, 0.014, 0.032], nadir: [0.003, 0.005, 0.014] },
  star_thresh_shift: -0.06,
  star_bright_mul: 1.5,
  mw_intensity: 0.22,
  mw_rgb: [0.95, 0.92, 0.85],
  mw_width: 0.09,
  planet_scale: 3.5,
  planet_count: 1,
  ringed_planet: -1,
  nebula: {
    intensity: 0.7,
    along_band: 0.9,
    orange_core: 1.6,
    orange_core_k: 5.0,
    blue: [0.03, 0.05, 0.14],
    purple: [0.05, 0.03, 0.14],
    orange: [0.8, 0.32, 0.06],
  },
}

// ── HYBRIDS (picked: B×C "mix... deeper, more variant, more esoteric") ─────────────────────
// Shared foundation: C's near-black dome (stars stay the hero) + B's nebula richness. Star BRIGHTNESS stays
// knee-safe (star_bright_mul 1) — DENSITY + CLUSTERING carry "more stars"; the deep-space colour comes from a
// blue→violet→magenta→ember gradient with real void↔core tonal range, not a flat wash. The three differ in how
// far each adjective is pushed. Hand-verified knee (worst in-band star+band+nebula+base): h1 1.88, h2 1.92,
// h3 1.85 — all < 2.05. Nebula regions cost ZERO extra per-pixel noise (directional falloffs over one field).

/** H1 — BALANCED. Two nebula regions (cold blue-violet field + warm ember core), gentle constellation
 *  clustering, a few red giants, a faint violet arcane wash. The safe middle of the three adjectives. */
export const HYBRID_1 = {
  base_palette: { zenith: [0.004, 0.005, 0.016], horizon: [0.011, 0.01, 0.028], nadir: [0.004, 0.005, 0.014] },
  star_thresh_shift: -0.055,
  star_bright_mul: 1.0,
  star_cluster: 0.4,
  star_red_giant: 0.04,
  mw_intensity: 0.16,
  mw_rgb: [0.8, 0.82, 0.95],
  mw_width: 0.11,
  planet_scale: 3.0,
  planet_count: 2,
  ringed_planet: 0,
  arcane_tint: { rgb: [0.05, 0.03, 0.09], amount: 0.015 },
  nebula: {
    intensity: 0.5,
    along_band: 0.5,
    orange_core: 1.3,
    orange_core_k: 4.0,
    blue: [0.05, 0.12, 0.26],
    purple: [0.22, 0.06, 0.3],
    orange: [0.62, 0.24, 0.06],
    regions: [
      { rgb: [0.1, 0.05, 0.24], k: 2.2, gain: 0.7 }, // blue-violet field
      { rgb: [0.55, 0.18, 0.1], k: 3.0, gain: 0.8 }, // ember-amber core
    ],
  },
}

/** H2 — MAX VARIANT (the picked direction). Three distinct-hue regions across the dome (cold
 *  blue-violet · warm amber-magenta · teal wisp), the widest hue spread, more red giants. Now IS the shipped
 *  default — aliased to NIGHT_SKY_LIVE (single source of truth) so the probe renders the exact live config. */
export const HYBRID_2 = NIGHT_SKY_LIVE

/** H3 — MAX ESOTERIC. Restrained colour (one arcane violet field + a tight ember pocket), a stronger violet
 *  arcane wash, STRONG clustering (constellation groupings + voids), a thin ethereal rift band. Most mystical. */
export const HYBRID_3 = {
  base_palette: { zenith: [0.005, 0.004, 0.018], horizon: [0.012, 0.009, 0.03], nadir: [0.005, 0.004, 0.016] },
  star_thresh_shift: -0.05,
  star_bright_mul: 1.0,
  star_cluster: 0.7,
  star_red_giant: 0.05,
  mw_intensity: 0.15,
  mw_rgb: [0.78, 0.8, 0.98],
  mw_width: 0.09,
  planet_scale: 2.8,
  planet_count: 2,
  ringed_planet: 0,
  arcane_tint: { rgb: [0.06, 0.03, 0.1], amount: 0.022 },
  nebula: {
    intensity: 0.45,
    along_band: 0.6,
    orange_core: 1.5,
    orange_core_k: 5.0,
    blue: [0.05, 0.09, 0.24],
    purple: [0.2, 0.05, 0.3],
    orange: [0.6, 0.22, 0.05],
    regions: [
      { rgb: [0.14, 0.05, 0.26], k: 2.2, gain: 0.8 }, // arcane violet field
    ],
  },
}

export const PRESETS = {
  neutral: NIGHT_SKY_NEUTRAL,
  a: OPTION_A,
  b: OPTION_B,
  c: OPTION_C,
  h1: HYBRID_1,
  h2: HYBRID_2,
  h3: HYBRID_3,
}
