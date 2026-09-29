// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { CHUNK_EDGE } from '../packages/engine/src/voxel_data.ts'

/** Both authored worlds and cities partition into the engine's existing voxel cells. */
export const partition_blocks = (blocks) => {
  const cells = new Map()
  for (const [x, y, z, material] of blocks) {
    const origin = [x, y, z].map((value) => Math.floor(value / CHUNK_EDGE) * CHUNK_EDGE)
    const key = origin.join(',')
    const cell = cells.get(key) ?? { origin, blocks: new Map() }
    cell.blocks.set([x, y, z].join(','), [x - origin[0], y - origin[1], z - origin[2], material])
    cells.set(key, cell)
  }
  return [...cells.values()].map(({ origin, blocks: local }) => ({ origin, blocks: [...local.values()] }))
}
