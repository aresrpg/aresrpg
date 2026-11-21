// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The adapter of the game's character and jobs tabs for a hero of the bot account: what it never sends,
// then the bot's exact payload for each change and each craft, and what the reducer makes of it.
import { expect, test } from 'bun:test'
import type { CharacterRow, EquippedItem, ItemRow } from '@aresrpg/protocol'

import { equipment_map_of, stage_equip, stage_unequip } from '../../src/characters/equipment_stage.ts'
import { equip_payload, hero_editable, hero_session, type HeroDirect } from '../../src/dapp/hero_session.ts'
import type { DirectRequest } from '../../src/dapp/direct.ts'
import { initial_dapp_state, reduce_dapp, type DappState } from '../../src/dapp/state.ts'

import { HERO, account_fixture, character_fixture, hero_id, observation_fixture } from './fixtures.ts'

const KIOSK = '0xkiosk'
const item = (id: string, category: string, overrides: Partial<ItemRow> = {}): ItemRow => ({
  id,
  version: '1',
  name: id,
  item_type: id,
  category,
  level: 1,
  amount: 1,
  kiosk: KIOSK,
  ...overrides,
})
const worn = (row: ItemRow, slot: EquippedItem['slot']): EquippedItem => {
  const { kiosk: _kiosk, ...rest } = row
  return { ...rest, slot }
}
const HAT = item(hero_id('a'), 'hat')
const OLD_HAT = item(hero_id('b'), 'hat')
const BELT = item(hero_id('c'), 'belt')
const bare = character_fixture()
const hatted = character_fixture({ equipment: [worn(OLD_HAT, 'hat')] })

const ready = (dapp: Partial<DappState> = {}): DappState => ({
  ...initial_dapp_state(),
  link: { phase: 'connected' },
  observation: observation_fixture(),
  ...dapp,
})
const open_request = (status: DirectRequest['status']): DirectRequest => ({
  id: 'r1',
  action: 'raise_stats',
  hero_id: HERO,
  payload: {},
  item_type: null,
  amount: 0,
  after: null,
  proof: null,
  status,
  error: null,
})

const WHY = 'This hero cannot change now.'
/** A session whose requests, refusals and looks at another hero are recorded instead of sent. */
const recorded = (hero: CharacterRow, editable: boolean) => {
  const sent: HeroDirect[] = []
  const refused: number[] = []
  const looked: string[] = []
  const session = hero_session({
    hero,
    items: [HAT, BELT],
    roster: { characters: [hero], select: (hero_id) => void looked.push(hero_id) },
    editable,
    locked: WHY,
    send: (request) => void sent.push(request),
    refuse: () => void refused.push(1),
  })
  return { session, sent, refused, looked }
}

test('a hero cannot change before the bot answered, while it is held, or while a request is open', () => {
  const linked = { ...initial_dapp_state(), link: { phase: 'connected' as const } }
  expect(hero_editable(initial_dapp_state(), bare)).toBe(false)
  expect(hero_editable(linked, bare)).toBe(false)
  expect(hero_editable(ready({ observation: observation_fixture({ status: 'pending' }) }), bare)).toBe(false)

  const fighting = character_fixture({ active_fight: { id: 'fight', seat: 0 } as CharacterRow['active_fight'] })
  const raiding = character_fixture({ dungeon_run: { dungeon: 'd' } as CharacterRow['dungeon_run'] })
  const ambushed = character_fixture({ ambush: {} as CharacterRow['ambush'] })
  const away = character_fixture({ custody: 'fight' as CharacterRow['custody'] })
  for (const held of [fighting, raiding, ambushed, away]) expect(hero_editable(ready(), held)).toBe(false)

  for (const status of ['pending', 'accepted', 'uncertain'] as const)
    expect(hero_editable(ready({ direct: open_request(status) }), bare)).toBe(false)
  // The bot's own word counts too: a direct command it still holds, whoever sent it.
  for (const status of ['accepted', 'executing']) {
    const direct = { id: 'c1', kind: 'market_collect', status, payload: {} }
    expect(hero_editable(ready({ observation: observation_fixture({ direct }) }), bare)).toBe(false)
  }
})

test('a free hero can change, also while the bot plays it, and again once a request is resolved', () => {
  expect(hero_editable(ready(), bare)).toBe(true)
  for (const status of ['done', 'refused'] as const)
    expect(hero_editable(ready({ direct: open_request(status) }), bare)).toBe(true)
  const direct = { id: 'c1', kind: 'market_collect', status: 'completed', payload: {} }
  expect(hero_editable(ready({ observation: observation_fixture({ direct }) }), bare)).toBe(true)
  const run = { id: 'run', character_id: HERO, status: 'active' }
  expect(hero_editable(ready({ observation: observation_fixture({ runs: [run] }) }), bare)).toBe(true)
})

test('a locked session sends nothing: it says why, a spell offers no raise, and a craft is locked with the reason', () => {
  const { session, sent, refused } = recorded(bare, false)
  expect(session.raise_spell).toBeUndefined()
  session.raise_stats({ vitality: 1, wisdom: 0, strength: 0, intelligence: 0, chance: 0, agility: 0 })
  session.commit(stage_equip(equipment_map_of(bare), HAT, 'hat'))
  expect(sent).toEqual([])
  expect(refused).toHaveLength(2)
  // The craft control stays on screen, closed, with the sentence that says why; a forced gesture sends nothing.
  expect(session.craft?.locked).toBe(WHY)
  session.craft?.run('wheat_flour', 1)
  expect(sent).toEqual([])
  expect(refused).toHaveLength(3)
})

test('gear that differs in no slot, or in several, is no single request', () => {
  const real = equipment_map_of(hatted)
  expect(equip_payload(hatted, real)).toBeNull()
  expect(equip_payload(hatted, stage_equip(stage_unequip(real, 'hat'), BELT, 'belt'))).toBeNull()
  const { session, sent, refused } = recorded(hatted, true)
  session.commit(real)
  session.commit(stage_equip(stage_unequip(real, 'hat'), BELT, 'belt'))
  expect(sent).toEqual([])
  expect(refused).toEqual([])
})

test('a stat change and a spell rank are one request each, with the bot’s exact payload', () => {
  const { session, sent } = recorded(bare, true)
  const spending = { vitality: 2, wisdom: 0, strength: 0, intelligence: 3, chance: 0, agility: 0 }
  session.raise_stats(spending)
  session.raise_spell?.('fireball')
  expect(sent).toEqual([
    { action: 'raise_stats', payload: { character_id: HERO, spending } },
    { action: 'raise_spell', payload: { character_id: HERO, spell: 'fireball' } },
  ])
})

test('a craft is one request with the bot’s exact payload: the hero, the recipe and the tries', () => {
  const { session, sent, refused, looked } = recorded(bare, true)
  expect(session.craft?.locked).toBeNull()
  session.craft?.run('wheat_flour', 3)
  expect(sent).toEqual([{ action: 'craft', payload: { character_id: HERO, output_type: 'wheat_flour', attempts: 3 } }])
  expect(Object.keys(sent[0]!.payload)).toEqual(['character_id', 'output_type', 'attempts'])
  expect(refused).toEqual([])
  // The bag the recipes are checked against is this hero's own, and the roster is the one it was given.
  expect(session.inventory).toEqual([HAT, BELT])
  session.roster?.select(hero_id('2'))
  expect(looked).toEqual([hero_id('2')])
  // The reducer takes it as the one direct request, named after the recipe and its tries.
  const account = account_fixture({ characters: [bare] })
  const asked = reduce_dapp(ready(), { type: 'dapp/hero_direct', id: 'c1', hero_id: HERO, ...sent[0]! }, account)
  expect(asked.direct).toMatchObject({
    id: 'c1',
    action: 'craft',
    hero_id: HERO,
    payload: { character_id: HERO, output_type: 'wheat_flour', attempts: 3 },
    item_type: 'wheat_flour',
    amount: 3,
    status: 'pending',
  })
  // While it is open the hero is locked, and a second craft changes nothing.
  expect(hero_editable(asked, bare)).toBe(false)
  expect(reduce_dapp(asked, { type: 'dapp/hero_direct', id: 'c2', hero_id: HERO, ...sent[0]! }, account)).toBe(asked)
})

test('wearing an item, swapping one and emptying a slot are one equip_item each', () => {
  const free = recorded(bare, true)
  free.session.commit(stage_equip(equipment_map_of(bare), HAT, 'hat'))
  expect(free.sent).toEqual([{ action: 'equip_item', payload: { character_id: HERO, slot: 'hat', item_id: HAT.id } }])

  // A swap names only the item to wear: the bot takes off the occupant in the same transaction.
  const swap = recorded(hatted, true)
  swap.session.commit(stage_equip(equipment_map_of(hatted), HAT, 'hat'))
  expect(swap.sent).toEqual([{ action: 'equip_item', payload: { character_id: HERO, slot: 'hat', item_id: HAT.id } }])

  // Emptying a slot is the same command without an item.
  const empty = recorded(hatted, true)
  empty.session.commit(stage_unequip(equipment_map_of(hatted), 'hat'))
  expect(empty.sent).toEqual([{ action: 'equip_item', payload: { character_id: HERO, slot: 'hat' } }])
  expect(Object.keys(empty.sent[0]!.payload)).toEqual(['character_id', 'slot'])
})

test('each request fills the one direct slot of the reducer, and a second one waits its turn', () => {
  const account = account_fixture({ characters: [hatted], items: [HAT, BELT] })
  const { session, sent } = recorded(hatted, true)
  session.commit(stage_equip(equipment_map_of(hatted), HAT, 'hat'))
  session.raise_stats({ vitality: 1, wisdom: 0, strength: 0, intelligence: 0, chance: 0, agility: 0 })
  const [equip, stats] = sent
  const asked = reduce_dapp(ready(), { type: 'dapp/hero_direct', id: 'r1', hero_id: HERO, ...equip! }, account)
  expect(asked.direct).toMatchObject({
    id: 'r1',
    action: 'equip_item',
    hero_id: HERO,
    payload: { character_id: HERO, slot: 'hat', item_id: HAT.id },
    item_type: HAT.item_type,
    status: 'pending',
  })
  // The request is open: the hero is locked, and the reducer takes no other request meanwhile.
  expect(hero_editable(asked, hatted)).toBe(false)
  const again = reduce_dapp(asked, { type: 'dapp/hero_direct', id: 'r2', hero_id: HERO, ...stats! }, account)
  expect(again.direct).toBe(asked.direct)
})
