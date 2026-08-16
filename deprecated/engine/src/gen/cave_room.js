// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// ============================================================================================
// D141 — CAVE DUNGEON ROOM GENERATOR (config-first, deterministic). 2026-07-04.
// ============================================================================================
//
// Builds a single ENCLOSED underground cave room — the surface the dapp's dungeon-fight players
// stare at most — as a set of voxel ChunkRecords, deterministically from (config, seed). It is a
// SERIALIZABLE RECIPE, not a hand-placed one-off: every knob (room dims, ceiling height range,
// ceiling-hole count/size, stalactite density, lava/ravine toggle+width, mushroom cluster count +
// colours, debris/cobweb density, seed) is data in CaveRoomConfig, and the same (config, seed)
// always produces byte-identical chunks (hash the block set to verify — cave_room.test.js).
//
// PROCEDURAL NORTH STAR / integer-hash discipline: ALL placement decisions go through the integer
// hash below (splitmix-lineage, same as chunks/test_gen.js hash_bump + world_config splitmix64).
// NO Math.sin/cos/pow/exp/random anywhere in this file — gen is integer-only so it is portable +
// reproducible. (Visual-only sin/cos is allowed in the RENDER material, never here.)
//
// WHY A STANDALONE CHUNK SET (integration decision, documented per the ticket): the engine's
// ring_manager owns its own private store + drives gen WORKERS for the outdoor world; there is no
// public "write blocks into the world store" seam, and fighting the ring (which would keep
// re-streaming outdoor terrain over the room) is architecturally wrong. So the room is generated
// as a STANDALONE record set on the main thread. The scene wrapper (scene/cave_scene.js) then feeds
// those SAME records to all four consumers, each of which already takes a records/oracle input, so
// NOTHING downstream changes: (1) terrain_renderer.upload_chunk (geometry, via mesh_chunk), (2)
// chunks/light_engine.fill_simple_light (the BFS dark ambience — a genuinely sealed room floods
// dark), (3) atmosphere.set_resident_provider (the froxel god-ray beams read {cx,cy,cz,ids} to
// build their sun-occupancy volume — ceiling holes → cathedral shafts by construction), (4) the
// character controller's make_block_env (collision, wired to this room's own sample_block, NOT
// engine.sample_block). The tactical board uses only scene + camera, so it works unchanged; the
// board mounts at board_anchor (the flat central floor corner).
//
// BOARD CONTRACT: the room DESIGNATES a flat central region big enough for the largest deterministic
// fight grid (D75: up to 17×19 CELLS at the board's 2 m cell size = 34×38 m) PLUS a 1-cell margin
// all round = 40×42 m of dead-flat clear floor. board_anchor = the world pos of that region's min
// corner such that a 17×19 board centres in it (board.js: origin = cell (0,0) min corner, y = floor).

import { CHUNK_SIZE, DEFAULT_CELL_SIZE_HINT } from '../config/world_config.js'
import { column_index, create_chunk_record, local_index, meta_cell_index, set_occupancy_bit } from '../chunks/format.js'
import { get_block_by_name } from '../config/block_registry.js'
import { fill_simple_light } from '../chunks/light_engine.js'

import { place_fixtures } from './cave_fixtures.js'

/** @typedef {import('../chunks/format.js').ChunkRecord} ChunkRecord */

// ---- Block ids (resolved once from the registry — the cave palette) --------------------------
const AIR = 0
const CAVE_STONE = id_of('cave_stone')
const MOSSY_STONE = id_of('mossy_stone')
const MUSHROOM_STEM = id_of('mushroom_stem')
const LAVA = id_of('lava')
const COBWEB = id_of('cobweb')
const BONES = id_of('bones')
const CAVE_SHROOM = id_of('cave_shroom')
/** The three emissive giant-cap block ids, indexed by a cluster's colour choice. */
const CAP_IDS = [id_of('mushroom_cap_azure'), id_of('mushroom_cap_teal'), id_of('mushroom_cap_amber')]

/** @param {string} name @returns {number} */
function id_of(name) {
  const def = get_block_by_name(name)
  if (!def) throw new Error(`cave_room: block "${name}" missing from registry`)
  return def.id
}

// ---- Board sizing (the flat-region contract) -------------------------------------------------
/** Board cell size in blocks (metres) — the ENG-16 tactical board's 2×2 cells. Mirrors board.js
 *  DEFAULT_CELL_SIZE without importing the render module into gen. */
const BOARD_CELL_M = DEFAULT_CELL_SIZE_HINT
/** Largest deterministic fight-grid dims in CELLS (D75 / fight_grid.js MAX side, 17×19) the flat
 *  region must contain = 34 × 38 m board footprint. */
const BOARD_MAX_CELLS_X = 17
const BOARD_MAX_CELLS_Z = 19
/** Required flat clear floor, in blocks. A ≥1-cell margin all round the max board (coordinator D75
 *  build correction, 2026-07-04): board 34×38 m + margin ⇒ ≥ 40 × 42 m of dead-flat floor. X rounded
 *  up to 40 (a full extra cell of side clearance beyond the strict 38) for the coordinator's safety
 *  floor; Z = 42 (exactly 1-cell margin). A 17×19 board centres in this region at board_anchor. */
export const FLAT_REGION_X = 40
export const FLAT_REGION_Z = 42

// ---- Config schema ---------------------------------------------------------------------------
/**
 * @typedef {object} CaveRoomConfig  A fully serializable cave recipe. Every field has a default
 *   (DEFAULT_CAVE_CONFIG); pass a partial to override. Deterministic with `seed`.
 * @property {number} size_x room interior width in blocks (X). Default 56 — must be ≥ FLAT_REGION_X
 *   + wall thickness so the flat board region fits with irregular cave edges around it.
 * @property {number} size_z room interior depth in blocks (Z). Default 56 — ≥ FLAT_REGION_Z + walls.
 * @property {number} floor_y world-y of the walkable floor top face (the flat plane the board sits on).
 * @property {number} ceiling_min minimum ceiling height above the floor (blocks). The domed ceiling
 *   undulates between ceiling_min and ceiling_max via the integer hash.
 * @property {number} ceiling_max maximum ceiling height above the floor (blocks).
 * @property {number} wall_thickness solid rock shell thickness around the interior (blocks) — the
 *   room is carved out of a solid block so it is genuinely sealed (dark BFS + froxel enclosure).
 * @property {number} hole_count number of holes cut through the ceiling for sun shafts.
 * @property {number} hole_radius approximate radius of each ceiling hole (blocks).
 * @property {number} stalactite_density 0..1 — fraction of ceiling columns that grow a stalactite
 *   (and matching stalagmite chance on the floor below).
 * @property {boolean} lava_enabled whether a lava ravine is carved into the floor.
 * @property {number} ravine_width lava ravine width in blocks (only when lava_enabled).
 * @property {number} mushroom_clusters number of giant glow-mushroom clusters placed on the floor.
 * @property {readonly number[]} mushroom_palette allowed cap colour indices (0=azure,1=teal,2=amber);
 *   each cluster picks one deterministically from this list.
 * @property {number} wall_wobble_amp [D213] max blocks each wall erodes inward (organic cavern walls).
 * @property {number} corner_round [D213] corner chamfer radius (blocks) — kills the box corners.
 * @property {number} pillar_density [D213] 0..1 fraction of columns growing floor-to-ceiling pillars.
 * @property {number} floor_relief [D213] 0..1 fraction of off-board floor cells raised +1 (undulation).
 * @property {number} debris_density 0..1 — floor scatter (bones, mossy rubble, small ground shrooms).
 * @property {number} cobweb_density 0..1 — ceiling/corner cobweb scatter.
 * @property {number} seed integer seed folded into every placement hash (per-room variety).
 */

/** @type {Readonly<CaveRoomConfig>} */
export const DEFAULT_CAVE_CONFIG = Object.freeze({
  size_x: 56,
  size_z: 56,
  // [D213 — the room must read as an organic cave, not a boxy interior] organic-interior knobs:
  wall_wobble_amp: 4, // max blocks each wall erodes/bulges inward (coherent noise along the wall)
  corner_round: 7, // corner chamfer radius (blocks) — kills the box corners
  pillar_density: 0.006, // fraction of interior columns growing a floor-to-ceiling rock pillar
  floor_relief: 0.12, // fraction of off-board floor cells raised +1 (subtle walkable undulation)
  floor_y: 64,
  ceiling_min: 16,
  ceiling_max: 27,
  wall_thickness: 3,
  hole_count: 4,
  hole_radius: 3,
  stalactite_density: 0.14,
  lava_enabled: true,
  ravine_width: 6,
  mushroom_clusters: 5,
  mushroom_palette: Object.freeze([0, 1, 2]),
  debris_density: 0.06,
  cobweb_density: 0.05,
  seed: 1,
})

/**
 * Validates + fills a partial config against the defaults. Throws on values that would break the
 * board contract or produce a degenerate room (fail loud at construction — a silent bad room is worse
 * than a crash the harness surfaces). Returns a fully-populated, frozen config.
 * @param {Partial<CaveRoomConfig>} [partial]
 * @returns {Readonly<CaveRoomConfig>}
 */
export function resolve_cave_config(partial = {}) {
  const c = { ...DEFAULT_CAVE_CONFIG, ...partial }
  const int = (/** @type {string} */ k) => {
    if (!Number.isFinite(/** @type {any} */ (c)[k])) throw new Error(`cave_room config: ${k} must be a finite number`)
  }
  for (const k of [
    'size_x',
    'size_z',
    'floor_y',
    'ceiling_min',
    'ceiling_max',
    'wall_thickness',
    'hole_count',
    'hole_radius',
    'ravine_width',
    'mushroom_clusters',
    'seed',
    'wall_wobble_amp',
    'corner_round',
  ])
    int(k)
  // The flat board region must physically fit inside the interior with room to spare for irregular
  // cave walls (half a wall-thickness of jitter each side). This is the load-bearing board invariant.
  if (c.size_x < FLAT_REGION_X + 2 * c.wall_thickness)
    throw new Error(
      `cave_room config: size_x ${c.size_x} too small — need ≥ ${FLAT_REGION_X + 2 * c.wall_thickness} to seat the ${FLAT_REGION_X}m flat board region`
    )
  if (c.size_z < FLAT_REGION_Z + 2 * c.wall_thickness)
    throw new Error(
      `cave_room config: size_z ${c.size_z} too small — need ≥ ${FLAT_REGION_Z + 2 * c.wall_thickness} to seat the ${FLAT_REGION_Z}m flat board region`
    )
  if (c.ceiling_max < c.ceiling_min) throw new Error('cave_room config: ceiling_max < ceiling_min')
  if (c.ceiling_min < 8) throw new Error('cave_room config: ceiling_min must be ≥ 8 (headroom + shaft path)')
  if (c.floor_y < 4) throw new Error('cave_room config: floor_y must be ≥ 4')
  for (const p of c.mushroom_palette)
    if (p < 0 || p >= CAP_IDS.length)
      throw new Error(`cave_room config: mushroom_palette index ${p} out of range 0..${CAP_IDS.length - 1}`)
  return Object.freeze({ ...c, mushroom_palette: Object.freeze([...c.mushroom_palette]) })
}

// ---- Deterministic integer hash (splitmix-lineage; NO transcendentals) -----------------------
const U32 = 0xffffffff
/**
 * 3-D integer hash → uint32, seed-folded. Pure multiply/xor/shift on 32-bit unsigned ints (the GPU
 * twin of Math.imul, wrapping mod 2^32). Same family as test_gen.hash_bump, extended to 3 coords +
 * a salt so different placement passes (holes vs stalactites vs debris) decorrelate. @param {number} x
 * @param {number} y @param {number} z @param {number} salt @param {number} seed @returns {number} uint32
 */
function hash3(x, y, z, salt, seed) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263)) & U32
  h = (h + Math.imul(z | 0, 2147483647)) & U32
  h = (h ^ (salt | 0) ^ Math.imul(seed | 0, 1013904223)) & U32
  h = Math.imul(h ^ (h >>> 13), 1274126177) & U32
  return (h ^ (h >>> 16)) >>> 0
}
/** Hash → float in [0,1). @param {number} x @param {number} y @param {number} z @param {number} salt
 *  @param {number} seed @returns {number} */
function rand01(x, y, z, salt, seed) {
  return hash3(x, y, z, salt, seed) / 4294967296
}

// ---- The generated room (result of a gen pass) ----------------------------------------------
/**
 * @typedef {object} CaveRoom  Pure gen output — no engine/three, no rendering.
 * @property {Readonly<CaveRoomConfig>} config the resolved config that produced this room.
 * @property {Map<string, ChunkRecord>} chunks coord_key "cx,cy,cz" → lit ChunkRecord covering the room.
 * @property {[number, number, number]} board_anchor world pos of the flat region's min corner (board.js
 *   origin: cell (0,0) min corner; y = floor top). A 17×19 board centres in the flat region here.
 * @property {[number, number, number]} mob_spawn centred, combat-accessible mob placement (world, feet).
 * @property {[number, number, number]} player_spawn a clear floor stand inside the room (world, feet).
 * @property {{ min_x: number, min_z: number, max_x: number, max_z: number, floor_y: number, ceiling_y: number }}
 *   bounds the invisible-barrier extents (interior walkable box) the controller soft-clamps against.
 * @property {(wx: number, wy: number, wz: number) => number} sample_block world-voxel block id from the
 *   room's own records (0 air outside the room) — the controller's collision oracle for this room.
 * @property {import('./cave_fixtures.js').CaveFixture[]} fixtures deterministic ambience-prop ANCHORS (bonfire
 *   braziers + candle torches) for the render wrapper to mount FlameFX LOOP VFX at — pure data (no three;
 *   placement lives in cave_fixtures.js, the scene wrapper owns the mount).
 */

/**
 * Generates the cave room deterministically. Pure: reads only (config, seed); no globals, no engine.
 * The room's interior min corner is world (0, floor_y, 0); it extends to (size_x, ·, size_z). The board
 * flat region is centred on the interior. Chunks are allocated on demand as blocks are written, then lit.
 * @param {object} args
 * @param {Partial<CaveRoomConfig>} [args.config] partial recipe (merged over DEFAULT_CAVE_CONFIG).
 * @param {number} [args.seed] convenience override of config.seed.
 * @returns {CaveRoom}
 */
export function generate_cave_room({ config: partial = {}, seed } = {}) {
  const config = resolve_cave_config(seed === undefined ? partial : { ...partial, seed })
  const { size_x, size_z, floor_y, wall_thickness: wt, seed: S } = config

  /** @type {Map<string, ChunkRecord>} */
  const chunks = new Map()
  /** Fetch-or-create the chunk owning world voxel (wx,wy,wz). @returns {ChunkRecord} */
  const chunk_at = (/** @type {number} */ wx, /** @type {number} */ wy, /** @type {number} */ wz) => {
    const cx = Math.floor(wx / CHUNK_SIZE)
    const cy = Math.floor(wy / CHUNK_SIZE)
    const cz = Math.floor(wz / CHUNK_SIZE)
    const key = `${cx},${cy},${cz}`
    let rec = chunks.get(key)
    if (!rec) {
      rec = create_chunk_record(cx, cy, cz)
      chunks.set(key, rec)
    }
    return rec
  }
  /** Write a block at a WORLD voxel, updating occupancy (solids only — the mesher's cull pass reads
   *  the occupancy bitmask) + the column height oracle (light BFS boundary). Cross/foliage carry no
   *  occupancy bit (walk-through, non-occluding), matching the mesher's contract. */
  const set_block = (
    /** @type {number} */ wx,
    /** @type {number} */ wy,
    /** @type {number} */ wz,
    /** @type {number} */ id
  ) => {
    const rec = chunk_at(wx, wy, wz)
    const lx = wx - rec.cx * CHUNK_SIZE
    const ly = wy - rec.cy * CHUNK_SIZE
    const lz = wz - rec.cz * CHUNK_SIZE
    rec.ids[local_index(lx, ly, lz)] = id
    if (is_solid_id(id)) {
      set_occupancy_bit(rec, 0, ly * CHUNK_SIZE + lz, lx, true)
      set_occupancy_bit(rec, 1, lx * CHUNK_SIZE + lz, ly, true)
      set_occupancy_bit(rec, 2, lx * CHUNK_SIZE + ly, lz, true)
    }
    // biome cell — 0 everywhere (single cave biome); harmless but keeps records well-formed.
    rec.biome[meta_cell_index((lx >> 2) & 7, (ly >> 2) & 7, (lz >> 2) & 7)] = 0
  }

  // Interior spans world x∈[0,size_x), z∈[0,size_z). Ceiling height per column (domed undulation).
  const ceil_top_at = make_ceiling_field(config)
  const ceiling_peak = floor_y + config.ceiling_max // topmost solid ceiling y across the room

  // ---------------------------------------------------------------------------------------------
  // PASS 1 — SHELL: solid rock everywhere in the bounding box, then carve the interior air pocket.
  // Building solid-first then subtracting guarantees a genuinely SEALED room (no stray sky columns):
  // every interior cell is enclosed by rock on all six sides except the deliberate ceiling holes.
  // ---------------------------------------------------------------------------------------------
  const box_min_x = -wt
  const box_max_x = size_x + wt // exclusive
  const box_min_z = -wt
  const box_max_z = size_z + wt
  const floor_base = floor_y - wt // bottom of the floor slab (solid down to here)

  const hole_field = make_hole_field(config) // (wx,wz) → true if a ceiling hole passes here
  // [D213] ORGANIC INTERIOR: each wall erodes inward by a coherent-noise inset (alcoves + bulges) and
  // the four corners chamfer off — the rectangle becomes a cavern. The flat BOARD region is always
  // kept interior (fights never lose floor).
  const flat_r = flat_region(config)
  const amp = config.wall_wobble_amp
  const cr = config.corner_round
  const inset_w = /** @param {number} t @param {number} salt */ (t, salt) =>
    Math.round(coherent_hash01(0, t, 7, salt, config.seed) * amp)
  const organic_interior = /** @param {number} wx @param {number} wz */ (wx, wz) => {
    if (wx < 0 || wx >= size_x || wz < 0 || wz >= size_z) return false
    if (in_flat(flat_r, wx, wz)) return true // the board floor is sacred
    const dW = wx
    const dE = size_x - 1 - wx
    const dN = wz
    const dS = size_z - 1 - wz
    if (dW < inset_w(wz, 0xa1) || dE < inset_w(wz, 0xa2) || dN < inset_w(wx, 0xa3) || dS < inset_w(wx, 0xa4))
      return false
    // corner chamfer (wobbled radius) — Manhattan cut reads as a rounded cavern corner in voxels.
    const cw = cr + Math.round((coherent_hash01(wx, wz, 9, 0xa5, config.seed) - 0.5) * 4)
    if (dW + dN < cw || dW + dS < cw || dE + dN < cw || dE + dS < cw) return false
    return true
  }
  const cy_lo = Math.floor(floor_base / CHUNK_SIZE)
  const cy_hi = Math.floor(ceiling_peak / CHUNK_SIZE)

  for (let wx = box_min_x; wx < box_max_x; wx += 1) {
    for (let wz = box_min_z; wz < box_max_z; wz += 1) {
      const interior = organic_interior(wx, wz)
      const ceil_top = interior ? ceil_top_at(wx, wz) : ceiling_peak
      // The column's first-air-from-top oracle for the light BFS. For a HOLE column the sky reaches
      // the floor (open shaft) → height = floor_y; else the sky is blocked by the ceiling → the
      // column is dark below the ceiling, so height sits at the ceiling top (skylight seeds there and
      // the enclosed interior floods dark via the BFS — exactly the atmosphere we want).
      const holed = interior && hole_field(wx, wz)
      const first_air_y = holed ? floor_y : ceil_top + 1

      for (let wy = floor_base; wy <= ceiling_peak; wy += 1) {
        let id = CAVE_STONE // default: solid shell
        if (interior) {
          const in_floor = wy < floor_y
          const in_ceiling = wy > ceil_top
          // [D213] subtle floor relief OUTSIDE the board: some cells rise +1 (a walkable step) —
          // undulation, never a hole (raised = MORE solid; the seal invariant is untouched).
          const raised = !in_flat(flat_r, wx, wz) && coherent_hash01(wx, wz, 5, 0xf1, config.seed) < config.floor_relief
          if (!in_floor && !in_ceiling) {
            if (raised && wy === floor_y)
              id = floor_surface_id(config, wx, wz) // the step top
            else id = AIR // the open interior
          } else if (in_ceiling && holed && column_hole_open(config, wx, wz, wy))
            id = AIR // sun shaft
          else if (in_floor && wy === floor_y - 1) id = floor_surface_id(config, wx, wz) // floor top
        }
        if (id !== AIR) set_block(wx, wy, wz, id)
      }
      // record the column height oracle on the owning chunks (all vertical chunks of this column
      // share it; write it wherever a chunk exists for this column across the y stack).
      set_column_height(chunks, wx, wz, first_air_y, cy_lo, cy_hi)
    }
  }

  // ---------------------------------------------------------------------------------------------
  // PASS 2 — LAVA RAVINE (optional): carve a glowing channel into the floor (D213: always lava-filled).
  // ---------------------------------------------------------------------------------------------
  if (config.lava_enabled) carve_lava_ravine(config, set_block)

  // ---------------------------------------------------------------------------------------------
  // PASS 3 — STALACTITES / STALAGMITES: hanging + rising rock spikes, density-gated, tapered.
  // ---------------------------------------------------------------------------------------------
  place_stalactites(config, ceil_top_at, set_block)

  // ---------------------------------------------------------------------------------------------
  // PASS 3.5 — [D213] ROCK PILLARS: floor-to-ceiling columns (2×2-ish, hash-gated, off-board) — the
  // load-bearing bones that make the space read as a CAVERN instead of a room.
  // ---------------------------------------------------------------------------------------------
  {
    const flat = flat_region(config)
    for (let wx = 4; wx < size_x - 4; wx += 1) {
      for (let wz = 4; wz < size_z - 4; wz += 1) {
        // the 2×2 trunk must clear the board ENTIRELY (a seed on the edge would grow into it)
        if (
          in_flat(flat, wx, wz) ||
          in_flat(flat, wx + 1, wz) ||
          in_flat(flat, wx, wz + 1) ||
          in_flat(flat, wx + 1, wz + 1)
        )
          continue
        if (rand01(wx, 7, wz, 0xb7, config.seed) >= config.pillar_density) continue
        const top = ceil_top_at(wx, wz)
        // a 2×2 trunk with a hash-jittered bulge base/cap (reads as a natural column)
        for (let dx = 0; dx <= 1; dx += 1) {
          for (let dz = 0; dz <= 1; dz += 1) {
            for (let wy = floor_y; wy <= top; wy += 1) set_block(wx + dx, wy, wz + dz, CAVE_STONE)
          }
        }
      }
    }
  }

  // ---------------------------------------------------------------------------------------------
  // PASS 4 — GLOW-MUSHROOM CLUSTERS: giant emissive caps on fibrous stems, placed OUTSIDE the flat
  // board region (they are obstacles) around the room's edges, with a ground-shroom carpet at the base.
  // ---------------------------------------------------------------------------------------------
  const flat = flat_region(config)
  place_mushroom_clusters(config, flat, set_block)

  // ---------------------------------------------------------------------------------------------
  // PASS 4.5 — AMBIENCE-PROP FIXTURES (WORLD-PROPS d_world lane): deterministic bonfire + candle ANCHORS the
  // scene wrapper mounts FlameFX LOOP VFX at. Pure DATA (no three here — gen stays pure/integer-only); placed in
  // the perimeter band between the flat board region and the walls so a fixture never sits under a fight.
  // ---------------------------------------------------------------------------------------------
  const fixtures = place_fixtures(config, flat)

  // ---------------------------------------------------------------------------------------------
  // PASS 5 — DEBRIS + COBWEBS: floor scatter (bones, ground shrooms, mossy rubble) and ceiling/corner
  // cobwebs. All cross/foliage or non-occluding — never inside the flat board region's clear floor.
  // ---------------------------------------------------------------------------------------------
  scatter_debris(config, flat, ceil_top_at, set_block)

  // ---- Light every chunk (skylight seed + BFS). A sealed interior floods dark; hole columns admit
  //      shafts of skylight to the floor. Emissive block glow is material-side (emissiveNode), not here.
  for (const rec of chunks.values()) fill_simple_light(rec)

  // ---- Anchors + bounds ------------------------------------------------------------------------
  // board_anchor = the world min-corner of cell (0,0) of a MAX (17×19-cell = 34×38 m) board CENTRED
  // in the 40×42 m flat region (board.js: origin = cell (0,0) min corner, y = floor top). A smaller
  // board (the common case — grids are 10..17 wide) still centres fine; the anchor pins the max case.
  const board_w_m = BOARD_MAX_CELLS_X * BOARD_CELL_M // 34
  const board_h_m = BOARD_MAX_CELLS_Z * BOARD_CELL_M // 38
  const board_anchor = /** @type {[number, number, number]} */ ([
    flat.min_x + Math.round((FLAT_REGION_X - board_w_m) / 2),
    floor_y,
    flat.min_z + Math.round((FLAT_REGION_Z - board_h_m) / 2),
  ])
  const cx = size_x / 2
  const cz = size_z / 2
  const mob_spawn = /** @type {[number, number, number]} */ ([cx, floor_y, cz - FLAT_REGION_Z / 2 + 4])
  const player_spawn = /** @type {[number, number, number]} */ ([cx, floor_y, cz + FLAT_REGION_Z / 2 - 4])
  const bounds = {
    min_x: 0.5,
    min_z: 0.5,
    max_x: size_x - 0.5,
    max_z: size_z - 0.5,
    floor_y,
    ceiling_y: ceiling_peak,
  }

  const sample_block = (/** @type {number} */ wx, /** @type {number} */ wy, /** @type {number} */ wz) => {
    // [D232 cto belt, ratified] VIRTUAL BEDROCK: the meshed floor is a wall_thickness-deep slab over
    // nothing — below it the PURE sampler answers solid rock forever (inside the footprint), so any
    // future descent past the slab (new carve pass, physics bug, teleport) lands instead of free-
    // falling. Never rendered (no chunk record), collision-only, byte-identical visuals.
    if (wy < config.floor_y - config.wall_thickness && wx >= 0 && wx < config.size_x && wz >= 0 && wz < config.size_z) {
      return CAVE_STONE
    }
    const rec = chunks.get(
      `${Math.floor(wx / CHUNK_SIZE)},${Math.floor(wy / CHUNK_SIZE)},${Math.floor(wz / CHUNK_SIZE)}`
    )
    if (!rec) return AIR
    const lx = Math.floor(wx) - rec.cx * CHUNK_SIZE
    const ly = Math.floor(wy) - rec.cy * CHUNK_SIZE
    const lz = Math.floor(wz) - rec.cz * CHUNK_SIZE
    if (lx < 0 || ly < 0 || lz < 0 || lx >= CHUNK_SIZE || ly >= CHUNK_SIZE || lz >= CHUNK_SIZE) return AIR
    return rec.ids[local_index(lx, ly, lz)]
  }

  return { config, chunks, board_anchor, mob_spawn, player_spawn, bounds, sample_block, fixtures }
}

// ---- Solidity (mirrors the mesher/collision registry class, resolved once) -------------------
/** Block ids that are solid-class (occlude + collide). Built from the cave palette we author. */
const SOLID_IDS = new Set([CAVE_STONE, MOSSY_STONE, MUSHROOM_STEM, LAVA, ...CAP_IDS])
/** @param {number} id @returns {boolean} */
function is_solid_id(id) {
  return SOLID_IDS.has(id)
}

// ---- Field builders (all integer-hash; NO transcendentals) -----------------------------------
/**
 * Domed ceiling top-y field: undulates between floor_y+ceiling_min and floor_y+ceiling_max with a
 * coherent low-frequency integer hash (bilinear over 8-block cells, like test_gen.coherent_bump) so
 * the ceiling reads as a rolling cavern roof, not per-column noise. @param {Readonly<CaveRoomConfig>} c
 * @returns {(wx: number, wz: number) => number}
 */
function make_ceiling_field(c) {
  const span = c.ceiling_max - c.ceiling_min
  const CELL = 8
  return (/** @type {number} */ wx, /** @type {number} */ wz) => {
    const h = coherent_hash01(wx, wz, CELL, 0x51, c.seed)
    return c.floor_y + c.ceiling_min + Math.round(h * span)
  }
}

/**
 * Ceiling-hole membership: places `hole_count` holes at deterministic positions and returns whether a
 * column (wx,wz) lies within any hole disc (radius jittered per hole). Holes are placed UNIFORMLY across
 * the interior (each inside a hole_radius+2 margin off the walls so no shaft clips the rock shell); a
 * shaft may therefore fall anywhere, including over the board — which is the intended cathedral look
 * (daylight raking across the fight). @param {Readonly<CaveRoomConfig>} c
 * @returns {(wx: number, wz: number) => boolean}
 */
function make_hole_field(c) {
  /** @type {{ x: number, z: number, r2: number }[]} */
  const holes = []
  for (let i = 0; i < c.hole_count; i += 1) {
    // Uniform placement inside the interior margin: hash the hole index → an (x,z) cell, kept a
    // hole_radius+2 margin off every wall so the full disc stays inside the rock shell (no clipped shaft).
    const margin = c.hole_radius + 2
    const hx = margin + (hash3(i, 0, 0, 0x9a1, c.seed) % Math.max(1, c.size_x - 2 * margin))
    const hz = margin + (hash3(0, 0, i, 0x9a2, c.seed) % Math.max(1, c.size_z - 2 * margin))
    const r = c.hole_radius + (hash3(i, i, i, 0x9a3, c.seed) % 2) // ±0..1 jitter
    holes.push({ x: hx, z: hz, r2: r * r })
  }
  return (/** @type {number} */ wx, /** @type {number} */ wz) => {
    for (const h of holes) {
      const dx = wx - h.x
      const dz = wz - h.z
      if (dx * dx + dz * dz <= h.r2) return true
    }
    return false
  }
}

/** Whether a ceiling cell in a hole column is actually open (the disc is full-height through the
 *  roof — a clean vertical shaft). Kept a separate predicate so a future recipe could taper holes.
 *  @param {Readonly<CaveRoomConfig>} _c @param {number} _wx @param {number} _wz @param {number} _wy */
function column_hole_open(_c, _wx, _wz, _wy) {
  return true
}

/** Floor surface block id at a column: mostly cave_stone, mossy patches via a coherent hash so moss
 *  clumps rather than salt-and-peppers. @param {Readonly<CaveRoomConfig>} c @param {number} wx @param {number} wz */
function floor_surface_id(c, wx, wz) {
  return coherent_hash01(wx, wz, 6, 0x30, c.seed) > 0.72 ? MOSSY_STONE : CAVE_STONE
}

/** The flat board region rectangle (world), centred on the interior. Its clear floor is guaranteed
 *  obstacle-free (décor passes exclude it). @param {Readonly<CaveRoomConfig>} c */
function flat_region(c) {
  const min_x = Math.round((c.size_x - FLAT_REGION_X) / 2)
  const min_z = Math.round((c.size_z - FLAT_REGION_Z) / 2)
  return { min_x, min_z, max_x: min_x + FLAT_REGION_X, max_z: min_z + FLAT_REGION_Z }
}
/** @param {{min_x:number,min_z:number,max_x:number,max_z:number}} f @param {number} wx @param {number} wz */
function in_flat(f, wx, wz) {
  return wx >= f.min_x && wx < f.max_x && wz >= f.min_z && wz < f.max_z
}

// ---- Décor passes ----------------------------------------------------------------------------
/** Carves a lava ravine: a chasm slot through the floor (biased to one side, away from board centre)
 *  with an emissive lava bed at the bottom. @param {Readonly<CaveRoomConfig>} c
 *  @param {(wx:number,wy:number,wz:number,id:number)=>void} set_block */
function carve_lava_ravine(c, set_block) {
  const flat = flat_region(c)
  // Run the ravine along Z near the -X interior wall, clear of the flat board region.
  const cx = Math.max(2, Math.round(flat.min_x / 2))
  const half = Math.floor(c.ravine_width / 2)
  const depth = 4
  for (let wz = 2; wz < c.size_z - 2; wz += 1) {
    // wobble the ravine centre with a coherent hash so it snakes (no trig).
    const wob = Math.round((coherent_hash01(0, wz, 6, 0x77, c.seed) - 0.5) * 4)
    const centre = cx + wob
    for (let d = -half; d <= half; d += 1) {
      const wx = centre + d
      if (wx < 2 || wx >= c.size_x - 2) continue
      if (in_flat(flat, wx, wz)) continue // never breach the board floor
      // [D213 — floor channels must never expose a hidden fall-through pit] the channel is LAVA-FILLED to one block
      // below the walkable floor: a recessed glowing river you can SEE and step across — a 1-block
      // lip, never a hidden 3-deep pit. (Lava is the emissive SOLID, so it also carries collision.)
      for (let wy = c.floor_y - 1; wy > c.floor_y - 1 - depth; wy -= 1) {
        set_block(wx, wy, wz, wy === c.floor_y - 1 ? AIR : LAVA)
      }
    }
  }
}

/** Places tapered stalactites (ceiling→down) and occasional stalagmites (floor→up) at density-gated
 *  columns, never inside the flat board region. @param {Readonly<CaveRoomConfig>} c
 *  @param {(wx:number,wz:number)=>number} ceil_top_at @param {(wx:number,wy:number,wz:number,id:number)=>void} set_block */
function place_stalactites(c, ceil_top_at, set_block) {
  const flat = flat_region(c)
  const thresh = c.stalactite_density
  for (let wx = 1; wx < c.size_x - 1; wx += 1) {
    for (let wz = 1; wz < c.size_z - 1; wz += 1) {
      if (in_flat(flat, wx, wz)) continue
      if (rand01(wx, 0, wz, STAL_SALT, c.seed) >= thresh) continue
      const ceil = ceil_top_at(wx, wz)
      const len = 2 + (hash3(wx, 1, wz, 0xc10, c.seed) % 4) // 2..5 blocks
      // tapered: full width at the ceiling, narrowing — MVP: a single column spike (cheap, reads well).
      for (let k = 1; k <= len; k += 1) set_block(wx, ceil - k, wz, CAVE_STONE)
      // occasional matching stalagmite rising from the floor below (rarer, shorter).
      if (hash3(wx, 2, wz, 0xc11, c.seed) % 5 === 0) {
        const up = 1 + (hash3(wx, 3, wz, 0xc12, c.seed) % 3)
        for (let k = 0; k < up; k += 1) set_block(wx, c.floor_y + k, wz, CAVE_STONE)
      }
    }
  }
}

/** Places giant glow-mushroom clusters: an emissive cap dome atop a fibrous stem, ringed by a
 *  ground-shroom carpet. Clusters sit OUTSIDE the flat board region (obstacles) but inside the room.
 *  @param {Readonly<CaveRoomConfig>} c @param {{min_x:number,min_z:number,max_x:number,max_z:number}} flat
 *  @param {(wx:number,wy:number,wz:number,id:number)=>void} set_block */
function place_mushroom_clusters(c, flat, set_block) {
  const placed = /** @type {[number, number][]} */ ([])
  let attempts = 0
  for (let i = 0; i < c.mushroom_clusters && attempts < c.mushroom_clusters * 12;) {
    attempts += 1
    const margin = 5
    const wx = margin + (hash3(i, attempts, 0, 0xd01, c.seed) % Math.max(1, c.size_x - 2 * margin))
    const wz = margin + (hash3(0, attempts, i, 0xd02, c.seed) % Math.max(1, c.size_z - 2 * margin))
    if (in_flat(flat, wx, wz)) continue // keep the board floor clear
    if (placed.some(([px, pz]) => Math.abs(px - wx) < 7 && Math.abs(pz - wz) < 7)) continue // spacing
    placed.push([wx, wz])
    i += 1
    const cap_id = CAP_IDS[c.mushroom_palette[hash3(wx, 0, wz, 0xd03, c.seed) % c.mushroom_palette.length]]
    const stem_h = 3 + (hash3(wx, 4, wz, 0xd04, c.seed) % 3) // 3..5
    const cap_r = 2 + (hash3(wx, 5, wz, 0xd05, c.seed) % 2) // 2..3
    // stem
    for (let k = 0; k < stem_h; k += 1) set_block(wx, c.floor_y + k, wz, MUSHROOM_STEM)
    // cap: a squashed dome of emissive blocks at the stem top (radius cap_r, 2 layers).
    const top = c.floor_y + stem_h
    for (let layer = 0; layer < 2; layer += 1) {
      const r = cap_r - layer
      for (let dx = -r; dx <= r; dx += 1)
        for (let dz = -r; dz <= r; dz += 1)
          if (dx * dx + dz * dz <= r * r) set_block(wx + dx, top + layer, wz + dz, cap_id)
    }
    // ground-shroom carpet around the base (small emissive cross foliage)
    for (let dx = -cap_r - 1; dx <= cap_r + 1; dx += 1)
      for (let dz = -cap_r - 1; dz <= cap_r + 1; dz += 1) {
        const gx = wx + dx
        const gz = wz + dz
        if (in_flat(flat, gx, gz)) continue
        if (rand01(gx, 6, gz, 0xd06, c.seed) < 0.28) set_block(gx, c.floor_y, gz, CAVE_SHROOM)
      }
  }
}

/** Scatters floor debris (bones, ground shrooms, mossy rubble) and ceiling/corner cobwebs — all
 *  non-occluding cross/foliage or emissive accents, never inside the flat board region.
 *  @param {Readonly<CaveRoomConfig>} c @param {{min_x:number,min_z:number,max_x:number,max_z:number}} flat
 *  @param {(wx:number,wz:number)=>number} ceil_top_at @param {(wx:number,wy:number,wz:number,id:number)=>void} set_block */
function scatter_debris(c, flat, ceil_top_at, set_block) {
  for (let wx = 1; wx < c.size_x - 1; wx += 1) {
    for (let wz = 1; wz < c.size_z - 1; wz += 1) {
      // floor debris (allowed near the flat edge but not on the clear board floor)
      if (!in_flat(flat, wx, wz) && rand01(wx, 10, wz, 0xe01, c.seed) < c.debris_density) {
        const roll = hash3(wx, 11, wz, 0xe02, c.seed) % 3
        set_block(wx, c.floor_y, wz, roll === 0 ? BONES : CAVE_SHROOM)
      }
      // cobwebs hang just below the ceiling, biased to corners (near walls) — cross foliage, drift.
      const near_wall = wx < 4 || wz < 4 || wx >= c.size_x - 4 || wz >= c.size_z - 4
      if (near_wall && rand01(wx, 20, wz, 0xe03, c.seed) < c.cobweb_density * 2) {
        const cy = ceil_top_at(wx, wz) - 1
        set_block(wx, cy, wz, COBWEB)
      } else if (rand01(wx, 21, wz, 0xe04, c.seed) < c.cobweb_density * 0.4) {
        const cy = ceil_top_at(wx, wz) - 1
        set_block(wx, cy, wz, COBWEB)
      }
    }
  }
}

/** Salt constant for the stalactite density roll. */
const STAL_SALT = 0xc00

// ---- Small integer helpers -------------------------------------------------------------------
/** Coherent low-frequency hash in [0,1) — bilinear blend of per-CELL hash corners (integer, like
 *  test_gen.coherent_bump) so a field reads smooth, not per-cell noise. @param {number} wx @param {number} wz
 *  @param {number} cell @param {number} salt @param {number} seed @returns {number} */
function coherent_hash01(wx, wz, cell, salt, seed) {
  const cx = Math.floor(wx / cell)
  const cz = Math.floor(wz / cell)
  const fx = (wx - cx * cell) / cell
  const fz = (wz - cz * cell) / cell
  const c00 = hash3(cx, 0, cz, salt, seed) / 4294967296
  const c10 = hash3(cx + 1, 0, cz, salt, seed) / 4294967296
  const c01 = hash3(cx, 0, cz + 1, salt, seed) / 4294967296
  const c11 = hash3(cx + 1, 0, cz + 1, salt, seed) / 4294967296
  const top = c00 * (1 - fx) + c10 * fx
  const bot = c01 * (1 - fx) + c11 * fx
  return top * (1 - fz) + bot * fz
}

/**
 * Sets a column's `height` (first-air-from-top oracle) on EVERY resident chunk of world column
 * (wx,wz), across the vertical stack that the shell fill touched. The light BFS reads this per chunk
 * as its skylight seed boundary, and it is column-global (identical for every stacked cy) so a sealed
 * interior floods dark and a hole column admits a full-height shaft. Direct chunk lookups (not an
 * all-chunks scan) — the y range covers the whole room shell. @param {Map<string, ChunkRecord>} chunks
 * @param {number} wx @param {number} wz @param {number} first_air_y @param {number} cy_lo lowest chunk-y
 * touched @param {number} cy_hi highest chunk-y touched
 */
function set_column_height(chunks, wx, wz, first_air_y, cy_lo, cy_hi) {
  const cx = Math.floor(wx / CHUNK_SIZE)
  const cz = Math.floor(wz / CHUNK_SIZE)
  const idx = column_index(wx - cx * CHUNK_SIZE, wz - cz * CHUNK_SIZE)
  for (let cy = cy_lo; cy <= cy_hi; cy += 1) {
    const rec = chunks.get(`${cx},${cy},${cz}`)
    if (rec) rec.height[idx] = first_air_y
  }
}
