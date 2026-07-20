// Schematic stamper (§4.6 vegetation/schematics wave, phase A) — deterministic, region-local
// placement of resolved schematics into a single chunk record. PURE FUNCTIONS ONLY, integer
// hashing only (§3.7 determinism law): every placement is a pure function of (seed, anchor world
// column) so a schematic straddling a chunk boundary is decided identically by every chunk it
// touches, and each chunk writes only the voxels that fall inside its own 0..31 bounds. The union
// of every touched chunk's clipped output equals the unclipped whole (proven in stamper.test.js).
// No Math.random, no transcendentals — same splitmix u32 hash lineage as surface_decorator.js.
//
// ──────────────────────────────────────────────────────────────────────────────────────────────
// PHASE B INTEGRATION (swap-in for surface_decorator.js) — hook points by function name:
//
//   • decorate_chunk(chunk, profile, cx, cy, cz): the per-column decoration loop. It already
//     computes `world_x`/`world_z` per column and holds `cx,cy,cz` in scope. Add a `seed` param
//     (thread the world seed through world_gen.js) and, once, `const tree_set =
//     load_schematic_set('tree')` / `rock_set = load_schematic_set('rock')` (loader.js).
//
//   • stamp_tree(chunk, lx, lz, world_x, world_z, surface_y, base_world_y): DELETE. Replace its
//     call site (inside decorate_chunk's tree branch, after the grove gate + TREE_ONE_IN roll)
//     with:  stamp_schematic(chunk, cx, cy, cz, world_x, world_z, surface_y, seed, tree_set)
//     `base_world_y`/`lx`/`lz` are no longer passed — the stamper derives locals from cx,cy,cz.
//
//   • HALO (the one change beyond swapping the call): decorate_chunk currently loops ONLY its own
//     32×32 columns and stamp_tree CLAMPS horizontal spill. To get cross-chunk canopies, also
//     iterate ANCHOR columns in a halo of radius `max_horizontal_reach(tree_set)` around the chunk
//     (world columns cx*32 − R .. cx*32 + 31 + R on x and z), running the SAME per-column decision
//     (in_grove + hash_column roll) for each and calling stamp_schematic; each chunk stamps only
//     its in-bounds slice. Halo columns outside the current chunk need their surface_y/biome, i.e.
//     neighbor ColumnProfiles — the `TODO(§4.6 region pipeline)` already noted in surface_decorator.
// ──────────────────────────────────────────────────────────────────────────────────────────────

import { CHUNK_SIZE } from '../../config/world_config.js'
import { local_index, set_occupancy_bit } from '../../chunks/format.js'
import { AIR_BLOCK_ID, get_block_by_id } from '../../config/block_registry.js'

import { for_each_voxel } from './loader.js'

/** @typedef {import('./loader.js').ResolvedSchematic} ResolvedSchematic */
/** @typedef {import('./loader.js').ResolvedVoxel} ResolvedVoxel */
/** @typedef {import('../../chunks/format.js').ChunkRecord} ChunkRecord */

const U32_MASK = 0xffffffff
// Decorrelated decision salts (schematic pick vs rotation) — same role as surface_decorator's
// SALT_* constants, folded with the world seed so different worlds place differently.
const SALT_SELECT = 0x9e3779b1
const SALT_ROTATE = 0x85ebca77

/**
 * Deterministic integer hash of a world column + salt → u32. Pure multiply/xor/shift on 32-bit
 * unsigned ints — byte-identical lineage to surface_decorator.js's hash_column (§3.7). `>>` in
 * callers is arithmetic (floors negatives), so this stays stable across the origin.
 * @param {number} x world block x
 * @param {number} z world block z
 * @param {number} salt per-decision constant (fold the world seed in here)
 * @returns {number} unsigned 32-bit hash
 */
export function hash_column(x, z, salt) {
  let h = (x * 374761393 + z * 668265263 + salt * 2246822519) & U32_MASK
  h = (h ^ (h >>> 13)) & U32_MASK
  h = (h * 1274126177) & U32_MASK
  h = (h ^ (h >>> 16)) & U32_MASK
  return h >>> 0
}

/**
 * Rotates an integer horizontal offset by `rotation` quarter-turns about the anchor (Y axis). A
 * bijection on the integer lattice, so distinct schematic voxels map to distinct world cells (the
 * union/clip proof relies on this). y is untouched.
 * @param {number} dx offset x
 * @param {number} dz offset z
 * @param {0|1|2|3} rotation quarter-turns CCW
 * @returns {[number, number]} rotated [dx, dz]
 */
export function rotate_offset(dx, dz, rotation) {
  switch (rotation & 3) {
    case 1:
      return [-dz, dx]
    case 2:
      return [-dx, -dz]
    case 3:
      return [dz, -dx]
    default:
      return [dx, dz]
  }
}

/**
 * @typedef {object} SchematicPlacement
 * @property {ResolvedSchematic} schematic the chosen schematic
 * @property {0|1|2|3} rotation quarter-turns
 */

/**
 * Deterministically selects a schematic + rotation for an anchor column. Pure function of (seed,
 * world_x, world_z) — the SAME column always yields the SAME pick in every chunk that column's
 * schematic reaches, and columns in different chunks pick independently. Returns null for an empty
 * set (nothing to place).
 * @param {number} seed world seed
 * @param {number} world_x anchor column x
 * @param {number} world_z anchor column z
 * @param {ResolvedSchematic[]} set candidate schematics (e.g. load_schematic_set('tree'))
 * @returns {SchematicPlacement | null}
 */
export function select_schematic(seed, world_x, world_z, set) {
  if (set.length === 0) return null
  const idx = hash_column(world_x, world_z, (seed ^ SALT_SELECT) >>> 0) % set.length
  const rotation = /** @type {0|1|2|3} */ (hash_column(world_x, world_z, (seed ^ SALT_ROTATE) >>> 0) & 3)
  return { schematic: set[idx], rotation }
}

/**
 * @typedef {object} WorldVoxel
 * @property {number} wx world x
 * @property {number} wy world y
 * @property {number} wz world z
 * @property {number} block_id
 * @property {boolean} solid
 * @property {import('./loader.js').PlacementMode} mode
 */

/**
 * Expands a placement into its full UNCLIPPED list of world voxels (reference for the cross-border
 * union proof; also usable by a future region pipeline to route voxels to neighbor chunks). Pure.
 * @param {number} world_x anchor column x
 * @param {number} world_z anchor column z
 * @param {number} surface_y world y the schematic's lowest layer sits on
 * @param {ResolvedSchematic} schematic
 * @param {0|1|2|3} rotation
 * @returns {WorldVoxel[]}
 */
export function expand_placement(world_x, world_z, surface_y, schematic, rotation) {
  /** @type {WorldVoxel[]} */
  const out = []
  // for_each_voxel: carrier-agnostic (bundle object voxels OR a synthesized tree's compact arrays).
  for_each_voxel(schematic, (dx, dy, dz, e) => {
    const [rdx, rdz] = rotate_offset(dx, dz, rotation)
    out.push({
      wx: world_x + rdx,
      wy: surface_y + dy,
      wz: world_z + rdz,
      block_id: e.block_id,
      solid: e.solid,
      mode: e.mode,
    })
  })
  return out
}

/**
 * Writes one world voxel into `chunk` IFF it falls inside this chunk's 0..31 bounds (the per-chunk
 * clip) AND its placement mode permits the target cell. Solid voxels also set the mesher's 3-axis
 * occupancy bits (mirrors surface_decorator.place_voxel). Returns whether it wrote.
 * @param {ChunkRecord} chunk
 * @param {number} cx chunk x
 * @param {number} cy chunk y
 * @param {number} cz chunk z
 * @param {WorldVoxel} v
 * @returns {boolean} true if written
 */
export function place_world_voxel(chunk, cx, cy, cz, v) {
  const lx = v.wx - cx * CHUNK_SIZE
  const ly = v.wy - cy * CHUNK_SIZE
  const lz = v.wz - cz * CHUNK_SIZE
  if (lx < 0 || ly < 0 || lz < 0 || lx >= CHUNK_SIZE || ly >= CHUNK_SIZE || lz >= CHUNK_SIZE) return false
  const li = local_index(lx, ly, lz)
  const existing = chunk.ids[li]
  if (v.mode === 'air_only') {
    if (existing !== AIR_BLOCK_ID) return false
  } else if (v.mode === 'replace_foliage') {
    if (existing !== AIR_BLOCK_ID && get_block_by_id(existing)?.class !== 'foliage') return false
  }
  chunk.ids[li] = v.block_id
  if (v.solid) {
    set_occupancy_bit(chunk, 0, ly * CHUNK_SIZE + lz, lx, true)
    set_occupancy_bit(chunk, 1, lx * CHUNK_SIZE + lz, ly, true)
    set_occupancy_bit(chunk, 2, lx * CHUNK_SIZE + ly, lz, true)
  }
  return true
}

/**
 * Stamps a chosen schematic+rotation anchored at (world_x, world_z, surface_y) into ONE chunk,
 * clipping every voxel to the chunk's bounds. Deterministic and region-local: call it with the
 * same args on every chunk the schematic overlaps and the clipped slices tile into the whole.
 * Mutates `chunk`. Returns the number of voxels written into this chunk.
 * @param {ChunkRecord} chunk
 * @param {number} cx chunk x
 * @param {number} cy chunk y
 * @param {number} cz chunk z
 * @param {number} world_x anchor column x
 * @param {number} world_z anchor column z
 * @param {number} surface_y world y the schematic's lowest layer sits on
 * @param {ResolvedSchematic} schematic
 * @param {0|1|2|3} rotation
 * @returns {number} voxels written into this chunk
 */
export function stamp_into_chunk(chunk, cx, cy, cz, world_x, world_z, surface_y, schematic, rotation) {
  let written = 0
  // Hot path: iterate either carrier form (for_each_voxel) and reuse ONE scratch WorldVoxel per call —
  // place_world_voxel reads fields and writes the chunk, never retaining the object, so a 2600-voxel tree
  // stamps with zero per-voxel allocation (this loop runs 12× per tree column; the churn was measurable).
  for_each_voxel(schematic, (dx, dy, dz, e) => {
    const [rdx, rdz] = rotate_offset(dx, dz, rotation)
    _stamp_scratch.wx = world_x + rdx
    _stamp_scratch.wy = surface_y + dy
    _stamp_scratch.wz = world_z + rdz
    _stamp_scratch.block_id = e.block_id
    _stamp_scratch.solid = e.solid
    _stamp_scratch.mode = e.mode
    if (place_world_voxel(chunk, cx, cy, cz, _stamp_scratch)) written += 1
  })
  return written
}

/** Reused scratch WorldVoxel for stamp_into_chunk (synchronous, one voxel at a time — see the loop note).
 *  @type {WorldVoxel} */
const _stamp_scratch = { wx: 0, wy: 0, wz: 0, block_id: 0, solid: false, mode: 'overwrite' }

/**
 * Swap-in for surface_decorator.stamp_tree: deterministically picks a schematic for the anchor
 * column and stamps it into this chunk (clipped). Mirrors stamp_tree's role but takes cx,cy,cz +
 * seed + the schematic set instead of lx/lz/base_world_y. Returns the placed schematic (null when
 * the set is empty). See the PHASE B header note for the exact call-site swap + halo requirement.
 * @param {ChunkRecord} chunk
 * @param {number} cx chunk x
 * @param {number} cy chunk y
 * @param {number} cz chunk z
 * @param {number} world_x anchor column x
 * @param {number} world_z anchor column z
 * @param {number} surface_y first-air world-y of the column (schematic base sits here)
 * @param {number} seed world seed
 * @param {ResolvedSchematic[]} set candidate schematics
 * @returns {ResolvedSchematic | null}
 */
export function stamp_schematic(chunk, cx, cy, cz, world_x, world_z, surface_y, seed, set) {
  const placement = select_schematic(seed, world_x, world_z, set)
  if (placement === null) return null
  stamp_into_chunk(chunk, cx, cy, cz, world_x, world_z, surface_y, placement.schematic, placement.rotation)
  return placement.schematic
}

/**
 * Max horizontal reach across a set — the halo radius (in columns) phase B must scan around a
 * chunk so schematics anchored just outside still stamp their in-bounds spill. 0 for an empty set.
 * @param {ResolvedSchematic[]} set
 * @returns {number}
 */
export function max_horizontal_reach(set) {
  let r = 0
  for (const s of set) if (s.reach > r) r = s.reach
  return r
}
