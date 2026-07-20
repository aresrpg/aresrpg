// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Transfer only the one-voxel shell mesh_chunk can read. mesh_halo.test.js pins worker/inline bytes.

import { CHUNK_SIZE } from '../config/world_config.js'
import { local_index } from '../chunks/format.js'

/** @typedef {import('../chunks/format.js').ChunkRecord} ChunkRecord */
/** @typedef {import('./mesher.js').NeighborHalos} NeighborHalos */

/** Rim box edge = the chunk plus a 1-voxel shell on both sides of every axis. */
const RIM = CHUNK_SIZE + 2
const RIM_AREA = RIM * RIM
const MIDDLE_SHELL = RIM * 2 + CHUNK_SIZE * 2
const SHELL_CELLS = RIM ** 3 - CHUNK_SIZE ** 3

/**
 * Compact shell index for a local coordinate with at least one axis outside the chunk.
 * @param {number} x @param {number} y @param {number} z @returns {number}
 */
function shell_index(x, y, z) {
  const rx = x + 1
  const ry = y + 1
  const rz = z + 1
  if (ry === 0) return rz * RIM + rx
  if (ry === RIM - 1) return RIM_AREA + CHUNK_SIZE * MIDDLE_SHELL + rz * RIM + rx
  const base = RIM_AREA + (ry - 1) * MIDDLE_SHELL
  if (rz === 0) return base + rx
  if (rz === RIM - 1) return base + RIM + CHUNK_SIZE * 2 + rx
  return base + RIM + (rz - 1) * 2 + (rx === 0 ? 0 : 1)
}

/**
 * The 3×3×3 neighbour-cell bit index (0..26) a local voxel coord falls into: which of the 27 chunks
 * around (and including) the meshed chunk owns it. dc ∈ {-1,0,1} per axis via floor-div by CHUNK_SIZE
 * (for coords in [-1, CHUNK_SIZE]: -1 → -1, 0..31 → 0, 32 → +1). Matches build_neighbor_halos.resolve's
 * `Math.floor(x / CHUNK_SIZE)`. @param {number} x @param {number} y @param {number} z @returns {number}
 */
function neighbor_bit(x, y, z) {
  const dcx = Math.floor(x / CHUNK_SIZE)
  const dcy = Math.floor(y / CHUNK_SIZE)
  const dcz = Math.floor(z / CHUNK_SIZE)
  return (dcy + 1) * 9 + (dcz + 1) * 3 + (dcx + 1)
}

/**
 * @typedef {object} MeshJobPayload wire shape of one MSG_MESH_REQUEST body — all typed arrays are fresh
 *   copies (transferable; the store-resident originals are untouched).
 * @property {number} cx @property {number} cy @property {number} cz
 * @property {Uint16Array} ids the chunk's block ids (clone)
 * @property {Uint8Array} light the chunk's packed light (clone)
 * @property {[Uint32Array, Uint32Array, Uint32Array]} occupancy the chunk's per-axis opaque bitmasks (clone)
 * @property {boolean} render_fins the ring's leaf-fin tier flag, forwarded to mesh_chunk
 * @property {Uint16Array} halo_ids block id per shell cell (0 where the neighbour isn't resident)
 * @property {Uint8Array} halo_light packed light per rim cell (valid only where resident_bits says so)
 * @property {number} resident_bits 27-bit mask over the 3×3×3 neighbour chunks: bit set ⇒ that neighbour
 *   is resident (so light/resident read real values; else light → -1, resident → false)
 */

/**
 * Serializes a chunk + its neighbour rim into a transferable mesh-job payload. Runs on the MAIN THREAD:
 * clones the chunk's meshing-relevant arrays (so the resident record stays intact for collision + other
 * chunks' halos) and snapshots the 1-voxel rim from resident neighbours.
 * @param {ChunkRecord} chunk the chunk to mesh (store-resident)
 * @param {(cx: number, cy: number, cz: number) => (ChunkRecord | undefined)} get_resident resident-only
 *   neighbour fetch (no LRU touch — store.get_resident)
 * @param {boolean} render_fins the ring's leaf-fin tier flag
 * @returns {{ payload: MeshJobPayload, transfer: ArrayBuffer[] }} the message body + its transfer list
 */
export function serialize_mesh_job(chunk, get_resident, render_fins) {
  const { cx, cy, cz } = chunk
  // Clone the arrays mesh_chunk/leaf_sprites read (ids, light, occupancy). .slice() copies into fresh
  // buffers we then TRANSFER — zero-copy move of the copies; the store's originals never detach.
  const ids = chunk.ids.slice()
  const light = chunk.light.slice()
  const occ0 = chunk.occupancy[0].slice()
  const occ1 = chunk.occupancy[1].slice()
  const occ2 = chunk.occupancy[2].slice()

  // Gather the 3×3×3 neighbours once (≤27 map lookups, no per-cell string keys), recording residency.
  /** @type {(ChunkRecord | undefined)[]} */
  const neighbors = new Array(27)
  let resident_bits = 0
  for (let dcy = -1; dcy <= 1; dcy += 1) {
    for (let dcz = -1; dcz <= 1; dcz += 1) {
      for (let dcx = -1; dcx <= 1; dcx += 1) {
        const rec = get_resident(cx + dcx, cy + dcy, cz + dcz)
        const bit = (dcy + 1) * 9 + (dcz + 1) * 3 + (dcx + 1)
        neighbors[bit] = rec
        if (rec) resident_bits |= 1 << bit
      }
    }
  }

  const halo_ids = new Uint16Array(SHELL_CELLS)
  const halo_light = new Uint8Array(SHELL_CELLS)
  /** @param {number} x @param {number} y @param {number} z */
  const copy_shell = (x, y, z) => {
    const rec = neighbors[neighbor_bit(x, y, z)]
    if (!rec) return
    const lx = ((x % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE
    const ly = ((y % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE
    const lz = ((z % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE
    const source = local_index(lx, ly, lz)
    const target = shell_index(x, y, z)
    halo_ids[target] = rec.ids[source]
    halo_light[target] = rec.light[source]
  }
  for (let y = -1; y <= CHUNK_SIZE; y += CHUNK_SIZE + 1) {
    for (let z = -1; z <= CHUNK_SIZE; z += 1) for (let x = -1; x <= CHUNK_SIZE; x += 1) copy_shell(x, y, z)
  }
  for (let y = 0; y < CHUNK_SIZE; y += 1) {
    for (let x = -1; x <= CHUNK_SIZE; x += 1) {
      copy_shell(x, y, -1)
      copy_shell(x, y, CHUNK_SIZE)
    }
    for (let z = 0; z < CHUNK_SIZE; z += 1) {
      copy_shell(-1, y, z)
      copy_shell(CHUNK_SIZE, y, z)
    }
  }

  const payload = {
    cx,
    cy,
    cz,
    ids,
    light,
    occupancy: /** @type {[Uint32Array, Uint32Array, Uint32Array]} */ ([occ0, occ1, occ2]),
    render_fins,
    halo_ids,
    halo_light,
    resident_bits,
  }
  const transfer = [ids.buffer, light.buffer, occ0.buffer, occ1.buffer, occ2.buffer, halo_ids.buffer, halo_light.buffer]
  return { payload, transfer }
}

/**
 * Rebuilds the (chunk, NeighborHalos, render_fins) triple mesh_chunk expects, on the WORKER SIDE, from a
 * transferred payload. The chunk carries only the fields the mesher reads (cx/cy/cz + ids/light/occupancy);
 * height/biome are absent by design (never read) — cast to ChunkRecord. The halo closures return exactly
 * what store.neighbor_halos would: block → id (0 when the covering neighbour isn't resident), light →
 * packed byte or -1 when not resident, resident → per-neighbour-chunk residency.
 * @param {MeshJobPayload} payload
 * @returns {{ chunk: ChunkRecord, halos: NeighborHalos, render_fins: boolean }}
 */
export function deserialize_mesh_job(payload) {
  const { cx, cy, cz, ids, light, occupancy, render_fins, halo_ids, halo_light, resident_bits } = payload
  const chunk = /** @type {ChunkRecord} */ ({ cx, cy, cz, ids, light, occupancy })

  /** @type {NeighborHalos} */
  const halos = {
    block: (x, y, z) => halo_ids[shell_index(x, y, z)],
    light: (x, y, z) => ((resident_bits >> neighbor_bit(x, y, z)) & 1 ? halo_light[shell_index(x, y, z)] : -1),
    resident: (x, y, z) => ((resident_bits >> neighbor_bit(x, y, z)) & 1) === 1,
  }
  return { chunk, halos, render_fins }
}
