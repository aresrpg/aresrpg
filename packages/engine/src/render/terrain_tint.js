// NG-TINT (ENG-1) — world-space MACRO ground-shade + PBR roughness field for the terrain material.
// Visual-only shader noise (determinism-legal, zero quad-format change): a low-frequency, world-XZ
// CONTINUOUS tint layered OVER W17's per-cell micro grain so the per-block tiles dissolve into
// Veloren-style dry-yellow ↔ lush ↔ humid-dark patches, plus per-family PBR roughness (sand specular,
// grass humid "dew" sheen) driven by the SAME two octaves — zero extra noise fetches. Single source of
// truth for the amplitudes (NG_TINT / TERRAIN_PBR); terrain_material.test.js pins + ceiling-guards them.
//
// Continuity: the field samples positionWorld.xz directly (no chunk term ⇒ seamless across chunk
// borders). A block's top plane spans [bx,bx+1]×[bz,bz+1] and its +x/+z side sits at the SAME far-plane
// XZ after positive_push, so a block's rim samples the field at the identical XZ as its top edge → the
// silhouette dissolves. Cross foliage (faces 6/7) spans the cell diagonal = the same XZ footprint as the
// grass it stands on, so tufts track their ground patch.

import { float, floor, hash, int, mix, smoothstep, uniformArray, vec3 } from 'three/tsl'

import { BLOCK_REGISTRY, get_block_by_name } from '../config/block_registry.js'

// [D162] the tint amplitudes + per-block classification moved to terrain_tint_data.js (a three-FREE
// module) so the far-shell CPU tint (lod/far_mesher.js, pure worker) single-sources them. Re-exported
// here so this material, its test, and every prior consumer keep importing them from terrain_tint.js.
import {
  NG_TINT,
  TERRAIN_PBR,
  TINT_SALT,
  CANOPY_TINT_NAMES,
  tint_class_of,
  base_roughness_of,
  STRAW_TIP,
  straw_tip_ratio,
  GRASS_GRADIENT_LEVELS,
  resolve_grass_gradient_level,
} from './terrain_tint_data.js'

export {
  NG_TINT,
  TERRAIN_PBR,
  CANOPY_TINT_NAMES,
  tint_class_of,
  base_roughness_of,
  STRAW_TIP,
  straw_tip_ratio,
  GRASS_GRADIENT_LEVELS,
  resolve_grass_gradient_level,
}

/**
 * `?grassgrad=a|b|c|d` dev flag (`d` added by the recapture visibility gate — see
 * GRASS_GRADIENT_LEVELS), read once per material build (macro_tint_nodes has a single call site —
 * one build per render class at boot, never per-frame — see terrain_material.js).
 * Guarded for non-browser contexts (bun test has no `location`), matching the same
 * `typeof location !== 'undefined'` pattern every other dev-flag read in src/render/ uses.
 * @returns {'a'|'b'|'c'|'d'}
 */
function grass_gradient_level() {
  if (typeof location === 'undefined') return 'a'
  return resolve_grass_gradient_level(new URLSearchParams(location.search).get('grassgrad'))
}

/**
 * Hashed lattice value in [0,1) for integer cell (ix,iz), via three's built-in PCG `hash` node — the
 * SAME construction terrain_material.js's cell_hash trusts at world scale (fold the two axes on large
 * odd primes so neighbours decorrelate, then hash the float). A hand-rolled uint bit-avalanche
 * (`uint().mul().bitXor().shiftRight()`) was tried first for f32-exactness but emitted invalid WGSL on
 * the WebGPU backend → "Invalid RenderPipeline" (verified by bisect); `hash()` lowers cleanly. Banding
 * risk is LOWER than the material's per-1 m cell_hash because these lattice indices are worldXZ/period
 * (period ≥13) — coarser, so smaller integers into the multiply. Tests use a representative hash oracle
 * (hash()'s exact output isn't reproducible in JS; the tested properties are hash-agnostic).
 * @param {*} ix int node @param {*} iz int node @param {number} salt octave index into TINT_SALT
 */
function lattice_hash(ix, iz, salt) {
  return hash(
    float(ix)
      .mul(float(374761393))
      .add(float(iz).mul(float(668265263)))
      .add(float(TINT_SALT[salt]))
  )
}

/**
 * Tileable-free 2-D value noise in [0,1), smoothstep-interpolated over the integer lattice — C1-continuous
 * everywhere (seamless across chunk borders; no chunk term). `px,pz` are worldXZ pre-divided by the octave
 * period; the int(floor) lattice index is f32-exact for any playable coord (only the interp fraction is f32).
 * @param {*} px @param {*} pz @param {number} salt
 */
function tint_noise(px, pz, salt) {
  const x0 = floor(px)
  const z0 = floor(pz)
  const ux = smoothstep(float(0), float(1), px.sub(x0))
  const uz = smoothstep(float(0), float(1), pz.sub(z0))
  const h = (/** @type {*} */ x, /** @type {*} */ z) => lattice_hash(int(x), int(z), salt)
  return mix(mix(h(x0, z0), h(x0.add(1), z0), ux), mix(h(x0, z0.add(1)), h(x0.add(1), z0.add(1)), ux), uz)
}

/** block_id → class/roughness float via an O(1) uniform-array lookup (indexed by block_id).
 *
 * WAS a per-block `.select()` ladder, but every step nests TWO WGSL ops (`.equal(…).select(…)`), so its
 * fragment-shader nesting depth grew ≈2× the registry size. At ~62 blocks that is ≈124 — and the 2026-07-07
 * flora wire-in (40→62 block ids) pushed the two FRAGMENT-side ladders here (tint_class + base_rough) past
 * naga's HARD 127-nesting limit, so the ENTIRE MeshStandardNodeMaterial fragment pipeline failed to compile
 * ("statement nesting depth / chaining length exceeds limit of 127"). Near terrain went invisible while the
 * far shell (its own CPU-tint path) still drew. A dense f32 uniform array indexed by block_id is O(1)
 * nesting regardless of how big the registry grows; ids absent from the registry read 0 (the ladder's old
 * fall-through default). Values stay build-time constants from the SAME source (value_of over BLOCK_REGISTRY).
 * @param {*} id block_id int node @param {(b: import('../config/block_registry.js').BlockDef) => number} value_of */
function id_ladder(id, value_of) {
  let max_id = 0
  for (const b of BLOCK_REGISTRY) if (b.id > max_id) max_id = b.id
  const values = /** @type {number[]} */ (new Array(max_id + 1).fill(0))
  for (const b of BLOCK_REGISTRY) values[b.id] = value_of(b)
  return /** @type {*} */ (uniformArray(values).element(int(id)))
}

/** Macro MOISTURE at a world XZ [0,1] — the SAME low-freq octave the tint uses (P_BIG period). Exposed
 * so the terrain material can bias the grass-variant pick by climate (humid → green variants, dry →
 * yellow-tipped) so the dry↔lush zones read at BLADE level, not just via the albedo tint. Single source
 * of the moisture field — no extra noise construction.
 * @param {*} px world x node @param {*} pz world z node @returns {*} */
export function macro_moisture_node(px, pz) {
  return tint_noise(px.div(float(NG_TINT.P_BIG)), pz.div(float(NG_TINT.P_BIG)), 0)
}

/**
 * Builds the macro-tint + roughness nodes for one fragment. Reuses positionWorld (already a varying) and
 * samples the two octaves ONCE, feeding both the albedo tint and the roughness (zero extra noise fetches).
 * Liquid gets identity tint + null roughness (skipped entirely — zero water ALU). The returned `tint_albedo`
 * is applied to the post-micro-jitter albedo so the macro layers ON TOP of W17's per-cell grain.
 * @param {object} o @param {*} o.block_id int node @param {*} o.position_world vec3 world-pos node
 * @param {'solid'|'foliage'|'cutout'|'canopy'|'liquid'} o.variant D164 cutout + Rung-2 canopy (leaves) tint
 *   like solid canopy; only 'liquid' short-circuits — every other variant takes the block-id-keyed tint path
 * @returns {{ tint_albedo: (albedo: *) => *, roughness_node: * }}
 */
export function macro_tint_nodes({ block_id, position_world, variant }) {
  if (variant === 'liquid') return { tint_albedo: (albedo) => albedo, roughness_node: null }
  const sand_id = get_block_by_name('sand')?.id ?? -1
  const log_id = get_block_by_name('log')?.id ?? -1
  // Ladders evaluate FRAGMENT-side directly off `block_id` (the storage-decoded per-instance int is
  // already available in the fragment stage — the pool material carries it; verified rendering). An
  // earlier attempt wrapped each id_ladder in varying() to force vertex-stage eval, but that pushed a
  // whole per-block select-chain across the boundary as its own interpolant on top of the material's
  // ~15 existing varyings → invalid pipeline. Raw fragment-side eval is both correct and cheaper.
  // Casts to `*` because id_ladder returns `*` (its `.select()` chain can't be annotated, cf.
  // terrain_material's flat_color_from_registry) and Node<any> loses the fluent math surface.
  const tint_class = /** @type {*} */ (id_ladder(block_id, tint_class_of))
  const base_rough = /** @type {*} */ (id_ladder(block_id, base_roughness_of))
  const is_grassy = tint_class.greaterThanEqual(float(2))
  const grassy_amt = is_grassy.select(float(1), float(0))
  // [2026-07-12 structural fix] `grad` now feeds ONLY the dedicated macro-gradient octave (e) below —
  // resolved once per material build from `?grassgrad=`. The vfield/climate terms just below are
  // grad-INDEPENDENT (always their shipped baseline amplitude): the first grassgrad attempt scaled
  // THEM instead and proved it mathematically dead (diluted by the detail-octave mix), so this round
  // retires that lever rather than double-scaling a known-ineffective one — see GRASS_GRADIENT_LEVELS.
  const grad = GRASS_GRADIENT_LEVELS[grass_gradient_level()]

  const moisture = macro_moisture_node(position_world.x, position_world.z)
  const detail = tint_noise(
    position_world.x.div(float(NG_TINT.P_SMALL)),
    position_world.z.div(float(NG_TINT.P_SMALL)),
    1
  )
  const m = moisture.mul(float(2)).sub(float(1)) // [-1,1] moisture: +humid / -dry
  const d = detail.mul(float(2)).sub(float(1))

  // (b) VALUE: dry brighter + detail; amp 0.08 grassy / 0.06 WOOD / 0.04 mineral / 0 none. Grad-independent
  // (fixed baseline — see the `grad` comment above): this is the lever the first grassgrad attempt
  // scaled and found dead, so it now always runs at its shipped amplitude regardless of ?grassgrad=.
  const is_wood = block_id.equal(int(log_id))
  const wood_amt = is_wood.select(float(1), float(0))
  const vfield = m
    .mul(float(-0.6))
    .add(d.mul(float(0.4)))
    .clamp(float(-1), float(1))
  const mineral_amp = is_wood.select(float(NG_TINT.VAL_WOOD), float(NG_TINT.VAL_MINERAL))
  const val_amp = is_grassy.select(float(NG_TINT.VAL_GRASS), tint_class.equal(float(1)).select(mineral_amp, float(0)))
  const value_mul = float(1).add(val_amp.mul(vfield))
  // (a) CLIMATE chroma: grassy → dry-yellow↔humid-dark-green; WOOD → subtle warm↔cool drift (K_WOOD·m).
  // Grad-independent, same reasoning as (b) above.
  const climate = vec3(1, 1, 1)
    .add(vec3(NG_TINT.K[0], NG_TINT.K[1], NG_TINT.K[2]).mul(m).mul(grassy_amt))
    .add(vec3(NG_TINT.K_WOOD[0], NG_TINT.K_WOOD[1], NG_TINT.K_WOOD[2]).mul(m).mul(wood_amt))
  // (e) DEDICATED MACRO-GRADIENT octave [2026-07-12 structural fix]: two much-longer-period world-XZ
  // octaves (P_MACRO_A/B, salts 2/3 — decorrelated from moisture/detail) drive the `?grassgrad=`
  // ladder DIRECTLY, applied here OUTSIDE the vfield/climate mix above so it is undiluted — the prior
  // attempt scaled VAL_GRASS/K instead, which mix 60/40 with the 13-block detail octave and measured
  // ~0.6% final luminance move even at its loudest rung (see GRASS_GRADIENT_LEVELS doc). Level 'a' is
  // {val:0,hue:0}: the JS-side `macro_on` check below skips building these nodes AT ALL, and tint_albedo
  // chains the factor only when non-null — so ?grassgrad= absent/'a' compiles the LITERALLY IDENTICAL
  // node graph as the committed pre-grassgrad shader (byte-identical output, zero added ALU, no reliance
  // on compiler constant-folding). Two periods (96/157 blocks,
  // ratio ~1.64 — no small-integer beat) rather than one so the macro pattern doesn't read as a single
  // repeating blob size, fixing the "not uniform enough... like veloren" read.
  const macro_on = grad.val > 0 || grad.hue > 0
  let macro_mul = /** @type {*} */ (null) // level 'a': stays null ⇒ tint_albedo chains NOTHING extra
  if (macro_on) {
    const macro_a = tint_noise(
      position_world.x.div(float(NG_TINT.P_MACRO_A)),
      position_world.z.div(float(NG_TINT.P_MACRO_A)),
      2
    )
    const macro_b = tint_noise(
      position_world.x.div(float(NG_TINT.P_MACRO_B)),
      position_world.z.div(float(NG_TINT.P_MACRO_B)),
      3
    )
    // gfield = ((macro_a·2−1)+(macro_b·2−1))/2, simplified — each octave in [0,1) ⇒ gfield in (−1,1).
    const gfield = macro_a.add(macro_b).sub(float(1))
    const macro_val_amp = float(NG_TINT.MACRO_VAL * grad.val)
    const macro_value_mul = float(1).add(macro_val_amp.mul(gfield).mul(grassy_amt))
    const k = NG_TINT.MACRO_K
    const macro_climate = vec3(1, 1, 1).add(vec3(k[0], k[1], k[2]).mul(float(grad.hue)).mul(gfield).mul(grassy_amt))
    macro_mul = macro_climate.mul(macro_value_mul) // one combined vec3 factor for the albedo chain
  }

  // (d) HUMID TURF (grass-ground only — see the NG_TINT doc): moisture-high patches pull the grass
  // block toward TURF_RGB (dark rich green; red/blue drop harder than green so it deepens AND greens),
  // and the SAME factor gates the dirty-patch mottle out — a humid meadow floor is grass shadow, not
  // "blades on dirt". Dry zones (turf→0) are byte-identical to the pre-turf shader.
  const is_ground = tint_class.equal(float(3)).select(float(1), float(0))
  const turf = smoothstep(float(NG_TINT.TURF_LO), float(NG_TINT.TURF_HI), moisture).mul(is_ground)
  // [2026-07-03 tsc] mix(vec3,vec3,node) overload gap in three's TSL typings — args are valid nodes.
  const turf_mul = /** @type {any} */ (mix)(
    vec3(1, 1, 1),
    vec3(NG_TINT.TURF_RGB[0], NG_TINT.TURF_RGB[1], NG_TINT.TURF_RGB[2]),
    turf
  )
  // (c) DIRTY PATCH (grass-ground only): sparse blend toward dirt, gated out on humid turf.
  const dirt_blend = smoothstep(float(NG_TINT.DIRT_LO), float(NG_TINT.DIRT_HI), detail)
    .mul(float(NG_TINT.DIRT_MAX))
    .mul(is_ground)
    .mul(float(1).sub(turf))
  const dirt_rgb = vec3(NG_TINT.DIRT_RGB[0], NG_TINT.DIRT_RGB[1], NG_TINT.DIRT_RGB[2])

  // PBR roughness: grassy → humid dew dip / dry rougher; sand → fine-octave ripple; else base. metalness 0.
  const grassy_r = base_rough.sub(m.mul(float(TERRAIN_PBR.humid_dip)))
  const sand_r = base_rough.add(d.mul(float(TERRAIN_PBR.sand_ripple)))
  const roughness_node = is_grassy
    .select(grassy_r, block_id.equal(int(sand_id)).select(sand_r, base_rough))
    .clamp(float(TERRAIN_PBR.min), float(1))

  return {
    // mix() over an `*` albedo, a vec3, and the ladder-derived `*` dirt_blend has no single concrete
    // overload (heterogeneous node types by design). Its args are cast to `*` so overload resolution
    // sees `any` (any overload accepts it) — the file's `*`-ladder convention, cf. terrain_material.
    // The macro factor chains ONLY when the octave is live (macro_mul null at level 'a') — the default
    // chain below is then literally the committed pre-grassgrad graph, mul for mul (byte-identity by
    // construction, not by trusting the compiler to fold ×1 constants).
    tint_albedo: (albedo) => {
      const base = albedo.mul(value_mul).mul(climate)
      const tinted = (macro_mul ? base.mul(macro_mul) : base).mul(turf_mul)
      return mix(/** @type {*} */ (tinted), /** @type {*} */ (dirt_rgb), /** @type {*} */ (dirt_blend))
    },
    roughness_node,
  }
}
