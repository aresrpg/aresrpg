// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// NG-TINT (ENG-1) PURE DATA + classification — the three-FREE half of terrain_tint.js. Split out
// [D162 2026-07-05] so the far-shell CPU tint (lod/far_mesher.js, which runs in a pure worker that must
// NOT import three/tsl) can single-source the SAME amplitudes + per-block tint class as the near
// terrain material, instead of hand-copying constants. terrain_tint.js re-exports every symbol here, so
// the shader material + its test are unchanged. NO three import — safe for the far worker bundle.

import { BLOCK_REGISTRY } from '../config/block_registry.js'

/**
 * Macro-tint amplitudes (periods in BLOCKS). Two value-noise octaves from world XZ drive: (a) a
 * chromatic climate tint on grass-family along dry-yellow↔humid-dark (per-channel K, centered at 1),
 * (b) ±value variation, (c) sparse "dirty patch" blend toward dirt on grass-ground, (d) HUMID TURF on
 * grass-ground (a side-by-side comparison against the meadow reference: "the ground probably blends with a similar
 * pattern" — the comparison showed pale grass-top + red-brown mottle reading as "blades on dirt"): where the
 * moisture octave is high, the grass block multiplies toward TURF_RGB — a DARK RICH green — and the
 * dirty-patch blend is gated OUT by the same factor, so a humid meadow floor reads as grass shadow the
 * blades emerge from, while dry steppe keeps the pale mottled look. Applies to the whole grass block
 * (sides too — a humid terrace riser darkens mossy-rooty instead of flashing bright dirt through the
 * meadow). Mineral gets value-only; water/glow none. Subtle elsewhere — the test guards the ceilings.
 * WOOD family (log): value ±VAL_WOOD + a subtle warm↔cool hue drift K_WOOD from the SAME macro field
 * (zero new fetches) so a giant trunk gets low-frequency tonal variation across its height.
 * (e) DEDICATED MACRO-GRADIENT octave [2026-07-12 structural fix — see GRASS_GRADIENT_LEVELS]:
 * P_MACRO_A/B are TWO much-longer-period octaves (grass-class only) that drive the `?grassgrad=`
 * ladder directly and undiluted — MACRO_VAL is the value-swing ceiling, MACRO_K the hue-drift ceiling
 * (reuses K's dry-warm/humid-cool direction, its own smaller magnitude).
 * @type {Readonly<{P_BIG:number,P_SMALL:number,VAL_GRASS:number,VAL_MINERAL:number,VAL_WOOD:number,K:readonly number[],K_WOOD:readonly number[],DIRT_LO:number,DIRT_HI:number,DIRT_MAX:number,DIRT_RGB:readonly number[],TURF_LO:number,TURF_HI:number,TURF_RGB:readonly number[],P_MACRO_A:number,P_MACRO_B:number,MACRO_VAL:number,MACRO_K:readonly number[]}>}
 */
export const NG_TINT = {
  P_BIG: 40,
  P_SMALL: 13,
  VAL_GRASS: 0.08,
  VAL_MINERAL: 0.04,
  VAL_WOOD: 0.06,
  K: [-0.08, -0.02, 0.03],
  K_WOOD: [0.03, 0.0, -0.03],
  DIRT_LO: 0.6,
  DIRT_HI: 0.85,
  DIRT_MAX: 0.35,
  DIRT_RGB: [0.42, 0.31, 0.21],
  TURF_LO: 0.5,
  TURF_HI: 0.78,
  TURF_RGB: [0.55, 0.8, 0.52],
  P_MACRO_A: 96,
  P_MACRO_B: 157,
  MACRO_VAL: 0.6,
  MACRO_K: [-0.15, -0.04, 0.06],
}

/**
 * GRASS-GRADIENT fix — live-QA + top-down screenshot showed "too repetitive and not uniform
 * enough for a global terrain gradient, like veloren". STRUCTURAL FIX (this round): the first attempt
 * (kept in git history) scaled the EXISTING NG-TINT vfield (VAL_GRASS/K) — mathematically dead, because
 * that field mixes 60/40 with the 13-block DETAIL octave before the grad scale ever applies, so even the
 * loudest rung (±28% value) moved final luminance only ~0.6% (measured mean |Δpixel| a→c = 0.84/255 at
 * this framing) — real but drowned by texture/lighting variance. `val`/`hue` now scale a
 * DEDICATED macro octave (NG_TINT.P_MACRO_A/B + MACRO_VAL/MACRO_K, see terrain_tint.js) applied directly
 * to grass-class albedo OUTSIDE the diluted vfield mix. `a` is {val:0, hue:0} — the octave is OFF, and
 * its node graph is skipped entirely at material-build time, so the default is byte-identical AND
 * zero-cost.
 *
 * CALIBRATION NOTE (this round's own measurement + a side-by-side visual check — the strongest oracle):
 * a first pass kept `hue` a "whisper" fraction of `val` (mirroring the OLD ladder's convention, back when
 * K and VAL_GRASS coincidentally shared one ceiling) at MACRO_VAL=0.35/MACRO_K max 0.05 — the pixel-diff
 * gate measured b at 1.6% (missed the ≥2% floor) and c→d NON-MONOTONIC (2.93%→2.86%), and a→d side by
 * side were visually indistinguishable. Root cause: the engine's auto-exposure compensates for
 * AVERAGE-luminance shifts, capping how far a pure brightness lever can move the displayed frame — but it
 * does NOT correct hue/color-balance. This round leans on BOTH: MACRO_VAL raised to 0.6, and MACRO_K
 * raised ~3× (whisper → a real, visible warm-dry/cool-lush color swing) — `val`/`hue` now ride the SAME
 * fraction per level (one knob, not two independently-tuned ones, since there's no evidence yet they
 * should differ) so the ladder is simpler to reason about. Mineral (stone/sand/snow) stays untouched at
 * every level.
 * @type {Readonly<Record<'a'|'b'|'c'|'d', Readonly<{val: number, hue: number}>>>}
 */
export const GRASS_GRADIENT_LEVELS = {
  a: { val: 0, hue: 0 }, // OFF — the dedicated octave's node graph isn't even built (byte-identical + zero-cost)
  b: { val: 0.35, hue: 0.35 }, // subtle, real macro gradient: value swing ±0.21, hue ceiling ±0.0525
  c: { val: 0.65, hue: 0.65 }, // stronger: ±0.39 / ±0.0975
  d: { val: 1.0, hue: 1.0 }, // LOUD rung (full ceiling): ±0.6 / ±0.15
}

/**
 * Resolves the `?grassgrad=` URL value to a valid level key. Default `a` for anything absent or
 * unrecognized (no default change until an explicit pick).
 * @param {string|null|undefined} raw @returns {'a'|'b'|'c'|'d'}
 */
export function resolve_grass_gradient_level(raw) {
  return raw === 'b' || raw === 'c' || raw === 'd' ? raw : 'a'
}

/**
 * Per-family PBR response. metalness is LOCKED at 0 everywhere (never reads as metal) —
 * we never set metalnessNode, so specular stays neutral dielectric (MeshStandard default F0, no tint).
 * `rough` = per-family base roughness; grass-family dips toward gloss on HUMID patches (dew "shiny
 * sometimes") by `humid_dip` and roughens when dry; sand ripples ±`sand_ripple` from the fine octave so
 * its specular isn't uniform. Result clamped to [`min`, 1].
 * @type {Readonly<{metalness:number,rough:Record<string,number>,humid_dip:number,sand_ripple:number,min:number}>}
 */
// D164 PER-TYPE MATERIAL RESPONSE (tier A — FREE, registry→material path): roughness per
// mapped family so light reads the surface's CHARACTER at zero cost. matte bark (log 0.9), SATIN leaves
// (0.68 — canopy catches a soft sheen vs dead-matte dirt), damp mossy_stone slight sheen (0.62), dead-matte
// dry stone (0.82, up from 0.75). leaves_conifer/leaves_dry inherit the satin leaf response (name entries).
// metalness stays LOCKED 0 (never reads as metal); this only tunes the dielectric roughness.
export const TERRAIN_PBR = {
  metalness: 0,
  rough: {
    stone: 0.82,
    dirt: 0.9,
    grass: 0.85,
    sand: 0.55,
    leaves: 0.68,
    leaves_conifer: 0.7,
    leaves_dry: 0.72,
    foliage: 0.8,
    log: 0.9,
    snow: 0.7,
    cave_stone: 0.82,
    mossy_stone: 0.62,
    default: 0.85,
  },
  humid_dip: 0.15,
  sand_ripple: 0.05,
  min: 0.35,
}

/** Per-octave u32 salt (decorrelates the octaves — indices 0/1 the moisture/detail pair, 2/3 the
 * dedicated macro-gradient pair P_MACRO_A/B). @type {number[]} */
export const TINT_SALT = [0x9e3779b1 >>> 0, 0x85ebca77 >>> 0, 0xc2b2ae3d >>> 0, 0x27d4eb2f >>> 0]

/** Green foliage that takes the biome macro hue (canopy tint class 2). D164: the two species leaf variants
 * join broadleaf so a mixed forest tints as one with the ground; each keeps its baked base lean (conifer
 * dark, dry straw) while taking the humid↔dry climate K. @type {ReadonlySet<string>} */
export const CANOPY_TINT_NAMES = new Set([
  'leaves',
  'leaves_conifer',
  'leaves_dry',
  'grass_tuft',
  'tall_grass',
  'reed',
  'fern',
])

/**
 * NG-TINT class for a block: 0 none · 1 mineral (value-only) · 2 canopy (hue+value) · 3 grass-ground
 * (hue+value+dirty-patches). Flowers stay mineral so the macro hue never touches the red/purple heads.
 * @param {import('../config/block_registry.js').BlockDef} b @returns {number}
 */
export function tint_class_of(b) {
  if (b.name === 'grass') return 3
  // Canopy hue+value: leaves + the GREEN cross-flora (the grass ocean — short tufts, tall_grass,
  // shore reeds, forest-floor fern) all take the biome macro hue so the whole meadow tints as ONE
  // with the grass ground beneath it. Flowers are EXCLUDED (fall through to mineral) — the macro hue
  // must not wash their coloured heads (the DIVERGENCE-WAVE flora share class 'foliage' with flowers,
  // so this is a name set, not a class test).
  if (CANOPY_TINT_NAMES.has(b.name)) return 2
  if (b.class === 'liquid' || b.class === 'air' || b.name === 'glowstone') return 0
  return 1
}

/** Per-family base roughness (see TERRAIN_PBR). @param {import('../config/block_registry.js').BlockDef} b @returns {number} */
export function base_roughness_of(b) {
  if (b.class === 'foliage') return TERRAIN_PBR.rough.foliage
  return TERRAIN_PBR.rough[b.name] ?? TERRAIN_PBR.rough.default
}

/**
 * STRAW-TIP RATIO — dry zones must NOT saturate to all-straw ("uniform pale forest"). The
 * cross-grass fragment biases its per-plant variant pick toward the DRY (straw-tipped) half by mixing the
 * raw per-cell hash 50/50 with `straw_tip_ratio(moisture)`: h_biased = 0.5·h + 0.5·ratio. Because h is
 * uniform, the STRAW SHARE (h_biased ≥ 0.5, the top half of the baked green→dry variant ramp) equals the
 * ratio EXACTLY — so this fn IS the straw fraction. It ramps BASE (humid green floor) → BASE+SPAN (arid),
 * clamped to CAP so the driest zone is at most CAP straw and never 1.0.
 * @type {Readonly<{BASE:number,SPAN:number,CAP:number}>} */
export const STRAW_TIP = { BASE: 0.15, SPAN: 0.45, CAP: 0.6 }

/**
 * Pure JS mirror of the cross-grass straw-share ramp (see STRAW_TIP) — the tested twin of the material's
 * TSL. @param {number} moisture macro moisture [0,1] @returns {number} straw share in [0, STRAW_TIP.CAP] */
export function straw_tip_ratio(moisture) {
  const dry = 1 - Math.min(1, Math.max(0, moisture))
  return Math.min(STRAW_TIP.CAP, Math.max(0, STRAW_TIP.BASE + dry * STRAW_TIP.SPAN))
}

/** Re-exported so consumers importing tint data don't also need to reach into block_registry. */
export { BLOCK_REGISTRY }
