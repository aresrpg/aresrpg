// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import type { ItemRow, ListingRow, TradeRow } from '../src/packets.ts'
import { bind_strategy, hero_place, raid_entrants, raid_keys, type RaidBag } from '../src/strategies.ts'

const [DUNGEON, KEY] = ['gilded_lorito', 'key_of_gilded_lorito']
const [SHARED, APART] = ['0xshared', '0xapart']
const key = (id: string, amount: number, kiosk = SHARED): ItemRow => ({
  id,
  version: '1',
  name: 'Key',
  item_type: KEY,
  category: 'key',
  level: 1,
  amount,
  kiosk,
})
const bag = (items: readonly ItemRow[], locked: Partial<RaidBag> = {}): RaidBag => ({
  items,
  listings: [],
  trades: [],
  ...locked,
})
const hero = (id: string, kiosk = SHARED, dungeon?: string) => ({
  id,
  kiosk,
  ...(dungeon ? { dungeon_run: { dungeon, room: 2 } } : {}),
})
const [A, B, C, D] = ['a', 'b', 'c', 'd'].map((id) => hero(id))
const entrants = (team: readonly ReturnType<typeof hero>[], held: RaidBag, listed = team) =>
  raid_entrants({ dungeon: DUNGEON, key: KEY, team: listed.map(({ id }) => id), heroes: team, bag: held })

test('heroes sharing one kiosk enter in the listed order, one per key unit it holds', () => {
  expect(entrants([A, B, C], bag([key('k1', 2)]))).toEqual(['a', 'b'])
  expect(entrants([C, A, B], bag([key('k1', 1), key('k2', 1)]))).toEqual(['c', 'a'])
  expect(entrants([A, B, C], bag([key('k1', 3)]))).toEqual(['a', 'b', 'c'])
  expect(entrants([A, B], bag([]))).toEqual([])
  // A hero in another kiosk needs its own key there; the shared stack does not follow it.
  const apart = hero('d', APART)
  expect(entrants([A, apart, B], bag([key('k1', 5)]))).toEqual(['a', 'b'])
  expect(entrants([A, apart, B], bag([key('k1', 1), key('k2', 1, APART)]))).toEqual(['a', 'd'])
})

test('a key listed on the market, held in a trade or not yet certified cannot be burnt', () => {
  const listings = [{ id: 'k1' }] as unknown as readonly ListingRow[]
  expect(entrants([A, B], bag([key('k1', 2)], { listings }))).toEqual([])
  expect(entrants([A, B], bag([key('k1', 2), key('k2', 1)], { listings }))).toEqual(['a'])
  const trades = [{ caps_a: [{ object: 'k2' }], caps_b: [] }] as unknown as readonly TradeRow[]
  expect(entrants([A, B], bag([key('k1', 1), key('k2', 1)], { trades }))).toEqual(['a'])
  expect(entrants([A], bag([{ ...key('k1', 1), version: undefined }]))).toEqual([])
  expect(entrants([A], bag([{ ...key('k1', 1), item_type: 'key_of_another_dungeon' }]))).toEqual([])
  // The bot burns the first usable key object of its hero's kiosk.
  expect(raid_keys(bag([key('k1', 2), key('k2', 1)], { listings }), KEY, SHARED).map(({ id }) => id)).toEqual(['k2'])
  expect(raid_keys(bag([key('k1', 2)]), KEY, APART)).toEqual([])
})

test('a hero already inside this dungeon run needs no key; one inside another dungeon does', () => {
  const inside = hero('b', SHARED, DUNGEON)
  expect(entrants([A, inside, C], bag([key('k1', 1)]))).toEqual(['a', 'b'])
  expect(entrants([inside, A, C], bag([]))).toEqual(['b'])
  expect(entrants([A, hero('b', SHARED, 'tangled_aftermath')], bag([key('k1', 1)]))).toEqual(['a'])
})

test('a listed hero the wallet does not hold cannot enter, so the team is never whole', () => {
  expect(entrants([A, B], bag([key('k1', 5)]), [A, D, B])).toEqual(['a', 'b'])
})

/** A stand-in for the engine's city lookup: one city around the client origin. */
const city_at = (world: string, x: number, z: number) =>
  world === 'nauvis' && Math.abs(x) < 100 && Math.abs(z) < 100 ? { id: 'thebes', dungeon: DUNGEON } : null

test('a hero stands where its authoritative checkpoint says, in client coordinates for the city lookup', () => {
  const row = { world: 'nauvis', checkpoint_world: 'nauvis', x: 50_050, z: 49_950 }
  expect(hero_place(row, city_at)).toEqual({ world: 'nauvis', city: 'thebes', dungeon: DUNGEON })
  expect(hero_place({ ...row, x: 60_000 }, city_at)).toEqual({ world: 'nauvis' })
  for (const unknown of [
    { ...row, checkpoint_world: 'yakutia' },
    { ...row, world: 'atlantis', checkpoint_world: 'atlantis' },
    { ...row, x: undefined },
    { ...row, z: Number.NaN },
    { ...row, x: '50050' },
    {},
  ])
    expect(hero_place(unknown, city_at)).toBeNull()
})

test('a bound script names its catalogue entry and keeps authored text verbatim', () => {
  // `$&` and `$1` are replacement patterns of a plain string replace: a profile must survive them.
  const profile = { intent: 'Costs $& and $1, never $character.' }
  const script = bind_strategy('fight_nearby', {
    character: '0xhero',
    title: 'Train',
    area: { world: 'nauvis' },
    profile,
  })
  expect(script).toMatchObject({ version: '1', strategy: 'fight_nearby', objective: { title: 'Train' } })
  expect(JSON.stringify(script.tree)).toContain(JSON.stringify(profile))
})
