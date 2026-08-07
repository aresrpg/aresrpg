// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// DETERMINISM GATE (§3.7) — the cross-machine world-identity contract for WS2's generation core.
//
//   1. GOLDEN HASH: hash a fixed canonical set of columns for the hardcoded seed and assert the
//      digest is STABLE. If any gen/ change moves this hash it is a WORLD FORK (§4) — bump the
//      golden intentionally, never silently. This is what proves every p2p peer derives the same
//      world from the same seed.
//   2. STABILITY: two independent gen contexts produce byte-identical columns (no hidden global
//      state, no Math.random leakage into the noise chain).
//   3. TRANSCENDENTAL BAN: grep gen/ for Math.sin/cos/tan/pow/exp/log/random — the CI guard that
//      keeps generation portable (transcendentals are implementation-approximated, §3.7).
//   4. SHAPE: the filled ChunkRecord matches the frozen format (12 chunks/column, occupancy for
//      solids only, height floored at sea level, biome meta populated).

import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { test, expect, describe } from 'bun:test'

import { CHUNK_SIZE, CHUNKS_PER_COLUMN, SEA_LEVEL } from '../../src/config/world_config.js'
import {
  VOXELS_PER_CHUNK,
  META_CELLS_PER_CHUNK,
  column_index,
  local_index,
  get_occupancy_bit,
} from '../../src/chunks/format.js'
import { get_block_by_id, get_block_by_name } from '../../src/config/block_registry.js'
import { DEFAULT_WORLD_GEN_CONFIG } from '../../src/config/world_gen_config.js'
import { mesh_chunk } from '../../src/mesh/mesher.js'
import { decode_quad } from '../../src/mesh/quad_buffer.js'
import { create_chunk_store, build_neighbor_halos } from '../../src/chunks/store.js'
import { region_islands, SKY_ISLANDS_CONFIG } from '../../src/gen/sky_islands.js'
import { sample_climate } from '../../src/gen/noise/fields.js'
import { canyon_depth } from '../../src/gen/carvers/canyon.js'
import { create_gen_context, generate_column, build_column_profile } from '../../src/gen/column_gen.js'

/** Canonical column footprints hashed for the world-identity golden (§3.7). Do not reorder. */
const CANONICAL_COORDS = [
  [0, 0],
  [1, 0],
  [0, 1],
  [1, 1],
  [-1, -1],
  [5, 5],
  [-8, 3],
  [12, -7],
  [40, 40],
]

/**
 * Hashes the canonical column set (ids + biome meta of every stacked chunk) for a given context.
 * @param {import('../../src/gen/column_gen.js').GenContext} ctx
 * @returns {string} sha256 hex digest
 */
function hash_canonical_columns(ctx) {
  const hash = createHash('sha256')
  for (const [cx, cz] of CANONICAL_COORDS) {
    for (const chunk of generate_column(ctx, cx, cz)) {
      hash.update(new Uint8Array(chunk.ids.buffer))
      hash.update(chunk.biome)
    }
  }
  return hash.digest('hex')
}

describe('determinism gate: golden hash (§3.7 world-identity contract)', () => {
  // The blessed digest for the hardcoded "aresrpg" seed. A gen/ change that moves this is a world
  // fork (§4) — regenerate deliberately and changelog it, never edit silently to make CI green.
  //
  // ┌─ SANCTIONED WORLD FORK — GEN_VERSION 1 → 2 (2026-07-02, lane NG1-A) ────────────────────────┐
  // │ column_gen now consumes terrain_shaper's ±density band via the unified 3D density field      │
  // │ (gen/density.js): ridged+domain-warped overhang/cliff lips on steep columns, a near-surface  │
  // │ cave-subtract seam, and an inverted sky-island shell — all from ONE field (playbook §2.2).   │
  // │ Terrain moves from a pure heightfield to a 3D isosurface, so the world identity changes:     │
  // │   78925244…b4a1 (v1 heightfield) → 092f0857…e5da (v2 unified density). Deliberate re-bless.   │
  // ├─ SANCTIONED WORLD FORK — GEN_VERSION 2 → 3 (2026-07-03, lane NG1-B) ────────────────────────┤
  // │ Canyons + hydrology + erosion-look + deeper caves. Relief-amplitude retune (mountain belts   │
  // │ ~100-160 blocks, measured region range 153); per-column mountain erosion ridgelines/gullies  │
  // │ and inverted-ridge CANYON carving ride the density effective-surface (world_surface_y stays  │
  // │ a smooth ≤20/col probe); thin ridged-crest RIVERS + LAKES + WATERFALLS place water by a       │
  // │ per-column water level; worley caverns + region-cached worms carve through the cave seam and  │
  // │ flag cavern rooms in meta. Terrain moves world-wide:                                          │
  // │   092f0857…e5da (v2) → 2e54ee1b…8b71 (v3 canyons/hydrology/erosion). Deliberate re-bless.     │
  // ├─ GEN_VERSION 3 → 4 (2026-07-03, lane VEG-B: legacy schematic forests + rocks) — HASH UNMOVED ┤
  // │ The v4 bump replaces the procedural trees with real schematics + adds a cross-chunk canopy    │
  // │ halo, but ALL of that lives in surface_decorator/world_gen (the DECORATED path), OUTSIDE this  │
  // │ golden which hashes generate_column (decoration-free terrain core). So the digest is           │
  // │ DELIBERATELY unchanged at v4 — decoration never enters the world-identity hash by design.      │
  // ├─ SANCTIONED BUGFIX within GEN_VERSION 4 (2026-07-03) — lake pour-point CONTAINMENT fix ──────┤
  // │ Defect: un-contained "glass wedge" water on open slopes. Lakes now fill to the TRUE          │
  // │ pour point of their terrain depression (priority-flood per 256-block lake tile,               │
  // │ hydrology.js compute_lake_tile) instead of the sloped per-column spill base_y−2 with a        │
  // │ [4,8]-depth band — every lake is flat + provably enclosed; steep river steps are flagged as   │
  // │ cascades (flag-only). WATER-ONLY change, empirically proven: a full before/after voxel diff   │
  // │ over the canonical set + the densest false-basin hotspots shows water→air (16 119 cells) and  │
  // │ ZERO solid/terrain block changes (artifacts: hydro_fix_report.json). Vegetation in the        │
  // │ DECORATED path (not hashed here) reflows onto formerly-wet cells (114 cells; decorator input   │
  // │ correction, its logic untouched).                                                              │
  // │   2e54ee1b…8b71 → b22afbb7…dd8c (pour-point lakes). Deliberate re-bless.                       │
  // ├─ GEN_VERSION 4 → 5 (2026-07-03, lane NG1D: Pandora sky islands) — HASH UNMOVED ───────────────┤
  // │ The v4 inverted ridged sky SHELL (fish-bone ribbons across the whole sky) is RETIRED for real  │
  // │ region-gated Hallelujah-Mountain floating islands (gen/sky_islands.js). The world identity     │
  // │ hash is DELIBERATELY UNMOVED because the sky fork is (a) region-gated to ~1/8 region cells and  │
  // │ (b) confined to y≳270 — and NONE of the 9 canonical columns ([0,0]..[40,40], all in the        │
  // │ sky-free region cell 0) sit under an archipelago, so their bytes are bit-identical to v4. The   │
  // │ sky fork IS proven separately below ('sky-island fork'): on a real archipelago column, every    │
  // │ sub-270 block is unchanged vs islands-off (zero GROUND mutations — only island rock added into  │
  // │ former air aloft). Same precedent as the v4 decoration + lake-fix bumps: a scoped fork that      │
  // │ misses the canonical set leaves the terrain-core digest intact by design, not by omission.      │
  // ├─ SANCTIONED WORLD FORK — GEN_VERSION 6 → 7 (2026-07-07, TERRAIN REALISM BASELINE) ──────────┤
  // │ docs/TERRAIN_REALISM_BASELINE.md — "realistic terrain for all biomes" after                    │
  // │ two everest rejects ("giant boulders spawned on a flat terrain"). The crag stage generalizes    │
  // │ into the DEFAULT relief LADDER (crag.enabled true): relief-scaled crag band 14 + UNSCALED       │
  // │ ridge network base 8 (the connected crest/valley network) + drumlin roll 5 + anti-flat micro 2  │
  // │ (relief_floor 0) folded into raw_land for EVERY world. Terrain moves world-wide:                │
  // │   b22afbb7…dd8c (v4-v6 core) → 86bb61fc…e4d4 (v7 relief ladder). Deliberate re-bless.           │
  // ├─ SANCTIONED WORLD FORK — RIVER CONTAINMENT CLAMP (2026-07-11 defect fix) ─────────────────────┤
  // │ Sky-looking blocks appeared below trees and at staircase edges near spawn, with waterfall       │
  // │ effects rendering despite no water present. The river surface (`land - bank` per column) staircased │
  // │ down slopes, standing as exposed multi-block voxel-WATER faces among the forest canopy at spawn │
  // │ (each also tripped the phantom cascade-fall flag). hydrology.js now CLAMPS the raised river      │
  // │ surface to `lowest_neighbour_top + river.max_step` (gentle ≤1-block riffles, no sheer walls).    │
  // │ Water voxels move where rivers cross a grade ⇒ the terrain-core digest shifts:                  │
  // │   86bb61fc…e4d4 (v7) → b0da7c85…9423 (river clamp). Deliberate re-bless (pre-mainnet, no peers). │
  // │ RE-BLESS 2026-07-12 (FLAT-SMOOTH, GEN_VERSION 12 — plains-smoothing pass, DEFAULT freeze        │
  // │ lifted): crag.flat_lo/flat_hi damp the roll+micro jitter on low-relief columns ⇒ the terrain-core │
  // │ digest shifts on the flat columns: b0da7c85…9423 → 2d5bc407…d991.                                 │
  // │ RE-BLESS 2026-07-13 (SPAWN DRY-FLOOR, GEN_VERSION 14 — the water-locked-spawn guarantee): land     │
  // │ within the spawn glade (r≤24, skirt to 48) is lifted to ≥ sea_level+2 on EVERY world; canonical    │
  // │ columns [0,0]/[1,1] sit inside the glade so their wet cells rise: 2d5bc407…d991 → f8dea4b7…7df5.   │
  // │ Deliberate re-bless (testnet, no peers); spawn x/z on chain stay valid (Y surface-sampled).        │
  // └────────────────────────────────────────────────────────────────────────────────────────────┘
  const GOLDEN_HASH = 'f8dea4b70863f5a691a7a8bc9fe545a4dad9f1e5afa2103cb6e901db00667df5'

  // Real generation measured 1.18s (golden), 2.47s (two contexts), and 9.31s (cache eviction) file-solo;
  // every hash stayed stable and both frontend-loaded suite probes completed each case inside 30s.
  test('canonical columns hash to the blessed digest', () => {
    const ctx = create_gen_context()
    expect(hash_canonical_columns(ctx)).toBe(GOLDEN_HASH)
  }, 30000)

  test('two independent contexts produce byte-identical worlds (no hidden state)', () => {
    expect(hash_canonical_columns(create_gen_context())).toBe(hash_canonical_columns(create_gen_context()))
  }, 30000)

  test('worm cave-cache eviction is world-neutral (a far column is identical after heavy streaming)', () => {
    // The region-cached worm carver and the lake-tile memo both bound memory by CLEARING past a cap.
    // That MUST never change output — a far column hashed in a fresh context and after streaming
    // enough columns to evict both caches must be byte-identical. Guards the streaming-history
    // dependence bug the canonical golden can't reach (it stays under the caps).
    // The path is REGION-STRIDED (3 structure-regions/step) and starts beside the far column's own
    // region, so each step primes a fully fresh 3×3 worm neighborhood + a fresh lake tile: both caches
    // overflow in ~33 columns where the old 9-chunk stride needed 160 (5× the work, same proof), and
    // the far column's OWN regions get primed-then-evicted — the sharpest shape of the bug. Evictions
    // are OBSERVED (both caches clear wholesale, so a size drop IS one) and asserted: raising a cap
    // can no longer make this test silently vacuous.
    const REQUIRED_EVICTIONS = 2 // each cache cleared AND repopulated twice
    const STREAM_CAP = 60 // fail loud rather than grind if a cap ever outruns the stride
    const hash_col = (/** @type {import('../../src/gen/column_gen.js').GenContext} */ c) => {
      const h = createHash('sha256')
      for (const chunk of generate_column(c, 200, 200)) h.update(new Uint8Array(chunk.ids.buffer))
      return h.digest('hex')
    }
    const fresh = hash_col(create_gen_context())

    const streamed_ctx = create_gen_context()
    let cave_evictions = 0
    let lake_evictions = 0
    let primed_caves = 0
    let primed_lakes = 0
    let streamed = 0
    while (streamed < STREAM_CAP && !(cave_evictions >= REQUIRED_EVICTIONS && lake_evictions >= REQUIRED_EVICTIONS)) {
      generate_column(streamed_ctx, 192 - 24 * (streamed % 6), 200 - 24 * Math.floor(streamed / 6))
      streamed += 1
      const caves = streamed_ctx.density.caves.primed.size
      const lakes = streamed_ctx.hydro.lake_tiles.size
      if (caves < primed_caves) cave_evictions += 1
      if (lakes < primed_lakes) lake_evictions += 1
      primed_caves = caves
      primed_lakes = lakes
    }
    // the streaming REALLY evicted both caches — otherwise the identity below proves nothing.
    expect(cave_evictions).toBeGreaterThanOrEqual(REQUIRED_EVICTIONS)
    expect(lake_evictions).toBeGreaterThanOrEqual(REQUIRED_EVICTIONS)
    expect(streamed).toBeLessThan(STREAM_CAP)

    expect(hash_col(streamed_ctx)).toBe(fresh)
  }, 30000)
})

// ── PANDORA SKY-ISLAND FORK (GEN_VERSION 5) ──────────────────────────────────────────────────────
// The sky lane replaced the v4 ribbon SHELL with region-gated floating islands. Two contracts:
//   (a) the fork is SKY-ONLY — a real archipelago column's GROUND (sub-270 blocks) is byte-for-byte
//       what it was with islands off (only island rock is ADDED into former air aloft; zero ground
//       mutations). This is why the world-identity golden above is legitimately unmoved.
//   (b) island tops are a lush grass CRUST over a STONE body/roots (the Hallelujah silhouette).
// Toggling SKY_ISLANDS_CONFIG.enabled is a shared-module mutation, so it is restored in a finally.
describe('sky-island fork: ground unchanged below y≈270, grass-crust over stone body (GEN_VERSION 5)', () => {
  const GRASS = /** @type {number} */ (get_block_by_name('grass')?.id)
  const STONE = /** @type {number} */ (get_block_by_name('stone')?.id)
  const AIR = 0

  /** Locate the biggest island of the nearest sky-island region to origin (deterministic). */
  function nearest_big_island(/** @type {import('../../src/gen/column_gen.js').GenContext} */ ctx) {
    const found = []
    for (let rz = -8; rz <= 8; rz += 1)
      for (let rx = -8; rx <= 8; rx += 1) {
        const isl = region_islands(ctx.density.sky, rx, rz)
        if (isl.length) found.push({ d2: rx * rx + rz * rz, isl })
      }
    if (!found.length) throw new Error('no sky-island region within reach — region gate broken')
    found.sort((a, b) => a.d2 - b.d2)
    return found[0].isl.reduce((a, b) => (b.cap_r > a.cap_r ? b : a))
  }

  test('a real archipelago column: every sub-270 block is unchanged vs islands-off (sky-only fork)', () => {
    const big = nearest_big_island(create_gen_context())
    const cx = Math.floor(big.cx / CHUNK_SIZE)
    const cz = Math.floor(big.cz / CHUNK_SIZE)
    // Same column, islands ON (default recipe) then OFF — via CONFIG-FIRST world selection: a world
    // whose `sky.enabled` is false. (This also proves the config adoption is real: flipping one recipe
    // field genuinely removes the sky field from generation, without mutating any module constant.)
    const on = generate_column(create_gen_context(), cx, cz)
    const sky_off = { ...DEFAULT_WORLD_GEN_CONFIG, sky: { ...DEFAULT_WORLD_GEN_CONFIG.sky, enabled: false } }
    const off = generate_column(create_gen_context(sky_off), cx, cz)
    let ground_mutations = 0
    let island_additions = 0
    for (let lx = 0; lx < CHUNK_SIZE; lx += 1)
      for (let lz = 0; lz < CHUNK_SIZE; lz += 1)
        for (let wy = 0; wy < 270; wy += 1) {
          const cy = Math.floor(wy / CHUNK_SIZE)
          const ly = wy - cy * CHUNK_SIZE
          const a = on[cy].ids[local_index(lx, ly, lz)]
          const b = off[cy].ids[local_index(lx, ly, lz)]
          if (a === b) continue
          // The ONLY allowed sub-270 difference is island rock (grass/stone) added where islands-off
          // had air (a root dangling below 270). Any other change = the fork touched GROUND — a bug.
          if (b === AIR && (a === GRASS || a === STONE)) island_additions += 1
          else ground_mutations += 1
        }
    expect(ground_mutations).toBe(0) // fork is SKY-ONLY: ground terrain is byte-identical
    expect(island_additions).toBeGreaterThan(0) // and the island really reaches (roots below 270)
  })

  test('island top is grass crust, body is stone (Hallelujah silhouette)', () => {
    const ctx = create_gen_context()
    const big = nearest_big_island(ctx)
    const cx = Math.floor(big.cx / CHUNK_SIZE)
    const cz = Math.floor(big.cz / CHUNK_SIZE)
    const col = generate_column(ctx, cx, cz)
    const lx = big.cx - cx * CHUNK_SIZE
    const lz = big.cz - cz * CHUNK_SIZE
    const id_at = (/** @type {number} */ y) =>
      col[Math.floor(y / CHUNK_SIZE)].ids[local_index(lx, y - Math.floor(y / CHUNK_SIZE) * CHUNK_SIZE, lz)]
    // Topmost solid on the island axis is grass crust.
    let top = -1
    for (let y = Math.round(big.cy) + 14; y >= Math.round(big.cy) - 6; y -= 1)
      if (id_at(y) !== AIR) {
        top = y
        break
      }
    expect(top).toBeGreaterThan(SKY_ISLANDS_CONFIG.low_y - SKY_ISLANDS_CONFIG.thickness)
    expect(id_at(top)).toBe(GRASS) // lush living top
    // Several blocks below the crust the body is stone; the root tip too.
    expect(id_at(top - SKY_ISLANDS_CONFIG.crust_depth - 3)).toBe(STONE)
  })
})

describe('determinism gate: no banned transcendentals in gen/ (§3.7 CI guard)', () => {
  // Math.floor/Math.sqrt/Math.abs/Math.min/Math.max are allowed (correctly-rounded / integer);
  // the rest are implementation-approximated and non-portable.
  const BANNED = /Math\.(sin|cos|tan|asin|acos|atan|atan2|pow|exp|expm1|log|log2|log10|cbrt|hypot|random)\b/

  /**
   * @param {string} dir
   * @returns {string[]} absolute .js paths (recursive), excluding this test file
   */
  function collect_js(dir) {
    /** @type {string[]} */
    const out = []
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry)
      if (statSync(full).isDirectory()) out.push(...collect_js(full))
      else if (entry.endsWith('.js') && !entry.endsWith('.test.js')) out.push(full)
    }
    return out
  }

  test('gen/ source is transcendental-free', () => {
    const gen_dir = fileURLToPath(new URL('../../src/gen/', import.meta.url))
    const offenders = []
    for (const file of collect_js(gen_dir)) {
      const src = readFileSync(file, 'utf8')
      // Strip /* */ block comments AND // line comments so the ban-list named in doc comments
      // (e.g. "no Math.pow") doesn't self-trip — we only want real code usages.
      const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
      if (BANNED.test(code)) offenders.push(file)
    }
    expect(offenders).toEqual([])
  })
})

// ── NG1-B GENERATION FEATURES (GEN_VERSION 3) ────────────────────────────────────────────────────
// Relief amplitude, steep canyons, thin continuous rivers, and waterfalls, measured over one shared
// region build (a mountainous belt for the fixed seed). Region-scan assertions (not hardcoded coords)
// so a future world fork exercises the FEATURE, not a brittle point.
describe('NG1-B relief / canyon / river / waterfall (GEN_VERSION 3)', () => {
  const ctx = create_gen_context()
  // A river-valley belt for the fixed seed: dramatic relief + a thin river cascading a steep slope
  // (canyon-lip waterfalls) — one shared build exercises relief, steepness, rivers, and falls.
  const CX0 = 30
  const CZ0 = -50
  const N = 12 // 12×12-chunk region (matches the river-continuity brief)
  const SIZE = N * CHUNK_SIZE
  const SEA = SEA_LEVEL
  // One shared build: effective surface + water level + waterfall flag per column of the region.
  const surf = new Int16Array(SIZE * SIZE)
  const water = new Int16Array(SIZE * SIZE)
  const fall = new Uint8Array(SIZE * SIZE)
  const gidx = (/** @type {number} */ gx, /** @type {number} */ gz) => gz * SIZE + gx
  for (let rz = 0; rz < N; rz += 1) {
    for (let rx = 0; rx < N; rx += 1) {
      const p = build_column_profile(ctx, CX0 + rx, CZ0 + rz)
      for (let z = 0; z < CHUNK_SIZE; z += 1) {
        for (let x = 0; x < CHUNK_SIZE; x += 1) {
          const ci = column_index(x, z)
          const g = gidx(rx * CHUNK_SIZE + x, rz * CHUNK_SIZE + z)
          surf[g] = p.surface_y[ci]
          water[g] = p.water_level[ci]
          fall[g] = p.waterfall[ci]
        }
      }
    }
  }

  test('relief: the mountain belt spans >= 100 blocks of relief in the scanned region', () => {
    let lo = 1e9
    let hi = -1e9
    for (let i = 0; i < surf.length; i += 1) {
      if (surf[i] < lo) lo = surf[i]
      if (surf[i] > hi) hi = surf[i]
    }
    expect(hi - lo).toBeGreaterThanOrEqual(100) // refs' hundred-block walls
  })

  test('canyons: deep carve (>= 30 blocks) AND steep near-vertical walls (>= 20 blocks/column)', () => {
    // Depth: the carver digs real ravines in the inland plateaus — scan broadly (they form in
    // mid-erosion terrain, not this mountain-river belt) for the max carve.
    let max_depth = 0
    for (let wz = -2600; wz < 2600; wz += 20) {
      for (let wx = -2600; wx < 2600; wx += 20) {
        const c = sample_climate(ctx.fields, wx, wz)
        const d = canyon_depth(ctx.canyon, wx, wz, c.continentalness, c.erosion, c.pv)
        if (d > max_depth) max_depth = d
      }
    }
    // Wall steepness: the effective surface drops steeply across adjacent columns (canyon/ravine lip).
    let max_grad = 0
    for (let gz = 0; gz < SIZE; gz += 1)
      for (let gx = 0; gx < SIZE - 1; gx += 1) {
        const dh = Math.abs(surf[gidx(gx, gz)] - surf[gidx(gx + 1, gz)])
        if (dh > max_grad) max_grad = dh
      }
    expect(max_depth).toBeGreaterThanOrEqual(30) // a deep ravine exists (global carver capability)
    expect(max_grad).toBeGreaterThanOrEqual(20) // and steep near-vertical walls exist in the belt
  })

  test('rivers are thin (a few % of columns), not a flood', () => {
    let river = 0
    for (let i = 0; i < water.length; i += 1) if (water[i] > SEA) river += 1
    const frac = river / water.length
    expect(frac).toBeGreaterThan(0) // rivers/lakes exist
    expect(frac).toBeLessThan(0.15) // but are thin lines, not the 59% PV-plateau flood
  })

  test('river continuity: water bodies cross internal chunk borders without breaking', () => {
    // Water placement is a pure function of world (x,z), so a river/lake spanning a chunk boundary
    // must have water on BOTH sides of the border, adjacent — never a gap that appears only at the
    // seam. Count such continuous crossings over every internal chunk border in the region; a healthy
    // count proves the network threads across chunks (the anti-regression for per-chunk breaks).
    const is_water = (/** @type {number} */ i) => water[i] > SEA
    let crossings = 0
    for (let gz = 0; gz < SIZE; gz += 1) {
      for (let gx = CHUNK_SIZE; gx < SIZE; gx += CHUNK_SIZE) {
        // Vertical chunk border between grid columns gx-1 (chunk k-1, local 31) and gx (chunk k, local 0).
        if (is_water(gidx(gx - 1, gz)) && is_water(gidx(gx, gz))) crossings += 1
      }
    }
    for (let gx = 0; gx < SIZE; gx += 1) {
      for (let gz = CHUNK_SIZE; gz < SIZE; gz += CHUNK_SIZE) {
        if (is_water(gidx(gx, gz - 1)) && is_water(gidx(gx, gz))) crossings += 1
      }
    }
    expect(crossings).toBeGreaterThan(0) // rivers/lakes span chunk borders continuously (no seam break)
  })

  test('waterfalls: at least one fall/cascade is detected in the region', () => {
    let n = 0
    for (let i = 0; i < fall.length; i += 1) if (fall[i]) n += 1
    expect(n).toBeGreaterThan(0)
  })
})

describe('column_gen output shape (frozen ChunkRecord contract §3.4)', () => {
  const ctx = create_gen_context()
  const column = generate_column(ctx, 3, 3)

  test('produces one chunk per vertical column slot', () => {
    expect(column.length).toBe(CHUNKS_PER_COLUMN)
    expect(column.length).toBe(12)
  })

  test('each chunk record has the frozen array shapes and lit stage', () => {
    for (let cy = 0; cy < column.length; cy += 1) {
      const ch = column[cy]
      expect(ch.cy).toBe(cy)
      expect(ch.ids.length).toBe(VOXELS_PER_CHUNK)
      expect(ch.light.length).toBe(VOXELS_PER_CHUNK)
      expect(ch.biome.length).toBe(META_CELLS_PER_CHUNK)
      expect(ch.stage).toBe('lit')
    }
  })

  test('column height is floored at sea level (water surfaces read as lit sky)', () => {
    // Any column entirely below the surface still reports at least sea level as its lit height.
    for (const ch of column) {
      for (let i = 0; i < CHUNK_SIZE * CHUNK_SIZE; i += 1) {
        expect(ch.height[i]).toBeGreaterThanOrEqual(SEA_LEVEL)
      }
    }
  })

  test('occupancy is set for the topmost solid voxel of each column', () => {
    // The topmost GROUND solid sits at `ground_top - 1` (first-air − 1). With the unified 3D density
    // field (GEN_VERSION 2) an overhang column's nominal `surface_y - 1` can be carved air, so we
    // key off `ground_top` (which resolve_ground_top computes as the real highest solid) — that
    // voxel is solid by construction, so its occupancy bit must be set on all three axes.
    const profile = build_column_profile(ctx, 3, 3)
    let checked = 0
    for (let z = 0; z < CHUNK_SIZE && checked < 8; z += 1) {
      for (let x = 0; x < CHUNK_SIZE && checked < 8; x += 1) {
        const top_solid_y = profile.ground_top[column_index(x, z)] - 1
        if (top_solid_y < 0) continue
        const cy = Math.floor(top_solid_y / CHUNK_SIZE)
        const ly = top_solid_y - cy * CHUNK_SIZE
        const ch = column[cy]
        expect(bit(ch, 0, ly * CHUNK_SIZE + z, x)).toBe(true)
        expect(bit(ch, 1, x * CHUNK_SIZE + z, ly)).toBe(true)
        expect(bit(ch, 2, x * CHUNK_SIZE + ly, z)).toBe(true)
        checked += 1
      }
    }
    expect(checked).toBeGreaterThan(0)
  })

  /**
   * @param {import('../../src/chunks/format.js').ChunkRecord} ch
   * @param {0|1|2} axis
   * @param {number} row
   * @param {number} b
   * @returns {boolean}
   */
  function bit(ch, axis, row, b) {
    return ((ch.occupancy[axis][row] >>> b) & 1) === 1
  }
})

// ── STEEP ALPINE GEOMETRY INVARIANTS (GEN_VERSION 2 — overhangs/multi-run columns) ───────────────
// GEN_VERSION 2's unified 3D density introduced geometry classes v1 never had: overhang columns with
// MULTIPLE solid runs separated by air pockets, and commonplace down-faces. The pre-ship suite was
// green because NO invariant covered them — a per-voxel occupancy or mesher-cull bug on a steep
// alpine slope (the "sky-through checkerboard" field report) would have slipped through. These two
// brute-force invariants close that gap over a REAL alpine fixture (the belt around world -176,-1420,
// which contains hundreds of multi-run overhang columns) and would have caught it pre-ship.
describe('steep-alpine occupancy == solidity (GEN_VERSION 2 multi-run overhang columns)', () => {
  const ctx = create_gen_context()
  // Fixture: an overhang-dense alpine belt chunk-column (cx -3, cz -49; world ~-96,*,-1568), full 12-chunk
  // stack — 749 multi-run overhang columns, the richest in the field-capture belt scan.
  const CX = -3
  const CZ = -49

  /**
   * The mesher's exact solid predicate (drives face culling): id!=0, registry class 'solid', and
   * NOT a cross-shape (foliage carries no occupancy bit). Occupancy MUST equal this per voxel — a
   * mismatch means an air pocket reads solid (over-cull → the missing-face checkerboard) or a solid
   * reads air (holes). All three per-axis encodings must additionally agree with each other.
   * @param {number} id
   * @returns {boolean}
   */
  function mesher_solid(id) {
    if (id === 0) return false
    const b = get_block_by_id(id)
    return b?.class === 'solid' && b?.shape !== 'cross'
  }

  test('every voxel: occupancy(all 3 axes) === (class solid & not cross), incl. air pockets under overhang roofs', () => {
    const column = generate_column(ctx, CX, CZ)
    let occ_not_solid = 0 // occupancy set on a non-solid voxel → GHOST solid (over-cull)
    let solid_not_occ = 0 // solid voxel with occupancy clear → MISSING faces (holes)
    let axis_disagree = 0 // the 3 per-axis masks disagree with each other
    let multi_run_cols = 0 // overhang signature: ≥2 solid runs down a column (proves fixture relevance)
    for (let z = 0; z < CHUNK_SIZE; z += 1) {
      for (let x = 0; x < CHUNK_SIZE; x += 1) {
        let runs = 0
        let prev = false
        for (let cy = column.length - 1; cy >= 0; cy -= 1) {
          const chunk = column[cy]
          for (let ly = CHUNK_SIZE - 1; ly >= 0; ly -= 1) {
            const solid = mesher_solid(chunk.ids[local_index(x, ly, z)])
            const a0 = get_occupancy_bit(chunk, 0, ly * CHUNK_SIZE + z, x)
            const a1 = get_occupancy_bit(chunk, 1, x * CHUNK_SIZE + z, ly)
            const a2 = get_occupancy_bit(chunk, 2, x * CHUNK_SIZE + ly, z)
            if (a0 !== a1 || a1 !== a2) axis_disagree += 1
            if (a0 && !solid) occ_not_solid += 1
            if (!a0 && solid) solid_not_occ += 1
            if (solid && !prev) runs += 1
            prev = solid
          }
        }
        if (runs >= 2) multi_run_cols += 1
      }
    }
    expect(multi_run_cols).toBeGreaterThan(50) // the fixture really is overhang-rich (else it proves nothing)
    expect(occ_not_solid).toBe(0)
    expect(solid_not_occ).toBe(0)
    expect(axis_disagree).toBe(0)
  })
})

describe('steep-alpine 6-axis face coverage (mesher emits a quad for every exposed solid face)', () => {
  const ctx = create_gen_context()
  const CX = -3
  const CZ = -49
  // Face normals: 0=+x 1=-x 2=+y 3=-y 4=+z 5=-z.
  const NORMALS = [
    [1, 0, 0],
    [-1, 0, 0],
    [0, 1, 0],
    [0, -1, 0],
    [0, 0, 1],
    [0, 0, -1],
  ]

  /** @param {number} id @returns {boolean} */
  function mesher_solid(id) {
    if (id === 0) return false
    const b = get_block_by_id(id)
    return b?.class === 'solid' && b?.shape !== 'cross'
  }

  test('with real neighbor halos, every solid face adjacent to non-solid is covered by exactly one quad — 0 missing, 0 dup', () => {
    // Build a resident 3×3 XZ neighborhood (full stacks) so the halos are REAL — border faces resolve
    // to actual neighbor chunks, exactly like the live ring_manager mesh path (mesh_chunk + halos).
    const store = create_chunk_store({ capacity: 100000 })
    for (let dz = -1; dz <= 1; dz += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        for (const ch of generate_column(ctx, CX + dx, CZ + dz)) store.put(ch)
      }
    }
    const get = (/** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ z) => store.get(x, y, z)

    let total_missing = 0 // exposed solid face with NO covering quad → the checkerboard holes
    let total_dup = 0 // a unit face covered by ≥2 quads → greedy overlap
    let total_needed = 0
    // Sweep the surface stack (cy 3..7 spans y96..255 — the whole alpine surface band here).
    for (let cy = 3; cy <= 7; cy += 1) {
      const chunk = /** @type {import('../../src/chunks/format.js').ChunkRecord} */ (get(CX, cy, CZ))
      const halos = build_neighbor_halos(get, CX, cy, CZ)
      const solid_at = (/** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ z) => {
        if (x >= 0 && y >= 0 && z >= 0 && x < CHUNK_SIZE && y < CHUNK_SIZE && z < CHUNK_SIZE) {
          return mesher_solid(chunk.ids[local_index(x, y, z)])
        }
        const b = halos.block
        return b ? mesher_solid(b(x, y, z)) : false
      }

      // Reference: the set of exposed solid faces "x,y,z,face".
      const needed = new Set()
      for (let y = 0; y < CHUNK_SIZE; y += 1) {
        for (let z = 0; z < CHUNK_SIZE; z += 1) {
          for (let x = 0; x < CHUNK_SIZE; x += 1) {
            if (!mesher_solid(chunk.ids[local_index(x, y, z)])) continue
            for (let f = 0; f < 6; f += 1) {
              const nx = x + NORMALS[f][0]
              const ny = y + NORMALS[f][1]
              const nz = z + NORMALS[f][2]
              if (!solid_at(nx, ny, nz)) needed.add(`${x},${y},${z},${f}`)
            }
          }
        }
      }
      total_needed += needed.size

      // Rasterize the mesher's emitted axis quads (faces 0-5) into a covered multiset.
      const { quad_buffer, quad_count } = mesh_chunk(chunk, halos)
      const cover_count = new Map()
      for (let i = 0; i < quad_count; i += 1) {
        const q = decode_quad([quad_buffer[i * 2], quad_buffer[i * 2 + 1]])
        if (q.face > 5) continue // skip cross billboards (no axis face)
        const axis = Math.floor(q.face / 2)
        const [u_axis, v_axis] = axis === 0 ? [1, 2] : axis === 1 ? [0, 2] : [0, 1]
        const base = [q.x, q.y, q.z]
        for (let dv = 0; dv < q.h; dv += 1) {
          for (let du = 0; du < q.w; du += 1) {
            const p = [base[0], base[1], base[2]]
            p[u_axis] = base[u_axis] + du
            p[v_axis] = base[v_axis] + dv
            const k = `${p[0]},${p[1]},${p[2]},${q.face}`
            cover_count.set(k, (cover_count.get(k) ?? 0) + 1)
          }
        }
      }

      for (const k of needed) if (!cover_count.has(k)) total_missing += 1
      for (const [, c] of cover_count) if (c > 1) total_dup += 1
    }

    expect(total_needed).toBeGreaterThan(1000) // the fixture is a dense surface (else it proves nothing)
    expect(total_missing).toBe(0) // NO exposed solid face is left un-meshed (no sky-through holes)
    expect(total_dup).toBe(0) // no greedy overlap
  })
})
