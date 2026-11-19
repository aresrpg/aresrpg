// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import { create_fight } from '@aresrpg/fight'
import type { FightStateRow } from '@aresrpg/protocol'
import { character_max_hp } from '@aresrpg/protocol/character-stats'

import {
  account_bag,
  fight_mates,
  held_items,
  hero_experience,
  hero_health,
  job_experience,
  strongest_first,
} from '../../src/dapp/account.ts'
import { content_catalog } from '../../src/content/catalog.ts'
import { initial_simulator_state, reduce_simulator_state, simulator_board } from '../../src/modules/simulator.ts'
import { simulator_fight_setup } from '../../src/simulator/fight_setup.ts'

import { account_fixture, character_fixture, hero_id, item_fixture } from './fixtures.ts'

test('the account reads a hero\u2019s experience and the bag\u2019s units straight from the socket rows', () => {
  const hero = character_fixture()
  expect([hero_experience(hero), job_experience(hero)]).toEqual([120n, 40n])
  const { inventory } = account_fixture({ items: [item_fixture('wheat', 2, 'a'), item_fixture('wheat', 3, 'b')] })
  expect(held_items(inventory)).toEqual({ wheat: 5 })
})

test('the bag is known for the raid-key rule only once the account is fully read, with what locks it', () => {
  const key = item_fixture('key_of_gilded_lorito', 2)
  const listings = [{ id: key.id }]
  const trades = [{ caps_a: [{ object: 'other' }], caps_b: [] }]
  // The fixture rows carry only the fields the key rule reads.
  const known: unknown = account_bag(account_fixture({ items: [key], listings, trades }))
  expect(known).toEqual({ items: [key], listings, trades })
  // An account still loading, or whose read failed, shows its rows but counts no key.
  for (const phase of ['idle', 'loading', 'failed'] as const)
    expect(account_bag(account_fixture({ items: [key], phase }))).toBeNull()
})

test('strongest first: level, then experience, then id, whatever order the heroes arrive in', () => {
  const hero = (digit: string, level: number, experience: string) =>
    character_fixture({ id: hero_id(digit), level, experience })
  const characters = [hero('4', 5, '900'), hero('3', 9, '10'), hero('2', 5, '900'), hero('1', 5, '901')]
  const ranked = [hero_id('3'), hero_id('1'), hero_id('2'), hero_id('4')]
  expect(strongest_first(characters).map(({ id }) => id)).toEqual(ranked)
  expect(strongest_first(characters.toReversed()).map(({ id }) => id)).toEqual(ranked)
})

test('heroes that share a fight are each other\u2019s mates; a lone fighter has none', () => {
  const fighting = (digit: string, fight: string) =>
    character_fixture({ id: hero_id(digit), custody: 'fight', active_fight: { id: fight, seat: 0 } })
  const heroes = [
    fighting('1', 'f1'),
    fighting('2', 'f1'),
    fighting('3', 'f2'),
    character_fixture({ id: hero_id('4') }),
  ]
  expect(fight_mates(heroes, hero_id('1')).map(({ id }) => id)).toEqual([hero_id('2')])
  expect(fight_mates(heroes, hero_id('3'))).toEqual([])
  expect(fight_mates(heroes, hero_id('4'))).toEqual([])
})

/** A fight exactly as the game server pushes it: the runtime's checkpoint, serialized to JSON. */
const pushed_fight = () => {
  const mob = content_catalog.mobs[0]!
  const hero = { id: 'local_senshi', name: 'Senshi', classe: 'senshi', male: true, level: 1, spell_levels: {} }
  const stats = { vitality: 0, wisdom: 0, strength: 0, intelligence: 0, chance: 0, agility: 0 }
  const character = { ...hero, ...stats, colors: ['#ffffff', '#d9af57', '#8b6539'] as const, loadout: {} }
  const saved = reduce_simulator_state(initial_simulator_state(), { type: 'simulator/character_saved', character })
  const board = simulator_board(saved)
  const placed = reduce_simulator_state(
    reduce_simulator_state(saved, {
      type: 'simulator/character_placed',
      cell: board.start_cells_a[0]!,
      character_id: character.id,
    }),
    {
      type: 'simulator/mob_placed',
      cell: board.start_cells_b[0]!,
      mob_type: mob.mob_type,
      level: mob.level_min,
      level_min: mob.level_min,
      level_max: mob.level_max,
    }
  )
  const checkpoint = create_fight({ mode: 'local', setup: simulator_fight_setup(placed), seed: placed.seed }).state()
  const seat = checkpoint.contract.fighters.findIndex(({ kind }) => kind.type === 'player')
  const fighter = checkpoint.contract.fighters[seat]!
  if (fighter.kind.type !== 'player') throw new Error('fixture')
  fighter.hp = 7n
  const row = JSON.parse(
    JSON.stringify(
      { contract: checkpoint.contract, players: checkpoint.sources.players, kolizeum: null },
      (_, value) => (typeof value === 'bigint' ? value.toString() : (value as unknown))
    )
  ) as FightStateRow
  return { row, seat, owner: fighter.kind.owner, character: fighter.kind.character, id: checkpoint.contract.id }
}

test('a hero in its kiosk shows the chain\u2019s own health; a seated hero shows its fighter\u2019s, from the pushed fight', () => {
  // Health never written on chain is full health.
  const resting = character_fixture()
  const maximum = character_max_hp(resting)
  expect(hero_health(resting, { fights: {} }, null, 1_000)).toEqual({ current: maximum, maximum })
  const hurt = character_fixture({ hp: '1', hp_ms: 1_000 })
  expect(hero_health(hurt, { fights: {} }, null, 1_000)).toEqual({ current: 1, maximum })
  const fight = pushed_fight()
  const fighting = character_fixture({
    id: fight.character,
    custody: 'fight',
    active_fight: { id: fight.id, seat: fight.seat },
  })
  const fights = { [fight.id]: fight.row }
  const seated = hero_health(fighting, { fights }, fight.owner, 1_000)
  expect(seated?.current).toBe(7)
  expect(seated!.maximum).toBeGreaterThan(7)
  // Until its fight state is pushed, or for a seat another wallet holds, there is no health to show.
  expect(hero_health(fighting, { fights: {} }, fight.owner, 1_000)).toBeNull()
  expect(hero_health(fighting, { fights }, '0xother', 1_000)).toBeNull()
  expect(hero_health(fighting, { fights }, null, 1_000)).toBeNull()
})
