// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The single frontend import boundary for the authored world corpus.

import worlds from '../../../../seed/content/worlds.json'

export const worlds_source = Object.freeze(worlds)

/** Resolve authored terrain by world identity. The first authored recipe is only the guest/default
 * world; a named world never borrows another world's terrain. */
export const world_terrain = (world_name: string | null): unknown | null => {
  const world =
    world_name === null
      ? worlds_source.find(({ terrain }) => terrain !== undefined)
      : worlds_source.find(({ world: name }) => name === world_name)
  return world?.terrain ?? null
}
