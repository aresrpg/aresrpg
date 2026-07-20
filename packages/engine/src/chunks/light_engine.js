// Light engine (§3.4 / §5.3) — per-chunk skylight flood-fill (Minecraft sun model). Replaces the
// M0 flat-column stub. Two phases, all integer arithmetic (determinism law §3.7 — no sin/cos/pow/
// random; only Math.max/min/floor):
//
//   1. SKYLIGHT SEED (top-down sweep). `chunk.height[col]` is the first-air world-y from the top of
//      the WHOLE column (sea-floored by both gen callers — column_gen.js / test_gen.js), identical
//      for every stacked `cy`, so it splits the column into the sky-open span (≥height) and the
//      sub-surface span (<height). The ≥height span is swept TOP-DOWN: sun enters at 15 and loses
//      each cell's registry `opacity` on the way down — air (0) is free (open terrain stays 15,
//      byte-identical to the old flat rule), leaves/semi cost their opacity (soft canopy), an opaque
//      stamped cell (snow cap / structure roof) zeroes the column below it (dark floor, re-lit
//      laterally) — UNIVERSAL occupancy occlusion, no per-block-type branch. In the terrain-only
//      core nothing solid sits above height ⇒ the sweep is all-air ⇒ 15 everywhere = the old seed
//      bit-for-bit; occlusion bites only after decoration stamps occluders (world_gen re-lights).
//   2. LATERAL BFS. A 6-neighbour flood from every seed lights the cells the sky can't reach
//      straight down: a step riser's shaded air neighbour, an overhang/cave-mouth gradient, the
//      seabed a shallow column reveals sideways. Moving light INTO a cell subtracts that cell's
//      registry `opacity` as the travel cost (opacity is the documented light-attenuation unit,
//      §3.6): transparent air/foliage (opacity 0) costs 1, water (opacity 2) costs 2, opaque solids
//      (opacity ≥15) are never entered. Descending straight through water therefore yields
//      15,13,11,… = the old `15 − 2×depth` water attenuation, now emergent from the BFS instead of a
//      special case — so shorelines stay lit (surface 13, shallow seabed ≥11) AND the seabed the old
//      rule left pitch-black below a taller neighbour column now fades in gracefully.
//
// CROSS-CHUNK (§5.3, brief §3): the flood runs at GEN time (column_gen.fill_chunk_from_profile /
// test_gen.generate_test_chunk call this on one freshly-filled record, before any neighbour is
// resident and with no NeighborHalos — that contract only exists later, store-side, for the
// mesher). So border cells are seeded from OWN-chunk sky data only. Vertical sky is already
// cross-chunk-correct via the column-global `height` oracle; the unresolved case is LATERAL light
// bleeding ACROSS a horizontal chunk seam into a below-neighbour-height pocket (e.g. an overhang
// straddling two chunks). That refinement is the ring manager's re-light pass job —
// TODO(WS-ring, §5.3): when neighbour records are resident, re-flood border cells seeded from
// neighbour light so a seam-straddling cave lights continuously. Do NOT wire it here (store/ring are
// owned elsewhere); the 1-chunk boundary seam is the documented gap.
//
// block-light (emissive) channel is UNCHANGED — still 0 everywhere (glowstone's `emission_rgb` is
// registered but block-light propagation is a later workstream; §3.4).

import { CHUNK_SIZE } from '../config/world_config.js'
import { get_block_by_id } from '../config/block_registry.js'

import { VOXELS_PER_CHUNK, column_index, local_index, pack_light } from './format.js'

/** @typedef {import('./format.js').ChunkRecord} ChunkRecord */

/** Full sky light (max sun nibble). */
const MAX_LIGHT = 15
/** Voxels one +y step apart in the flat index layout (index = (y*CS + z)*CS + x). */
const Y_STRIDE = CHUNK_SIZE * CHUNK_SIZE

/**
 * Per-block-id opacity, memoised. `opacity` (registry §3.6) is the light-BFS attenuation unit:
 * 0 = transparent (air/foliage), 1..14 = semi-transparent (water is 2), ≥15 = opaque (light can't
 * enter). Cheap per-id memo so the flood doesn't re-hit the registry map tens of thousands of times
 * per chunk.
 * @type {Map<number, number>}
 */
const OPACITY_CACHE = new Map()
/**
 * @param {number} block_id
 * @returns {number} registry opacity (0..15); unknown ids default to opaque (15)
 */
function opacity_of(block_id) {
  const cached = OPACITY_CACHE.get(block_id)
  if (cached !== undefined) return cached
  const def = get_block_by_id(block_id)
  const opacity = def ? def.opacity : MAX_LIGHT
  OPACITY_CACHE.set(block_id, opacity)
  return opacity
}

// Scratch buffers reused across calls — the flood is single-threaded per worker, so one shared set
// avoids re-allocating per chunk (measurable at ring speed). `levels` mirrors the sun nibble during
// the flood; `queue` is a plain grow-only FIFO of pending voxel indices. A cell re-enters only when
// a strictly brighter path reaches it (bounded by the 15-level cap), so the queue is finite; it's
// sized generously and grown on the rare occasion a chunk needs more (kept across calls once grown).
const levels = new Uint8Array(VOXELS_PER_CHUNK)
/** @type {Int32Array} */
let queue = new Int32Array(VOXELS_PER_CHUNK * 2)

/**
 * Fills `chunk.light` with per-chunk skylight via seed + 6-neighbour flood-fill (see file header).
 * Mutates `chunk.light` in place; sun in the high nibble, block-light (always 0) in the low nibble.
 * O(voxels) in practice — every cell settles at its final level after a small constant number of
 * enqueues bounded by the 15-level range.
 * @param {ChunkRecord} chunk
 * @returns {void}
 */
export function fill_simple_light(chunk) {
  const base_world_y = chunk.cy * CHUNK_SIZE
  const { ids } = chunk

  // ALL-AIR FAST PATH (perf / LOD-fill). A chunk with no occupied voxel is pure sky: the phase-1 top-down
  // sweep enqueues all 32768 cells at MAX_LIGHT and phase-2 can raise nothing, so the result is BYTE-
  // IDENTICAL to a full-sky memset (air is the only opacity-0 block ⇒ nothing attenuates ⇒ 15 everywhere).
  // Skipping the ~32k-cell flood turns a sky chunk from ~1.6 ms to ~0.03 ms; the scan early-outs on the
  // first solid so surface/underground chunks pay ~nothing (ids[0] is their floor corner). The live ring
  // loads ~7 all-air chunks per surface column (terrain top ~y160, stack to y383), so this reclaims the
  // bulk of their gen cost — the "LOD takes too long to load" latency — with zero change to goldens or the
  // sun bytes neighbours read across the vertical seam.
  let has_solid = false
  for (let i = 0; i < VOXELS_PER_CHUNK; i += 1)
    if (ids[i] !== 0) {
      has_solid = true
      break
    }
  if (!has_solid) {
    chunk.light.fill(pack_light(MAX_LIGHT, 0))
    return
  }

  levels.fill(0)

  let head = 0
  let tail = 0

  /**
   * Records `sun` at `index` (only if it beats the stored level) and enqueues it as a BFS source,
   * growing the FIFO if it would overflow. Shared by the seed phase and neighbour spreading.
   * @param {number} index flat voxel index
   * @param {number} sun sun level to set (≥1 to be worth enqueuing)
   */
  const enqueue = (index, sun) => {
    if (sun <= levels[index]) return // no improvement
    levels[index] = sun
    if (tail === queue.length) {
      const grown = new Int32Array(queue.length * 2)
      grown.set(queue)
      queue = grown
    }
    queue[tail] = index
    tail += 1
  }

  /**
   * Try to raise a neighbour to `source_level − cost(neighbour)`; enqueue if strictly raised.
   * Opaque neighbours are never entered. Travel cost is the neighbour's opacity, min 1.
   * @param {number} neighbour_index in-range flat voxel index
   * @param {number} source_level popped cell's sun level (≥2)
   */
  const spread = (neighbour_index, source_level) => {
    const neighbour_opacity = opacity_of(ids[neighbour_index])
    if (neighbour_opacity >= MAX_LIGHT) return // opaque terminator — light can't enter
    enqueue(neighbour_index, source_level - Math.max(1, neighbour_opacity))
  }

  // ---- Phase 1: seed skylight per column with a TOP-DOWN sweep, UNIVERSAL occupancy occlusion
  // (same effect in caves or structures via block-to-block raytrace — no
  // per-block-type special case; the SYSTEM attenuates by registry `opacity` DATA, so leaves, snow
  // caps, stamped structures and cave roofs all occlude identically). Two spans, split at the
  // column-global `height` oracle (first-air world-y over the terrain GROUND, sea-floored):
  //
  //   ≥ height (at/above the ground surface — the sky-open span in the terrain-only model). Sun
  //     enters at full sky from the top of the chunk and, descending, LOSES each cell's opacity:
  //     air (opacity 0) is a FREE vertical drop (open terrain stays 15, byte-identical to the old
  //     flat rule), a leaf/semi cell costs its opacity (−2 each ⇒ soft canopy falloff), an OPAQUE
  //     cell (snow cap, structure roof, trunk) drives the running sun to 0 so every cell below it in
  //     the column goes dark and is re-lit only laterally — exactly how a cave roof already shades
  //     the floor beneath it. In the terrain-only core NOTHING solid sits above `height`, so this is
  //     an all-air sweep ⇒ 15 everywhere = the old seed, bit-for-bit; the attenuation only bites once
  //     decoration has STAMPED occluders (world_gen re-lights post-decoration — see world_gen.js).
  //
  //   < height (below the ground surface): water depth attenuation, analytic + cross-chunk-continuous
  //     (a column deeper than one chunk gets the same value in every stacked cy from the column-global
  //     `height`, no neighbour record — nothing solid sits above water so 2·depth is exact). Air
  //     pockets (overhang/cave) stay 0 for the lateral flood. UNCHANGED from the flat-water rule.
  //
  // CROSS-CHUNK VERTICAL SEAM: the sweep restarts at 15 at THIS chunk's top, so a canopy whose upper
  // leaves sit in the cy+1 chunk isn't seen here — only the leaves within this chunk attenuate. The
  // canopy's LOWEST layers sit in the floor's own chunk (leaves rest on the tree), so the floor still
  // darkens; the miss is the underside of the UPPER canopy (a mid-canopy brightness step at the cy
  // seam, hidden in foliage). Full column continuity is the ring re-light pass's job (same class as
  // the lateral seam TODO in the header); do NOT wire neighbour reads here.
  const ATTENUATION_PER_WATER_BLOCK = 2
  for (let z = 0; z < CHUNK_SIZE; z += 1) {
    for (let x = 0; x < CHUNK_SIZE; x += 1) {
      const surface_world_y = chunk.height[column_index(x, z)]
      let sun_level = MAX_LIGHT // full sky at the top of the chunk (cross-chunk seam noted above)
      for (let y = CHUNK_SIZE - 1; y >= 0; y -= 1) {
        const world_y = base_world_y + y
        const index = local_index(x, y, z)
        const cell_opacity = opacity_of(ids[index])
        if (world_y >= surface_world_y) {
          // At/above the ground surface: top-down attenuating sweep through any stamped occluder.
          if (cell_opacity >= MAX_LIGHT) {
            sun_level = 0 // opaque: sky blocked for every cell below in this column
            continue
          }
          if (sun_level > 0) enqueue(index, sun_level)
          sun_level = Math.max(0, sun_level - cell_opacity) // air 0 = free; leaf/semi attenuates
        } else if (cell_opacity > 0 && cell_opacity < MAX_LIGHT) {
          // Below the surface, semi-transparent — water. Depth attenuation from the column height.
          const depth = surface_world_y - world_y // ≥1
          const sun = MAX_LIGHT - ATTENUATION_PER_WATER_BLOCK * depth
          if (sun > 0) enqueue(index, sun)
        }
        // else below the surface: opaque rock (never entered) or transparent air pocket (0, lateral flood).
      }
    }
  }

  // ---- Phase 2: 6-neighbour BFS. Pop a lit cell; try to raise each in-range neighbour. Border
  // neighbours (outside 0..31) are dropped — cross-chunk lateral bleed is the ring re-light pass's
  // job (header TODO), not this per-chunk flood. Fixed neighbour order ⇒ deterministic.
  while (head !== tail) {
    const index = queue[head]
    head += 1
    const level = levels[index]
    if (level <= 1) continue // can't raise any neighbour above 0

    const x = index % CHUNK_SIZE
    const zy = (index - x) / CHUNK_SIZE
    const z = zy % CHUNK_SIZE
    const y = (zy - z) / CHUNK_SIZE

    if (x > 0) spread(index - 1, level)
    if (x < CHUNK_SIZE - 1) spread(index + 1, level)
    if (y > 0) spread(index - Y_STRIDE, level)
    if (y < CHUNK_SIZE - 1) spread(index + Y_STRIDE, level)
    if (z > 0) spread(index - CHUNK_SIZE, level)
    if (z < CHUNK_SIZE - 1) spread(index + CHUNK_SIZE, level)
  }

  // ---- Write levels into the packed light byte (sun high nibble; block-light 0 low nibble).
  const { light } = chunk
  for (let i = 0; i < VOXELS_PER_CHUNK; i += 1) light[i] = pack_light(levels[i], 0)
}
