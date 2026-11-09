// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import { SDK, type SuiTransport } from '@aresrpg/sdk'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { Inputs, Transaction, type TransactionPlugin } from '@mysten/sui/transactions'

import { validate_gameplay, parse_gameplay_action, execute_gameplay } from '../src/gameplay.ts'
import { next_profession_action } from '../src/profession_plan.ts'
import { execute_profession_actions } from '../src/profession_actions.ts'
import { fold_actor_inventory } from '../src/actor_inventory.ts'
import { id, pins, digest, fake_client } from '../../sdk/test/helpers/transport.ts'

import { profession_context, plan, character, item } from './helpers/profession_fixture.ts'

const tool = { ...item('fixture_tool', 1, 45), category: character.equipment[0]!.category }
const equip_context = () => {
  const context = profession_context()
  return {
    ...context,
    command: {
      ...context.command,
      kind: 'equip_tool' as const,
      payload: { character_id: character.id, item_id: tool.id },
    },
    snapshot: { ...context.snapshot, characters: [{ ...character, equipment: [] }] },
  }
}

test('unequipped handover waits for deposited tool, equips through SDK and gathers only after observed equipment', async () => {
  const handed_over = equip_context()
  expect(next_profession_action(plan, handed_over).issue?.code).toBe('gathering_tool_required')
  expect(() => validate_gameplay(handed_over)).toThrow('tool_unavailable')
  const deposited = {
    ...handed_over,
    snapshot: {
      ...handed_over.snapshot,
      inventory: fold_actor_inventory(handed_over.snapshot.inventory!, {
        type: 'packet/inventory',
        items: [...handed_over.snapshot.inventory!.items, tool],
      }),
    },
  }
  const action = validate_gameplay(deposited)
  expect(action).toEqual({
    kind: 'equip_tool',
    input: {
      character_id: character.id,
      to_equip: [{ slot: 'tool', item_id: tool.id }],
      to_unequip: [],
      custody: { kiosk: character.kiosk, kiosk_cap: character.kiosk_cap },
    },
  })
  if (action.kind !== 'equip_tool') throw new Error('expected equip')
  const calls: unknown[] = []
  await execute_profession_actions(action, {
    equip: async (input) => {
      calls.push(input)
      return { digest: 'fixture' }
    },
  } as Parameters<typeof execute_profession_actions>[1])
  expect(calls).toEqual([action.input])
  expect(next_profession_action(plan, deposited).issue?.code).toBe('gathering_tool_required')
  const observed = {
    ...deposited,
    snapshot: { ...deposited.snapshot, characters: [{ ...character, equipment: [{ ...tool, slot: 'tool' }] }] },
  }
  expect(next_profession_action(plan, observed).action?.kind).toBe('gather')
})

test('tool action rejects foreign custody, unavailable inventory, levels, stale state and injected fields', () => {
  const context = equip_context()
  const ready = {
    ...context,
    snapshot: { ...context.snapshot, inventory: { ...context.snapshot.inventory!, items: [tool] } },
  }
  for (const unavailable of [
    { ...tool, kiosk: id(90) },
    { ...tool, category: 'resource' },
    { ...tool, version: undefined },
  ])
    expect(() =>
      validate_gameplay({
        ...ready,
        snapshot: { ...ready.snapshot, inventory: { ...ready.snapshot.inventory, items: [unavailable] } },
      })
    ).toThrow('tool_unavailable')
  expect(() =>
    validate_gameplay({
      ...ready,
      snapshot: {
        ...ready.snapshot,
        inventory: { ...ready.snapshot.inventory, items: [{ ...tool, level: character.level + 1 }] },
      },
    })
  ).toThrow('equipment_level_required')
  expect(() => validate_gameplay({ ...ready, snapshot: { ...ready.snapshot, characters: [] } })).toThrow(
    'character_authority_mismatch'
  )
  expect(() => validate_gameplay({ ...ready, snapshot: { ...ready.snapshot, ready: false } })).toThrow('needs_resync')
  expect(() =>
    validate_gameplay({ ...ready, snapshot: { ...ready.snapshot, characters: [{ ...character, custody: 'fight' }] } })
  ).toThrow('character_not_available')
  expect(() => parse_gameplay_action('equip_tool', { ...ready.command.payload, slot: 'weapon' })).toThrow(
    'invalid_gameplay_payload'
  )
  const replacement = validate_gameplay({ ...ready, snapshot: { ...ready.snapshot, characters: [character] } })
  expect(replacement.input).toHaveProperty('to_unequip', [{ slot: 'tool', item_id: character.equipment[0]!.id }])
})

test('available deposited tool composes the real SDK equip PTB with fixture transport only', async () => {
  const context = equip_context()
  const chain = fake_client({ simulate_ok: true })
  const targets: string[] = []
  const client = {
    ...chain,
    core: {
      ...chain.core,
      resolveTransactionPlugin: (): TransactionPlugin => async (data, options, next) => {
        // Fixture resolver supplies refs; production Core resolves these through its normal object reader.
        data.inputs.forEach((input, index) => {
          if (input.$kind === 'UnresolvedObject')
            data.inputs[index] = Inputs.ObjectRef({ objectId: input.UnresolvedObject.objectId, version: '1', digest })
        })
        await chain.core.resolveTransactionPlugin()(data, options, next)
      },
      executeTransaction: async (input: { transaction: Uint8Array }) => {
        targets.push(
          ...Transaction.from(input.transaction)
            .getData()
            .commands.flatMap((command) => (command.MoveCall ? [command.MoveCall.function] : []))
        )
        return chain.core.executeTransaction(input)
      },
    },
  } as unknown as SuiTransport
  const sdk = SDK({ client, pins, signer: new Ed25519Keypair(), transaction_storage: null })
  await execute_gameplay({
    ...context,
    snapshot: { ...context.snapshot, inventory: { ...context.snapshot.inventory!, items: [tool] } },
    sdk: {
      ...sdk,
      get_owned_kiosks: async () => ({
        kioskOwnerCaps: [
          { objectId: character.kiosk_cap!, kioskId: character.kiosk, isPersonal: true, version: '1', digest },
        ],
        kioskIds: [character.kiosk],
        hasNextPage: false,
        nextCursor: null,
      }),
    },
  })
  expect(targets).toContain('equip_item')
  expect(targets).not.toContain('unequip_item')
  expect(chain.calls.executions).toBe(1)
  expect(chain.calls.simulations).toBeGreaterThan(0)
})

test('listed and trade-encumbered tools never reach equipment preparation', () => {
  const context = equip_context()
  const inventory = { ...context.snapshot.inventory!, items: [tool] }
  for (const unavailable of [
    { ...inventory, listings: [{ id: tool.id }] as never },
    { ...inventory, trades: [{ caps_a: [{ object: tool.id }], caps_b: [] }] as never },
    { ...inventory, loaded: false },
  ])
    expect(() => validate_gameplay({ ...context, snapshot: { ...context.snapshot, inventory: unavailable } })).toThrow()
})
