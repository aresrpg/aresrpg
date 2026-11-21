// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The facts of a raid, without any view: what a dungeon holds, who a team is and how its raid went.
// Seed facts are read from the catalogue itself, so a seed change cannot leave a stale number here.
import { expect, test } from 'bun:test'

import { content_catalog } from '../../src/content/catalog.ts'
import { dungeon_rooms, rarest_drop } from '../../src/dapp/places.ts'
import { finish_position, open_position, type DappPosition, type FightResult } from '../../src/dapp/positions.ts'
import {
  boss_name,
  drop_rooms,
  dungeon_boss,
  dungeon_gates,
  enter_step,
  key_quest_inputs,
  key_quest_place,
  party_fights,
  party_loot,
  raid_again,
  raid_ladder,
  raid_parties,
  raid_starting,
  raid_verdict,
  room_drops,
  room_title,
  seat_taken,
  team_pick,
  type RaidText,
} from '../../src/dapp/raid.ts'
import { initial_dapp_state, reduce_dapp, type DappState } from '../../src/dapp/state.ts'
import { EMPTY_PLAN, type ActivityPlan, type StartSpec } from '../../src/dapp/strategies.ts'

import { HERO, account_fixture, character_fixture, hero_id, item_fixture, observation_fixture } from './fixtures.ts'

const lorito = content_catalog.dungeon('gilded_lorito')!
const ROOMS = lorito.rooms.length
const SECOND = hero_id('2')
const mira = character_fixture()
const okami = character_fixture({ id: SECOND, name: 'Okami', level: 7 })
/** The page's words stand in for themselves: a title is its key and its values. */
const text: RaidText = (key, values = {}) => [key, ...Object.values(values)].join(' ')
const SPEC: Extract<StartSpec, { activity: 'raid' }> = {
  activity: 'raid',
  dungeon: lorito.dungeon,
  hero_ids: [HERO, SECOND],
  runs: null,
  fee_cap_mist: null,
}
const raiding = (hero: string, overrides: Partial<DappPosition> = {}): DappPosition => ({
  ...open_position(hero, 1_000, [mira, okami], { activity: 'raid', sent: SPEC }),
  ...overrides,
})
const fight = (id: string, room: number | null, won: boolean, qty = 0): FightResult => ({
  fight: id,
  won,
  room,
  drops: qty ? [{ item_type: 'wheat', qty }] : [],
})
const answered: DappState = {
  ...initial_dapp_state(),
  link: { phase: 'connected' },
  observation: observation_fixture(),
}

test('a seat is taken in place or after the last one, and Enter never sends a plan that starts nobody', () => {
  expect(seat_taken(['a', 'b'], 0, 'c')).toEqual(['c', 'b'])
  expect(seat_taken(['a', 'b'], 5, 'c')).toEqual(['a', 'b', 'c'])
  const start = { hero_id: HERO, script: {} as ActivityPlan['starts'][number]['script'], walks: false }
  expect(enter_step(EMPTY_PLAN)).toBe('blocked')
  expect(enter_step({ ...EMPTY_PLAN, missing_keys: { [lorito.key]: 1 } })).toBe('blocked')
  // A team short of keys is confirmed before anything is sent.
  expect(enter_step({ ...EMPTY_PLAN, starts: [start], missing_keys: { [lorito.key]: 1 } })).toBe('confirm')
  expect(enter_step({ ...EMPTY_PLAN, starts: [start] })).toBe('send')
})

test('a dungeon is named by its boss, entered from its city, and its rooms are counted from the seed', () => {
  const boss = dungeon_boss(lorito)!
  expect(content_catalog.mob(boss.mob_type)?.mob.role).toBe('boss')
  expect(boss_name(lorito)).toBe(boss.name)
  expect(dungeon_gates(lorito.dungeon)).toEqual({ world: 'nauvis', city: 'thebes' })
  expect(dungeon_gates('no_such_dungeon')).toBeNull()
  expect(room_title(text, lorito, 2)).toBe(`raid_room 2 ${ROOMS}`)
  expect(room_title(text, lorito, ROOMS)).toBe(`raid_boss_room ${boss.name}`)
  expect(drop_rooms(text, lorito, [1, 4])).toBe('raid_rooms 1 4')
  expect(drop_rooms(text, lorito, [3])).toBe('drops_room 3')
  expect(drop_rooms(text, lorito, [ROOMS])).toBe('drops_boss_room')
})

test('what a run can drop lists every item once, rarest first, and the rarest of the boss room leads', () => {
  const rooms = dungeon_rooms(lorito)
  const drops = room_drops(rooms)
  const rates = drops.map(({ chance_bp }) => chance_bp)
  expect(new Set(drops.map(({ item_type }) => item_type)).size).toBe(drops.length)
  expect(rates).toEqual(rates.toSorted((left, right) => left - right))
  expect(raid_ladder(rooms)).toHaveLength(drops.length)
  expect(raid_ladder(rooms)[0]!.item_type).toBe(rarest_drop(rooms.at(-1)!.mob_types)!.item_type)
})

test('a key is quested for where its monster lives, and the player still picks who goes', () => {
  const place = key_quest_place(lorito.key)
  expect(place).toMatchObject({ world: 'nauvis' })
  expect(key_quest_inputs(lorito.key)).toEqual([
    { type: 'dapp/quest_pick', pick: { kind: 'fight', place: place! } },
    { type: 'dapp/tab', tab: 'quest' },
  ])
  // A key nothing drops names no place: the Quest tab opens on fights, where each hero stands.
  expect(key_quest_place('no_such_key')).toBeNull()
  expect(key_quest_inputs('no_such_key')[0]).toEqual({ type: 'dapp/quest_pick', pick: { kind: 'fight' } })
})

test('heroes one Start sent are one team; running and finished teams stay apart, as do other activities', () => {
  const found = raiding(SECOND, { id: 'found', sent: null })
  const quest = { ...raiding(HERO, { id: 'quest' }), activity: 'train' as const }
  const over = finish_position(raiding(HERO, { id: 'over' }), 9_000)
  const parties = raid_parties([raiding(HERO), raiding(SECOND, { id: 'two' }), found, quest, over], [mira, okami])
  expect(parties.map(({ live, sent, positions }) => [live, sent, positions.map(({ id }) => id)])).toEqual([
    [true, SPEC, [raiding(HERO).id, 'two']],
    // A run this page only observed, whose hero stands in no dungeon, names none.
    [true, null, ['found']],
    [false, SPEC, ['over']],
  ])
  expect(parties.map(({ dungeon }) => dungeon?.dungeon ?? null)).toEqual([lorito.dungeon, null, lorito.dungeon])
  // The setup takes a team back as it was sent, or as it was found.
  expect(team_pick(parties[0]!)).toEqual({
    dungeon: lorito.dungeon,
    hero_ids: [HERO, SECOND],
    runs: null,
    fee_cap_mist: null,
  })
  expect(team_pick(parties[1]!)).toEqual({ hero_ids: [SECOND] })
})

test('a raid is won by its boss room, lost by any other lost room, and says nothing before either', () => {
  const team = (...results: readonly FightResult[]) => ({ dungeon: lorito, positions: [raiding(HERO, { results })] })
  expect(raid_verdict(team())).toBeNull()
  expect(raid_verdict(team(fight('f1', 1, true)))).toBeNull()
  expect(raid_verdict(team(fight('f1', 1, true), fight('f2', 2, false)))).toBe('lost')
  expect(raid_verdict(team(fight('f2', 2, false), fight('f8', ROOMS, true)))).toBe('won')
  // A fight outside the rooms is not the raid's: it decides nothing.
  expect(raid_verdict(team(fight('walk', null, false)))).toBeNull()
  // Loot is summed by item across the team; fights are counted once, whoever of the team fought them.
  const totals = { ...raiding(HERO).totals, won: ['f1'], lost: ['f2'] }
  const positions = [
    raiding(HERO, { totals, results: [fight('f1', 1, true, 2), fight('walk', null, true, 5)] }),
    raiding(SECOND, { totals, results: [fight('f1', 1, true, 2)] }),
  ]
  expect(party_loot(positions, true)).toEqual([{ item_type: 'wheat', qty: 4 }])
  expect(party_loot(positions, false)).toEqual([{ item_type: 'wheat', qty: 9 }])
  expect(party_fights(positions)).toEqual({ won: 1, lost: 1 })
})

test('the same raid again is ready only when the whole team can go, and counts the keys it lacks', () => {
  const party = { sent: SPEC, positions: [finish_position(raiding(HERO, { objective: 'Hunt' }), 9_000)] }
  const account = (keys: number) =>
    account_fixture({ characters: [mira, okami], items: keys ? [item_fixture(lorito.key, keys)] : [] })
  expect(raid_again(answered, account(2), { ...party, sent: null }, 'Raid')).toBeNull()
  expect(raid_again(answered, account(2), party, 'Raid')).toEqual({
    spec: SPEC,
    title: 'Hunt',
    missing: 0,
    ready: true,
  })
  expect(raid_again(answered, account(1), party, 'Raid')).toMatchObject({ missing: 1, ready: false })
  // Before the bot answered nothing is ready, and no key is claimed missing.
  expect(raid_again({ ...answered, observation: null }, account(2), party, 'Raid')).toMatchObject({
    missing: 0,
    ready: false,
  })
  // A raid start the bot has not answered belongs to no position yet: its heroes are named apart.
  const asked = reduce_dapp(answered, { type: 'dapp/start', id: 'c', spec: SPEC, title: 'Hunt' }, account(2))
  expect(raid_starting(asked)).toEqual([HERO, SECOND])
  expect(raid_starting(answered)).toEqual([])
})
