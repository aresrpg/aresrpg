// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import { job_xp_for_level } from '@aresrpg/immutable'

import { create_control_service, lane_key_for, type Lane, type Command } from '../src/control.ts'
import { create_transaction_journal } from '../src/transaction_journal.ts'
import { profession_tick } from '../src/profession_runtime.ts'
import type { ProfessionRun } from '../src/profession_control.ts'
import { create_mcp_handler } from '../src/mcp.ts'

import { runtime_fixture } from './helpers/runtime_fixture.ts'
import { put } from './helpers/control_fixture.ts'
import { profession_context, plan, character, item, recipe, resource } from './helpers/profession_fixture.ts'

const fixture = async () => {
  const f = await runtime_fixture()
  const control = create_control_service(f.store, f.options.config, 60000, () => f.clock.now)
  const lane = await control.acquire(f.bot, 'actor', 10000)
  const key = lane_key_for(f.bot)
  await control.observed(key, 'actor', lane.fence, true)
  const start = await control.start_profession(f.grant, {
    idempotency_key: 'plan',
    plan,
    decision_revision: 0,
    observation_revision: 1,
  })
  if (!('run' in start)) throw new Error('fixture start failed')
  const get_run = () => f.store.read<ProfessionRun>(`profession:${start.run!.id}`)
  const tick = async (context = profession_context()) =>
    profession_tick({
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

test('MCP validator performs no control writes, returns declared limits and works with play disabled', async () => {
  const f = await runtime_fixture()
  const control = create_control_service(
    f.store,
    f.options.config,
    60000,
    () => f.clock.now,
    async () => ({ status: 'pending' })
  )
  const mcp = create_mcp_handler(control, false, 'https://fixture/.well-known/oauth-protected-resource')
  const before = await f.store.scan_keys('', 1000)
  const result = await mcp(f.grant, {
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: { name: 'bot_validate_plan', arguments: { plan } },
  })
  expect(JSON.stringify(result)).toContain('"valid":true')
  expect(JSON.stringify(result)).toContain('not_run')
  expect(await f.store.scan_keys('', 1000)).toEqual(before)
  const tools = await mcp(f.grant, { jsonrpc: '2.0', id: 2, method: 'tools/list' })
  expect(JSON.stringify(tools)).toContain('bot_validate_plan')
  expect(JSON.stringify(tools)).not.toContain('bot_start_profession')
  await f.runtime.stop()
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
  const lane = (await f.store.read<Lane>(lane_key_for(f.bot)))!
  const started = await control.start_profession(f.grant, {
    idempotency_key: 'scheduler',
    plan,
    decision_revision: lane.decision_revision,
    observation_revision: lane.observation_revision,
  })
  if (!('run' in started)) throw new Error('run missing')
  await f.runtime.tick()
  await f.runtime.settle()
  const status = await control.profession_status(f.grant, started.run.id)
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
  await profession_tick({
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

test('live plan validation uses actor monotonic time while deadlines use epoch time', async () => {
  const f = await runtime_fixture()
  const epoch = 1_800_000_000_000
  const context = profession_context()
  const control = create_control_service(
    f.store,
    f.options.config,
    60000,
    () => epoch,
    async () => ({
      ...context.snapshot,
      decision_revision: 0,
      sampled_at: context.now,
    })
  )
  const result = await control.validate_plan(f.grant, { ...plan, deadline_ms: epoch + 100000 })
  expect(result.live.next?.state).toBe('action')
  expect(result.live.executable_now).toBe(true)
  const expired = await control.validate_plan(f.grant, { ...plan, deadline_ms: epoch - 1 })
  expect(expired.valid).toBe(false)
  await f.runtime.stop()
})
