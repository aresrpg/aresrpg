// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'
import type { KioskOwnerCap } from '@mysten/kiosk'

import { dungeon_actions } from '../src/dungeon.ts'

const id = (value: number) => `0x${String(value).padStart(64, '0')}`
const digest = '11111111111111111111111111111111'
const fight = id(90)
const kiosk_cap = { objectId: id(3), kioskId: id(12), isPersonal: true } as KioskOwnerCap

test('a dungeon room fight composes its authored mobs in order and tags the created fight', async () => {
  const calls: Readonly<{ door: string; value?: string }>[] = []
  const hydrated: string[][] = []
  const tagged: string[] = []
  const sdk = {
    pins: { content_root: { id: id(61), shared_version: '1' }, seed_package_original: id(60) },
    game_type_package: id(1),
    tx: () => ({}),
    hydrate_unknown: async (values: readonly string[]) => void hydrated.push([...values]),
    with_owner_kiosk: (_tx: unknown, _cap: unknown, compose: (kiosk: string, cap: string) => void) =>
      compose(kiosk_cap.kioskId, kiosk_cap.objectId),
    execute: async () => ({
      $kind: 'Transaction',
      Transaction: { digest, events: [{ type: `${id(1)}::fight::FightCreated`, json: { fight } }] },
    }),
    tag_gas: (_receipt: unknown, scope: string) => void tagged.push(scope),
    doors: {
      engage_dungeon_room: () => {
        calls.push({ door: 'engage' })
        return 'build-0'
      },
      add_fight_mob: (_tx: unknown, input: Readonly<{ build: string; template: string }>) => {
        calls.push({ door: 'mob', value: input.template })
        return `build-${calls.length}`
      },
      launch_fight: () => void calls.push({ door: 'launch' }),
    },
  }

  const result = await dungeon_actions(sdk as never, { kiosk_cap: async () => kiosk_cap }).start_fight({
    character_id: id(20),
    custody: { kiosk: kiosk_cap.kioskId, kiosk_cap: kiosk_cap.objectId },
    world: 'nauvis',
    dungeon: 'tangled_aftermath',
    mob_types: ['misui', 'minosui'],
    access: 1,
  })

  expect(calls.map(({ door }) => door)).toEqual(['engage', 'mob', 'mob', 'launch'])
  expect(hydrated).toHaveLength(1)
  expect(hydrated[0]).toContain(kiosk_cap.kioskId)
  expect(tagged).toEqual([`fight:${fight}`])
  expect(result).toEqual({ digest, fight })
})

test('every dungeon lifecycle action uses its dungeon-specific custody door', async () => {
  const calls: { door: string; args: Record<string, unknown> }[] = []
  const record = (door: string) => (_tx: unknown, args: Record<string, unknown>) => {
    calls.push({ door, args })
    return `${door}-result`
  }
  const sdk = {
    pins: { content_root: { id: id(61), shared_version: '1' }, seed_package_original: id(60) },
    game_type_package: id(1),
    tx: () => ({}),
    hydrate_unknown: async () => {},
    with_owner_kiosk: (_tx: unknown, _cap: unknown, compose: (kiosk: string, cap: string) => void) =>
      compose(kiosk_cap.kioskId, kiosk_cap.objectId),
    execute: async () => ({ $kind: 'Transaction', Transaction: { digest } }),
    doors: {
      enter_dungeon: record('enter'),
      join_dungeon_room: record('join_public'),
      join_dungeon_room_grouped: record('join_grouped'),
      prepare_fight_loot: record('prepare_loot'),
      settle_dungeon_room: record('settle'),
      settle_last_dungeon_room: record('settle_last'),
      give_up_dungeon_room: record('give_up'),
      abandon_dungeon_run: record('abandon'),
    },
  }
  const actions = dungeon_actions(sdk as never, { kiosk_cap: async () => kiosk_cap })
  const custody = { kiosk: kiosk_cap.kioskId, kiosk_cap: kiosk_cap.objectId }

  await actions.enter({
    character_id: id(20),
    custody,
    world: 'nauvis',
    dungeon: 'tangled_aftermath',
    key_id: id(21),
  })
  await actions.join_fight({ fight, character_id: id(20), custody, party: null })
  await actions.join_fight({ fight, character_id: id(20), custody, party: id(22) })
  await actions.settle({
    fight,
    dungeon: 'tangled_aftermath',
    custody,
    settlements: [
      {
        fighter_idx: 2n,
        loot: [
          { item_type: 'silk', existing: id(30) },
          { item_type: 'fang', existing: null },
        ],
      },
    ],
  })
  await actions.settle({
    fight,
    dungeon: 'tangled_aftermath',
    custody,
    last: true,
    settlements: [
      { fighter_idx: 2n, loot: [{ item_type: 'silk', existing: id(30) }] },
      { fighter_idx: 3n, loot: [{ item_type: 'fang', existing: null }] },
    ],
  })
  await actions.give_up_fight({ fight, fighter_idx: 2n, custody })
  await actions.abandon({ character_id: id(20), custody })

  expect(calls.map(({ door }) => door)).toEqual([
    'enter',
    'join_public',
    'join_grouped',
    'prepare_loot',
    'prepare_loot',
    'settle_last',
    'prepare_loot',
    'prepare_loot',
    'settle_last',
    'give_up',
    'abandon',
  ])
  expect(calls[0]?.args).toMatchObject({ character_id: id(20), key_id: id(21) })
  expect(calls[0]?.args).not.toHaveProperty('zx')
  expect(calls[0]?.args).toHaveProperty('dungeon_content')
  expect(calls[1]?.args).not.toHaveProperty('shared_party')
  expect(calls[2]?.args).toMatchObject({ shared_party: id(22) })
  expect(calls[5]?.args).toMatchObject({
    fighter_indices: [2n],
    plan_lengths: [2],
    plan: ['prepare_loot-result', 'prepare_loot-result'],
  })
  expect(calls[8]?.args).toMatchObject({ fighter_indices: [2n, 3n], plan_lengths: [1, 1] })
})
