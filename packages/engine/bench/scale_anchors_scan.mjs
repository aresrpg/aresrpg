// B2 scale-identity anchor scan — locates procedural-tree clusters for the four contact-sheet biomes
// (taiga / temperate_forest / swamp / desert) in the DEFAULT "aresrpg" world, so the contact-sheet spec
// can PARK a camera on a real cluster per biome. Pure/deterministic gen decision (mirrors the decorator's
// proctrees gate: grove hash → density hash → biome roster), no rendering. Run: bun bench/scale_anchors_scan.mjs
import { SEA_LEVEL } from '../src/config/world_config.js'
import { create_gen_context, anchor_surface } from '../src/gen/column_gen.js'
import { get_biome_by_id } from '../src/config/biome_registry.js'
import { load_schematic_set } from '../src/gen/schematics/loader.js'
import { BIOME_SCHEMATICS, filter_by_prefix } from '../src/gen/surface_decorator.js'

const ctx = create_gen_context()
const seed = ctx.seeds.decorators

// decorator gate constants (mirror surface_decorator.js — the ground-truth placement).
const SALT_TREE_GROVE = 0x7feb352d
const SALT_TREE = 0x9e3779b1
const GROVE_CELL_SHIFT = 4
const TREE_GROVE_ONE_IN = 3
const U32 = 0xffffffff
const hash_column = (x, z, s) => {
  let h = (x * 374761393 + z * 668265263 + s * 2246822519) & U32
  h = (h ^ (h >>> 13)) & U32
  h = (h * 1274126177) & U32
  h = (h ^ (h >>> 16)) & U32
  return h >>> 0
}
const in_grove = (x, z, s, o) => hash_column(x >> GROVE_CELL_SHIFT, z >> GROVE_CELL_SHIFT, s) % o === 0

const TREE_SET = load_schematic_set('tree')
/** @type {Map<string, number>} */ const tree_one_in = new Map()
for (const [name, rule] of Object.entries(BIOME_SCHEMATICS)) {
  if (filter_by_prefix(TREE_SET, rule.trees).length) tree_one_in.set(name, rule.tree_one_in)
}

/** Does the proctrees tree gate fire at this anchor column (grove + density), and in which biome? */
function tree_anchor_at(wx, wz) {
  if (!in_grove(wx, wz, (seed ^ SALT_TREE_GROVE) >>> 0, TREE_GROVE_ONE_IN)) return null
  const surf = anchor_surface(ctx, wx, wz)
  if (surf.surface_y <= SEA_LEVEL) return null
  const biome = get_biome_by_id(surf.biome_id)
  if (!biome) return null
  const ti = tree_one_in.get(biome.name)
  if (!ti || ti <= 0) return null
  if (hash_column(wx, wz, (seed ^ SALT_TREE) >>> 0) % ti !== 0) return null
  return { biome: biome.name, surface_y: surf.surface_y }
}

// windows centered on each biome's known cluster for the hardcoded seed (from veg_b_survey.mjs).
const WINDOWS = {
  taiga: [-2368, -4000, 500],
  temperate_forest: [-3696, -4000, 500],
  swamp: [7424, -512, 900],
  desert: [-2048, 7424, 1400],
}

for (const [target, [cx, cz, w]] of Object.entries(WINDOWS)) {
  /** @type {Array<{wx:number,wz:number,y:number}>} */ const hits = []
  for (let wz = cz - w; wz <= cz + w && hits.length < 4000; wz += 1) {
    for (let wx = cx - w; wx <= cx + w; wx += 1) {
      const a = tree_anchor_at(wx, wz)
      if (a && a.biome === target) hits.push({ wx, wz, y: a.surface_y })
    }
  }
  // densest 40×40 cell → a cluster the camera can frame.
  /** @type {Map<string, {cx:number,cz:number,n:number,ys:number[]}>} */ const cells = new Map()
  for (const h of hits) {
    const key = `${h.wx >> 5},${h.wz >> 5}`
    const c = cells.get(key) || { cx: (h.wx >> 5) * 32 + 16, cz: (h.wz >> 5) * 32 + 16, n: 0, ys: [] }
    c.n += 1
    c.ys.push(h.y)
    cells.set(key, c)
  }
  const [best] = [...cells.values()].sort((a, b) => b.n - a.n)
  if (!best) {
    console.log(`${target}: NO tree anchors found in window`)
    continue
  }
  const my = Math.round(best.ys.reduce((s, v) => s + v, 0) / best.ys.length)
  console.log(
    `${target}: cluster center (${best.cx},${best.cz}) surface_y≈${my} · ${best.n} tree anchors in the 32² cell · total hits ${hits.length}`
  )
}
