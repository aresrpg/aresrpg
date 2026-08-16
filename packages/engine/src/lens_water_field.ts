// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// LENS WATER — FIELD MATH (lossless port of deprecated/engine lens_water_field.js). Pure,
// seed-driven CPU twins the GPU graph in lens_water.ts mirrors term-for-term: the wet-sheet →
// fragmenting regions → bursting beads/splinters/trails → dry lifecycle that plays on the
// camera glass when it exits the water. THE FLUID LAW: at any frozen frame, no straight edge
// and no recognizable geometric shape — meandering trails, amorphous bead silhouettes, ragged
// caps. Everything eases (smoothstep landings, never a pop) and finishes inside the 3.5s park.
//
// SCREEN-Y CONVENTION: WebGPU screenUV.y = 0 at the TOP of the frame, so +y = DOWN-screen —
// beads slide down as y0 + slide·t and trails run down from their burst point.

/** Tuning knobs (screen-space fractions / seconds unless noted) — the legacy owner-graded
 * calibration, carried verbatim. Density/burst/trail groups are the redial axes. */
export const LENS_WATER = Object.freeze({
  // ── bead field: dense onset, front-loaded, thinning as bursts eat it ──
  count: 48,
  count_low: 24,
  tau: 1.7, // global intensity exponential decay (s)
  birth_spread: 0.2,
  birth_fade: 0.08,
  lifetime_min: 2.0,
  lifetime_span: 0.9,
  radius_min: 0.004,
  radius_span: 0.013,
  slide_min: 0.004,
  slide_span: 0.045,
  sway_amp: 0.009,
  // ── burst: a bubble pops — brief swell then eased collapse, staggered across the window ──
  burst_fraction: 0.55, // size-biased: blobs mostly pop (→ trails), dots mostly survive
  burst_min: 0.3,
  burst_span: 1.2,
  burst_swell: 0.12,
  burst_swell_scale: 1.35,
  burst_collapse: 0.1,
  // ── splinters: tiny short-lived ejecta thrown outward by a burst ──
  splinter_slots: 14,
  splinter_radius_span: 0.004,
  splinter_life_min: 0.35,
  splinter_life_span: 0.35,
  splinter_slide: 0.05,
  pop_dist_min: 0.015,
  pop_dist_span: 0.03,
  pop_up: 0.02,
  pop_tau: 0.12,
  // ── trails: finite water columns running down from the heaviest bursts ──
  trail_slots: 8,
  trail_len_min: 0.16,
  trail_len_span: 0.34,
  trail_grow: 0.7,
  trail_width: 0.02,
  trail_meander: 0.018,
  trail_width_var: 0.55,
  trail_rag: 0.012,
  trail_cap: 0.02,
  trail_drag: 0.4,
  trail_crest: 0.14,
  trail_crest_w: 0.35,
  trail_rim: 0.08,
  trail_life_min: 0.9,
  trail_life_span: 0.9,
  trail_fade_in: 0.12,
  // ── film + the wet sheet: the film owns the opening beat, then fragments into regions ──
  film_amp: 0.006,
  sheet_amp: 0.02,
  sheet_hold: 0.45,
  sheet_fade: 0.9,
  sheen_strength: 0.1,
  film_flow_speed: 0.3,
  film_freq: [5.0, 3.4, 8.0],
  film_down_bias: 1.05,
  patch_gain: 0.25,
  edge_gain: 0.3,
  drain_start: 0.9,
  drain_speed: 1.36,
  drain_band: 0.14,
  finger_amp: 0.12,
  finger_freq: [9.7, 23.0],
  region_band: 0.18,
  region_end: 2.1,
  feature_lag: 0.3, // features see the region field this many s behind the film (remnants)
  // ── lens kernel (the per-bead / per-trail glass dome) ──
  refract_eta: 1.3, // just above 1: a real lens but a gentle bend — mini-image chrome is banned
  edge_softness: 0.4,
  mask_lo: 0.86,
  mask_hi: 1.02,
  meniscus_amp: 0.16,
  meniscus_freq: 2.6,
  rim_darken: 0.1,
  darken_cap: 0.45, // summed rim darken ceiling — a soft flaw, never a black outline
  glint_dir: [-0.66, 0.75],
  glint_offset: 0.42,
  glint_width: 0.18,
  glint_strength: 0.18,
  max_active_s: 3.5, // hard idle-out — every bead/splinter/trail is finished by here
  flip_y: false,
})

export type Droplet = Readonly<{
  x0: number
  y0: number
  birth: number
  lifetime: number
  radius: number
  burst_at: number
  slide: number
  sway_phase: number
  sway_freq: number
  surge_amp: number
  surge_freq: number
  surge_phase: number
  pop_x: number
  pop_y: number
}>

export type Trail = Readonly<{ x: number; y_top: number; birth: number; max_len: number; lifetime: number }>

/** Deterministic pseudo-random in [0,1) — pure fract(sin) family; `salt` fans one seed into
 * decorrelated per-bead streams. */
export const rand01 = (seed: number, salt: number): number => {
  const s = Math.sin(seed * 12.9898 + salt * 78.233) * 43_758.5453
  return s - Math.floor(s)
}

/** Global intensity envelope: 1 at the splash, exponential decay; null = inactive ⇒ 0. */
export const decay_intensity = (t_since_splash: number | null | undefined, tau = LENS_WATER.tau): number => {
  if (t_since_splash == null || !Number.isFinite(t_since_splash) || t_since_splash < 0) return 0
  return Math.exp(-t_since_splash / tau)
}

/** Top-first macro drain-front position (uv; negative = not started ⇒ fully wet). */
export const film_front_y = (t: number): number => (t - LENS_WATER.drain_start) * LENS_WATER.drain_speed

/** Sheet envelope: 1 through `sheet_hold` (the whole lens is water), then smoothstep → 0 over
 * `sheet_fade` — the "looking through water" beat that recedes as the sheet breaks. */
export const sheet_envelope = (t: number): number => {
  if (t <= LENS_WATER.sheet_hold) return 1
  const u = Math.min(1, (t - LENS_WATER.sheet_hold) / LENS_WATER.sheet_fade)
  return 1 - u * u * (3 - 2 * u)
}

/** The film's distortion amplitude at time t: sheet_amp at the surface moment, receding to the
 * subtle film_amp base. */
export const film_amp_at = (t: number): number =>
  LENS_WATER.film_amp + (LENS_WATER.sheet_amp - LENS_WATER.film_amp) * sheet_envelope(t)

/** Wet-region noise ∈ [0,1]: 3-octave 2-axis sin·cos value-noise whose iso-contours are the wet
 * patches' borders — blobby fluid shapes, never a band. The /2.6 maps the measured practical
 * range (~[−1.6, 1.3]) onto [0,1] with soft saturation. */
export const region_noise = (x: number, y: number): number => {
  const n =
    Math.sin(x * 6.3 + 1.7) * Math.cos(y * 5.1 + 0.4) +
    Math.sin(x * 13.1 + y * 3.7 + 2.9) * Math.cos(y * 11.7 - x * 2.3 + 1.1) * 0.55 +
    Math.sin(x * 27.9 - y * 7.1 + 4.2) * Math.cos(y * 23.3 + x * 5.9) * 0.3
  return Math.min(1, Math.max(0, n / 2.6 + 0.5))
}

/** The receding coverage cut: ≤ −region_band through the sheet hold (everything wet), fully
 * past the noise range by `region_end` (everything dry). */
export const region_cut = (t: number): number => {
  const p = Math.min(1, Math.max(0, (t - LENS_WATER.sheet_hold) / (LENS_WATER.region_end - LENS_WATER.sheet_hold)))
  return -LENS_WATER.region_band + p * (1 + 2 * LENS_WATER.region_band)
}

/** Regional wetness at (x, y, t) ∈ [0,1] — drives the film's coverage AND (lagged by
 * feature_lag) every feature's existence gate. Smoothstep borders: a region drying out fades
 * its residents rather than cutting them. */
export const region_level = (x: number, y: number, t: number): number => {
  const cut = region_cut(t)
  const n = region_noise(x, y)
  const u = Math.min(1, Math.max(0, (n - cut) / LENS_WATER.region_band))
  return u * u * (3 - 2 * u)
}

/** Per-bead hard lifetime out-fade: holds through 70% of `lifetime`, then smoothstep-tails to
 * exactly 0 — guarantees a bead fully disappears, with zero slope at the death instant. */
export const droplet_life_fade = (t_local: number, lifetime: number): number => {
  if (t_local <= 0) return 1
  if (t_local >= lifetime) return 0
  const fade_start = lifetime * 0.7
  if (t_local <= fade_start) return 1
  const u = (t_local - fade_start) / (lifetime - fade_start)
  return 1 - u * u * (3 - 2 * u)
}

/** Full birth→death alpha envelope: quick fade-IN over `birth_fade` (late-born splinters never
 * pop on), then the out-fade. */
export const droplet_alpha = (t_local: number, lifetime: number): number => {
  if (t_local <= 0 || t_local >= lifetime) return 0
  const fade_in = Math.min(1, t_local / LENS_WATER.birth_fade)
  return fade_in * droplet_life_fade(t_local, lifetime)
}

/** A burst's radius/alpha multipliers around `burst_at`: a brief smoothstep swell then an eased
 * collapse (zero slope at u=1 — a fade landing, never a single-frame pop). Non-finite
 * `burst_at` ⇒ {1, 1} always. */
export const burst_shape = (t_local: number, burst_at: number): Readonly<{ radius_mul: number; alpha_mul: number }> => {
  if (!Number.isFinite(burst_at) || t_local < burst_at - LENS_WATER.burst_swell) return { radius_mul: 1, alpha_mul: 1 }
  if (t_local < burst_at) {
    const u = (t_local - (burst_at - LENS_WATER.burst_swell)) / LENS_WATER.burst_swell
    const e = u * u * (3 - 2 * u)
    return { radius_mul: 1 + e * (LENS_WATER.burst_swell_scale - 1), alpha_mul: 1 }
  }
  if (t_local < burst_at + LENS_WATER.burst_collapse) {
    const u = (t_local - burst_at) / LENS_WATER.burst_collapse
    const e = u * u * (3 - 2 * u)
    return { radius_mul: LENS_WATER.burst_swell_scale * (1 - e), alpha_mul: 1 - e }
  }
  return { radius_mul: 0, alpha_mul: 0 }
}

/** Builds one activation's deterministic field: `primary_count` scattered beads (rand²-biased
 * radii, size-correlated slide, size-biased burst roll) followed by `splinter_count` ejecta
 * assigned round-robin to bursting parents (born AT the parent's burst; inert if none burst). */
export const build_droplets = (
  seed: number,
  primary_count: number = LENS_WATER.count,
  splinter_count: number = LENS_WATER.splinter_slots
): readonly Droplet[] => {
  const primaries = Array.from({ length: primary_count }, (_, i) => {
    const r = rand01(seed, i * 13 + 6)
    const radius = LENS_WATER.radius_min + r * r * LENS_WATER.radius_span
    const size_t = (radius - LENS_WATER.radius_min) / LENS_WATER.radius_span
    // size-biased burst: a dot pops ~28% of the time, a blob ~82%
    const bursts = rand01(seed, i * 13 + 10) < LENS_WATER.burst_fraction * (0.5 + size_t)
    return {
      x0: 0.02 + rand01(seed, i * 13 + 2) * 0.96, // fully random — Poisson clumping is the chaos
      y0: 0.05 + rand01(seed, i * 13 + 3) * 0.85,
      birth: rand01(seed, i * 13 + 4) * LENS_WATER.birth_spread,
      lifetime: LENS_WATER.lifetime_min + rand01(seed, i * 13 + 5) * LENS_WATER.lifetime_span,
      radius,
      burst_at: bursts ? LENS_WATER.burst_min + rand01(seed, i * 13 + 11) * LENS_WATER.burst_span : Infinity,
      slide: (LENS_WATER.slide_min + size_t * LENS_WATER.slide_span) * (0.6 + rand01(seed, i * 13 + 7) * 0.8),
      sway_phase: rand01(seed, i * 13 + 8) * Math.PI * 2,
      sway_freq: 1.5 + rand01(seed, i * 13 + 9) * 2.5,
      // surge (wavy-time fall): amp·freq < 1 ⇒ descent slows/rushes, never reverses
      surge_amp: 0.08 + rand01(seed, i * 13) * 0.12,
      surge_freq: 1.5 + rand01(seed, i * 13 + 1) * 2,
      surge_phase: rand01(seed, i * 13 + 12) * Math.PI * 2,
      pop_x: 0,
      pop_y: 0,
    }
  })
  const bursting = primaries.filter((d) => Number.isFinite(d.burst_at))
  const splinters = Array.from({ length: splinter_count }, (_, s) => {
    const parent = bursting.length > 0 ? bursting[s % bursting.length]! : null
    const bt = parent ? parent.burst_at : LENS_WATER.max_active_s + 1 // no parent ⇒ never born
    const ang = rand01(seed, s * 11 + 101) * Math.PI * 2
    const dist = LENS_WATER.pop_dist_min + rand01(seed, s * 11 + 102) * LENS_WATER.pop_dist_span
    return {
      x0: parent ? parent.x0 : 0.5,
      y0: parent ? parent.y0 + parent.slide * bt : 0.5, // the parent's position at its burst
      birth: bt,
      lifetime: LENS_WATER.splinter_life_min + rand01(seed, s * 11 + 103) * LENS_WATER.splinter_life_span,
      radius: LENS_WATER.radius_min + rand01(seed, s * 11 + 104) * LENS_WATER.splinter_radius_span,
      burst_at: Infinity,
      slide: LENS_WATER.splinter_slide * (0.7 + rand01(seed, s * 11 + 105) * 0.6),
      sway_phase: rand01(seed, s * 11 + 106) * Math.PI * 2,
      sway_freq: 2 + rand01(seed, s * 11 + 107) * 3,
      surge_amp: 0.05 + rand01(seed, s * 11 + 108) * 0.08,
      surge_freq: 2 + rand01(seed, s * 11 + 109) * 2,
      surge_phase: rand01(seed, s * 11 + 110) * Math.PI * 2,
      pop_x: Math.cos(ang) * dist, // outward throw (eases out over pop_tau)
      pop_y: Math.sin(ang) * dist - LENS_WATER.pop_up, // biased up at the pop, then gravity
    }
  })
  return [...primaries, ...splinters]
}

/** One droplet's current (x, y, radius, alpha) at elapsed time `t` — packed per frame into the
 * uniformArray the shader reads. Fluid path: 2-octave lateral wander + surging (wavy-time,
 * never-uphill) descent; splinters ease outward from their pop point then fall; bursting beads
 * swell then collapse. Alpha gated by the lagged regional wetness at the droplet's position. */
export const droplet_state_at = (
  drop: Droplet,
  t: number
): Readonly<{ x: number; y: number; radius: number; alpha: number }> => {
  const tb = t - drop.birth
  if (tb < 0) return { x: drop.x0, y: drop.y0, radius: drop.radius, alpha: 0 }
  const w1 = Math.sin(tb * drop.sway_freq + drop.sway_phase)
  const w2 = Math.sin(tb * drop.sway_freq * 2.37 + drop.sway_phase * 1.7)
  const sway = (w1 + w2 * 0.6) * LENS_WATER.sway_amp * Math.min(1, tb)
  const fall = tb + (Math.sin(tb * drop.surge_freq + drop.surge_phase) - Math.sin(drop.surge_phase)) * drop.surge_amp
  const pop = drop.pop_x || drop.pop_y ? 1 - Math.exp(-tb / LENS_WATER.pop_tau) : 0
  const burst = burst_shape(tb, drop.burst_at)
  const x = drop.x0 + sway + drop.pop_x * pop
  const y = drop.y0 + drop.slide * fall + drop.pop_y * pop
  return {
    x,
    y,
    radius: drop.radius * burst.radius_mul,
    alpha: droplet_alpha(tb, drop.lifetime) * burst.alpha_mul * region_level(x, y, t - LENS_WATER.feature_lag),
  }
}

/** A trail's in/out alpha envelope: fade-in over `trail_fade_in`, hold through 55% of
 * `lifetime`, then a smoothstep tail — a few long trails survive into the sparse tail. */
export const trail_life_fade = (t_local: number, lifetime: number): number => {
  if (t_local <= 0 || t_local >= lifetime) return 0
  const fade_in = Math.min(1, t_local / LENS_WATER.trail_fade_in)
  const fade_start = lifetime * 0.55
  if (t_local <= fade_start) return fade_in
  const u = (t_local - fade_start) / (lifetime - fade_start)
  return fade_in * (1 - u * u * (3 - 2 * u))
}

/** Builds the trails: the heaviest bursting beads each release a finite water column anchored
 * at their burst point. Fixed slot count (constant uniformArray size); unfilled slots inert. */
export const build_trails = (
  drops: readonly Droplet[],
  seed: number,
  trail_count: number = LENS_WATER.trail_slots
): readonly Trail[] => {
  const heavy = [...drops.filter((d) => Number.isFinite(d.burst_at))].sort((a, b) => b.radius - a.radius)
  return Array.from({ length: trail_count }, (_, s) => {
    const parent = heavy[s]
    if (!parent) return { x: 0.5, y_top: 0.5, birth: LENS_WATER.max_active_s + 1, max_len: 0, lifetime: 0 }
    return {
      x: parent.x0,
      y_top: parent.y0 + parent.slide * parent.burst_at, // anchored where the bubble popped
      birth: parent.burst_at,
      max_len: LENS_WATER.trail_len_min + rand01(seed, s * 17 + 200) * LENS_WATER.trail_len_span,
      lifetime: LENS_WATER.trail_life_min + rand01(seed, s * 17 + 201) * LENS_WATER.trail_life_span,
    }
  })
}

/** One trail's current (x, y_top, length, alpha): runs down from its burst point to `max_len`
 * over `trail_grow`, alpha gated by the lagged regional wetness at its midpoint. */
export const trail_state_at = (
  trail: Trail,
  t: number
): Readonly<{ x: number; y_top: number; length: number; alpha: number }> => {
  const tb = t - trail.birth
  if (tb < 0 || tb >= trail.lifetime) return { x: trail.x, y_top: trail.y_top, length: 0, alpha: 0 }
  const length = trail.max_len * Math.min(1, tb / LENS_WATER.trail_grow)
  const region = region_level(trail.x, trail.y_top + length * 0.5, t - LENS_WATER.feature_lag)
  return { x: trail.x, y_top: trail.y_top, length, alpha: trail_life_fade(tb, trail.lifetime) * region }
}

// ── fluid geometry (pure twins of the shader's per-pixel trail/silhouette math) ──

/** Meandering centreline at screen y: three incommensurate octaves, phases decorrelated per
 * trail — the stream S-bends past its own width; no traceable straight stroke. */
export const trail_center_x = (x_base: number, y: number): number => {
  const p = x_base * 43.75
  return (
    x_base +
    (Math.sin(y * 9.1 + p) + Math.sin(y * 23.3 + p * 1.93) * 0.55 + Math.sin(y * 47.7 + p * 3.1) * 0.3) *
      LENS_WATER.trail_meander
  )
}

/** Half-width at screen y: pinches and bulges (±trail_width_var), strictly positive. */
export const trail_halfwidth = (x_base: number, y: number): number => {
  const q = x_base * 61.3
  const v = Math.sin(y * 13.7 + q) * 0.6 + Math.sin(y * 31.9 + q * 2.3) * 0.4
  return LENS_WATER.trail_width * (1 + v * LENS_WATER.trail_width_var)
}

/** Ragged head/tail cap y-offset across x — the caps are never straight horizontal cuts. */
export const trail_edge_rag = (x: number, x_base: number, tail = false): number => {
  const p = x_base * (tail ? 142.95 : 87.7)
  return (Math.sin(x * 83 + p) + Math.sin(x * 197 + p * 2.7) * 0.5) * LENS_WATER.trail_rag
}

/** A bead's silhouette perturbation (±1.65): two incommensurate sin·cos octaves — an amorphous
 * blob outline, never a clean circle. r_eff = R·(1 + bump·meniscus_amp) stays > 0. */
export const meniscus_bump = (ux: number, uy: number, sx: number, sy: number): number =>
  Math.sin(ux * LENS_WATER.meniscus_freq + sx * 31) * Math.cos(uy * LENS_WATER.meniscus_freq + sy * 27) +
  Math.sin(ux * 6.7 + sy * 53) * Math.cos(uy * 5.3 + sx * 47) * 0.65
