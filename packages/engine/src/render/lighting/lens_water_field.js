// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// LENS WATER — FIELD MATH (pure CPU twins the GPU shader reads verbatim). Split out of lens_water.js at
// round-7 (the burst/splinter/trail lifecycle pushed the pass past 600 LoC): this module owns the DATA
// (the LENS_WATER knobs) and the pure, seed-driven, unit-tested functions; lens_water.js owns the TSL
// node graph that renders their packed output. Everything here is flat math (no THREE, no GPU) so the
// whole file is directly testable and the shader stays a faithful mirror of these formulas.
//
// ROUND-7 REQUIREMENT: the underwater-exit effect needs more than isolated bubbles — the same wet-glass look,
// but bursting, with way more water, as isolated bubbles or long trails. So the exit gains VOLUME + a
// LIFECYCLE on top of the round-6 wet-glass beads:
//   • WAY MORE WATER at onset — a denser bead field (count ~2× round-6), front-loaded, thinning as it goes.
//   • BURSTING — most (size-biased) beads POP mid-decay: a brief radius SWELL then a fast COLLAPSE
//     (radius→0, alpha→0). Bursts are staggered across the window so the field feels alive.
//   • SPLINTERS — a burst throws off a few tiny short-lived ejecta droplets (outward pop, then gravity).
//   • TRAILS — the heaviest bursting beads release a finite water COLUMN running DOWN from the burst point
//     (irregular length/position — the consequence of a specific bubble, never a uniform lane).
//   • ISOLATED bubbles — the non-bursting remainder slide/fade as in round-6.
// The composition falls out of the lifecycle: dense burst-heavy chaos → bursts thin the field → survivors
// + a few long trails → dry. Everything finishes inside the unchanged ~3.5s park (see the worst-case tests).
//
// ROUND-8 REQUIREMENT: the round-7 trails read too linear — no detectable straight lines or recognizable
// shapes; flowing, irregular patches instead, because water is fluid. THE FLUID LAW: at any frozen frame,
// no straight edge and no recognizable geometric shape in the water.
//   • TRAILS meander: a 3-octave centreline wander PAST the column's own width, pinch-and-bulge width,
//     ragged head/tail caps, and a crest broken into flowing patches — a wandering wet stream, not a stroke.
//   • BEAD paths curve: 2-octave lateral wander + a SURGING descent (wavy-time fall — speed varies along
//     the way, never uphill).
//   • SILHOUETTES are amorphous: a 2-octave meniscus warp (±~26% of R) — never a clean circle/capsule.
// The fluid geometry lives in the pure twins at the bottom (trail_center_x / trail_halfwidth /
// trail_edge_rag / meniscus_bump): the tests pin them, the capture renders THROUGH them, and the TSL
// graph mirrors them term-for-term.
//
// ROUND-9 REQUIREMENT: round-8 showed clear strips of water while the rest of the camera lens stayed dry —
// inconsistent; water should cover the lens, not appear as isolated strips. THE WET SHEET PHASE: emerging
// from water the ENTIRE lens is wet, then the sheet breaks up; features must never read as isolated water
// on a dry pane:
//   • t=0: the film owns the opening beat — a STRONG full-frame wobble (sheet_amp ≈ 3× the old whisper
//     base) + a specular sheen glisten: unmistakably "looking through water", not a hint.
//   • BREAKUP (~0.45→1.35s): sheet_envelope recedes the amp to the r4 subtle base while the wet coverage
//     FRAGMENTS through a multi-octave noise REGION field (region_level) — irregular fluid patches
//     shrinking as a rising cut sweeps the noise range. The old sin stream COLUMNS (straight vertical
//     bands — exactly what round-8 outlawed) are DELETED, replaced by these regions. The top-first macro
//     drain front is unchanged.
//   • REMNANTS: every bead/trail's alpha is gated by region_level at its own position, LAGGED by
//     feature_lag (a droplet is what the sheet leaves behind — it briefly outlives the film there), so
//     features live inside/at the edge of wet regions and the last survivors die with the last patches,
//     all inside the unchanged 3.5s park. One fluid system: sheet → fragments → droplets → dry.
//
// ROUND-10 REQUIREMENT (against live r9): the dark borders of the flaws read too intense, and features
// should fade out instead of being removed abruptly after a fixed lifetime. SOFT EDGES + A UNIVERSAL FADE:
//   • EDGE DARKENING SOFTENED — `rim_darken` 0.25→0.1 and `trail_rim` 0.18→0.08 (both ~60% cut), plus a new
//     `darken_cap` 0.45 (was an inline 0.85 in lens_water.js) so even heavy rim overlap never reads as a
//     black outline — the flaw stays a soft lens distortion; refraction/shape (eta, mask, meniscus) untouched.
//   • NO POP, EVER — the one real offender was `burst_shape`'s collapse: an accelerating `u²` ease (its own
//     comment said so — "the pop accelerates") whose LAST frame dropped alpha ~31% in one step. Swapped for
//     the smoothstep `u²(3−2u)` its own swell-in and `droplet_life_fade`/`trail_life_fade` already used:
//     zero slope at the death instant, a landing instead of a cliff (measured last-frame drop now ~7%).
//     The r9 region gate (`region_level`) was measured ALREADY a proper smoothstep landing (max ~11%/frame,
//     confirmed, not changed) — a region drying out fades its residents rather than cutting them. New tests
//     pin the last-frame delta near every death (burst/life-fade/region/population) so this never regresses.
//
// SCREEN-Y CONVENTION (round-6 flip, confirmed, unchanged): live renders are WebGPU —
// WGSLNodeBuilder.isFlipY() = false, so screenUV.y = 0 at the TOP of the frame. Therefore +y = DOWN-screen:
// beads/splinters slide down as y0 + slide·t and trails run down from their burst y.

/** Tuning knobs (screen-space fractions / seconds unless noted) — tunable at runtime via `window.__lens_water`.
 * ROUND-7 law: the exit is a BURST LIFECYCLE — dense field → bursts (swell→collapse) shedding splinters &
 * trails → sparse survivors → dry. Redial vocabulary lives in the report; the density/burst/trail groups
 * below are the axes ("denser/sparser", "more/fewer bursts", "longer/shorter trails"). */
export const LENS_WATER = Object.freeze({
  // ── BEAD FIELD (round-6 base; round-7 count ≈2× for "way more water" at onset, front-loaded) ──
  count: 48, // primary droplets — the dense onset field (round-6 was 26; ~1.85× = the ask for "way more water")
  count_low: 24, // LOW tier — same field, fewer bead loop iterations (mirrors underwater's tier ladder)
  tau: 1.7, // global intensity exponential decay (s) — round-3 law, unchanged since
  birth_spread: 0.2, // beads stagger their first appearance across this window (s) — tight so the onset fills fast
  birth_fade: 0.08, // every bead fades IN over this (s) so a late-born splinter/bead never POPS on (round-7)
  lifetime_min: 2.0, // per-bead hard lifetime floor (s) — the non-bursting survivors ride this out
  lifetime_span: 0.9, // + jitter (s) → isolated-bead lifetime ∈ [2.0, 2.9]; + birth ≤ 3.1s < the park
  radius_min: 0.004, // smallest bead radius (screen-fraction) — the tiny dots
  radius_span: 0.013, // + rand²-biased jitter → radius ∈ [0.004, 0.017]: many dots, a few big blobs
  slide_min: 0.004, // slowest bead slide-down speed (uv/s) — small dots basically stick
  slide_span: 0.045, // + size-correlated span (uv/s): the biggest blobs RUN down the glass (still slow, never rain)
  sway_amp: 0.009, // lateral wander amplitude (uv) — round-8: TWO octaves ride it (max ×1.6): paths CURVE, never a line
  // ── BURST (round-7): a bubble pops — a brief swell then a fast collapse; staggered across the window ──
  burst_fraction: 0.55, // base burst probability — SIZE-BIASED so blobs mostly pop (→ trails), dots mostly survive
  burst_min: 0.3, // earliest burst (s since activation) …
  burst_span: 1.2, // … + jitter → bursts staggered across [0.3, 1.5]s (the field pops alive over time)
  burst_swell: 0.12, // radius swells over this lead-in before the pop (s)
  burst_swell_scale: 1.35, // peak swell (× radius) at the instant of the pop
  burst_collapse: 0.1, // swell → ~0 radius and alpha → 0 over this (s) — round-10: eased to a fade, not a pop
  // ── SPLINTERS (round-7): ejecta — a burst throws off a few tiny short-lived droplets ──
  splinter_slots: 14, // fixed ejecta budget, packed alongside the beads (one flat GPU loop)
  splinter_radius_span: 0.004, // splinter radius ∈ [radius_min, radius_min + this] — tiny
  splinter_life_min: 0.35, // short-lived …
  splinter_life_span: 0.35, // … ∈ [0.35, 0.7]s
  splinter_slide: 0.05, // ejecta falls faster than a stuck dot (uv/s), jittered per splinter
  pop_dist_min: 0.015, // outward ejecta throw distance (uv) …
  pop_dist_span: 0.03, // … ∈ [0.015, 0.045]
  pop_up: 0.02, // ejecta biased slightly UP (uv; −y is up-screen) at the pop before gravity takes over
  pop_tau: 0.12, // the outward throw eases out over this (s), then slide (gravity) dominates
  // ── TRAILS (round-7): bead-fed finite water columns running DOWN from a burst ──
  trail_slots: 8, // fixed trail budget; fed by the HEAVIEST bursting beads ("heavy beads release a trail")
  trail_len_min: 0.16, // shortest trail (uv) …
  trail_len_span: 0.34, // … + jitter → irregular lengths ∈ [0.16, 0.5] (never a uniform column lane)
  trail_grow: 0.7, // the trail runs DOWN to its full length over this (s)
  trail_width: 0.02, // trail half-width base (uv) — a narrow stream (round-8: the width VARIES along the path)
  trail_meander: 0.018, // centreline wander amplitude (uv) — 3 octaves (round-8): the stream S-bends PAST its own width
  trail_width_var: 0.55, // pinch-and-bulge depth (fraction of trail_width) — never a constant-width capsule
  trail_rag: 0.012, // ragged head/tail edge depth (uv) — the caps are never straight horizontal cuts (round-8)
  trail_cap: 0.02, // soft head/tail cap length (uv) — the trail emerges rounded and its tip fades
  trail_drag: 0.4, // downward sampling drag inside the column (fraction of trail_width) — the "water running" read
  trail_crest: 0.14, // specular crest brightness down the centre (the wet catch-light) — additive, tiny
  trail_crest_w: 0.35, // crest gaussian width (fraction of trail_width)
  trail_rim: 0.08, // thin dark rim at the column edges (multiplicative) — round-10: 0.18→0.08, soft not harsh
  trail_life_min: 0.9, // trail persists at least this (s) …
  trail_life_span: 0.9, // … ∈ [0.9, 1.8]; worst: burst 1.5 + life 1.8 = 3.3 < the 3.5 park (pinned in a test)
  trail_fade_in: 0.12, // trail fades in over this (s)
  // ── FILM + THE WET SHEET (round-9: the film owns the opening beat, then fragments into regions) ──
  film_amp: 0.006, // BASE film distortion (uv) — the r4 subtle band; what the sheet recedes TO
  sheet_amp: 0.02, // OPENING distortion (uv) — the full-frame "looking through water" wobble at t=0
  sheet_hold: 0.45, // the whole frame stays fully wet this long (s) — the sheet phase
  sheet_fade: 0.9, // sheet_amp → film_amp over this (s) after the hold (sheet fully receded ≈1.35s)
  sheen_strength: 0.1, // additive specular glisten inside wet regions — strongest during the sheet phase
  film_flow_speed: 0.3, // downward advection of the distortion pattern (uv/s)
  film_freq: [5.0, 3.4, 8.0], // wide organic wavelengths (cycles/frame) of the 2-axis noise field
  film_down_bias: 1.05, // constant downward component of the film offset (fraction of amp)
  patch_gain: 0.25, // organic coverage modulation depth (the film is graded by a wide noise mask, never flat)
  edge_gain: 0.3, // extra film amplitude toward the frame edges
  drain_start: 0.9, // the film is omnipresent this long (s) before the drying front starts sweeping
  drain_speed: 1.36, // front sweep rate (uv/s)
  drain_band: 0.14, // softness of the drying front (uv)
  finger_amp: 0.12, // the front edge breaks into organic fingers of this depth (uv)
  finger_freq: [9.7, 23.0], // finger break-up spatial rates across x
  // round-9 REGION field (replaces the sin stream COLUMNS — straight bands violated the fluid law):
  region_band: 0.18, // softness of the wet-region iso-edge (noise units) — fluid patch borders, never hard
  region_end: 2.1, // the region cut has swept the whole noise range by here (s) — film fully fragmented away
  feature_lag: 0.3, // beads/trails see the region field this many s BEHIND the film (remnants outlive their sheet)
  // ── LENS KERNEL (the per-bead / per-trail glass dome — round-3 laws unchanged) ──
  refract_eta: 1.3, // dome gain, JUST above 1: a real lens but a GENTLE bend (2.2's mini-image = chrome, banned)
  edge_softness: 0.4, // dome focal guard as a fraction of R — floors √(R²−dist²), caps the rim bend
  mask_lo: 0.86, // meniscus mask: full lens inside this local radius …
  mask_hi: 1.02, // … ramping to 0 (a thin, near-hard wet edge) by here
  meniscus_amp: 0.16, // silhouette warp depth (± fraction of R, ×1.65 octaves) — round-8: AMORPHOUS blobs, never circles
  meniscus_freq: 2.6, // octave-1 spatial rate of that warp (flat sin·cos — no atan, naga-safe; octave 2 in meniscus_bump)
  rim_darken: 0.1, // MULTIPLICATIVE darkening peak of the thin meniscus ring (round-3 halved; round-10: 0.25→0.1, soft)
  darken_cap: 0.45, // ROUND-10 (was an inline 0.85 in lens_water.js): ceiling on the SUMMED bead+trail rim
  // darken so heavy overlap never reads as a near-black outline — a soft flaw, never a blob
  glint_dir: [-0.66, 0.75], // unit screen-space direction of the single specular highlight (up-left key light)
  glint_offset: 0.42, // glint distance from the bead centre (fraction of R)
  glint_width: 0.18, // glint gaussian width (fraction of R) — a tiny dot, not a disc
  glint_strength: 0.18, // additive peak of that one glint (round-3: tiny — never the subject)
  max_active_s: 3.5, // hard idle-out — past this the film is drained and every bead/splinter/trail is finished
  flip_y: false, // one-line empirical escape if screenUV's vertical convention makes the drain sweep "up"
})

/**
 * Deterministic pseudo-random in [0,1) — the same fract(sin(...)) family as title_aura.js's `quad_rand`
 * (pure, no RNG state so a given (seed, salt) always reproduces). `salt` fans a single per-activation
 * `seed` out into decorrelated per-bead streams.
 * @param {number} seed @param {number} salt @returns {number}
 */
export function rand01(seed, salt) {
  const s = Math.sin(seed * 12.9898 + salt * 78.233) * 43758.5453
  return s - Math.floor(s)
}

/**
 * Global intensity envelope: 1 the instant a splash happens, exponential decay with time constant `tau`.
 * `t_since_splash == null` (never triggered, or long-idled-out) ⇒ 0 — the "inactive = identity" contract.
 * @param {number | null | undefined} t_since_splash seconds since the last splash() (null/undefined = inactive)
 * @param {number} [tau] @returns {number} intensity ∈ [0,1]
 */
export function decay_intensity(t_since_splash, tau = LENS_WATER.tau) {
  if (t_since_splash == null || !Number.isFinite(t_since_splash) || t_since_splash < 0) return 0
  return Math.exp(-t_since_splash / tau)
}

/**
 * Pure CPU twin of the shader's drain-front position (uv, 0 = top edge; negative = not started ⇒ fully
 * wet). The top-first macro sweep — unchanged round-4 timeline. (The round-5 stream-column lag died with
 * the columns in round-9; late local wetness is the region field's job now.)
 * @param {number} t seconds since the splash @returns {number} front y (uv)
 */
export function film_front_y(t) {
  return (t - LENS_WATER.drain_start) * LENS_WATER.drain_speed
}

/**
 * ROUND-9 sheet envelope: 1 through `sheet_hold` (the whole lens is water), then smoothstep → 0 over
 * `sheet_fade`. Blends the film's amplitude from sheet_amp down to the subtle film_amp base, and scales
 * the opening sheen — the "I'm looking through water" beat that recedes as the sheet breaks.
 * @param {number} t seconds since the splash @returns {number} ∈ [0,1], monotonically non-increasing
 */
export function sheet_envelope(t) {
  if (t <= LENS_WATER.sheet_hold) return 1
  const u = Math.min(1, (t - LENS_WATER.sheet_hold) / LENS_WATER.sheet_fade)
  return 1 - u * u * (3 - 2 * u)
}

/**
 * The film's distortion amplitude at time t: sheet_amp at the surface moment, receding to the r4 subtle
 * film_amp base as the sheet breaks (pure twin of the shader's amp node).
 * @param {number} t @returns {number} amplitude (uv)
 */
export function film_amp_at(t) {
  return LENS_WATER.film_amp + (LENS_WATER.sheet_amp - LENS_WATER.film_amp) * sheet_envelope(t)
}

/**
 * ROUND-9 wet-region noise ∈ [0,1]: a 3-octave 2-axis sin·cos value-noise (flat — naga-safe). Its
 * iso-contours are the wet patches' borders — blobby fluid shapes at ~0.2-0.5 uv scale with irregular
 * edges; never a band, never a straight line (pinned by the fluid-law tests).
 * @param {number} x screen x (uv) @param {number} y screen y (uv) @returns {number} ∈ [0,1]
 */
export function region_noise(x, y) {
  const n =
    Math.sin(x * 6.3 + 1.7) * Math.cos(y * 5.1 + 0.4) +
    Math.sin(x * 13.1 + y * 3.7 + 2.9) * Math.cos(y * 11.7 - x * 2.3 + 1.1) * 0.55 +
    Math.sin(x * 27.9 - y * 7.1 + 4.2) * Math.cos(y * 23.3 + x * 5.9) * 0.3
  // /2.6 + clamp: the raw sum's PRACTICAL range is ~[−1.6, 1.3] (measured over the frame) — a theoretical
  // normalization left the top of the cut sweep biting nothing (features died ~0.4s early, and the last
  // patches never survived into the late phase). This mapping spans the full [0,1] with soft saturation.
  return Math.min(1, Math.max(0, n / 2.6 + 0.5))
}

/**
 * The receding coverage cut: ≤ −region_band through the sheet hold (everything wet), rising linearly to
 * fully past the noise range by `region_end` (everything dry). The film compares region_noise against
 * this; coverage shrinks in irregular patches as the cut climbs.
 * @param {number} t seconds since the splash @returns {number} cut level (noise units)
 */
export function region_cut(t) {
  const p = Math.min(1, Math.max(0, (t - LENS_WATER.sheet_hold) / (LENS_WATER.region_end - LENS_WATER.sheet_hold)))
  return -LENS_WATER.region_band + p * (1 + 2 * LENS_WATER.region_band)
}

/**
 * Regional wetness at (x, y) and time t ∈ [0,1]: 1 = inside a wet patch, 0 = dried. smoothstep over
 * region_band keeps the patch borders soft (a fluid meniscus, not a cut-out). This single field drives
 * BOTH the film's coverage (shader mirror) and — lagged by feature_lag — every feature's existence gate.
 * ROUND-10: measured already a proper smoothstep landing (max ~0.11 alpha/frame at 60fps, zero slope at the
 * u=0/1 clamp) — a region drying out fades its residents rather than cutting them; unchanged, now pinned.
 * @param {number} x @param {number} y @param {number} t @returns {number} ∈ [0,1]
 */
export function region_level(x, y, t) {
  const cut = region_cut(t)
  const n = region_noise(x, y)
  const u = Math.min(1, Math.max(0, (n - cut) / LENS_WATER.region_band))
  return u * u * (3 - 2 * u)
}

/**
 * Per-bead hard lifetime OUT-fade: 1 while young, holds through 70% of `lifetime`, then smoothstep-tails
 * to EXACTLY 0 at `t_local >= lifetime`. This — not the slower global `decay_intensity` — guarantees a
 * bead fully disappears. (The birth-side fade-in lives in `droplet_alpha`; this stays the pure out-fade.)
 * @param {number} t_local seconds since THIS bead's own birth @param {number} lifetime seconds
 * @returns {number} fade ∈ [0,1], monotonically non-increasing
 */
export function droplet_life_fade(t_local, lifetime) {
  if (t_local <= 0) return 1
  if (t_local >= lifetime) return 0
  const fade_start = lifetime * 0.7
  if (t_local <= fade_start) return 1
  const u = (t_local - fade_start) / (lifetime - fade_start)
  return 1 - u * u * (3 - 2 * u) // smoothstep complement — C1-continuous, no pop at the tail
}

/**
 * Full birth→death alpha envelope: a quick fade-IN over `birth_fade` (so late-born splinters/beads never
 * pop on), then the `droplet_life_fade` out-fade. This is what `droplet_state_at` packs; the shader reads
 * the packed value, so the GPU mirrors it for free.
 * @param {number} t_local seconds since THIS bead's own birth @param {number} lifetime seconds
 * @returns {number} alpha ∈ [0,1]
 */
export function droplet_alpha(t_local, lifetime) {
  if (t_local <= 0 || t_local >= lifetime) return 0
  const fade_in = Math.min(1, t_local / LENS_WATER.birth_fade)
  return fade_in * droplet_life_fade(t_local, lifetime)
}

/**
 * A burst's radius/alpha multipliers around `burst_at` (local time): a brief SWELL (radius 1→swell_scale)
 * then a fast COLLAPSE (radius→0, alpha→0). No burst (`burst_at` non-finite) ⇒ {1, 1} always, so a
 * non-bursting isolated bead is byte-identical to round-6. Pure — the shader packs radius·alpha from here.
 * @param {number} t_local seconds since the bead's birth @param {number} burst_at local burst time (s)
 * @returns {{radius_mul:number, alpha_mul:number}}
 */
export function burst_shape(t_local, burst_at) {
  if (!Number.isFinite(burst_at) || t_local < burst_at - LENS_WATER.burst_swell) return { radius_mul: 1, alpha_mul: 1 }
  if (t_local < burst_at) {
    const u = (t_local - (burst_at - LENS_WATER.burst_swell)) / LENS_WATER.burst_swell // 0..1 swell
    const e = u * u * (3 - 2 * u) // smoothstep swell-in
    return { radius_mul: 1 + e * (LENS_WATER.burst_swell_scale - 1), alpha_mul: 1 }
  }
  if (t_local < burst_at + LENS_WATER.burst_collapse) {
    const u = (t_local - burst_at) / LENS_WATER.burst_collapse // 0..1 collapse
    // ROUND-10: smoothstep ease (was linear u² accel — "the pop accelerates", a real single-frame pop at the
    // very end). Zero slope at u=1 ⇒ the last frame barely moves: a fade landing, matching the swell-in above
    // and droplet_life_fade's tail exactly.
    const e = u * u * (3 - 2 * u)
    return { radius_mul: LENS_WATER.burst_swell_scale * (1 - e), alpha_mul: 1 - e }
  }
  return { radius_mul: 0, alpha_mul: 0 } // burst finished — the bubble is gone
}

/**
 * Builds ONE activation's deterministic FIELD — pure + seed-driven so `splash()` reseeding genuinely varies
 * the field dunk-to-dunk while staying unit-testable with a fixed seed. Returns `primary_count` primary
 * droplets FOLLOWED BY `splinter_count` ejecta droplets (a single flat array the shader loops over once).
 *   • Primaries: fully-random scatter (Poisson clumping = the chaos), rand²-biased radii (dots-heavy), a
 *     size-correlated slide, and a SIZE-BIASED burst roll (blobs mostly pop → feed trails; dots survive).
 *   • Splinters: each assigned (round-robin) to a bursting parent — born AT the parent's burst, tiny, short,
 *     thrown outward (pop_x/pop_y) then falling. If no bead bursts (astronomically rare), splinters are
 *     inert (born past the park ⇒ never visible) but keep a valid radius so the field stays uniform.
 * @param {number} seed @param {number} [primary_count] @param {number} [splinter_count]
 * @returns {Array<{x0:number,y0:number,birth:number,lifetime:number,radius:number,burst_at:number,slide:number,sway_phase:number,sway_freq:number,surge_amp:number,surge_freq:number,surge_phase:number,pop_x:number,pop_y:number}>}
 */
export function build_droplets(seed, primary_count = LENS_WATER.count, splinter_count = LENS_WATER.splinter_slots) {
  const drops = []
  for (let i = 0; i < primary_count; i += 1) {
    const r = rand01(seed, i * 13 + 6)
    const radius = LENS_WATER.radius_min + r * r * LENS_WATER.radius_span // rand² → small-dot heavy, blob rare
    const size_t = (radius - LENS_WATER.radius_min) / LENS_WATER.radius_span // 0 dot … 1 blob
    // size-biased burst: a dot pops ~28% of the time, a blob ~82% — heavy beads pop (and feed trails)
    const bursts = rand01(seed, i * 13 + 10) < LENS_WATER.burst_fraction * (0.5 + size_t)
    drops.push({
      x0: 0.02 + rand01(seed, i * 13 + 2) * 0.96, // fully random — Poisson clumping is the chaos
      y0: 0.05 + rand01(seed, i * 13 + 3) * 0.85,
      birth: rand01(seed, i * 13 + 4) * LENS_WATER.birth_spread,
      lifetime: LENS_WATER.lifetime_min + rand01(seed, i * 13 + 5) * LENS_WATER.lifetime_span,
      radius,
      burst_at: bursts ? LENS_WATER.burst_min + rand01(seed, i * 13 + 11) * LENS_WATER.burst_span : Infinity,
      // big drops RUN, small dots STICK — size-correlated base × a ±40% per-bead jitter (never zero)
      slide: (LENS_WATER.slide_min + size_t * LENS_WATER.slide_span) * (0.6 + rand01(seed, i * 13 + 7) * 0.8),
      sway_phase: rand01(seed, i * 13 + 8) * Math.PI * 2,
      sway_freq: 1.5 + rand01(seed, i * 13 + 9) * 2.5, // rad/s — every bead wobbles at its own rate
      // round-8 SURGE (wavy-time fall): amp·freq ≤ 0.2·3.5 = 0.7 < 1 ⇒ descent slows/rushes, never reverses
      surge_amp: 0.08 + rand01(seed, i * 13) * 0.12, // s of wavy time ∈ [0.08, 0.2]
      surge_freq: 1.5 + rand01(seed, i * 13 + 1) * 2, // rad/s ∈ [1.5, 3.5]
      surge_phase: rand01(seed, i * 13 + 12) * Math.PI * 2,
      pop_x: 0, // primaries don't eject (splinters below carry the outward pop)
      pop_y: 0,
    })
  }
  const bursting = drops.filter((d) => Number.isFinite(d.burst_at))
  for (let s = 0; s < splinter_count; s += 1) {
    const parent = bursting.length ? bursting[s % bursting.length] : null
    const bt = parent ? parent.burst_at : LENS_WATER.max_active_s + 1 // no parent ⇒ never born (inert)
    const px = parent ? parent.x0 : 0.5
    const py = parent ? parent.y0 + parent.slide * bt : 0.5 // the parent's position at its burst
    const ang = rand01(seed, s * 11 + 101) * Math.PI * 2
    const dist = LENS_WATER.pop_dist_min + rand01(seed, s * 11 + 102) * LENS_WATER.pop_dist_span
    drops.push({
      x0: px,
      y0: py,
      birth: bt, // born WHEN the parent bursts (pre-birth ⇒ invisible: droplet_alpha guards it)
      lifetime: LENS_WATER.splinter_life_min + rand01(seed, s * 11 + 103) * LENS_WATER.splinter_life_span,
      radius: LENS_WATER.radius_min + rand01(seed, s * 11 + 104) * LENS_WATER.splinter_radius_span,
      burst_at: Infinity, // splinters just fade — they don't re-burst
      slide: LENS_WATER.splinter_slide * (0.7 + rand01(seed, s * 11 + 105) * 0.6), // ejecta falls, jittered
      sway_phase: rand01(seed, s * 11 + 106) * Math.PI * 2,
      sway_freq: 2 + rand01(seed, s * 11 + 107) * 3,
      surge_amp: 0.05 + rand01(seed, s * 11 + 108) * 0.08, // ejecta surges too (amp·freq ≤ 0.13·4 = 0.52 < 1)
      surge_freq: 2 + rand01(seed, s * 11 + 109) * 2,
      surge_phase: rand01(seed, s * 11 + 110) * Math.PI * 2,
      pop_x: Math.cos(ang) * dist, // outward throw (eases out over pop_tau)
      pop_y: Math.sin(ang) * dist - LENS_WATER.pop_up, // biased UP at the pop, then gravity (slide) pulls down
    })
  }
  return drops
}

/**
 * One droplet's CURRENT (x, y, radius, alpha) at elapsed time `t` since the activation — pure; the pass
 * calls this per bead per frame and packs the result into the uniformArray the shader reads. ROUND-8 FLUID
 * PATH: x WANDERS on two incommensurate octaves (a curving wobble, never one clean sinusoid) and the
 * descent SURGES via wavy time — `fall(tb) = tb + (sin(tb·sf + sp) − sin(sp))·sa` with sa·sf < 1, so
 * dy/dt ≥ slide·(1 − sa·sf) > 0: the speed visibly varies along the way but water never flows uphill, and
 * fall(0) = 0 so birth stays anchored. A splinter additionally eases OUTWARD from its pop point (pop_x/y
 * over pop_tau) then falls; a bursting bead swells then collapses (burst_shape). Pre-birth ⇒ alpha 0.
 * ROUND-9: alpha is additionally gated by the LAGGED regional wetness at the droplet's own position —
 * a droplet is a remnant of the sheet; where the sheet (plus feature_lag) has dried, it doesn't exist.
 * @param {{x0:number,y0:number,birth:number,lifetime:number,radius:number,burst_at:number,slide:number,sway_phase:number,sway_freq:number,surge_amp?:number,surge_freq?:number,surge_phase?:number,pop_x?:number,pop_y?:number}} drop
 * @param {number} t seconds since the activation (splash) @returns {{x:number,y:number,radius:number,alpha:number}}
 */
export function droplet_state_at(drop, t) {
  const tb = t - drop.birth
  if (tb < 0) return { x: drop.x0, y: drop.y0, radius: drop.radius, alpha: 0 } // not born yet ⇒ invisible
  const pop_x = drop.pop_x ?? 0 // primaries (and legacy callers) carry no ejecta
  const pop_y = drop.pop_y ?? 0
  const sa = drop.surge_amp ?? 0 // legacy callers: zero surge ⇒ the round-7 linear fall
  const sp = drop.surge_phase ?? 0
  // 2-octave lateral wander (freq ratio 2.37 — incommensurate, never re-phases into a clean sinusoid)
  const w1 = Math.sin(tb * drop.sway_freq + drop.sway_phase)
  const w2 = Math.sin(tb * drop.sway_freq * 2.37 + drop.sway_phase * 1.7)
  const sway = (w1 + w2 * 0.6) * LENS_WATER.sway_amp * Math.min(1, tb)
  const fall = tb + (Math.sin(tb * (drop.surge_freq ?? 0) + sp) - Math.sin(sp)) * sa // wavy time, monotone
  const pop = pop_x || pop_y ? 1 - Math.exp(-tb / LENS_WATER.pop_tau) : 0 // outward ejecta ease
  const burst = burst_shape(tb, drop.burst_at)
  const x = drop.x0 + sway + pop_x * pop
  const y = drop.y0 + drop.slide * fall + pop_y * pop // +y = down-screen: a surging, never-uphill run
  return {
    x,
    y,
    radius: drop.radius * burst.radius_mul,
    // life-fade × burst × the round-9 remnant gate (the sheet's local wetness, feature_lag behind)
    alpha: droplet_alpha(tb, drop.lifetime) * burst.alpha_mul * region_level(x, y, t - LENS_WATER.feature_lag),
  }
}

/**
 * A trail's OUT/IN alpha envelope: a quick fade-IN over `trail_fade_in`, hold through 55% of `lifetime`,
 * then a smoothstep tail to 0. (Separate from droplet_life_fade — trails fade in AND hold longer so a few
 * long trails survive into the sparse tail.)
 * @param {number} t_local @param {number} lifetime @returns {number} ∈ [0,1]
 */
export function trail_life_fade(t_local, lifetime) {
  if (t_local <= 0 || t_local >= lifetime) return 0
  const fade_in = Math.min(1, t_local / LENS_WATER.trail_fade_in)
  const fade_start = lifetime * 0.55
  if (t_local <= fade_start) return fade_in
  const u = (t_local - fade_start) / (lifetime - fade_start)
  return fade_in * (1 - u * u * (3 - 2 * u))
}

/**
 * Builds the TRAILS for an activation — bead-fed: the HEAVIEST bursting beads each release a finite water
 * column anchored at their burst point. Fixed `trail_count` slots (constant uniformArray size); unfilled
 * slots (fewer bursts than slots) are inert (born past the park ⇒ alpha 0 forever). Irregular length &
 * position per trail (target: "never a uniform column lane"); the meandering centreline / varying width /
 * ragged caps are per-pixel geometry — see the round-8 fluid twins at the bottom of this file.
 * @param {ReturnType<typeof build_droplets>} drops the field (its bursting beads feed the trails)
 * @param {number} seed @param {number} [trail_count]
 * @returns {Array<{x:number,y_top:number,birth:number,max_len:number,lifetime:number}>}
 */
export function build_trails(drops, seed, trail_count = LENS_WATER.trail_slots) {
  const heavy = drops
    .filter((d) => Number.isFinite(d.burst_at)) // only bursting beads throw a trail
    .sort((a, b) => b.radius - a.radius) // the heaviest first ("heavy beads release a trail")
  const trails = []
  for (let s = 0; s < trail_count; s += 1) {
    const parent = heavy[s]
    if (!parent) {
      trails.push({ x: 0.5, y_top: 0.5, birth: LENS_WATER.max_active_s + 1, max_len: 0, lifetime: 0 })
      continue
    }
    trails.push({
      x: parent.x0, // the column runs down roughly under the burst x (shader adds the snake)
      y_top: parent.y0 + parent.slide * parent.burst_at, // anchored where the bubble popped
      birth: parent.burst_at, // the trail appears at the burst
      max_len: LENS_WATER.trail_len_min + rand01(seed, s * 17 + 200) * LENS_WATER.trail_len_span, // irregular length
      lifetime: LENS_WATER.trail_life_min + rand01(seed, s * 17 + 201) * LENS_WATER.trail_life_span,
    })
  }
  return trails
}

/**
 * One trail's CURRENT (x, y_top, length, alpha) at elapsed time `t` — the column runs DOWN from its burst
 * point, lengthening to `max_len` over `trail_grow`, then fading. Packed into the trail uniformArray the
 * shader's trail loop reads (the shader renders the cylindrical lens + crest from x/y_top/length).
 * ROUND-9: alpha is gated by the LAGGED regional wetness at the trail's midpoint — a trail is water shed
 * by a bubble ONTO the sheet's remnants; where the region has dried, the trail is gone.
 * @param {{x:number,y_top:number,birth:number,max_len:number,lifetime:number}} trail
 * @param {number} t seconds since the activation @returns {{x:number,y_top:number,length:number,alpha:number}}
 */
export function trail_state_at(trail, t) {
  const tb = t - trail.birth
  if (tb < 0 || tb >= trail.lifetime) return { x: trail.x, y_top: trail.y_top, length: 0, alpha: 0 }
  const length = trail.max_len * Math.min(1, tb / LENS_WATER.trail_grow) // runs down to full length
  const region = region_level(trail.x, trail.y_top + length * 0.5, t - LENS_WATER.feature_lag)
  return { x: trail.x, y_top: trail.y_top, length, alpha: trail_life_fade(tb, trail.lifetime) * region }
}

// ─── ROUND-8 FLUID GEOMETRY (pure twins of the shader's per-pixel trail/silhouette math) ───
// The tests pin the fluid law on these; the capture script renders THROUGH them; the TSL loops in
// lens_water.js mirror them term-for-term (flat sin/cos only — the naga-shallow law). One home for the
// formulas on the CPU side; the shader duplicate is the price of the CPU-twin idiom (kept honest here).

/**
 * A trail's meandering centreline at screen y: THREE incommensurate octaves, phases decorrelated per trail
 * by its base x — the stream S-bends several times over its length and wanders PAST its own width (max
 * lateral ≈ ±1.85·trail_meander ≈ 0.033 uv vs width 0.02), so a frozen frame has no traceable straight stroke.
 * @param {number} x_base the trail's packed anchor x @param {number} y screen y (uv)
 * @returns {number} centreline x (uv)
 */
export function trail_center_x(x_base, y) {
  const p = x_base * 43.75
  return (
    x_base +
    (Math.sin(y * 9.1 + p) + Math.sin(y * 23.3 + p * 1.93) * 0.55 + Math.sin(y * 47.7 + p * 3.1) * 0.3) *
      LENS_WATER.trail_meander
  )
}

/**
 * A trail's half-width at screen y: pinches and bulges along the path (±trail_width_var of the base) —
 * never a constant-width capsule. Total octave weight 1.0 ⇒ width ∈ [1−var, 1+var]·trail_width > 0.
 * @param {number} x_base @param {number} y @returns {number} half-width (uv), strictly positive
 */
export function trail_halfwidth(x_base, y) {
  const q = x_base * 61.3
  const v = Math.sin(y * 13.7 + q) * 0.6 + Math.sin(y * 31.9 + q * 2.3) * 0.4
  return LENS_WATER.trail_width * (1 + v * LENS_WATER.trail_width_var)
}

/**
 * Ragged head/tail cap offset (uv, added to the cap's y) as a function of screen x — across the column's
 * width the edge wobbles by ±~1.5·trail_rag, so the caps are never straight horizontal cuts. `tail`
 * decorrelates the bottom edge's phases from the head's.
 * @param {number} x screen x (uv) @param {number} x_base the trail's anchor @param {boolean} [tail]
 * @returns {number} y offset (uv)
 */
export function trail_edge_rag(x, x_base, tail = false) {
  const p = x_base * (tail ? 142.95 : 87.7)
  return (Math.sin(x * 83 + p) + Math.sin(x * 197 + p * 2.7) * 0.5) * LENS_WATER.trail_rag
}

/**
 * A bead's silhouette perturbation (unitless, ±1.65 max): TWO incommensurate sin·cos octaves over the
 * bead-local offset (ux, uy = raw/R), phases decorrelated by the bead's centre — an amorphous blob
 * outline, never a clean circle. r_eff = R·(1 + bump·meniscus_amp) stays > 0 (1 − 1.65·0.16 ≈ 0.74·R).
 * @param {number} ux local x offset / R @param {number} uy local y offset / R
 * @param {number} sx phase seed (bead centre x) @param {number} sy phase seed (bead centre y)
 * @returns {number} bump ∈ [−1.65, 1.65]
 */
export function meniscus_bump(ux, uy, sx, sy) {
  return (
    Math.sin(ux * LENS_WATER.meniscus_freq + sx * 31) * Math.cos(uy * LENS_WATER.meniscus_freq + sy * 27) +
    Math.sin(ux * 6.7 + sy * 53) * Math.cos(uy * 5.3 + sx * 47) * 0.65
  )
}
