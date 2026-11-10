// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import { complete_agent_handover, AgentHandoverIncomplete, type AgentHandoverIntent } from '../src/agent_handover.ts'
import type { AgentTransferActions, AgentTransferIntent } from '../src/agent_transfer_actions.ts'
import { pre_submission_failure } from '../src/transaction_error.ts'

const character = {
  kind: 'offer' as const,
  character_id: 'character',
  kiosk: 'source',
  recipient: 'agent',
  unequip: [{ slot: 'weapon', item_id: 'sword' }],
}
const assets = {
  kind: 'asset_offer' as const,
  items: [{ item_id: 'wheat', kiosk: 'source', version: '1' }],
  recipient: 'agent',
  sui_mist: '0',
  kares_mist: '0',
  reserve_mist: '1',
}
const fixture = (intent: AgentHandoverIntent = character) => {
  const calls: AgentTransferIntent[] = []
  let offered = false
  let failure: 'offer' | 'claim' | null = null
  let current = true
  const actions = (sender: string): AgentTransferActions => ({
    sender,
    synchronize: async () => {},
    fits: async () => true,
    quote: async () => ({ budget_mist: 2_000_000n, cost_mist: 1_000_000n, required_mist: 2_000_000n }),
    prepare: async (input) => ({
      intent: input,
      sender,
      network: 'mainnet',
      gas_mist: '1',
      gas_budget_mist: '1',
      confirm: async ({ before_sign } = {}) => {
        before_sign?.()
        calls.push(input)
        if ((sender === 'owner' ? 'offer' : 'claim') === failure) throw new Error('Uncertain submission')
        if (sender === 'owner') offered = true
        return { digest: `${sender}-receipt`, receipt: {} as never }
      },
    }),
  })
  const options = {
    offer: actions('owner'),
    claim: actions('agent'),
    intent,
    read: {
      characters: async () =>
        offered
          ? [
              {
                character_id: 'character',
                seller_kiosk: 'source',
                purchase_cap: 'character-cap',
                recipient: 'agent',
                agent_address: 'owner',
                equipment: [{ slot: 'weapon', item_id: 'sword', purchase_cap: 'sword-cap' }],
              },
            ]
          : [],
      items: async () =>
        offered
          ? [
              {
                item_id: 'wheat',
                seller_kiosk: 'source',
                purchase_cap: 'wheat-cap',
                recipient: 'agent',
                agent_address: 'owner',
              },
            ]
          : [],
    },
    before_sign: () => {
      if (!current) throw new Error('Owner changed')
    },
  }
  return {
    options,
    calls,
    offered: () => {
      offered = true
    },
    fail: (value: typeof failure) => {
      failure = value
    },
    invalidate: () => {
      current = false
    },
  }
}

test('uncertain offer is never retried or followed by a claim', async () => {
  const f = fixture()
  f.fail('offer')
  await expect(complete_agent_handover(f.options)).rejects.toThrow('Uncertain submission')
  expect(f.calls.map(({ kind }) => kind)).toEqual(['offer'])
})

test('failed claim retains the offer; explicit recovery claims without another offer', async () => {
  const f = fixture()
  f.fail('claim')
  const error = await complete_agent_handover(f.options).catch((error: unknown) => error)
  expect(error).toBeInstanceOf(AgentHandoverIncomplete)
  expect(pre_submission_failure(error)).toBe(false)
  expect((error as AgentHandoverIncomplete).offer_digest).toBe('owner-receipt')
  f.fail(null)
  await complete_agent_handover(f.options)
  expect(f.calls.map(({ kind }) => kind)).toEqual(['offer', 'claim', 'claim'])
})

test('recipient change prevents both transactions', async () => {
  const f = fixture()
  f.invalidate()
  await expect(complete_agent_handover(f.options)).rejects.toThrow('Owner changed')
  expect(f.calls).toEqual([])
})

test('equipment transfers with its character and is supplied to atomic re-equipping claim', async () => {
  const f = fixture()
  await expect(complete_agent_handover(f.options)).resolves.toMatchObject({ digest: 'agent-receipt' })
  expect<unknown>(f.calls).toEqual([
    character,
    {
      kind: 'claim',
      character_id: 'character',
      seller_kiosk: 'source',
      purchase_cap: 'character-cap',
      recipient: 'agent',
      agent_address: 'owner',
      equipment: [{ slot: 'weapon', item_id: 'sword', purchase_cap: 'sword-cap' }],
    },
  ])
})

test('mismatched or partial existing caps refuse the whole selection', async () => {
  const f = fixture({ ...assets, items: [...assets.items, { item_id: 'ore', kiosk: 'source', version: '1' }] })
  f.offered()
  await expect(complete_agent_handover(f.options)).rejects.toThrow('does not match')
  expect(f.calls).toEqual([])
})

test('item drop confirms offer then claim with the recipient signer', async () => {
  const f = fixture(assets)
  await complete_agent_handover(f.options)
  expect(f.calls.map(({ kind }) => kind)).toEqual(['asset_offer', 'asset_claim'])
})

test('identity replacement after a confirmed offer stops before claiming and retains its digest', async () => {
  const f = fixture()
  const error = await complete_agent_handover({ ...f.options, on_offer: f.invalidate }).catch((error: unknown) => error)
  expect(error).toBeInstanceOf(AgentHandoverIncomplete)
  expect((error as AgentHandoverIncomplete).offer_digest).toBe('owner-receipt')
  expect(f.calls.map(({ kind }) => kind)).toEqual(['offer'])
})

test('a failed receipt projection cannot label an executed offer as unsubmitted', async () => {
  const f = fixture()
  const error = await complete_agent_handover({
    ...f.options,
    on_offer: () => {
      throw new Error('[sdk] transaction resolution failed — NOT submitted: observer failure')
    },
  }).catch((error: unknown) => error)
  expect(error).toBeInstanceOf(AgentHandoverIncomplete)
  expect(pre_submission_failure(error)).toBe(false)
  expect(f.calls.map(({ kind }) => kind)).toEqual(['offer'])
})

test('confirmed offers wait for their sender visibility barrier before reading receiving capabilities', async () => {
  const f = fixture(assets)
  let visible = false
  const released = Promise.withResolvers<void>()
  const entered = Promise.withResolvers<void>()
  const options = {
    ...f.options,
    offer: {
      ...f.options.offer,
      synchronize: async () => {
        if (!f.calls.length) return
        entered.resolve()
        await released.promise
        visible = true
      },
    },
    read: { ...f.options.read, items: async () => (visible ? f.options.read.items() : []) },
  }
  const result = complete_agent_handover(options)
  const observed = await Promise.race([
    entered.promise.then(() => 'waiting'),
    result.then(
      () => 'done',
      () => 'failed'
    ),
  ])
  expect(observed).toBe('waiting')
  expect(f.calls.map(({ kind }) => kind)).toEqual(['asset_offer'])
  released.resolve()
  await result
  expect(f.calls.map(({ kind }) => kind)).toEqual(['asset_offer', 'asset_claim'])
})

test('the real sender execution owner delays capability discovery until its accepted receipt is visible', async () => {
  const { SDK } = await import('../src/client.ts')
  const { fake_client, pins, signer } = await import('./helpers/transport.ts')
  const { receipt_digest } = await import('../src/cache.ts')
  const f = fixture(assets)
  const entered = Promise.withResolvers<void>(),
    release = Promise.withResolvers<void>()
  let visible = false
  const client = fake_client({ simulate_ok: true, visibility_gate: release.promise })
  const wait = client.core.waitForTransaction
  client.core.waitForTransaction = async (input) => {
    entered.resolve()
    const receipt = await wait(input)
    visible = true
    return receipt
  }
  const sdk = SDK({ client, signer, pins, transaction_storage: null })
  const { prepare } = f.options.offer
  const offer = {
    ...f.options.offer,
    synchronize: sdk.synchronize_transactions,
    prepare: async (input: AgentTransferIntent) => {
      const review = await prepare(input)
      return {
        ...review,
        confirm: async () => {
          await review.confirm()
          const receipt = await sdk.execute(sdk.tx())
          return { receipt, digest: receipt_digest(receipt) }
        },
      }
    },
  }
  const pending = complete_agent_handover({
    ...f.options,
    offer,
    read: { ...f.options.read, items: async () => (visible ? f.options.read.items() : []) },
  })
  await entered.promise
  expect(client.calls.executions).toBe(1)
  expect(f.calls.map(({ kind }) => kind)).toEqual(['asset_offer'])
  release.resolve()
  await pending
  expect(f.calls.map(({ kind }) => kind)).toEqual(['asset_offer', 'asset_claim'])
  expect(client.calls.visibility_waits).toEqual(client.calls.digests)
})

test('an explicit retry of a certified offer cannot repeat that offer when capability discovery still lags', async () => {
  const f = fixture(assets)
  const options = { ...f.options, read: { ...f.options.read, items: async () => [] } }
  const first = await complete_agent_handover(options).catch((error: unknown) => error)
  expect(first).toBeInstanceOf(AgentHandoverIncomplete)
  await expect(
    complete_agent_handover({ ...options, confirmed_offer: (first as AgentHandoverIncomplete).offer_digest })
  ).rejects.toThrow('could not be completed')
  expect(f.calls.map(({ kind }) => kind)).toEqual(['asset_offer'])
  await complete_agent_handover({ ...f.options, confirmed_offer: 'owner-receipt' })
  expect(f.calls.map(({ kind }) => kind)).toEqual(['asset_offer', 'asset_claim'])
})
