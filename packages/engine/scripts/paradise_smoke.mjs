// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// PARADISE BEACH lane VISUAL + DATA smoke (FIVE-WORLDS §P3.5). Proves the paradise.js recipe with a
// no-WebGPU data raster (deterministic, shell-portable): validates the config, checks its identity hash
// differs from DEFAULT, sweeps candidate seeds for the best lagoon+beach+islet framing near the origin,
// measures coast coverage (deep water / shallow turquoise lagoon / white-sand beach / land) + a biome
// histogram (proving the `beach` biome is placed so palms have a home) + an actual palm voxel count,
// and renders a top-down map with the TURQUOISE→BLUE lagoon gradient (the coast optics previewed by the
// depth ramp) + a side-elevation cross-section of the shelf profile. PNGs + stats.txt →
// a local gitignored output dir. This is the everest_smoke oracle, retargeted for the coast story.
//
// Run:  bun packages/engine/scripts/paradise_smoke.mjs

import { writeFileSync, mkdirSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { create_gen_context, generate_column, anchor_surface } from '../src/gen/column_gen.js'
import { generate_world_chunk, set_gen_config } from '../src/gen/world_gen.js'
import { DEFAULT_WORLD_GEN_CONFIG, validate_world_gen_config, config_hash_hex } from '../src/config/world_gen_config.js'
import { SEA_LEVEL, CHUNK_SIZE, WORLD_HEIGHT, CHUNKS_PER_COLUMN } from '../src/config/world_config.js'
import { local_index } from '../src/chunks/format.js'
import { get_block_by_id, get_block_by_name } from '../src/config/block_registry.js'
import { get_biome_by_id } from '../src/config/biome_registry.js'
import { PARADISE_WORLD } from '../src/config/worlds/paradise.js'

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'scratchpad', 'biomes', 'paradise')
mkdirSync(OUT, { recursive: true })

const AIR = /** @type {number} */ (get_block_by_name('air')?.id)
const WATER = /** @type {number} */ (get_block_by_name('water')?.id)
const SAND = /** @type {number} */ (get_block_by_name('sand')?.id)
const PALM_LOG = /** @type {number} */ (get_block_by_name('palm_log')?.id)
const PALM_LEAF = /** @type {number} */ (get_block_by_name('palm_leaves')?.id)
const SKY = [176, 214, 236]
const hex2rgb = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]
const COLOR = new Map()
for (let id = 0; id < 64; id += 1) {
  const b = get_block_by_id(id)
  if (b) COLOR.set(id, hex2rgb(b.map_color))
}
const color_of = (id) => (id === AIR ? SKY : (COLOR.get(id) ?? [255, 0, 255]))

// Turquoise → deep-blue WATER preview: mirror the water_material depth ramp (shallow_color →
// body_color over smoothstep(fade_start, tint_depth)) using THIS world's optics, so the raster shows the
// exact lagoon gradient the shader paints. Linear 0..1 → 0..255 (a straight ×255; no tonemap, but enough
// to read the turquoise-shallow / rich-blue-deep story). depth = through-water blocks (SEA_LEVEL − seabed).
const W = PARADISE_WORLD.water
const smooth = (e0, e1, x) => {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)))
  return t * t * (3 - 2 * t)
}
function water_rgb(depth) {
  const t = smooth(W.fade_start, W.tint_depth, depth)
  return [0, 1, 2].map((k) => {
    const lin = W.shallow_color[k] + (W.body_color[k] - W.shallow_color[k]) * t
    return Math.max(0, Math.min(255, Math.round(lin * 255)))
  })
}

/** Write an [H][W] rgb grid as PPM then convert to PNG via macOS sips (falls back to .ppm). */
function save_png(name, WW, HH, get_rgb, scale = 3) {
  const w = WW * scale
  const h = HH * scale
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

/** A block reader over a config, caching one generated chunk-column per (cx,cz). */
function make_reader(config) {
  const ctx = create_gen_context(config)
  const cache = new Map()
  const read = (wx, wy, wz) => {
    if (wy < 0 || wy >= WORLD_HEIGHT) return AIR
    const cx = Math.floor(wx / CHUNK_SIZE)
    const cz = Math.floor(wz / CHUNK_SIZE)
    const key = cx + ',' + cz
    let col = cache.get(key)
    if (!col) {
      col = generate_column(ctx, cx, cz)
      cache.set(key, col)
    }
    const cy = Math.floor(wy / CHUNK_SIZE)
    return col[cy].ids[local_index(wx - cx * CHUNK_SIZE, wy - cy * CHUNK_SIZE, wz - cz * CHUNK_SIZE)]
  }
  return { read, ctx }
}

/** Top GROUND-solid world-y at a column (skips water/air), scanning down from the ceiling. */
const surf_of = (read) => (wx, wz) => {
  for (let y = WORLD_HEIGHT - 2; y >= 2; y -= 1) {
    const b = read(wx, y, wz)
    if (b !== AIR && b !== WATER) return y
  }
  return 2
}

// ---- 0. CONFIG GATES ---------------------------------------------------------------------------
const val = validate_world_gen_config(PARADISE_WORLD)
const default_hash = config_hash_hex(DEFAULT_WORLD_GEN_CONFIG)
const paradise_hash = config_hash_hex(PARADISE_WORLD)
const log = []
const say = (s) => {
  log.push(s)
  console.log(s)
}
say(`validate_world_gen_config(PARADISE): ok=${val.ok}${val.ok ? '' : ' — ' + val.errors.join('; ')}`)
say(`config_hash  DEFAULT=${default_hash}  PARADISE=${paradise_hash}  differ=${default_hash !== paradise_hash}`)
if (!val.ok) {
  writeFileSync(join(OUT, 'stats.txt'), log.join('\n'))
  throw new Error('PARADISE config invalid: ' + val.errors.join('; '))
}

// Dump the coast profile spline numerically (the shelf, provable without a render).
say('\nCOAST PROFILE (continentalness_to_base, SEA_LEVEL=' + SEA_LEVEL + '):')
say(
  '  ' +
    PARADISE_WORLD.splines.continentalness_to_base
      .map(([c, y]) => `${c}→${y}${y < SEA_LEVEL ? '(water)' : y <= SEA_LEVEL + 3 ? '(beach)' : '(land)'}`)
      .join('  ')
)

// ---- 1. SEED SWEEP: pick the best lagoon+beach+islet framing near the origin -------------------
// Score wants: a healthy SHALLOW-lagoon fraction (the turquoise money zone), a real BEACH band, SOME dry
// land (palms), and LOW peaks (a postcard, not cliffs). Penalize all-ocean and all-land.
const CANDIDATE_SEEDS = ['ares-paradise-atoll', 'maldives', 'seychelles', 'bora-bora', 'lagoon', 'atoll', 'aresrpg']
const SWEEP_LO = -224,
  SWEEP_HI = 224,
  SWEEP_STEP = 12
function seed_stats(seed) {
  const { read } = make_reader({ ...PARADISE_WORLD, seed })
  const surf = surf_of(read)
  let deep = 0,
    shallow = 0,
    beach = 0,
    land = 0,
    n = 0,
    max = 0
  for (let z = SWEEP_LO; z <= SWEEP_HI; z += SWEEP_STEP)
    for (let x = SWEEP_LO; x <= SWEEP_HI; x += SWEEP_STEP) {
      const s = surf(x, z)
      n += 1
      max = Math.max(max, s)
      if (s <= SEA_LEVEL - 8) deep += 1
      else if (s <= SEA_LEVEL) shallow += 1
      else if (s <= SEA_LEVEL + 4) beach += 1
      else land += 1
    }
  const f = (v) => v / n
  // Ideal-ish mix: plenty of water, a strong shallow band, a real beach ring, modest land, LOW peaks.
  const shallow_fit = Math.min(f(shallow) / 0.22, 1) // reward up to ~22% shallow lagoon
  const beach_fit = Math.min(f(beach) / 0.08, 1) // reward up to ~8% beach band
  const land_fit = f(land) < 0.55 ? 1 : Math.max(0, (0.85 - f(land)) / 0.3) // penalize all-land
  const flat_fit = max < SEA_LEVEL + 40 ? 1 : Math.max(0, (SEA_LEVEL + 70 - max) / 30) // penalize peaks
  const score = shallow_fit * 45 + beach_fit * 30 + land_fit * 20 + flat_fit * 15
  return {
    seed,
    deep: +(f(deep) * 100).toFixed(1),
    shallow: +(f(shallow) * 100).toFixed(1),
    beach: +(f(beach) * 100).toFixed(1),
    land: +(f(land) * 100).toFixed(1),
    max,
    score: Math.round(score),
  }
}
say('\nSEED SWEEP (region ±224 around origin — deep/shallow/beach/land %):')
const swept = CANDIDATE_SEEDS.map(seed_stats).sort((a, b) => b.score - a.score)
for (const s of swept)
  say(
    `  ${s.seed.padEnd(20)} deep=${s.deep}%  shallow=${s.shallow}%  beach=${s.beach}%  land=${s.land}%  peak=${s.max}  score=${s.score}`
  )
const BEST = swept[0].seed
say(`→ best framing seed: ${BEST}  (paradise.js currently uses "${PARADISE_WORLD.seed}")`)

// ---- 2. COVERAGE + BIOME HISTOGRAM on the chosen world -----------------------------------------
const WORLD = { ...PARADISE_WORLD, seed: BEST }
const { read, ctx } = make_reader(WORLD)
const surf = surf_of(read)
{
  let deep = 0,
    shallow = 0,
    beach = 0,
    land = 0,
    n = 0,
    max = 0
  /** @type {Map<string, number>} */
  const biomes = new Map()
  let beach_biome = 0
  for (let z = -256; z <= 256; z += 6)
    for (let x = -256; x <= 256; x += 6) {
      const s = surf(x, z)
      n += 1
      max = Math.max(max, s)
      if (s <= SEA_LEVEL - 8) deep += 1
      else if (s <= SEA_LEVEL) shallow += 1
      else if (s <= SEA_LEVEL + 4) beach += 1
      else land += 1
      const a = anchor_surface(ctx, x, z)
      const bname = get_biome_by_id(a.biome_id)?.name ?? '?'
      biomes.set(bname, (biomes.get(bname) ?? 0) + 1)
      if (bname === 'beach') beach_biome += 1
    }
  const pct = (v) => ((v / n) * 100).toFixed(1) + '%'
  say('\nCOAST COVERAGE (region ±256, chosen seed):')
  say(
    `  peak=${max}   deep_ocean=${pct(deep)}  shallow_lagoon=${pct(shallow)}  beach_sand=${pct(beach)}  land=${pct(land)}`
  )
  const top = [...biomes.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([k, v]) => `${k}=${pct(v)}`)
    .join('  ')
  say(`  biome histogram (placed by DEFAULT registry — declared gap): ${top}`)
  say(`  → beach-biome columns=${pct(beach_biome)} (palms anchor here; 0% ⇒ palms have no home in this framing)`)
}

// ---- 3. PALM VOXEL COUNT (proves the base-wired beach palms actually fire) ----------------------
// set_gen_config → generate_world_chunk = the fully-DECORATED path (the five_worlds_stages test pattern).
// Count palm_log/palm_leaves over a bounded chunk region straddling the origin coastline.
{
  set_gen_config(WORLD)
  let palms = 0
  const R = 5 // chunk columns [-R..R] → ±160 blocks
  for (let cz = -R; cz <= R; cz += 1)
    for (let cx = -R; cx <= R; cx += 1)
      for (let cy = Math.floor(SEA_LEVEL / CHUNK_SIZE); cy < CHUNKS_PER_COLUMN; cy += 1) {
        const c = generate_world_chunk(cx, cy, cz)
        for (let i = 0; i < c.ids.length; i += 1) if (c.ids[i] === PALM_LOG || c.ids[i] === PALM_LEAF) palms += 1
      }
  set_gen_config(DEFAULT_WORLD_GEN_CONFIG)
  say(
    `\nPALM VOXELS in ±160-block coastline region: ${palms}  (palm_log/palm_leaves; 0 ⇒ no beach placed / palms not firing)`
  )
}

// ---- 4. RENDERS --------------------------------------------------------------------------------
// 4a. TOP-DOWN map: land = surface block × lambert hillshade; water = the TURQUOISE→BLUE depth ramp
//     (this world's optics) so the island + lagoon gradient reads.
{
  const R = 260,
    STEP = 2
  const N = Math.floor((2 * R) / STEP)
  const H = new Float32Array(N * N)
  const Bk = new Int32Array(N * N)
  for (let j = 0; j < N; j += 1)
    for (let i = 0; i < N; i += 1) {
      const wx = -R + i * STEP,
        wz = -R + j * STEP
      const s = surf(wx, wz)
      H[j * N + i] = s
      Bk[j * N + i] = s <= SEA_LEVEL ? WATER : read(wx, s, wz)
    }
  const light = [-0.5, 0.8, 0.35]
  const file = save_png(
    '10_topdown_lagoon',
    N,
    N,
    (i, j) => {
      const s = H[j * N + i]
      const id = Bk[j * N + i]
      if (id === WATER) return water_rgb(SEA_LEVEL - s) // turquoise (shallow) → rich blue (deep)
      const iL = Math.max(0, i - 1),
        iR = Math.min(N - 1, i + 1),
        jU = Math.max(0, j - 1),
        jD = Math.min(N - 1, j + 1)
      const gx = (H[j * N + iR] - H[j * N + iL]) / (STEP * (iR - iL))
      const gz = (H[jD * N + i] - H[jU * N + i]) / (STEP * (jD - jU))
      let nx = -gx,
        ny = 1,
        nz = -gz
      const inv = 1 / Math.hypot(nx, ny, nz)
      nx *= inv
      ny *= inv
      nz *= inv
      let lam = nx * light[0] + ny * light[1] + nz * light[2]
      lam = Math.max(0.4, Math.min(1.15, 0.6 + lam))
      return color_of(id).map((c) => Math.max(0, Math.min(255, Math.round(c * lam))))
    },
    2
  )
  say(`\nrendered ${file}  (top-down — island + turquoise→blue lagoon gradient, ${2 * R}×${2 * R} blocks)`)
}

// 4b. SIDE-ELEVATION cross-section of the SHELF PROFILE: pick the z-row whose x-scan crosses the most
//     shore transitions (deep→shallow→beach→land) so the shelf reads. Water columns depth-shaded.
function side_view(name, x0, z, y_top, WW, HH) {
  return save_png(
    name,
    WW,
    HH,
    (px, py) => {
      const wx = x0 + px,
        wy = y_top - py
      const id = read(wx, wy, z)
      if (id !== AIR) return color_of(id)
      if (wy < SEA_LEVEL) {
        const s = surf(wx, z)
        return water_rgb(SEA_LEVEL - Math.min(s, wy))
      } // water column
      return SKY
    },
    3
  )
}
// Prefer a FULL TRANSECT: all four shore classes present, weighted toward showing deep + shallow water
// (the underwater shelf is the story). Score = min-presence of all 4 classes + a bonus for water span.
let best_z = 0,
  best_score = -1
for (let z = -256; z <= 256; z += 4) {
  let deep = 0,
    shallow = 0,
    beach = 0,
    land = 0
  for (let x = -256; x <= 256; x += 4) {
    const s = surf(x, z)
    if (s <= SEA_LEVEL - 8) deep += 1
    else if (s <= SEA_LEVEL) shallow += 1
    else if (s <= SEA_LEVEL + 4) beach += 1
    else land += 1
  }
  const all4 = Math.min(deep, shallow, beach, land) // reward every class appearing
  const score = all4 * 4 + (deep + shallow) // + water span so the shelf/lagoon shows
  if (score > best_score) {
    best_score = score
    best_z = z
  }
}
say(`shelf strip: z=${best_z} (full deep/lagoon/beach/dune transect)`)
say(
  `rendered ${side_view('11_shelf_profile', -256, best_z, SEA_LEVEL + 40, 512, 110)}  (side elevation — deep→lagoon→sand→dune shelf)`
)

writeFileSync(join(OUT, 'stats.txt'), log.join('\n'))
say(`\nsaved to ${OUT}`)
