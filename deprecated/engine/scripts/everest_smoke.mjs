// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// EVEREST / ICE-AGE lane VISUAL + DATA smoke (FIVE-WORLDS §P3.3). Proves the everest.js recipe with a
// no-WebGPU data raster (deterministic, shell-portable): validates the config, checks its identity hash
// differs from DEFAULT, sweeps candidate seeds for the best tall-massif-with-coastline framing, measures
// surface + snow/rock/ice coverage stats, and renders a HILLSHADED top-down map + side-elevation
// cross-sections at 3 pose classes (ground vista / slight elevation / ocean waterline). PNGs +
// stats.txt → a local gitignored output dir. This is the stages-wave oracle (five_worlds_smoke.mjs), retargeted.
//
// Run:  bun packages/engine/scripts/everest_smoke.mjs

import { writeFileSync, mkdirSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import {
  create_gen_context,
  generate_column,
  biome_at,
  build_column_profile,
  fill_chunk_from_profile,
} from '../src/gen/column_gen.js'
import { decorate_chunk } from '../src/gen/surface_decorator.js'
import { DEFAULT_WORLD_GEN_CONFIG, validate_world_gen_config, config_hash_hex } from '../src/config/world_gen_config.js'
import { SEA_LEVEL, CHUNK_SIZE, WORLD_HEIGHT } from '../src/config/world_config.js'
import { local_index } from '../src/chunks/format.js'
import { get_block_by_id, get_block_by_name } from '../src/config/block_registry.js'
import { get_biome_by_id } from '../src/config/biome_registry.js'
import { BIOME_SCHEMATICS } from '../src/gen/surface_decorator.js'
import { RECIPES } from '../src/render/texture_recipes.js'
import { apply_texture_config, TEXTURE_FAMILIES } from '../src/render/texture_palette.js'
import { EVEREST_WORLD } from '../src/config/worlds/everest.js'

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'scratchpad', 'biomes', 'everest_v3')
mkdirSync(OUT, { recursive: true })

const AIR = /** @type {number} */ (get_block_by_name('air')?.id)
const WATER = /** @type {number} */ (get_block_by_name('water')?.id)
const SNOW = /** @type {number} */ (get_block_by_name('snow')?.id)
const STONE = /** @type {number} */ (get_block_by_name('stone')?.id)
const ICE = /** @type {number} */ (get_block_by_name('ice')?.id)
const PACKED = /** @type {number} */ (get_block_by_name('packed_ice')?.id)
const SKY = [150, 196, 236]
const hex2rgb = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]
const COLOR = new Map()
for (let id = 0; id < 64; id += 1) {
  const b = get_block_by_id(id)
  if (b) COLOR.set(id, hex2rgb(b.map_color))
}
const color_of = (id) => (id === AIR ? SKY : (COLOR.get(id) ?? [255, 0, 255]))

/** Write an [H][W] rgb grid as PPM then convert to PNG via macOS sips (falls back to .ppm). */
function save_png(name, W, H, get_rgb, scale = 3) {
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

/** A block reader over a config, caching one generated chunk-column per (cx,cz). */
function make_reader(config) {
  const ctx = create_gen_context(config)
  const cache = new Map()
  return (wx, wy, wz) => {
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
const val = validate_world_gen_config(EVEREST_WORLD)
const default_hash = config_hash_hex(DEFAULT_WORLD_GEN_CONFIG)
const everest_hash = config_hash_hex(EVEREST_WORLD)
const log = []
const say = (s) => {
  log.push(s)
  console.log(s)
}
say(`validate_world_gen_config(EVEREST): ok=${val.ok}${val.ok ? '' : ' — ' + val.errors.join('; ')}`)
say(`config_hash  DEFAULT=${default_hash}  EVEREST=${everest_hash}  differ=${default_hash !== everest_hash}`)
if (!val.ok) {
  writeFileSync(join(OUT, 'stats.txt'), log.join('\n'))
  throw new Error('EVEREST config invalid: ' + val.errors.join('; '))
}

// ---- 1. SEED SWEEP: pick the best tall-massif-with-coastline framing near the origin -----------
// Score wants: a HIGH max peak (immensity), REAL relief range, and SOME ocean in view (for coast/icebergs).
const CANDIDATE_SEEDS = ['everest-himalaya', 'everest-iceage', 'khumbu', 'ice-age', 'karakoram', 'aresrpg']
// Macro periods (weirdness 1600 / erosion 2800) ⇒ one massif spans ~800-1200 blocks, wider than the old
// ±192 sweep. Widen to ±448 so the sweep judges a FLANK framing (a giant's shoulder), not a sub-patch.
const SWEEP_LO = -448,
  SWEEP_HI = 448,
  SWEEP_STEP = 32
function seed_stats(seed) {
  const read = make_reader({ ...EVEREST_WORLD, seed })
  const surf = surf_of(read)
  let max = 0,
    min = WORLD_HEIGHT,
    sum = 0,
    n = 0,
    below = 0
  for (let z = SWEEP_LO; z <= SWEEP_HI; z += SWEEP_STEP)
    for (let x = SWEEP_LO; x <= SWEEP_HI; x += SWEEP_STEP) {
      const s = surf(x, z)
      max = Math.max(max, s)
      min = Math.min(min, s)
      sum += s
      n += 1
      if (s < SEA_LEVEL - 2) below += 1
    }
  const mean = sum / n,
    ocean = below / n
  // score: reward height + relief + a modest ocean presence (5-35% ideal), penalize all-ocean/all-flat.
  const ocean_fit = ocean < 0.03 ? ocean * 8 : ocean > 0.5 ? 1 - ocean : 0.3 + (ocean - 0.03) * 0.4
  const score = max * 1.0 + (max - min) * 0.6 + mean * 0.4 + ocean_fit * 120
  return { seed, max, min, mean: Math.round(mean), ocean: +(ocean * 100).toFixed(1), score: Math.round(score) }
}
say('\nSEED SWEEP (region ±192 around origin):')
const swept = CANDIDATE_SEEDS.map(seed_stats).sort((a, b) => b.score - a.score)
for (const s of swept)
  say(`  ${s.seed.padEnd(18)} peak=${s.max} valley=${s.min} mean=${s.mean} ocean=${s.ocean}%  score=${s.score}`)
const BEST = swept[0].seed
say(`→ best framing seed: ${BEST}  (everest.js currently uses "${EVEREST_WORLD.seed}")`)

// ---- 2. COVERAGE STATS on the chosen world -----------------------------------------------------
const WORLD = { ...EVEREST_WORLD, seed: BEST }
const read = make_reader(WORLD)
const surf = surf_of(read)
{
  let snow = 0,
    stone = 0,
    ice = 0,
    water = 0,
    other = 0,
    n = 0,
    max = 0
  for (let z = -256; z <= 256; z += 8)
    for (let x = -256; x <= 256; x += 8) {
      const s = surf(x, z)
      n += 1
      max = Math.max(max, s)
      if (s <= SEA_LEVEL) {
        water += 1
        continue
      }
      const top = read(x, s, z)
      if (top === SNOW) snow += 1
      else if (top === STONE) stone += 1
      else if (top === ICE || top === PACKED) ice += 1
      else other += 1
    }
  const pct = (v) => ((v / n) * 100).toFixed(1) + '%'
  say('\nSURFACE COVERAGE (region ±256, chosen seed):')
  say(
    `  peak=${max}   snow=${pct(snow)}  bare_rock=${pct(stone)}  ice=${pct(ice)}  water/ocean=${pct(water)}  biome(other)=${pct(other)}`
  )
}

// ---- 2b. BIOME HISTOGRAM + WARM-STRUCTURE PROOF (fix 4 — palms/warm biomes gone) ---------------
// Every warm biome that could grow warm schematics (palm/tropical/grassland/desert/swamp/temperate).
const WARM_BIOMES = new Set([
  'beach',
  'grassland',
  'temperate_forest',
  'dense_forest',
  'swamp',
  'tropical',
  'desert',
  'scorched_badlands',
])
const ctx = create_gen_context(WORLD)
{
  /** @type {Map<string, number>} */
  const hist = new Map()
  let n = 0,
    cold = 0,
    warm = 0
  for (let z = -256; z <= 256; z += 4)
    for (let x = -256; x <= 256; x += 4) {
      const b = get_biome_by_id(biome_at(ctx, x, z))
      const name = b?.name ?? 'unknown'
      hist.set(name, (hist.get(name) ?? 0) + 1)
      n += 1
      if (WARM_BIOMES.has(name)) warm += 1
      else cold += 1
    }
  const rows = [...hist.entries()].sort((a, b) => b[1] - a[1])
  say('\nBIOME HISTOGRAM (region ±256, place_biome):')
  for (const [name, c] of rows) say(`  ${name.padEnd(16)} ${((c / n) * 100).toFixed(1)}%`)
  say(
    `  → cold-family=${((cold / n) * 100).toFixed(1)}%  warm-family=${((warm / n) * 100).toFixed(1)}%  (target: cold ≥95%, warm 0%)`
  )
  // WARM-STRUCTURE COUNT: a warm structure can only place if a warm biome is PRESENT and it maps to warm
  // trees in BIOME_SCHEMATICS. Report every present biome → its schematic families so the read is legible.
  let warm_struct = 0
  const fam = []
  for (const [name] of rows) {
    const rule = BIOME_SCHEMATICS[name]
    const trees = rule?.trees ?? []
    if (WARM_BIOMES.has(name) && trees.length > 0) warm_struct += 1
    if (trees.length > 0) fam.push(`${name}→[${trees.join(',')}]`)
  }
  say(`  schematic families present: ${fam.length ? fam.join('  ') : '(none)'}`)
  say(
    `  WARM-STRUCTURE COUNT = ${warm_struct}  (grep: no PALM/TROPICAL/GRASSLAND/DESERT families ⇒ ${warm_struct === 0 ? 'CLEAN' : 'FAIL'})`
  )
}

// ---- 2c. FLATNESS ORACLE (fix 1 — no dead-flat plains) -----------------------------------------
// MACRO slope over a ±8-block baseline (16 blocks — the span a standing player reads as "flat ground").
// A ±1 baseline is meaningless on integer terrain: a gentle snowfield rises 1 block per ~3 blocks so
// adjacent pairs are equal ⇒ false "flat". The ±8 window captures the real tilt of a plain vs a slope.
// tan(2°)=0.035, tan(3°)=0.052. The rejected v2 basin plain (a whole flat white field) fails this.
{
  let n = 0,
    flat2 = 0,
    flat3 = 0
  for (let z = -256; z <= 256; z += 4)
    for (let x = -256; x <= 256; x += 4) {
      if (surf(x, z) <= SEA_LEVEL) continue // water isn't "flat land"
      const gx = Math.abs(surf(x + 8, z) - surf(x - 8, z)) / 16
      const gz = Math.abs(surf(x, z + 8) - surf(x, z - 8)) / 16
      const s = Math.max(gx, gz)
      n += 1
      if (s < 0.035) flat2 += 1
      if (s < 0.052) flat3 += 1
    }
  say('\nFLATNESS ORACLE (region ±256, land columns, ±8-block macro baseline):')
  say(
    `  slope<2°=${((flat2 / Math.max(1, n)) * 100).toFixed(1)}%  slope<3°=${((flat3 / Math.max(1, n)) * 100).toFixed(1)}%  (target: <2° must be <10%)`
  )
}

// ---- 2d. DECOR COUNT (fix "not other trees nor bushes") ----------------------------------------
// Decorate a band of chunk-columns; count schematic voxels the decorator ADDS (air→solid diff). Sprites
// are off, so every added voxel is a conifer/dead-tree/boulder/ice schematic. Proves frozen decor lands.
{
  const solid_of = (id) => get_block_by_id(id)?.class === 'solid'
  let decor = 0,
    chunks_scanned = 0
  const seed_hash = 12345 // decorate_chunk folds this world-seed proxy into placement (any fixed value)
  // A 10×10 chunk area (±160 blocks) — deterministic, region-local; count added schematic voxels.
  for (let cz = -5; cz < 5; cz += 1)
    for (let cx = -5; cx < 5; cx += 1) {
      const profile = build_column_profile(ctx, cx, cz)
      for (let cy = 3; cy <= 9; cy += 1) {
        // y 96..319 — where valley surfaces + trees live
        const chunk = fill_chunk_from_profile(ctx, profile, cx, cy, cz)
        const before = chunk.ids.slice()
        decorate_chunk(chunk, profile, cx, cy, cz, seed_hash, ctx)
        for (let i = 0; i < chunk.ids.length; i += 1)
          if (chunk.ids[i] !== before[i] && solid_of(chunk.ids[i])) decor += 1
        chunks_scanned += 1
      }
    }
  say('\nDECOR ORACLE (10×10 chunk band ±160, sprites off ⇒ added solids = schematics):')
  say(
    `  frozen-decor voxels added=${decor} across ${chunks_scanned} chunks  → ${decor > 0 ? 'PRESENT' : 'NONE (check pools/treeline)'}`
  )
}

// ---- 2e. PALETTE PROOF (the glacial ICE-BLUE textures) -----------------------------------------
// The block-map rasters can't show config.textures (they use fixed map_colors; the palette transforms
// the ATLAS recipe colours). So prove it on the REAL recipes with the REAL transform: for each
// transformed family, print the representative base colour before→after (HSV) and render a swatch. Target
// Target: dark blue-grey rock, near-white snow, frost grass, cold coast — NONE going purple.
{
  const to_hsv = ([r, g, b]) => {
    r /= 255
    g /= 255
    b /= 255
    const mx = Math.max(r, g, b),
      mn = Math.min(r, g, b),
      d = mx - mn
    let h = 0
    if (d) {
      if (mx === r) h = ((g - b) / d) % 6
      else if (mx === g) h = (b - r) / d + 2
      else h = (r - g) / d + 4
      h *= 60
      if (h < 0) h += 360
    }
    return `h=${Math.round(h)} s=${(mx ? d / mx : 0).toFixed(2)} v=${mx.toFixed(2)}`
  }
  const base_rgb = (r) => {
    for (const op of r.ops) {
      if (Array.isArray(op.stops)) return op.stops[0].rgb
      if (Array.isArray(op.rgb)) return op.rgb
    }
    return [0, 0, 0]
  }
  const after = apply_texture_config(RECIPES, WORLD.textures)
  const pick = (set, n) => set.find((r) => r.name === n)
  say('\nPALETTE PROOF (config.textures on the real atlas recipes — before → after):')
  const swatch = []
  for (const fam of Object.keys(WORLD.textures?.families ?? {})) {
    const rep = TEXTURE_FAMILIES[fam]?.[0] // representative recipe of the family
    const b = base_rgb(pick(RECIPES, rep)),
      a = base_rgb(pick(after, rep))
    say(`  ${fam.padEnd(9)} (${rep}) ${JSON.stringify(b)} ${to_hsv(b)}  →  ${JSON.stringify(a)} ${to_hsv(a)}`)
    swatch.push({ b, a })
  }
  // Swatch PNG: one row per family, left half = BEFORE colour, right half = AFTER colour.
  const RW = 240,
    RH = 40,
    W = RW * 2,
    H = RH * swatch.length
  const file = save_png(
    '19_palette_swatch',
    W,
    H,
    (x, y) => {
      const row = Math.min(swatch.length - 1, Math.floor(y / RH))
      return x < RW ? swatch[row].b : swatch[row].a
    },
    1
  )
  say(`rendered ${file}  (palette swatch — LEFT half = original recipe colour, RIGHT half = Everest ice-blue)`)
}

// ---- 3. RENDERS --------------------------------------------------------------------------------
// 3a. HILLSHADED top-down map (surface block colour × lambert hillshade) — reads the massif bodies.
{
  const R = 260,
    STEP = 2 // world region [-R, R], sampled every STEP blocks
  const N = Math.floor((2 * R) / STEP)
  const H = new Float32Array(N * N)
  const B = new Int32Array(N * N)
  for (let j = 0; j < N; j += 1)
    for (let i = 0; i < N; i += 1) {
      const wx = -R + i * STEP,
        wz = -R + j * STEP
      const s = surf(wx, wz)
      H[j * N + i] = s
      B[j * N + i] = s <= SEA_LEVEL ? WATER : read(wx, s, wz)
    }
  const light = [-0.5, 0.8, 0.35] // NW-ish, from above
  const file = save_png(
    '10_topdown_hillshade',
    N,
    N,
    (i, j) => {
      const s = H[j * N + i]
      const id = B[j * N + i]
      // central-difference normal (world units); flat backdrop for ocean.
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
      lam = Math.max(0.25, Math.min(1.15, 0.55 + lam)) // ambient + directional, clamped
      const alt = 0.6 + 0.4 * Math.min(1, (s - SEA_LEVEL) / (WORLD_HEIGHT - SEA_LEVEL)) // higher = brighter
      const base = id === WATER ? color_of(WATER) : color_of(id)
      const shade = id === WATER ? 1 : lam * alt
      return base.map((c) => Math.max(0, Math.min(255, Math.round(c * shade))))
    },
    2
  )
  say(`\nrendered ${file}  (hillshaded top-down, ${2 * R}×${2 * R} blocks)`)
}

// 3b. Side-elevation cross-sections at 3 pose classes (a fixed-z slice — shows the stone BODY skinned
// with its surface material; the camera-facing surface can't appear in a single slice, so read these
// for silhouette/scale + the top-down hillshade (10) for the actual snow/rock SURFACE material and the
// FACE-MIX numbers for the exposed-face snow/rock ratio). Feature-seek within a scan band per pose.
function side_view(name, x0, z, y_top, W, H) {
  return save_png(
    name,
    W,
    H,
    (px, py) => {
      const wx = x0 + px,
        wy = y_top - py
      const id = read(wx, wy, z)
      return id === AIR ? (wy < SEA_LEVEL ? color_of(WATER) : SKY) : color_of(id)
    },
    3
  )
}
// vista: the z-row with the tallest peak (summit + snow + rock walls in frame).
let vista_z = 0,
  vista_peak = -1,
  vista_x = -200
for (let z = -256; z <= 256; z += 8) {
  let hi = 0,
    hx = -200
  for (let x = -256; x <= 256; x += 6) {
    const s = surf(x, z)
    if (s > hi) {
      hi = s
      hx = x
    }
  }
  if (hi > vista_peak) {
    vista_peak = hi
    vista_z = z
    vista_x = hx
  }
}
say(`vista strip: z=${vista_z} peak=${vista_peak} @x≈${vista_x}`)
say(
  `rendered ${side_view('11_vista_summit', vista_x - 130, vista_z, Math.min(WORLD_HEIGHT - 1, vista_peak + 16), 260, 200)}  (ground vista — summit + snow caps + rock/ice walls)`
)

// 3b-i. ZEBRA / STRIPE metric on the vista face (v1's failure mode, made NUMERIC). Walk the
// exposed massif face in the vista strip; count SURFACE-EXPOSED packed_ice/ice voxels (v1's zebra was
// periodic packed_ice STRATA bands) and how many distinct world-y bands they form. Target: ~0 exposed
// face-ice ⇒ zebra dead. Also reports the exposed-face material mix so the "snow on gentle / rock on
// steep" read is legible in data, not only pixels.
{
  const z = vista_z
  const x0 = vista_x - 130,
    x1 = vista_x + 130
  const exposed = (x, y) => {
    const b = read(x, y, z)
    if (b === AIR || b === WATER) return -1
    // exposed iff any 4-neighbour in the view plane is air/water (a visible face voxel)
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const n = read(x + dx, y + dy, z)
      if (n === AIR || n === WATER) return b
    }
    return -1
  }
  let face = 0,
    snow = 0,
    stone = 0,
    ice = 0,
    other = 0
  const ice_bands = new Set()
  for (let x = x0; x <= x1; x += 1)
    for (let y = SEA_LEVEL; y <= vista_peak; y += 1) {
      const b = exposed(x, y)
      if (b < 0) continue
      face += 1
      if (b === SNOW) snow += 1
      else if (b === STONE) stone += 1
      else if (b === ICE || b === PACKED) {
        ice += 1
        ice_bands.add(y >> 2)
      } // 4-block y buckets
      else other += 1
    }
  const p = (v) => ((v / Math.max(1, face)) * 100).toFixed(1) + '%'
  say(
    `FACE MATERIAL MIX (vista wall, exposed voxels=${face}): snow=${p(snow)} rock=${p(stone)} ICE=${p(ice)} other=${p(other)}`
  )
  say(
    `ZEBRA CHECK: exposed face-ice voxels=${ice} across ${ice_bands.size} y-bands  → ${ice === 0 ? 'CLEAN (no stripes)' : ice < 40 ? 'sparse ice (ok)' : 'STRIPING RISK — review the face PNG'}`
  )
}

// 3b-ii. FACE WALL — a TALL NARROW vertical slice on the steepest part of the vista face: a
// "standing at the foot looking up" oracle. Checks for periodic stripes, a connected ridge silhouette,
// and visible cave mouths on the wall (the failure v1's top-down/side views masked).
{
  const y_top = Math.min(WORLD_HEIGHT - 1, vista_peak + 12)
  say(
    `rendered ${side_view('14_face_wall', vista_x - 60, vista_z, y_top, 120, Math.min(y_top - SEA_LEVEL + 30, 250))}  (face wall — foot-looking-up: no stripes, connected silhouette, cave mouths)`
  )
}

// slight elevation: a mid-relief strip (mean-ish peak) to read snow/rock/scree banding on shoulders.
let mid_z = 0,
  mid_best = 1e9
for (let z = -256; z <= 256; z += 8) {
  let hi = 0
  for (let x = -256; x <= 256; x += 6) hi = Math.max(hi, surf(x, z))
  const d = Math.abs(hi - (SEA_LEVEL + (vista_peak - SEA_LEVEL) * 0.6))
  if (d < mid_best) {
    mid_best = d
    mid_z = z
  }
}
say(
  `rendered ${side_view('12_slope_bands', -130, mid_z, Math.min(WORLD_HEIGHT - 1, 300), 260, 190)}  (slight elevation — altitude banding)`
)

// 3b-iii. SHOULDER FACE-MIX — exposed-face snow/rock on a MID-relief (shoulder) strip, the gentler
// counterpart to the tallest-peak vista. The ref reads ~80% snow with rock streaks on the steeps; this
// broad-shoulder pose is where snow-dominance must clearly show (the vista is the steepest worst case).
{
  const z = mid_z
  let peak = 0
  for (let x = -256; x <= 256; x += 2) peak = Math.max(peak, surf(x, z))
  const exposed = (x, y) => {
    const b = read(x, y, z)
    if (b === AIR || b === WATER) return -1
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const n = read(x + dx, y + dy, z)
      if (n === AIR || n === WATER) return b
    }
    return -1
  }
  let face = 0,
    snow = 0,
    stone = 0,
    other = 0
  for (let x = -256; x <= 256; x += 1)
    for (let y = SEA_LEVEL; y <= peak; y += 1) {
      const b = exposed(x, y)
      if (b < 0) continue
      face += 1
      if (b === SNOW) snow += 1
      else if (b === STONE) stone += 1
      else other += 1
    }
  const p = (v) => ((v / Math.max(1, face)) * 100).toFixed(1) + '%'
  say(
    `SHOULDER FACE-MIX (z=${z}, exposed voxels=${face}): snow=${p(snow)} rock=${p(stone)} other=${p(other)}  (target snow ≥60%)`
  )
}

// 3b-iv. VALLEY POSE — a LOW-relief strip (near a valley floor): a "standing in the valley
// looking down the glacier" framing. No complete summit silhouette should fill the frame; the ground
// reads snow with dark decor patches — the ref's valley floor. Seek the z-row with the LOWEST peak.
{
  let low_z = 0,
    low_peak = 1e9
  for (let z = -256; z <= 256; z += 8) {
    let hi = 0
    for (let x = -256; x <= 256; x += 6) hi = Math.max(hi, surf(x, z))
    if (hi < low_peak && hi > SEA_LEVEL + 20) {
      low_peak = hi
      low_z = z
    }
  }
  say(`valley strip: z=${low_z} peak=${low_peak}`)
  say(
    `rendered ${side_view('16_valley_vista', -130, low_z, Math.min(WORLD_HEIGHT - 1, low_peak + 20), 260, 170)}  (valley pose — snow floor + decor, no full summit in frame)`
  )
}

// 15. ZONE-SCALE SLOPE (testing whether a 300×300 zone could read as a single mountain slope). A ZONE-
// SIZED window (300×300 blocks, 1-block sampled) on a MID-ALTITUDE FLANK — NO summit in frame — hillshaded
// so we can judge: at the scale the player actually stands in, is the ground still craggy/interesting
// (detail at every glance distance), or does it read as a smooth ramp? Seek a flank: a column whose surface
// sits mid-way between coast and peak AND carries a real local gradient (so we're on a slope, not a plateau).
{
  const target = SEA_LEVEL + (vista_peak - SEA_LEVEL) * 0.55
  let fx = 0,
    fz = 0,
    best = 1e9
  for (let z = -384; z <= 384; z += 8)
    for (let x = -384; x <= 384; x += 8) {
      const s = surf(x, z)
      if (s <= SEA_LEVEL + 20) continue
      const g = Math.abs(surf(x + 2, z) - surf(x - 2, z)) + Math.abs(surf(x, z + 2) - surf(x, z - 2))
      const score = Math.abs(s - target) + (g < 4 ? 40 : 0) // want mid-altitude AND a real slope (not flat)
      if (score < best) {
        best = score
        fx = x
        fz = z
      }
    }
  const R = 150,
    N = 2 * R // 300×300 zone, 1-block sampling
  const H = new Float32Array(N * N),
    B = new Int32Array(N * N)
  for (let j = 0; j < N; j += 1)
    for (let i = 0; i < N; i += 1) {
      const wx = fx - R + i,
        wz = fz - R + j
      const s = surf(wx, wz)
      H[j * N + i] = s
      B[j * N + i] = s <= SEA_LEVEL ? WATER : read(wx, s, wz)
    }
  const light = [-0.5, 0.8, 0.35]
  const file = save_png(
    '15_zone_slope',
    N,
    N,
    (i, j) => {
      const s = H[j * N + i],
        id = B[j * N + i]
      const iL = Math.max(0, i - 1),
        iR = Math.min(N - 1, i + 1),
        jU = Math.max(0, j - 1),
        jD = Math.min(N - 1, j + 1)
      const gx = (H[j * N + iR] - H[j * N + iL]) / (iR - iL),
        gz = (H[jD * N + i] - H[jU * N + i]) / (jD - jU)
      let nx = -gx,
        ny = 1,
        nz = -gz
      const inv = 1 / Math.hypot(nx, ny, nz)
      nx *= inv
      ny *= inv
      nz *= inv
      let lam = nx * light[0] + ny * light[1] + nz * light[2]
      lam = Math.max(0.25, Math.min(1.2, 0.5 + lam))
      const base = id === WATER ? color_of(WATER) : color_of(id)
      return base.map((c) => Math.max(0, Math.min(255, Math.round(c * (id === WATER ? 1 : lam)))))
    },
    2
  )
  say(
    `rendered ${file}  (ZONE-SCALE 300×300 flank @${fx},${fz} — must still read craggy: detail at every glance, NO smooth ramp)`
  )
}

// ocean/waterline: feature-seek a strip with FLOATING icebergs — ice ABOVE an OPEN-WATER column (its
// seabed well below sea level), so we frame buoyant bergs, not packed-ice STRATA on a solid coastal cliff.
// FLOATING ice = an ICE/PACKED voxel at the waterline that has WATER/AIR ~16 blocks below it (a keel over
// open sea), NOT packed-ice STRATA on a solid coastal cliff. (Can't use surf() to gate — it counts the
// berg's own ice as the surface.) Scans the near ocean band (icebergs are sparse: region_rate 0.3).
const floating_here = (x, z) => {
  let n = 0
  for (let y = SEA_LEVEL - 1; y <= SEA_LEVEL + 10; y += 1) {
    const b = read(x, y, z)
    if (b === ICE || b === PACKED) {
      const under = read(x, SEA_LEVEL - 18, z)
      if (under === WATER || under === AIR) n += 1
    }
  }
  return n
}
let ice_z = null,
  ice_hits = -1,
  ice_x0 = -200
for (let z = -448; z <= 448; z += 16) {
  for (let x0 = -448; x0 <= 188; x0 += 64) {
    let hits = 0
    for (let x = x0; x < x0 + 260; x += 3) hits += floating_here(x, z)
    if (hits > ice_hits) {
      ice_hits = hits
      ice_z = z
      ice_x0 = x0
    }
  }
}
if (ice_z !== null && ice_hits >= 6) {
  say(`ocean strip: z=${ice_z} x0=${ice_x0} floating-ice voxels≈${ice_hits}`)
  say(
    `rendered ${side_view('13_ocean_icebergs', ice_x0, ice_z, SEA_LEVEL + 34, 260, 70)}  (ocean band — buoyant icebergs at the waterline)`
  )
} else
  say(
    `ocean strip: no floating icebergs in ±448 near origin (best hits=${ice_hits}); placer proven by five_worlds_stages.test.js — bergs populate the wider ocean band`
  )

writeFileSync(join(OUT, 'stats.txt'), log.join('\n'))
say(`\nsaved to ${OUT}`)
