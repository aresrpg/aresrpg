// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import type { Receipt } from '../src/cache.ts'
import { fight_actions } from '../src/fight.ts'

const id = (value: number) => `0x${String(value).padStart(64, '0')}`
const digest = '11111111111111111111111111111111'
const kiosk_cap = {
  objectId: id(3),
  kioskId: id(12),
  isPersonal: true,
  version: '1',
  digest,
}

test('same-kiosk fighter rewards settle through one bounded Random transaction', async () => {
  const calls: { door: string; args: Record<string, unknown> }[] = []
  const execution_options: unknown[] = []
  const sdk = {
    pins: { content_root: { id: id(61), shared_version: '1' }, seed_package_original: id(60) },
    game_type_package: id(1),
    tx: () => ({}),
    hydrate_unknown: async () => undefined,
    execute: async (_tx: unknown, options: unknown) => {
      execution_options.push(options)
      return {
        $kind: 'Transaction',
        Transaction: {
          digest,
          events: [
            { type: `${id(1)}::fight::FightClosable`, json: { fight: id(40) } },
            { type: `${id(1)}::fight::FightClosed`, json: { fight: id(40) } },
          ],
        },
      } as unknown as Receipt
    },
    doors: {
      prepare_fight_loot: (_tx: unknown, input: Record<string, unknown>) => {
        calls.push({ door: 'prepare', args: input })
        return `prepared-${calls.length}`
      },
      settle_fight: (_tx: unknown, input: Record<string, unknown>) =>
        void calls.push({ door: 'settle_many', args: input }),
      settle_last_fight: (_tx: unknown, input: Record<string, unknown>) =>
        void calls.push({ door: 'settle_many_last', args: input }),
    },
  }

  const result = await fight_actions(sdk as never, { kiosk_cap: async () => kiosk_cap }).settle({
    fight: id(40),
    custody: { kiosk: kiosk_cap.kioskId, kiosk_cap: kiosk_cap.objectId },
    settlements: [
      {
        fighter_idx: 0n,
        loot: [
          { item_type: 'silk', existing: id(41) },
          { item_type: 'silk', existing: id(41) },
        ],
      },
      {
        fighter_idx: 2n,
        loot: [
          { item_type: 'fang', existing: null },
          { item_type: 'silk', existing: id(41) },
        ],
      },
    ],
    last: true,
  })

  expect(execution_options).toEqual([
    {
      custody: { kiosk: kiosk_cap.kioskId, kiosk_cap: kiosk_cap.objectId },
      gas_scope: `fight:${id(40)}`,
      budget: 1_000_000_000n,
    },
  ])
  expect(calls.map(({ door }) => door)).toEqual(['prepare', 'prepare', 'prepare', 'settle_many_last'])
  expect(calls.at(-1)?.args).toMatchObject({
    fight_object: id(40),
    fighter_indices: [0n, 2n],
    plan_lengths: [1, 2],
    plan: ['prepared-1', 'prepared-2', 'prepared-3'],
    kiosk: kiosk_cap.kioskId,
    personal: { objectId: kiosk_cap.objectId, version: kiosk_cap.version, digest: kiosk_cap.digest },
  })
  expect(result).toMatchObject({ digest, closable: true, closed: true })
})
