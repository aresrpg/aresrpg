// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import type { CharacterRow } from '@aresrpg/protocol'
import { TransactionDataBuilder } from '@mysten/sui/transactions'

import { action_projected, reconcile_action } from '../src/action_reconciliation.ts'
import { empty_snapshot } from '../src/actor_snapshot.ts'
import { abandon_unsubmitted, create_transaction_journal } from '../src/transaction_journal.ts'
import { create_envelope_cipher } from '../src/envelope_cipher.ts'
import { create_control_service, empty_lane, lane_key_for, type Command, type Lane } from '../src/control.ts'
import type { Grant } from '../src/model.ts'

import { fixture_bot, fixture_config, memory_store, put } from './helpers/control_fixture.ts'

const fixture = async () => {
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
  })
  const cipher = create_envelope_cipher(new Uint8Array(32).fill(7), 'test-encryption-key')
  const journal = create_transaction_journal(
    store,
    fixture_config,
    cipher,
    { command, actor_id: 'actor', fence: 1 },
    () => 1000
  )
  const bytes = new Uint8Array([1, 2, 3])
  const digest = TransactionDataBuilder.getDigestFromBytes(bytes)
  const prepared = { digest, bytes, gas_budget_mist: '100' }
  const signed = { ...prepared, signatures: ['fixture-signature-not-usable'] }
  return { store, grant, command, journal, prepared, signed, lane_key, cipher }
}

test('durable encrypted bytes and transaction gas precede signing, unknown outcomes retain lane', async () => {
  const f = await fixture()
  await f.journal.admit('prepare')
  await f.journal.prepared(f.prepared)
  expect(await f.store.read<Grant>('grant:grant')).toEqual(f.grant)
  const lane = await f.store.read<Lane>(f.lane_key)
  expect(lane?.pending?.encrypted).not.toContain('fixture-signature-not-usable')
  await f.journal.signed(f.signed)
  await f.journal.mark_submitting(f.signed)
  expect(await f.journal.read()).toMatchObject({ digest: f.prepared.digest, phase: 'submitting' })
  await expect(f.journal.prepared(f.prepared)).rejects.toThrow('unresolved_envelope')
})

test('changed bytes and expired fence cannot advance a durable envelope', async () => {
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
  expect(await f.store.read(`receipt:${f.prepared.digest}`)).toMatchObject({ gas_mist: '23' })
  expect(await f.store.read('command:command')).toMatchObject({
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

test('envelope ciphertext is authenticated to its digest and key identity', async () => {
  const f = await fixture()
  const encrypted = await f.cipher.encrypt('exact signed envelope', 'digest-one')
  expect(await f.cipher.decrypt(encrypted, 'digest-one')).toBe('exact signed envelope')
  await expect(f.cipher.decrypt(encrypted, 'digest-two')).rejects.toThrow()
  const other = create_envelope_cipher(new Uint8Array(32).fill(7), 'replacement-key')
  await expect(other.decrypt(encrypted, 'digest-one')).rejects.toThrow('ENVELOPE_KEY_MISSING')
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
  expect(await f.store.read(`receipt:${f.prepared.digest}`)).toBeNull()
  expect((await f.store.read<Lane>(f.lane_key))?.pending?.digest).toBe(f.prepared.digest)
  expect(await f.store.read('command:command')).toMatchObject({ status: 'executing' })
})

test('terminal receipt history preserves negative net gas rebates without an allowance ledger', async () => {
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
  expect(await f.store.read(`receipt:${f.prepared.digest}`)).toMatchObject({ gas_mist: '-75' })
  expect(await f.store.read('command:command')).toMatchObject({ status: 'completed', result: { gas_mist: '-75' } })
  expect(await f.store.read<Grant>('grant:grant')).toEqual(f.grant)
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

test('ordinary successful action reconciles its domain projection in either receipt order and after restart', async () => {
  for (const projection_first of [true, false]) {
    const f = await fixture()
    const command: Command = {
      ...f.command,
      kind: 'world_search',
      payload: { character_id: '0x1', world: 'test', x: 3, z: 4 },
      action_baseline: { checkpoint_ms: 100 },
    }
    await put(f.store, 'command:command', command)
    const journal = create_transaction_journal(
      f.store,
      fixture_config,
      f.cipher,
      { command, actor_id: 'actor', fence: 1 },
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
    // No process-local history: reconstruct the context and read the retained receipt.
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
