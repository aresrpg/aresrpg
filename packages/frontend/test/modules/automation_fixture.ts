// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { CharacterRow } from '@aresrpg/protocol'

import { gathering_resources } from '../../src/modules/automation_route.ts'
import { reduce_automation } from '../../src/modules/automation.ts'
import type { AutomationInput } from '../../src/modules/automation_state.ts'
import { initial_app_state, type AppState } from '../../src/store.ts'

export const resource = gathering_resources('nauvis').find(({ tier }) => tier === 1)!
export const character = (): CharacterRow => ({
  id: 'alice',
  name: 'Test',
  classe: 'senshi',
  sex: 'male',
  experience: '0',
  level: 1,
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
  kiosk: 'kiosk',
  custody: 'kiosk',
  world: 'nauvis',
  checkpoint_world: 'nauvis',
  x: 50_000,
  z: 50_000,
  at_ms: 1,
  equipment: [{ slot: 'tool', category: `tool_${resource.job.toLowerCase()}` }] as CharacterRow['equipment'],
})
export const key = 'nauvis:97:97'
export const automation_fixture = (): AppState => {
  const base = initial_app_state({ quality: 'medium', flat_mode: false, music_enabled: false, render_distance: null })
  const state: AppState = {
    ...base,
    session: {
      ...base.session,
      selected_character_id: 'alice',
      characters: [character()],
      link_status: 'ready',
      indexing_lag: 0,
      game_frozen: false,
      wallet: { address: 'owner' } as AppState['session']['wallet'],
    },
    automation: { ...base.automation, unlocked: true, item_type: resource.item_type },
    world: {
      ...base.world,
      tracked_world: 'nauvis',
      windows: { alice: { world: 'nauvis', zones: [{ zx: 97, zz: 97 }] } },
      zones: {
        [key]: { world: 'nauvis', zx: 97, zz: 97, seed: '1', searched_at_ms: 1, mob_taken: '0', res_taken: [] },
      },
      spawns: {
        [key]: { mobs: [], resources: [{ index: 0, x: 50_000, z: 50_000, item_type: resource.item_type, nodes: 2 }] },
      },
    },
  }
  return reduce_automation(state, { type: 'automation/start', id: 'run-one' })
}
export const tick = (now_ms = 1_000): Extract<AutomationInput, { type: 'automation/tick' }> => ({
  type: 'automation/tick',
  monotonic_ms: now_ms,
  world_ms: 100_000 + now_ms,
  pose: { character_id: 'alice', x: 0, y: 0, z: 0, yaw: 0, riding: false, time_of_day: 0 },
})
export const ready_to_gather = (): AppState => {
  const planned = reduce_automation(automation_fixture(), tick())
  return reduce_automation(planned, tick(1_250))
}
