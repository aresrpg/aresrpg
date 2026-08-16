// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// FAR-TREE IMPOSTOR DERIVATION (ENGINE_AAA_PLAN §3.6, Lane B3) — the PURE, worker-safe half of the far
// tree impostor system: given a gen context + a far section's world footprint, re-derive the PROCEDURAL
// trees whose anchor lands in that footprint and emit a tight per-tree instance record (world base,
// world W×H, atlas layer) for the render half (far_trees.js) to draw as billboards.
//
// THE SEAM (§3.6) — AMENDED (heap-OOM fix, 2026-07-11). ORIGINAL DESIGN: this file called the decorator's
// own `resolve_placement_at` per stride column so the far impostor and the near voxel tree AGREED by
// CONSTRUCTION (same fn ⇒ drift structurally impossible). BUT resolve_placement_at FULLY SYNTHESIZES every
// tree (generate_tree → up to ~6500 voxel objects, plus grounded_placement) just to read a size — and a
// boot fill re-derives thousands of trees in a burst, which OOM'd the far worker isolate (young-gen
// promotion failure; measured 247 MB transient heap for 4191 trees, gone with this fix). So the far shell
// now re-derives the placement DECISION WITHOUT synthesizing — a cheap gate cascade (grove → surface →
// biome density → species → age) that MIRRORS resolve_placement_at's procedural-tree branch column-for-
// column, and takes SIZE from a canonical per-(species,age) measurement instead of the per-instance tree.
//
// THE AMENDED CONTRACT (what agrees at the ring seam, and how tightly):
//   • POSITION (wx,wz) + SPECIES×AGE (⇒ atlas layer): EXACT. The gate cascade below is the same integer
//     hash lineage / salts / density ladder resolve_placement_at uses, so the SAME columns grow the SAME
//     species — proven 0-mismatch over a 1.96 M-column sweep by far_trees_gen.test.js (the mechanical
//     PARITY GATE: it FAILS the moment this mirror drifts from resolve_placement_at, because the gates are
//     copied, not shared — the price of not synthesizing).
//   • SIZE (W×H) + BASE_Y: CANONICAL-APPROXIMATE. Size is the canonical (species,age) tree's W×H (the same
//     tree the atlas card is baked from — so card silhouette and billboard size MATCH). base_y reproduces
//     grounded_placement (min surface over the tree's base footprint − 1) using the CANONICAL footprint, so
//     it's exact wherever the instance's base spread matches the canonical (~94 %, ~97 % within 1 block);
//     the residual is a per-instance shape jitter of a few blocks. EXACT base_y is impossible without the
//     per-instance schematic — i.e. without the synthesis this fix removes — and at 224 m+ (the impostor
//     band) a few blocks is sub-pixel, masked by the ring-edge crossfade dither, exactly as for size.
//
// The seed is read from `ctx.seeds.decorators` — the EXACT sub-seed world_gen threads into decorate_chunk
// (world_gen.js:164) — never gen_seed, or presence/species would diverge from the near ring.
//
// DENSITY (§3.6 "sparse stride"): impostors are a forest IMPRESSION, not every trunk. Only columns on a
// world-anchored stride grid are tested; the stride DOUBLES per LOD level so a coarser (farther) section
// is sparser AND its grid is a strict SUBSET of the finer level's grid (BASE·2^(L-1), aligned to the
// world) — so when a section refines L3→L2→L1 the shared trees sit at IDENTICAL positions (they
// cross-fade in place, never a double-tree) and the extra finer trees fade in from nothing. Level-capped
// (≤ IMPOSTOR_MAX_LEVEL) so the huge L4 horizon band stays the far-shell's hazed canopy colour, not
// thousands of sub-pixel billboards. `?proctrees` OFF ⇒ `ctx.config.trees.procedural` is falsy ⇒ the gate
// cascade emits nothing ⇒ the far shell is byte-identical (parity law).

import { anchor_surface } from '../gen/column_gen.js'
import {
  resolve_deco,
  in_grove,
  hash_column,
  tree_cleared_at,
  resolve_grammar,
  grammar_tree_at,
  grammar_hero_species,
  grammar_biome_density,
} from '../gen/deco_shared.js'
import { BIOME_SCHEMATICS } from '../gen/surface_decorator.js'
import { get_biome_by_id } from '../config/biome_registry.js'
import { load_schematic_set, for_each_voxel } from '../gen/schematics/loader.js'
import { SEA_LEVEL } from '../config/world_config.js'
import { SPECIES, SPECIES_KEYS, AGE_WEIGHTS } from '../gen/trees/species.js'
import { build_tree, make_rng, hash5, SALT_TREE_GEN } from '../gen/trees/tree_gen.js'
import { SALT_TREE_VARIANT, SALT_BAKE_WZ } from '../gen/trees/tree_bake.js'

/** @typedef {import('../gen/column_gen.js').GenContext} GenContext */

/** Coarsest LOD level that emits impostors. L1(64 m)/L2(128 m)/L3(256 m) sections cover the near→~1 km
 *  band where an individual tree still subtends real pixels; L4 (≥1 km) is the far-shell hazed canopy. */
export const IMPOSTOR_MAX_LEVEL = 3
/** Age bands in the canonical layer order (matches species.js AGE_BANDS keys / tree_gen name suffix). */
export const IMPOSTOR_AGES = /** @type {const} */ (['young', 'mature', 'ancient'])
/** Total impostor atlas layers = species × ages (the render half bakes exactly this many cards). */
export const IMPOSTOR_LAYER_COUNT = SPECIES_KEYS.length * IMPOSTOR_AGES.length
/** floats packed per tree in the instance buffer: [wx, base_y, wz, width, height, layer]. */
export const IMPOSTOR_FLOATS_PER_TREE = 6
/** Finest-level stride (blocks between tested columns at L1); doubles per level (§3.6). A power of two so
 *  every section span (64/128/256) is a whole multiple ⇒ the grid tiles sections with no gap/overlap and
 *  coarse grids are strict subsets of finer ones. Tunable (denser = more trees, more fill). */
export const IMPOSTOR_BASE_STRIDE = 2

/** World-column stride at a LOD level: BASE·2^(level-1) (§3.6 — coarser sections sparser, grid-nested).
 *  @param {number} level @returns {number} */
export function impostor_stride(level) {
  return IMPOSTOR_BASE_STRIDE << (level - 1)
}

/** Atlas layer index for a (species, age) pair, or -1 if either is unknown. The SINGLE HOME of the
 *  species×age → layer mapping — the render-side atlas bake reads it back via `impostor_layer_spec` so
 *  the worker's per-instance `layer` and the baked card order can never disagree.
 *  @param {string} species_key @param {string} age_name @returns {number} */
export function impostor_layer(species_key, age_name) {
  const si = SPECIES_KEYS.indexOf(species_key)
  const ai = IMPOSTOR_AGES.indexOf(/** @type {any} */ (age_name))
  if (si < 0 || ai < 0) return -1
  return si * IMPOSTOR_AGES.length + ai
}

/** Inverse of `impostor_layer`: the (species, age) a layer index bakes. @param {number} layer
 *  @returns {{ species: string, age: 'young'|'mature'|'ancient' }} */
export function impostor_layer_spec(layer) {
  return {
    species: SPECIES_KEYS[Math.floor(layer / IMPOSTOR_AGES.length)],
    age: IMPOSTOR_AGES[layer % IMPOSTOR_AGES.length],
  }
}

// ── CANONICAL PER-LAYER TREE (the size/base source; the atlas card bakes from the SAME tree) ──────────
// One deterministic tree per (species,age) layer, built ONCE, used for: (a) the billboard's world W×H,
// (b) its base-anchoring footprint, (c) — via `canonical_impostor_schematic` — the render half's atlas
// card. Same seed salt as the card bake so the silhouette and the world size come from ONE tree.
/** Deterministic bake seed salt — offline; the canonical trees never change between runs (build_tree is
 *  pure). SHARED with far_trees.bake so the card and the world size derive from the identical tree. */
export const SALT_BAKE = 0x5eed7bee

/** The canonical tree for an atlas layer. Pure (build_tree is pure). @param {number} layer
 *  @returns {import('../gen/schematics/loader.js').ResolvedSchematic} */
function canonical_tree(layer) {
  const { species, age } = impostor_layer_spec(layer)
  return build_tree(species, make_rng(hash5(SALT_BAKE, layer, 0, 0, 0)), age)
}

/** The canonical (species,age) tree the RENDER half projects into the atlas card. Rebuilt on demand (the
 *  bake calls it once per layer at construction). @param {number} layer
 *  @returns {import('../gen/schematics/loader.js').ResolvedSchematic} */
export function canonical_impostor_schematic(layer) {
  return canonical_tree(layer)
}

/** Per-layer canonical measurement: billboard W×H + the base-layer footprint (the (dx,dz) columns whose
 *  lowest voxel sits at the tree base, + that base dy) — reproduces grounded_placement's min-over-base-
 *  footprint anchor WITHOUT the per-instance schematic. Built eagerly (30 pure builds at load; the
 *  schematics are dropped, only the tiny measurements retained). @type {{ w:number, h:number, base_dy:number, foot:Int16Array }[]} */
const CANON = (() => {
  const arr = new Array(IMPOSTOR_LAYER_COUNT)
  for (let layer = 0; layer < IMPOSTOR_LAYER_COUNT; layer += 1) {
    const s = canonical_tree(layer)
    let base_dy = Infinity
    // for_each_voxel: synthesized trees carry the compact typed-array form (P0 balloon fix), not .voxels.
    for_each_voxel(s, (_dx, dy) => {
      if (dy < base_dy) base_dy = dy
    })
    const seen = new Set()
    /** @type {number[]} */
    const foot = []
    for_each_voxel(s, (dx, dy, dz) => {
      if (dy === base_dy) {
        const k = dx * 131072 + dz // distinct per (dx,dz) for |dz| < 65536
        if (!seen.has(k)) {
          seen.add(k)
          foot.push(dx, dz)
        }
      }
    })
    arr[layer] = { w: Math.max(s.size[0], s.size[2]), h: s.size[1], base_dy, foot: Int16Array.from(foot) }
  }
  return arr
})()

// ── PROCEDURAL-TREE DECISION MIRROR (copied from surface_decorator.js — the §3.6 parity contract) ──────
// These MIRROR resolve_placement_at's procedural-tree branch so the far shell re-derives the SAME trees
// WITHOUT synthesizing them. They are COPIES, not the decorator's own code — the fence keeps the decorator
// untouched, so far_trees_gen.test.js's SEAM AGREEMENT sweep is the mechanical gate that catches any drift
// (it FAILS the instant a far verdict diverges from resolve_placement_at). Keep in lockstep with
// surface_decorator.js: SALT_TREE_GROVE/SALT_TREE/SALT_TREE_SPECIES (decision salts), select_tree_species
// (weighted roster pick), and tree_gen.pick_age (age roll).
const SALT_TREE_GROVE = 0x7feb352d
const SALT_TREE = 0x9e3779b1
const SALT_TREE_SPECIES = 0x1b56c4e9
/** Whether the loaded bundle has ANY tree schematic — resolve_placement_at gates its tree grove on this
 *  (`TREES_ENABLED && in_grove`), so an empty-tree bundle grows no procedural trees either. */
const TREES_ENABLED = load_schematic_set('tree').length > 0

/** Weighted procedural-species pick for a biome from the world's `tree_species` roster — MIRROR of
 *  surface_decorator.select_tree_species (pure per-column hash over the cumulative-weight ladder). null
 *  when the biome has no roster. @param {GenContext} ctx @param {string} biome_name @param {number} wx
 *  @param {number} wz @param {number} seed @returns {string | null} */
function select_tree_species(ctx, biome_name, wx, wz, seed) {
  const roster = ctx.config?.tree_species?.[biome_name]
  if (!roster || roster.length === 0) return null
  let total = 0
  for (const e of roster) total += e.weight
  if (total <= 0) return null
  let r = hash_column(wx, wz, (seed ^ SALT_TREE_SPECIES) >>> 0) % total
  for (const e of roster) {
    if (r < e.weight) return e.species
    r -= e.weight
  }
  return roster[roster.length - 1].species
}

/** Weighted age roll — MIRROR of tree_gen.pick_age (generate_tree derives age from this exact stream, so
 *  the far age matches the near tree's age). Under GEN_VERSION 9 bake-then-stamp the near tree is a baked
 *  VARIANT, so the far age comes from the variant's own bake stream instead (see derive_section_trees).
 *  @param {() => number} rng @returns {'young'|'mature'|'ancient'} */
function pick_age(rng) {
  const r = rng() % 256
  let acc = 0
  for (const [name, w] of AGE_WEIGHTS) {
    acc += w
    if (r < acc) return name
  }
  return 'mature'
}

/**
 * @typedef {object} SectionFootprint the far section's world tile (from section_builder geometry).
 * @property {number} level LOD level (1..4)
 * @property {number} origin_x world-x of the min corner (meters) — a multiple of the section span
 * @property {number} origin_z world-z of the min corner (meters)
 * @property {number} span section footprint edge in meters (32·2^level)
 */

/**
 * @typedef {object} SectionTrees the derived impostor instances for one section.
 * @property {number} count number of trees
 * @property {Float32Array} data packed IMPOSTOR_FLOATS_PER_TREE per tree: [wx, base_y, wz, w, h, layer]
 */

/** The canonical-footprint base-anchor for a tree of `layer` at world column (wx,wz): min anchor surface
 *  over the canonical base footprint − 1 − base_dy (reproduces grounded_placement's tree anchor without
 *  the per-instance schematic). @param {GenContext} ctx @param {number} wx @param {number} wz
 *  @param {number} layer @returns {number} */
function canonical_base_y(ctx, wx, wz, layer) {
  const c = CANON[layer]
  const { foot } = c
  let m = Infinity
  for (let i = 0; i < foot.length; i += 2) {
    const s = anchor_surface(ctx, wx + foot[i], wz + foot[i + 1]).surface_y
    if (s < m) m = s
  }
  if (m === Infinity) m = anchor_surface(ctx, wx, wz).surface_y // degenerate (no base voxel) — never in practice
  return m - 1 - c.base_dy
}

/**
 * Re-derives the PROCEDURAL-tree impostors anchored in a far section's footprint WITHOUT synthesizing any
 * tree. Pure & deterministic: a cheap gate cascade over a world-anchored stride grid that MIRRORS
 * resolve_placement_at's procedural branch (position + species EXACT — the §3.6 parity contract, gated by
 * far_trees_gen.test.js), taking size + base_y from the canonical per-(species,age) measurement (sub-pixel
 * at 224 m+; the header contract). Returns the empty set for a coarse section (level > IMPOSTOR_MAX_LEVEL)
 * or when nothing procedural grows there (incl. `?proctrees` OFF ⇒ byte-identical far shell).
 * @param {GenContext} ctx the far worker's gen context (its anchor-surface memo is reused across cells)
 * @param {SectionFootprint} section
 * @returns {SectionTrees}
 */
export function derive_section_trees(ctx, { level, origin_x, origin_z, span }) {
  if (level > IMPOSTOR_MAX_LEVEL) return { count: 0, data: new Float32Array(0) }
  // Procedural trees are the ONLY impostors; `?proctrees` OFF ⇒ no procedural trees ⇒ none (parity law).
  if (!ctx.config?.trees?.procedural) return { count: 0, data: new Float32Array(0) }
  // Decorator sub-seed — the EXACT seed world_gen passes to decorate_chunk (never gen_seed), so far
  // presence/species match the near ring column-for-column.
  const seed = ctx.seeds?.decorators ?? 0
  const stride = impostor_stride(level)
  const deco = resolve_deco(ctx.config?.decoration)
  // NATURE GRAMMAR mirror (everest): the cluster/slope/treeline gates that surface_decorator applies to
  // procedural trees — called through the SAME shared deco_shared helpers, so far == near by construction.
  // Off (default/other worlds) ⇒ grammar null ⇒ the legacy grove+density path below runs verbatim (parity).
  const grammar = resolve_grammar(ctx.config?.decoration)
  const probe = (/** @type {number} */ px, /** @type {number} */ pz) => anchor_surface(ctx, px, pz).surface_y
  // BAKE-THEN-STAMP AGE MIRROR (GEN_VERSION 9): with trees.baked_variants > 0 the near tree at an anchor
  // is baked variant k = hash_column(wx,wz,seed^SALT_TREE_VARIANT) % n, whose AGE comes from the variant's
  // own bake stream (generate_tree(seed, k, SALT_BAKE_WZ, …) — the age hash folds only (seed,wx,wz), never
  // species, so one n-entry table serves every species). Derived here WITHOUT synthesis (the OOM law);
  // bake OFF ⇒ null ⇒ the per-column age stream below, exactly as before.
  const bake_n = ctx.config?.trees?.baked_variants ?? 0
  const variant_ages =
    bake_n > 0
      ? Array.from({ length: bake_n }, (_, k) =>
          pick_age(make_rng(hash5((seed ^ SALT_TREE_GEN) >>> 0, k, SALT_BAKE_WZ, 0, 0)))
        )
      : null
  const sea_level = ctx.config?.hydrology?.sea_level ?? SEA_LEVEL
  const treeline = ctx.config?.surface?.treeline
  // World-anchored grid: origin is already a whole multiple of the span (⊇ stride), so the first tested
  // column IS the origin and adjacent sections' grids abut with no gap/overlap.
  const x_end = origin_x + span
  const z_end = origin_z + span
  /** @type {number[]} */
  const out = []
  for (let wz = origin_z; wz < z_end; wz += stride) {
    for (let wx = origin_x; wx < x_end; wx += stride) {
      // GATE CASCADE — MIRRORS resolve_placement_at's procedural-tree branch (cheap gates first). Any
      // divergence here breaks seam agreement (the test catches it). No tree synthesized. GRAMMAR on ⇒ the
      // cluster/slope/treeline gates (shared helpers) replace the grove cell, exactly as the near path does.
      if (!TREES_ENABLED) continue
      // SPAWN CLEARING (GEN_VERSION 13, seam-shared gate — deco_shared.tree_cleared_at): the near ring
      // suppresses trees in the spawn glade, so the far field must too, or glade trees pop at the ring seam
      // (the 2026-07-13 regression this line fixes — far rendered trees resolve_placement_at refused).
      if (tree_cleared_at(deco, wx, wz, seed)) continue
      if (!grammar && !in_grove(wx, wz, (seed ^ SALT_TREE_GROVE) >>> 0, deco.tree_grove_one_in, deco.grove_cell_shift))
        continue
      const surf = anchor_surface(ctx, wx, wz)
      if (surf.surface_y <= sea_level) continue // underwater — no procedural species is water-anchored
      if (treeline !== undefined && surf.surface_y > treeline) continue // no trees above the treeline
      const biome = get_biome_by_id(surf.biome_id)
      if (biome === undefined) continue
      // Per-biome procedural density gate (base.tree_one_in). A biome absent from BIOME_SCHEMATICS grows no
      // procedural trees in resolve_placement_at (no base, no override on the DEFAULT path) ⇒ skip it here.
      const rule = BIOME_SCHEMATICS[biome.name]
      if (rule === undefined || !(rule.tree_one_in > 0)) continue
      if (
        grammar
          ? !grammar_tree_at(
              grammar,
              probe,
              wx,
              wz,
              seed,
              surf.surface_y,
              treeline,
              grammar_biome_density(grammar, biome.name)
            )
          : hash_column(wx, wz, (seed ^ SALT_TREE) >>> 0) % rule.tree_one_in !== 0
      )
        continue
      let species = select_tree_species(ctx, biome.name, wx, wz, seed)
      // HERO override — MUST match the near decorator (else species×age ⇒ atlas layer drifts at the seam).
      if (grammar && species !== null) {
        const hero = grammar_hero_species(grammar, wx, wz, seed)
        if (hero && hero in SPECIES) species = hero
      }
      if (species === null || !(species in SPECIES)) continue
      const age =
        variant_ages !== null
          ? variant_ages[hash_column(wx, wz, (seed ^ SALT_TREE_VARIANT) >>> 0) % bake_n]
          : pick_age(make_rng(hash5((seed ^ SALT_TREE_GEN) >>> 0, wx, wz, 0, 0)))
      const layer = impostor_layer(species, age)
      if (layer < 0) continue
      const c = CANON[layer]
      out.push(wx, canonical_base_y(ctx, wx, wz, layer), wz, c.w, c.h, layer)
    }
  }
  return { count: out.length / IMPOSTOR_FLOATS_PER_TREE, data: Float32Array.from(out) }
}
