// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import { refresh_combat_command, stale_combat_draft } from '../src/combat_refresh.ts'
import type { CombatRun } from '../src/combat_control.ts'
import type { CombatProfile } from '../src/combat_profile.ts'
import { combat_observation } from '../src/combat_runtime.ts'
import type { Lane, Command } from '../src/control.ts'
import { wait_for_contract } from '../src/command_wait.ts'
import { fight_checkpoint_id, hydrate_gameplay_fight } from '../src/gameplay.ts'

import { put } from './helpers/control_fixture.ts'
import { combat_fixture, started, row_of, fight_id } from './helpers/combat_runtime_fixture.ts'
import { signed_fixture } from './helpers/signed_runtime_fixture.ts'

const pass_profile: CombatProfile = {
  version: '1',
  intent: 'Pass this fixture turn.',
  combos: [{ name: 'attack', steps: [{ type: 'strike', target: 'nearest_enemy' }] }],
  rules: [{ when: { type: 'hp_below', percent: 1 }, combo: 'attack' }],
  fallback: 'end_turn',
}

test('actor refreshes a stale draft and the next canonical checkpoint wakes combat without polling', async () => {
  const f = await signed_fixture()
  try {
    await put(f.store, 'command:signed', { ...f.command, status: 'cancelled' })
    await put(f.store, f.lane_key, { ...(await f.store.read<Lane>(f.lane_key))!, pending: null, active_command: null })
    await f.runtime.observe(f.grant, {})
    await f.admit()
    await f.runtime.settle()
    const lane = (await f.store.read<Lane>(f.lane_key))!
    const command: Command = {
      ...f.command,
      id: 'combat-child',
      combat_run_id: 'combat-fixture',
      status: 'accepted',
      observation_revision: lane.observation_revision,
      decision_revision: lane.decision_revision + 1,
    }
    const run: CombatRun = {
      id: 'combat-fixture',
      bot_id: f.bot.id,
      grant_id: f.grant.id,
      lane_key: f.lane_key,
      fingerprint: 'accepted-fight',
      fight: String(command.payload.fight),
      profiles: [{ character_id: String(command.payload.character_id), revision: 1, profile: pass_profile }],
      status: 'active',
      actions_started: 1,
      last_command_id: command.id,
      created_at: f.clock.now,
    }
    await put(f.store, `combat:${run.id}`, run)
    await put(f.store, `command:${command.id}`, command)
    await put(f.store, f.lane_key, {
      ...lane,
      active_command: command.id,
      combat_run_id: run.id,
      decision_revision: command.decision_revision,
    })
    await f.send({ type: 'packet/item_removed', item: `0x${'9'.repeat(64)}`, version: '99' })
    await f.runtime.settle()
    expect((await f.store.read<Lane>(f.lane_key))!.observation_revision).toBeGreaterThan(command.observation_revision)
    await f.runtime.wake(`command:${command.id}`)
    await f.runtime.settle()
    expect(await f.store.read<Command>(`command:${command.id}`)).toMatchObject({ status: 'completed' })
    expect((await f.store.read<Command>(`command:${command.id}`))!.observation_revision).toBeGreaterThan(
      command.observation_revision
    )
    expect(f.submissions).toHaveLength(1)
    await f.runtime.tick()
    await f.runtime.settle()
    expect(f.submissions).toHaveLength(1)
    expect(f.errors).toEqual([])
    expect((await f.store.read<Lane>(f.lane_key))!.reconciliation_command).toBe(command.id)
    const checkpoint = hydrate_gameplay_fight(f.command.fight_baseline!)
    checkpoint.contract.round += 1n
    checkpoint.contract.turn_started_ms += 1000n
    const admitted = Promise.withResolvers<void>()
    const unsubscribe = f.store.subscribe_pending!((keys) => {
      if (keys.some((key) => key.startsWith('command:') && key !== `command:${command.id}`)) admitted.resolve()
    })
    try {
      await f.send({
        type: 'packet/server_info',
        online: 1,
        online_characters: 1,
        indexing_lag: 0,
        current_epoch: '1',
        chain_timestamp_ms: 70000,
        chain_sample_age_ms: 0,
      })
      // No tick, wake call or service pending subscription follows this canonical packet.
      await f.send({
        type: 'packet/fight_state',
        fight: run.fight,
        state: row_of(checkpoint),
        seats: { [String(command.payload.character_id)]: Number(command.payload.fighter_idx) },
      })
      await f.runtime.settle()
      await admitted.promise
      const next = (await f.store.read<CombatRun>(`combat:${run.id}`))!
      expect(next.actions_started).toBe(2)
      expect(next.last_command_id).not.toBe(command.id)
      expect(await f.store.read<Command>(`command:${next.last_command_id}`)).toMatchObject({
        status: 'accepted',
        kind: 'fight_turn',
      })
      expect(f.submissions).toHaveLength(1)
    } finally {
      unsubscribe()
    }
  } finally {
    await f.runtime.stop()
  }
})

test('combat refresh preserves the accepted command identity and replans only its unsent draft', async () => {
  const f = await combat_fixture(started())
  await f.tick()
  const command = await f.get_command()
  await f.control.observed(f.key, 'actor', f.lease.fence, true)
  const context = { ...f.context, snapshot: { ...f.context.snapshot, observation_revision: 2 } }
  const refreshed = await refresh_combat_command(
    f.store,
    f.config,
    { command, actor_id: 'actor', fence: f.lease.fence },
    context,
    f.now
  )
  expect(refreshed).toMatchObject({
    id: command.id,
    status: 'accepted',
    observation_revision: 2,
    decision_revision: command.decision_revision,
    fingerprint: command.fingerprint,
  })
  expect(refreshed!.fight_baseline).toBeUndefined()
  expect((await f.get_run()).actions_started).toBe(1)
  expect(await f.store.scan_keys('command:', 10)).toHaveLength(1)
})

test('prepared, signed and submitting combat envelopes can never be replaced by refresh', async () => {
  for (const phase of ['prepared', 'signed', 'submitting'] as const) {
    const f = await combat_fixture(started())
    await f.tick()
    const command = await f.get_command()
    const pending = {
      command_id: command.id,
      grant_id: command.grant_id,
      digest: 'fixed-digest',
      phase,
      encrypted: 'retained-exact-envelope',
      gas_budget_mist: '1000',
    }
    const lane = { ...(await f.store.read<Lane>(f.key))!, pending, observation_revision: 2 }
    await put(f.store, f.key, lane)
    const context = { ...f.context, snapshot: { ...f.context.snapshot, observation_revision: 2 } }
    await expect(
      refresh_combat_command(f.store, f.config, { command, actor_id: 'actor', fence: f.lease.fence }, context, f.now)
    ).rejects.toThrow('execution_not_authorized')
    expect((await f.store.read<Lane>(f.key))!.pending).toEqual(pending)
    expect(await f.get_command()).toEqual(command)
    expect(stale_combat_draft(command, lane, new Error('needs_resync'))).toBe(false)
  }
})

test('a stopped run cannot refresh its stale accepted command and stale errors never reopen failures', async () => {
  const f = await combat_fixture()
  await f.tick()
  const command = await f.get_command()
  await f.control.observed(f.key, 'actor', f.lease.fence, true)
  const lane = (await f.store.read<Lane>(f.key))!
  expect(stale_combat_draft(command, lane, new Error('needs_resync'))).toBe(true)
  expect(stale_combat_draft({ ...command, status: 'failed' }, lane, new Error('needs_resync'))).toBe(false)
  expect(stale_combat_draft({ ...command, status: 'uncertain' }, lane, new Error('needs_resync'))).toBe(false)
  await put(f.store, 'combat:fixture-run', { ...(await f.get_run()), status: 'stopped' })
  await expect(
    refresh_combat_command(
      f.store,
      f.config,
      { command, actor_id: 'actor', fence: f.lease.fence },
      {
        ...f.context,
        command: combat_observation(await f.get_run()),
        snapshot: { ...f.context.snapshot, observation_revision: 2 },
      },
      f.now
    )
  ).rejects.toThrow('combat_execution_not_authorized')
})

test('a resumed combat command replans its checkpoint even after readiness refreshed its observation revision', async () => {
  const f = await combat_fixture(started())
  await f.tick()
  const command = { ...(await f.get_command()), waiting_for_resume: true }
  await put(f.store, `command:${command.id}`, command)
  await f.control.observed(f.key, 'actor', f.lease.fence, true)
  const checkpoint = hydrate_gameplay_fight(f.context.snapshot.fights[fight_id]!)
  checkpoint.contract.fighters[0]!.hp -= 1n
  const row = row_of(checkpoint)
  const context = {
    ...f.context,
    snapshot: { ...f.context.snapshot, observation_revision: 2, fights: { [fight_id]: row } },
  }
  const binding = { command, actor_id: 'actor', fence: f.lease.fence }
  const resumed = await wait_for_contract(f.store, binding, context, f.now)
  expect(resumed!.observation_revision).toBe(2)
  const refreshed = await refresh_combat_command(f.store, f.config, { ...binding, command: resumed! }, context, f.now)
  expect(refreshed!.payload.checkpoint_id).toBe(fight_checkpoint_id(row))
  expect(refreshed!.id).toBe(command.id)
})
