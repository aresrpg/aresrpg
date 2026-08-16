// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// One-off converter: aresrpg-legacy Sponge `.schem` (gzip NBT) packs → the engine's compact house
// format at packages/engine/assets/schematics/schematics.json. Bun/Node runnable, node builtins
// only (zlib, fs, path) — HOUSE LAW: no new deps. Re-run to regenerate the shipped asset.
//
//   bun scripts/convert_schematics.mjs          # default legacy source path
//   SCHEM_SRC=/path/to/schematics bun scripts/convert_schematics.mjs
//
// Source format is Sponge Schematic v2: root TAG_Compound "Schematic" with Short Width/Height/
// Length, a Palette compound (blockstate string -> Int index), and a ByteArray BlockData of
// VARINT-packed palette indices addressed as `x + z*Width + y*Width*Length` (Y is up). We strip
// blockstate properties (`oak_wood[axis=y]` -> `oak_wood`), drop air, collapse the palette to the
// non-air base names actually referenced, and store voxels sparsely (mostly-air trees compress
// hard this way). loader.js reads the bundle; registry_map.js maps the base names to block ids.
//
// FULL PACK (FIVE-WORLDS P2): converts EVERY .schem in trees/ + rocks/ (not a curated subset) and
// classifies each into a PLACEMENT POOL derived from the real legacy family names (see classify_pool).
// The bundle carries `pools` (pool id -> member names) as the single source of truth for pool
// membership; biome_registry.structure_pools references these ids. Category (tree|rock) is retained
// for the existing load_schematic_set() picker. Any file that fails to parse is REPORTED, never
// silently dropped. The dapp copies (packages/dapp/.../terrain) are byte-identical duplicates of the
// sdk packs (verified), so only the sdk source is converted.

import { gunzipSync, gzipSync } from 'node:zlib'
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ENGINE_ROOT = join(__dirname, '..')
const SRC_ROOT = process.env.SCHEM_SRC || '<path-to>/aresrpg-legacy/packages/sdk/src/world/schematics'
const OUT_BUNDLE = join(ENGINE_ROOT, 'assets/schematics/schematics.json')
const OUT_REPORT = process.env.SCHEM_REPORT_OUT ?? '/tmp/aresrpg-engine-artifacts/veg_a_report.json'

/** The two source sub-directories, each mapped to a runtime category. */
/** @type {{ category: 'tree'|'rock', dir: string }[]} */
const SOURCE_DIRS = [
  { category: 'tree', dir: 'trees' },
  { category: 'rock', dir: 'rocks' },
]

// Brand law: file names carry legacy French flavor family names (SAPIN=fir, CHENE=oak, BOUE=mud,
// BUISSON=bush, YGLOO=igloo, CORAIL=coral, …) — none are banned brand tokens. This guard fails the
// ---- placement-pool taxonomy (derived from the REAL legacy family names) ------------------------
// Ordered keyword rules; FIRST match wins. Matched against the UPPERCASE schematic name (properties
// like the `_G<n>` growth-variant suffix are irrelevant to the family). Grounded 1:1 in the names
// that actually exist in the packs — no invented families. Reported per-pool at the end of the run.

/** @type {{ substr: string, pool: string }[]} tree rules */
const TREE_POOL_RULES = [
  // Bare/dead silhouettes first (DESERT_DEAD_TREE / SWAMP_DEAD_TREE must beat the biome tree rules).
  { substr: 'DEADTREE', pool: 'pool_dead_trees' },
  { substr: 'DEAD_TREE', pool: 'pool_dead_trees' },
  { substr: 'CACTUS', pool: 'pool_desert_flora' },
  { substr: 'MUSHROND', pool: 'pool_giant_mushrooms' },
  { substr: 'MUSHTALL', pool: 'pool_giant_mushrooms' },
  { substr: 'SAPIN', pool: 'pool_conifers' }, // fir/spruce evergreens (TAIGA_*_SAPIN_*)
  { substr: 'ACACIA', pool: 'pool_savanna_trees' },
  { substr: 'BIRCH', pool: 'pool_birch' },
  // Swamp undergrowth before generic swamp trees, and before the tropical undergrowth rule (PLANTE
  // is shared): SWAMP_PLANTE is wetland groundcover, TROPICAL_PLANTE is jungle groundcover.
  { substr: 'SWAMP_PLANTE', pool: 'pool_swamp_undergrowth' },
  { substr: 'BUISSON', pool: 'pool_tropical_undergrowth' },
  { substr: 'CARNIVOR', pool: 'pool_tropical_undergrowth' },
  { substr: 'PLANTE', pool: 'pool_tropical_undergrowth' },
  { substr: 'SWAMP', pool: 'pool_swamp_trees' }, // SWAMP_BIG_TREE / SWAMP_NORMAL_TREE
  { substr: 'TROPICAL', pool: 'pool_jungle_giants' }, // TROPICAL_NORMAL_TREE — large jungle canopy
  { substr: 'DESERT', pool: 'pool_desert_flora' }, // remaining DESERT_TREE
  // default (GRASSLAND_TREE / GRASSLAND_BIG_TREE / TEMPERATE_LARGE_TREE / TEMPERATE_THIN_TREE /
  // TAIGA_CHENE_BIG / TAIGA_NORMAL_CHENE / TAIGA_TREE) → generic deciduous canopy.
]
const TREE_POOL_DEFAULT = 'pool_broadleaf'

/** @type {{ substr: string, pool: string }[]} rock rules */
const ROCK_POOL_RULES = [
  // Built landmarks / foreground anchors (bridges, igloos, pyramids). BRIDGE must beat ICE/STONE.
  { substr: 'BRIDGE', pool: 'pool_structures' },
  { substr: 'YGLOO', pool: 'pool_structures' },
  { substr: 'PYRAMIDE', pool: 'pool_structures' },
  { substr: 'CORAIL', pool: 'pool_coral' }, // reef (colored decorative blocks → stone/leaves)
  { substr: 'BOUE', pool: 'pool_mud_mounds' }, // mud mounds → dirt
  { substr: 'LAVA', pool: 'pool_rocks_volcanic' }, // SCORCHED_ROCK_LAVA
  { substr: 'ICE', pool: 'pool_ice' }, // BIG_ICE/ICEBERG/ICEFORME/ICEPIC/ICESURFACE (ice → snow)
  { substr: 'GLACIER_GLACIER', pool: 'pool_ice' }, // glacier ice mass (no ICE substring)
  { substr: 'SCORCHED', pool: 'pool_rocks_sandstone' }, // DOME/LITTLE arid outcrops
  { substr: 'DESERT', pool: 'pool_rocks_sandstone' }, // DESERT_BIG_ROCK
  { substr: 'TROPICAL', pool: 'pool_rocks_tropical' },
  { substr: 'ARCTIC', pool: 'pool_rocks_alpine' }, // ARCTIC_BIG_ROCK — cold grey boulders
  { substr: 'GLACIER', pool: 'pool_rocks_alpine' }, // GLACIER_ROCK / GLACIER_BIG_ROCK
  // default (GRASSLAND_ROCK[_BIG] / TEMPERATE_ROCK / TAIGA_ROCK) → generic grey boulders.
]
const ROCK_POOL_DEFAULT = 'pool_rocks_granite'

/**
 * Classifies a schematic into its placement pool from the real family name. Pure keyword match.
 * @param {string} name schematic entry name (e.g. "TAIGA_HUGE_SAPIN_G2")
 * @param {'tree'|'rock'} category
 * @returns {string} pool id (snake_case)
 */
function classify_pool(name, category) {
  const upper = name.toUpperCase()
  const rules = category === 'tree' ? TREE_POOL_RULES : ROCK_POOL_RULES
  for (const rule of rules) if (upper.includes(rule.substr)) return rule.pool
  return category === 'tree' ? TREE_POOL_DEFAULT : ROCK_POOL_DEFAULT
}

// ---- minimal big-endian NBT reader (only the tags Sponge schematics use; others are skipped) ----

const TAG_END = 0
const TAG_BYTE = 1
const TAG_SHORT = 2
const TAG_INT = 3
const TAG_LONG = 4
const TAG_FLOAT = 5
const TAG_DOUBLE = 6
const TAG_BYTE_ARRAY = 7
const TAG_STRING = 8
const TAG_LIST = 9
const TAG_COMPOUND = 10
const TAG_INT_ARRAY = 11
const TAG_LONG_ARRAY = 12

class NbtReader {
  /** @param {Uint8Array} bytes unsigned decompressed NBT */
  constructor(bytes) {
    this.b = bytes
    this.o = 0
  }
  u8() {
    return this.b[this.o++]
  }
  u16() {
    const v = (this.b[this.o] << 8) | this.b[this.o + 1]
    this.o += 2
    return v
  }
  i16() {
    const v = this.u16()
    return v < 0x8000 ? v : v - 0x10000
  }
  i32() {
    const v = (this.b[this.o] << 24) | (this.b[this.o + 1] << 16) | (this.b[this.o + 2] << 8) | this.b[this.o + 3]
    this.o += 4
    return v // already signed via <<24
  }
  str() {
    const len = this.u16()
    const s = Buffer.from(this.b.subarray(this.o, this.o + len)).toString('utf8')
    this.o += len
    return s
  }
  /** Reads a tag payload of `type`, consuming exactly its bytes. Returns a JS value. */
  payload(type) {
    switch (type) {
      case TAG_BYTE:
        return this.u8()
      case TAG_SHORT:
        return this.i16()
      case TAG_INT:
        return this.i32()
      case TAG_LONG:
        this.o += 8
        return 0
      case TAG_FLOAT:
        this.o += 4
        return 0
      case TAG_DOUBLE:
        this.o += 8
        return 0
      case TAG_BYTE_ARRAY: {
        const len = this.i32()
        const arr = this.b.subarray(this.o, this.o + len)
        this.o += len
        return arr
      }
      case TAG_STRING:
        return this.str()
      case TAG_LIST: {
        const el = this.u8()
        const len = this.i32()
        const out = []
        for (let i = 0; i < len; i++) out.push(this.payload(el))
        return out
      }
      case TAG_COMPOUND: {
        /** @type {Record<string, any>} */
        const obj = {}
        for (;;) {
          const t = this.u8()
          if (t === TAG_END) break
          const name = this.str()
          obj[name] = this.payload(t)
        }
        return obj
      }
      case TAG_INT_ARRAY: {
        const len = this.i32()
        const out = new Array(len)
        for (let i = 0; i < len; i++) out[i] = this.i32()
        return out
      }
      case TAG_LONG_ARRAY: {
        const len = this.i32()
        this.o += len * 8
        return []
      }
      default:
        throw new Error(`unknown NBT tag ${type} at offset ${this.o}`)
    }
  }
  /** Parses a whole archive: leading compound tag + name + payload. */
  root() {
    const t = this.u8()
    if (t !== TAG_COMPOUND) throw new Error('root tag is not a compound')
    this.str() // root name ("Schematic")
    return this.payload(TAG_COMPOUND)
  }
}

/**
 * LEB128 varint decode of a Sponge BlockData byte array → palette indices.
 * @param {Uint8Array} bytes unsigned
 * @param {number} expected voxel count (W*H*L) for a sanity check
 * @returns {number[]}
 */
function decode_varints(bytes, expected) {
  const out = []
  let i = 0
  while (i < bytes.length) {
    let value = 0
    let shift = 0
    let b
    do {
      b = bytes[i++]
      value |= (b & 0x7f) << shift
      shift += 7
    } while (b & 0x80)
    out.push(value >>> 0)
  }
  if (out.length !== expected) throw new Error(`BlockData count ${out.length} != W*H*L ${expected}`)
  return out
}

/** `minecraft:oak_wood[axis=y]` → `oak_wood`. */
function base_name(blockstate) {
  const colon = blockstate.indexOf(':')
  const raw = colon >= 0 ? blockstate.slice(colon + 1) : blockstate
  const bracket = raw.indexOf('[')
  return bracket >= 0 ? raw.slice(0, bracket) : raw
}

/**
 * Parse one .schem into the house entry (sparse, air-dropped, palette collapsed to used bases).
 * @param {string} path
 * @param {'tree'|'rock'} category
 * @returns {{ entry: object, report: object }}
 */
function convert_one(path, category) {
  const raw = gunzipSync(readFileSync(path))
  const nbt = new NbtReader(new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength)).root()
  const width = nbt.Width
  const height = nbt.Height
  const length = nbt.Length
  if (!Number.isFinite(width) || !Number.isFinite(height) || !Number.isFinite(length))
    throw new Error(`missing/invalid dims W=${width} H=${height} L=${length}`)
  /** @type {Record<string, number>} palette: blockstate -> index */
  const palette = nbt.Palette
  if (palette === undefined) throw new Error('no Palette compound')
  if (nbt.BlockData === undefined) throw new Error('no BlockData array')
  /** index -> base name */
  const base_by_index = []
  for (const [state, idx] of Object.entries(palette)) base_by_index[idx] = base_name(state)
  const indices = decode_varints(nbt.BlockData, width * height * length)

  /** collapsed non-air palette: base name -> new index (first-seen order) */
  const used = new Map()
  const voxels = []
  /** @type {Record<string, number>} per-base non-air block counts (for the report) */
  const palette_counts = {}
  let min_y = Infinity
  for (let y = 0; y < height; y++) {
    for (let z = 0; z < length; z++) {
      for (let x = 0; x < width; x++) {
        const base = base_by_index[indices[x + z * width + y * width * length]]
        if (base === undefined || base === 'air' || base === 'cave_air' || base === 'void_air') continue
        let ni = used.get(base)
        if (ni === undefined) {
          ni = used.size
          used.set(base, ni)
        }
        voxels.push(x, y, z, ni)
        palette_counts[base] = (palette_counts[base] ?? 0) + 1
        if (y < min_y) min_y = y
      }
    }
  }
  if (min_y === Infinity) min_y = 0

  const entry = {
    category,
    size: [width, height, length],
    // Anchor: geometric horizontal center + lowest non-air layer. Placing at a column puts the
    // schematic's lowest solid voxel on `surface_y` and centers its footprint on the column.
    anchor: [width >> 1, min_y, length >> 1],
    palette: [...used.keys()],
    voxels,
  }
  const report = {
    category,
    size: [width, height, length],
    blocks: voxels.length / 4,
    palette_counts,
  }
  return { entry, report }
}

// ---- run ----

/** @type {Record<string, object>} */
const bundle_schematics = {}
const report_schematics = []
/** @type {Record<string, number>} distinct base name -> total block count across the pack */
const distinct_blocks = {}
/** @type {Record<'tree'|'rock', string[]>} category -> member names */
const categories = { tree: [], rock: [] }
/** @type {Map<string, string[]>} pool id -> member names */
const pools = new Map()
/** @type {{ name: string, reason: string }[]} */
const failures = []
/** @type {{ name: string, tokens: string[] }[]} */

for (const { category, dir } of SOURCE_DIRS) {
  const files = readdirSync(join(SRC_ROOT, dir))
    .filter((f) => f.endsWith('.schem'))
    .sort()
  for (const file of files) {
    const name = file.replace(/\.schem$/, '')
    const path = join(SRC_ROOT, dir, file)
    try {
      const { entry, report } = convert_one(path, category)
      if (report.blocks === 0) throw new Error('empty schematic (0 non-air voxels)')
      const pool = classify_pool(name, category)
      bundle_schematics[name] = entry
      report_schematics.push({ name, pool, ...report })
      categories[category].push(name)
      if (!pools.has(pool)) pools.set(pool, [])
      pools.get(pool).push(name)
      for (const [base, count] of Object.entries(report.palette_counts))
        distinct_blocks[base] = (distinct_blocks[base] ?? 0) + count
    } catch (err) {
      failures.push({ name, reason: /** @type {Error} */ (err).message })
      console.error(`FAILED ${name}: ${/** @type {Error} */ (err).message}`)
    }
  }
}

// Deterministic ordering: pool ids sorted, members sorted within each pool.
/** @type {Record<string, string[]>} */
const pools_obj = {}
for (const pool of [...pools.keys()].sort()) pools_obj[pool] = [...(pools.get(pool) ?? [])].sort()

const bundle = {
  version: 2,
  source: 'aresrpg-legacy sponge .schem packs (trees + rocks), full pack',
  categories: { tree: categories.tree.sort(), rock: categories.rock.sort() },
  pools: pools_obj,
  schematics: bundle_schematics,
}
mkdirSync(dirname(OUT_BUNDLE), { recursive: true })
writeFileSync(OUT_BUNDLE, JSON.stringify(bundle))
const bytes = readFileSync(OUT_BUNDLE).byteLength
const gz_bytes = gzipSync(readFileSync(OUT_BUNDLE)).byteLength

// Per-pool summary for the delta report.
const pool_summary = Object.fromEntries(
  Object.entries(pools_obj).map(([pool, names]) => [pool, { count: names.length, examples: names.slice(0, 3) }])
)

mkdirSync(dirname(OUT_REPORT), { recursive: true })
writeFileSync(
  OUT_REPORT,
  JSON.stringify(
    {
      generated_at: new Date().toISOString(),
      source: SRC_ROOT,
      bundle_bytes: bytes,
      bundle_gzip_bytes: gz_bytes,
      total_schematics: report_schematics.length,
      category_counts: { tree: categories.tree.length, rock: categories.rock.length },
      pools: pool_summary,
      distinct_blocks,
      failures,
      schematics: report_schematics,
    },
    null,
    2
  )
)

console.log(`\nbundle: ${OUT_BUNDLE}`)
console.log(`  raw:  ${(bytes / 1024 / 1024).toFixed(2)} MB (${bytes} bytes)`)
console.log(`  gzip: ${(gz_bytes / 1024 / 1024).toFixed(2)} MB (${gz_bytes} bytes)`)
console.log(`report: ${OUT_REPORT}`)
console.log(
  `${report_schematics.length} schematics (${categories.tree.length} tree / ${categories.rock.length} rock), ` +
    `${Object.keys(distinct_blocks).length} distinct blocks, ${Object.keys(pools_obj).length} pools, ` +
    `${failures.length} failures`
)
console.log('\nPOOLS:')
for (const [pool, names] of Object.entries(pools_obj))
  console.log(`  ${pool.padEnd(26)} ${String(names.length).padStart(3)}  e.g. ${names.slice(0, 2).join(', ')}`)
if (failures.length) {
  console.log('\nFAILURES:')
  for (const f of failures) console.log(`  ${f.name}: ${f.reason}`)
}
