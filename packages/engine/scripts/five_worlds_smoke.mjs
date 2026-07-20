// FIVE-WORLDS shared-stage VISUAL SMOKE — renders side-view cross-sections of stage-CRANKED worlds,
// coloured by the REAL block map_colors, to prove each stage manifests in the generated voxels. Data
// raster (no WebGPU) → reliable + deterministic; the RENDERED-pixel QA at each pose class is the
// biome lanes' job (they judge vs ref images per BIOMES_EXECUTION_PLAN §P3). PNGs → a local gitignored output dir.
//
// Run:  bun packages/engine/scripts/five_worlds_smoke.mjs

import { writeFileSync, mkdirSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { create_gen_context, generate_column } from '../src/gen/column_gen.js'
import { DEFAULT_WORLD_GEN_CONFIG } from '../src/config/world_gen_config.js'
import { SEA_LEVEL, CHUNK_SIZE } from '../src/config/world_config.js'
import { local_index } from '../src/chunks/format.js'
import { get_block_by_id, get_block_by_name } from '../src/config/block_registry.js'
import { load_schematic } from '../src/gen/schematics/loader.js'
import { expand_placement } from '../src/gen/schematics/stamper.js'

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'scratchpad', 'stages')
mkdirSync(OUT, { recursive: true })
const clone = () => structuredClone(DEFAULT_WORLD_GEN_CONFIG)

const AIR = /** @type {number} */ (get_block_by_name('air')?.id)
const WATER = /** @type {number} */ (get_block_by_name('water')?.id)
const SKY = [150, 196, 236]
const hex2rgb = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]
const COLOR = new Map() // block id → rgb (from map_color)
for (let id = 0; id < 64; id += 1) {
  const b = get_block_by_id(id)
  if (b) COLOR.set(id, hex2rgb(b.map_color))
}
const color_of = (id) => (id === AIR ? SKY : (COLOR.get(id) ?? [255, 0, 255]))

/** Write an [h][w][rgb] pixel grid as a PPM then convert to PNG (macOS sips). */
function save_png(name, W, H, get_rgb, scale = 4) {
  const w = W * scale
  const h = H * scale
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

/** A block reader over a config, caching one generated column per (cx,cz). */
function make_reader(config) {
  const ctx = create_gen_context(config)
  const cache = new Map()
  return (wx, wy, wz) => {
    if (wy < 0 || wy >= DEFAULT_WORLD_GEN_CONFIG.geometry.world_height) return AIR
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
}

/** Render a side-view cross-section (fixed z; x0..x0+W; y top→down over y1..y1-H). */
function side_view(name, config, x0, z, y_top, W, H) {
  const read = make_reader(config)
  const file = save_png(name, W, H, (px, py) => {
    const wx = x0 + px
    const wy = y_top - py // row 0 = highest y
    const id = read(wx, wy, z)
    const rgb = id === AIR ? (wy < SEA_LEVEL ? color_of(WATER) : SKY) : color_of(id)
    return rgb
  })
  return file
}

const results = []

// EVEREST-class tall amplitude preset (peaks toward y≈230) so the snow/slope stage has real relief to
// cap — this is exactly what the Everest lane does via the amplitude splines (crank, not new mechanics).
const tall = () => {
  const c = clone()
  c.splines = {
    ...c.splines,
    continentalness_to_base: [
      [0.0, 96],
      [0.34, 138],
      [0.6, 168],
      [1.0, 190],
    ],
    erosion_to_amplitude: [
      [0.0, 240],
      [0.2, 170],
      [0.4, 90],
      [1.0, 10],
    ],
  }
  return c
}

// Find a MOUNTAINOUS strip (max relief), a HIGH strip in the tall world, and a DEEP-OCEAN strip.
const default_read = make_reader(DEFAULT_WORLD_GEN_CONFIG)
const tall_read = make_reader(tall())
const surf_of = (read) => (wx, wz) => {
  for (let y = 300; y >= 2; y -= 1) {
    const b = read(wx, y, wz)
    if (b !== AIR && b !== WATER) return y
  }
  return 2
}
const dsurf = surf_of(default_read)
const tsurf = surf_of(tall_read)

// Mountain strip (default world): the z-row with the biggest surface range.
let mtn_z = -1568,
  mtn_range = -1
for (let z = -1700; z <= -1300; z += 24) {
  let lo = 999,
    hi = -999
  for (let x = -1700; x <= -1400; x += 8) {
    const s = dsurf(x, z)
    if (s < lo) lo = s
    if (s > hi) hi = s
  }
  if (hi - lo > mtn_range) {
    mtn_range = hi - lo
    mtn_z = z
  }
}
const M = { x0: -1700, z: mtn_z, top: 220, W: 200, H: 130 }

// High strip (tall world): the z-row with the highest peak.
let hi_z = mtn_z,
  hi_peak = -1
for (let z = -1700; z <= -1300; z += 24) {
  let hi = -999
  for (let x = -1700; x <= -1400; x += 8) {
    const s = tsurf(x, z)
    if (s > hi) hi = s
  }
  if (hi > hi_peak) {
    hi_peak = hi
    hi_z = z
  }
}
const H = { x0: -1700, z: hi_z, top: hi_peak + 12, W: 200, H: 150 }

// Deep-ocean strip: a z-row with the longest run of columns well below sea level.
let ocean = null,
  ocean_run = 0
for (let z = 0; z <= 6000 && ocean_run < 40; z += 128) {
  let run = 0,
    start = null
  for (let x = -400; x <= 400; x += 8) {
    if (dsurf(x, z) < SEA_LEVEL - 10) {
      if (start === null) start = x
      run += 1
    } else {
      run = 0
      start = null
    }
    if (run > ocean_run) {
      ocean_run = run
      ocean = { x0: /** @type {number} */ (start) - 20, z, top: SEA_LEVEL + 34, W: 200, H: 66 }
    }
  }
}

results.push([
  'DEFAULT (baseline mountain strip)',
  side_view('00_default_mountain', DEFAULT_WORLD_GEN_CONFIG, M.x0, M.z, M.top, M.W, M.H),
])

// 1+2. RIVIERA canyon + strata. Feature-seek the z-strip where the additive canyon carves DEEPEST
// (max Σ(default_surf − canyon_surf) over the window), so a dramatic ravine is guaranteed in frame.
const rc = clone()
rc.carvers = { ...rc.carvers, canyon: { enabled: true, width: 0.32, depth: 95, wall_steepness: 3, warp: true } }
const rc_read = make_reader(rc)
const rcsurf = surf_of(rc_read)
let cyn_z = mtn_z,
  cyn_carve = -1
for (let z = -2600; z <= -600; z += 32) {
  let carve = 0
  for (let x = -1900; x <= -1500; x += 6) {
    const d = dsurf(x, z) - rcsurf(x, z)
    if (d > 0) carve += d
  }
  if (carve > cyn_carve) {
    cyn_carve = carve
    cyn_z = z
  }
}
const R = { x0: -1900, z: cyn_z, top: 200, W: 200, H: 120 }
{
  const c = clone()
  c.carvers = { ...c.carvers, canyon: { enabled: true, width: 0.32, depth: 95, wall_steepness: 3, warp: true } }
  c.strata = {
    ...c.strata,
    enabled: true,
    slope_gate: 0.25,
    band_height: 6,
    band_jitter: 2,
    palette: ['snow', 'stone', 'sand'],
  }
  results.push([
    'STRATA BANDING (Riviera) — canyon walls banded into terraces',
    side_view('01_strata', c, R.x0, R.z, R.top, R.W, R.H),
  ])
  results.push([
    'CANYON STAGE (Riviera) — deep additive ravine',
    side_view('02_canyon', rc, R.x0, R.z, R.top, R.W, R.H),
  ])
}
// 3. SLOPE/SNOW SURFACE — feature-seek the tall-world z-strip with the most snow-eligible (high + flat) ground.
const snow_cfg = tall()
snow_cfg.surface = {
  ...snow_cfg.surface,
  snow_enabled: true,
  slope_enabled: true,
  snow_line: 175,
  grass_slope: 0.45,
  steep_slope: 0.8,
  scree_enabled: true,
}
let snow_z = hi_z,
  snow_hits = -1,
  snow_peak = 175
for (let z = -2600; z <= -600; z += 32) {
  let hits = 0,
    peak = 0
  for (let x = -1900; x <= -1500; x += 6) {
    const s = tsurf(x, z)
    if (s >= 178) hits += 1
    if (s > peak) peak = s
  }
  if (hits > snow_hits) {
    snow_hits = hits
    snow_z = z
    snow_peak = peak
  }
}
const S = { x0: -1900, z: snow_z, top: Math.max(snow_peak, 200) + 12, W: 200, H: 160 }
results.push(['DEFAULT tall peaks (no snow stage)', side_view('03a_tall_default', tall(), S.x0, S.z, S.top, S.W, S.H)])
results.push([
  'SLOPE/SNOW SURFACE (Everest) — snow caps + bare rock on tall peaks',
  side_view('03b_snow_slope', snow_cfg, S.x0, S.z, S.top, S.W, S.H),
])

// 4. ICEBERGS — feature-seek: find the z-strip with the most ICE voxels at the waterline in the iceberg world.
const ice_cfg = clone()
ice_cfg.icebergs = {
  ...ice_cfg.icebergs,
  enabled: true,
  region_size: 256,
  region_rate: 0.85,
  blobs_min: 5,
  blobs_max: 10,
  radius_min: 12,
  radius_max: 24,
  freeboard: 0.5,
  draft: 0.9,
}
const ICEID = /** @type {number} */ (get_block_by_name('ice')?.id)
const PACKID = /** @type {number} */ (get_block_by_name('packed_ice')?.id)
const ice_read = make_reader(ice_cfg)
let ice_strip = null
if (ocean) {
  let best_hits = -1
  for (let z = ocean.z - 256; z <= ocean.z + 256 && best_hits < 30; z += 8) {
    for (let cxw = -400; cxw <= 200; cxw += 32) {
      let hits = 0
      for (let x = cxw; x < cxw + 200; x += 4)
        for (let y = 122; y <= 138; y += 2) {
          const b = ice_read(x, y, z)
          if (b === ICEID || b === PACKID) hits += 1
        }
      if (hits > best_hits) {
        best_hits = hits
        ice_strip = { x0: cxw, z, top: SEA_LEVEL + 34, W: 200, H: 66 }
      }
    }
  }
}
if (ice_strip) {
  results.push([
    'DEFAULT deep-ocean strip',
    side_view(
      '04a_default_ocean',
      DEFAULT_WORLD_GEN_CONFIG,
      ice_strip.x0,
      ice_strip.z,
      ice_strip.top,
      ice_strip.W,
      ice_strip.H
    ),
  ])
  results.push([
    'ICEBERG PLACER (Everest oceans) — buoyant ice at the waterline',
    side_view('04b_icebergs', ice_cfg, ice_strip.x0, ice_strip.z, ice_strip.top, ice_strip.W, ice_strip.H),
  ])
} else results.push(['ICEBERGS', 'SKIPPED (no ocean/iceberg strip found)'])
globalThis.__OCEAN = ocean

// 5. WATER-ANCHOR mangrove + 6-bonus PALM — direct schematic raster over a water/ground backdrop.
function schematic_scene(name, sname, base_y, water_to) {
  const s = load_schematic(sname)
  const vox = expand_placement(0, 0, base_y, s, 0)
  const solid = new Map() // "x,y" → block id
  let minx = 0,
    maxx = 0,
    maxy = base_y
  for (const v of vox) {
    solid.set(v.wx + ',' + v.wy, v.block_id)
    minx = Math.min(minx, v.wx)
    maxx = Math.max(maxx, v.wx)
    maxy = Math.max(maxy, v.wy)
  }
  const W = maxx - minx + 7
  const H = maxy - (base_y - 3) + 4
  const top = maxy + 2
  return save_png(
    name,
    W,
    H,
    (px, py) => {
      const wx = minx - 3 + px
      const wy = top - py
      const id = solid.get(wx + ',' + wy)
      if (id !== undefined) return color_of(id)
      if (wy < base_y) return [90, 66, 40] // seabed/ground
      if (water_to !== null && wy <= water_to) return color_of(WATER)
      return SKY
    },
    8
  )
}
results.push([
  'WATER-ANCHOR (Everglades) — mangrove rooted in water',
  schematic_scene('05_mangrove', 'MANGROVE_G2', SEA_LEVEL - 4, SEA_LEVEL),
])
results.push([
  'PALM (Paradise) — hand-composed from the reference corpus\'s palm materials',
  schematic_scene('06_palm', 'PALM_TREE_G4', SEA_LEVEL + 1, null),
])

// 7. WATER OPTICS — body-colour swatches (render-only; proves the config threads).
{
  const swatch = (name, rgb01) => save_png(name, 40, 24, () => rgb01.map((c) => Math.round(Math.min(1, c) * 255)), 6)
  swatch('07a_water_default', DEFAULT_WORLD_GEN_CONFIG.water.body_color)
  swatch('07b_water_everglades_murky', [0.06, 0.09, 0.05])
  results.push([
    'WATER OPTICS — default vs Everglades body colour swatches',
    '07a_water_default.png / 07b_water_everglades_murky.png',
  ])
}

console.log('mountain strip z =', M.z, '(relief', globalThis.__MTN && '~' + (210 - 120), 'range scan)')
console.log('ocean strip =', JSON.stringify(globalThis.__OCEAN))
for (const [label, file] of results) console.log(' •', file, '—', label)
console.log('\nsaved to', OUT)
