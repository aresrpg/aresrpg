// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

/** Existing structure encoding: sorted u16 cell, u16 run length, u8 palette index. */
export const encode_voxel_runs = (voxels) => {
  const runs = []
  for (const [index, material] of [...voxels].sort(([left], [right]) => left - right)) {
    const previous = runs.at(-1)
    if (previous && previous.start + previous.count === index && previous.material === material) previous.count += 1
    else runs.push({ start: index, count: 1, material })
  }
  const bytes = Buffer.alloc(runs.length * 5)
  runs.forEach(({ start, count, material }, index) => {
    bytes.writeUInt16LE(start, index * 5)
    bytes.writeUInt16LE(count, index * 5 + 2)
    bytes.writeUInt8(material, index * 5 + 4)
  })
  return bytes.toString('base64')
}
