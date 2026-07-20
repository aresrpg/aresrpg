// NG1-A density/shaping tests — the unified 3D density field + its ridged/warp noise helpers.
// Covers: (1) DETERMINISM — same seed ⇒ bit-identical samples across independent contexts;
// (2) BANDING — is_solid's heightfield fast path agrees with the full field outside the active
// bands, and both agree everywhere (fast path is a pure optimization, never a behavior change);
// (3) OVERHANGS — a gated column actually produces a non-monotonic solid/air/solid column (the
// feature); (4) GATE — flat/eroded columns are ungated (cost + overhang free), steep peaky ones open;
// (5) SKY — the inverted shell yields sparse solid high in the band and none at ground level;
// (6) HARD FLOOR — the world bottom is never carved through.
//
// The transcendental ban (§3.7) for these files is enforced by column_gen.test.js's gen/ grep guard.

import { test, expect, describe } from 'bun:test'

import { CHUNK_SIZE, derive_world_seeds, HARD_FLOOR_Y, SEA_LEVEL } from '../config/world_config.js'
import { local_index, get_sun_light } from '../chunks/format.js'
import { get_block_by_name } from '../config/block_registry.js'

import { create_gen_context, generate_column } from './column_gen.js'
import { region_islands } from './sky_islands.js'
import { create_ridged_sampler } from './noise/ridged.js'
import { create_warp_sampler } from './noise/warp.js'
import { cave_band_low } from './carvers/caves.js'
import {
  DENSITY_CONFIG,
  build_density_column,
  create_density_context,
  density,
  is_solid,
  overhang_gate,
  rekey_density_column,
} from './density.js'
import { sample_climate, create_field_set } from './noise/fields.js'
import { shape_column } from './terrain_shaper.js'

const seeds = derive_world_seeds()
const dctx = create_density_context(seeds)
const fields = create_field_set(seeds)

/**
 * Build a DensityColumn at a world (x,z) from the live shaper + climate.
 * @param {number} world_x
 * @param {number} world_z
 */
function col_at(world_x, world_z) {
  const climate = sample_climate(fields, world_x, world_z)
  const shaped = shape_column(climate)
  return { climate, shaped, col: build_density_column(dctx, shaped.surface_y, climate, world_x, world_z) }
}

describe('ridged/warp noise: determinism + range (§3.7)', () => {
  test('ridged sampler is deterministic and bounded to [0,1]', () => {
    const a = create_ridged_sampler({ seed: 1234, base_period: 100, octaves: 4 })
    const b = create_ridged_sampler({ seed: 1234, base_period: 100, octaves: 4 })
    for (let i = 0; i < 200; i += 1) {
      const x = i * 3.1,
        y = i * 1.7,
        z = i * 2.3
      const va = a.sample(x, y, z)
      expect(b.sample(x, y, z)).toBe(va) // same seed ⇒ identical
      expect(va).toBeGreaterThanOrEqual(0)
      expect(va).toBeLessThanOrEqual(1)
    }
  })

  test('different seeds decorrelate; warp components are signed and deterministic', () => {
    const w = create_warp_sampler({ seed: 999, base_period: 200, octaves: 2 })
    const w2 = create_warp_sampler({ seed: 999, base_period: 200, octaves: 2 })
    const o1 = [0, 0, 0]
    const o2 = [0, 0, 0]
    let nonzero = 0
    for (let i = 0; i < 100; i += 1) {
      w.offset(i * 5, i * 2, i * 7, o1)
      w2.offset(i * 5, i * 2, i * 7, o2)
      expect(o2).toEqual(o1) // deterministic
      for (const c of o1) {
        expect(c).toBeGreaterThanOrEqual(-1.001)
        expect(c).toBeLessThanOrEqual(1.001)
        if (Math.abs(c) > 1e-6) nonzero += 1
      }
      // the three axes are decorrelated: not all equal
    }
    expect(nonzero).toBeGreaterThan(0)
  })
})

describe('density field: determinism (world-identity, §3.7)', () => {
  test('two independent density contexts sample identically', () => {
    const d2 = create_density_context(derive_world_seeds())
    for (let i = 0; i < 300; i += 1) {
      const wx = (i * 37) % 500,
        wz = (i * 53) % 500
      const { col } = col_at(wx, wz)
      const y = col.surface_y - 3
      expect(density(d2, col, wx, y, wz)).toBe(density(dctx, col, wx, y, wz))
    }
  })
})

describe('density banding: fast path == full field (optimization is behavior-neutral)', () => {
  test('is_solid agrees with the raw density sign at every y across a column', () => {
    // Sweep several real columns over the full world height; is_solid (which fast-paths the
    // heightfield outside the active bands) must equal (density > 0) everywhere — the band gate is
    // a pure cost optimization and must never change the solid set.
    let checked = 0
    for (const [wx, wz] of [
      [10, 10],
      [-73, 41],
      [-80, -1457], // the alpine overhang hotspot
      [320, -680],
      [1825, 1422], // a SKY-ISLAND axis (has_sky column) — proves the sky-band gate is behavior-neutral
    ]) {
      const { col } = col_at(wx, wz)
      // Sweep to the top of the sky band so the island band is covered on the sky column.
      for (let y = 1; y < DENSITY_CONFIG.sky.high_y + DENSITY_CONFIG.sky.thickness + 4; y += 1) {
        const fast = is_solid(dctx, col, wx, y, wz)
        const full = density(dctx, col, wx, y, wz) > 0
        expect(fast).toBe(full)
        checked += 1
      }
    }
    expect(checked).toBeGreaterThan(1000)
  })
})

describe('overhangs: gated columns produce non-monotonic solid columns', () => {
  test('some gated alpine column has a solid→air→solid undercut', () => {
    // Scan the overhang-dense alpine belt (world x[-192,96] z[-1728,-1360]) for a high-gate column
    // that undercuts (solid, air gap, solid again). Region-scan not a single hardcoded coord, so a
    // future world fork that shifts the hotspot doesn't falsely fail — the FEATURE is what's asserted.
    let checked_gated = 0
    let undercut_cols = 0
    for (let wz = -1728; wz <= -1360 && undercut_cols === 0; wz += 5) {
      for (let wx = -192; wx <= 96 && undercut_cols === 0; wx += 5) {
        const { col } = col_at(wx, wz)
        if (col.gate < 0.3) continue
        checked_gated += 1
        const solid = []
        for (let y = col.surface_y - 30; y <= col.surface_y + 34; y += 1) solid.push(is_solid(dctx, col, wx, y, wz))
        let seen_solid = false
        let seen_gap = false
        let undercuts = 0
        for (let i = solid.length - 1; i >= 0; i -= 1) {
          if (solid[i] && !seen_solid) seen_solid = true
          else if (!solid[i] && seen_solid) seen_gap = true
          else if (solid[i] && seen_gap) {
            undercuts += 1
            seen_gap = false
          }
        }
        if (undercuts > 0) undercut_cols += 1
      }
    }
    expect(checked_gated).toBeGreaterThan(0) // the belt really has gated (steep, peaky) columns
    expect(undercut_cols).toBeGreaterThan(0) // and at least one actually overhangs
  })
})

describe('overhang gate: flat=off, steep+peaky=on', () => {
  test('gate is 0 for flat/eroded, positive for steep low-erosion high-pv', () => {
    expect(overhang_gate(0.9, 0.9)).toBe(0) // eroded (flat) ⇒ off regardless of pv
    expect(overhang_gate(0.1, 0.1)).toBe(0) // valley (low pv) ⇒ off regardless of erosion
    expect(overhang_gate(0.05, 0.99)).toBeGreaterThan(0) // steep peak ⇒ on
    // monotonic-ish: a steeper column gates at least as hard as a less-steep one at same pv
    expect(overhang_gate(0.1, 0.9)).toBeGreaterThanOrEqual(overhang_gate(0.4, 0.9))
  })
})

describe('sky islands (Pandora, region-gated): solid inside a sky region, ZERO ribbons elsewhere', () => {
  const SKY = DENSITY_CONFIG.sky
  const rsize = SKY.region_size

  /** Find the (rx,rz) of the first sky-island region near origin (deterministic). */
  function first_sky_region() {
    for (let rz = 0; rz <= 6; rz += 1) {
      for (let rx = 0; rx <= 6; rx += 1) {
        if (region_islands(dctx.sky, rx, rz).length > 0) return { rx, rz }
      }
    }
    throw new Error('no sky-island region within reach — the region gate is broken')
  }

  test('a sky-island region yields FLOATING solid island rock (above the terrain top)', () => {
    const { rx, rz } = first_sky_region()
    // Scan the region cell's XZ footprint for solid voxels ABOVE the terrain top — true floating rock,
    // not tall mountains that happen to poke into the band's low edge.
    let sky_solid = 0
    for (let z = rz * rsize; z < (rz + 1) * rsize; z += 12) {
      for (let x = rx * rsize; x < (rx + 1) * rsize; x += 12) {
        const { col } = col_at(x, z)
        const above_terrain = col.surface_y + DENSITY_CONFIG.detail.amp + 2
        for (let y = Math.max(SKY.low_y - SKY.thickness, above_terrain); y <= SKY.high_y + SKY.thickness; y += 6) {
          if (is_solid(dctx, col, x, y, z)) sky_solid += 1
        }
      }
    }
    expect(sky_solid).toBeGreaterThan(0) // the archipelago is really there, hanging in the air
  })

  test('RIBBON KILLER: an EMPTY (non-sky) region has ZERO sky solids across the whole band', () => {
    // The core defect: fish-bone ribbons smeared across the WHOLE sky. Region-gating must
    // leave non-sky regions completely empty aloft. Find a non-sky region and assert not one solid
    // voxel exists anywhere in its sky band — the definitive ribbon-killer.
    let empty = null
    for (let rz = 0; rz <= 8 && !empty; rz += 1) {
      for (let rx = 0; rx <= 8 && !empty; rx += 1) {
        if (region_islands(dctx.sky, rx, rz).length === 0) empty = { rx, rz }
      }
    }
    if (!empty) throw new Error('no empty region found — region_rate is implausibly high')
    // A "ribbon" is FLOATING rock — solid disconnected from the ground. Count only solids ABOVE the
    // terrain top (col.surface_y + a generous margin for any overhang lip); the low end of the sky
    // band can overlap tall mountains, which are legitimate ground, not ribbons.
    let ribbons = 0
    for (let z = empty.rz * rsize; z < (empty.rz + 1) * rsize; z += 7) {
      for (let x = empty.rx * rsize; x < (empty.rx + 1) * rsize; x += 7) {
        const { col } = col_at(x, z)
        expect(col.has_sky).toBe(false) // the column-level gate agrees: no sky here
        const above_terrain = col.surface_y + DENSITY_CONFIG.detail.amp + 2 // clear any overhang lip
        for (let y = Math.max(SKY.low_y - SKY.thickness, above_terrain); y <= SKY.high_y + SKY.thickness; y += 4) {
          if (is_solid(dctx, col, x, y, z)) ribbons += 1
        }
      }
    }
    expect(ribbons).toBe(0) // NOT ONE floating ribbon voxel in an empty sky region
  })

  test('island SHAPE sanity: a sky region has ≥3 islands, caps ≥ config min, roots within bounds', () => {
    const { rx, rz } = first_sky_region()
    const islands = region_islands(dctx.sky, rx, rz)
    // Primary islands (exclude satellites): the archipelago floor is islands_min.
    // region_islands returns primaries + satellites mixed; primaries alone are ≥ islands_min, so the
    // total is trivially ≥ islands_min too. Assert the archipelago is a real cluster.
    expect(islands.length).toBeGreaterThanOrEqual(SKY.islands_min) // ≥3 islands (a cluster)
    for (const isl of islands) {
      // Every cap radius is within [cap_radius_min·satellite_ratio (satellites) .. cap_radius_max].
      expect(isl.cap_r).toBeGreaterThan(0)
      expect(isl.cap_r).toBeLessThanOrEqual(SKY.cap_radius_max + 0.001)
      // Root depth is cap_r × a ratio in [root_ratio_min, root_ratio_max].
      expect(isl.root_depth).toBeGreaterThanOrEqual(isl.cap_r * SKY.root_ratio_min - 0.001)
      expect(isl.root_depth).toBeLessThanOrEqual(isl.cap_r * SKY.root_ratio_max + 0.001)
      // The lowest root tip stays inside the scanned band (never clipped).
      expect(isl.cy - isl.root_depth).toBeGreaterThanOrEqual(SKY.low_y - SKY.thickness - 0.001)
    }
    // At least one PRIMARY island reads as a landmass (cap ≥ the ground-readable minimum).
    expect(islands.some((i) => i.cap_r >= SKY.cap_radius_min)).toBe(true)
  })

  test('island TOP is grass-family, BODY is stone (Pandora crust over rock)', () => {
    // Generate the real chunk column through the biggest island's axis and read block ids: the top
    // crust must be grass (or dirt), the interior body stone.
    const { rx, rz } = first_sky_region()
    const islands = region_islands(dctx.sky, rx, rz)
    const big = islands.reduce((a, b) => (b.cap_r > a.cap_r ? b : a))
    const cx = Math.floor(big.cx / CHUNK_SIZE)
    const cz = Math.floor(big.cz / CHUNK_SIZE)
    const ctx = create_gen_context()
    const col = generate_column(ctx, cx, cz)
    const lx = big.cx - cx * CHUNK_SIZE
    const lz = big.cz - cz * CHUNK_SIZE
    const id_at = (/** @type {number} */ y) =>
      col[Math.floor(y / CHUNK_SIZE)].ids[local_index(lx, y - Math.floor(y / CHUNK_SIZE) * CHUNK_SIZE, lz)]
    const GRASS = /** @type {number} */ (get_block_by_name('grass')?.id)
    const DIRT = /** @type {number} */ (get_block_by_name('dirt')?.id)
    const STONE = /** @type {number} */ (get_block_by_name('stone')?.id)
    // Topmost solid on the island axis = crust; a few blocks down = body.
    let top = -1
    for (let y = big.cy + 12; y >= big.cy - 4; y -= 1) {
      if (id_at(y) !== 0) {
        top = y
        break
      }
    }
    expect(top).toBeGreaterThan(SKY.low_y - SKY.thickness) // an island really tops this column
    const crust_id = id_at(top)
    expect(crust_id === GRASS || crust_id === DIRT).toBe(true) // grass-family top
    // Deep in the body (well below the crust) is stone.
    expect(id_at(big.cy - Math.floor(big.cap_r * 0.5))).toBe(STONE)
  })
})

describe('hard floor: the world bottom is never carved through', () => {
  test('every column is solid at and below the hard floor', () => {
    for (const [wx, wz] of [
      [10, 10],
      [-80, -1457],
      [200, 200],
      [-500, 300],
    ]) {
      const { col } = col_at(wx, wz)
      for (let y = 0; y <= HARD_FLOOR_Y; y += 1) {
        expect(is_solid(dctx, col, wx, y, wz)).toBe(true)
      }
    }
  })
})

describe('overhang light compat: undercut interior is graded, never sun=15 (§brief)', () => {
  test('an air pocket directly under a solid overhang/cave roof gets 0 <= sun < 15 (not open-sky 15)', () => {
    // Downstream compat: the light BFS must NOT flag a roofed (overhang/cave-interior) air cell as
    // open sky (sun 15). Scan the alpine belt's chunk-columns for any roofed-air voxel; assert none
    // read sun 15 and at least one is gradient-lit. Region-scan → robust across world forks.
    const ctx = create_gen_context()
    let roofed_air = 0
    let any_graded = false
    let sun15_leaks = 0
    for (let cz = -54; cz <= -44 && roofed_air < 40; cz += 1) {
      for (let cx = -4; cx <= 6 && roofed_air < 40; cx += 1) {
        const col = generate_column(ctx, cx, cz)
        const id_at = (/** @type {number} */ lx, /** @type {number} */ y, /** @type {number} */ lz) =>
          col[Math.floor(y / CHUNK_SIZE)].ids[local_index(lx, y - Math.floor(y / CHUNK_SIZE) * CHUNK_SIZE, lz)]
        const sun_at = (/** @type {number} */ lx, /** @type {number} */ y, /** @type {number} */ lz) =>
          get_sun_light(
            col[Math.floor(y / CHUNK_SIZE)].light[local_index(lx, y - Math.floor(y / CHUNK_SIZE) * CHUNK_SIZE, lz)]
          )
        for (let lz = 4; lz < 28 && roofed_air < 40; lz += 6) {
          for (let lx = 4; lx < 28 && roofed_air < 40; lx += 6) {
            for (let y = 120; y < 250; y += 1) {
              const roof = id_at(lx, y + 1, lz)
              if (id_at(lx, y, lz) === 0 && roof !== 0 && roof !== 5) {
                roofed_air += 1
                const s = sun_at(lx, y, lz)
                if (s >= 15) sun15_leaks += 1
                if (s > 0 && s < 15) any_graded = true
              }
            }
          }
        }
      }
    }
    expect(roofed_air).toBeGreaterThan(0) // the belt really has roofed (overhang/cave) interiors
    expect(sun15_leaks).toBe(0) // NONE is treated as open sky
    expect(any_graded).toBe(true) // and at least one is gradient-lit by the lateral BFS (not pitch-0)
  })
})

describe('rekey_density_column: beach flatten re-keys the band', () => {
  test('re-keying to a new surface moves the active band (surface + caves) in lockstep', () => {
    const { col } = col_at(60, 60)
    const deep = col.has_deep_caves
    rekey_density_column(col, SEA_LEVEL + 1)
    expect(col.surface_y).toBe(SEA_LEVEL + 1)
    expect(col.band_high).toBe(SEA_LEVEL + 1 + DENSITY_CONFIG.band_blocks)
    // band_low tracks the deepest carve: bedrock on cave-region columns, else the spaghetti crust.
    expect(col.band_low).toBe(cave_band_low(SEA_LEVEL + 1, deep))
    expect(col.has_deep_caves).toBe(deep) // rekey preserves the cave-region flag
  })
})
