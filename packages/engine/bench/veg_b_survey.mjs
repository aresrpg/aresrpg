// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// VEG PHASE B exit probe — surveys the schematic-forest decorator over a wide world region and
// writes /tmp/aresrpg-engine-artifacts/veg_b_report.json with per-biome tree/rock counts + the full
// species distribution, PROVING all 10 tree families (every one of the 20 variants) + ≥5 rock
// families actually spawn. It reproduces the decorator's PURE anchor decision (the exported
// BIOME_SCHEMATICS mapping + stamper.select_schematic — the ground truth of what decorate_chunk
// stamps) over both a contiguous 16×16-chunk block AND targeted windows on rare biomes (desert/swamp
// are so sparse for the hardcoded seed that a contiguous block alone would miss them), then generates
// a handful of real forest chunks end-to-end to confirm the stamped canopies actually MESH.
//
// Run:  bun bench/veg_b_survey.mjs
// (Pure/deterministic; no rendering. Safe to re-run.)

import { mkdirSync, writeFileSync } from 'node:fs'

import { CHUNK_SIZE, SEA_LEVEL, MASTER_SEED } from '../src/config/world_config.js'
import { create_gen_context, anchor_surface } from '../src/gen/column_gen.js'
import { get_biome_by_id, BIOME_REGISTRY } from '../src/config/biome_registry.js'
import { get_block_by_name } from '../src/config/block_registry.js'
import { load_schematic_set } from '../src/gen/schematics/loader.js'
import { select_schematic } from '../src/gen/schematics/stamper.js'
import { BIOME_SCHEMATICS, filter_by_prefix } from '../src/gen/surface_decorator.js'
import { generate_world_chunk } from '../src/gen/world_gen.js'
import { mesh_chunk } from '../src/mesh/mesher.js'
import { decode_quad } from '../src/mesh/quad_buffer.js'

const ctx = create_gen_context()
const seed = ctx.seeds.decorators
const TREE_SET = load_schematic_set('tree')
const ROCK_SET = load_schematic_set('rock')

// ---- decorator decision constants (mirror surface_decorator.js — the ground-truth placement) ----
const SALT_TREE_GROVE = 0x7feb352d
const SALT_ROCK_GROVE = 0x2545f491
const SALT_TREE = 0x9e3779b1
const SALT_ROCK = 0x94d049bb
const GROVE_CELL_SHIFT = 4
const TREE_GROVE_ONE_IN = 3
const ROCK_GROVE_ONE_IN = 6
const U32 = 0xffffffff

/** @param {number} x @param {number} z @param {number} s */
function hash_column(x, z, s) {
  let h = (x * 374761393 + z * 668265263 + s * 2246822519) & U32
  h = (h ^ (h >>> 13)) & U32
  h = (h * 1274126177) & U32
  h = (h ^ (h >>> 16)) & U32
  return h >>> 0
}
/** @param {number} x @param {number} z @param {number} s @param {number} o */
function in_grove(x, z, s, o) {
  return hash_column(x >> GROVE_CELL_SHIFT, z >> GROVE_CELL_SHIFT, s) % o === 0
}

/** @type {Map<string, {trees: any[], rocks: any[], ti: number, ri: number}>} */
const resolved = new Map()
for (const [name, rule] of Object.entries(BIOME_SCHEMATICS)) {
  resolved.set(name, {
    trees: filter_by_prefix(TREE_SET, rule.trees),
    rocks: filter_by_prefix(ROCK_SET, rule.rocks),
    ti: rule.tree_one_in,
    ri: rule.rock_one_in,
  })
}

/** The decorator's pure placement decision at one anchor column: { kind, name } or null. */
function placement_at(wx, wz) {
  const tg = in_grove(wx, wz, (seed ^ SALT_TREE_GROVE) >>> 0, TREE_GROVE_ONE_IN)
  const rg = in_grove(wx, wz, (seed ^ SALT_ROCK_GROVE) >>> 0, ROCK_GROVE_ONE_IN)
  if (!tg && !rg) return null
  const surf = anchor_surface(ctx, wx, wz)
  if (surf.surface_y <= SEA_LEVEL) return null
  const biome = get_biome_by_id(surf.biome_id)
  if (!biome) return null
  const r = resolved.get(biome.name)
  if (!r) return null
  if (tg && r.trees.length && r.ti > 0 && hash_column(wx, wz, (seed ^ SALT_TREE) >>> 0) % r.ti === 0) {
    const p = select_schematic(seed, wx, wz, r.trees)
    if (p) return { kind: 'tree', name: p.schematic.name, biome: biome.name }
  }
  if (rg && r.rocks.length && r.ri > 0 && hash_column(wx, wz, (seed ^ SALT_ROCK) >>> 0) % r.ri === 0) {
    const p = select_schematic(seed, wx, wz, r.rocks)
    if (p) return { kind: 'rock', name: p.schematic.name, biome: biome.name }
  }
  return null
}

const family_of = (/** @type {string} */ n) => n.replace(/_G\d+$/, '')

// ---- Survey regions --------------------------------------------------------------------------
// A contiguous 16×16-chunk block (512×512 blocks) at origin + targeted windows on each biome's known
// location for the hardcoded seed (so rare biomes register). Every column is surveyed once.
const SURVEY = { tree_species: {}, rock_species: {}, per_biome: {} }
/** @param {number} x0 @param {number} z0 @param {number} x1 @param {number} z1 */
function survey_region(x0, z0, x1, z1) {
  for (let wz = z0; wz <= z1; wz += 1) {
    for (let wx = x0; wx <= x1; wx += 1) {
      const p = placement_at(wx, wz)
      if (!p) continue
      const bucket = p.kind === 'tree' ? SURVEY.tree_species : SURVEY.rock_species
      bucket[p.name] = (bucket[p.name] || 0) + 1
      SURVEY.per_biome[p.biome] = SURVEY.per_biome[p.biome] || { tree: 0, rock: 0 }
      SURVEY.per_biome[p.biome][p.kind] += 1
    }
  }
}

// contiguous 16×16-chunk block at origin
survey_region(0, 0, 16 * CHUNK_SIZE - 1, 16 * CHUNK_SIZE - 1)
// targeted biome windows centered on each biome's DENSEST cluster for the hardcoded seed (found by a
// land-biome cluster scan). Rare biomes (desert 1/90, swamp big-tree 1/16) need a big window on a real
// cluster or a contiguous block alone misses them. [name, center_x, center_z, half_width].
const WINDOWS = [
  ['grassland', -3552, -4000, 500],
  ['temperate_forest', -3696, -4000, 500],
  ['taiga', -2368, -4000, 500],
  ['dense_forest', -2080, -4000, 500],
  ['tropical', -1088, -3552, 500],
  ['swamp', 7424, -512, 900],
  ['desert', -2048, 7424, 1400],
  ['scorched_badlands', -464, -3760, 700],
  ['arctic', -2032, -3712, 700],
  ['glacier', 1760, 192, 500],
]
for (const [, cx, cz, w] of WINDOWS) survey_region(cx - w, cz - w, cx + w, cz + w)

// ---- End-to-end mesh confirmation (real chunks emit leaf quads) -------------------------------
const LEAVES = get_block_by_name('leaves')?.id
let mesh_leaf_quads = 0
for (const [cx, cz] of [
  [-4, 0],
  [-3, 0],
  [-4, 1],
]) {
  for (let cy = 4; cy <= 6; cy += 1) {
    const chunk = generate_world_chunk(cx, cy, cz)
    const { quad_buffer, quad_count } = mesh_chunk(chunk, undefined)
    for (let i = 0; i < quad_count; i += 1) {
      if (decode_quad([quad_buffer[i * 2], quad_buffer[i * 2 + 1]]).block_id === LEAVES) mesh_leaf_quads += 1
    }
  }
}

// ---- Report ----------------------------------------------------------------------------------
const all_tree_names = TREE_SET.map((s) => s.name).sort()
const all_rock_names = ROCK_SET.map((s) => s.name).sort()
const tree_families = [...new Set(all_tree_names.map(family_of))].sort()
const rock_families = [...new Set(all_rock_names.map(family_of))].sort()
const spawned_tree_families = [...new Set(Object.keys(SURVEY.tree_species).map(family_of))].sort()
const spawned_rock_families = [...new Set(Object.keys(SURVEY.rock_species).map(family_of))].sort()

const report = {
  seed: MASTER_SEED,
  gen_version: 4,
  halo_reach: { tree: Math.max(...TREE_SET.map((s) => s.reach)), rock: Math.max(...ROCK_SET.map((s) => s.reach)) },
  totals: {
    tree_species_defined: all_tree_names.length,
    rock_species_defined: all_rock_names.length,
    tree_families_defined: tree_families.length,
    rock_families_defined: rock_families.length,
    tree_species_spawned: Object.keys(SURVEY.tree_species).length,
    rock_species_spawned: Object.keys(SURVEY.rock_species).length,
    tree_families_spawned: spawned_tree_families.length,
    rock_families_spawned: spawned_rock_families.length,
  },
  proof: {
    all_10_tree_families_spawn: spawned_tree_families.length === 10,
    at_least_5_rock_families_spawn: spawned_rock_families.length >= 5,
    mesh_confirms_canopy: mesh_leaf_quads > 0,
    mesh_leaf_quads,
    missing_tree_species: all_tree_names.filter((n) => !SURVEY.tree_species[n]),
    missing_rock_species: all_rock_names.filter((n) => !SURVEY.rock_species[n]),
  },
  tree_families_spawned: spawned_tree_families,
  rock_families_spawned: spawned_rock_families,
  tree_species: SURVEY.tree_species,
  rock_species: SURVEY.rock_species,
  per_biome: SURVEY.per_biome,
}

mkdirSync('/tmp/aresrpg-engine-artifacts', { recursive: true })
writeFileSync('/tmp/aresrpg-engine-artifacts/veg_b_report.json', JSON.stringify(report, null, 2))
console.log('wrote /tmp/aresrpg-engine-artifacts/veg_b_report.json')
console.log(
  'tree families spawned:',
  report.totals.tree_families_spawned,
  '/',
  report.totals.tree_families_defined,
  '| tree variants:',
  report.totals.tree_species_spawned,
  '/',
  report.totals.tree_species_defined
)
console.log(
  'rock families spawned:',
  report.totals.rock_families_spawned,
  '/',
  report.totals.rock_families_defined,
  '| rock variants:',
  report.totals.rock_species_spawned,
  '/',
  report.totals.rock_species_defined
)
console.log(
  'proof:',
  JSON.stringify(
    report.proof.all_10_tree_families_spawn &&
      report.proof.at_least_5_rock_families_spawn &&
      report.proof.mesh_confirms_canopy
      ? 'PASS'
      : 'FAIL'
  ),
  '| leaf quads:',
  mesh_leaf_quads
)
if (report.proof.missing_tree_species.length) console.log('  missing tree variants:', report.proof.missing_tree_species)
