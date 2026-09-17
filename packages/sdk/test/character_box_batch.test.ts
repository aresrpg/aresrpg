// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import type { Receipt } from '../src/client.ts'
import { character_actions as gate_actions } from '../src/character_actions.ts'
import { item_template_id } from '../src/seed_ids.ts'

const id = (n: number) => `0x${String(n).padStart(64, '0')}`
const digest = '11111111111111111111111111111111'
const kiosk_cap = { objectId: id(3), kioskId: id(12), isPersonal: true, version: '1', digest }
const terminal_sdk = (doors: Record<string, unknown>, events: readonly unknown[]) => ({
  tx: () => ({}),
  execute: async () => ({ $kind: 'Transaction', Transaction: { digest, events } }) as unknown as Receipt,
  hydrate_unknown: async () => {},
  pins: {
    package: id(1),
    package_original: id(1),
    seed_package: id(60),
    seed_package_original: id(60),
    content_root: { id: id(61), shared_version: '1' },
  },
  game_type_package: id(1),
  doors,
})

test('opening a reviewed box quantity composes one terminal call and refuses invalid counts before execution', async () => {
  const calls: Record<string, unknown>[] = []
  const template = item_template_id(id(61), id(60), 'bag_barley')
  const claim_ids = [id(80), id(81)]
  const sdk = terminal_sdk({ open_loot_boxes: (_tx: unknown, args: Record<string, unknown>) => calls.push(args) }, [
    ...claim_ids.map(() => ({
      type: `${id(1)}::loot_box::LootBoxOpened`,
      json: { box_template: template, rolled_template: id(90), amount: 50 },
    })),
    { type: `${id(1)}::loot_box::LootBoxesOpened`, json: { box_template: template, claim_ids } },
  ])
  const { execute } = sdk
  let executions = 0
  sdk.execute = async () => {
    executions += 1
    const receipt = await execute()
    return {
      ...receipt,
      Transaction: {
        ...receipt.Transaction,
        objectTypes: Object.fromEntries(claim_ids.map((claim) => [claim, `${id(1)}::loot_box::BoxClaim`])),
        effects: {
          changedObjects: claim_ids.map((object_id) => ({
            objectId: object_id,
            idOperation: 'Created',
            outputState: 'ObjectWrite',
          })),
        },
      },
    } as Receipt
  }
  const actions = gate_actions(sdk as never, { kiosk_cap: async () => kiosk_cap })
  const input = { box_item_id: id(30), box_item_type: 'bag_barley', count: 2 }
  const opened = await actions.open_loot_boxes(input)
  expect(opened.rolls).toHaveLength(2)
  expect(calls).toEqual([expect.objectContaining({ box_item_id: id(30), count: 2, box_template: template })])
  expect(executions).toBe(1)
  for (const count of [0, -1, 1.5, 51])
    await expect(actions.open_loot_boxes({ ...input, count })).rejects.toThrow('Invalid')
  expect(executions).toBe(1)
})

test('fourteen rewards prepare their templates then redeem through one terminal transaction', async () => {
  const calls: string[] = []
  let executions = 0
  const sdk = {
    ...terminal_sdk(
      {
        prepare_fight_loot: () => {
          calls.push('prepare')
          return { Result: calls.length - 1 }
        },
        claim_loot_batch: (_tx: unknown, args: { claims: unknown[]; plans: unknown[] }) => {
          expect(args.claims).toHaveLength(14)
          expect(args.plans).toHaveLength(14)
          calls.push('redeem')
        },
      },
      []
    ),
    door_context: { obj: (_tx: unknown, claim: string) => ({ Object: claim }) },
  }
  const { execute } = sdk
  sdk.execute = async () => {
    executions++
    return execute()
  }
  const actions = gate_actions(sdk as never, { kiosk_cap: async () => kiosk_cap })
  const claims = Array.from({ length: 14 }, (_, index) => ({
    claim_id: id(100 + index),
    rolled_item_type: 'wheat_barley',
    existing: null,
  }))
  await actions.claim_loot_batch({ claims })
  expect(calls).toEqual([...Array.from({ length: 14 }, () => 'prepare'), 'redeem'])
  expect(executions).toBe(1)
  for (const invalid of [
    [],
    [claims[0]!, claims[0]!],
    Array.from({ length: 51 }, (_, index) => ({ ...claims[0]!, claim_id: id(200 + index) })),
  ])
    await expect(actions.claim_loot_batch({ claims: invalid })).rejects.toThrow('Invalid')
  expect(executions).toBe(1)
})
