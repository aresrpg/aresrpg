// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import type { CharacterRow, FightResolutionRow, FightStateRow } from '@aresrpg/protocol'

import { return_character_custody, type AgentReturnProjection } from '../src/agent_return_custody.ts'

const id = (n: number) => `0x${n.toString(16).padStart(64, '0')}`
const cap = { objectId: id(4), kioskId: id(5), version: '1', digest: 'fixture', isPersonal: true }
const fixture = (mode: 'fight' | 'dungeon' | 'kolizeum' | 'tournament', ended = false, placement = false) => {
  const calls: string[] = []
  let character = {
    id: id(1),
    kiosk: id(5),
    custody: 'fight',
    equipment: [],
    active_fight: { id: id(2), seat: 0 },
    ...(mode === 'dungeon' ? { dungeon_run: { dungeon: 'tangled_aftermath', room: 1 } } : {}),
  } as unknown as CharacterRow
  const fight: FightStateRow = {
    contract: { ended, round: placement ? 0 : 1 },
    players: {},
    kolizeum: mode === 'kolizeum' ? { id: id(3), pledge_mist: '0' } : null,
    tournament: mode === 'tournament' ? { id: id(3), index: 0 } : null,
  }
  const resolution = {
    fight: id(2),
    character: id(1),
    fighter: 0,
    settled: false,
    loot_types: [],
    boss_weight: 0,
    dungeon: mode === 'dungeon' ? 'tangled_aftermath' : null,
    kolizeum: fight.kolizeum?.id ?? null,
    tournament: fight.tournament,
  } as unknown as FightResolutionRow
  const snapshot = (): AgentReturnProjection => ({
    characters: [character],
    inventory: [],
    fights: { [id(2)]: fight },
    resolutions: ended ? [resolution] : [],
  })
  const sdk = {
    pins: { content_root: { id: id(61), shared_version: '1' }, seed_package_original: id(60) },
    game_type_package: id(9),
    tx: () => ({}),
    hydrate_unknown: async () => {},
    with_owner_kiosk: (_tx: unknown, _cap: unknown, compose: (kiosk: string, cap: string) => void) =>
      compose(cap.kioskId, cap.objectId),
    doors: new Proxy(
      {},
      {
        get: (_target, door: string) => () => {
          calls.push(door)
          return 'plan'
        },
      }
    ),
    execute: async () => {
      const gave_up = calls.at(-1) === 'give_up_dungeon_room_terminal' || calls.at(-1) === 'abandon_dungeon_run'
      character = {
        ...character,
        custody: 'kiosk',
        active_fight: undefined,
        ...(gave_up ? { dungeon_run: undefined } : {}),
      }
      return {
        Transaction: { digest: 'fixture-receipt', effects: { changedObjects: [] }, objectTypes: {}, events: [] },
      }
    },
  }
  const read = async (accept: (value: AgentReturnProjection) => boolean = () => true) => {
    expect(accept(snapshot())).toBe(true)
    return snapshot()
  }
  return { calls, sdk, read, character: () => character }
}

for (const [mode, door] of [
  ['fight', 'forfeit_fight_terminal'],
  ['dungeon', 'give_up_dungeon_room_terminal'],
  ['kolizeum', 'forfeit_kolizeum_terminal'],
  ['tournament', 'forfeit_tournament_match'],
] as const) {
  test(`active ${mode} uses the existing authorized exit`, async () => {
    const f = fixture(mode)
    await return_character_custody(f.sdk as never, async () => cap, id(8), f.read)
    expect(f.calls).toEqual([door])
    expect(f.character().active_fight).toBeUndefined()
  })
}

test('Kolizeum placement uses its refund exit, not the active-fight forfeit', async () => {
  const f = fixture('kolizeum', false, true)
  await return_character_custody(f.sdk as never, async () => cap, id(8), f.read)
  expect(f.calls).toEqual(['exit_kolizeum', 'close_kolizeum'])
})

test('ended dungeon settles custody, then abandons its remaining run', async () => {
  const f = fixture('dungeon', true)
  await return_character_custody(f.sdk as never, async () => cap, id(8), f.read)
  expect(f.calls).toEqual(['settle_last_dungeon_room', 'abandon_dungeon_run'])
  expect(f.character().dungeon_run).toBeUndefined()
})

test('ended ordinary fight settles rather than attempting a forbidden forfeit', async () => {
  const f = fixture('fight', true)
  await return_character_custody(f.sdk as never, async () => cap, id(8), f.read)
  expect(f.calls).toEqual(['settle_last_fight'])
})
