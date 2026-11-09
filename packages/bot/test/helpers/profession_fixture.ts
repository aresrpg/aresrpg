// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { CharacterRow, ItemRow } from '@aresrpg/protocol'
import { gatherable_of } from '@aresrpg/immutable'

import { profession_recipes, recipe_job } from '../../src/profession_catalog.ts'
import { empty_snapshot } from '../../src/actor_snapshot.ts'
import { empty_inventory } from '../../src/actor_inventory.ts'
import type { ProfessionPlan } from '../../src/profession_plan.ts'
import type { GameplayContext } from '../../src/gameplay.ts'
import { id } from '../../../sdk/test/helpers/transport.ts'

// Derived from authored content instead of pinning mutable recipe balance in tests.
export const recipe = profession_recipes.find(
  (row) =>
    Object.keys(row.inputs).length === 2 &&
    Object.keys(row.inputs).some((item_type) => gatherable_of(item_type)?.tier === 1)
)!
export const resource = Object.keys(recipe.inputs)
  .map(gatherable_of)
  .find((row) => row?.tier === 1)!
export const other_input = Object.keys(recipe.inputs).find((item_type) => item_type !== resource.item_type)!
export const character: CharacterRow = {
  id: id(20),
  name: 'Profession fixture',
  classe: 'senshi',
  sex: 'male',
  level: 10,
  experience: '0',
  color_1: 0,
  color_2: 0,
  color_3: 0,
  vitality: 0,
  wisdom: 0,
  strength: 0,
  intelligence: 0,
  chance: 0,
  agility: 0,
  available_points: 0,
  spells: {},
  available_spell_points: 0,
  jobs: {},
  world: 'fixture',
  checkpoint_world: 'fixture',
  x: 50000,
  z: 50000,
  at_ms: 0,
  kiosk: id(12),
  kiosk_cap: id(13),
  custody: 'kiosk',
  equipment: [
    {
      id: id(15),
      slot: 'tool',
      item_type: 'fixture_tool',
      name: 'Fixture tool',
      category: `tool_${resource.job.toLowerCase()}`,
      level: 1,
      amount: 1,
    },
  ],
}
export const item = (item_type: string, amount: number, number = 30): ItemRow => ({
  id: id(number),
  item_type,
  name: item_type,
  category: 'resource',
  level: 1,
  amount,
  kiosk: character.kiosk,
  version: '1',
})
export const plan: ProfessionPlan = {
  character_id: character.id,
  job: recipe_job(recipe.output_type)!,
  target_level: 2,
  recipe_output: recipe.output_type,
  gather_item_types: [resource.item_type],
  max_actions: 10,
  deadline_ms: 1000000,
}
export const profession_context = (): GameplayContext => ({
  address: id(99),
  now: 63000,
  freshness_ms: 60000,
  command: {
    id: 'fixture',
    grant_id: 'grant',
    bot_id: 'bot',
    lane_key: 'lane',
    fingerprint: 'fixture',
    kind: 'observe',
    payload: {},
    observation_revision: 1,
    decision_revision: 0,
    status: 'accepted',
  },
  snapshot: {
    ...empty_snapshot(),
    characters: [character],
    ready: true,
    frozen: false,
    indexing_lag: 0,
    clock: { chain_ms: 63000, observed_at: 63000 },
    observed_at: 63000,
    observation_revision: 1,
    inventory: { ...empty_inventory(), loaded: true, listings: [], trades: [], items: [item(other_input, 100)] },
    tracked_zones: {
      [character.id]: {
        type: 'packet/tracked_zones',
        character_id: character.id,
        world: character.world!,
        zones: [{ zx: 97, zz: 97 }],
      },
    },
    zones: {
      'fixture:97:97': {
        zone: { world: 'fixture', zx: 97, zz: 97, seed: '1', searched_at_ms: 0, mob_taken: '0', res_taken: [] },
        spawns: {
          type: 'packet/zone_spawns',
          world: 'fixture',
          zx: 97,
          zz: 97,
          mobs: [],
          resources: [{ index: 0, x: 50000, z: 50000, item_type: resource.item_type, nodes: 20 }],
        },
      },
    },
  },
})
