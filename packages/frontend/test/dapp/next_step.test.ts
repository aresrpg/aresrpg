// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import dungeons from '../../../../seed/content/dungeons.json'
import worlds from '../../../../seed/content/worlds.json'
import type { DappAccount } from '../../src/dapp/account.ts'
import {
  dungeon_keys,
  keys_held,
  next_step,
  proposed_dungeon,
  proposed_team,
  raid_spec,
} from '../../src/dapp/next_step.ts'
import { initial_dapp_state, reduce_dapp, type DappInput, type DappState } from '../../src/dapp/state.ts'
import { RAID_TEAM } from '../../src/dapp/strategies.ts'

import {
  HERO,
  account_fixture,
  character_fixture,
  hero_id,
  item_fixture,
  observation_fixture,
  run_fixture,
} from './fixtures.ts'

const [thebes] = worlds.find(({ world }) => world === 'nauvis')!.cities
const [lorito, tangled] = dungeons
const SECOND = hero_id('2')
const team = [character_fixture(), character_fixture({ id: SECOND, name: 'Bran', level: 7 })]
const holding = (items: readonly object[], more: Parameters<typeof account_fixture>[0] = {}) =>
  account_fixture({ characters: team, items, ...more })
const fold_under =
  (account: DappAccount) =>
  (state: DappState, ...inputs: readonly DappInput[]) =>
    inputs.reduce((next, input) => reduce_dapp(next, input, account), state)
const observed = (overrides: Readonly<Record<string, unknown>>, requested_ms: number): DappInput => ({
  type: 'dapp/observed',
  observation: observation_fixture(overrides),
  requested_ms,
  now: requested_ms,
})
const NONE = holding([])
const connected = fold_under(NONE)(
  initial_dapp_state(),
  { type: 'dapp/link', link: { phase: 'connected' } },
  observed({}, 100)
)
const out = (...heroes: readonly string[]) =>
  observed({ observation_revision: 11, runs: heroes.map((hero) => run_fixture(hero)) }, 200)

test('the keys a raid can burn are counted by dungeon, as the bot counts them', () => {
  const keys = holding([item_fixture(lorito!.key, 2), item_fixture(tangled!.key, 1, 'tangled')])
  expect(dungeon_keys(keys)).toMatchObject({ [lorito!.dungeon]: 2, [tangled!.dungeon]: 1 })
  expect(Object.keys(dungeon_keys(keys))).toEqual(dungeons.map(({ dungeon }) => dungeon))
  // A key a listing locks, and a key in a kiosk no hero holds, cannot be burnt.
  expect(
    dungeon_keys(holding([item_fixture(lorito!.key, 2)], { listings: [{ id: `${lorito!.key}-1` }] }))[lorito!.dungeon]
  ).toBe(0)
  expect(dungeon_keys(holding([{ ...item_fixture(lorito!.key, 2), kiosk: '0xother' }]))[lorito!.dungeon]).toBe(0)
  // A bag still being read counts nothing at all.
  expect(dungeon_keys(holding([item_fixture(lorito!.key, 2)], { phase: 'loading' }))).toEqual({})
  // The header counts the keys of every dungeon, and claims no count before the bag is read.
  expect(keys_held(keys)).toBe(3)
  expect(keys_held(NONE)).toBe(0)
  expect(keys_held(holding([item_fixture(lorito!.key, 2)], { phase: 'loading' }))).toBeNull()
})

test('the Raid tab proposes: the dungeon whose key is held, and the strongest free heroes the key rule lets in', () => {
  // No key at all: the first dungeon of the seed. A key of another one: that one. A choice wins over both.
  expect(proposed_dungeon(connected, NONE)).toBe(lorito!.dungeon)
  const keyed = holding([item_fixture(tangled!.key, 1)])
  expect(proposed_dungeon(connected, keyed)).toBe(tangled!.dungeon)
  const chosen = fold_under(keyed)(connected, { type: 'dapp/raid_pick', pick: { dungeon: lorito!.dungeon } })
  expect(proposed_dungeon(chosen, keyed)).toBe(lorito!.dungeon)
  const unknown = fold_under(keyed)(connected, { type: 'dapp/raid_pick', pick: { dungeon: 'no_such_dungeon' } })
  expect(proposed_dungeon(unknown, keyed)).toBe(tangled!.dungeon)
  // Eight free heroes of rising level and keys for all: the six strongest, strongest first.
  const crowd = Array.from({ length: 8 }, (_, index) =>
    character_fixture({ id: hero_id(String(index + 1)), level: index + 1, x: thebes!.x, z: thebes!.z })
  )
  const rich = account_fixture({ characters: crowd, items: [item_fixture(lorito!.key, 8)] })
  const strongest = crowd.toReversed().map(({ id }) => id)
  expect(proposed_team(connected, rich, lorito!.dungeon).map(({ id }) => id)).toEqual(strongest.slice(0, RAID_TEAM))
  // Two keys: the two strongest. A hero that is out is not proposed; the next one takes its key.
  const short = account_fixture({ characters: crowd, items: [item_fixture(lorito!.key, 2)] })
  expect(proposed_team(connected, short, lorito!.dungeon).map(({ id }) => id)).toEqual(strongest.slice(0, 2))
  const busy = fold_under(short)(connected, out(strongest[0]!))
  expect(proposed_team(busy, short, lorito!.dungeon).map(({ id }) => id)).toEqual(strongest.slice(1, 3))
  // No key, an unread bag, or a dungeon the seed does not know: nobody is proposed.
  expect(proposed_team(connected, account_fixture({ characters: crowd }), lorito!.dungeon)).toEqual([])
  expect(proposed_team(connected, { ...rich, phase: 'loading' }, lorito!.dungeon)).toEqual([])
  expect(proposed_team(connected, rich, 'no_such_dungeon')).toEqual([])
  // A proposal seats nobody: the Start is what the player picked.
  expect(raid_spec(connected, rich)).toEqual({
    activity: 'raid',
    hero_ids: [],
    dungeon: lorito!.dungeon,
    runs: null,
    fee_cap_mist: null,
  })
  const picked = fold_under(rich)(connected, {
    type: 'dapp/raid_pick',
    pick: { hero_ids: [crowd[0]!.id, crowd[1]!.id, 'ghost'], runs: 2, fee_cap_mist: '800' },
  })
  expect(raid_spec(picked, rich)).toEqual({
    activity: 'raid',
    hero_ids: [crowd[0]!.id, crowd[1]!.id],
    dungeon: lorito!.dungeon,
    runs: 2,
    fee_cap_mist: '800',
  })
})

test('Home suggests one next step, most pressing first: funds, a raid, a quest, or nothing to do', () => {
  const keyed = holding([item_fixture(lorito!.key, 3)])
  // Nothing is suggested before the bot answered, or to an account with no hero: that one sees its first steps.
  expect(next_step(initial_dapp_state(), keyed)).toBeNull()
  expect(next_step(connected, account_fixture({ characters: [] }))).toBeNull()
  // A key is held and a hero can enter: plan a raid, with the keys held for that dungeon.
  expect(next_step(connected, keyed)).toEqual({ kind: 'raid', dungeon: lorito!.dungeon, keys: 3 })
  // No key: send the strongest free hero on a quest.
  expect(next_step(connected, NONE)).toEqual({ kind: 'quest', hero_id: SECOND })
  expect(next_step(fold_under(NONE)(connected, out(SECOND)), NONE)).toEqual({ kind: 'quest', hero_id: HERO })
  // Every hero is out.
  const all_out = fold_under(keyed)(connected, out(HERO, SECOND))
  expect(next_step(all_out, keyed)).toEqual({ kind: 'out' })
  // A hero stopped for want of SUI comes before anything else, even with a key and a free hero.
  const broke = observed({ observation_revision: 12, runs: [run_fixture(HERO, 'waiting', 'funding_required')] }, 300)
  expect(next_step(fold_under(keyed)(connected, broke), keyed)).toEqual({ kind: 'funds' })
  // A key the only free hero cannot burn is no raid: it stands in another world than that dungeon.
  const far = character_fixture({ world: 'yakutia', checkpoint_world: 'yakutia' })
  const elsewhere = account_fixture({ characters: [far], items: [item_fixture(lorito!.key, 1)] })
  expect(next_step(connected, elsewhere)).toEqual({ kind: 'quest', hero_id: HERO })
})
