// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// What the agent page observes, as plain rows. Nothing here loads the store: the log's model is pure.
import type { AgentStatus, CharacterRow, FightResolutionRow } from '@aresrpg/protocol'

import type { AgentInventoryView } from '../../src/agents/inventory_state.ts'

export type Account = Pick<AgentInventoryView, 'phase' | 'characters' | 'resolutions' | 'status'>
const hero = (id: string, name: string, changes: Partial<CharacterRow>): CharacterRow => ({
  id,
  name,
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
  equipment: [],
  ...changes,
})
export const mira = (changes: Partial<CharacterRow> = {}): CharacterRow => hero('mira', 'Mira', changes)
export const bran = (changes: Partial<CharacterRow> = {}): CharacterRow => hero('bran', 'Bran', changes)
export const pushed = (changes: Partial<AgentStatus> = {}): AgentStatus => ({
  ready: true,
  event_fence: 1,
  sampled_at: 1,
  state: 'idle',
  runs: [],
  direct: null,
  ...changes,
})
export const account = (changes: Partial<Account> = {}): Account => ({
  phase: 'ready',
  characters: [mira()],
  resolutions: [],
  status: pushed(),
  ...changes,
})
export const result = (changes: Partial<FightResolutionRow> = {}): FightResolutionRow => ({
  fight: 'fight',
  world: 'nauvis',
  dungeon: null,
  dungeon_room: null,
  kolizeum: null,
  fighter: 0,
  character: 'mira',
  team: 0,
  winner: null,
  dead: false,
  settled: false,
  boss_weight: 0,
  kares: '0',
  loot_types: [],
  drops: [],
  ...changes,
})
export const run = (changes: Partial<AgentStatus['runs'][number]> = {}): AgentStatus['runs'][number] => ({
  id: 'run',
  character_id: 'mira',
  status: 'active',
  objective: { title: 'Herbalist level 30' },
  ...changes,
})
export const direct = (status: string, error?: string): NonNullable<AgentStatus['direct']> => ({
  id: 'command',
  kind: 'market_buy',
  status,
  ...(error ? { error } : {}),
  payload: { character_id: 'mira' },
})
