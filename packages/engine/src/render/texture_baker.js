// Procedural block-texture atlas baker (§3.6) — CPU-side, Canvas-FREE, headless. Bakes N RGBA layers/
// recipe into one flat Uint8Array [layer][row][col][rgba] for a three DataArrayTexture. Deterministic:
// same seed ⇒ byte-identical (integer FNV/splitmix hash only; Math.sin/cos/random BANNED). Recipes are
// DATA in texture_recipes.js (Conquest dark-faded palette); extend ops via an OP_TABLE + RecipeOp entry.

import { get_block_by_name } from '../config/block_registry.js'

import { RECIPES } from './texture_recipes.js'
import { apply_texture_config } from './texture_palette.js'
import { FLORA_OPS } from './texture_ops_flora.js'
import { GATHER_OPS } from './texture_ops_gather.js'
import {
  clamp,
  fbm_field,
  for_pixel,
  hash01,
  lattice_sample,
  lerp,
  mul_rgb,
  noise_lattice,
  ramp_color,
  smooth,
  value_noise_1d,
  worley,
} from './texture_noise.js'

/** Painterly bound: grain/fbm brightness swing clamped to ±15% (no recipe drifts into noisy territory). @type {number} */
export const GRAIN_MAX_AMPLITUDE = 0.15

/**
 * TEXTURE-ARRAY LAYER CEILING — one home for two coupled facts:
 *   (1) the `maxTextureArrayLayers` the renderer REQUESTS at WebGPU device acquisition (core/renderer.js),
 *   (2) the build-time ceiling texture_baker.test.js asserts the live atlas layer count stays under.
 * The WebGPU/WebGL2 DEFAULT (and spec MINIMUM) limit is 256; the block atlas already bakes
 * atlas_layer_count() layers into ONE DataArrayTexture (currently 357 — past the default), so on adapters
 * that offer MORE the device is asked for a higher limit. But a spec-MINIMUM adapter (mobile) caps at 256 <
 * 357 and CANNOT grant more — there `bake_block_textures({ max_layers })` bakes a REDUCED atlas that fits
 * (fit_layer_plan), so the world still renders (mild tiling) instead of a black GPUValidationError. The
 * renderer requests min(adapter max, this) — so this constant caps BOTH the requested device limit AND the
 * test ceiling to the SAME value: they cannot drift, and growing the atlas past what we request fails a RED
 * TEST here instead of a black screen at runtime. Bump it (re-confirming target adapters provide it — desktop
 * targets expose 2048) when a wave legitimately needs more layers. @type {number} */
export const MAX_ATLAS_LAYERS = 512

/**
 * @typedef {object} RampStop
 * @property {number} pos 0..1 position along the ramp axis
 * @property {[number, number, number]} rgb 0..255 colour at this stop
 *
 * @typedef {object} RecipeOp
 * @property {string} op op name (dispatched via OP_TABLE)
 * @property {RampStop[]} [stops] ramp: ordered colour stops (ascending pos)
 * @property {'v'|'h'|'radial'} [axis] ramp: gradient axis (default 'v')
 * @property {number} [freq] grain/worley/speckle/streaks/fbm: cells across the texture (integer)
 * @property {number} [amp] grain/fbm: brightness swing (clamped to GRAIN_MAX_AMPLITUDE)
 * @property {number} [strength] worley/streaks/clumps: darken/blend strength 0..1
 * @property {number} [bias] ao: fBm valley threshold (higher ⇒ only deepest valleys darken; default 0.5)
 * @property {number} [threshold] worley: crack half-width; clumps: mask cutoff
 * @property {number} [width] border_darken: ring width in px
 * @property {number} [amount] border_darken: edge darken 0..1
 * @property {number} [density] speckle/cluster_speckle: fleck rate 0..1
 * @property {number} [darken] speckle/cluster_speckle: darken factor or blend weight toward `rgb`
 * @property {[number, number, number]} [rgb] speckle/clumps blend target / blades colour
 * @property {'x'|'y'} [dir] streaks: axis value varies along ('x' ⇒ vertical streaks)
 * @property {number} [count] blades: number of blades
 * @property {number} [min_h] blades: min blade height as a fraction of size (default 0.45)
 * @property {number} [span_h] blades: extra hashed height span as a fraction of size (default 0.45)
 * @property {number} [spread] blades: blade-width multiplier (default 1; >1 = broad fronds, <1 = reeds)
 * @property {[number, number, number]} [tip_rgb] blades: dry/sun-bleached TOP colour (default: yellow tips); omitted ⇒ solid `rgb`
 * @property {[number, number, number]} [tip_rgb2] blades: far end of the straw-hue range — tip lerps tip_rgb↔tip_rgb2 per-blade (2-3 straw tones)
 * @property {number} [tip_start] blades: height fraction (0-1) where the tip fade begins (default 0.45)
 * @property {number} [hole] leaf (op_leaf): target transparent HOLE fraction 0..0.85 (canopy lacework density)
 * @property {[number, number, number]} [rgb_dark] leaf: shaded-pocket leaf tone (ramp low)
 * @property {[number, number, number]} [rgb_light] leaf: sun-dappled leaf tone (ramp high)
 * @property {[number, number, number]} [vein_rgb] leaf: dark leaf-edge / inner-gap tone (hole rim)
 * @property {[number, number, number]} [top_white] leaf (D164-B): snow-dust tone blended into the TOP band (omit ⇒ no snow cap)
 * @property {number} [top_frac] leaf (D164-B): fraction of the tile (from the plane top) that dusts white (default 0.3)
 * @property {[number, number, number]} [head_rgb] flower head colour
 * @property {[number, number, number]} [stem_rgb] flower stem colour
 * @property {number} [radius] flower head radius in px
 * @property {[number, number, number]} [rim_rgb] grass_rim lip colour
 * @property {number} [base_h] grass_rim: avg rim depth from top edge (px)
 * @property {number} [jitter] grass_rim: ± boundary jitter (px)
 * @property {number} [feather] grass_rim: soft transition band below boundary (px, default 3)
 * @property {number} [octaves] fbm/clumps/cluster_speckle: octave count (default 4/3/2)
 * @property {number} [soft] clumps: patch-edge feather in mask units (default 0.25)
 * @property {number} [cluster_freq] cluster_speckle: patch-envelope frequency
 *
 * @typedef {object} Recipe
 * @property {string} name recipe key → layer + default block name
 * @property {string[]} [blocks] registry block names served (default [name])
 * @property {number} [alpha] opaque base alpha 0..255 (default 255; water 200)
 * @property {boolean} [alpha_clip] true ⇒ transparent bg (alpha 0), shape ops paint alpha 255
 * @property {number} [variants] decorrelated phase copies (default 1); material hash-picks one/cell
 * @property {number[]} [rotations] 90° rotations (deg) each baked as an extra variant layer; total = `variants` × len
 * @property {RecipeOp[]} ops ordered recipe ops
 *
 * @typedef {object} BakeResult
 * @property {Uint8Array} albedo RGBA bytes, layout [layer][row][col][rgba], length layers*size*size*4
 * @property {Map<number, number>} layer_of block id → BASE atlas layer index (variant 0; registry blocks only)
 * @property {Map<string, number>} layer_of_name recipe name → BASE atlas layer index (all baked recipes)
 * @property {Map<string, number>} variants_of_name recipe name → variant count (≥1); material picks base+hash%count
 * @property {Map<string, number>} rotations_of_name recipe name → BAKED rotation count (≥1, divides variants_of_name
 *   exactly — layers are phase-major/rotation-minor, see the bake loop below); lets a material split the flattened
 *   variant offset back into independent phase/rotation picks (terrain_texture_variant.js coherent-patch selection)
 * @property {number} layers total layer count (Σ variants over all recipes)
 * @property {number} size texture edge length in px
 */

// Pure noise/math helpers (hash/clamp/lerp/smooth/lattice/fbm/worley/ramp/pixel) live in texture_noise.js
// (2026-07-05 ≤600-LoC split — extracted VERBATIM, byte-identical). Imported here + by the flora shape ops.

/** @param {Float32Array} buf @param {number} size @param {number} _seed @param {number} _layer @param {RecipeOp} op */
function op_ramp(buf, size, _seed, _layer, op) {
  const stops = op.stops ?? []
  if (!stops.length) return
  const axis = op.axis ?? 'v'
  const c = (size - 1) / 2
  const max_r = Math.sqrt(c * c + c * c) || 1
  for_pixel(size, (x, y, i) => {
    let t
    if (axis === 'radial') t = Math.sqrt((x - c) * (x - c) + (y - c) * (y - c)) / max_r
    else if (axis === 'h') t = x / (size - 1)
    else t = y / (size - 1)
    const [r, g, b] = ramp_color(stops, clamp(t, 0, 1))
    buf[i] = r
    buf[i + 1] = g
    buf[i + 2] = b
  })
}

/** @param {Float32Array} buf @param {number} size @param {number} seed @param {number} layer @param {RecipeOp} op */
function op_grain(buf, size, seed, layer, op) {
  const freq = op.freq ?? 6
  const amp = Math.min(op.amp ?? 0.1, GRAIN_MAX_AMPLITUDE)
  const g = noise_lattice(freq, seed, layer, 0)
  for_pixel(size, (x, y, i) => mul_rgb(buf, i, 1 + (2 * lattice_sample(g, freq, x, y, size) - 1) * amp))
}

/** Multi-scale ISOTROPIC brightness mottle — ×[1−amp,1+amp] from a toroidal fBm field (no directional
 * ramp ⇒ organic clumps not stripes; `amp` clamped to the ceiling). @param {Float32Array} buf @param {number} size @param {number} seed @param {number} layer @param {RecipeOp} op */
function op_fbm(buf, size, seed, layer, op) {
  const freq = op.freq ?? 4
  const octaves = op.octaves ?? 4
  const amp = Math.min(op.amp ?? 0.12, GRAIN_MAX_AMPLITUDE)
  const field = fbm_field(size, freq, octaves, seed, layer, 30)
  for_pixel(size, (x, y, i) => mul_rgb(buf, i, 1 + (2 * field[y * size + x] - 1) * amp))
}

/** Organic dark/light PATCHES: blend toward `rgb` by up to `strength` where a low-freq fBm mask exceeds
 * `threshold`, feathered over `soft` (non-axis-aligned mottle). @param {Float32Array} buf @param {number} size @param {number} seed @param {number} layer @param {RecipeOp} op */
function op_clumps(buf, size, seed, layer, op) {
  const freq = op.freq ?? 3
  const octaves = op.octaves ?? 3
  const rgb = op.rgb ?? [0, 0, 0]
  const threshold = op.threshold ?? 0.5
  const soft = op.soft ?? 0.25
  const strength = op.strength ?? 0.2
  const field = fbm_field(size, freq, octaves, seed, layer, 40)
  for_pixel(size, (x, y, i) => {
    const w = clamp((field[y * size + x] - threshold) / (soft || 1), 0, 1) * strength
    if (w <= 0) return
    buf[i] = lerp(buf[i], rgb[0], w)
    buf[i + 1] = lerp(buf[i + 1], rgb[1], w)
    buf[i + 2] = lerp(buf[i + 2], rgb[2], w)
  })
}

/** CLUSTERED speckle: flecks only where a low-freq fBm mask is high ⇒ grouped patches not uniform salt
 * (`cluster_freq` sizes patches, `density` the within-patch rate, `darken` toward `rgb` or multiplicative).
 * @param {Float32Array} buf @param {number} size @param {number} seed @param {number} layer @param {RecipeOp} op */
function op_cluster_speckle(buf, size, seed, layer, op) {
  const cluster_freq = op.cluster_freq ?? 4
  const density = op.density ?? 0.35
  const darken = op.darken ?? 0.18
  const { rgb } = op
  const mask_field = fbm_field(size, cluster_freq, 2, seed, layer, 50) // patch envelope, computed once
  for_pixel(size, (x, y, i) => {
    const mask = mask_field[y * size + x]
    if (mask < 0.5) return // outside a cluster: no flecks
    const local = clamp((mask - 0.5) * 2, 0, 1) // 0 at patch rim → 1 at patch core
    if (hash01(x, y, seed, layer, 51) >= density * local) return
    if (rgb) {
      buf[i] = lerp(buf[i], rgb[0], darken)
      buf[i + 1] = lerp(buf[i + 1], rgb[1], darken)
      buf[i + 2] = lerp(buf[i + 2], rgb[2], darken)
    } else {
      mul_rgb(buf, i, 1 - darken)
    }
  })
}

/** @param {Float32Array} buf @param {number} size @param {number} seed @param {number} layer @param {RecipeOp} op */
function op_worley(buf, size, seed, layer, op) {
  const freq = op.freq ?? 5
  const strength = op.strength ?? 0.3
  const threshold = op.threshold ?? 0.08
  for_pixel(size, (x, y, i) => {
    const [f1, f2] = worley(x, y, size, freq, seed, layer)
    const crack = clamp(1 - (f2 - f1) / threshold, 0, 1)
    if (crack > 0) mul_rgb(buf, i, 1 - strength * crack)
  })
}

/** D159/ENG-22 within-texel AO — CREVICE darkening: multiplies RGB down where a mid-freq toroidal fBm
 * field sits LOW (valleys between raised grain) ⇒ shadowed contact-grime depth (Conquest tell: value
 * spreads, hue holds). `amp` = max darken at a pure valley; `bias` = valley threshold. Pairs UNDER the
 * fine grain. @param {Float32Array} buf @param {number} size @param {number} seed @param {number} layer @param {RecipeOp} op */
function op_ao(buf, size, seed, layer, op) {
  const freq = op.freq ?? 5
  const octaves = op.octaves ?? 3
  const amp = clamp(op.amp ?? 0.22, 0, 0.6)
  const bias = op.bias ?? 0.5
  const field = fbm_field(size, freq, octaves, seed, layer, 60)
  for_pixel(size, (x, y, i) => {
    // Darken proportional to how far BELOW `bias` the field sits (0 at/above bias → full at field=0).
    const shade = clamp((bias - field[y * size + x]) / (bias || 1), 0, 1)
    if (shade > 0) mul_rgb(buf, i, 1 - amp * shade)
  })
}

/** @param {Float32Array} buf @param {number} size @param {number} _seed @param {number} _layer @param {RecipeOp} op */
function op_border_darken(buf, size, _seed, _layer, op) {
  const width = op.width ?? 2
  const amount = op.amount ?? 0.2
  for_pixel(size, (x, y, i) => {
    const d = Math.min(x, y, size - 1 - x, size - 1 - y)
    if (d < width) mul_rgb(buf, i, 1 - amount * (1 - d / width))
  })
}

/** Grass-rim overlay (grass_side): blends `rim_rgb` over the TOP rows to a noise-broken, feathered
 * boundary `base_h`±`jitter` px deep — a grass lip on a dirt tile. @param {Float32Array} buf @param {number} size @param {number} seed @param {number} layer @param {RecipeOp} op */
function op_grass_rim(buf, size, seed, layer, op) {
  const rim_rgb = op.rim_rgb ?? [104, 152, 68]
  const base_h = op.base_h ?? Math.round(size * 0.08)
  const jitter = op.jitter ?? Math.round(size * 0.05)
  const feather = op.feather ?? 3
  const freq = op.freq ?? 9
  for (let x = 0; x < size; x += 1) {
    // Two-octave boundary (freq + 2·freq) ⇒ noise-BROKEN lip edge (a clean rim line reads as the grid).
    const n =
      0.65 * value_noise_1d(x, size, freq, seed, layer, 11) + 0.35 * value_noise_1d(x, size, freq * 2, seed, layer, 12)
    const depth = base_h + (2 * n - 1) * jitter
    for (let y = 0; y < size; y += 1) {
      if (y > depth + feather) break
      const w = clamp((depth + feather - y) / feather, 0, 1) // feather over `feather` px (was 1px hard step)
      const i = (y * size + x) * 4
      buf[i] = lerp(buf[i], rim_rgb[0], w)
      buf[i + 1] = lerp(buf[i + 1], rim_rgb[1], w)
      buf[i + 2] = lerp(buf[i + 2], rim_rgb[2], w)
    }
  }
}

/** @param {Float32Array} buf @param {number} size @param {number} seed @param {number} layer @param {RecipeOp} op */
function op_speckle(buf, size, seed, layer, op) {
  const density = op.density ?? 0.06
  const darken = op.darken ?? 0.15
  const { rgb } = op
  const { freq } = op
  const g = freq ? noise_lattice(freq, seed, layer, 3) : null
  for_pixel(size, (x, y, i) => {
    // freq set ⇒ coherent value-noise patches (painterly two-tone); else sparse per-pixel flecks.
    const r = g ? lattice_sample(g, /** @type {number} */ (freq), x, y, size) : hash01(x, y, seed, layer, 7)
    if (r >= density) return
    if (rgb) {
      buf[i] = lerp(buf[i], rgb[0], darken)
      buf[i + 1] = lerp(buf[i + 1], rgb[1], darken)
      buf[i + 2] = lerp(buf[i + 2], rgb[2], darken)
    } else {
      mul_rgb(buf, i, 1 - darken)
    }
  })
}

/** @param {Float32Array} buf @param {number} size @param {number} seed @param {number} layer @param {RecipeOp} op */
function op_streaks(buf, size, seed, layer, op) {
  const freq = op.freq ?? 8
  const strength = op.strength ?? 0.15
  const dir = op.dir ?? 'x'
  for_pixel(size, (x, y, i) => {
    const n = value_noise_1d(dir === 'x' ? x : y, size, freq, seed, layer, 5)
    mul_rgb(buf, i, 1 - strength * (1 - n))
  })
}

/** Paint a pixel solid at alpha 255 (alpha-clip shapes). @param {Float32Array} buf @param {number} size @param {number} x @param {number} y @param {number} r @param {number} g @param {number} b */
function paint(buf, size, x, y, r, g, b) {
  if (x < 0 || x >= size || y < 0 || y >= size) return
  const i = (y * size + x) * 4
  buf[i] = clamp(r, 0, 255)
  buf[i + 1] = clamp(g, 0, 255)
  buf[i + 2] = clamp(b, 0, 255)
  buf[i + 3] = 255
}

/**
 * Alpha-clip tuft: tapered vertical blades from the bottom, each hashed (pos/height/lean/tint); bg stays
 * transparent. @param {Float32Array} buf @param {number} size @param {number} seed @param {number} layer @param {RecipeOp} op
 */
function op_blades(buf, size, seed, layer, op, variant_index = 0, variant_count = 1) {
  const count = op.count ?? 6
  const rgb = op.rgb ?? [96, 152, 72]
  // Silhouette knobs (defaults = the original grass-tuft blade): broad fronds (fern) raise `spread`/lower
  // `min_h`; tall reeds raise `min_h`/lower `spread`.
  const min_h = op.min_h ?? 0.45
  const span_h = op.span_h ?? 0.45
  const spread = op.spread ?? 1
  // TIP GRADIENT (yellow tips unless humid): each blade lerps rgb→tip_rgb above tip_start, GRADUATED
  // across variants (0 = green … last = dry) so the material biases the per-cell pick by macro moisture.
  const tip = op.tip_rgb ?? null
  const tip2 = op.tip_rgb2 ?? null // straw-hue range far end (pale-cream↔ochre variety)
  const tip_start = op.tip_start ?? 0.45
  const dryness = variant_count > 1 ? variant_index / (variant_count - 1) : 1 // 0 green … 1 fully dry
  for (let b = 0; b < count; b += 1) {
    const base_x = hash01(b, seed, layer, 20) * (size - 1)
    const height = Math.floor(size * (min_h + hash01(b, seed, layer, 21) * span_h))
    const base_half = (1 + hash01(b, seed, layer, 22) * 1.5) * spread
    const lean = (hash01(b, seed, layer, 23) * 2 - 1) * size * 0.18
    const tint = 0.82 + hash01(b, seed, layer, 24) * 0.32
    // Per-blade straw hue: lerp tip_rgb→tip_rgb2 by a per-blade hash so a dry stand mixes 2-3 straw tones.
    const tip_mix = tip2 ? hash01(b, seed, layer, 25) : 0
    const btip = tip
      ? [
          tip[0] + ((tip2?.[0] ?? tip[0]) - tip[0]) * tip_mix,
          tip[1] + ((tip2?.[1] ?? tip[1]) - tip[1]) * tip_mix,
          tip[2] + ((tip2?.[2] ?? tip[2]) - tip[2]) * tip_mix,
        ]
      : null
    for (let yy = 0; yy < height; yy += 1) {
      const t = yy / height
      const half = base_half * (1 - t)
      const cx = base_x + lean * t
      const py = size - 1 - yy
      // Per-pixel colour: base green, optionally fading to the (per-blade) dry tip above tip_start.
      let [cr, cg, cb] = rgb
      if (btip && dryness > 0) {
        const k = (t <= tip_start ? 0 : (t - tip_start) / (1 - tip_start)) * dryness
        cr = rgb[0] + (btip[0] - rgb[0]) * k
        cg = rgb[1] + (btip[1] - rgb[1]) * k
        cb = rgb[2] + (btip[2] - rgb[2]) * k
      }
      for (let dx = -Math.ceil(half); dx <= Math.ceil(half); dx += 1) {
        if (Math.abs(dx) > half + 0.001) continue
        paint(buf, size, Math.round(cx + dx), py, cr * tint, cg * tint, cb * tint)
      }
    }
  }
}

/** Alpha-clip flower: centred stem + round head near top; bg transparent. @param {Float32Array} buf @param {number} size @param {number} _seed @param {number} _layer @param {RecipeOp} op */
function op_flower(buf, size, _seed, _layer, op) {
  const head_rgb = op.head_rgb ?? [200, 60, 60]
  const stem_rgb = op.stem_rgb ?? [70, 120, 55]
  const radius = op.radius ?? Math.round(size * 0.14)
  const cx = Math.floor(size / 2)
  const head_cy = Math.floor(size * 0.34)
  for (let y = head_cy; y < size; y += 1) {
    for (let dx = -1; dx <= 1; dx += 1) paint(buf, size, cx + dx, y, stem_rgb[0], stem_rgb[1], stem_rgb[2])
  }
  for (let dy = -radius; dy <= radius; dy += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      if (dx * dx + dy * dy > radius * radius) continue
      const k = 1 - (0.18 * (dx * dx + dy * dy)) / (radius * radius) // soft centre highlight (non-flat head)
      paint(buf, size, cx + dx, head_cy + dy, head_rgb[0] * k, head_rgb[1] * k, head_rgb[2] * k)
    }
  }
}

/** D164 ALPHA-CUTOUT CANOPY LEAF — the single biggest realism lever (holes → lacework depth). Alpha-clip:
 * a two-octave toroidal fBm FOLIAGE MASK decides opacity per texel — above `keep` ⇒ opaque leaf (alpha
 * 255), below ⇒ a HOLE (stays transparent bg) — so the leaf cube face reads as a clustered leaf mass with
 * sky punched through (~`hole` fraction of the tile). Opaque texels are multi-tone: a SECOND fBm field
 * ramps rgb_dark↔rgb_light (sun-dappled vs shaded leaves), a per-cluster darker VEIN edge (where the mask
 * sits just above `keep`) reads as leaf gaps/shadow, and fine grain adds tooth. Per-species: `hole` (mask
 * coverage — conifer denser ~0.35, broadleaf ~0.42, dry sparser ~0.5), the 3 green tones, `vein_rgb`.
 * Deterministic (fbm_field/hash01). Wraps mod freq ⇒ the cutout tiles seamlessly across a merged canopy
 * quad under hardware Repeat. @param {Float32Array} buf @param {number} size @param {number} seed @param {number} layer @param {RecipeOp} op */
function op_leaf(buf, size, seed, layer, op) {
  const rgb = op.rgb ?? [70, 104, 52] // mid leaf green (opaque body)
  const rgb_dark = op.rgb_dark ?? [46, 74, 38] // shaded-pocket leaves
  const rgb_light = op.rgb_light ?? [104, 138, 74] // sun-dappled leaves
  const vein_rgb = op.vein_rgb ?? [34, 52, 28] // dark leaf-edge / inner gap
  const top_white = op.top_white ?? null // [D164-B] snow-dust tone for the TOP band (null ⇒ no snow cap)
  const top_frac = op.top_frac ?? 0.3 // fraction of the tile height (from the rendered plane TOP) that dusts white
  const hole = clamp(op.hole ?? 0.42, 0, 0.85) // target transparent fraction
  const freq = op.freq ?? 6 // foliage-cluster scale
  const octaves = op.octaves ?? 3
  // The mask KEEP threshold is `hole` directly: an fBm field is ~uniform on [0,1], so texels below `hole`
  // (the low fraction ≈ hole) become holes and the rest stays leaf. `edge` is the thin band just above the
  // cutoff that reads as the darker leaf rim/vein.
  const keep = hole
  const edge = 0.1
  const mask = fbm_field(size, freq, octaves, seed, layer, 70) // opacity/cluster field
  const tone = fbm_field(size, freq * 2, 2, seed, layer, 71) // dark↔light leaf shading (finer)
  // MULTI-CLUMP SILHOUETTE (fixes the "crossed planes" leaf-silhouette defect) —
  // the old single radial erosion left ONE contiguous scalloped oval per tile, so at touching distance each
  // sprite plane still read as a huge card. The alpha now survives only near 4 hash-placed LOBES (one per
  // tile quadrant, jittered ±0.15, radius 0.20-0.32 — deterministic per seed/layer, so the 3 phase variants
  // each get their own layout), with DEEP concave notches between them and the fbm mask still ragging every
  // fringe — a plane reads as a loose handful of leaf bunches, never one card with an outline. The literal
  // 1-texel border is killed OUTRIGHT (alpha 0 on all four edges): the hardware-Repeat bilinear bleed
  // (mip-seam law) then blends transparent with transparent, and no straight quad edge can ever survive.
  /** @type {{ cx: number, cy: number, r: number }[]} one lobe per quadrant (uv space) */
  const lobes = []
  for (let k = 0; k < 4; k += 1) {
    const qx = (k & 1) * 0.5 + 0.25
    const qy = (k >> 1) * 0.5 + 0.25
    lobes.push({
      cx: qx + (hash01(k, 1, seed, layer, 74) - 0.5) * 0.3,
      cy: qy + (hash01(k, 2, seed, layer, 74) - 0.5) * 0.3,
      r: 0.2 + hash01(k, 3, seed, layer, 74) * 0.12,
    })
  }
  for_pixel(size, (x, y, i) => {
    if (x === 0 || y === 0 || x === size - 1 || y === size - 1) return // border ring: ALWAYS a hole (wrap-bleed guarantee)
    const ux = (x + 0.5) / size
    const uy = (y + 0.5) / size
    let d_min = Infinity
    for (const l of lobes) {
      const d = Math.hypot(ux - l.cx, uy - l.cy) / l.r
      if (d < d_min) d_min = d
    }
    // Inside a lobe core (d ≤ 0.62·r): a KEEP-PROPORTIONAL density boost (keep·0.25, fading with erosion)
    // keeps the clump heart a coherent leaf bunch — sparse species (dry, hole 0.52) get the most help
    // (pure subtraction left them a skeletal speckle) while dense species (conifer, hole 0.30) keep their
    // interior lacework holes (the D164 sky-through-canopy lever). Past ~1.12·r: full kill (−1.1 clears
    // any mask value). The ramp between is where the fbm mask decides — a ragged fringe, never a circle.
    const erode = clamp((d_min - 0.62) / 0.5, 0, 1)
    const core = 1 - erode
    const m = mask[y * size + x] + core * core * keep * 0.25 - erode * erode * 1.1
    if (m < keep) return // HOLE — leave the transparent background (alpha 0)
    // Opaque leaf texel: shade dark↔light by the tone field, darken toward the vein in the thin edge band.
    const t = tone[y * size + x]
    let r = lerp(rgb_dark[0], rgb_light[0], t),
      g = lerp(rgb_dark[1], rgb_light[1], t),
      b = lerp(rgb_dark[2], rgb_light[2], t)
    const rim = clamp(1 - (m - keep) / edge, 0, 1) // 1 at the hole rim → 0 inside the cluster
    if (rim > 0) {
      r = lerp(r, vein_rgb[0], rim * 0.7)
      g = lerp(g, vein_rgb[1], rim * 0.7)
      b = lerp(b, vein_rgb[2], rim * 0.7)
    }
    // Fine per-texel grain tooth (± up to the painterly bound), nudged by the base `rgb` mid tone.
    const grain = 0.88 + hash01(x, y, seed, layer, 72) * 0.24
    let fr = (r + rgb[0]) * 0.5 * grain,
      fg = (g + rgb[1]) * 0.5 * grain,
      fb = (b + rgb[2]) * 0.5 * grain
    // [D164-B WHITE TOP — leaf textures must be white on top] Snow-dust the upper `top_frac` of the
    // tile toward `top_white` (the rendered cross-plane UV is uv.y = 1−corner_v, so the plane TOP = small y),
    // with a per-column NOISE-RAGGED edge — not a hard line. Only opaque leaf texels dust (holes already
    // returned), so snow follows the needled silhouette. Every taiga (conifer) plane reads snow-capped free.
    if (top_white) {
      const line =
        top_frac * size * (0.55 + 0.9 * value_noise_1d(x, size, Math.max(3, Math.round(freq)), seed, layer, 73))
      const w = clamp((line - y) / (top_frac * size * 0.5 + 1), 0, 1) // feather below the ragged snow line
      if (w > 0) {
        fr = lerp(fr, top_white[0], w)
        fg = lerp(fg, top_white[1], w)
        fb = lerp(fb, top_white[2], w)
      }
    }
    paint(buf, size, x, y, fr, fg, fb)
  })
}

/** Op dispatch table — all share `(buf,size,seed,layer,op[,variant_index,variant_count])`; unknown op =
 * no-op. Only op_blades reads the trailing variant args (tip-dryness ramp); the rest ignore extra args.
 * @type {Record<string, (buf: Float32Array, size: number, seed: number, layer: number, op: RecipeOp, variant_index?: number, variant_count?: number) => void>} */
const OP_TABLE = {
  ramp: op_ramp,
  grain: op_grain,
  fbm: op_fbm,
  clumps: op_clumps,
  cluster_speckle: op_cluster_speckle,
  worley: op_worley,
  ao: op_ao,
  border_darken: op_border_darken,
  grass_rim: op_grass_rim,
  speckle: op_speckle,
  streaks: op_streaks,
  blades: op_blades,
  flower: op_flower,
  leaf: op_leaf,
  ...FLORA_OPS, // VIVID-WORLD flora sprite ops (bush/branch/shell/starfish/…) — disjoint from base op names
  ...GATHER_OPS, // §5 gatherable sprite ops (wheat_sheaf/ore_vein/herb_cluster) — disjoint from base + flora
}

/** Dispatch one op over the buffer. variant_index/count let an op graduate an effect across a recipe's
 * variants (blades: tip-dryness ramp). @param {Float32Array} buf @param {number} size @param {number} seed
 * @param {number} layer @param {RecipeOp} op @param {number} [variant_index] @param {number} [variant_count] */
function apply_op(buf, size, seed, layer, op, variant_index = 0, variant_count = 1) {
  OP_TABLE[op.op]?.(buf, size, seed, layer, op, variant_index, variant_count)
}

/** Bakes one recipe into a fresh RGBA Float32 buffer (0..255), UNROTATED; `seed_layer` (destination layer)
 * seeds the noise ⇒ each phase-variant decorrelates. @param {Recipe} recipe @param {number} size @param {number} seed @param {number} seed_layer @returns {Float32Array} */
export function bake_layer(recipe, size, seed, seed_layer, variant_index = 0, variant_count = 1) {
  const buf = new Float32Array(size * size * 4)
  const bg_alpha = recipe.alpha_clip ? 0 : (recipe.alpha ?? 255)
  for (let p = 0; p < size * size; p += 1) buf[p * 4 + 3] = bg_alpha
  for (const op of recipe.ops) apply_op(buf, size, seed, seed_layer, op, variant_index, variant_count)
  // [D172, 2026-07-05 — dark grass pixels read as a visible artifact] RGB DILATION under transparent
  // texels: alpha-clip layers leave rgb=0 (BLACK) in their transparent background, and linear filtering
  // mixes that black into every cut edge — the classic dark-fringe/speckle on grass blades + leaf
  // lacework. Flood each transparent texel's rgb with the nearest opaque neighbour's colour (alpha stays
  // 0 ⇒ the mask is unchanged; only what filtering SEES at the edge changes). 2 passes ≈ 2-texel reach.
  if (recipe.alpha_clip) dilate_rgb(buf, size)
  return buf
}

/** Floods opaque rgb into transparent texels (alpha untouched) — 4-neighbour, `passes` texels of reach.
 *  @param {Float32Array} buf RGBA @param {number} size */
function dilate_rgb(buf, size, passes = 2) {
  for (let pass = 0; pass < passes; pass += 1) {
    const filled = /** @type {number[]} */ ([])
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const i = (y * size + x) * 4
        if (buf[i + 3] > 0 || buf[i] + buf[i + 1] + buf[i + 2] > 0) continue // opaque or already flooded
        for (const [dx, dy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ]) {
          const nx = (x + dx + size) % size
          const ny = (y + dy + size) % size
          const j = (ny * size + nx) * 4
          if (buf[j + 3] > 0 || buf[j] + buf[j + 1] + buf[j + 2] > 0) {
            filled.push(i, buf[j], buf[j + 1], buf[j + 2])
            break
          }
        }
      }
    }
    for (let k = 0; k < filled.length; k += 4) {
      buf[filled[k]] = filled[k + 1]
      buf[filled[k] + 1] = filled[k + 2]
      buf[filled[k] + 2] = filled[k + 3]
    }
  }
}

/** Rotates an RGBA buffer by k·90° CW (k∈0..3) into a new buffer — a pure exact index remap (free) that
 * multiplies per-cell variety + decorrelates anisotropic recipes; k=0 copies. @param {Float32Array} src @param {number} size @param {number} k @returns {Float32Array} */
function rotate_buffer_90(src, size, k) {
  const kk = ((k % 4) + 4) % 4
  if (kk === 0) return src.slice()
  const dst = new Float32Array(src.length)
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      // Destination (x,y) samples the source pixel that maps here under a CW rotation.
      let sx, sy
      if (kk === 1) {
        sx = y
        sy = size - 1 - x
      } // 90° CW
      else if (kk === 2) {
        sx = size - 1 - x
        sy = size - 1 - y
      } // 180°
      else {
        sx = size - 1 - y
        sy = x
      } // 270° CW
      const s = (sy * size + sx) * 4
      const d = (y * size + x) * 4
      dst[d] = src[s]
      dst[d + 1] = src[s + 1]
      dst[d + 2] = src[s + 2]
      dst[d + 3] = src[s + 3]
    }
  }
  return dst
}

/** Rotation steps (each 90° baked as its own variant layer). @param {Recipe} recipe @returns {number[]} */
function recipe_rotations(recipe) {
  const rots = recipe.rotations
  return !rots || !rots.length ? [0] : rots.map((deg) => Math.round(deg / 90) & 3)
}
/** Phase-variant count (distinct-noise copies, pre-rotation). @param {Recipe} recipe @returns {number} */
function recipe_phase_variants(recipe) {
  return Math.max(1, Math.floor(recipe.variants ?? 1))
}
/** Total atlas layers = phase × rotations. @param {Recipe} recipe @returns {number} */
function recipe_variants(recipe) {
  return recipe_phase_variants(recipe) * recipe_rotations(recipe).length
}

/**
 * DEVICE-BUDGET LAYER PLAN — the graceful ≤maxTextureArrayLayers fallback for spec-minimum adapters (the
 * WebGPU/WebGL2 spec MINIMUM is 256; mobile GPUs sit exactly there). The natural atlas bakes
 * atlas_layer_count() layers (357) into ONE DataArrayTexture — on a 256-cap adapter that array is invalid
 * (depthOrArrayLayers 357 > 256) ⇒ GPUValidationError ⇒ BLACK world. Instead of blind-allocating, a
 * constrained device bakes a REDUCED atlas that fits: every recipe KEEPS its base layer (Σ bases =
 * RECIPES.length = 147 ≪ 256, so a fit is ALWAYS reachable without dropping a block) and we shed only
 * decorative variety — greedy from the largest recipe, ROTATIONS (exact index remaps, the cheapest variety)
 * before PHASE variants (distinct noise). Deterministic per budget. The material reads each recipe's
 * phase/rotation counts back from `userData` (registry_nodes.resolve_material_atlas) and clamps its per-cell
 * pick to count−1, so a reduced bake needs NO shader change: every block still renders its correct recipe
 * with fewer per-cell variants (mild tiling), never a black/absent layer. When `max_layers` ≥ the natural
 * total (desktop — the renderer requests min(adapter, 512)) the plan is the natural one ⇒ the bake is
 * BYTE-IDENTICAL to the unconstrained atlas (goldens unaffected).
 * @param {Recipe[]} recipes @param {number} max_layers @returns {{ phase: number, rots: number }[]} */
export function fit_layer_plan(recipes, max_layers) {
  const plan = recipes.map((r) => ({ phase: recipe_phase_variants(r), rots: recipe_rotations(r).length }))
  const total = () => plan.reduce((sum, p) => sum + p.phase * p.rots, 0)
  // Pick the reducible recipe with the largest CURRENT layer count matching `predicate` (strict > ⇒ ties keep
  // the lowest index, so the plan is deterministic). @type {(pred: (p: {phase:number,rots:number}) => boolean) => number}
  const largest = (pred) => {
    let bi = -1
    let best = 0
    for (let i = 0; i < plan.length; i += 1) {
      const count = plan[i].phase * plan[i].rots
      if (count > best && pred(plan[i])) {
        best = count
        bi = i
      }
    }
    return bi
  }
  // Tier 1: shed ROTATIONS first (exact index remaps — the cheapest variety: they don't add distinct noise,
  // only orientation). Cut from the largest rotated recipe each step so we fit with the fewest ops while
  // PRESERVING every recipe's distinct-noise phase variety (esp. grass's coherent-patch phases — the
  // "connected ground" read). Tier 2 only trims phases once rotations are exhausted.
  while (total() > max_layers) {
    const ri = largest((p) => p.rots > 1)
    if (ri < 0) break
    plan[ri].rots -= 1
  }
  // Tier 2: still over budget ⇒ trim PHASE variants from the largest recipe (never below its single base).
  while (total() > max_layers) {
    const pi = largest((p) => p.phase > 1)
    if (pi < 0) break // every recipe at its base (Σ = recipes.length ≤ max_layers) — cannot reduce further
    plan[pi].phase -= 1
  }
  return plan
}

/** Total DataArrayTexture layers the block atlas bakes = Σ (phase × rotations) over RECIPES. PURE and
 *  WORLD-INDEPENDENT: per-world `textures` only recolours recipes (apply_texture_config preserves their
 *  count), so the renderer can size the WebGPU `maxTextureArrayLayers` device limit at boot WITHOUT baking
 *  a single pixel. Single source for both the device-limit request (core/renderer.js) and the ceiling test.
 *  @returns {number} */
export function atlas_layer_count() {
  return RECIPES.reduce((sum, recipe) => sum + recipe_variants(recipe), 0)
}

/**
 * Bakes the full atlas: per recipe, `phase` distinct-noise layers × its rotations, contiguous per recipe.
 * Deterministic from `seed`. FIVE-WORLDS: `textures` (config.textures) applies a per-family HSV palette
 * transform to a COPY of the recipes BEFORE baking (texture_palette.apply_texture_config) — layer indices
 * unchanged, only texel colours move. Absent/all-identity ⇒ the base recipes ⇒ byte-identical atlas.
 * @param {object} [options] @param {number} [options.size] @param {number} [options.seed]
 * @param {import('./texture_palette.js').TexturesConfig} [options.textures] per-world texture palette
 * @param {number} [options.max_layers] device texture-array-layer budget (default ∞): a spec-minimum
 *   adapter (256) bakes a REDUCED atlas that fits — see fit_layer_plan. ≥ natural ⇒ byte-identical.
 * @returns {BakeResult}
 */
export function bake_block_textures({ size = 64, seed = 0, textures, max_layers = Infinity } = {}) {
  const recipes = apply_texture_config(RECIPES, textures)
  size = textures?.size ?? size
  // Per-recipe {phase, rots} — the natural counts unless `max_layers` forces a reduced fit (spec-min device).
  const plan = fit_layer_plan(recipes, max_layers)
  const layers = plan.reduce((sum, p) => sum + p.phase * p.rots, 0)
  const stride = size * size * 4
  const albedo = new Uint8Array(layers * stride)
  /** @type {Map<number, number>} */
  const layer_of = new Map()
  /** @type {Map<string, number>} */
  const layer_of_name = new Map()
  /** @type {Map<string, number>} */
  const variants_of_name = new Map()
  /** @type {Map<string, number>} */
  const rotations_of_name = new Map()
  let layer = 0
  for (let ri = 0; ri < recipes.length; ri += 1) {
    const recipe = recipes[ri]
    const { phase, rots } = plan[ri]
    // Keep the FIRST `rots` rotation steps (prefix ⇒ the base 0° orientation is always layer 0 of the run).
    const rotations = recipe_rotations(recipe).slice(0, rots)
    const count = phase * rotations.length
    const base_layer = layer
    // Bake `phase` distinct-noise buffers (seeded by dest layer ⇒ decorrelated), emit each rotation as its
    // own consecutive layer; material picks one of the `count` contiguous layers per cell.
    for (let v = 0; v < phase; v += 1) {
      const buf = bake_layer(recipe, size, seed, layer, v, phase)
      for (const k of rotations) {
        const rot = rotate_buffer_90(buf, size, k)
        const dst = layer * stride
        for (let i = 0; i < stride; i += 1) albedo[dst + i] = clamp(Math.round(rot[i]), 0, 255)
        layer += 1
      }
    }
    layer_of_name.set(recipe.name, base_layer)
    variants_of_name.set(recipe.name, count)
    rotations_of_name.set(recipe.name, rotations.length)
    for (const block_name of recipe.blocks ?? [recipe.name]) {
      const block = get_block_by_name(block_name)
      if (block) layer_of.set(block.id, base_layer)
    }
  }
  return { albedo, layer_of, layer_of_name, variants_of_name, rotations_of_name, layers, size }
}

/** Wraps a bake result into a three DataArrayTexture for the terrain material — `three` is injected (never
 * imported) ⇒ headless-safe; caller owns lifetime/upload. @param {typeof import('three')} three @param {BakeResult} bake_result @returns {import('three').DataArrayTexture} */
export function build_data_array_texture(
  three,
  { albedo, size, layers, layer_of_name, variants_of_name, rotations_of_name }
) {
  const texture = new three.DataArrayTexture(albedo, size, size, layers)
  texture.magFilter = three.NearestFilter
  texture.minFilter = three.LinearMipmapLinearFilter
  texture.generateMipmaps = true
  texture.colorSpace = three.SRGBColorSpace
  // HARDWARE Repeat wrap (three@0.185 WebGPU, verified): mag=Nearest+min=LinearMipmap ⇒ real
  // textureSample with continuous mip derivatives, so the material drops fract() and its 1→0 sawtooth
  // seam sparkle (a fract+.grad() fallback exists but isn't needed). See MEMORY reference_engine_texture_wrap.
  texture.wrapS = three.RepeatWrapping
  texture.wrapT = three.RepeatWrapping
  // name→base-layer + name→variant-count (+ name→rotation-count) ride on userData so the material resolves
  // face families + per-cell variants/rotations with no plumbing change.
  texture.userData.layer_of_name = layer_of_name
  texture.userData.variants_of_name = variants_of_name
  texture.userData.rotations_of_name = rotations_of_name
  texture.needsUpdate = true
  return texture
}

/**
 * Uploads a baked block atlas to the GPU in ONE `queue.writeTexture` call, bypassing three r185's
 * per-LAYER DataArrayTexture upload. Why (P0 renderer-RSS balloon, measured 2026-07-11): three's
 * `WebGPUTextureUtils.updateTexture` loops `for (i < image.depth)` calling `_copyBufferToTexture(image, …)`
 * once PER LAYER, each call passing the ENTIRE atlas buffer (only a per-layer byte OFFSET differs) —
 * Chromium/Dawn stages the full buffer per call, so an N-layer atlas costs N × (N·layer_bytes) of
 * renderer-native staging in one synchronous boot burst. At 339 layers × 64² that measured ~1.8 GB
 * (`writeTexture` total 1796 MB across 340 calls; GPU-process RSS flat — the balloon was CPU-side
 * staging in the renderer process). ONE writeTexture over all layers stages the buffer ONCE ⇒ O(N);
 * the mip chain is regenerated from the uploaded base. SAFE DROP-IN: a `DataArrayTexture` is
 * flipY=false (three default; build_data_array_texture never overrides it), so three's per-layer path
 * never flipped either — identical texels, identical layout (`rowsPerImage = height` reproduces three's
 * per-layer offset math exactly), identical mipmaps. WebGPU-only; the WebGL2 fallback keeps three's
 * default upload (returns false). Boot-only — the atlas is baked once.
 * @param {*} renderer a WebGPURenderer, already `await renderer.init()`-ed
 * @param {import('three').DataArrayTexture} texture the atlas from build_data_array_texture
 * @returns {boolean} true if the single-call upload ran; false ⇒ left three's default path (non-WebGPU / no GPU tex)
 */
export function upload_atlas_single_call(renderer, texture) {
  const backend = /** @type {*} */ (renderer)?.backend
  if (!backend?.isWebGPUBackend || !backend.device || typeof renderer.initTexture !== 'function') return false
  const { image } = /** @type {{ image: { data: ArrayBufferView, width: number, height: number, depth: number } }} */ (
    texture
  )
  const { data, width, height, depth } = image
  if (!data || !width || !depth) return false
  // dataReady=false ⇒ three's Textures.updateTexture CREATES the GPUTexture but SKIPS its per-layer upload
  // (r185: `if (texture.source.dataReady === true) backend.updateTexture(…)`); its generateMipmaps would
  // run off the still-empty base, so mip generation is re-run after the real single upload below.
  texture.source.dataReady = false
  renderer.initTexture(texture) // force-create the GPU texture NOW so we can write into it (boot-only)
  const { texture: gpu } = backend.get(texture) ?? {}
  if (!gpu) {
    texture.source.dataReady = true
    texture.needsUpdate = true
    return false // couldn't reach the GPU texture — fall back to three's default upload on next render
  }
  // ONE upload, all layers: rowsPerImage=height ⇒ each layer is a contiguous height·bytesPerRow block,
  // matching the atlas buffer's row-major-by-layer packing (bake_block_textures) and three's own per-layer
  // offset (`width·height·bytesPerTexel·layer`). rgba8 ⇒ 4 B/texel; queue.writeTexture needs no 256 align.
  backend.device.queue.writeTexture(
    { texture: gpu },
    data,
    { bytesPerRow: width * 4, rowsPerImage: height },
    { width, height, depthOrArrayLayers: depth }
  )
  backend.generateMipmaps(texture) // rebuild the mip chain from the freshly-uploaded base level
  // Restore dataReady so a rare device-loss RE-init falls back to three's correct (if slow) default upload
  // instead of a blank atlas. Steady state never re-uploads (textureData.initialized + version early-return).
  texture.source.dataReady = true
  return true
}
