// Resident chunk map and the single home for cross-chunk mesher halo probes.

import { CHUNK_SIZE } from '../config/world_config.js'

import { local_index } from './format.js'

/** @typedef {import('./format.js').ChunkRecord} ChunkRecord */
/** @typedef {import('../mesh/mesher.js').NeighborHalos} NeighborHalos */

/**
 * Builds the mesher's cross-chunk boundary probes (`NeighborHalos`) for the chunk at (cx,cy,cz).
 * Both `block(x,y,z)` and `light(x,y,z)` accept LOCAL voxel coords that lie outside 0..31 on ≥1
 * axis and resolve them to the correct neighbor record — edges, corners AND diagonals alike, via
 * per-axis floor/mod (AO samples the 8-neighborhood one step past a face, so a corner sample is
 * out of range on two axes at once and lands in a diagonal neighbor; a per-face lookup can't
 * answer it). Non-resident neighbors read as air (block 0) / -1 (light → mesher uses owner cell),
 * matching isolation meshing. Split out from the store so unit tests can back it with a plain map.
 * @param {(cx: number, cy: number, cz: number) => (ChunkRecord | undefined)} get_record
 *   resident-only fetch (no LRU touch — halo reads shouldn't perturb the requester's recency)
 * @param {number} cx
 * @param {number} cy
 * @param {number} cz
 * @returns {NeighborHalos}
 */
export function build_neighbor_halos(get_record, cx, cy, cz) {
  /**
   * @param {number} x
   * @param {number} y
   * @param {number} z
   * @returns {{ record: ChunkRecord | undefined, index: number }}
   */
  const resolve = (x, y, z) => {
    const record = get_record(
      cx + Math.floor(x / CHUNK_SIZE),
      cy + Math.floor(y / CHUNK_SIZE),
      cz + Math.floor(z / CHUNK_SIZE)
    )
    const lx = ((x % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE
    const ly = ((y % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE
    const lz = ((z % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE
    return { record, index: local_index(lx, ly, lz) }
  }

  return {
    block: (x, y, z) => {
      const { record, index } = resolve(x, y, z)
      return record ? record.ids[index] : 0
    },
    light: (x, y, z) => {
      const { record, index } = resolve(x, y, z)
      return record ? record.light[index] : -1
    },
    resident: (x, y, z) => resolve(x, y, z).record !== undefined,
  }
}

/**
 * Packs a (cx, cy, cz) triple into one string key. Chunk coords are small signed integers;
 * string keys keep the Map API simple and are cheap at M0's chunk counts (hundreds, not millions).
 * @param {number} cx
 * @param {number} cy
 * @param {number} cz
 * @returns {string}
 */
export function coord_key(cx, cy, cz) {
  return `${cx},${cy},${cz}`
}

/**
 * @typedef {object} ChunkStore
 * @property {(chunk: ChunkRecord) => void} put inserts/replaces a chunk
 * @property {(cx: number, cy: number, cz: number) => ChunkRecord | undefined} get
 * @property {(cx: number, cy: number, cz: number) => boolean} has
 * @property {(cx: number, cy: number, cz: number) => (ChunkRecord | undefined)} get_resident
 *   fetches a resident chunk for the mesh-job halo serializer
 * @property {(cx: number, cy: number, cz: number) => boolean} evict removes one chunk by coord
 * @property {() => number} size current resident chunk count
 * @property {(cx: number, cy: number, cz: number) => NeighborHalos} neighbor_halos builds the
 *   mesher's cross-chunk boundary probes for a chunk from its resident neighbors
 * @property {() => IterableIterator<ChunkRecord>} values iterates all resident chunks
 */

/**
 * Creates a bounded resident map. Live callers derive capacity from their exact unload footprint and
 * evict explicitly before inserting replacements, so overflow is a wiring error rather than policy.
 * @param {object} options
 * @param {number} options.capacity caller-derived resident bound, required
 * @returns {ChunkStore}
 */
export function create_chunk_store({ capacity }) {
  if (!Number.isInteger(capacity) || capacity < 1)
    throw new Error(`create_chunk_store: capacity must be a positive integer, got ${capacity}`)
  /** @type {Map<string, ChunkRecord>} */
  const chunks = new Map()

  return {
    put(chunk) {
      const key = coord_key(chunk.cx, chunk.cy, chunk.cz)
      if (!chunks.has(key) && chunks.size >= capacity)
        throw new Error(`create_chunk_store: capacity ${capacity} exceeded`)
      chunks.set(key, chunk)
    },

    get(cx, cy, cz) {
      return chunks.get(coord_key(cx, cy, cz))
    },

    has(cx, cy, cz) {
      return chunks.has(coord_key(cx, cy, cz))
    },

    get_resident(cx, cy, cz) {
      return chunks.get(coord_key(cx, cy, cz))
    },

    evict(cx, cy, cz) {
      return chunks.delete(coord_key(cx, cy, cz))
    },

    size() {
      return chunks.size
    },

    neighbor_halos(cx, cy, cz) {
      return build_neighbor_halos((nx, ny, nz) => chunks.get(coord_key(nx, ny, nz)), cx, cy, cz)
    },

    values() {
      return chunks.values()
    },
  }
}
