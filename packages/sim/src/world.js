// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Infinite, deterministic overworld terrain — the random-access counterpart to the finite fight
// carve (arena.js). `world_cell(seed, x, y)` returns a cell type for ANY integer coordinate, a pure
// function of (seed, x, y): the same world on every machine, every reload, no generation order.
// Shared by the server (movement validation) and the client (render + prediction).
//
// The world is built from LAYERED COHERENT NOISE (a Whittaker-style climate model), all in INTEGER
// fixed-point — determinism is law in @aresrpg/sim: no floats, no Math.random, no Math.sin, no Date.now.
// squirrel_noise_2d is the ONLY randomness source (a pure hash → white noise); spatial coherence is
// built on top of it via value noise → fBm → ridged/domain-warped fields.
//
//   continent  (very-low-freq) — big coherent macro regions: forest BELTS vs open PRAIRIE (the
//                                "alive, not flat" lever — clusters forest into regions instead of
//                                uniform salt-and-pepper).
//   elevation  (low-freq)      — high ground → rocky low-cover patches; also caps where lakes flood.
//   humidity   (low-freq)      — dry → plains/rocky; wet → forests allowed + gates ponds/lakes/meadow.
//   temperature(low-mid-freq)  — warm+humid plains → flower MEADOW (render hint only).
//   basin      (mid-freq)      — local minima + humid → tight compact ponds (WATER).
//   lake       (low-freq)      — a coherent flood basin: below the flood level + humid + low ground →
//                                a BIG contiguous WATER body (a lake), with a sandy BEACH shore ring.
//   forest     (warped ridged) — meandering ridge lines → forest corridors, density ramped by the
//                                continent belt so forests form regions, not uniform noise.
//   roads      (POI lattice)   — deterministic points-of-interest on a coarse super-cell grid, linked
//                                to their neighbours; cells near a link are a forced-FLOOR DIRT ROAD
//                                (the connectivity backbone AND a render hint). Pure integer
//                                point-to-segment distance → infinite-terrain safe, no global state.
//   scatter    (per-cell hash) — sub-selects prop/tier within a biome; breaks hard edges.
//
// GAMEPLAY CELL vs RENDER BIOME. The gameplay cell stays the 4-kind enum {FLOOR, OBSTACLE, HOLE,
// WATER} — FLOOR is the SOLE walkable type, which is the load-bearing contract the fight-board carve
// (arena.js carve_world_arena) keys on (`=== CELL.FLOOR`). All the new VARIETY (roads, beaches,
// meadows) rides on `world_biome`, a separate RENDER hint the client uses to pick art/ground tiles —
// roads/beaches/meadows are gameplay-FLOOR, water is the gameplay obstacle. A single internal
// `classify()` returns BOTH so the cell and the biome can NEVER drift out of precedence (the old
// duplicated-precedence drift hazard is gone by construction).
//
// FIXED-POINT DISCIPLINE (Q16, ONE = 1<<16). The load-bearing rule: every "multiply two Q16 values
// then rescale" uses Math.floor(product / ONE) (or `| 0` ONLY when the product is provably >= 0).
// NEVER `>> 16` to rescale a VALUE — at ONE=65536, t*t = 2^32 which JS `>>` coerces to a SIGNED
// int32 and wraps negative. `>>`/`<<` are used ONLY for power-of-two COORDINATE splits (x>>SHIFT)
// where the value fits int32. `| 0` truncates toward zero, Math.floor toward -inf — they DIFFER for
// negatives, so use Math.floor on any rescale that can go negative (lerp, warp, stretch).

import { squirrel_noise_2d } from './noise.js'

/**
 * Overworld cell type.
 * @typedef {0 | 1 | 2 | 3} WorldCell
 */

/**
 * Render-hint biome label — which art a cell should draw, SEPARATE from the gameplay cell type.
 * @typedef {'plains' | 'meadow' | 'water' | 'beach' | 'rocky' | 'forest' | 'road'} WorldBiome
 */

/**
 * Cell-type constants. FLOOR is the only walkable type; OBSTACLE is the only sight-blocker.
 * HOLE (pits/low cover) and WATER (ponds/lakes) both block movement but pass line of sight — they
 * only differ in how the client renders them (low props vs animated water).
 */
export const CELL = /** @type {const} */ ({
  FLOOR: 0,
  OBSTACLE: 1,
  HOLE: 2,
  WATER: 3,
})

/**
 * The campaign world seed (MVP: one realm, `overworld`). The SINGLE SOURCE OF TRUTH for the terrain the
 * roam scene streams AND the terrain a fight board is carved from — both must sample `world_cell` with
 * THIS seed or the board would not match the spot the encounter happened on. Imported by the client roam
 * scene + minimap and by the server fight constructor (and the deterministic mob spawner), so every
 * machine/instance agrees on the same world. Per-realm seeding is a later concern (network-keyed config).
 */
export const WORLD_SEED = 1337

const ONE = 65536 // Q16 fixed-point unit; all field values are unsigned Q16 in [0, ONE)
const HALF = ONE >> 1
const SEED_STEP = 0x9e3779b9 | 0 // golden-ratio odd constant — per-octave seed decorrelation

// --- integer coherent-noise toolbox (all Q16) -----------------------------------------------

/** uint32 hash → Q16 lattice value [0, ONE). `>>>` is safe: the operand is a genuine uint32. */
const lat = (gx, gy, s) => squirrel_noise_2d(gx, gy, s) >>> 16

/**
 * Integer quintic smootherstep 6t⁵−15t⁴+10t³ on t∈[0,ONE] → [0,ONE]. Quintic (not the cheaper cubic
 * 3t²−2t³) because its 2nd derivative is also zero at the lattice lines — that removes the Mach-band
 * creasing value noise otherwise shows on the 2^SHIFT grid. All factors ≥ 0 in [0,ONE] so `| 0` is
 * fine and every product peaks at 2^32 < 2^53 (exact in the JS double model).
 */
const smooth = t => {
  const t2 = ((t * t) / ONE) | 0
  const t3 = ((t2 * t) / ONE) | 0
  const t4 = ((t3 * t) / ONE) | 0
  const t5 = ((t4 * t) / ONE) | 0
  return 6 * t5 - 15 * t4 + 10 * t3
}

/** Integer lerp. (b−a) can be negative → Math.floor (NOT `| 0`). */
const lerp = (a, b, t) => a + Math.floor(((b - a) * t) / ONE)

/**
 * Coherent value noise: 4 hashed lattice corners + bilinear smoothstep. SHIFT∈[1,15] = log2(cell size).
 * Arithmetic `>>` floors toward −inf so the lattice is continuous across the origin.
 */
const value_noise = (x, y, s, SHIFT) => {
  const gx = x >> SHIFT
  const gy = y >> SHIFT
  const fx = smooth((x - (gx << SHIFT)) << (16 - SHIFT)) // in-cell fraction → Q16
  const fy = smooth((y - (gy << SHIFT)) << (16 - SHIFT))
  const v00 = lat(gx, gy, s)
  const v10 = lat(gx + 1, gy, s)
  const v01 = lat(gx, gy + 1, s)
  const v11 = lat(gx + 1, gy + 1, s)
  return lerp(lerp(v00, v10, fx), lerp(v01, v11, fx), fy)
}

/** Fractal Brownian motion: octaves at doubling frequency (SHIFT−o), halving amplitude, per-octave salt. */
const fbm = (x, y, s, octaves, base_shift) => {
  let sum = 0
  let amp = ONE
  let norm = 0
  for (let o = 0; o < octaves; o++) {
    const sh = base_shift - o
    if (sh < 1) break // out of fractional bits
    const n = value_noise(x, y, (s ^ Math.imul(o + 1, SEED_STEP)) | 0, sh)
    sum += ((n * amp) / ONE) | 0 // n,amp ≥ 0
    norm += amp
    amp >>= 1 // power-of-two amplitude — safe coordinate-style shift
  }
  return ((sum * ONE) / norm) | 0 // sum*ONE ~2^33 < 2^53; sum,norm ≥ 0 → `| 0` ok
}

/** Contrast stretch — the float-free redistribution that makes thresholds actually bite. */
const stretch = (v, lo, hi) => {
  const c = v < lo ? lo : v > hi ? hi : v
  return Math.floor(((c - lo) * ONE) / (hi - lo))
}

/** Ridged fold: thin high-value ridge LINES (narrow corridors, not round blobs). */
const ridged = (x, y, s, oct, sh) => {
  const f = stretch(fbm(x, y, s, oct, sh), 22000, 44000)
  return ONE - Math.abs(2 * f - ONE)
}

/** Domain warp (Quílez): displace sample coords by a signed low-freq field. `amt` = max cells. */
const warp = (x, y, s, amt, sh) => {
  const wx = value_noise(x, y, (s ^ 0x1111) | 0, sh) - HALF // signed [-ONE/2, ONE/2)
  const wy = value_noise(x, y, (s ^ 0x2222) | 0, sh) - HALF
  return [x + Math.floor((wx * amt) / ONE), y + Math.floor((wy * amt) / ONE)]
}

// --- climate layers (each a distinct seed salt so they don't visually rhyme) ----------------

// Stretch bounds ≈ the measured p2/p98 of each field's real fbm output (calibrated against
// squirrel_noise_2d), so each field spreads BROADLY across [0,ONE) — only a light tail clamps to
// 0/ONE — and the integer thresholds below bite as intended. The world-spread regression test guards
// against a future tuning change silently degenerating a field.
// NOTE: these bounds are co-dependent with the octave/shift config above and the thresholds below;
// re-measure + retune together if you change them. Exported for tests/tuning.

// CONTINENT — the macro region field. SHIFT=9 (512-cell cells) → big coherent belts that bias forest
// density so the world has a FOREST BELT and an OPEN PRAIRIE instead of uniform forest noise.
export const continent = (x, y, s) =>
  stretch(fbm(x, y, (s ^ 0xc04) | 0, 3, 9), 19000, 47000)
export const elevation = (x, y, s) =>
  stretch(fbm(x, y, (s ^ 0xe1e) | 0, 4, 7), 19000, 47000)
// SHIFT=6 (not 8): a 256-cell humidity field is ~constant across a roam window → ponds become
// all-or-nothing per region; 64-cell cells make wet/dry alternate locally → "occasional" ponds.
export const humidity = (x, y, s) =>
  stretch(fbm(x, y, (s ^ 0x4d0) | 0, 3, 6), 19000, 47000)
// TEMPERATURE — low-mid freq, only a RENDER hint (warm+humid plains → flower meadow).
export const temperature = (x, y, s) =>
  stretch(fbm(x, y, (s ^ 0x7e3) | 0, 3, 7), 19000, 47000)
export const basin = (x, y, s) =>
  stretch(fbm(x, y, (s ^ 0xba5) | 0, 3, 6), 19000, 47000)
// LAKE — a coherent low-freq flood basin (SHIFT=8, 256-cell cells) → big lakes, not speckle. Warped so
// the shoreline is organic, not a smooth blob.
export const lake = (x, y, s) => {
  const [wx, wy] = warp(x, y, (s ^ 0x1a6e) | 0, 40, 8)
  return stretch(fbm(wx, wy, (s ^ 0x1a6f) | 0, 3, 8), 19000, 47000)
}
export const forest = (x, y, s) => {
  const [wx, wy] = warp(x, y, (s ^ 0xf00) | 0, 48, 8)
  return ridged(wx, wy, (s ^ 0xf15) | 0, 3, 6)
}

// MOISTURE — a derived wetness field in [0, ONE]: a cell reads WET when it is HUMID and LOW (basins hold
// water). The integer Q16 port of the client renderer's float helper (forest.js) lifted into the sim so
// the SERVER node spawner can place herbs in wet zones deterministically (the float version is banned in
// @aresrpg/sim). The two weights are the float originals in Q16: 0.9 ≈ 58982/ONE, 0.28 ≈ 18350/ONE.
// `wet` = m > HALF (the float `> 0.5`). NOTE the (seed, x, y) arg order matches world_cell / world_biome
// (the raw climate fields above are (x, y, seed)) — mixing the two silently breaks determinism.
const MOISTURE_HUMID_K = 58982 // 0.9 in Q16
const MOISTURE_DRY_K = 18350 // 0.28 in Q16
export const moisture = (seed, x, y) => {
  const h = humidity(x, y, seed)
  const b = basin(x, y, seed)
  const m =
    Math.floor((h * MOISTURE_HUMID_K) / ONE) +
    Math.floor(((ONE - b) * MOISTURE_DRY_K) / ONE)
  return m > ONE ? ONE : m
}

// --- DIRT ROADS: deterministic point-of-interest lattice ------------------------------------
// One hash-jittered POI per coarse super-cell; POIs link to their east/south neighbours (a sparse,
// organic subset of links). A cell is a ROAD when its integer point-to-segment distance to any nearby
// link is within the road half-width. Pure integer, random-access, infinite-terrain safe (no global
// pathfinding). Roads are forced FLOOR (override water/rock/forest) — the connectivity BACKBONE that
// replaces the old statistical `pathfield` ridge, and a 'road' render hint (dirt + roadside scatter).

const ROAD_SHIFT = 6 // log2 super-cell size → POIs spaced ~64 cells
const ROAD_SIZE = 1 << ROAD_SHIFT
const ROAD_W2 = 2 // squared half-width (~1.4 cells → a 3-cell-wide dirt road)
const ROAD_LINK_256 = 150 // /256 of lattice links that exist (~59% → a connected, not-grid network)

/** Hash-jittered point-of-interest for a super-cell — anywhere inside its 64×64 block (organic routes). */
const poi = (gx, gy, s) => {
  const ox = squirrel_noise_2d(gx, gy, (s ^ 0x9043) | 0) % ROAD_SIZE
  const oy = squirrel_noise_2d(gx, gy, (s ^ 0x5071) | 0) % ROAD_SIZE
  return [(gx << ROAD_SHIFT) + ox, (gy << ROAD_SHIFT) + oy]
}

/** Does the link from super-cell (gx,gy) in direction `salt` exist? (sparse subset of lattice edges) */
const link = (gx, gy, s, salt) =>
  squirrel_noise_2d(gx, gy, (s ^ salt) | 0) % 256 < ROAD_LINK_256

/** Squared distance from point P to segment AB — all integer (closest-point uses integer division). */
const seg_d2 = (px, py, ax, ay, bx, by) => {
  const abx = bx - ax
  const aby = by - ay
  const apx = px - ax
  const apy = py - ay
  const len2 = abx * abx + aby * aby
  if (len2 === 0) return apx * apx + apy * apy
  const t = apx * abx + apy * aby
  if (t <= 0) return apx * apx + apy * apy
  if (t >= len2) {
    const bpx = px - bx
    const bpy = py - by
    return bpx * bpx + bpy * bpy
  }
  const qx = ax + Math.floor((abx * t) / len2)
  const qy = ay + Math.floor((aby * t) / len2)
  const dx = px - qx
  const dy = py - qy
  return dx * dx + dy * dy
}

/**
 * Is this cell on a dirt road? Scans the 3×3 super-cell neighbourhood and tests each base cell's
 * east + south link (the links that can pass near the cell). `>>` floors toward −inf so the lattice
 * is continuous across the origin.
 */
const on_road = (cx, cy, s) => {
  const gx = cx >> ROAD_SHIFT
  const gy = cy >> ROAD_SHIFT
  for (let bx = gx - 1; bx <= gx + 1; bx++)
    for (let by = gy - 1; by <= gy + 1; by++) {
      const [ax, ay] = poi(bx, by, s)
      if (link(bx, by, s, 0xe45)) {
        const [ex, ey] = poi(bx + 1, by, s)
        if (seg_d2(cx, cy, ax, ay, ex, ey) <= ROAD_W2) return true
      }
      if (link(bx, by, s, 0x507)) {
        const [sx, sy] = poi(bx, by + 1, s)
        if (seg_d2(cx, cy, ax, ay, sx, sy) <= ROAD_W2) return true
      }
    }
  return false
}

// --- classification thresholds (integer fractions of ONE) -----------------------------------

const SPAWN_CLEAR_RADIUS = 6 // Chebyshev FLOOR clearing at the origin
const SPAWN_CORRIDOR_LEN = 30 // FLOOR axis-cross reach — punches through the largest forest mass
const FADE = 6 // taper band beyond the clearing: suppress obstacle/water for a soft edge

const WATER_BASIN_TH = 7000 // basin below this = pond (tight → occasional, compact)
const WATER_HUM_TH = 44000 // AND humidity above this → ponds only in the wet pockets

// LAKES are gated by TWO fields so they stay bounded coherent bodies, never a window-filling ocean:
//   lake  (low-freq, 256-cell)  — the REGIONAL enabler: only "lake country" regions flood at all.
//   basin (mid-freq, 64-cell)   — the LOCAL flood shape: the actual low spots within that region. Its
//                                 64-cell oscillation is what bounds each lake into an organic blob.
const LAKE_TH = 11000 // regional: lake field below this = a lake-prone region
const LAKE_BASIN_TH = 21000 // local: basin below this = a flooded low spot (the lake shape)
const LAKE_HUM_TH = 40000 // lakes only form in distinctly humid regions
const LAKE_ELEV_CAP = 42000 // never floods a highland
const BEACH_BAND = 3200 // basin band just above the flood level → sandy walkable FLOOR ('beach')

const ROCK_ELEV_TH = 53000 // elevation above this (~0.81) = rocky high ground
const ROCK_OBST_256 = 90 // /256 of rocky → big-rock OBSTACLE, rest → small-rock HOLE

const FOREST_TH = 42000 // forest ridge above this = inside a forest mass (base threshold)
const FOREST_BELT_K = 6000 // continent belt shifts the effective threshold ± this (belts vs prairie)
const FOREST_OBST_CAP = 150 // max /256 obstacle prob in the forest core (~59%) → gaps always survive
const FOREST_OBST_BASE = 30 // min /256 at the forest edge (density ramps base..cap toward the core)
const FOREST_HOLE_BAND = 25 // /256 band above the obstacle prob → low-cover HOLE (forest fringe)

const MEADOW_HUM_TH = 38000 // humid + warm plains → flower MEADOW (render hint only)
const MEADOW_TEMP_TH = 33000
const PLAINS_HOLE_256 = 8 // /256 sparse low cover scattered on open plains

/** Is this cell inside "lake country" — a humid, low region the lake field marks as flood-prone? */
const lake_region = (cx, cy, s) =>
  lake(cx, cy, s) < LAKE_TH &&
  humidity(cx, cy, s) > LAKE_HUM_TH &&
  elevation(cx, cy, s) < LAKE_ELEV_CAP

/** Tight compact pond (existing rule) OR a coherent lake-country basin flood. */
const is_water = (cx, cy, s) => {
  if (basin(cx, cy, s) < WATER_BASIN_TH && humidity(cx, cy, s) > WATER_HUM_TH)
    return true
  return lake_region(cx, cy, s) && basin(cx, cy, s) < LAKE_BASIN_TH
}

/** Sandy shore ring just above a lake's flood level (the cell itself is not water). */
const is_beach = (cx, cy, s) => {
  const b = basin(cx, cy, s)
  return (
    lake_region(cx, cy, s) &&
    b >= LAKE_BASIN_TH &&
    b < LAKE_BASIN_TH + BEACH_BAND
  )
}

/**
 * Classify a cell into BOTH its gameplay cell type and its render biome in ONE pass — the single
 * source of truth that pins `world_cell` and `world_biome` together so they can never drift in
 * precedence. Rules are evaluated top-down (first match wins), cheapest-meaningful-first within the
 * override order (roads must override water/rock/forest, so they are tested early).
 * @param {number} seed @param {number} x @param {number} y
 * @returns {{ cell: WorldCell, biome: WorldBiome }}
 */
const classify = (seed, x, y) => {
  const s = seed | 0
  const cx = x | 0
  const cy = y | 0
  const ax = cx < 0 ? -cx : cx
  const ay = cy < 0 ? -cy : cy
  const cheb = ax > ay ? ax : ay

  // (1) Navigability guarantee — spawn clearing + axis-cross corridor (always FLOOR plains).
  if (cheb <= SPAWN_CLEAR_RADIUS) return { cell: CELL.FLOOR, biome: 'plains' }
  const reach = SPAWN_CLEAR_RADIUS + SPAWN_CORRIDOR_LEN
  if ((ax <= 1 && ay <= reach) || (ay <= 1 && ax <= reach))
    return { cell: CELL.FLOOR, biome: 'plains' }

  const near = cheb <= SPAWN_CLEAR_RADIUS + FADE // soft-edge taper band around spawn

  // (2) ROADS — forced-FLOOR dirt path between POIs (overrides water/rock/forest). The connectivity
  // backbone + a 'road' render hint. A road bridges across a pond/lake rather than drowning in it.
  if (on_road(cx, cy, s)) return { cell: CELL.FLOOR, biome: 'road' }

  // (3) WATER — coherent lakes + tight ponds. Suppressed in the taper band so spawn never abuts water.
  if (!near && is_water(cx, cy, s)) return { cell: CELL.WATER, biome: 'water' }

  // (4) BEACH — sandy shore ring around a lake: walkable FLOOR, 'beach' render hint.
  if (!near && is_beach(cx, cy, s)) return { cell: CELL.FLOOR, biome: 'beach' }

  // (5) ROCKY high ground — low-cover patch (big rocks block LoS, small rocks see-over).
  if (!near && elevation(cx, cy, s) > ROCK_ELEV_TH) {
    const r = squirrel_noise_2d(cx, cy, (s ^ 0x7777) | 0) % 256
    return {
      cell: r < ROCK_OBST_256 ? CELL.OBSTACLE : CELL.HOLE,
      biome: 'rocky',
    }
  }

  // (6) FOREST — clustered obstacles; the continent belt shifts the effective threshold so forests
  // form big REGIONS (a belt lowers it → denser/larger forest; prairie raises it → near-treeless).
  const belt = continent(cx, cy, s)
  const forest_th =
    FOREST_TH - Math.floor(((belt - HALF) * FOREST_BELT_K) / ONE)
  const fo = forest(cx, cy, s)
  if (!near && fo > forest_th) {
    const scatter = squirrel_noise_2d(cx, cy, (s ^ 0x5f04e5) | 0) % 256 // distinct salt from rocky's 0x7777
    const strength = Math.floor(((fo - forest_th) * 256) / (ONE - forest_th)) // 0..255
    const p = Math.min(FOREST_OBST_CAP, FOREST_OBST_BASE + strength)
    if (scatter < p) return { cell: CELL.OBSTACLE, biome: 'forest' } // tree (LoS blocker)
    if (scatter < p + FOREST_HOLE_BAND)
      return { cell: CELL.HOLE, biome: 'forest' } // stump/log/fern (see-over)
    return { cell: CELL.FLOOR, biome: 'forest' } // forest floor (walkable gap)
  }

  // (7) PLAINS / MEADOW — open ground. Warm + humid → a flowery MEADOW (render hint); rare low cover
  // keeps it from being sterile.
  const meadow =
    humidity(cx, cy, s) > MEADOW_HUM_TH &&
    temperature(cx, cy, s) > MEADOW_TEMP_TH
  const biome = meadow ? 'meadow' : 'plains'
  if (
    !near &&
    squirrel_noise_2d(cx, cy, (s ^ 0x9999) | 0) % 256 < PLAINS_HOLE_256
  )
    return { cell: CELL.HOLE, biome }
  return { cell: CELL.FLOOR, biome }
}

/**
 * The terrain type at any integer cell. Pure, random-access, order-independent.
 * @param {number} seed  integer world seed
 * @param {number} x     integer cell x
 * @param {number} y     integer cell y
 * @returns {WorldCell}
 */
export const world_cell = (seed, x, y) => classify(seed, x, y).cell

/**
 * Walkability predicate for a world seed (FLOOR only). Occupancy by other actors is handled
 * separately by the reducer — this is terrain only.
 * @param {number} seed
 * @returns {(cell: import('./cell.js').Cell) => boolean}
 */
export const is_walkable_world = seed => cell =>
  world_cell(seed, cell.x, cell.y) === CELL.FLOOR

/**
 * Line-of-sight predicate: only OBSTACLE (trees, boulders) blocks sight. HOLE (pits/low cover) and
 * WATER (ponds/lakes) are non-walkable but you see over/across them.
 * @param {number} seed
 * @returns {(cell: import('./cell.js').Cell) => boolean}
 */
export const blocks_los_world = seed => cell =>
  world_cell(seed, cell.x, cell.y) === CELL.OBSTACLE

/**
 * Biome / region label at a cell — a RENDER hint (which art to draw), separate from the gameplay
 * cell type. The client uses it to pick dirt on a 'road', sand on a 'beach', flowers in a 'meadow',
 * rocks in 'rocky' high ground, trees in 'forest', etc. Pinned to `world_cell` by the shared
 * `classify()` so it can never drift in precedence.
 * @param {number} seed @param {number} x @param {number} y
 * @returns {WorldBiome}
 */
export const world_biome = (seed, x, y) => classify(seed, x, y).biome
