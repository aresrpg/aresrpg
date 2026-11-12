// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import { job_xp_for_level } from '@aresrpg/immutable'

import { create_control_service, lane_key_for, type Lane, type Command } from '../src/control.ts'
import { stale_run_draft } from '../src/run_refresh.ts'
import { ready_gameplay_command } from '../src/command_wait.ts'
import { create_transaction_journal } from '../src/transaction_journal.ts'
import { run_tick } from '../src/run_runtime.ts'
import { receipt_projected } from '../src/action_receipts.ts'
import type { ProfessionRun } from '../src/profession_control.ts'

import { stored_profession } from './helpers/legacy_run_fixture.ts'
import { runtime_fixture } from './helpers/runtime_fixture.ts'
import { put } from './helpers/control_fixture.ts'
import { profession_context, plan, character, item, recipe, resource } from './helpers/profession_fixture.ts'

const fixture = async (accepted_plan = plan) => {
  const f = await runtime_fixture()
  const control = create_control_service(f.store, f.options.config, 60000, () => f.clock.now)
  const lane = await control.acquire(f.bot, 'actor', 10000)
  const key = lane_key_for(f.bot)
  await control.observed(key, 'actor', lane.fence, true)
  const start = await stored_profession(f.store, f.grant, accepted_plan, f.clock.now)
  const get_run = () => f.store.read<ProfessionRun>(`profession:${start.id}`)
  const tick = async (context = profession_context()) =>
    run_tick('profession', {
      store: f.store,
      config: f.options.config,
      actor_id: 'actor',
      fence: lane.fence,
      run: (await get_run())!,
      context,
      now: f.clock.now,
    })
  return { ...f, control, lane, key, get_run, tick }
}

test('durable step admission is atomic, concurrent-safe and restart cannot repeat accepted work', async () => {
  const f = await fixture()
  await Promise.all([f.tick(), f.tick()])
  const run = (await f.get_run())!
  expect(run.actions_started).toBe(1)
  expect((await f.store.read<Command>(`command:${run.last_command_id}`))?.kind).toBe('gather')
  await f.tick()
  expect((await f.get_run())?.actions_started).toBe(1)
  const restarted = create_control_service(f.store, f.options.config, 60000, () => f.clock.now)
  expect((await restarted.profession_status(f.grant, run.id)).last_command_id).toBe(run.last_command_id)
  await expect(
    f.control.accept(f.grant, {
      idempotency_key: 'competing',
      kind: 'craft',
      payload: { character_id: character.id, output_type: recipe.output_type, attempts: 1 },
      decision_revision: 2,
      observation_revision: 1,
    })
  ).rejects.toThrow('bot_busy_or_paused')
  await f.runtime.stop()
})

test('confirmed gather advances to craft after fresh projection and only observed target marks completion', async () => {
  const f = await fixture()
  await f.tick()
  const run = (await f.get_run())!
  const command = (await f.store.read<Command>(`command:${run.last_command_id}`))!
  await put(f.store, `command:${command.id}`, { ...command, status: 'completed', result: { digest: 'fixture' } })
  await put(f.store, 'receipt:fixture', {
    receipt: {
      Transaction: {
        digest: 'fixture',
        effects: { lamportVersion: '2' },
        objectTypes: {},
        events: [{ type: 'fixture::gathering::ResourceGathered', json: { job_xp_gained: '1' } }],
      },
    },
  })
  const lane = (await f.store.read<Lane>(f.key))!
  await put(f.store, f.key, { ...lane, active_command: null, observation_revision: 2 })
  const context = profession_context()
  const snapshot = {
    ...context.snapshot,
    observation_revision: 2,
    characters: [{ ...character, at_ms: 1, jobs: { [resource.job]: '1' } }],
    zones: {
      ...context.snapshot.zones,
      'fixture:97:97': {
        ...context.snapshot.zones['fixture:97:97']!,
        zone: { ...context.snapshot.zones['fixture:97:97']!.zone, res_taken: [1] },
      },
    },
    inventory: {
      ...context.snapshot.inventory!,
      items: Object.entries(recipe.inputs).map(([type, amount], index) => item(type, amount, 30 + index)),
    },
  }
  await f.tick({ ...context, snapshot: { ...snapshot, zones: context.snapshot.zones } })
  expect((await f.get_run())!.actions_started).toBe(1)
  await f.tick({ ...context, snapshot: { ...snapshot, characters: [{ ...snapshot.characters[0]!, at_ms: 0 }] } })
  expect((await f.get_run())!.actions_started).toBe(1)
  await f.tick({ ...context, snapshot, command: { ...context.command, observation_revision: 2 } })
  const crafted = (await f.get_run())!
  expect(crafted.actions_started).toBe(2)
  expect((await f.store.read<Command>(`command:${crafted.last_command_id}`))?.kind).toBe('craft')
  await put(f.store, `command:${crafted.last_command_id}`, {
    ...(await f.store.read<Command>(`command:${crafted.last_command_id}`))!,
    status: 'completed',
    result: { digest: 'fixture-craft' },
  })
  await put(f.store, 'receipt:fixture-craft', {
    receipt: {
      Transaction: {
        digest: 'fixture-craft',
        effects: { lamportVersion: '3' },
        objectTypes: {},
        events: [{ type: 'fixture::crafting::Crafted', json: { job_xp_gained: '1' } }],
      },
    },
  })
  await put(f.store, f.key, { ...(await f.store.read<Lane>(f.key))!, active_command: null })
  await f.tick({
    ...context,
    snapshot: {
      ...snapshot,
      characters: [{ ...character, jobs: { [plan.job]: String(job_xp_for_level(plan.target_level)) } }],
    },
    command: { ...context.command, observation_revision: 2 },
  })
  expect((await f.get_run())?.status).toBe('completed')
  expect((await f.store.read<Lane>(f.key))?.profession_run_id).toBeNull()
  await f.runtime.stop()
})

test('run limits, pause, revocation and uncertain execution never admit replacement transactions', async () => {
  for (const mode of ['limit', 'deadline', 'paused', 'revoked', 'uncertain']) {
    const f = await fixture()
    const run = (await f.get_run())!
    if (mode === 'limit') await put(f.store, `profession:${run.id}`, { ...run, actions_started: plan.max_actions })
    if (mode === 'deadline') await put(f.store, `profession:${run.id}`, { ...run, plan: { ...plan, deadline_ms: 1 } })
    if (mode === 'paused') await f.control.pause(f.grant)
    if (mode === 'revoked') await put(f.store, 'grant:grant', { ...f.grant, revoked: true })
    if (mode === 'uncertain') {
      await f.tick()
      const current = (await f.get_run())!
      await put(f.store, `command:${current.last_command_id}`, {
        ...(await f.store.read<Command>(`command:${current.last_command_id}`))!,
        status: 'uncertain',
        error: 'receipt unknown',
      })
    }
    await f.tick()
    expect(['stopped', 'paused', 'failed']).toContain((await f.get_run())!.status)
    expect((await f.store.scan_keys('command:', 100)).length).toBe(mode === 'uncertain' ? 1 : 0)
    await f.runtime.stop()
  }
})

test('a queued profession action cannot prepare, sign or submit after its deadline', async () => {
  const f = await fixture()
  await f.tick()
  const run = (await f.get_run())!
  const command = (await f.store.read<Command>(`command:${run.last_command_id}`))!
  const journal = create_transaction_journal(
    f.store,
    f.options.config,
    f.options.cipher,
    { command, actor_id: 'actor', fence: f.lane.fence },
    () => f.clock.now
  )
  await put(f.store, `profession:${run.id}`, { ...run, plan: { ...plan, deadline_ms: f.clock.now } })
  for (const stage of ['prepare', 'sign', 'submit'] as const)
    await expect(journal.admit(stage)).rejects.toThrow('profession_execution_not_authorized')
  expect((await f.store.read<Lane>(f.key))?.pending).toBeNull()
  await f.runtime.stop()
})

test('actor scheduler publishes an actionable missing-loot state through the same MCP control lane', async () => {
  const f = await runtime_fixture()
  await f.runtime.observe(f.grant, {})
  await f.runtime.tick()
  await f.runtime.settle()
  await f.admit()
  const context = profession_context()
  await f.send({ type: 'packet/inventory', items: [item(plan.gather_item_types[0]!, 100)] })
  await f.send({ type: 'packet/listings', listings: [], kiosk_versions: {} })
  await f.send({ type: 'packet/trades', trades: [] })
  await f.send({ type: 'packet/characters', characters: context.snapshot.characters })
  await f.runtime.tick()
  await f.runtime.settle()
  const control = create_control_service(f.store, f.options.config, 60000, () => f.clock.now)
  expect(await f.runtime.observe(f.grant, {})).toMatchObject({ state: 'awaiting_ai' })
  const started = await stored_profession(f.store, f.grant, plan, f.clock.now)
  await f.runtime.tick()
  await f.runtime.settle()
  const status = await control.profession_status(f.grant, started.id)
  expect(status).toMatchObject({ status: 'awaiting_ai', actions_started: 0, issue: { code: 'acquisition_required' } })
  expect(status.issue?.requirements).toBeDefined()
  expect(status.last_command_id).toBeNull()
  await f.runtime.stop()
})

test('a heartbeat or unrelated projection cannot repeat a completed craft against unchanged inventory and XP', async () => {
  const f = await fixture()
  const context = profession_context()
  const snapshot = {
    ...context.snapshot,
    inventory: {
      ...context.snapshot.inventory!,
      items: Object.entries(recipe.inputs).map(([type, amount], index) => item(type, amount * 5, 30 + index)),
    },
  }
  await f.tick({ ...context, snapshot })
  const run = (await f.get_run())!
  const command = (await f.store.read<Command>(`command:${run.last_command_id}`))!
  expect(command.kind).toBe('craft')
  await put(f.store, `command:${command.id}`, { ...command, status: 'completed', result: { digest: 'fixture-craft' } })
  await put(f.store, f.key, { ...(await f.store.read<Lane>(f.key))!, active_command: null, needs_resync: true })
  await f.control.observed(f.key, 'actor', f.lane.fence, true, false)
  await f.tick({ ...context, snapshot })
  expect((await f.get_run())!.actions_started).toBe(1)
  await f.control.observed(f.key, 'actor', f.lane.fence, true, true)
  await f.tick({ ...context, snapshot: { ...snapshot, observation_revision: 2 } })
  expect((await f.get_run())!.actions_started).toBe(1)
  const changes = snapshot.inventory.items.map((row) => ({
    id: row.id,
    amount: row.amount - recipe.inputs[row.item_type]!,
    version: '2',
  }))
  await put(f.store, 'receipt:fixture-craft', {
    receipt: {
      Transaction: {
        digest: 'fixture-craft',
        effects: {
          lamportVersion: '2',
          changedObjects: changes.map(({ id }) => ({ objectId: id, outputVersion: '2' })),
        },
        objectTypes: Object.fromEntries(changes.map(({ id }) => [id, 'fixture::item::Item'])),
        events: [
          { type: 'fixture::crafting::Crafted', json: { job_xp_gained: '1' } },
          ...changes.map(({ id, amount }) => ({ type: 'fixture::item::AmountChanged', json: { item: id, amount } })),
        ],
      },
    },
  })
  const fresh = {
    ...snapshot,
    observation_revision: 2,
    inventory: {
      ...snapshot.inventory,
      items: snapshot.inventory.items.map((row, index) => ({ ...row, ...changes[index]! })),
    },
    characters: [{ ...character, jobs: { [plan.job]: '1' } }],
  }
  // An unrelated revision, XP alone, or inventory alone cannot cross the receipt barrier.
  await f.tick({ ...context, snapshot: { ...fresh, inventory: snapshot.inventory } })
  await f.tick({ ...context, snapshot: { ...fresh, characters: snapshot.characters } })
  expect((await f.get_run())!.actions_started).toBe(1)
  await put(f.store, f.key, { ...(await f.store.read<Lane>(f.key))!, needs_resync: true })
  // Projection-before-receipt order must also reconcile without another packet.
  // A restarted runner uses the durable step baseline and retained receipt, not an in-memory flag.
  await run_tick('profession', {
    store: f.store,
    config: f.options.config,
    actor_id: 'actor',
    fence: f.lane.fence,
    run: (await f.get_run())!,
    context: { ...context, snapshot: fresh, command: { ...context.command, observation_revision: 2 } },
    now: f.clock.now,
  })
  expect((await f.get_run())!.actions_started).toBe(2)
  await f.runtime.stop()
})

test('contract freeze waits without spending the plan bounds and resume admits one step', async () => {
  const f = await fixture()
  const context = profession_context()
  const frozen = { ...context, snapshot: { ...context.snapshot, frozen: true, ready: false } }
  try {
    await f.tick(frozen)
    await f.tick(frozen)
    expect(await f.get_run()).toMatchObject({ status: 'waiting', actions_started: 0, plan })
    await f.tick(context)
    expect(await f.get_run()).toMatchObject({ status: 'active', actions_started: 1, plan })
  } finally {
    await f.runtime.stop()
  }
})

test('contract freeze cannot extend a profession deadline', async () => {
  const f = await fixture()
  const context = profession_context()
  const run = (await f.get_run())!
  await put(f.store, `profession:${run.id}`, { ...run, plan: { ...plan, deadline_ms: f.clock.now } })
  try {
    await f.tick({ ...context, snapshot: { ...context.snapshot, frozen: true, ready: false } })
    expect(await f.get_run()).toMatchObject({ status: 'stopped', actions_started: 0 })
  } finally {
    await f.runtime.stop()
  }
})

// Normalized semantic excerpt from mainnet capture 2026-11-12: Aahf2cnpU3NKAUPeH5nzMpjW1M1aLuM57uKKZ1Cn6Wad,
// Lamport 1068218214. Merge + spend leaves water at 19 with no object write.
test('certified craft reconciles an unchanged merge destination without inventing a newer version', () => {
  const context = profession_context()
  const water = { ...item('water', 19), version: '1068218213' }
  const receipt = {
    Transaction: {
      digest: 'Aahf2cnpU3NKAUPeH5nzMpjW1M1aLuM57uKKZ1Cn6Wad',
      effects: { lamportVersion: '1068218214', changedObjects: [] },
      objectTypes: {},
      events: [
        { type: 'capture::item::AmountChanged', json: { item: water.id, amount: 20 } },
        { type: 'capture::item::AmountChanged', json: { item: water.id, amount: 19 } },
        { type: 'capture::crafting::Crafted', json: { job_xp_gained: '10' } },
      ],
    },
  }
  const command: Command = {
    ...context.command,
    kind: 'craft',
    status: 'completed',
    payload: { character_id: character.id },
    result: { digest: receipt.Transaction.digest },
  }
  const fresh = {
    ...context,
    snapshot: {
      ...context.snapshot,
      characters: [{ ...character, jobs: { HERBALIST: '220' } }],
      inventory: { ...context.snapshot.inventory!, items: [water] },
    },
  }
  const before = { job: 'HERBALIST', xp: '210', checkpoint_ms: 0 }
  expect(receipt_projected(before, command, receipt, fresh)).toBe(true)
  expect(
    receipt_projected(before, command, receipt, {
      ...fresh,
      snapshot: { ...fresh.snapshot, inventory: { ...fresh.snapshot.inventory, items: [{ ...water, amount: 20 }] } },
    })
  ).toBe(false)
  const written = {
    Transaction: {
      ...receipt.Transaction,
      effects: {
        ...receipt.Transaction.effects,
        changedObjects: [{ objectId: water.id, outputVersion: '1068218214' }],
      },
      objectTypes: { [water.id]: 'capture::item::Item' },
    },
  }
  expect(receipt_projected(before, command, written, fresh)).toBe(false)
  expect(
    receipt_projected(before, command, written, {
      ...fresh,
      snapshot: {
        ...fresh.snapshot,
        inventory: { ...fresh.snapshot.inventory, items: [{ ...water, version: '1068218214' }] },
      },
    })
  ).toBe(true)
})

test('accepted profession drafts replan fresh observations before journal admission without another action', async () => {
  const f = await fixture()
  await f.tick()
  const run = (await f.get_run())!
  const command = (await f.store.read<Command>(`command:${run.last_command_id}`))!
  await f.control.observed(f.key, 'actor', f.lane.fence, true)
  const context = profession_context()
  const fresh = {
    ...context,
    snapshot: {
      ...context.snapshot,
      observation_revision: 2,
      inventory: {
        ...context.snapshot.inventory!,
        items: Object.entries(recipe.inputs).map(([type, amount], index) => item(type, amount, 30 + index)),
      },
    },
  }
  const binding = { command, actor_id: 'actor', fence: f.lane.fence }
  await expect(
    create_transaction_journal(f.store, f.options.config, f.options.cipher, binding, () => f.clock.now).admit('prepare')
  ).rejects.toThrow('execution_not_authorized')
  const refreshed = await ready_gameplay_command(f.store, f.options.config, binding, fresh, f.clock.now)
  expect(refreshed).toMatchObject({
    id: command.id,
    kind: 'craft',
    observation_revision: 2,
    status: 'accepted',
    fingerprint: command.fingerprint,
  })
  await create_transaction_journal(
    f.store,
    f.options.config,
    f.options.cipher,
    { ...binding, command: refreshed! },
    () => f.clock.now
  ).admit('prepare')
  expect((await f.get_run())!.actions_started).toBe(1)
  expect((await f.get_run())!.last_observation?.zone).toBeUndefined()
  expect(await f.store.scan_keys('command:', 10)).toHaveLength(1)
  await f.runtime.stop()
})

test('profession refresh never replaces an envelope or reopens terminal commands', async () => {
  const f = await fixture()
  await f.tick()
  const run = (await f.get_run())!
  const command = (await f.store.read<Command>(`command:${run.last_command_id}`))!
  await f.control.observed(f.key, 'actor', f.lane.fence, true)
  const lane = (await f.store.read<Lane>(f.key))!
  const context = profession_context()
  const fresh = { ...context, snapshot: { ...context.snapshot, observation_revision: 2 } }
  const binding = { command, actor_id: 'actor', fence: f.lane.fence }
  expect(stale_run_draft(command, lane, new Error('execution_not_authorized'))).toBe(true)
  for (const status of ['failed', 'uncertain', 'cancelled', 'completed'] as const) {
    const terminal = { ...command, status }
    await put(f.store, `command:${command.id}`, terminal)
    expect(stale_run_draft(terminal, lane, new Error('execution_not_authorized'))).toBe(false)
    await expect(ready_gameplay_command(f.store, f.options.config, binding, fresh, f.clock.now)).rejects.toThrow(
      'execution_not_authorized'
    )
    expect(await f.store.read<Command>(`command:${command.id}`)).toEqual(terminal)
  }
  await put(f.store, `command:${command.id}`, command)
  for (const phase of ['prepared', 'signed', 'submitting'] as const) {
    const pending = {
      command_id: command.id,
      grant_id: command.grant_id,
      digest: 'fixed',
      phase,
      encrypted: 'exact-bytes',
      gas_budget_mist: '1',
    }
    await put(f.store, f.key, { ...lane, pending })
    expect(stale_run_draft(command, { ...lane, pending }, new Error('execution_not_authorized'))).toBe(false)
    await expect(ready_gameplay_command(f.store, f.options.config, binding, fresh, f.clock.now)).rejects.toThrow(
      'execution_not_authorized'
    )
    expect((await f.store.read<Lane>(f.key))!.pending).toEqual(pending)
  }
  await f.runtime.stop()
})

test('unbounded profession intent persists and admits beyond former caller limits while stop still fences it', async () => {
  const { max_actions: _max, deadline_ms: _deadline, ...unbounded } = plan
  const f = await fixture(unbounded)
  const run = (await f.get_run())!
  await put(f.store, `profession:${run.id}`, { ...run, actions_started: 201 })
  f.clock.now = 10_000_000
  const lease = await f.control.acquire(f.bot, 'actor', 10000)
  const lane = (await f.store.read<Lane>(f.key))!
  await put(f.store, f.key, { ...lane, needs_resync: false, observed_at: f.clock.now, observation_revision: 1 })
  const persisted = (await f.get_run())!
  expect(await f.store.scan_pending(100)).toContain(`profession:${run.id}`)
  await run_tick('profession', {
    store: f.store,
    config: f.options.config,
    run: persisted,
    actor_id: 'actor',
    fence: lease.fence,
    context: profession_context(),
    now: f.clock.now,
  })
  const next = (await f.get_run())!
  expect(next.actions_started).toBe(202)
  const command = (await f.store.read<Command>(`command:${next.last_command_id}`))!
  const journal = create_transaction_journal(
    f.store,
    f.options.config,
    f.options.cipher,
    { command, actor_id: 'actor', fence: lease.fence },
    () => f.clock.now
  )
  await journal.admit('prepare')
  await put(f.store, f.key, { ...(await f.store.read<Lane>(f.key))!, paused: true })
  await expect(journal.admit('prepare')).rejects.toThrow('execution_not_authorized')
  await f.runtime.stop()
})

test('a refreshed unprepared blocker can explicitly resume without replaying its cancelled draft', async () => {
  const f = await fixture()
  await f.tick()
  const run = (await f.get_run())!
  const command = (await f.store.read<Command>(`command:${run.last_command_id}`))!
  await f.control.observed(f.key, 'actor', f.lane.fence, true)
  const context = profession_context()
  const fresh = { ...context, snapshot: { ...context.snapshot, observation_revision: 2, zones: {} } }
  const result = await ready_gameplay_command(
    f.store,
    f.options.config,
    { command, actor_id: 'actor', fence: f.lane.fence },
    fresh,
    f.clock.now
  )
  expect(result).toBeNull()
  expect((await f.get_run())!.status).toBe('awaiting_ai')
  expect(await f.store.read<Command>(`command:${command.id}`)).toMatchObject({ status: 'cancelled' })
  const lane = (await f.store.read<Lane>(f.key))!
  await f.control.resume_profession(f.grant, run.id, lane.decision_revision, lane.observation_revision)
  await f.tick({
    ...context,
    snapshot: { ...context.snapshot, observation_revision: 2 },
    command: { ...context.command, observation_revision: 2 },
  })
  const resumed = (await f.get_run())!
  expect(resumed.status).toBe('active')
  expect(resumed.last_command_id).not.toBe(command.id)
  expect(await f.store.read<Command>(`command:${resumed.last_command_id}`)).toMatchObject({
    status: 'accepted',
    kind: 'gather',
  })
  await f.runtime.stop()
})

test('historical blocked transition releases admission for explicit correction and resume', async () => {
  const f = await fixture()
  try {
    const context = profession_context()
    await f.tick({ ...context, snapshot: { ...context.snapshot, characters: [] } })
    const run = (await f.get_run())!
    expect(run.status).toBe('awaiting_ai')
    const lane = (await f.store.read<Lane>(f.key))!
    await expect(
      f.control.resume_profession(f.grant, run.id, lane.decision_revision, lane.observation_revision)
    ).resolves.toMatchObject({ resumed: true })
    await f.tick({ ...context, snapshot: { ...context.snapshot, characters: [] } })
    const released = (await f.store.read<Lane>(f.key))!
    await expect(
      f.control.accept(f.grant, {
        idempotency_key: 'explicit-correction',
        kind: 'craft',
        payload: { character_id: character.id, output_type: recipe.output_type, attempts: 1 },
        decision_revision: released.decision_revision,
        observation_revision: released.observation_revision,
      })
    ).resolves.toMatchObject({ status: 'accepted' })
  } finally {
    await f.runtime.stop()
  }
})
