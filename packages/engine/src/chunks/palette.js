// ≤256-unique palette compression for chunk `ids` arrays (§3.4). At rest, the overwhelmingly
// common case (≤256 distinct block ids in a chunk) compresses 64 KB Uint16 → ~33 KB
// (Uint8 indices + small palette table). Falls back to raw Uint16 passthrough above that.

/** Palette table capacity — indices are stored as Uint8. */
export const MAX_PALETTE_SIZE = 256

/**
 * @typedef {object} PalettedChunk
 * @property {true} paletted discriminant — true when compression succeeded
 * @property {Uint16Array} palette unique block ids, palette[index] = block_id
 * @property {Uint8Array} indices per-voxel index into `palette`, same length as input
 */

/**
 * @typedef {object} RawChunk
 * @property {false} paletted discriminant — true when compression succeeded
 * @property {Uint16Array} ids raw block ids, passthrough (>256 unique ids in this chunk)
 */

/** @typedef {PalettedChunk | RawChunk} CompressedChunk */

/**
 * Compresses a flat block-id array into a palette + index buffer, or returns a raw
 * passthrough when more than `MAX_PALETTE_SIZE` unique ids are present.
 * @param {Uint16Array} ids
 * @returns {CompressedChunk}
 */
export function compress_palette(ids) {
  /** @type {Map<number, number>} */
  const id_to_index = new Map()
  const palette_list = []

  for (let i = 0; i < ids.length; i += 1) {
    const block_id = ids[i]
    if (!id_to_index.has(block_id)) {
      if (palette_list.length >= MAX_PALETTE_SIZE) {
        return { paletted: false, ids }
      }
      id_to_index.set(block_id, palette_list.length)
      palette_list.push(block_id)
    }
  }

  const indices = new Uint8Array(ids.length)
  for (let i = 0; i < ids.length; i += 1) {
    const index = id_to_index.get(ids[i])
    indices[i] = /** @type {number} */ (index)
  }

  return {
    paletted: true,
    palette: Uint16Array.from(palette_list),
    indices,
  }
}

/**
 * Decompresses a `CompressedChunk` back into a flat Uint16 block-id array.
 * @param {CompressedChunk} compressed
 * @returns {Uint16Array}
 */
export function decompress_palette(compressed) {
  if (!compressed.paletted) return compressed.ids

  const { palette, indices } = compressed
  const ids = new Uint16Array(indices.length)
  for (let i = 0; i < indices.length; i += 1) {
    ids[i] = palette[indices[i]]
  }
  return ids
}

/**
 * Number of unique block ids that would result from compressing `ids` — useful for callers
 * that want to decide up front whether palette compression is worthwhile without allocating.
 * @param {Uint16Array} ids
 * @returns {number}
 */
export function count_unique(ids) {
  const seen = new Set()
  for (let i = 0; i < ids.length; i += 1) seen.add(ids[i])
  return seen.size
}
