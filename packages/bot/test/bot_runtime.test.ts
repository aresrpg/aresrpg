// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Hero run execution: receipts and projections, refusals, uncertain work, planning faults and contract freezes.
import { expect, test, describe } from 'bun:test'

import { create_control_service, lane_key_for, type Command, type Lane } from '../src/control.ts'
import { run_tick } from '../src/run_runtime.ts'
import { create_transaction_lifecycle } from '../src/transaction_lifecycle.ts'
import { owned_run_observation, run_observation, told_run } from '../src/actor_observation.ts'
import { ready_gameplay_command } from '../src/run_runtime.ts'
import { bind_action_baseline, reconcile_action } from '../src/action_reconciliation.ts'
import { type BehaviorRun, type BehaviorScript } from '../src/behavior_script.ts'
import { wallet_state } from '../src/status_sharer.ts'

import { runtime_fixture, put } from './fixture.ts'
import { profession_context, character, resource, recipe } from './fixture_game.ts'
import { signed_fixture } from './fixture_fight.ts'

describe('behavior runtime', () => {
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
      run_tick({
        store: f.store,
        config: f.options.config,
        actor_id: 'actor',
        fence: lane.fence,
        run: requested ?? (await get_run()),
        context,
        now: f.clock.now,
      })
    const journal = (command: Command) =>
      create_transaction_lifecycle(
        f.store,
        f.options.config,
        () => ({ command, actor_id: 'actor', fence: lane.fence }),
        () => f.clock.now
      )
    return { ...f, control, lane, key, run_key, get_run, get_command, tick, journal }
  }
  test('tree admission and competing controls share the same session lane', async () => {
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
    expect((await restarted.behavior_status(f.grant, character.id)).last_command_id).toBe(command.id)
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
    // A direct command no longer needs an idle wallet: it queues behind the tree's admitted command.
    const lane = (await f.store.read<Lane>(f.key))!
    const direct = await f.control.accept(f.grant, {
      idempotency_key: 'compete',
      kind: 'craft',
      payload: { character_id: character.id, output_type: recipe.output_type, attempts: 1 },
      decision_revision: lane.decision_revision,
      observation_revision: lane.observation_revision,
    })
    expect(await f.store.read<Lane>(f.key)).toMatchObject({ active_command: command.id, direct: direct.id })
    await expect(f.control.behavior_status({ ...f.grant, id: 'other' }, character.id)).rejects.toThrow('invalid_token')
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
    await put(f.store, `command:${command.id}`, {
      ...command,
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
  const twin_selector = {
    ...script,
    tree: { type: 'selector' as const, children: [structuredClone(script.tree), structuredClone(script.tree)] },
  }
  test('an uncertain command is never selector failure or automatic replacement', async () => {
    const f = await fixture(twin_selector)
    await f.tick()
    const command = await f.get_command()
    await put(f.store, `command:${command.id}`, { ...command, status: 'uncertain', error: 'test_outcome' })
    await f.tick()
    const blocked = await f.get_run()
    expect(blocked).toMatchObject({ status: 'awaiting_ai', actions_started: 1, issue: 'command_uncertain' })
    const lane = (await f.store.read<Lane>(f.key))!
    const run = {
      id: blocked.id,
      character_id: character.id,
      status: 'awaiting_ai' as const,
      issue: 'command_uncertain',
    }
    const observed = { runs: [{ ...run, strategy: undefined }], state: 'awaiting_ai', direct: null }
    expect(await owned_run_observation(f.store, lane, command)).toEqual(observed)
    const told = await run_observation(f.store, lane, { bot_id: f.bot.id }, told_run)
    expect(told.runs).toMatchObject([{ objective: script.objective, issue: 'command_uncertain' }])
    await f.tick()
    expect((await f.get_run()).actions_started).toBe(1)
    expect(await f.store.scan_keys('command:', 10)).toHaveLength(1)
    await f.runtime.stop()
  })
  test('a failed or cancelled command completes nothing and is tried again only once the game state moves', async () => {
    for (const [status, issue] of [
      ['failed', 'command_failed'],
      ['cancelled', 'command_cancelled'],
    ] as const) {
      const f = await fixture(twin_selector)
      await f.tick()
      const command = await f.get_command()
      // An executed on-chain failure, as receipt settlement leaves it; the signing slot is free again.
      await put(f.store, `command:${command.id}`, { ...command, status, error: 'MoveAbort', result: { digest: 'd' } })
      await put(f.store, f.key, { ...(await f.store.read<Lane>(f.key))!, active_command: null })
      for (let tick = 0; tick < 3; tick += 1) await expect(f.tick()).resolves.toBe('waiting')
      expect(await f.get_run()).toMatchObject({ status: 'waiting', issue, actions_started: 1 })
      expect(await f.store.scan_keys('command:', 10)).toHaveLength(1)
      // A semantic observation change is a new fact: its own leaf selects again, never the fallback.
      const lane = (await f.store.read<Lane>(f.key))!
      await put(f.store, f.key, { ...lane, observation_revision: lane.observation_revision + 1 })
      const base = profession_context()
      const revision = lane.observation_revision + 1
      const moved = {
        ...base,
        command: { ...base.command, observation_revision: revision },
        snapshot: { ...base.snapshot, observation_revision: revision },
      }
      await expect(f.tick(moved)).resolves.toBe('active')
      const next = await f.get_command()
      expect(await f.get_run()).toMatchObject({ actions_started: 2, memory: { completed: [] } })
      expect(next.id).not.toBe(command.id)
      expect(next.behavior_binding).toEqual(command.behavior_binding)
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
          character_id: character.id,
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
      await f.control.stop_behavior(f.grant, character.id)
      expect((await f.store.read<Lane>(f.key))!.pending).toEqual(envelope)
      expect(await journal.read()).toMatchObject({ phase, digest: prepared.digest, bytes: prepared.bytes })
      await expect(journal.admit('submit')).rejects.toThrow('execution_not_authorized')
      await f.tick()
      expect((await f.get_run()).actions_started).toBe(1)
      await f.runtime.stop()
    }
  })

  test('idempotent script admission preserves metadata and replacement fences revisions', async () => {
    const f = await fixture()
    const input = { idempotency_key: 'tree', script, decision_revision: 0, observation_revision: 1 }
    expect((await f.control.start_behavior(f.grant, input)).id).toBe((await f.get_run()).id)
    await expect(
      f.control.start_behavior(f.grant, { ...input, script: { ...script, objective: { title: 'Different' } } })
    ).rejects.toThrow('bot_busy_or_paused')
    await expect(
      f.control.replace_behavior(f.grant, {
        character_id: character.id,
        expected_revision: 0,
        script,
        decision_revision: 0,
        observation_revision: 1,
      })
    ).rejects.toThrow('behavior_revision_conflict')
    const replacement = { ...script, objective: { title: 'Revised', description: 'External AI authored' } }
    const next = await f.control.replace_behavior(f.grant, {
      character_id: character.id,
      expected_revision: 1,
      script: replacement,
      decision_revision: 0,
      observation_revision: 1,
    })
    expect(next).toMatchObject({ revision: 2, script: replacement, actions_started: 0 })
    await f.runtime.stop()
  })

  test('an uncertain submission waits on its exact envelope, is never resubmitted, and continues once recovered', async () => {
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
      // Receipt recovery owns the envelope, so the run waits on it instead of yielding to the author.
      expect(blocked).toMatchObject({ status: 'waiting', issue: 'command_uncertain' })
      expect(lane.pending).toEqual(envelope)
      // The owner is told the wallet is unavailable while its command in flight is uncertain.
      const held = lane.active_command ? await f.store.read<Command>(`command:${lane.active_command}`) : null
      expect(wallet_state(f.bot, lane, held, [blocked.status], f.clock.now)).toBe('unavailable')
      const told = await run_observation(f.store, lane, { bot_id: f.bot.id }, told_run)
      expect(told.runs).toMatchObject([{ objective: script.objective, issue: 'command_uncertain' }])
      await expect(
        f.control.replace_behavior(f.grant, {
          character_id: character.id,
          expected_revision: blocked.revision,
          script,
          decision_revision: lane.decision_revision,
          observation_revision: lane.observation_revision,
        })
      ).rejects.toThrow('bot_busy_or_paused')
      await expect(journal.admit('submit')).rejects.toThrow('command_not_active')
      await f.tick()
      expect((await f.get_run()).actions_started).toBe(1)
      expect((await f.store.read<Lane>(f.key))!.pending).toEqual(envelope)
      // Recovery settles the exact receipt as an on-chain failure: the run is no longer parked, and it
      // waits for the game state to move before its leaf selects again.
      await put(f.store, `command:${command.id}`, { ...command, status: 'failed', error: 'MoveAbort' })
      await put(f.store, f.key, { ...(await f.store.read<Lane>(f.key))!, pending: null, active_command: null })
      await expect(f.tick()).resolves.toBe('waiting')
      expect(await f.get_run()).toMatchObject({ status: 'waiting', issue: 'command_failed', actions_started: 1 })
    } finally {
      await f.runtime.stop()
    }
  })

  test('a funding refusal waits for more SUI, then the same leaf selects again', async () => {
    const f = await fixture()
    try {
      await f.tick()
      const command = await f.get_command()
      const error = 'Error: [sdk] transaction resolution failed — NOT submitted: insufficient balance secret-account'
      await put(f.store, `command:${command.id}`, { ...command, status: 'failed', error, funding_balance_mist: '5' })
      await put(f.store, f.key, { ...(await f.store.read<Lane>(f.key))!, active_command: null })
      const funded = (balance_mist: string) => {
        const base = profession_context()
        return { ...base, balance: { address: base.address, balance_mist, sampled_at: 0, expires_at: base.now + 1 } }
      }
      for (const balance of ['5', '4']) await expect(f.tick(funded(balance))).resolves.toBe('waiting')
      const lane = (await f.store.read<Lane>(f.key))!
      expect(await owned_run_observation(f.store, lane, command)).toMatchObject({
        runs: [{ character_id: character.id, status: 'waiting', issue: 'funding_required' }],
      })
      expect(await f.store.scan_keys('command:', 10)).toHaveLength(1)
      // A refill unlocks it with no decision: the next tick selects the same leaf against fresh state.
      await expect(f.tick(funded('6'))).resolves.toBe('active')
      expect((await f.get_command()).behavior_binding).toEqual(command.behavior_binding)
      expect((await f.get_run()).actions_started).toBe(2)
    } finally {
      await f.runtime.stop()
    }
  })

  test('new lease reevaluates the saved script from root only after fresh observations', async () => {
    const f = await fixture()
    try {
      await f.tick()
      const old_command = await f.get_command()
      const prior = await f.get_run()
      await put(f.store, f.run_key, {
        ...prior,
        memory: { completed: ['root/0'] },
        pending_node: 'root/1',
        consumed_command_id: old_command.id,
        actions_started: 42,
      })
      f.clock.now += 10001
      const lease = await f.control.acquire(f.bot, 'replacement', 10000)
      const tick = async (context = profession_context()) =>
        run_tick({
          store: f.store,
          config: f.options.config,
          actor_id: 'replacement',
          fence: lease.fence,
          run: await f.get_run(),
          context,
          now: f.clock.now,
        })
      expect(await tick()).toBe('waiting')
      expect(await f.get_run()).toMatchObject({
        execution_fence: lease.fence,
        actions_started: 0,
        last_command_id: null,
        memory: { completed: [] },
        pending_node: null,
        activation: null,
        consumed_command_id: null,
      })
      await f.control.observed(f.key, 'replacement', lease.fence, true)
      const lane = (await f.store.read<Lane>(f.key))!
      const context = profession_context()
      await tick({
        ...context,
        command: { ...context.command, observation_revision: lane.observation_revision },
        snapshot: { ...context.snapshot, observation_revision: lane.observation_revision },
      })
      expect(await f.get_run()).toMatchObject({ actions_started: 1, pending_node: 'root/0' })
      expect((await f.get_command()).kind).toBe('gather')
      expect((await f.get_command()).id).not.toBe(old_command.id)
      await f.control.stop_behavior(f.grant, character.id)
      f.clock.now += 10001
      const stopped_lease = await f.control.acquire(f.bot, 'third', 10000)
      await run_tick({
        store: f.store,
        config: f.options.config,
        actor_id: 'third',
        fence: stopped_lease.fence,
        run: prior,
        context,
        now: f.clock.now,
      })
      expect((await f.get_run()).status).toBe('stopped')
    } finally {
      await f.runtime.stop()
    }
  })
})

describe('actor contract pause', () => {
  const accepted_fixture = async () => {
    const f = await signed_fixture()
    await f.store.transaction([f.lane_key, 'command:signed'], async (tx) => {
      const lane = (await tx.get<Lane>(f.lane_key))!
      await tx.put(f.lane_key, { ...lane, pending: null, active_command: null })
      await tx.put('command:signed', { ...f.command, status: 'cancelled' })
    })
    await f.runtime.observe(f.grant, {})
    await f.admit()
    await f.runtime.settle()
    const lane = (await f.store.read<Lane>(f.lane_key))!
    const control = create_control_service(f.store, f.options.config, 60000, () => f.clock.now)
    const command = await control.accept(f.grant, {
      idempotency_key: 'pause-before-execution',
      kind: 'fight_turn',
      payload: f.command.payload,
      decision_revision: lane.decision_revision,
      observation_revision: lane.observation_revision,
    })
    const tick = async () => {
      await f.runtime.tick()
      await f.runtime.settle()
    }
    const freeze = async (frozen: boolean) => {
      await f.send({ type: 'packet/game_state', frozen })
      await f.runtime.settle()
    }
    return { ...f, original: f.command, command, control, tick, freeze }
  }

  test('accepted gameplay silently waits for contract resume and executes its original intent once', async () => {
    const f = await accepted_fixture()
    try {
      await f.freeze(true)
      for (let i = 0; i < 3; i++) await f.tick()
      expect(f.errors).toEqual([])
      expect(f.submissions).toHaveLength(0)
      expect(await f.store.read<Command>(`command:${f.command.id}`)).toMatchObject({ status: 'accepted' })
      await f.freeze(false)
      await f.tick()
      await f.tick()
      expect(f.errors).toEqual([])
      expect(f.submissions).toHaveLength(1)
      expect(await f.store.read<Command>(`command:${f.command.id}`)).toMatchObject({
        status: 'completed',
        fingerprint: f.command.fingerprint,
        payload: f.command.payload,
      })
    } finally {
      await f.runtime.stop()
    }
  })

  test('explicit pause wins over contract resume', async () => {
    const f = await accepted_fixture()
    try {
      await f.freeze(true)
      await f.tick()
      await f.control.pause(f.grant)
      await f.tick()
      await f.freeze(false)
      await f.tick()
      expect(f.submissions).toHaveLength(0)
      expect(await f.store.read<Command>(`command:${f.command.id}`)).toMatchObject({ status: 'failed' })
    } finally {
      await f.runtime.stop()
    }
  })
})
