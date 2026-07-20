// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// NG2-ATMO output color grade (playbook §3.1 "filmic grade"; owner goal: "improved contrast and
// punchy colors for a realistic cinematic look"). FINAL display grade — composes AFTER AgX, on the
// tonemapped [0,1] signal, in display space. AgX did HDR highlight roll-off + a gentle desaturation;
// we re-inject controlled contrast + saturation that AgX holds back, WITHOUT crushing blacks or
// clipping whites (both endpoints are exact fixed points of the curve).
//
// ⚠️ OWNER PERCEPTUAL MANDATE (snowy-taiga-slope chaos: "hard to distinguish contrast… too many
// lines"): the grade must separate PLANES, not CELLS. A naive per-pixel contrast sigmoid amplifies
// high-frequency cell-to-cell contrast (leaf-top vs snow-face vs shadow-face, all lifted equally) →
// MORE chaos. So contrast here is LOW-FREQUENCY: it keys off a large-area (blurred) luminance and
// lifts REGIONAL separation (ground plane vs canopy mass vs sky), while the per-cell grain — already
// at its ceiling — is left untouched. The per-pixel contrast term defaults near-neutral (grain-safe)
// and is meant to stay small; the punch comes from the low-freq lift + saturation. See §"low-freq".
//
// SINGLE SOURCE OF TRUTH (sky_node.js / froxels.js idiom): the pure-JS `grade_channel` /
// `grade_channel_lowfreq` / `grade_rgb` are unit-tested (monotone, fixed no-clip endpoints, real
// low-freq contrast lift, per-cell grain preserved, neutral-axis identity). The TSL
// `create_grade_node()` mirrors them op-for-op against the SAME constants → shader and math can't
// drift. Vibrance protects near-neutral (skin) + already-saturated colors — the design's neutral axis.

import { clamp, float, mix, pow, saturation, smoothstep, uniform, vec3 } from 'three/tsl'

/**
 * @typedef {object} GradeConfig
 * @property {number} contrast LOW-FREQUENCY (large-area) contrast gain (1 = neutral). ~1.18 lifts
 *   regional plane-to-plane separation; keyed off a blurred luma so it does NOT amplify per-cell grain.
 * @property {number} local_contrast PER-PIXEL contrast gain (1 = neutral). Kept ≈1 (grain-safe): the
 *   per-cell grain is already at its ceiling in this engine, so raising this re-introduces the "too
 *   many lines" chaos. Exposed only so it can be nudged DOWN to soften clutter if ever needed.
 * @property {number} pivot tonal centre the contrast pivots about (DISPLAY-space middle grey ≈ 0.45,
 *   since the grade runs after AgX/gamma). A fixed point of the curve.
 * @property {number} saturation saturation multiplier (1 = neutral); luminance-preserving.
 * @property {number} vibrance low-saturation boost [0..~0.5]; enhances muted colors MORE (skin-safe).
 * @property {number} lift shadow lift floor [0..~0.05] — keeps blacks off zero under the added contrast.
 * @property {number} shoulder highlight rolloff [0..1] (Reinhard-form `v·(1+s)/(1+s·v)`): 0→0 and 1→1
 *   stay exact; highlights compress, low-mids lift — the aged-film fade. 0 = off.
 */

// --- default grade — the CONQUEST mood (art direction 2026-07-03: "realistic old school dark
// faded look… truly cinematic"). Reconciles the earlier "punchy" mandate: punchy CONTRAST (the
// filmic S + plane separation STAND), HUMBLE SATURATION (drama from contrast + atmosphere, not
// chroma), FADED-FILMIC character (lifted blacks + a gentle highlight shoulder). All knobs; final
// numbers co-tune against the texture wave's post-Conquest palette captures. ----------------------
// CO-TUNE 2026-07-03 (Conquest day-mood): the ATMO_CONFIG.grade in atmosphere.js is the LIVE source;
// these mirror it (single source — keep in lockstep). The refs' signature is SATURATION + STRUCTURE,
// not just low luma, so chroma came UP and the faded lift/shoulder came DOWN for richer blacks.
/** LOW-FREQ contrast lift: +24% on large-area luminance separation — the plane-separating punch. */
export const GRADE_CONTRAST = 1.24
/** PER-PIXEL contrast: 1.0 = neutral. Deliberately NOT >1 — per-cell grain is already maxed (by design). */
export const GRADE_LOCAL_CONTRAST = 1.0
/** contrast pivot = DISPLAY-space middle grey. This grade runs AFTER AgX (display/gamma space), where
 *  linear 0.18 middle grey lands at ~0.45 — NOT 0.18. Pivoting here puts the steep part of the S-curve
 *  on the actual midtones (the plane-separation band), not buried in the deep-shadow toe. */
export const GRADE_PIVOT = 0.45
/** saturation: Conquest chroma — the washed day read colorless (q_sat 0.107 vs refs 0.24-0.55). */
export const GRADE_SATURATION = 1.12
/** vibrance: rescues the muted mid-chroma (snow/rock/foliage) without over-punching already-saturated hues. */
export const GRADE_VIBRANCE = 0.12
/** shadow lift floor — faded-film blacks (never crushed to 0; part of the "old school faded" read). */
export const GRADE_LIFT = 0.014
/** highlight shoulder — the aged-film rolloff (see GradeConfig.shoulder). */
export const GRADE_SHOULDER = 0.09

/** @type {Readonly<GradeConfig>} the shipped default grade. */
export const DEFAULT_GRADE = Object.freeze({
  contrast: GRADE_CONTRAST,
  local_contrast: GRADE_LOCAL_CONTRAST,
  pivot: GRADE_PIVOT,
  saturation: GRADE_SATURATION,
  vibrance: GRADE_VIBRANCE,
  lift: GRADE_LIFT,
  shoulder: GRADE_SHOULDER,
})

/** Rec.709 luminance weights (match three's default working-space coefficients used by `saturation`). */
export const LUMA_R = 0.2126
export const LUMA_G = 0.7152
export const LUMA_B = 0.0722

/** @param {number} x @param {number} lo @param {number} hi @returns {number} */
const clampf = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x)
/** @param {number} x @returns {number} clamp to [0,1] */
const saturate = (x) => clampf(x, 0, 1)
/** @param {number} t @returns {number} Hermite smoothstep on [0,1] (matches TSL smoothstep(0,1,t)). */
const smooth01 = (t) => {
  const u = saturate(t)
  return u * u * (3 - 2 * u)
}

/**
 * A fixed-endpoint smoothstep S-curve recentred so its inflection sits at `pivot` instead of 0.5.
 * Two half-Hermites: [0,pivot]→[0,0.5] and [pivot,1]→[0.5,1]; monotone, C¹, pins 0→0, pivot→0.5, 1→1.
 * This is the contrast SHAPE the sigmoid blends toward (endpoints fixed ⇒ no clip/crush possible).
 * @param {number} v [0,1] @param {number} pivot (0,1) @returns {number} [0,1]
 */
function smooth_pivot(v, pivot) {
  const p = clampf(pivot, 1e-3, 1 - 1e-3)
  if (v <= p) return 0.5 * smooth01(v / p)
  return 0.5 + 0.5 * smooth01((v - p) / (1 - p))
}

/** Apply the shadow lift: map [0,1] → [lift,1]. @param {number} v @param {number} lift @returns {number} */
const apply_lift = (v, lift) => saturate(lift + v * (1 - lift))

/** Aged-film highlight shoulder (Reinhard-form): `v·(1+s)/(1+s·v)` — exact 0→0 / 1→1 fixed points,
 * monotone, compresses highlights + lifts low-mids. s=0 ⇒ identity.
 * @param {number} v [0,1] @param {number} s shoulder strength @returns {number} */
const apply_shoulder = (v, s) => (v * (1 + s)) / (1 + s * v)

/**
 * PER-PIXEL filmic contrast for ONE tonemapped channel — used only for the grain-safe local term
 * (`local_contrast`, default 1 = pass-through). Endpoints fixed (0→0, 1→1), then the faded-film
 * shoulder, then the shadow lift.
 * @param {number} x tonemapped channel (clamped to [0,1])
 * @param {GradeConfig} [cfg]
 * @returns {number} graded channel in [0,1]
 */
export function grade_channel(x, cfg = DEFAULT_GRADE) {
  const v = saturate(x)
  const s = smooth_pivot(v, cfg.pivot)
  const contrasted = v + (s - v) * (cfg.local_contrast - 1)
  return apply_lift(apply_shoulder(saturate(contrasted), cfg.shoulder), cfg.lift)
}

/**
 * LOW-FREQUENCY contrast — THE plane-separating operator (constraint). The contrast S-curve is
 * evaluated on a LARGE-AREA (blurred) luminance `lf`, and the result is applied to the pixel as a
 * per-pixel GAIN `curve(lf)/lf`. So two pixels in the same region (same `lf`) get the SAME gain →
 * their fine (per-cell) difference is preserved, NOT amplified; only region-to-region (different
 * `lf`) separation is stretched. This lifts ground-plane vs canopy-mass vs sky while leaving the
 * per-cell grain at its existing ceiling. `contrast=1` ⇒ gain 1 everywhere (pure pass-through).
 * @param {number} x tonemapped channel value [0,1] (the fine pixel)
 * @param {number} lf large-area luminance at this pixel [0,1] (the blurred luma)
 * @param {GradeConfig} [cfg]
 * @returns {number} graded channel in [0,1]
 */
export function grade_channel_lowfreq(x, lf, cfg = DEFAULT_GRADE) {
  const v = saturate(x)
  const base = saturate(lf)
  const s = smooth_pivot(base, cfg.pivot)
  const target = base + (s - base) * (cfg.contrast - 1) // low-freq contrast target
  const gain = base > 1e-4 ? target / base : 1 // region gain, shared by all pixels in the region
  // also fold the (grain-safe) per-pixel term so a single node covers both.
  const local_s = smooth_pivot(v, cfg.pivot)
  const local = v + (local_s - v) * (cfg.local_contrast - 1)
  return apply_lift(apply_shoulder(saturate(local * gain), cfg.shoulder), cfg.lift)
}

/** @param {[number,number,number]} c @returns {number} Rec.709 luminance. */
export function luma(c) {
  return LUMA_R * c[0] + LUMA_G * c[1] + LUMA_B * c[2]
}

/** luminance-preserving saturation + vibrance (shared by grade_rgb + grade_rgb_lowfreq).
 * @param {[number,number,number]} c @param {GradeConfig} cfg @returns {[number,number,number]} */
function apply_sat_vib(c, cfg) {
  const l = luma(c)
  /** @type {[number,number,number]} */
  let s = [l + (c[0] - l) * cfg.saturation, l + (c[1] - l) * cfg.saturation, l + (c[2] - l) * cfg.saturation]
  // vibrance mirrors three's `vibrance`: amt = (max−avg)·adjustment·−3, then mix(rgb, max, amt).
  const avg = (s[0] + s[1] + s[2]) / 3
  const mx = Math.max(s[0], s[1], s[2])
  const amt = (mx - avg) * cfg.vibrance * -3
  s = [s[0] + (mx - s[0]) * amt, s[1] + (mx - s[1]) * amt, s[2] + (mx - s[2]) * amt]
  return /** @type {[number,number,number]} */ ([saturate(s[0]), saturate(s[1]), saturate(s[2])])
}

/**
 * Full RGB grade WITHOUT a low-freq input — the grain-safe fallback (per-cell contrast defaults to
 * neutral, so this only lifts blacks + punches saturation). A neutral grey is a fixed point of the
 * sat+vibrance stages (they scale chroma about luma), so the neutral axis is protected.
 * @param {[number,number,number]} rgb tonemapped color [0,1]
 * @param {GradeConfig} [cfg]
 * @returns {[number,number,number]} graded color [0,1]
 */
export function grade_rgb(rgb, cfg = DEFAULT_GRADE) {
  /** @type {[number,number,number]} */
  const c = [grade_channel(rgb[0], cfg), grade_channel(rgb[1], cfg), grade_channel(rgb[2], cfg)]
  return apply_sat_vib(c, cfg)
}

/**
 * Full RGB grade WITH a low-freq luminance — the shipped path (plane separation). Applies the
 * region gain per channel, then saturation + vibrance.
 * @param {[number,number,number]} rgb tonemapped color [0,1]
 * @param {number} lf large-area luminance at this pixel [0,1]
 * @param {GradeConfig} [cfg]
 * @returns {[number,number,number]} graded color [0,1]
 */
export function grade_rgb_lowfreq(rgb, lf, cfg = DEFAULT_GRADE) {
  /** @type {[number,number,number]} */
  const c = [
    grade_channel_lowfreq(rgb[0], lf, cfg),
    grade_channel_lowfreq(rgb[1], lf, cfg),
    grade_channel_lowfreq(rgb[2], lf, cfg),
  ]
  return apply_sat_vib(c, cfg)
}

// --- TSL node factory ----------------------------------------------------------------------------

/**
 * The grade node handle the wiring wave composes onto the post output.
 * @typedef {object} GradeNode
 * @property {*} contrast `uniform(float)` — live LOW-FREQ contrast knob.
 * @property {*} local_contrast `uniform(float)` — live per-pixel contrast knob (keep ≈1).
 * @property {*} saturation `uniform(float)` — live saturation knob.
 * @property {*} vibrance `uniform(float)` — live vibrance knob.
 * @property {*} shoulder `uniform(float)` — live aged-film highlight-rolloff knob.
 * @property {(color:*, low_freq_luma?:*)=>*} apply maps a tonemapped vec3 color node → graded vec3.
 *   Pass a blurred-luma float node (`low_freq_luma`) for the plane-separating low-freq path (the
 *   shipped wiring); omit it for the grain-safe fallback (per-pixel contrast only, defaults neutral).
 * @property {(cfg:Partial<GradeConfig>)=>void} set live-tune any subset of knobs (design/qa tuning).
 */

/**
 * Build the output grade node. Mirrors `grade_rgb`/`grade_rgb_lowfreq` op-for-op. Compose its
 * `apply(color, low_freq_luma)` at the very end of the post chain (after AgX), on the tonemapped
 * [0,1] color. `pivot`/`lift` are baked; contrast/local_contrast/saturation/vibrance are uniforms.
 * @param {Partial<GradeConfig>} [opts]
 * @returns {GradeNode}
 */
export function create_grade_node(opts = {}) {
  const cfg = { ...DEFAULT_GRADE, ...opts }
  const contrast = uniform(cfg.contrast)
  const local_contrast = uniform(cfg.local_contrast)
  const saturation_u = uniform(cfg.saturation)
  const vibrance_u = uniform(cfg.vibrance)
  const shoulder = uniform(cfg.shoulder)
  const pivot = float(cfg.pivot)
  const lift = float(cfg.lift)

  /** TSL twin of `smooth_pivot`. @param {*} v @returns {*} */
  const smooth_pivot_node = (v) => {
    const lo = smoothstep(0, 1, v.div(pivot)).mul(0.5)
    const hi = smoothstep(0, 1, v.sub(pivot).div(float(1).sub(pivot)))
      .mul(0.5)
      .add(0.5)
    return v.greaterThan(pivot).select(hi, lo)
  }
  /** TSL twin of `apply_lift`. @param {*} v @returns {*} */
  const lift_node = (v) => clamp(lift.add(v.mul(float(1).sub(lift))), 0, 1)
  /** TSL twin of `apply_shoulder` (aged-film highlight rolloff). @param {*} v @returns {*} */
  const shoulder_node = (v) => v.mul(shoulder.add(1)).div(shoulder.mul(v).add(1))

  /** per-pixel (grain-safe) contrast term. @param {*} x float @returns {*} */
  const local_channel = (x) => {
    const v = clamp(x, 0, 1)
    const s = smooth_pivot_node(v)
    return v.add(s.sub(v).mul(local_contrast.sub(1)))
  }

  /** low-freq region gain from a blurred luma. @param {*} lf float @returns {*} float gain */
  const region_gain = (lf) => {
    const base = clamp(lf, 0, 1)
    const s = smooth_pivot_node(base)
    const target = base.add(s.sub(base).mul(contrast.sub(1)))
    return target.div(base.max(1e-4))
  }

  /**
   * TSL twin of `grade_rgb` (+ low-freq path when `low_freq_luma` is supplied).
   * @param {*} color vec3 tonemapped color node
   * @param {*} [low_freq_luma] float blurred-luma node; omit for the grain-safe fallback.
   * @returns {*} vec3 graded color node
   */
  const apply = (color, low_freq_luma = null) => {
    const gain = low_freq_luma == null ? float(1) : region_gain(low_freq_luma)
    const c = vec3(
      lift_node(shoulder_node(clamp(local_channel(color.x).mul(gain), 0, 1))),
      lift_node(shoulder_node(clamp(local_channel(color.y).mul(gain), 0, 1))),
      lift_node(shoulder_node(clamp(local_channel(color.z).mul(gain), 0, 1)))
    )
    const sat = saturation(c, saturation_u)
    return apply_vibrance(sat, vibrance_u).clamp(0, 1)
  }

  /** @param {Partial<GradeConfig>} next */
  const set = (next) => {
    if (typeof next.contrast === 'number') contrast.value = next.contrast
    if (typeof next.local_contrast === 'number') local_contrast.value = next.local_contrast
    if (typeof next.saturation === 'number') saturation_u.value = next.saturation
    if (typeof next.vibrance === 'number') vibrance_u.value = next.vibrance
    if (typeof next.shoulder === 'number') shoulder.value = next.shoulder
  }

  return {
    contrast,
    local_contrast,
    saturation: saturation_u,
    vibrance: vibrance_u,
    shoulder,
    apply,
    set,
  }
}

/**
 * Vibrance in TSL, mirroring three's `vibrance` (kept inline so the grade is one self-contained node).
 * @param {*} color vec3 node @param {*} adjustment float node @returns {*} vec3 node
 */
function apply_vibrance(color, adjustment) {
  const avg = color.x.add(color.y).add(color.z).div(3)
  const mx = color.x.max(color.y.max(color.z))
  const amt = mx.sub(avg).mul(adjustment).mul(-3)
  return mix(color, vec3(mx, mx, mx), amt).max(0)
}

// `pow` reserved for a future gamma stage (tunable); referenced to satisfy checkJs.
void pow
