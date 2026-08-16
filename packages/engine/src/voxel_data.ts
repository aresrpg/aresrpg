// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

export const CHUNK_EDGE = 32
const HALO_EDGE = CHUNK_EDGE + 2

export type SolidAt = (x: number, y: number, z: number) => boolean

export const halo_index = (x: number, y: number, z: number): number =>
  (y + 1) * HALO_EDGE * HALO_EDGE + (z + 1) * HALO_EDGE + x + 1

export const voxel_index = (x: number, y: number, z: number): number => y * CHUNK_EDGE * CHUNK_EDGE + z * CHUNK_EDGE + x

const words = (length: number): Uint32Array =>
  typeof SharedArrayBuffer !== 'undefined' && globalThis.crossOriginIsolated
    ? new Uint32Array(new SharedArrayBuffer(length * Uint32Array.BYTES_PER_ELEMENT))
    : new Uint32Array(length)

export const pack_voxel_occupancy = (
  solid_at: SolidAt,
  resolution = CHUNK_EDGE
): Readonly<{
  occupancy: readonly [Uint32Array, Uint32Array, Uint32Array]
  halo_occupancy: Uint32Array
}> => {
  if (!Number.isInteger(resolution) || resolution < 1 || resolution > CHUNK_EDGE)
    throw new TypeError(`voxel resolution must be within 1..${CHUNK_EDGE}`)
  // Immutable shared views avoid worker input copies when COOP/COEP already made the page
  // cross-origin isolated. Ordinary buffers remain the zero-configuration path.
  const occupancy = [words(1024), words(1024), words(1024)] as const
  const halo_occupancy = words(Math.ceil(HALO_EDGE ** 3 / 32))

  for (let y = -1; y <= resolution; y += 1) {
    for (let z = -1; z <= resolution; z += 1) {
      for (let x = -1; x <= resolution; x += 1) {
        if (!solid_at(x, y, z)) continue
        const index = halo_index(x, y, z)
        halo_occupancy[index >>> 5] |= 1 << (index & 31)
        if (x < 0 || y < 0 || z < 0 || x >= resolution || y >= resolution || z >= resolution) continue
        occupancy[0][y * CHUNK_EDGE + z] |= 1 << x
        occupancy[1][x * CHUNK_EDGE + z] |= 1 << y
        occupancy[2][x * CHUNK_EDGE + y] |= 1 << z
      }
    }
  }
  return Object.freeze({ occupancy, halo_occupancy })
}
