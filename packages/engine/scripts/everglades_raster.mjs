// EVERGLADES lane VISUAL PROOF — data raster (no WebGPU) of the DECORATED gen pipeline under the
// EVERGLADES_WORLD recipe. Proves the flat waterland + channel/pool mosaic + water levels + sawgrass +
// water-anchored mangroves fall out of the real gen. PNGs → a local gitignored output dir.
//   Run:  bun packages/engine/scripts/everglades_raster.mjs

import { writeFileSync, mkdirSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { generate_world_chunk, set_gen_config } from '../src/gen/world_gen.js'
import { DEFAULT_WORLD_GEN_CONFIG } from '../src/config/world_gen_config.js'
import { EVERGLADES_WORLD } from '../src/config/worlds/everglades.js'
import { SEA_LEVEL, CHUNK_SIZE, WORLD_HEIGHT, CHUNKS_PER_COLUMN } from '../src/config/world_config.js'
import { local_index } from '../src/chunks/format.js'
import { get_block_by_id, get_block_by_name } from '../src/config/block_registry.js'

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'scratchpad', 'biomes', 'everglades')
mkdirSync(OUT, { recursive: true })

const AIR = get_block_by_name('air').id
const WATER = get_block_by_name('water').id
const LOG = get_block_by_name('log').id // mangrove/swamp-tree trunk
const SKY = [150, 196, 236]
const hex2rgb = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]
const COLOR = new Map()
for (let id = 0; id < 64; id += 1) {
  const b = get_block_by_id(id)
  if (b) COLOR.set(id, hex2rgb(b.map_color))
}
const color_of = (id) => (id === AIR ? SKY : (COLOR.get(id) ?? [255, 0, 255]))

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

/** Decorated block reader over the ACTIVE recipe (set via set_gen_config). Caches full 12-chunk columns. */
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

/** Topmost non-air block (id + y). Water counts as a surface (a pool top). */
function top_at(read, wx, wz, y_hi = 160) {
  for (let y = y_hi; y >= 2; y -= 1) {
    const id = read(wx, y, wz)
    if (id !== AIR) return { id, y }
  }
  return { id: AIR, y: 1 }
}

const results = []

// ── 1. TOP-DOWN MOSAIC (everglades) ───────────────────────────────────────────────────────────
// Colour each column by its top block. Water is shaded by depth (deeper = darker) so the pool/channel
// network reads against the grass islands. Region: 384×384 blocks at the origin band.
set_gen_config(EVERGLADES_WORLD)
const eg = make_reader()
const RX = -192,
  RZ = -192,
  RW = 384,
  RH = 384
{
  let water_cols = 0,
    land_cols = 0
  const surf = []
  const file = save_png(
    '01_everglades_topdown',
    RW,
    RH,
    (px, pz) => {
      const wx = RX + px,
        wz = RZ + pz
      const t = top_at(eg, wx, wz)
      if (t.id === WATER) {
        water_cols += 1
        // find bed depth for shading
        let bed = t.y
        for (let { y } = t; y >= 2; y -= 1) {
          if (eg(wx, y, wz) !== WATER && eg(wx, y, wz) !== AIR) {
            bed = y
            break
          }
        }
        const depth = Math.max(0, t.y - bed)
        const k = Math.max(0.35, 1 - depth * 0.09) // deeper → darker olive-murk tint (render optics preview)
        return [Math.round(52 * k), Math.round(74 * k), Math.round(46 * k)]
      }
      land_cols += 1
      surf.push(t.y)
      return color_of(t.id)
    },
    2
  )
  surf.sort((a, b) => a - b)
  const mean = surf.reduce((a, b) => a + b, 0) / surf.length
  results.push(['01 everglades top-down mosaic', file])
  console.log(
    '[everglades] land surface-y: min',
    surf[0],
    'p50',
    surf[surf.length >> 1],
    'max',
    surf[surf.length - 1],
    'mean',
    mean.toFixed(1)
  )
  console.log(
    '[everglades] water coverage:',
    ((100 * water_cols) / (water_cols + land_cols)).toFixed(1) + '% of',
    RW * RH,
    'columns'
  )
}

// ── 2. TOP-DOWN (default) — same region, for the flat-vs-hilly / dry-vs-watery contrast ─────────
set_gen_config(DEFAULT_WORLD_GEN_CONFIG)
const df = make_reader()
{
  let water_cols = 0
  const surf = []
  const file = save_png(
    '02_default_topdown',
    RW,
    RH,
    (px, pz) => {
      const wx = RX + px,
        wz = RZ + pz
      const t = top_at(df, wx, wz, 300)
      if (t.id === WATER) {
        water_cols += 1
        return [46, 96, 158]
      }
      surf.push(t.y)
      return color_of(t.id)
    },
    2
  )
  surf.sort((a, b) => a - b)
  results.push(['02 default top-down (contrast)', file])
  console.log('[default]    land surface-y: min', surf[0], 'p50', surf[surf.length >> 1], 'max', surf[surf.length - 1])
  console.log('[default]    water coverage:', ((100 * water_cols) / (RW * RH)).toFixed(1) + '%')
}

// ── 3. SIDE ELEVATION (everglades) — proves flatness + water fill in the dips ───────────────────
set_gen_config(EVERGLADES_WORLD)
const eg2 = make_reader()
{
  const z = 0,
    x0 = -128,
    W = 256,
    y_top = 145,
    H = 42
  const file = save_png(
    '03_everglades_side',
    W,
    H,
    (px, py) => {
      const wx = x0 + px,
        wy = y_top - py
      const id = eg2(wx, wy, z)
      if (id === AIR) return wy < SEA_LEVEL ? color_of(WATER) : SKY
      return color_of(id)
    },
    4
  )
  results.push(['03 everglades side elevation (z=0, y 145→103)', file])
  // sea-level reference line stats
  let below = 0,
    at = 0,
    above = 0
  for (let x = x0; x < x0 + W; x += 1) {
    const t = top_at(eg2, x, z)
    if (t.y < SEA_LEVEL) below += 1
    else if (t.y <= SEA_LEVEL + 3) at += 1
    else above += 1
  }
  console.log('[everglades] side z=0 columns — sub-sea(pool):', below, ' waterline±3:', at, ' higher:', above, ' of', W)
}

// ── 4. FEATURE-SEEK a MANGROVE-IN-WATER strip (underwater log voxels = mangrove roots) ──────────
// The mangroves are swamp-biome-gated (DECLARED GAP), so seek the region where they actually place.
set_gen_config(EVERGLADES_WORLD)
const seek = make_reader()
let best = null,
  best_hits = -1
for (let z = -512; z <= 512 && best_hits < 8; z += 32) {
  for (let x = -512; x <= 512; x += 32) {
    let hits = 0
    for (let ix = x; ix < x + 32; ix += 2)
      for (let iz = z; iz < z + 32; iz += 2) {
        // an underwater LOG (root below the waterline) = a water-anchored mangrove
        for (let y = SEA_LEVEL; y >= SEA_LEVEL - 8; y -= 1)
          if (seek(ix, y, iz) === LOG) {
            hits += 1
            break
          }
      }
    if (hits > best_hits) {
      best_hits = hits
      best = { x, z }
    }
  }
}
console.log('[everglades] mangrove feature-seek: best_hits', best_hits, 'at', JSON.stringify(best))
if (best && best_hits > 0) {
  // side view centred on the densest mangrove column in that cell
  let mx = best.x,
    mz = best.z,
    found = false
  for (let iz = best.z; iz < best.z + 32 && !found; iz += 1)
    for (let ix = best.x; ix < best.x + 32 && !found; ix += 1) {
      for (let y = SEA_LEVEL; y >= SEA_LEVEL - 8; y -= 1)
        if (seek(ix, y, iz) === LOG) {
          mx = ix
          mz = iz
          found = true
          break
        }
    }
  const x0 = mx - 32,
    W = 64,
    y_top = SEA_LEVEL + 16,
    H = 30
  const file = save_png(
    '04_everglades_mangrove_side',
    W,
    H,
    (px, py) => {
      const wx = x0 + px,
        wy = y_top - py
      const id = seek(wx, wy, mz)
      if (id === AIR) return wy < SEA_LEVEL ? color_of(WATER) : SKY
      return color_of(id)
    },
    8
  )
  results.push([`04 mangrove rooted in water (x≈${mx} z≈${mz})`, file])
} else {
  results.push(['04 mangrove strip', 'NONE FOUND near origin (swamp biome not placed here — DECLARED GAP)'])
}

// ── 5. WATER-OPTICS swatches (render-only; proves the murk config values) ───────────────────────
const swatch = (name, rgb01) => save_png(name, 48, 28, () => rgb01.map((c) => Math.round(Math.min(1, c) * 255)), 5)
swatch('05a_water_default_body', DEFAULT_WORLD_GEN_CONFIG.water.body_color)
swatch('05b_water_everglades_body', EVERGLADES_WORLD.water.body_color)
swatch('05c_water_everglades_shallow', EVERGLADES_WORLD.water.shallow_color)
results.push(['05 water optics swatches (default body | everglades body | everglades shallow)', '05a/05b/05c'])

set_gen_config(DEFAULT_WORLD_GEN_CONFIG) // leave the module recipe clean
console.log('\nRESULTS:')
for (const [label, file] of results) console.log(' •', file, '—', label)
console.log('\nsaved to', OUT)
