// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'
import type { KioskOwnerCap } from '@mysten/kiosk'

import { kolizeum_actions } from '../src/kolizeum.ts'
import { create_cache } from '../src/cache.ts'
import { friend_list_id } from '../src/friends.ts'

const id = (value: number) => `0x${String(value).padStart(64, '0')}`
const digest = '11111111111111111111111111111111'
const kolizeum = id(40)
const fight = id(41)
const kiosk_cap = { objectId: id(3), kioskId: id(12), isPersonal: true } as KioskOwnerCap

test('create and join preserve the selected format, cap range, stake, and explicit side', async () => {
  const calls: { door: string; args: Record<string, unknown> }[] = []
  const coins: bigint[] = []
  const scopes: string[] = []
  const cache = create_cache()
  const owner = id(99)
  const registry = id(62)
  const list = friend_list_id(registry, id(1), owner)
  let current = ''
  const record = (door: string) => (_tx: unknown, args: Record<string, unknown>) => {
    current = door
    calls.push({ door, args })
  }
  const sdk = {
    pins: {
      content_root: { id: id(61), shared_version: '1' },
      seed_package_original: id(60),
      friend_registry: { id: registry, shared_version: '1' },
    },
    game_type_package: id(1),
    cache,
    tx: () => ({}),
    coin_of: (_tx: unknown, amount: bigint) => {
      coins.push(amount)
      return `coin-${amount}`
    },
    hydrate_unknown: async () => {},
    with_owner_kiosk: (_tx: unknown, _cap: unknown, compose: (kiosk: string, cap: string) => void) =>
      compose(kiosk_cap.kioskId, kiosk_cap.objectId),
    execute: async (_tx: unknown, options: Readonly<{ gas_scope: string }>) => {
      scopes.push(options.gas_scope)
      return {
        Transaction: {
          digest,
          events:
            current === 'create' ? [{ type: `${id(1)}::kolizeum::KolizeumCreated`, json: { kolizeum, fight } }] : [],
        },
      }
    },
    tag_gas: () => {},
    doors: {
      create_kolizeum: record('create'),
      create_kolizeum_friends: (_tx: unknown, args: Record<string, unknown>) => {
        current = 'create'
        calls.push({ door: 'create_friends', args })
      },
      join_kolizeum: record('join'),
    },
  }
  const actions = kolizeum_actions(sdk as never, { kiosk_cap: async () => kiosk_cap, address: owner })
  const custody = { kiosk: kiosk_cap.kioskId, kiosk_cap: kiosk_cap.objectId }

  expect(
    await actions.create({
      pledge_mist: 2_000_000_000n,
      format: 6,
      level_min: 12,
      level_max: 34,
      character_id: id(20),
      custody,
    })
  ).toEqual({ digest, kolizeum, fight })
  cache.owned.set(list, { objectId: list, version: '1', digest: id(70) })
  await actions.create({
    pledge_mist: 2_000_000_000n,
    format: 3,
    level_min: 12,
    level_max: 34,
    access: 'friends',
    character_id: id(20),
    custody,
  })
  await actions.join({
    kolizeum,
    fight,
    pledge_mist: 2_000_000_000n,
    side: 1,
    character_id: id(21),
    custody,
  })

  expect(coins).toEqual([2_000_000_000n, 2_000_000_000n, 2_000_000_000n])
  expect(calls[0]).toMatchObject({ door: 'create', args: { format: 6, level_min: 12, level_max: 34, access: 0 } })
  expect(calls[1]).toMatchObject({ door: 'create_friends', args: { format: 3, list } })
  expect(calls[2]).toMatchObject({ door: 'join', args: { lobby: kolizeum, f: fight, side: 1 } })
  expect(scopes).toEqual(['kolizeum:create', 'kolizeum:create', `fight:${fight}`])
})

test('ready starts a partial lobby through the manager and projects the start witness', async () => {
  const calls: string[] = []
  const hydrated: string[][] = []
  const sdk = {
    game_type_package: id(1),
    tx: () => ({}),
    hydrate_unknown: async (ids: readonly string[]) => void hydrated.push([...ids]),
    execute: async () => ({
      Transaction: {
        digest,
        events: [
          { type: `${id(1)}::fight::FightStarted`, json: { fight } },
          { type: `${id(1)}::fight::TurnSeedUsed`, json: { fight, seat: '1', seed: '9' } },
        ],
      },
    }),
    doors: {
      ready_fighter: () => calls.push('ready'),
      start_kolizeum: () => calls.push('start_kolizeum'),
    },
  }

  const receipt = await kolizeum_actions(sdk as never, { kiosk_cap: async () => kiosk_cap, address: id(99) }).ready({
    kolizeum,
    fight,
    fighter_idx: 0n,
    and_start: true,
  })

  expect(calls).toEqual(['ready', 'start_kolizeum'])
  expect(hydrated).toEqual([[kolizeum, fight]])
  expect(receipt).toEqual({ digest, started: true, turn_witnesses: [{ fighter: 1n, seed: 9n }] })
})

test('placement exit tries atomic final cleanup before the ordinary refund door', async () => {
  const calls: string[] = []
  const sdk = {
    tx: () => ({}),
    hydrate_unknown: async () => {},
    with_owner_kiosk: (_tx: unknown, _cap: unknown, compose: (kiosk: string, cap: string) => void) =>
      compose(kiosk_cap.kioskId, kiosk_cap.objectId),
    execute: async () => {
      if (calls.at(-1) === 'last') throw new Error('Transaction resolution failed: abort code: 1729')
      return { Transaction: { digest } }
    },
    doors: {
      exit_last_kolizeum: () => calls.push('last'),
      exit_kolizeum: () => calls.push('ordinary'),
    },
  }

  await kolizeum_actions(sdk as never, { kiosk_cap: async () => kiosk_cap, address: id(99) }).exit({
    kolizeum,
    fight,
    fighter_idx: 0n,
    custody: { kiosk: kiosk_cap.kioskId, kiosk_cap: kiosk_cap.objectId },
  })
  expect(calls).toEqual(['last', 'ordinary'])
})
