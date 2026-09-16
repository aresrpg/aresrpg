// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { readFileSync } from 'node:fs'

import { expect, test } from 'bun:test'

import { box_rolls, LOOT_BOX_BATCH_LIMIT } from '../src/loot_boxes.ts'
import type { Receipt } from '../src/client.ts'

const id = (value: number) => `0x${value.toString(16).padStart(64, '0')}`
const receipt = (ids = [id(1), id(2)]): Receipt =>
  ({
    $kind: 'Transaction',
    Transaction: {
      digest: 'test',
      events: [
        { type: '0x0::loot_box::LootBoxOpened', json: { box_template: id(3), rolled_template: id(4), amount: 50 } },
        { type: '0x0::loot_box::LootBoxOpened', json: { box_template: id(3), rolled_template: id(5), amount: 10 } },
        { type: '0x0::loot_box::LootBoxesOpened', json: { box_template: id(3), claim_ids: ids } },
      ],
      objectTypes: { [id(1)]: '0x0::loot_box::BoxClaim', [id(2)]: '0x0::loot_box::BoxClaim' },
      effects: {
        changedObjects: [id(2), id(1)].map((object_id) => ({
          objectId: object_id,
          idOperation: 'Created',
          outputState: 'ObjectWrite',
        })),
      },
    },
  }) as unknown as Receipt

test('batch reveals bind each outcome to its claim without relying on object output order', () => {
  expect(box_rolls(receipt(), id(3), 2)).toEqual([
    { claim_id: id(1), rolled_template: id(4), amount: 50 },
    { claim_id: id(2), rolled_template: id(5), amount: 10 },
  ])
})

test('incomplete, duplicate and foreign receipt claims cannot be presented as the reviewed batch', () => {
  expect(() => box_rolls(receipt(), id(3), 3)).toThrow()
  expect(() => box_rolls(receipt([id(1), id(1)]), id(3), 2)).toThrow()
  expect(() => box_rolls(receipt([id(1), id(9)]), id(3), 2)).toThrow()
  expect(() => box_rolls(receipt(), id(9), 2)).toThrow()
})

test('UI and SDK batch cap matches the contract', () => {
  const source = readFileSync(new URL('../../move/sources/loot_box.move', import.meta.url), 'utf8')
  expect(Number(source.match(/const MAX_BOX_BATCH: u32 = (\d+)/)![1])).toBe(LOOT_BOX_BATCH_LIMIT)
})
