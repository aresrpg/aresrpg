// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import type { CharacterRow } from '@aresrpg/protocol'
import { Transaction, TransactionDataBuilder } from '@mysten/sui/transactions'

import { action_projected, reconcile_action } from '../src/action_reconciliation.ts'
import { empty_snapshot } from '../src/actor_snapshot.ts'
import { abandon_unsubmitted, create_transaction_lifecycle } from '../src/transaction_lifecycle.ts'
import { create_control_service, empty_lane, lane_key_for, type Command, type Lane } from '../src/control.ts'
import type { Grant } from '../src/model.ts'
import { gas, captured } from '../../sdk/test/helpers/transaction_conflict.ts'

import { fixture_bot, fixture_config, memory_store, put } from './helpers/control_fixture.ts'

const fixture = async (bytes = new Uint8Array([1, 2, 3])) => {
  const store = memory_store()
  const lane_key = lane_key_for(fixture_bot)
  const grant: Grant = {
    id: 'grant',
    authority_generation: fixture_config.authority_generation,
    owner: fixture_bot.owner,
    client_id: 'fixture-client',
    bot_id: fixture_bot.id,
    network: 'mainnet',
    address: fixture_bot.address,
    descriptor: fixture_bot.multisig_public_key,
    generation: 1,
    resource: fixture_config.resource,
    scopes: fixture_config.scopes,
    policy_revision: 1,

    revoked: false,
    code: { hash: '', challenge: '', redirect_uri: '', expires_at: 0, used: true },
    family: null,
    access: null,
  }
  const command: Command = {
    id: 'command',
    grant_id: grant.id,
    bot_id: fixture_bot.id,
    lane_key,
    fingerprint: 'fixture',
    kind: 'fight_turn',
    payload: {},
    decision_revision: 1,
    observation_revision: 1,
    status: 'accepted',
  }
  await put(store, `bot:${fixture_bot.id}`, fixture_bot)
  await put(store, 'grant:grant', grant)
  await put(store, 'command:command', command)
  await put(store, lane_key, {
    ...empty_lane(fixture_bot),
    actor_id: 'actor',
    fence: 1,
    lease_until: 10000,
    decision_revision: 1,
    observation_revision: 1,
    observed_at: 1000,
    needs_resync: false,
    active_command: command.id,
    latest_command: command.id,
  })
  const journal = create_transaction_lifecycle(
    store,
    fixture_config,
    () => ({ command, actor_id: 'actor', fence: 1 }),
    () => 1000
  )
  const digest = TransactionDataBuilder.getDigestFromBytes(bytes)
  const prepared = { digest, bytes, gas_budget_mist: '100' }
  const signed = { ...prepared, signatures: ['fixture-signature-not-usable'] }
  return { store, grant, command, journal, prepared, signed, lane_key }
}

test('session bytes and transaction gas precede signing, unknown outcomes retain lane', async () => {
  const f = await fixture()
  await f.journal.admit('prepare')
  await f.journal.prepared(f.prepared)
  expect(await f.store.read<Grant>('grant:grant')).toEqual(f.grant)
  const lane = await f.store.read<Lane>(f.lane_key)
  expect(lane?.pending?.bytes).toBe(Buffer.from(f.prepared.bytes).toString('base64'))
  await f.journal.signed(f.signed)
  await f.journal.mark_submitting(f.signed)
  expect(await f.journal.read()).toMatchObject({ digest: f.prepared.digest, phase: 'submitting' })
  await expect(f.journal.prepared(f.prepared)).rejects.toThrow('unresolved_envelope')
})

test('changed bytes and expired fence cannot advance a session envelope', async () => {
  const f = await fixture()
  await f.journal.prepared(f.prepared)
  await expect(f.journal.signed({ ...f.signed, bytes: new Uint8Array([9]) })).rejects.toThrow('envelope_changed')
  const lane = (await f.store.read<Lane>(f.lane_key))!
  await put(f.store, f.lane_key, { ...lane, actor_id: 'takeover', fence: 2 })
  await expect(f.journal.signed(f.signed)).rejects.toThrow('actor_fenced')
  expect((await f.store.read<Lane>(f.lane_key))?.pending?.phase).toBe('prepared')
})

test('revoke refuses new signatures but certified failed recovery settles once and charges gas', async () => {
  const f = await fixture()
  await f.journal.prepared(f.prepared)
  await f.journal.signed(f.signed)
  await put(f.store, 'grant:grant', { ...(await f.store.read<Grant>('grant:grant'))!, revoked: true, budget_mist: '0' })
  await expect(f.journal.admit('submit')).rejects.toThrow('invalid_token')
  const receipt = {
    FailedTransaction: {
      digest: f.prepared.digest,
      effects: {
        status: { success: false, error: { message: 'fixture Move abort' } },
        gasUsed: { computationCost: '20', storageCost: '5', storageRebate: '2' },
      },
    },
  }
  const pending = { ...(await f.journal.read())!, phase: 'submitted' as const }
  await f.journal.settled(receipt, pending)
  await f.journal.settled(receipt, pending)
  expect(await f.store.read<Grant>('grant:grant')).toMatchObject({
    revoked: true,
  })
  expect(await f.store.read('command:command')).toMatchObject({
    receipt,
    status: 'failed',
    error: 'fixture Move abort',
    result: { gas_mist: '23', success: false },
  })
  expect((await f.store.read<Lane>(f.lane_key))?.pending).toBeNull()
})

for (const gas_budget_mist of ['0', '-1', '1.5', '01', 'NaN', '18446744073709551616']) {
  test(`invalid transaction gas ${gas_budget_mist} fails atomically`, async () => {
    const f = await fixture()
    await expect(f.journal.prepared({ ...f.prepared, gas_budget_mist })).rejects.toThrow('invalid_gas_budget')
    expect((await f.store.read<Lane>(f.lane_key))?.pending).toBeNull()
    expect(await f.store.read<Grant>('grant:grant')).toEqual(f.grant)
  })
}
test('positive transaction gas has no additional grant allowance', async () => {
  const f = await fixture()
  await f.journal.prepared({ ...f.prepared, gas_budget_mist: '100000000000' })
  expect((await f.journal.read())?.gas_budget_mist).toBe('100000000000')
  expect(await f.store.read<Grant>('grant:grant')).toEqual(f.grant)
})

test('two pods and bot IDs share the same signing-address lease', async () => {
  const f = await fixture()
  const control = create_control_service(f.store, fixture_config, 1000, () => 1000)
  await expect(control.acquire({ ...fixture_bot, id: 'other-logical-bot' }, 'other-actor', 1000)).rejects.toThrow(
    'actor_owned'
  )
})

test('incomplete certified outcome rolls back receipt and terminal envelope changes together', async () => {
  const f = await fixture()
  await f.journal.prepared(f.prepared)
  const receipt = {
    Transaction: {
      digest: f.prepared.digest,
      effects: {
        gasUsed: { computationCost: '20', storageCost: '5', storageRebate: '2' },
      },
    },
  }
  await expect(f.journal.settled(receipt, { ...f.prepared, phase: 'submitted' })).rejects.toThrow(
    'receipt_outcome_missing'
  )
  expect((await f.store.read<Lane>(f.lane_key))?.pending?.digest).toBe(f.prepared.digest)
  expect(await f.store.read<Command>('command:command')).toMatchObject({ status: 'executing' })
  expect((await f.store.read<Command>('command:command'))?.receipt).toBeUndefined()
})

test('session receipt preserves negative net gas rebates without an allowance ledger', async () => {
  const f = await fixture()
  await f.journal.prepared(f.prepared)
  const receipt = {
    Transaction: {
      digest: f.prepared.digest,
      effects: {
        status: { success: true },
        gasUsed: { computationCost: '20', storageCost: '5', storageRebate: '100' },
      },
    },
  }
  await f.journal.settled(receipt, { ...f.prepared, phase: 'submitted' })
  expect(await f.store.read('command:command')).toMatchObject({
    receipt,
    status: 'completed',
    result: { gas_mist: '-75' },
  })
  expect(await f.store.read<Grant>('grant:grant')).toEqual(f.grant)
})

test('a settled command is reported with its digest and outcome but never its receipt body', async () => {
  const f = await fixture()
  await f.journal.prepared(f.prepared)
  const receipt = {
    Transaction: {
      digest: f.prepared.digest,
      effects: { status: { success: true }, gasUsed: { computationCost: '20', storageCost: '5', storageRebate: '2' } },
    },
  }
  await f.journal.settled(receipt, { ...f.prepared, phase: 'submitted' })
  const control = create_control_service(f.store, fixture_config, 60000)
  const reported = await control.status(f.grant, 'command')
  expect(reported).toMatchObject({ status: 'completed', result: { digest: f.prepared.digest, success: true } })
  expect(reported).not.toHaveProperty('receipt')
  expect(JSON.stringify(reported)).not.toContain('gasUsed')
})

test('fenced preparation cancellation retains command identity and blocks late signing', async () => {
  const f = await fixture()
  await f.journal.prepared(f.prepared)
  await abandon_unsubmitted(
    f.store,
    { command: f.command, actor_id: 'actor', fence: 1 },
    f.prepared.digest,
    'prepared',
    1000
  )
  expect(await f.store.read('command:command')).toMatchObject({
    fingerprint: f.command.fingerprint,
    status: 'failed',
    error: 'preparation_abandoned',
  })
  expect(await f.store.read<Lane>(f.lane_key)).toMatchObject({
    pending: null,
    active_command: null,
    needs_resync: true,
  })
  await expect(f.journal.signed(f.signed)).rejects.toThrow('command_not_active')
  await expect(f.journal.mark_submitting(f.signed)).rejects.toThrow('command_not_active')
})

for (const phase of ['signed', 'submitting'] as const) {
  test(`preparation cancellation cannot clear ${phase} evidence`, async () => {
    const f = await fixture()
    await f.journal.prepared(f.prepared)
    await f.journal.signed(f.signed)
    if (phase === 'submitting') await f.journal.mark_submitting(f.signed)
    await expect(
      abandon_unsubmitted(
        f.store,
        { command: f.command, actor_id: 'actor', fence: 1 },
        f.prepared.digest,
        'prepared',
        1000
      )
    ).rejects.toThrow('envelope_transition_conflict')
    expect((await f.store.read<Lane>(f.lane_key))?.pending?.phase).toBe(phase)
  })
}

test('expired actors and mismatched digests cannot cancel prepared evidence', async () => {
  const f = await fixture()
  await f.journal.prepared(f.prepared)
  const binding = { command: f.command, actor_id: 'actor', fence: 1 }
  await expect(abandon_unsubmitted(f.store, binding, 'another-digest', 'prepared', 1000)).rejects.toThrow(
    'envelope_transition_conflict'
  )
  await expect(abandon_unsubmitted(f.store, binding, f.prepared.digest, 'prepared', 10001)).rejects.toThrow(
    'actor_fenced'
  )
  expect((await f.store.read<Lane>(f.lane_key))?.pending?.phase).toBe('prepared')
})

for (const first of ['cancel', 'submit'] as const) {
  test(`signed cancellation and submission consume one fenced phase when ${first} wins`, async () => {
    const f = await fixture()
    await f.journal.prepared(f.prepared)
    await f.journal.signed(f.signed)
    const cancel = () =>
      abandon_unsubmitted(
        f.store,
        { command: f.command, actor_id: 'actor', fence: 1 },
        f.prepared.digest,
        'signed',
        1000
      )
    const submit = () => f.journal.mark_submitting(f.signed)
    const winner = first === 'cancel' ? cancel() : submit()
    const loser = winner.then(first === 'cancel' ? submit : cancel)
    const results = await Promise.allSettled([winner, loser])
    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1)
    const lane = (await f.store.read<Lane>(f.lane_key))!
    const command = (await f.store.read<Command>('command:command'))!
    expect(command.fingerprint).toBe(f.command.fingerprint)
    if (first === 'cancel') {
      expect(lane.pending).toBeNull()
      expect(command.status).toBe('cancelled')
      await expect(submit()).rejects.toThrow('command_not_active')
    } else {
      expect(lane.pending?.phase).toBe('submitting')
      await expect(cancel()).rejects.toThrow('envelope_transition_conflict')
    }
  })
}

test('certified failure preserves resync while successful settlement always requires reconciliation', async () => {
  for (const success of [false, true])
    for (const needs_resync of [false, true]) {
      const f = await fixture()
      await f.journal.prepared(f.prepared)
      await f.journal.signed(f.signed)
      await f.journal.mark_submitting(f.signed)
      const lane = (await f.store.read<Lane>(f.lane_key))!
      await put(f.store, f.lane_key, { ...lane, needs_resync })
      const result = {
        digest: f.prepared.digest,
        effects: {
          status: { success, error: { message: 'Move abort' } },
          gasUsed: { computationCost: '20', storageCost: '5', storageRebate: '2' },
        },
      }
      await f.journal.settled(success ? { Transaction: result } : { FailedTransaction: result }, {
        ...f.signed,
        phase: 'submitted',
      })
      expect(await f.store.read<Lane>(f.lane_key)).toMatchObject({
        needs_resync: success || needs_resync,
        pending: null,
        active_command: null,
      })
    }
})

test('ordinary successful action reconciles its domain projection in either receipt order during the session', async () => {
  for (const projection_first of [true, false]) {
    const f = await fixture()
    const command: Command = {
      ...f.command,
      kind: 'world_search',
      payload: { character_id: '0x1', world: 'test', x: 3, z: 4 },
      action_baseline: { checkpoint_ms: 100 },
    }
    await put(f.store, 'command:command', command)
    const journal = create_transaction_lifecycle(
      f.store,
      fixture_config,
      () => ({ command, actor_id: 'actor', fence: 1 }),
      () => 1000
    )
    const control = create_control_service(f.store, fixture_config, 60000, () => 1000)
    await journal.prepared(f.prepared)
    await journal.signed(f.signed)
    await journal.mark_submitting(f.signed)
    const receipt = {
      Transaction: {
        digest: f.prepared.digest,
        events: [
          { type: '0x1::zone::ZoneSearched', json: { world: 'test', zone_x: 0, zone_z: 0, seed: '7', fresh: true } },
        ],
        effects: {
          status: { success: true },
          gasUsed: { computationCost: '20', storageCost: '5', storageRebate: '2' },
        },
      },
    }
    if (projection_first) await control.observed(f.lane_key, 'actor', 1, true, true)
    await journal.settled(receipt, { ...f.signed, phase: 'submitted' })
    if (!projection_first) await control.observed(f.lane_key, 'actor', 1, true, true)
    // Unrelated changes and unchanged heartbeats are not domain proof.
    await control.observed(f.lane_key, 'actor', 1, true, false)
    const lane = (await f.store.read<Lane>(f.lane_key))!
    expect(lane.needs_resync).toBeTrue()
    const character = { id: '0x1', world: 'test', x: 3, z: 4, at_ms: 100 } as CharacterRow
    const context = {
      address: fixture_bot.address,
      command,
      snapshot: {
        ...empty_snapshot(),
        ready: true,
        observation_revision: lane.observation_revision,
        characters: [character],
      },
      now: 1000,
      freshness_ms: 60000,
    }
    await reconcile_action(f.store, f.lane_key, 'actor', 1, context, 1000)
    expect((await f.store.read<Lane>(f.lane_key))!.needs_resync).toBeTrue()
    // Reconstruct the context while retaining the same process-local receipt barrier.
    const character_only = { ...context, snapshot: { ...context.snapshot, characters: [{ ...character, at_ms: 101 }] } }
    await reconcile_action(f.store, f.lane_key, 'actor', 1, character_only, 1000)
    expect((await f.store.read<Lane>(f.lane_key))!.needs_resync).toBeTrue()
    const projected = {
      ...character_only,
      snapshot: {
        ...character_only.snapshot,
        zones: {
          'test:0:0': {
            zone: { world: 'test', zx: 0, zz: 0, seed: '7', searched_at_ms: 101, mob_taken: '0', res_taken: [] },
            spawns: { type: 'packet/zone_spawns' as const, world: 'test', zx: 0, zz: 0, mobs: [], resources: [] },
          },
        },
      },
    }
    const completed = (await f.store.read<Command>('command:command'))!
    const newer = {
      ...projected,
      snapshot: {
        ...projected.snapshot,
        zones: {
          'test:0:0': {
            ...projected.snapshot.zones['test:0:0'],
            zone: { ...projected.snapshot.zones['test:0:0'].zone, seed: '8', searched_at_ms: 200 },
          },
        },
      },
    }
    expect(action_projected(completed, receipt, newer)).toBeTrue()
    const stale_seed = {
      ...newer,
      snapshot: {
        ...newer.snapshot,
        zones: {
          'test:0:0': {
            ...newer.snapshot.zones['test:0:0'],
            zone: { ...newer.snapshot.zones['test:0:0'].zone, searched_at_ms: 99 },
          },
        },
      },
    }
    expect(action_projected(completed, receipt, stale_seed)).toBeFalse()
    await reconcile_action(f.store, f.lane_key, 'actor', 1, projected, 1000)
    expect(await f.store.read<Lane>(f.lane_key)).toMatchObject({ needs_resync: false, reconciliation_command: null })
  }
})

const conflict_fixture = async () => {
  const tx = new Transaction()
  tx.setSender(captured.Transaction.effects.changedObjects[0]!.inputOwner.AddressOwner)
  tx.setGasPayment([gas])
  tx.setGasBudget(100)
  tx.setGasPrice(1)
  const f = await fixture(await tx.build())
  await f.journal.prepared(f.prepared)
  await f.journal.signed(f.signed)
  await f.journal.mark_submitting(f.signed)
  return { ...f, record: { digest: f.prepared.digest, phase: 'submitted' as const } }
}

test('certified conflict fails the exact command atomically, preserves stopped control and retains proof', async () => {
  const f = await conflict_fixture()
  const lane = (await f.store.read<Lane>(f.lane_key))!
  await put(f.store, f.lane_key, { ...lane, paused: true, transport_stopped: true })
  await put(f.store, 'behavior:stopped', { status: 'stopped', issue: 'explicit_stop' })
  await put(f.store, 'command:command', {
    ...(await f.store.read<Command>('command:command'))!,
    run_id: 'stopped',
  })
  await put(f.store, 'grant:grant', { ...f.grant, revoked: true })
  await f.journal.conflicted!(captured, f.record)
  await f.journal.conflicted!(captured, f.record)
  expect(await f.store.read<Command>('command:command')).toMatchObject({
    status: 'failed',
    error: 'transaction_input_consumed',
    result: { digest: f.prepared.digest, executed: false, conflicting_receipt: captured },
  })
  expect(await f.store.read<Lane>(f.lane_key)).toMatchObject({
    paused: true,
    transport_stopped: true,
    needs_resync: true,
    pending: null,
    active_command: null,
    decision_revision: lane.decision_revision + 1,
  })
  expect(await f.store.read('behavior:stopped')).toEqual({ status: 'stopped', issue: 'explicit_stop' })
  // A proven conflict records its proof as the result, never as a settled receipt.
  expect((await f.store.read<Command>('command:command'))?.receipt).toBeUndefined()
})

for (const mismatch of ['fence', 'lease', 'phase', 'command', 'grant', 'digest', 'active', 'proof'] as const) {
  test(`conflict journal refuses ${mismatch} mismatch without clearing pending`, async () => {
    const f = await conflict_fixture()
    const lane = (await f.store.read<Lane>(f.lane_key))!
    const proof = structuredClone(captured)
    const pending = { ...lane.pending! }
    const corrupt = {
      fence: () => ({ ...lane, fence: 2 }),
      lease: () => ({ ...lane, lease_until: 999 }),
      active: () => ({ ...lane, active_command: 'other' }),
      phase: () => ({ ...lane, pending: { ...pending, phase: 'signed' } }),
      command: () => ({ ...lane, pending: { ...pending, command_id: 'other' } }),
      grant: () => ({ ...lane, pending: { ...pending, grant_id: 'other' } }),
      digest: () => ({ ...lane, pending: { ...pending, digest: captured.Transaction.digest } }),
      proof: () => {
        proof.Transaction.effects.changedObjects[0]!.inputDigest = captured.Transaction.digest
        return lane
      },
    }
    await put(f.store, f.lane_key, corrupt[mismatch]())
    await expect(f.journal.conflicted!(proof, f.record)).rejects.toThrow()
    expect((await f.store.read<Lane>(f.lane_key))?.pending).not.toBeNull()
    expect((await f.store.read<Command>('command:command'))?.status).toBe('executing')
  })
}

test('idempotent conflict acknowledgment still requires the live actor fence and exact proof', async () => {
  const f = await conflict_fixture()
  await f.journal.conflicted!(captured, f.record)
  await expect(f.journal.conflicted!(captured, { ...f.record, digest: captured.Transaction.digest })).rejects.toThrow()
  const lane = (await f.store.read<Lane>(f.lane_key))!
  await put(f.store, f.lane_key, { ...lane, fence: 2 })
  await expect(f.journal.conflicted!(captured, f.record)).rejects.toThrow('actor_fenced')
})

test('one lifecycle follows command bindings without reopening settled submission', async () => {
  const f = await fixture()
  let { command } = f
  const lifecycle = create_transaction_lifecycle(
    f.store,
    fixture_config,
    () => ({ command, actor_id: 'actor', fence: 1 }),
    () => 1000
  )
  await lifecycle.prepared(f.prepared)
  await lifecycle.signed(f.signed)
  await lifecycle.mark_submitting(f.signed)
  await expect(lifecycle.mark_submitting(f.signed)).rejects.toThrow('envelope_transition_conflict')
  await lifecycle.settled(
    {
      Transaction: {
        digest: f.prepared.digest,
        effects: {
          status: { success: false, error: 'aborted' },
          gasUsed: {
            computationCost: '1',
            storageCost: '0',
            storageRebate: '0',
          },
        },
      },
    },
    { ...f.signed, phase: 'submitted' }
  )
  expect(await f.store.read('command:command')).toMatchObject({ status: 'failed' })
  command = { ...command, id: 'next-command' }
  await put(f.store, `command:${command.id}`, command)
  const lane = (await f.store.read<Lane>(f.lane_key))!
  await put(f.store, f.lane_key, { ...lane, active_command: command.id, latest_command: command.id })
  await lifecycle.prepared(f.prepared)
  expect((await f.store.read<Lane>(f.lane_key))?.pending?.command_id).toBe(command.id)
  // Admitting the next command releases the settled one; it is never reopened.
  expect(await f.store.read('command:command')).toBeNull()
})

test('pause between signing and submission refuses consumption, and takeover refuses reading bytes', async () => {
  const f = await fixture()
  await f.journal.prepared(f.prepared)
  await f.journal.signed(f.signed)
  const lane = (await f.store.read<Lane>(f.lane_key))!
  await put(f.store, f.lane_key, { ...lane, paused: true })
  await expect(f.journal.mark_submitting(f.signed)).rejects.toThrow('execution_not_authorized')
  expect((await f.journal.read())?.phase).toBe('signed')
  await put(f.store, f.lane_key, { ...lane, actor_id: 'other', fence: 2 })
  await expect(f.journal.read()).rejects.toThrow('actor_fenced')
})

test('duplicate settlement rechecks the fence atomically after the outer lane read', async () => {
  const f = await fixture()
  await f.journal.prepared(f.prepared)
  const receipt = {
    Transaction: {
      digest: f.prepared.digest,
      effects: {
        status: { success: false, error: 'aborted' },
        gasUsed: { computationCost: '1', storageCost: '0', storageRebate: '0' },
      },
    },
  }
  const record = { ...f.prepared, phase: 'submitted' as const }
  await f.journal.settled(receipt, record)
  const lane = (await f.store.read<Lane>(f.lane_key))!
  const racing_store = {
    ...f.store,
    transaction: async <T>(...args: Parameters<typeof f.store.transaction<T>>) => {
      await put(f.store, f.lane_key, { ...lane, actor_id: 'replacement', fence: 2 })
      return f.store.transaction<T>(...args)
    },
  }
  const lifecycle = create_transaction_lifecycle(
    racing_store,
    fixture_config,
    () => ({ command: f.command, actor_id: 'actor', fence: 1 }),
    () => 1000
  )
  await expect(lifecycle.settled(receipt, record)).rejects.toThrow('actor_fenced')
})
