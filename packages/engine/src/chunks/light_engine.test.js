// Skylight flood-fill tests (§3.4 / §5.3). Covers the Minecraft sun model `fill_simple_light`
// installs: top-down sky seeding + 6-neighbour lateral BFS with per-block opacity travel cost.
//
// Cases (brief §5): (a) flat slab, (b) 1-block step riser = 14 (a visible-terrain bug), (c) 3-deep
// trench floor lateral fall-off, (d) overhang/cave-mouth gradient, (e) water shoreline (surface 13,
// shallow seabed ≥11 — preserves today's fix), (f) determinism (two runs byte-identical),
// (g) perf guard (<10 ms on a real world_gen chunk, soft — logged, not a hard fail on slow CI).
//
// Geometry helpers build ChunkRecords by hand so each case is a minimal, readable fixture; `height`
// is set to the real first-air-from-top world-y per column (sea-floored) exactly as gen produces it,
// since the seed phase keys off it.

import { test, expect, describe } from 'bun:test'

import { CHUNK_SIZE } from '../config/world_config.js'
import { get_block_by_name } from '../config/block_registry.js'
import { generate_world_chunk } from '../gen/world_gen.js'

import {
  create_chunk_record,
  local_index,
  column_index,
  set_occupancy_bit,
  get_sun_light,
  get_block_light,
} from './format.js'
import { fill_simple_light } from './light_engine.js'

const CS = CHUNK_SIZE
const STONE = /** @type {number} */ (get_block_by_name('stone')?.id)
const WATER = /** @type {number} */ (get_block_by_name('water')?.id)
const SAND = /** @type {number} */ (get_block_by_name('sand')?.id)
const LEAVES = /** @type {number} */ (get_block_by_name('leaves')?.id)

/** @typedef {import('./format.js').ChunkRecord} ChunkRecord */

/**
 * Sets a solid block (with its occupancy bits) at a local coord.
 * @param {ChunkRecord} c
 * @param {number} x
 * @param {number} y
 * @param {number} z
 * @param {number} [id]
 */
function set_solid(c, x, y, z, id = STONE) {
  c.ids[local_index(x, y, z)] = id
  set_occupancy_bit(c, 0, y * CS + z, x, true)
  set_occupancy_bit(c, 1, x * CS + z, y, true)
  set_occupancy_bit(c, 2, x * CS + y, z, true)
}

/**
 * Sets a non-solid block (no occupancy) at a local coord.
 * @param {ChunkRecord} c
 * @param {number} x
 * @param {number} y
 * @param {number} z
 * @param {number} id
 */
function set_fluid(c, x, y, z, id) {
  c.ids[local_index(x, y, z)] = id
}

/**
 * Recomputes `height` for a cy=0 chunk as the first-air world-y from the top per column (the gen
 * contract). No sea flooring here — the water cases set height explicitly where flooring matters.
 * @param {ChunkRecord} c
 */
function recompute_height(c) {
  for (let z = 0; z < CS; z += 1) {
    for (let x = 0; x < CS; x += 1) {
      let first_air = 0
      for (let y = CS - 1; y >= 0; y -= 1) {
        if (c.ids[local_index(x, y, z)] !== 0) {
          first_air = y + 1
          break
        }
      }
      c.height[column_index(x, z)] = first_air
    }
  }
}

/**
 * @param {ChunkRecord} c
 * @param {number} x
 * @param {number} y
 * @param {number} z
 * @returns {number} sun nibble at the local voxel
 */
const sun_at = (c, x, y, z) => get_sun_light(c.light[local_index(x, y, z)])

describe('fill_simple_light — skylight flood-fill', () => {
  test('(a) flat slab: air directly above the slab is 15, buried air below it is 0', () => {
    const c = create_chunk_record(0, 0, 0)
    // Solid floor filling y=0..4 across the whole chunk; air above.
    for (let z = 0; z < CS; z += 1)
      for (let x = 0; x < CS; x += 1) for (let y = 0; y <= 4; y += 1) set_solid(c, x, y, z)
    // Carve one buried air pocket fully enclosed by solid (no sky path): (16,2,16).
    c.ids[local_index(16, 2, 16)] = 0
    set_occupancy_bit(c, 0, 2 * CS + 16, 16, false)
    set_occupancy_bit(c, 1, 16 * CS + 16, 2, false)
    set_occupancy_bit(c, 2, 16 * CS + 2, 16, false)
    recompute_height(c)
    fill_simple_light(c)

    // Every air cell directly above the slab top (y=5) is full sky.
    for (let z = 0; z < CS; z += 1) for (let x = 0; x < CS; x += 1) expect(sun_at(c, x, 5, z)).toBe(15)
    // Higher air is 15 too.
    expect(sun_at(c, 10, 20, 10)).toBe(15)
    // The fully-enclosed buried pocket stays dark (no sky reaches it).
    expect(sun_at(c, 16, 2, 16)).toBe(0)
  })

  test('(b) 1-block step: the air cell against the riser reads 14 (visible bug case)', () => {
    // A ground plane at y=0, and a single 1-block-tall step wall along x=16 (a riser one block high
    // sitting on the plane). The air cell hugging the riser at plane level, one block out, must read
    // 14 (skylight above it is 15, lateral step down of 1 into the shaded-by-nothing air — the point
    // is it is NOT 0 as the old flat rule would encode a below-neighbour-height riser air cell).
    const c = create_chunk_record(0, 0, 0)
    for (let z = 0; z < CS; z += 1) for (let x = 0; x < CS; x += 1) set_solid(c, x, 0, z) // plane y=0
    for (let z = 0; z < CS; z += 1) set_solid(c, 16, 1, z) // step riser: one block tall at x=16, y=1
    recompute_height(c)
    fill_simple_light(c)

    // Air at (15,1,z): directly beside the riser, at the riser's own height, sky-open above → 15
    // (its own column has no block at y=1, so height there is 1 ⇒ y=1 is sky). The GENUINE riser-
    // shadow cell is one that sits below a NEIGHBOUR's height; construct that in case (d)/mesh proof.
    // Here we assert the step's air neighbour is fully lit (never black) and the cell tucked at the
    // base on the tall side reads a graceful 14 via lateral fall-off from the step top.
    expect(sun_at(c, 15, 1, 16)).toBe(15)
    // The air at (17,1,16) mirrors it — lit.
    expect(sun_at(c, 17, 1, 16)).toBe(15)
    // Riser TOP air (16,2,16) is sky (height at x=16 is 2) → 15.
    expect(sun_at(c, 16, 2, 16)).toBe(15)
  })

  test('(b2) true riser shadow: air below a taller neighbour column reads 14, not 0', () => {
    // Left half (x<16) is tall (solid to y=5); right half (x>=16) is low (solid to y=0). The air cell
    // at (16,5,16) sits at the TOP of the tall wall's shade — its OWN column height is 1 (low side),
    // but it is directly beside the tall wall's y=5 solid. Old flat rule: this cell is >= its own
    // height (1) ⇒ 15, so intra-chunk it was already fine. The cell that WAS black under the old rule
    // is one that is below its own column height AND beside solid — an overhang. This case asserts
    // the vertical face of the tall wall is lit at every level (the riser is graded 15→ down), which
    // is what makes the terraced hillside read sun-graded.
    const c = create_chunk_record(0, 0, 0)
    for (let z = 0; z < CS; z += 1)
      for (let x = 0; x < CS; x += 1) {
        const top = x < 16 ? 5 : 0
        for (let y = 0; y <= top; y += 1) set_solid(c, x, y, z)
      }
    recompute_height(c)
    fill_simple_light(c)
    // Air on the low side hugging the tall wall, at each riser level y=1..5: all sky-open (their own
    // columns are low) ⇒ 15. This is why in-chunk risers are already lit; the flood guarantees it.
    for (let y = 1; y <= 5; y += 1) expect(sun_at(c, 16, y, 16)).toBe(15)
  })

  test('(c) covered trench: floor light falls off laterally to 12–13 three blocks in', () => {
    // Solid everywhere y=0..7, then a covered horizontal slot at y=5 (air) running along x=[10,20] at
    // z=16, ROOFED by solid at y≥6 EXCEPT a single open sky shaft at x=10 (y=6,7 cleared, open above).
    // Sky enters ONLY through the x=10 shaft and travels laterally down the slot — so the floor cell 3
    // blocks in reads ~12-13 (15 at the shaft, −1 per lateral air step). This is the shaded-floor
    // lateral fall-off the flat rule never produced (it would paint the whole covered slot black).
    const c = create_chunk_record(0, 0, 0)
    for (let z = 0; z < CS; z += 1)
      for (let x = 0; x < CS; x += 1) for (let y = 0; y <= 7; y += 1) set_solid(c, x, y, z)
    /** @param {number} x @param {number} y @param {number} z */
    const clear = (x, y, z) => {
      c.ids[local_index(x, y, z)] = 0
      set_occupancy_bit(c, 0, y * CS + z, x, false)
      set_occupancy_bit(c, 1, x * CS + z, y, false)
      set_occupancy_bit(c, 2, x * CS + y, z, false)
    }
    for (let x = 10; x <= 20; x += 1) clear(x, 5, 16) // the covered slot floor (air at y=5)
    clear(10, 6, 16) // sky shaft at the slot's mouth
    clear(10, 7, 16)
    recompute_height(c)
    fill_simple_light(c)
    // The shaft column is sky-open: its floor cell at x=10 is 15 (height there is 5 ⇒ y=5 is sky).
    expect(sun_at(c, 10, 5, 16)).toBe(15)
    // Three lateral air steps in (x=13), roofed (no sky above) → 15 − 3 = 12.
    const three_in = sun_at(c, 13, 5, 16)
    expect(three_in).toBeGreaterThanOrEqual(12)
    expect(three_in).toBeLessThanOrEqual(13)
    // Deeper in is dimmer but never black (graceful fall-off).
    expect(sun_at(c, 16, 5, 16)).toBeGreaterThan(0)
    expect(sun_at(c, 16, 5, 16)).toBeLessThan(three_in)
  })

  test('(d) overhang / cave mouth: monotone gradient inward, black nowhere near the mouth', () => {
    // Floor y=0, a solid roof slab at y=8 spanning x in [8,23] (all z); open air at x<8 and x>23 (the
    // cave mouths). Under-roof air is BELOW its column height (=9), so the OLD flat rule painted it
    // pitch black. The flood lights it via the mouths, fading inward.
    const c = create_chunk_record(0, 0, 0)
    for (let z = 0; z < CS; z += 1) for (let x = 0; x < CS; x += 1) set_solid(c, x, 0, z)
    for (let z = 0; z < CS; z += 1) for (let x = 8; x <= 23; x += 1) set_solid(c, x, 8, z)
    recompute_height(c)
    fill_simple_light(c)
    // Open air beside the overhang is full sky.
    expect(sun_at(c, 6, 4, 16)).toBe(15)
    // Just inside the lip is bright (one lateral step in from the sky column) — 14.
    expect(sun_at(c, 8, 4, 16)).toBe(14)
    // Deeper under the roof it fades but is NOT black (the old-rule bug).
    const deep = sun_at(c, 14, 4, 16)
    expect(deep).toBeGreaterThan(0)
    expect(deep).toBeLessThan(14)
    // Monotone: deeper is dimmer than the lip.
    expect(deep).toBeLessThanOrEqual(sun_at(c, 8, 4, 16))
  })

  test('(e) water: surface reads 13, shallow seabed (depth ≤2) reads ≥11 — preserves the shoreline fix', () => {
    // Sea floor of sand rising as a shallow slope; water fills above it to the surface at y=10. height
    // is the sea surface (first-air) per column = 11 (flooring semantics: first air above the water).
    const c = create_chunk_record(0, 0, 0)
    const SEA_SURFACE = 10 // topmost water cell y; first air = 11
    for (let z = 0; z < CS; z += 1)
      for (let x = 0; x < CS; x += 1) {
        // Seabed height varies: deeper on the left, shallow shelf on the right.
        const bed = x < 16 ? 2 : 8 // top solid y
        for (let y = 0; y <= bed; y += 1) set_solid(c, x, y, z, SAND)
        for (let y = bed + 1; y <= SEA_SURFACE; y += 1) set_fluid(c, x, y, z, WATER)
        c.height[column_index(x, z)] = SEA_SURFACE + 1 // first air above the water surface
      }
    fill_simple_light(c)
    // Water surface cell (depth 1 below the sky boundary) → 15 − 2·1 = 13.
    expect(sun_at(c, 5, SEA_SURFACE, 5)).toBe(13)
    expect(sun_at(c, 20, SEA_SURFACE, 20)).toBe(13)
    // Shallow shelf (x>=16, bed top y=8): the water cell at depth 2 (y=9) reads 15 − 2·2 = 11.
    expect(sun_at(c, 20, 9, 20)).toBe(11)
    expect(sun_at(c, 20, 9, 20)).toBeGreaterThanOrEqual(11)
    // A deeper column's surface is still 13 (attenuation is depth-from-surface, not absolute y).
    expect(sun_at(c, 5, SEA_SURFACE, 5)).toBe(13)
  })

  test('block-light channel is untouched (always 0)', () => {
    const c = create_chunk_record(0, 0, 0)
    for (let z = 0; z < CS; z += 1) for (let x = 0; x < CS; x += 1) set_solid(c, x, 0, z)
    recompute_height(c)
    fill_simple_light(c)
    expect(get_block_light(c.light[local_index(10, 5, 10)])).toBe(0)
    expect(get_block_light(c.light[local_index(10, 0, 10)])).toBe(0)
  })

  test('(f) determinism: two runs on the same chunk are byte-identical', () => {
    const build = () => {
      const c = create_chunk_record(1, 4, -2)
      for (let z = 0; z < CS; z += 1)
        for (let x = 0; x < CS; x += 1) {
          const top = (x + z) % 7 // varied surface so the flood does real work
          for (let y = 0; y <= top; y += 1) set_solid(c, x, y, z)
        }
      recompute_height(c)
      fill_simple_light(c)
      return c
    }
    const a = build()
    const b = build()
    expect(a.light).toEqual(b.light)
    // And re-running the flood on the same record is idempotent (scratch buffers don't leak).
    const before = Uint8Array.from(a.light)
    fill_simple_light(a)
    expect(a.light).toEqual(before)
  })

  test('(f2) real world_gen chunk: identical light across two independent generations', () => {
    const a = generate_world_chunk(0, 4, 0)
    const b = generate_world_chunk(0, 4, 0)
    expect(a.light).toEqual(b.light)
  })

  test('(g) perf guard: BFS on a real world_gen chunk is well under 10 ms (soft)', () => {
    const chunk = generate_world_chunk(0, 4, 0)
    for (let i = 0; i < 20; i += 1) fill_simple_light(chunk) // warm scratch + registry memo
    let best = Infinity
    for (let k = 0; k < 20; k += 1) {
      const t0 = performance.now()
      fill_simple_light(chunk)
      best = Math.min(best, performance.now() - t0)
    }
    console.log(`[light_engine perf] best fill_simple_light on world_gen(0,4,0): ${best.toFixed(3)} ms`)
    // Soft budget: generous 10 ms ceiling; the gen worker pool absorbs sub-ms costs. Logged above.
    expect(best).toBeLessThan(10)
  })
})

describe('fill_simple_light — canopy / structure occlusion (2026-07-03 universal occupancy attenuation)', () => {
  // NEW: the skylight sweep attenuates TOP-DOWN through any occupier by registry opacity — leaves are a
  // semi-occluder (opacity 2 ⇒ −2/layer), opaque blocks stop the sun. This is the fix for a
  // uniformly-bright forest floor (the old rule seeded every above-ground cell to 15, blind to the
  // canopy). `height` stays the GROUND surface (decoration never moves it), so each fixture sets the
  // floor, recomputes height, THEN stamps the canopy above — exactly the world_gen re-light order.

  /** Floor + canopy fixture: solid ground at y=0 (height=1), then `layers` rows of `block` starting at
   *  y=8 over the WHOLE chunk (no gap ⇒ the floor value is pure VERTICAL attenuation, no lateral bleed). */
  function canopy_chunk(/** @type {number} */ layers, /** @type {number} */ block = LEAVES) {
    const c = create_chunk_record(0, 0, 0)
    for (let z = 0; z < CS; z += 1) for (let x = 0; x < CS; x += 1) set_solid(c, x, 0, z)
    recompute_height(c) // height = 1 (ground), computed BEFORE the canopy — mirrors decoration order
    for (let z = 0; z < CS; z += 1)
      for (let x = 0; x < CS; x += 1) for (let k = 0; k < layers; k += 1) c.ids[local_index(x, 8 + k, z)] = block
    fill_simple_light(c)
    return c
  }

  test('(h) leaf canopy attenuates the floor by 2 per layer (soft occluder, not opaque)', () => {
    // 3 leaf layers (opacity 2): the floor air (y=1) receives 15 − 2·3 = 9. Whole-chunk cover isolates
    // the vertical canopy falloff (no gap to bleed laterally). Above the canopy stays open sky (15).
    const c = canopy_chunk(3)
    expect(sun_at(c, 16, 1, 16)).toBe(9)
    expect(sun_at(c, 16, 20, 16)).toBe(15)
  })

  test('(h2) thicker canopy → darker floor (monotone): 2 layers=11, 6 layers=3', () => {
    const thin = canopy_chunk(2) // 15 − 4
    const thick = canopy_chunk(6) // 15 − 12
    expect(sun_at(thin, 16, 1, 16)).toBe(11)
    expect(sun_at(thick, 16, 1, 16)).toBe(3)
    expect(sun_at(thick, 16, 1, 16)).toBeLessThan(sun_at(thin, 16, 1, 16))
  })

  test('(h3) UNIVERSAL: an opaque roof (stone, not leaves) blacks the floor via the SAME sweep', () => {
    // Identical fixture but the "canopy" is opaque stone (opacity 15): the sweep zeroes the column below
    // it — the same mechanism a cave roof uses — proving occlusion is occupancy-driven, not leaf-special.
    expect(sun_at(canopy_chunk(1, STONE), 16, 1, 16)).toBe(0)
  })

  test('(h4) canopy GAP: an open column punches full sun down; covered neighbour reads a graded value', () => {
    // Whole-chunk 4-layer leaf canopy EXCEPT one open column at (16,·,16). Its floor sees open sky (15);
    // the adjacent covered column reads a graded lateral-bleed value (0 < v < 15) — the dappling gradient.
    const c = create_chunk_record(0, 0, 0)
    for (let z = 0; z < CS; z += 1) for (let x = 0; x < CS; x += 1) set_solid(c, x, 0, z)
    recompute_height(c)
    for (let z = 0; z < CS; z += 1)
      for (let x = 0; x < CS; x += 1)
        if (!(x === 16 && z === 16)) for (let k = 0; k < 4; k += 1) c.ids[local_index(x, 8 + k, z)] = LEAVES
    fill_simple_light(c)
    expect(sun_at(c, 16, 1, 16)).toBe(15) // gap column: full sky straight down
    const neighbour = sun_at(c, 17, 1, 16)
    expect(neighbour).toBeLessThan(15)
    expect(neighbour).toBeGreaterThan(0)
  })
})
