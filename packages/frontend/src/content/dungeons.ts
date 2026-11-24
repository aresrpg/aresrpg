// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { dungeon_content_id } from '@aresrpg/sdk/seed-ids'
import { resolve_pins } from '@aresrpg/sdk/pins'

import source from '../../../../seed/content/dungeons.json'
import { env } from '../env.ts'

export type SeedDungeon = Readonly<{
  dungeon: string
  key: string
  rooms: readonly (readonly Readonly<{ mob_type: string }>[])[]
}>

/** Dungeon-only consumers import this table alone, not the gameplay catalogue. */
export const dungeons = Object.freeze(source as unknown as readonly SeedDungeon[])

const dungeon_ids = (() => {
  let value: ReadonlyMap<string, string> | null = null
  return (): ReadonlyMap<string, string> => {
    if (value) return value
    const pins = resolve_pins(env.network) as { content_root?: { id?: string }; seed_package_original?: string }
    const content_root = pins?.content_root?.id
    const seed_original = pins?.seed_package_original
    value = new Map(
      content_root && seed_original
        ? dungeons.map(({ dungeon }) => [dungeon_content_id(content_root, seed_original, dungeon), dungeon])
        : []
    )
    return value
  }
})()

/** A dungeon's slug from its on-chain content id, on the network this build targets. */
export const dungeon_slug = (dungeon_id: string): string | null => dungeon_ids().get(dungeon_id) ?? null
