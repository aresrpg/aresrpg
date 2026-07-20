// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// RAINFOREST v2 lane VISUAL PROOF + coverage histogram (no WebGPU) of the DECORATED gen pipeline under
// the RAINFOREST_WORLD recipe. Measures the ground-material mix (sand vs forest-floor vs rock), canopy
// coverage, and water coverage over the ±256 region, and renders top-down + ground-pose rasters + a
// palette swatch. PNGs + stats → a local gitignored output dir.
//   Run:  bun packages/engine/scripts/rainforest_raster.mjs

import { writeFileSync, mkdirSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { generate_world_chunk, set_gen_config } from '../src/gen/world_gen.js'
import { RAINFOREST_WORLD } from '../src/config/worlds/rainforest.js'
import { SEA_LEVEL, CHUNK_SIZE, WORLD_HEIGHT, CHUNKS_PER_COLUMN } from '../src/config/world_config.js'
import { local_index } from '../src/chunks/format.js'
import { get_block_by_id, get_block_by_name } from '../src/config/block_registry.js'

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'scratchpad', 'biomes', 'rainforest_v2')
mkdirSync(OUT, { recursive: true })

const id_of = (n) => get_block_by_id_or(n)
function get_block_by_id_or(n) {
  return get_block_by_name(n).id
}
const AIR = id_of('air'),
  WATER = id_of('water'),
  SAND = id_of('sand'),
  GRASS = id_of('grass'),
  DIRT = id_of('dirt')
const STONE = id_of('stone'),
  MOSSY = id_of('mossy_stone'),
  LOG = id_of('log'),
  LEAVES = id_of('leaves')
const SKY = [150, 196, 236]
const hex2rgb = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]
const COLOR = new Map()
for (let id = 0; id < 64; id += 1) {
  const b = get_block_by_id(id)
  if (b) COLOR.set(id, hex2rgb(b.map_color))
}
const color_of = (id) => (id === AIR ? SKY : (COLOR.get(id) ?? [255, 0, 255]))
const cls_of = (id) => get_block_by_id(id)?.class

// Family buckets for the coverage histogram: forest-floor (grass/dirt/humus + tree
// wood/leaves), sand (the reject), rock (limestone towers), water, snow/other.
const FLOOR_IDS = new Set([GRASS, DIRT, LOG, LEAVES, id_of('leaves_conifer'), id_of('fern')])
const ROCK_IDS = new Set([STONE, MOSSY, id_of('cave_stone')])
function family_of(id) {
  if (id === WATER) return 'water'
  if (id === SAND) return 'sand'
  if (FLOOR_IDS.has(id)) return 'floor'
  if (ROCK_IDS.has(id)) return 'rock'
  return 'other'
}

function save_png(name, W, H, get_rgb, scale = 2) {
  const w = W * scale,
    h = H * scale
  const buf = Buffer.alloc(w * h * 3)
  for (let y = 0; y < h; y += 1)
    for (let x = 0; x < w; x += 1) {
      const [r, g, b] = get_rgb((x / scale) | 0, (y / scale) | 0)
      const i = (y * w + x) * 3
      buf[i] = r
      buf[i + 1] = g
      buf[i + 2] = b
    }
  const ppm = join(OUT, name + '.ppm')
  writeFileSync(ppm, Buffer.concat([Buffer.from(`P6\n${w} ${h}\n255\n`), buf]))
  try {
    execSync(`sips -s format png "${ppm}" --out "${join(OUT, name + '.png')}"`, { stdio: 'ignore' })
    execSync(`rm -f "${ppm}"`)
    return name + '.png'
  } catch {
    return name + '.ppm'
  }
}

/** Decorated block reader over the ACTIVE recipe. Caches full 12-chunk columns. */
function make_reader() {
  const cache = new Map()
  return (wx, wy, wz) => {
    if (wy < 0 || wy >= WORLD_HEIGHT) return AIR
    const cx = Math.floor(wx / CHUNK_SIZE),
      cz = Math.floor(wz / CHUNK_SIZE)
    const key = cx + ',' + cz
    let col = cache.get(key)
    if (!col) {
      col = []
      for (let cy = 0; cy < CHUNKS_PER_COLUMN; cy += 1) col[cy] = generate_world_chunk(cx, cy, cz)
      cache.set(key, col)
    }
    const cy = Math.floor(wy / CHUNK_SIZE)
    return col[cy].ids[local_index(wx - cx * CHUNK_SIZE, wy - cy * CHUNK_SIZE, wz - cz * CHUNK_SIZE)]
  }
}

const Y_HI = 300
/** Topmost non-air block (id + y) — canopy/water/foliage all count as the visible top. */
function top_visible(read, wx, wz) {
  for (let y = Y_HI; y >= 2; y -= 1) {
    const id = read(wx, y, wz)
    if (id !== AIR) return { id, y }
  }
  return { id: AIR, y: 1 }
}
/** Topmost GROUND block (the terrain surface): skip water + foliage-cross + tree wood/leaves. */
function ground_top(read, wx, wz) {
  for (let y = Y_HI; y >= 2; y -= 1) {
    const id = read(wx, y, wz)
    if (id === AIR || id === WATER) continue
    if (cls_of(id) === 'foliage') continue
    if (id === LOG || id === LEAVES || id === id_of('leaves_conifer')) continue
    return { id, y }
  }
  return { id: AIR, y: 1 }
}

const results = []
set_gen_config(RAINFOREST_WORLD)
const rf = make_reader()

// Region: ±256 blocks about the origin (the inspection band).
const RX = -256,
  RZ = -256,
  RW = 512,
  RH = 512

// ── 1. COVERAGE HISTOGRAM + top-down GROUND raster ──────────────────────────────────────────────
// Every column: classify its GROUND material (terrain surface, under any canopy) into the family
// buckets, and separately test canopy presence (a leaf voxel above) + whether the column top is water.
{
  const ground_hist = new Map() // family → count
  const block_hist = new Map() // exact ground block id → count
  let canopy_cols = 0,
    total = 0
  const surf = []
  const file = save_png(
    '01_topdown_ground',
    RW,
    RH,
    (px, pz) => {
      const wx = RX + px,
        wz = RZ + pz
      const tv = top_visible(rf, wx, wz)
      // water columns render as jade (depth-shaded)
      if (tv.id === WATER) {
        let bed = tv.y
        for (let { y } = tv; y >= 2; y -= 1) {
          const b = rf(wx, y, wz)
          if (b !== WATER && b !== AIR) {
            bed = y
            break
          }
        }
        const depth = Math.max(0, tv.y - bed)
        const k = Math.max(0.4, 1 - depth * 0.06)
        return [Math.round(20 * k), Math.round(70 * k), Math.round(60 * k)]
      }
      return color_of(tv.id)
    },
    1
  )
  // second pass: ground-material stats (topdown raster already drawn from visible top)
  for (let pz = 0; pz < RH; pz += 1)
    for (let px = 0; px < RW; px += 1) {
      const wx = RX + px,
        wz = RZ + pz
      total += 1
      const tv = top_visible(rf, wx, wz)
      // canopy: any leaf voxel above this column
      let has_canopy = false
      for (let y = Y_HI; y >= SEA_LEVEL; y -= 1) {
        const b = rf(wx, y, wz)
        if (b === LEAVES || b === id_of('leaves_conifer')) {
          has_canopy = true
          break
        }
      }
      if (has_canopy) canopy_cols += 1
      const g = ground_top(rf, wx, wz)
      surf.push(g.y)
      const fam = tv.id === WATER ? 'water' : family_of(g.id)
      ground_hist.set(fam, (ground_hist.get(fam) ?? 0) + 1)
      block_hist.set(g.id, (block_hist.get(g.id) ?? 0) + 1)
    }
  surf.sort((a, b) => a - b)
  results.push(['01 top-down ground raster (±256)', file])
  const pct = (n) => ((100 * n) / total).toFixed(1) + '%'
  console.log('\n=== RAINFOREST v2 COVERAGE (±256, ' + total + ' columns) ===')
  console.log('ground family:')
  for (const fam of ['floor', 'sand', 'rock', 'water', 'other'])
    console.log('   ' + fam.padEnd(6), pct(ground_hist.get(fam) ?? 0), '(' + (ground_hist.get(fam) ?? 0) + ')')
  console.log('exact ground block:')
  for (const [id, n] of [...block_hist.entries()].sort((a, b) => b[1] - a[1]))
    console.log('   ' + (get_block_by_id(id)?.name ?? id).padEnd(14), pct(n))
  console.log('canopy coverage (leaf voxel above):', pct(canopy_cols))
  console.log('water top coverage:', pct(ground_hist.get('water') ?? 0))
  console.log('ground surface-y: min', surf[0], 'p50', surf[surf.length >> 1], 'max', surf[surf.length - 1])
  // stats file
  const lines = ['RAINFOREST v2 coverage (±256, ' + total + ' columns)', '']
  for (const fam of ['floor', 'sand', 'rock', 'water', 'other'])
    lines.push(fam.padEnd(6) + ' ' + pct(ground_hist.get(fam) ?? 0))
  lines.push(
    '',
    'canopy ' + pct(canopy_cols),
    'surface-y min ' + surf[0] + ' p50 ' + surf[surf.length >> 1] + ' max ' + surf[surf.length - 1]
  )
  writeFileSync(join(OUT, 'stats.txt'), lines.join('\n') + '\n')
}

function* top_visible_water_count() {
  yield 0
} // placeholder (water folded into ground_hist)

// ── 2. GROUND-POSE side elevation (canopy density + dark floor visible) ─────────────────────────
// A player-height slice through the densest-canopy strip found in the region.
{
  // seek the z-row with the most canopy over x∈[-128,128]
  let best_z = 0,
    best_hits = -1
  for (let z = RZ; z < RZ + RH; z += 8) {
    let hits = 0
    for (let x = -128; x < 128; x += 4) {
      for (let y = Y_HI; y >= SEA_LEVEL; y -= 1) {
        const b = rf(x, y, z)
        if (b === LEAVES) {
          hits += 1
          break
        }
      }
    }
    if (hits > best_hits) {
      best_hits = hits
      best_z = z
    }
  }
  const z = best_z,
    x0 = -128,
    W = 256,
    y_top = 210,
    H = 96
  const file = save_png(
    '02_ground_pose_side',
    W,
    H,
    (px, py) => {
      const wx = x0 + px,
        wy = y_top - py
      const id = rf(wx, wy, z)
      if (id === AIR) return wy < SEA_LEVEL ? color_of(WATER) : SKY
      return color_of(id)
    },
    4
  )
  results.push([`02 ground-pose side (z=${z}, canopy+floor, y ${y_top}→${y_top - H})`, file])
  console.log('ground-pose side strip at z=' + z + ' (canopy hits ' + best_hits + '/64)')
}

// ── 3. PALETTE SWATCH — the recipe's floor/canopy/timber/water colours ──────────────────────────
{
  const swatch_rows = [
    ['grass(floor)', color_of(GRASS)],
    ['leaves(canopy)', color_of(LEAVES)],
    ['log(timber)', color_of(LOG)],
    ['dirt(humus)', color_of(DIRT)],
    ['stone(karst)', color_of(STONE)],
    ['sand', color_of(SAND)],
    ['water body', RAINFOREST_WORLD.water.body_color.map((c) => Math.round(c * 255))],
    ['water shallow', RAINFOREST_WORLD.water.shallow_color.map((c) => Math.round(c * 255))],
  ]
  const CW = 64,
    CH = 32
  const file = save_png(
    '03_palette_swatch',
    CW * swatch_rows.length,
    CH,
    (px) => {
      const i = Math.min(swatch_rows.length - 1, (px / CW) | 0)
      return swatch_rows[i][1]
    },
    3
  )
  results.push(['03 palette swatch (floor|canopy|timber|humus|karst|sand|water×2)', file])
  console.log('palette:', swatch_rows.map((r) => r[0]).join(' | '))
}

console.log('\nRESULTS:')
for (const [label, file] of results) console.log(' •', file, '—', label)
console.log('saved to', OUT)
