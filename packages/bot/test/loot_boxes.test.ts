// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import { item_template_id } from '@aresrpg/sdk/seed-ids'
import { living_content } from '@aresrpg/sdk/pins'

import { parse_gameplay_action, validate_gameplay, execute_gameplay_actions } from '../src/gameplay.ts'
import { id, pins as base_pins } from '../../sdk/test/helpers/transport.ts'
import { actor_snapshot_transition, empty_snapshot } from '../src/actor_snapshot.ts'
import { bind_action_baseline, action_projected } from '../src/action_reconciliation.ts'
import { create_mcp_handler } from '../src/mcp.ts'
import { create_control_service, lane_key_for, type Lane } from '../src/control.ts'

import { profession_context, character, item } from './helpers/profession_fixture.ts'
import { runtime_fixture } from './helpers/runtime_fixture.ts'

const context = () => {
  const base = profession_context()
  const bag = { ...item('bag_aloe_vera', 2), category: 'consumable' }
  return {
    ...base,
    command: {
      ...base.command,
      kind: 'open_loot_boxes' as const,
      payload: { character_id: character.id, item_id: bag.id, count: 2 },
    },
    snapshot: { ...base.snapshot, inventory: { ...base.snapshot.inventory!, items: [bag] } },
  }
}
test('resource bags use the existing SDK opening action with exact kiosk custody', async () => {
  const f = context()
  expect(parse_gameplay_action('open_loot_boxes', f.command.payload)).toEqual(f.command.payload)
  const plan = validate_gameplay(f)
  expect(plan).toMatchObject({
    kind: 'open_loot_boxes',
    input: {
      box_item_type: 'bag_aloe_vera',
      count: 2,
      custody: { kiosk: character.kiosk, kiosk_cap: character.kiosk_cap },
    },
  })
  const inputs: unknown[] = []
  await execute_gameplay_actions(f, {
    open_loot_boxes: async (input: unknown) => {
      inputs.push(input)
      return { digest: 'fixture' }
    },
  } as never)
  expect(inputs).toEqual([plan.input])
})

const pins = { ...base_pins, content_root: { id: id(200) }, seed_package_original: id(201) }
const content = living_content({ pins }, 'fixture')
const template = (name: string) => item_template_id(content.content_root, content.seed_package_original, name)
const claim = { id: id(40), kind: 'box' as const, rolled_template: template('aloe_vera'), amount: 50 }
const claim_context = () => {
  const f = context()
  return {
    ...f,
    pins,
    command: {
      ...f.command,
      kind: 'claim_loot' as const,
      payload: { character_id: character.id, claim_ids: [claim.id] },
    },
    snapshot: { ...f.snapshot, inventory: { ...f.snapshot.inventory, claims: [claim] } },
  }
}
test('loot schemas refuse invalid batch amounts, duplicate/empty claims and caller reward overrides', () => {
  for (const count of [0, 51, -1, 1.5])
    expect(() => parse_gameplay_action('open_loot_boxes', { ...context().command.payload, count })).toThrow(
      'invalid_gameplay_payload'
    )
  for (const claim_ids of [[], [claim.id, claim.id], Array.from({ length: 51 }, (_, index) => id(index + 50))])
    expect(() => parse_gameplay_action('claim_loot', { character_id: character.id, claim_ids })).toThrow(
      'invalid_gameplay_payload'
    )
  expect(() =>
    parse_gameplay_action('claim_loot', { ...claim_context().command.payload, rolled_item_type: 'aloe_vera' })
  ).toThrow('invalid_gameplay_payload')
})
test('opening refuses stale, foreign, listed, non-box and insufficient inventory', () => {
  const f = context()
  expect(() => validate_gameplay({ ...f, command: { ...f.command, observation_revision: 0 } })).toThrow('needs_resync')
  expect(() => validate_gameplay({ ...f, snapshot: { ...f.snapshot, characters: [] } })).toThrow('authority')
  for (const patch of [{ kiosk: id(90) }, { category: 'resource' }, { item_type: 'aloe_vera' }, { version: undefined }])
    expect(() =>
      validate_gameplay({
        ...f,
        snapshot: {
          ...f.snapshot,
          inventory: { ...f.snapshot.inventory, items: [{ ...f.snapshot.inventory.items[0]!, ...patch }] },
        },
      })
    ).toThrow('loot_box_unavailable')
  expect(() =>
    validate_gameplay({ ...f, command: { ...f.command, payload: { ...f.command.payload, count: 3 } } })
  ).toThrow('insufficient_loot_boxes')
  expect(() =>
    validate_gameplay({
      ...f,
      snapshot: {
        ...f.snapshot,
        inventory: { ...f.snapshot.inventory, listings: [{ id: f.command.payload.item_id } as never] },
      },
    })
  ).toThrow('loot_box_unavailable')
})
test('collection resolves only owned projected claims and uses the SDK batch action', async () => {
  const f = claim_context()
  for (const claims of [null, [], [{ ...claim, kind: 'crush' as const }], [{ ...claim, rolled_template: id(999) }]])
    expect(() =>
      validate_gameplay({ ...f, snapshot: { ...f.snapshot, inventory: { ...f.snapshot.inventory, claims } } })
    ).toThrow('loot_claim_unavailable')
  const plan = validate_gameplay(f)
  expect(plan).toMatchObject({
    kind: 'claim_loot',
    input: { claims: [{ claim_id: claim.id, rolled_item_type: 'aloe_vera', existing: null }] },
  })
  const inputs: unknown[] = []
  await execute_gameplay_actions(f, {
    claim_loot_batch: async (input: unknown) => {
      inputs.push(input)
      return { digest: 'fixture' }
    },
  } as never)
  expect(inputs).toEqual([plan.input])
})
test('account claims participate in semantic revisions and disappear on disconnect', () => {
  const before = empty_snapshot()
  const state = {
    status: 'ready' as const,
    characters: [],
    last_packet: { type: 'packet/claims' as const, claims: [claim] },
    error: null,
  }
  const first = actor_snapshot_transition(before, state, 100, 20)
  expect(first.snapshot.inventory?.claims).toEqual([claim])
  expect(first.changed).toBe(true)
  expect(actor_snapshot_transition(first.snapshot, state, 101, 20).changed).toBe(false)
  expect(
    actor_snapshot_transition(first.snapshot, { ...state, status: 'disconnected' }, 102, 20).snapshot.inventory?.claims
  ).toBeNull()
})
test('opening and collection wait for both receipt-proven inventory and indexed claims', () => {
  const f = context()
  const bag = f.snapshot.inventory.items[0]!
  const receipt = {
    Transaction: {
      digest: 'D',
      effects: { lamportVersion: '2', changedObjects: [{ objectId: bag.id, outputVersion: '2' }] },
      objectTypes: { [bag.id]: 'fixture::item::Item' },
      events: [
        { type: 'fixture::item::AmountChanged', json: { item: bag.id, amount: 0 } },
        { type: 'fixture::loot_box::LootBoxesOpened', json: { claim_ids: [claim.id, id(41)] } },
      ],
    },
  }
  const command = bind_action_baseline({ ...f.command, status: 'completed', result: { digest: 'D' } }, f)
  const projected = {
    ...f,
    snapshot: {
      ...f.snapshot,
      inventory: {
        ...f.snapshot.inventory,
        claims: [claim, { ...claim, id: id(41) }],
        items: [],
        removed: { [bag.id]: '2' },
      },
    },
  }
  expect(action_projected(command, receipt, f)).toBe(false)
  expect(
    action_projected(command, receipt, {
      ...projected,
      snapshot: { ...projected.snapshot, inventory: f.snapshot.inventory },
    })
  ).toBe(false)
  expect(
    action_projected(command, receipt, {
      ...projected,
      snapshot: { ...projected.snapshot, inventory: { ...projected.snapshot.inventory, claims: null } },
    })
  ).toBe(false)
  expect(action_projected(command, receipt, projected)).toBe(true)
  expect(action_projected({ ...command, status: 'uncertain' }, receipt, projected)).toBe(false)
  const c = claim_context()
  const collected = bind_action_baseline({ ...c.command, status: 'completed', result: { digest: 'C' } }, c)
  const reward = { ...item('aloe_vera', 50, 42), version: '3' }
  const collection = {
    Transaction: {
      digest: 'C',
      effects: { lamportVersion: '3', changedObjects: [{ objectId: reward.id, outputVersion: '3' }] },
      objectTypes: { [reward.id]: 'fixture::item::Item' },
      events: [{ type: 'fixture::loot_box::LootClaimed', json: {} }],
    },
  }
  const done = {
    ...c,
    snapshot: { ...c.snapshot, claims: [], inventory: { ...c.snapshot.inventory, claims: [], items: [reward] } },
  }
  expect(action_projected(collected, collection, c)).toBe(false)
  expect(
    action_projected(collected, collection, {
      ...done,
      snapshot: { ...done.snapshot, inventory: { ...done.snapshot.inventory, claims: [claim] } },
    })
  ).toBe(false)
  expect(action_projected(collected, collection, done)).toBe(true)
})
test('MCP advertises and admits both loot actions with scope and idempotency checks', async () => {
  for (const action of [context().command, claim_context().command]) {
    const f = await runtime_fixture()
    try {
      const control = create_control_service(f.store, f.options.config, 60000, () => f.clock.now)
      const lease = await control.acquire(f.bot, 'loot-test', 10000)
      const key = lane_key_for(f.bot)
      await control.observed(key, 'loot-test', lease.fence, true)
      const lane = (await f.store.read<Lane>(key))!
      const mcp = create_mcp_handler(control, true, 'https://fixture')
      expect(JSON.stringify(await mcp(f.grant, { jsonrpc: '2.0', id: 1, method: 'tools/list' }))).toContain(
        `bot_${action.kind}`
      )
      const call = {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: {
          name: `bot_${action.kind}`,
          arguments: {
            idempotency_key: 'loot',
            observation_revision: lane.observation_revision,
            decision_revision: lane.decision_revision,
            action: action.payload,
          },
        },
      }
      expect(JSON.stringify(await mcp({ ...f.grant, scopes: ['bot:observe'] }, call))).toContain('insufficient_scope')
      expect(JSON.stringify(await mcp(f.grant, call))).toContain('accepted')
      await mcp(f.grant, call)
      expect(await f.store.scan_keys('command:', 100)).toHaveLength(1)
    } finally {
      await f.runtime.stop()
    }
  }
})

test('both loot actions compose real SDK doors and stop before signatures or submission', async () => {
  const { SDK } = await import('../../sdk/src/client.ts')
  const { Inputs } = await import('@mysten/sui/transactions')
  const { digest, fake_client } = await import('../../sdk/test/helpers/transport.ts')
  const { execute_gameplay } = await import('../src/gameplay.ts')
  for (const f of [context(), claim_context()]) {
    const chain = fake_client({ simulate_ok: true })
    const resolve = chain.core.resolveTransactionPlugin()
    chain.core.resolveTransactionPlugin = () => async (data, options, next) => {
      data.inputs.forEach((input, index) => {
        if (input.UnresolvedObject)
          data.inputs[index] = Inputs.ObjectRef({ objectId: input.UnresolvedObject.objectId, version: '1', digest })
      })
      await resolve(data, options, next)
    }
    const calls: string[] = []
    const sdk = SDK({
      client: chain,
      address: f.address,
      pins,
      transaction_storage: null,
      sign_transaction: async (tx) => {
        calls.push(...tx.getData().commands.flatMap((command) => (command.MoveCall ? [command.MoveCall.function] : [])))
        throw new Error('fixture signing boundary')
      },
    })
    await expect(
      execute_gameplay({
        ...f,
        pins,
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
    ).rejects.toThrow('fixture signing boundary')
    expect(calls).toContain(f.command.kind === 'open_loot_boxes' ? 'open_loot_boxes' : 'claim_loot_batch')
    expect(chain.calls.executions).toBe(0)
    expect(chain.calls.simulations).toBeGreaterThan(0)
  }
})
