// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import { create_control_service, lane_key_for, type Lane, type Command } from '../src/control.ts'
import { run_tick } from '../src/run_runtime.ts'
import { ready_gameplay_command } from '../src/command_wait.ts'
import { create_transaction_journal } from '../src/transaction_journal.ts'
import { bind_action_baseline, reconcile_action } from '../src/action_reconciliation.ts'
import { parse_behavior_script, type BehaviorRun, type BehaviorScript } from '../src/behavior_script.ts'
import { owned_run_observation } from '../src/actor_observation.ts'
import { read_owner_activity } from '../src/owner_activity.ts'
import { run_ref_of } from '../src/run_ref.ts'
import { create_mcp_handler } from '../src/mcp.ts'

import { runtime_fixture } from './helpers/runtime_fixture.ts'
import { put } from './helpers/control_fixture.ts'
import { profession_context, character, recipe, resource, item } from './helpers/profession_fixture.ts'

const script: BehaviorScript = {
  version: '1',
  objective: { title: 'Gather, then craft' },
  tree: {
    type: 'sequence',
    children: [
      {
        type: 'action',
        action: { type: 'gather', character_id: character.id, item_type: resource.item_type, order: 'nearest' },
      },
      {
        type: 'action',
        action: {
          type: 'call',
          kind: 'craft',
          payload: { character_id: character.id, output_type: recipe.output_type, attempts: 1 },
        },
      },
      { type: 'complete' },
    ],
  },
}
const fixture = async (tree = script) => {
  const f = await runtime_fixture()
  const control = create_control_service(f.store, f.options.config, 60000, () => f.clock.now)
  const lane = await control.acquire(f.bot, 'actor', 10000)
  const key = lane_key_for(f.bot)
  await control.observed(key, 'actor', lane.fence, true)
  const started = await control.start_behavior(f.grant, {
    idempotency_key: 'tree',
    script: tree,
    decision_revision: 0,
    observation_revision: 1,
  })
  const run_key = `behavior:${started.id}`
  const get_run = async () => (await f.store.read<BehaviorRun>(run_key))!
  const get_command = async () => (await f.store.read<Command>(`command:${(await get_run()).last_command_id}`))!
  const tick = async (context = profession_context(), requested?: BehaviorRun) =>
    run_tick('behavior', {
      store: f.store,
      config: f.options.config,
      actor_id: 'actor',
      fence: lane.fence,
      run: requested ?? (await get_run()),
      context,
      now: f.clock.now,
    })
  const journal = (command: Command) =>
    create_transaction_journal(
      f.store,
      f.options.config,
      f.options.cipher,
      { command, actor_id: 'actor', fence: lane.fence },
      () => f.clock.now
    )
  return { ...f, control, lane, key, run_key, get_run, get_command, tick, journal }
}
test('tree admission, restart and competing control share the existing single lane', async () => {
  const f = await fixture()
  await Promise.all([f.tick(), f.tick()])
  expect(await f.get_run()).toMatchObject({ actions_started: 1, pending_node: 'root/0', revision: 1 })
  const command = await f.get_command()
  expect(command).toMatchObject({
    kind: 'gather',
    status: 'accepted',
    behavior_binding: { revision: 1, node: 'root/0' },
  })
  const restarted = create_control_service(f.store, f.options.config, 60000, () => f.clock.now)
  expect((await restarted.behavior_status(f.grant, (await f.get_run()).id)).last_command_id).toBe(command.id)
  await f.tick()
  expect((await f.get_run()).actions_started).toBe(1)
  await expect(
    restarted.start_behavior(f.grant, {
      idempotency_key: 'compete',
      script,
      decision_revision: 2,
      observation_revision: 1,
    })
  ).rejects.toThrow('bot_busy_or_paused')
  await expect(
    f.control.accept(f.grant, {
      idempotency_key: 'compete',
      kind: 'craft',
      payload: { character_id: character.id, output_type: recipe.output_type, attempts: 1 },
      decision_revision: 2,
      observation_revision: 1,
    })
  ).rejects.toThrow('bot_busy_or_paused')
  await expect(f.control.behavior_status({ ...f.grant, id: 'other' }, (await f.get_run()).id)).rejects.toThrow(
    'invalid_token'
  )
  await f.runtime.stop()
})
test('receipt and projection gate advancement; consumed completion cannot skip a later traversal', async () => {
  const looping: BehaviorScript = {
    ...script,
    tree: {
      type: 'action',
      action: { type: 'gather', character_id: character.id, item_type: resource.item_type, order: 'nearest' },
    },
  }
  const f = await fixture(looping)
  await f.tick()
  const context = profession_context()
  const command = {
    ...bind_action_baseline(await f.get_command(), context),
    status: 'completed' as const,
    result: { digest: 'fixture' },
  }
  await put(f.store, `command:${command.id}`, command)
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
  await put(f.store, f.key, {
    ...(await f.store.read<Lane>(f.key))!,
    active_command: null,
    reconciliation_command: command.id,
    needs_resync: true,
  })
  await f.tick()
  expect((await f.get_run()).actions_started).toBe(1)
  const fresh = {
    ...context,
    snapshot: {
      ...context.snapshot,
      characters: [{ ...character, at_ms: 1, jobs: { [resource.job]: '1' } }],
      zones: {
        ...context.snapshot.zones,
        'fixture:97:97': {
          ...context.snapshot.zones['fixture:97:97']!,
          zone: { ...context.snapshot.zones['fixture:97:97']!.zone, res_taken: [1] },
        },
      },
    },
  }
  await reconcile_action(f.store, f.key, 'actor', f.lane.fence, fresh, f.clock.now)
  await f.tick(fresh)
  expect(await f.get_run()).toMatchObject({
    actions_started: 1,
    consumed_command_id: command.id,
    memory: { completed: [] },
    status: 'waiting',
  })
  // Another traversal resolves a new action instead of consuming the same completed command twice.
  await f.tick(context)
  expect((await f.get_run()).actions_started).toBe(2)
  expect((await f.get_command()).id).not.toBe(command.id)
  await f.runtime.stop()
})
test('failed or uncertain execution is never selector failure or automatic replacement', async () => {
  for (const status of ['failed', 'uncertain', 'cancelled'] as const) {
    const f = await fixture({
      ...script,
      tree: { type: 'selector', children: [structuredClone(script.tree), structuredClone(script.tree)] },
    })
    await f.tick()
    const command = await f.get_command()
    await put(f.store, `command:${command.id}`, { ...command, status, error: 'test_outcome' })
    await f.tick()
    const blocked = await f.get_run()
    expect(blocked).toMatchObject({ status: 'awaiting_ai', actions_started: 1, issue: `command_${status}` })
    const lane = (await f.store.read<Lane>(f.key))!
    expect(await owned_run_observation(f.store, lane, command)).toMatchObject({
      run_ref: { kind: 'behavior', id: blocked.id },
      state: 'awaiting_ai',
      issue: `command_${status}`,
    })
    expect(await read_owner_activity(f.store, f.bot, [f.grant], f.clock.now)).toMatchObject({
      objective: script.objective,
      issue: `command_${status}`,
    })
    await f.tick()
    expect((await f.get_run()).actions_started).toBe(1)
    expect(await f.store.scan_keys('command:', 10)).toHaveLength(1)
    await f.runtime.stop()
  }
})
test('script replacement and stop preserve every prepared envelope phase', async () => {
  for (const phase of ['prepared', 'signed', 'submitting'] as const) {
    const f = await fixture()
    await f.tick()
    const command = await f.get_command()
    const journal = f.journal(command)
    const prepared = { digest: 'exact-digest', bytes: new Uint8Array([1, 2, 3]), gas_budget_mist: '100' }
    await journal.prepared(prepared)
    const signed = { ...prepared, signatures: ['exact-signature'] }
    if (phase !== 'prepared') await journal.signed(signed)
    if (phase === 'submitting') await journal.mark_submitting(signed)
    const envelope = (await f.store.read<Lane>(f.key))!.pending
    const run = await f.get_run()
    await expect(
      f.control.replace_behavior(f.grant, {
        run_id: run.id,
        expected_revision: run.revision,
        script,
        decision_revision: command.decision_revision,
        observation_revision: command.observation_revision,
      })
    ).rejects.toThrow('bot_busy_or_paused')
    await expect(
      ready_gameplay_command(
        f.store,
        f.options.config,
        { command, actor_id: 'actor', fence: f.lane.fence },
        profession_context(),
        f.clock.now
      )
    ).rejects.toThrow('execution_not_authorized')
    await f.control.stop_behavior(f.grant, run.id)
    expect((await f.store.read<Lane>(f.key))!.pending).toEqual(envelope)
    expect(await journal.read()).toMatchObject({ phase, digest: prepared.digest, bytes: prepared.bytes })
    await expect(journal.admit('submit')).rejects.toThrow('execution_not_authorized')
    await f.tick()
    expect((await f.get_run()).actions_started).toBe(1)
    await f.runtime.stop()
  }
})
test('tree has no service action or time cutoff; pause and conflicting authority still fence it', async () => {
  const f = await fixture()
  await put(f.store, f.run_key, { ...(await f.get_run()), actions_started: 201, created_at: -86400000 })
  await f.tick()
  expect((await f.get_run()).actions_started).toBe(202)
  await f.control.pause(f.grant)
  await f.tick()
  expect((await f.get_run()).status).toBe('paused')
  expect(() => run_ref_of({ run_ref: { kind: 'behavior', id: 'a' }, combat_run_id: 'b' })).toThrow(
    'run_reference_conflict'
  )
  await f.runtime.stop()
})
test('public MCP exposes one authored behavior start and strict shared script validation', async () => {
  const f = await fixture()
  const mcp = create_mcp_handler(f.control, true, 'metadata')
  const list = (await mcp(f.grant, { jsonrpc: '2.0', id: 1, method: 'tools/list' })) as {
    result: { tools: { name: string }[] }
  }
  const names = list.result.tools.map(({ name }) => name)
  expect(names).toContain('bot_start_behavior')
  expect(names).not.toContain('bot_start_profession')
  expect(names).not.toContain('bot_start_combat')
  expect(parse_behavior_script(script)).toEqual(script)
  expect(() =>
    parse_behavior_script({
      ...script,
      tree: { type: 'action', action: { type: 'call', kind: 'arbitrary_code', payload: {} } },
    })
  ).toThrow()
  await f.runtime.stop()
})

test('idempotent script admission preserves metadata and replacement fences revisions', async () => {
  const f = await fixture()
  const input = { idempotency_key: 'tree', script, decision_revision: 0, observation_revision: 1 }
  expect((await f.control.start_behavior(f.grant, input)).id).toBe((await f.get_run()).id)
  await expect(
    f.control.start_behavior(f.grant, { ...input, script: { ...script, objective: { title: 'Different' } } })
  ).rejects.toThrow('idempotency_conflict')
  const run = await f.get_run()
  await expect(
    f.control.replace_behavior(f.grant, {
      run_id: run.id,
      expected_revision: 0,
      script,
      decision_revision: 1,
      observation_revision: 1,
    })
  ).rejects.toThrow('behavior_revision_conflict')
  const replacement = { ...script, objective: { title: 'Revised', description: 'External AI authored' } }
  const next = await f.control.replace_behavior(f.grant, {
    run_id: run.id,
    expected_revision: 1,
    script: replacement,
    decision_revision: 1,
    observation_revision: 1,
  })
  expect(next).toMatchObject({ revision: 2, script: replacement, actions_started: 0 })
  await f.runtime.stop()
})
test('terminal failure fences and cancels signed recovery without consuming submission', async () => {
  const f = await fixture()
  await f.tick()
  const command = await f.get_command()
  const journal = f.journal(command)
  const prepared = { digest: 'never-submitted', bytes: new Uint8Array([1, 2, 3]), gas_budget_mist: '100' }
  await journal.prepared(prepared)
  await journal.signed({ ...prepared, signatures: ['signature'] })
  await put(f.store, `command:${command.id}`, { ...command, status: 'uncertain', error: 'interrupted_before_submit' })
  await f.tick()
  const lane = (await f.store.read<Lane>(f.key))!
  expect(lane.decision_revision).toBeGreaterThan(command.decision_revision)
  expect(lane.pending?.phase).toBe('signed')
  await f.runtime.tick()
  await f.runtime.settle()
  expect((await f.store.read<Lane>(f.key))!.pending).toBeNull()
  expect((await f.store.read<Command>(`command:${command.id}`))!.status).toBe('cancelled')
  expect(f.sockets).toHaveLength(0)
  await f.runtime.stop()
})

test('a submitting blocker keeps its exact envelope and cannot replace the objective', async () => {
  const f = await fixture()
  try {
    await f.tick()
    const command = await f.get_command()
    const journal = f.journal(command)
    const prepared = { digest: 'submitted-digest', bytes: new Uint8Array([1, 2, 3]), gas_budget_mist: '100' }
    const signed = { ...prepared, signatures: ['exact-signature'] }
    await journal.prepared(prepared)
    await journal.signed(signed)
    await journal.mark_submitting(signed)
    const envelope = (await f.store.read<Lane>(f.key))!.pending
    await put(f.store, `command:${command.id}`, { ...command, status: 'uncertain', error: 'response_lost' })
    await f.tick()
    const blocked = await f.get_run()
    const lane = (await f.store.read<Lane>(f.key))!
    expect(blocked).toMatchObject({ status: 'awaiting_ai', issue: 'command_uncertain' })
    expect(lane.pending).toEqual(envelope)
    expect(await read_owner_activity(f.store, f.bot, [f.grant], f.clock.now)).toMatchObject({
      status: 'unavailable',
      objective: script.objective,
      issue: 'command_uncertain',
    })
    await expect(
      f.control.replace_behavior(f.grant, {
        run_id: blocked.id,
        expected_revision: blocked.revision,
        script,
        decision_revision: lane.decision_revision,
        observation_revision: lane.observation_revision,
      })
    ).rejects.toThrow('bot_busy_or_paused')
    await expect(journal.admit('submit')).rejects.toThrow()
    await f.tick()
    expect((await f.get_run()).actions_started).toBe(1)
    expect((await f.store.read<Lane>(f.key))!.pending).toEqual(envelope)
  } finally {
    await f.runtime.stop()
  }
})

test('failed commands expose safe actionable causes without publishing raw diagnostic payloads', async () => {
  for (const [error, issue] of [
    ['Error: tool_unavailable', 'tool_unavailable'],
    [
      'Error: [sdk] transaction resolution failed — NOT submitted: insufficient balance secret-account',
      'funding_required',
    ],
    ['Error: unexpected secret implementation payload', 'command_failed'],
  ]) {
    const f = await fixture()
    try {
      await f.tick()
      const command = await f.get_command()
      await put(f.store, `command:${command.id}`, { ...command, status: 'failed', error })
      await f.tick()
      const lane = (await f.store.read<Lane>(f.key))!
      expect(await owned_run_observation(f.store, lane, command)).toMatchObject({ state: 'awaiting_ai', issue })
      expect(await read_owner_activity(f.store, f.bot, [f.grant], f.clock.now)).toMatchObject({ issue })
      expect((await f.get_command()).error).toBe(error)
    } finally {
      await f.runtime.stop()
    }
  }
})
