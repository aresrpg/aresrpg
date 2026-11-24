// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The transaction lifecycle: the envelope phases a signed command crosses, its gas, its certified
// outcome, a proven conflict and the reconciliation that frees the wallet's signing slot.
import { expect, test } from 'bun:test'
import type { CharacterRow } from '@aresrpg/protocol'
import type { Receipt } from '@aresrpg/sdk/cache'
import { Transaction, TransactionDataBuilder } from '@mysten/sui/transactions'

import { gas, captured } from '../../sdk/test/helpers/transaction_conflict.ts'
import { action_projected, reconcile_action } from '../src/action_reconciliation.ts'
import { empty_snapshot } from '../src/actor_snapshot.ts'
import { create_control_service, empty_lane, lane_key_for, type Command, type Lane } from '../src/control.ts'
import type { Grant } from '../src/model.ts'
import { abandon_unsubmitted, create_transaction_lifecycle } from '../src/transaction_lifecycle.ts'

import { fixture_bot, fixture_config, grant_of, memory_store, put } from './fixture.ts'

const ledger = async (bytes = new Uint8Array([1, 2, 3]), patch: Partial<Command> = {}) => {
  const store = memory_store()
  const lane_key = lane_key_for(fixture_bot)
  const grant = grant_of(fixture_bot, { client_id: 'fixture-client' })
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
    ...patch,
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
  const lane = async () => (await store.read<Lane>(lane_key))!
  const stored = async () => (await store.read<Command>('command:command'))!
  const binding = { command, actor_id: 'actor', fence: 1 }
  return { store, grant, command, journal, prepared, signed, lane_key, lane, stored, binding }
}
const receipt_of = (
  digest: string,
  success: boolean,
  rebate = '2',
  error: unknown = { message: 'fixture Move abort' }
): Receipt => {
  const result = {
    digest,
    effects: {
      status: { success, error },
      gasUsed: { computationCost: '20', storageCost: '5', storageRebate: rebate },
    },
  }
  return (success ? { Transaction: result } : { FailedTransaction: result }) as Receipt
}

test('S20 bytes and gas are fixed before signing: changed bytes, an expired fence, a pause or a takeover cannot advance the envelope', async () => {
  const f = await ledger()
  await f.journal.admit('prepare')
  await f.journal.prepared(f.prepared)
  expect([await f.store.read<Grant>('grant:grant'), (await f.lane()).pending!.bytes]).toEqual([
    f.grant,
    Buffer.from(f.prepared.bytes).toString('base64'),
  ])
  await expect(f.journal.signed({ ...f.signed, bytes: new Uint8Array([9]) })).rejects.toThrow('envelope_changed')
  const lane = await f.lane()
  await put(f.store, f.lane_key, { ...lane, actor_id: 'takeover', fence: 2 })
  await expect(f.journal.signed(f.signed)).rejects.toThrow('actor_fenced')
  expect((await f.lane()).pending!.phase).toBe('prepared')
  await put(f.store, f.lane_key, lane)
  await f.journal.signed(f.signed)
  await put(f.store, f.lane_key, { ...lane, pending: (await f.lane()).pending, paused: true })
  await expect(f.journal.mark_submitting(f.signed)).rejects.toThrow('execution_not_authorized')
  expect((await f.journal.read())!.phase).toBe('signed')
  await put(f.store, f.lane_key, { ...(await f.lane()), paused: false })
  await f.journal.mark_submitting(f.signed)
  expect(await f.journal.read()).toMatchObject({ digest: f.prepared.digest, phase: 'submitting' })
  await expect(f.journal.prepared(f.prepared)).rejects.toThrow('unresolved_envelope')
  await expect(f.journal.mark_submitting(f.signed)).rejects.toThrow('envelope_transition_conflict')
  await put(f.store, f.lane_key, { ...(await f.lane()), actor_id: 'other', fence: 2 })
  await expect(f.journal.read()).rejects.toThrow('actor_fenced')
  // Two pods and two bot ids of one address share one signing lease.
  const control = create_control_service(f.store, fixture_config, 1000, () => 1000)
  await put(f.store, f.lane_key, lane)
  await expect(control.acquire({ ...fixture_bot, id: 'other-logical-bot' }, 'other-actor', 1000)).rejects.toThrow(
    'actor_owned'
  )
})

test('S23 the gas budget is a positive u64 and no allowance is kept beside it', async () => {
  for (const gas_budget_mist of ['0', '-1', '1.5', '01', 'NaN', '18446744073709551616']) {
    const f = await ledger()
    await expect(f.journal.prepared({ ...f.prepared, gas_budget_mist })).rejects.toThrow('invalid_gas_budget')
    expect([(await f.lane()).pending, await f.store.read<Grant>('grant:grant')]).toEqual([null, f.grant])
  }
})

test('S23 an incomplete outcome rolls back; a negative net rebate is kept; a settled command is told without its receipt', async () => {
  const f = await ledger()
  await f.journal.prepared({ ...f.prepared, gas_budget_mist: '100000000000' })
  expect((await f.journal.read())!.gas_budget_mist).toBe('100000000000')
  const incomplete = {
    Transaction: {
      digest: f.prepared.digest,
      effects: { gasUsed: { computationCost: '20', storageCost: '5', storageRebate: '2' } },
    },
  }
  await expect(f.journal.settled(incomplete, { ...f.prepared, phase: 'submitted' })).rejects.toThrow(
    'receipt_outcome_missing'
  )
  expect([(await f.lane()).pending!.digest, (await f.stored()).status, (await f.stored()).receipt]).toEqual([
    f.prepared.digest,
    'executing',
    undefined,
  ])
  const rebated = receipt_of(f.prepared.digest, true, '100')
  await f.journal.settled(rebated, { ...f.prepared, phase: 'submitted' })
  expect(await f.stored()).toMatchObject({ receipt: rebated, status: 'completed', result: { gas_mist: '-75' } })
  expect(await f.store.read<Grant>('grant:grant')).toEqual(f.grant)
  // A settled command is told by digest and outcome, never by its receipt body.
  const reported = await create_control_service(f.store, fixture_config, 60000, () => 1000).status(f.grant, 'command')
  expect(reported).toMatchObject({ status: 'completed', result: { digest: f.prepared.digest, success: true } })
  expect(['receipt' in reported, JSON.stringify(reported).includes('gasUsed')]).toEqual([false, false])
})

test('S21 a revoked grant signs nothing more, yet a certified failure settles once, charges its gas and keeps a resync; success always reconciles', async () => {
  const f = await ledger()
  await f.journal.prepared(f.prepared)
  await f.journal.signed(f.signed)
  await put(f.store, 'grant:grant', { ...f.grant, revoked: true, budget_mist: '0' })
  await expect(f.journal.admit('submit')).rejects.toThrow('invalid_token')
  const failed = receipt_of(f.prepared.digest, false)
  const pending = { ...(await f.journal.read())!, phase: 'submitted' as const }
  await f.journal.settled(failed, pending)
  await f.journal.settled(failed, pending)
  expect(await f.stored()).toMatchObject({
    receipt: failed,
    status: 'failed',
    error: 'fixture Move abort',
    result: { gas_mist: '23', success: false },
  })
  expect([(await f.store.read<Grant>('grant:grant'))!.revoked, (await f.lane()).pending]).toEqual([true, null])
  for (const success of [false, true])
    for (const needs_resync of [false, true]) {
      const g = await ledger()
      await g.journal.prepared(g.prepared)
      await g.journal.signed(g.signed)
      await g.journal.mark_submitting(g.signed)
      await put(g.store, g.lane_key, { ...(await g.lane()), needs_resync })
      await g.journal.settled(receipt_of(g.prepared.digest, success, '2', { message: 'Move abort' }), {
        ...g.signed,
        phase: 'submitted',
      })
      expect(await g.lane()).toMatchObject({
        needs_resync: success || needs_resync,
        pending: null,
        active_command: null,
      })
    }
  // A duplicate settlement rechecks the fence atomically after its outer lane read.
  const d = await ledger()
  await d.journal.prepared(d.prepared)
  const aborted = receipt_of(d.prepared.digest, false, '0', 'aborted')
  const record = { ...d.prepared, phase: 'submitted' as const }
  await d.journal.settled(aborted, record)
  const lane = await d.lane()
  const racing = {
    ...d.store,
    transaction: async <T>(...args: Parameters<typeof d.store.transaction<T>>) => {
      await put(d.store, d.lane_key, { ...lane, actor_id: 'replacement', fence: 2 })
      return d.store.transaction<T>(...args)
    },
  }
  const lifecycle = create_transaction_lifecycle(
    racing,
    fixture_config,
    () => d.binding,
    () => 1000
  )
  await expect(lifecycle.settled(aborted, record)).rejects.toThrow('actor_fenced')
})

test('S22 unsubmitted work is cancelled only by its live fence and digest: prepared evidence fails the command, signed evidence races submission once', async () => {
  const f = await ledger()
  await f.journal.prepared(f.prepared)
  await expect(abandon_unsubmitted(f.store, f.binding, 'another-digest', 'prepared', 1000)).rejects.toThrow(
    'envelope_transition_conflict'
  )
  await expect(abandon_unsubmitted(f.store, f.binding, f.prepared.digest, 'prepared', 10001)).rejects.toThrow(
    'actor_fenced'
  )
  await abandon_unsubmitted(f.store, f.binding, f.prepared.digest, 'prepared', 1000)
  expect(await f.stored()).toMatchObject({
    fingerprint: f.command.fingerprint,
    status: 'failed',
    error: 'preparation_abandoned',
  })
  expect(await f.lane()).toMatchObject({ pending: null, active_command: null, needs_resync: true })
  await expect(f.journal.signed(f.signed)).rejects.toThrow('command_not_active')
  await expect(f.journal.mark_submitting(f.signed)).rejects.toThrow('command_not_active')
  for (const phase of ['signed', 'submitting'] as const) {
    const g = await ledger()
    await g.journal.prepared(g.prepared)
    await g.journal.signed(g.signed)
    if (phase === 'submitting') await g.journal.mark_submitting(g.signed)
    await expect(abandon_unsubmitted(g.store, g.binding, g.prepared.digest, 'prepared', 1000)).rejects.toThrow(
      'envelope_transition_conflict'
    )
    expect((await g.lane()).pending!.phase).toBe(phase)
  }
})

test('S22 a signed envelope is consumed once: by its cancellation or by its submission, whichever wins', async () => {
  for (const first of ['cancel', 'submit'] as const) {
    const g = await ledger()
    await g.journal.prepared(g.prepared)
    await g.journal.signed(g.signed)
    const cancel = () => abandon_unsubmitted(g.store, g.binding, g.prepared.digest, 'signed', 1000)
    const submit = () => g.journal.mark_submitting(g.signed)
    const winner = first === 'cancel' ? cancel() : submit()
    const results = await Promise.allSettled([winner, winner.then(first === 'cancel' ? submit : cancel)])
    expect([results.filter(({ status }) => status === 'fulfilled').length, (await g.stored()).fingerprint]).toEqual([
      1,
      g.command.fingerprint,
    ])
    if (first === 'cancel') {
      expect([(await g.lane()).pending, (await g.stored()).status]).toEqual([null, 'cancelled'])
      await expect(submit()).rejects.toThrow('command_not_active')
    } else {
      expect((await g.lane()).pending!.phase).toBe('submitting')
      await expect(cancel()).rejects.toThrow('envelope_transition_conflict')
    }
  }
  // One lifecycle follows the next command binding and never reopens a settled submission.
  const h = await ledger()
  let { command } = h
  const lifecycle = create_transaction_lifecycle(
    h.store,
    fixture_config,
    () => ({ command, actor_id: 'actor', fence: 1 }),
    () => 1000
  )
  await lifecycle.prepared(h.prepared)
  await lifecycle.signed(h.signed)
  await lifecycle.mark_submitting(h.signed)
  await lifecycle.settled(receipt_of(h.prepared.digest, false, '0', 'aborted'), { ...h.signed, phase: 'submitted' })
  command = { ...command, id: 'next-command' }
  await put(h.store, `command:${command.id}`, command)
  await put(h.store, h.lane_key, { ...(await h.lane()), active_command: command.id, latest_command: command.id })
  await lifecycle.prepared(h.prepared)
  expect([(await h.lane()).pending!.command_id, await h.store.read('command:command')]).toEqual([command.id, null])
})

const conflicted = async () => {
  const tx = new Transaction()
  tx.setSender(captured.Transaction.effects.changedObjects[0]!.inputOwner.AddressOwner)
  tx.setGasPayment([gas])
  tx.setGasBudget(100)
  tx.setGasPrice(1)
  const f = await ledger(await tx.build())
  await f.journal.prepared(f.prepared)
  await f.journal.signed(f.signed)
  await f.journal.mark_submitting(f.signed)
  return { ...f, record: { digest: f.prepared.digest, phase: 'submitted' as const } }
}
test('S24 a certified conflict (captured mainnet receipt) fails the exact command once, keeps its proof and a stop; any mismatch clears nothing', async () => {
  const f = await conflicted()
  const lane = await f.lane()
  await put(f.store, f.lane_key, { ...lane, paused: true })
  await put(f.store, 'behavior:stopped', { status: 'stopped', issue: 'explicit_stop' })
  await put(f.store, 'command:command', { ...(await f.stored()), run_id: 'stopped' })
  await put(f.store, 'grant:grant', { ...f.grant, revoked: true })
  await f.journal.conflicted!(captured, f.record)
  await f.journal.conflicted!(captured, f.record)
  expect(await f.stored()).toMatchObject({
    status: 'failed',
    error: 'transaction_input_consumed',
    result: { digest: f.prepared.digest, executed: false, conflicting_receipt: captured },
  })
  expect((await f.stored()).receipt).toBeUndefined()
  expect(await f.lane()).toMatchObject({
    paused: true,
    needs_resync: true,
    pending: null,
    active_command: null,
    decision_revision: lane.decision_revision + 1,
  })
  expect(await f.store.read('behavior:stopped')).toEqual({ status: 'stopped', issue: 'explicit_stop' })
  await expect(f.journal.conflicted!(captured, { ...f.record, digest: captured.Transaction.digest })).rejects.toThrow()
  await put(f.store, f.lane_key, { ...(await f.lane()), fence: 2 })
  await expect(f.journal.conflicted!(captured, f.record)).rejects.toThrow('actor_fenced')
  for (const mismatch of ['fence', 'lease', 'phase', 'command', 'grant', 'digest', 'active', 'proof'] as const) {
    const g = await conflicted()
    const current = await g.lane()
    const proof = structuredClone(captured)
    const pending = { ...current.pending! }
    const corrupt = {
      fence: () => ({ ...current, fence: 2 }),
      lease: () => ({ ...current, lease_until: 999 }),
      active: () => ({ ...current, active_command: 'other' }),
      phase: () => ({ ...current, pending: { ...pending, phase: 'signed' } }),
      command: () => ({ ...current, pending: { ...pending, command_id: 'other' } }),
      grant: () => ({ ...current, pending: { ...pending, grant_id: 'other' } }),
      digest: () => ({ ...current, pending: { ...pending, digest: captured.Transaction.digest } }),
      proof: () => {
        proof.Transaction.effects.changedObjects[0]!.inputDigest = captured.Transaction.digest
        return current
      },
    }
    await put(g.store, g.lane_key, corrupt[mismatch]())
    await expect(g.journal.conflicted!(proof, g.record)).rejects.toThrow()
    expect([mismatch, (await g.lane()).pending !== null, (await g.stored()).status]).toEqual([
      mismatch,
      true,
      'executing',
    ])
  }
})

test('8 a settled action frees the slot only once its own effect is projected, in either receipt order', async () => {
  for (const projection_first of [true, false]) {
    const f = await ledger(undefined, {
      kind: 'world_search',
      payload: { character_id: '0x1', world: 'test', x: 3, z: 4 },
      action_baseline: { checkpoint_ms: 100 },
    })
    const command = await f.stored()
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
        ...receipt_of(f.prepared.digest, true).Transaction!,
        events: [
          { type: '0x1::zone::ZoneSearched', json: { world: 'test', zone_x: 0, zone_z: 0, seed: '7', fresh: true } },
        ],
      },
    } as Receipt
    if (projection_first) await control.observed(f.lane_key, 'actor', 1, true, true)
    await journal.settled(receipt, { ...f.signed, phase: 'submitted' })
    if (!projection_first) await control.observed(f.lane_key, 'actor', 1, true, true)
    // Unrelated changes and unchanged heartbeats are not domain proof.
    await control.observed(f.lane_key, 'actor', 1, true, false)
    expect((await f.lane()).needs_resync).toBeTrue()
    const character = { id: '0x1', world: 'test', x: 3, z: 4, at_ms: 100 } as CharacterRow
    const snapshot = {
      ...empty_snapshot(),
      ready: true,
      observation_revision: (await f.lane()).observation_revision,
      characters: [character],
    }
    const context = { address: fixture_bot.address, command, snapshot, now: 1000, freshness_ms: 60000 }
    await reconcile_action(f.store, f.lane_key, 'actor', 1, context, 1000)
    const moved = { ...context, snapshot: { ...snapshot, characters: [{ ...character, at_ms: 101 }] } }
    await reconcile_action(f.store, f.lane_key, 'actor', 1, moved, 1000)
    expect((await f.lane()).needs_resync).toBeTrue()
    const zone = (seed: string, searched_at_ms: number) => ({
      'test:0:0': {
        zone: { world: 'test', zx: 0, zz: 0, seed, searched_at_ms, mob_taken: '0', res_taken: [] },
        spawns: { type: 'packet/zone_spawns' as const, world: 'test', zx: 0, zz: 0, mobs: [], resources: [] },
      },
    })
    const projected = { ...moved, snapshot: { ...moved.snapshot, zones: zone('7', 101) } }
    const completed = await f.stored()
    expect(
      action_projected(completed, receipt, { ...moved, snapshot: { ...moved.snapshot, zones: zone('8', 200) } })
    ).toBeTrue()
    expect(
      action_projected(completed, receipt, { ...moved, snapshot: { ...moved.snapshot, zones: zone('8', 99) } })
    ).toBeFalse()
    await reconcile_action(f.store, f.lane_key, 'actor', 1, projected, 1000)
    expect(await f.lane()).toMatchObject({ needs_resync: false, reconciliation_command: null })
  }
})
