// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Chunk record layout (§3.4) — FROZEN CONTRACT. WS2 (gen) writes these fields, WS3 (mesh)
// reads them, WS9 (structures) writes cross-chunk overflow into neighbor records. Do not
// change shapes without a version bump + golden-hash re-cut (§3.7).

import { CHUNK_SIZE } from '../config/world_config.js'

/** Voxels per chunk edge cubed (32³). */
export const VOXELS_PER_CHUNK = CHUNK_SIZE * CHUNK_SIZE * CHUNK_SIZE
/** Columns per chunk face (32×32). */
export const COLUMNS_PER_CHUNK = CHUNK_SIZE * CHUNK_SIZE
/** Meta cells per chunk: biome sampled per 4×4×4 cell (§4.3), 8³ cells per 32³ chunk. */
export const META_CELLS_PER_CHUNK = (CHUNK_SIZE / 4) ** 3

/** @typedef {0|1|2} Axis 0=x, 1=y, 2=z */
/** @typedef {'queued'|'generated'|'decorated'|'lit'|'meshed'|'uploaded'|'live'} ChunkStage */

/**
 * @typedef {object} ChunkRecord
 * @property {number} cx chunk coordinate (x, in chunk units)
 * @property {number} cy chunk coordinate (y, in chunk units)
 * @property {number} cz chunk coordinate (z, in chunk units)
 * @property {Uint16Array} ids block id per voxel, index = local_index(x,y,z), length 32768
 * @property {Uint8Array} light sun (high 4 bits) + block light (low 4 bits) per voxel, length 32768
 * @property {Uint16Array} height first-opaque-from-top world-y per column, length 1024 (32×32)
 * @property {[Uint32Array, Uint32Array, Uint32Array]} occupancy per-axis opaque bitmasks,
 *   one Uint32 per (row,col) pair on that axis — 32 rows × 32 u32-columns per axis
 * @property {Uint8Array} biome biome id per 4×4×4 meta cell, length 512
 * @property {boolean} dirty true when re-mesh/re-light is required
 * @property {ChunkStage} stage pipeline stage (§3.2)
 * @property {number} lod LOD level: 0 = full res, 1 = 2:1, 2 = 4:1 (§3.4, downsample.js)
 */

/**
 * Local voxel index within a chunk's flat 32768-length arrays.
 * @param {number} x 0..31
 * @param {number} y 0..31
 * @param {number} z 0..31
 * @returns {number}
 */
export function local_index(x, y, z) {
  return (y * CHUNK_SIZE + z) * CHUNK_SIZE + x
}

/**
 * Column index within a chunk's flat 1024-length column arrays (height).
 * @param {number} x 0..31
 * @param {number} z 0..31
 * @returns {number}
 */
export function column_index(x, z) {
  return z * CHUNK_SIZE + x
}

/**
 * Meta-cell index within the 512-length per-chunk biome array (8×8×8 grid of 4×4×4 cells).
 * @param {number} cell_x 0..7
 * @param {number} cell_y 0..7
 * @param {number} cell_z 0..7
 * @returns {number}
 */
export function meta_cell_index(cell_x, cell_y, cell_z) {
  return (cell_y * 8 + cell_z) * 8 + cell_x
}

/**
 * Allocates a fresh, zeroed chunk record at the given chunk coordinates.
 * @param {number} cx
 * @param {number} cy
 * @param {number} cz
 * @returns {ChunkRecord}
 */
export function create_chunk_record(cx, cy, cz) {
  return {
    cx,
    cy,
    cz,
    ids: new Uint16Array(VOXELS_PER_CHUNK),
    light: new Uint8Array(VOXELS_PER_CHUNK),
    height: new Uint16Array(COLUMNS_PER_CHUNK),
    occupancy: [
      new Uint32Array(CHUNK_SIZE * CHUNK_SIZE),
      new Uint32Array(CHUNK_SIZE * CHUNK_SIZE),
      new Uint32Array(CHUNK_SIZE * CHUNK_SIZE),
    ],
    biome: new Uint8Array(META_CELLS_PER_CHUNK),
    dirty: true,
    stage: 'queued',
    lod: 0,
  }
}

/**
 * Reads the block id at a local voxel coordinate.
 * @param {ChunkRecord} chunk
 * @param {number} x
 * @param {number} y
 * @param {number} z
 * @returns {number}
 */
export function get_block_id(chunk, x, y, z) {
  return chunk.ids[local_index(x, y, z)]
}

/**
 * Writes the block id at a local voxel coordinate. Does not update occupancy/height —
 * callers (gen/decorators, block-edit path) must call `set_occupancy` and refresh height
 * themselves; kept separate so bulk-gen writes stay branch-free.
 * @param {ChunkRecord} chunk
 * @param {number} x
 * @param {number} y
 * @param {number} z
 * @param {number} block_id
 */
export function set_block_id(chunk, x, y, z, block_id) {
  chunk.ids[local_index(x, y, z)] = block_id
}

/** Sun-light component of a packed light byte (high nibble), 0-15. @param {number} packed */
export function get_sun_light(packed) {
  return (packed >> 4) & 0xf
}

/** Block-light component of a packed light byte (low nibble), 0-15. @param {number} packed */
export function get_block_light(packed) {
  return packed & 0xf
}

/**
 * Packs sun (0-15) + block (0-15) light components into one byte (Minecraft model, §3.4).
 * @param {number} sun
 * @param {number} block
 * @returns {number}
 */
export function pack_light(sun, block) {
  return ((sun & 0xf) << 4) | (block & 0xf)
}

/**
 * Reads the opaque-occupancy bit for a local voxel on a given axis's bitmask layout.
 * @param {ChunkRecord} chunk
 * @param {Axis} axis
 * @param {number} row 0..31 — the axis-perpendicular row index
 * @param {number} bit 0..31 — position along the axis
 * @returns {boolean}
 */
export function get_occupancy_bit(chunk, axis, row, bit) {
  const word = chunk.occupancy[axis][row]
  return ((word >>> bit) & 1) === 1
}

/**
 * Sets (or clears) the opaque-occupancy bit for a local voxel on a given axis's bitmask.
 * @param {ChunkRecord} chunk
 * @param {Axis} axis
 * @param {number} row 0..31
 * @param {number} bit 0..31
 * @param {boolean} value
 */
export function set_occupancy_bit(chunk, axis, row, bit, value) {
  const words = chunk.occupancy[axis]
  if (value) words[row] |= 1 << bit
  else words[row] &= ~(1 << bit)
}
