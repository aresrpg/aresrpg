// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { ZONE_SIZE, type CharacterRow, type MobGroupRow } from '@aresrpg/protocol'

import type { GameplayContext } from '../../src/gameplay.ts'
import type { BehaviorRun, BehaviorScript } from '../../src/behavior_script.ts'
import { empty_behavior_memory } from '../../src/behavior_tree.ts'

import { character, profession_context } from './profession_fixture.ts'

/** A hero of the real seed world, placed by zone, with the three by three window the server tracks. */
export const WORLD = 'nauvis'
const NOW = 600_000
type Zone = Readonly<{ zx: number; zz: number }>
const center = (index: number) => (index + 0.5) * ZONE_SIZE
export const hero_in = (zone: Zone, patch: Partial<CharacterRow> = {}): CharacterRow => ({
  ...character,
  world: WORLD,
  checkpoint_world: WORLD,
  x: center(zone.zx),
  z: center(zone.zz),
  at_ms: 0,
  ...patch,
})
const window_of = ({ zx, zz }: Zone): readonly Zone[] =>
  [-1, 0, 1].flatMap((dx) => [-1, 0, 1].map((dz) => ({ zx: zx + dx, zz: zz + dz })))
/** The hero's world as its bot observes it: every tracked zone searched, holding the given mob groups. */
export const world_context = (
  hero: CharacterRow,
  groups: Readonly<Record<string, readonly MobGroupRow[]>> = {}
): GameplayContext => {
  const base = profession_context()
  const here = { zx: Math.floor(hero.x! / ZONE_SIZE), zz: Math.floor(hero.z! / ZONE_SIZE) }
  const zones = hero.world === WORLD ? window_of(here) : []
  const row = ({ zx, zz }: Zone) => ({
    zone: { world: WORLD, zx, zz, seed: '1', searched_at_ms: 0, mob_taken: '0', res_taken: [] },
    spawns: {
      type: 'packet/zone_spawns' as const,
      world: WORLD,
      zx,
      zz,
      resources: [],
      mobs: [...(groups[`${zx}:${zz}`] ?? [])],
    },
  })
  return {
    ...base,
    now: NOW,
    snapshot: {
      ...base.snapshot,
      characters: [hero],
      clock: { chain_ms: NOW, observed_at: NOW },
      observed_at: NOW,
      tracked_zones: {
        [hero.id]: { type: 'packet/tracked_zones', character_id: hero.id, world: hero.world!, zones: [...zones] },
      },
      zones: Object.fromEntries(zones.map((zone) => [`${WORLD}:${zone.zx}:${zone.zz}`, row(zone)])),
    },
  }
}
/** A group of `size` mobs of one type standing at the centre of a zone. */
export const group_in = (zone: Zone, index: number, mob_type: string, size: number): MobGroupRow => ({
  index,
  x: center(zone.zx) + index,
  z: center(zone.zz),
  members: Array.from({ length: size }, () => ({ mob_type, level_scalar: 0 })),
})
export const run_of = (script: BehaviorScript, patch: Partial<BehaviorRun> = {}): BehaviorRun => ({
  id: 'run',
  bot_id: 'bot',
  grant_id: 'grant',
  lane_key: 'lane',
  character_id: character.id,
  fingerprint: 'fixture',
  script,
  revision: 1,
  memory: empty_behavior_memory(),
  pending_node: null,
  activation: null,
  consumed_command_id: null,
  status: 'active',
  actions_started: 0,
  last_command_id: null,
  created_at: 0,
  ...patch,
})
