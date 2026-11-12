// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import { create_fight } from '@aresrpg/fight'

import { create_control_service, type Lane } from '../src/control.ts'
import { next_combat_action } from '../src/combat_plan.ts'
import { create_transaction_journal } from '../src/transaction_journal.ts'
import { execute_gameplay_actions, hydrate_gameplay_fight, type GameplayActions } from '../src/gameplay.ts'

import { put } from './helpers/control_fixture.ts'
import { combat_fixture, fight_id, placement, row_of, started } from './helpers/combat_runtime_fixture.ts'

test('combat admission is atomic and replaying the same tick cannot issue another command', async () => {
  const f = await combat_fixture()
  const original = await f.get_run()
  await Promise.all([f.tick(f.context, original), f.tick(f.context, original)])
  const accepted = await f.get_run()
  expect(accepted.actions_started).toBe(1)
  expect(await f.get_command()).toMatchObject({ kind: 'fight_ready', combat_run_id: original.id, status: 'accepted' })
  await f.tick()
  await f.tick(f.context, original)
  expect((await f.get_run()).actions_started).toBe(1)
  expect(await f.store.scan_keys('command:', 10)).toHaveLength(1)
  await expect(
    f.control.accept(f.grant, {
      idempotency_key: 'competing',
      kind: 'fight_ready',
      payload: (await f.get_command()).payload,
      decision_revision: 1,
      observation_revision: 1,
    })
  ).rejects.toThrow('bot_busy_or_paused')
})

test('receipt reconciliation blocks a completed turn until its canonical successor is observed', async () => {
  const f = await combat_fixture(started())
  await f.tick()
  const command = await f.get_command()
  expect(command.kind).toBe('fight_turn')
  await put(f.store, `command:${command.id}`, { ...command, status: 'completed', result: { digest: 'fixture' } })
  await put(f.store, f.key, {
    ...(await f.store.read<Lane>(f.key))!,
    active_command: null,
    needs_resync: true,
    reconciliation_command: command.id,
  })
  await f.control.observed(f.key, 'actor', f.lease.fence, true, false)
  await f.tick()
  expect(await f.get_run()).toMatchObject({ status: 'waiting', actions_started: 1 })
  expect(await f.store.scan_keys('command:', 10)).toHaveLength(1)
})

test('stopped combat cannot prepare, sign or submit an already accepted child command', async () => {
  const f = await combat_fixture()
  await f.tick()
  const command = await f.get_command()
  const journal = create_transaction_journal(
    f.store,
    f.config,
    f.cipher,
    { command, actor_id: 'actor', fence: f.lease.fence },
    () => f.now
  )
  for (const stage of ['prepare', 'sign', 'submit'] as const) await journal.admit(stage)
  // Retain the lane pointer: the durable run status itself must veto every admission.
  await put(f.store, 'combat:fixture-run', { ...(await f.get_run()), status: 'stopped' })
  for (const stage of ['prepare', 'sign', 'submit'] as const)
    await expect(journal.admit(stage)).rejects.toThrow('combat_execution_not_authorized')
  expect((await f.store.read<Lane>(f.key))!.pending).toBeNull()
})

test('failed, uncertain and cancelled combat children never admit replacement transactions', async () => {
  for (const status of ['failed', 'uncertain', 'cancelled'] as const) {
    const f = await combat_fixture()
    await f.tick()
    const command = await f.get_command()
    await put(f.store, `command:${command.id}`, { ...command, status, error: 'fixture failure' })
    await f.tick()
    await f.tick()
    expect(await f.get_run()).toMatchObject({ status: 'failed', actions_started: 1, issue: 'fixture failure' })
    expect(await f.store.scan_keys('command:', 10)).toHaveLength(1)
    expect((await f.store.read<Lane>(f.key))!.active_command).toBe(command.id)
  }
})

test('pause, human takeover and revocation stop combat without issuing a child', async () => {
  for (const reason of ['pause', 'takeover', 'revocation'] as const) {
    const f = await combat_fixture()
    if (reason === 'pause') await f.control.pause(f.grant)
    if (reason === 'takeover')
      await put(f.store, f.key, { ...(await f.store.read<Lane>(f.key))!, transport_stopped: true })
    if (reason === 'revocation') await put(f.store, `grant:${f.grant.id}`, { ...f.grant, revoked: true })
    await f.tick()
    expect(await f.get_run()).toMatchObject({
      status: reason === 'revocation' ? 'stopped' : 'paused',
      actions_started: 0,
    })
    expect(await f.store.scan_keys('command:', 10)).toHaveLength(0)
  }
})

test('contract freeze waits without consuming commands and resumes one ordinary action', async () => {
  const f = await combat_fixture()
  const frozen = { ...f.context, snapshot: { ...f.context.snapshot, frozen: true, ready: false } }
  await f.tick(frozen)
  const waiting = await f.get_run()
  await f.tick(frozen)
  expect(await f.get_run()).toEqual(waiting)
  expect(waiting).toMatchObject({ status: 'waiting', actions_started: 0 })
  expect(await f.store.scan_keys('command:', 10)).toHaveLength(0)
  await f.tick()
  expect(await f.get_run()).toMatchObject({ status: 'active', actions_started: 1 })
})

test('combat respects the actual turn clock instead of submitting a premature end-turn', async () => {
  const f = await combat_fixture(started())
  const row = f.context.snapshot.fights[fight_id]!
  const early = {
    ...f.context,
    snapshot: {
      ...f.context.snapshot,
      clock: { chain_ms: Number(hydrate_gameplay_fight(row).contract.turn_started_ms), observed_at: f.now },
    },
  }
  expect(next_combat_action(await f.get_run(), early)).toEqual({ state: 'waiting' })
  expect(next_combat_action(await f.get_run(), f.context).state).toBe('action')
})

test('one autonomous fight selects ready, lethal turn and settlement through existing SDK doors and twin', async () => {
  const f = await combat_fixture()
  const fight = create_fight({ state: placement(), mode: 'local', seed: 91n })
  const calls: string[] = []
  const packets: unknown[] = []
  const unexpected = async () => {
    throw new Error('unexpected SDK action')
  }
  const actions: GameplayActions = {
    use_consumable: unexpected,
    open_loot_boxes: unexpected,
    claim_loot_batch: unexpected,
    raise_stats: unexpected,
    equip: unexpected,
    gather: unexpected,
    craft: unexpected,
    resolve_ambush: unexpected,
    search_zone: unexpected,
    engage: unexpected,
    place: unexpected,
    start: unexpected,
    crank: unexpected,
    ready: async ({ fighter_idx }) => {
      calls.push('ready')
      expect(fight.apply({ type: 'ready', fighter: fighter_idx }).error).toBeNull()
      expect(fight.apply({ type: 'start', observed_ms: 60_000n }).error).toBeNull()
      return { digest: 'ready', started: true }
    },
    commit_turn: async ({ actions: draft }) => {
      calls.push('turn')
      for (const action of draft) {
        if (action.type !== 'strike') throw new Error('expected weapon strike')
        expect(
          fight.apply({ type: 'weapon_strike', fighter: action.fighter_idx, target_cell: action.target_cell }).error
        ).toBeNull()
      }
      expect(fight.state().contract.ended).toBe(true)
      return { digest: 'turn', turn_witnesses: [] }
    },
    settle: async () => {
      calls.push('settle')
      return { digest: 'settle' }
    },
  }
  let { context } = f
  for (const expected of ['fight_ready', 'fight_turn', 'fight_settle'] as const) {
    await f.tick(context)
    const command = await f.get_command()
    expect(command.kind).toBe(expected)
    await execute_gameplay_actions({ ...context, command }, actions, async (packet) => {
      packets.push(packet)
      return true
    })
    await put(f.store, `command:${command.id}`, { ...command, status: 'completed', result: { digest: expected } })
    await put(f.store, f.key, { ...(await f.store.read<Lane>(f.key))!, active_command: null })
    context = { ...context, snapshot: { ...context.snapshot, fights: { [fight_id]: row_of(fight.state()) } } }
  }
  const returned = { ...context.snapshot.characters[0]!, custody: 'kiosk' as const, active_fight: undefined }
  await f.tick({ ...context, snapshot: { ...context.snapshot, characters: [returned] } })
  expect(await f.get_run()).toMatchObject({ status: 'completed', actions_started: 3 })
  expect(calls).toEqual(['ready', 'turn', 'settle'])
  expect(packets).toHaveLength(1)
  expect(packets[0]).toMatchObject({ type: 'packet/fight_action', fight: fight_id })
  expect((await f.store.read<Lane>(f.key))!.combat_run_id).toBeNull()
})

test('historical combat blocker resumes through the real shared-run transition', async () => {
  const f = await combat_fixture()
  const context = { ...f.context, snapshot: { ...f.context.snapshot, characters: [] } }
  await f.tick(context)
  const run = await f.get_run()
  expect(run.status).toBe('awaiting_ai')
  const lane = (await f.store.read<Lane>(f.key))!
  const control = create_control_service(
    f.store,
    f.config,
    f.config.observation_freshness_ms,
    () => f.now,
    async () => ({ ...f.context.snapshot, decision_revision: lane.decision_revision, sampled_at: f.now })
  )
  await expect(
    control.resume_combat(f.grant, run.id, lane.decision_revision, lane.observation_revision)
  ).resolves.toMatchObject({ status: 'active' })
  await f.tick()
  expect((await f.get_command()).status).toBe('accepted')
})
