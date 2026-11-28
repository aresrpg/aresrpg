// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Hero trees: the evaluator, authored conditions and what a planning fault or refusal does to a run.
import { expect, test, describe } from 'bun:test'

import { evaluate_behavior, empty_behavior_memory, type BehaviorNode } from '../src/behavior_tree.ts'
import { type Command, type Lane, create_control_service, lane_key_for } from '../src/control.ts'
import { parse_behavior_script, type BehaviorRun, type BehaviorScript } from '../src/behavior_script.ts'
import { next_behavior_action } from '../src/behavior_plan.ts'
import { run_tick } from '../src/run_runtime.ts'
import { command_issue, planning_issue, public_command_error } from '../src/planning_failure.ts'

import { put, runtime_fixture } from './fixture.ts'
import { profession_context, character, resource, recipe, item } from './fixture_game.ts'

describe('behavior tree', () => {
  type Node = BehaviorNode<string, string>
  const action = (name: string): Node => ({ type: 'action', action: name })
  const condition = (name: string): Node => ({ type: 'condition', condition: name })
  const branch: Node = {
    type: 'selector',
    children: [
      { type: 'sequence', children: [condition('urgent'), action('handle'), action('finish')] },
      { type: 'sequence', children: [action('gather'), action('craft')] },
    ],
  }
  test('reactive selector preempts and clears the abandoned subtree in either direction', () => {
    const first = evaluate_behavior(branch, empty_behavior_memory(), () => false)
    expect(first).toMatchObject({ status: 'action', node: 'root/1/0', action: 'gather' })
    const after_gather = { ...first.memory, completed: ['root/1/0'] }
    const next = evaluate_behavior(branch, after_gather, () => false)
    expect(next.action).toBe('craft')
    const urgent = evaluate_behavior(branch, next.memory, () => true)
    expect(urgent.action).toBe('handle')
    expect(urgent.memory.completed).toEqual([])
    const after_handle = { ...urgent.memory, completed: ['root/0/1'] }
    const lower = evaluate_behavior(branch, after_handle, () => false)
    expect(lower.action).toBe('gather')
    expect(lower.memory.completed).toEqual([])
  })
  test('unknown higher-priority facts block fallback actions and do not mean false', () => {
    const next = evaluate_behavior(branch, empty_behavior_memory(), () => null)
    expect(next.status).toBe('waiting')
    expect(next.action).toBeUndefined()
  })
  test('nested sequence retains action successes but reevaluates conditions', () => {
    const tree: Node = { type: 'sequence', children: [condition('ready'), action('buy'), action('craft')] }
    const memory = { ...empty_behavior_memory(), completed: ['root/1'] }
    expect(evaluate_behavior(tree, memory, () => true).action).toBe('craft')
    const invalidated = evaluate_behavior(tree, memory, () => false)
    expect(invalidated).toMatchObject({ status: 'failure', memory: { completed: [] } })
  })
  test('explicit loop yields after one traversal and never spins synchronously', () => {
    const tree: Node = { type: 'loop', child: condition('true') }
    let visits = 0
    const next = evaluate_behavior(tree, empty_behavior_memory(), () => {
      visits += 1
      return true
    })
    expect(next.status).toBe('waiting')
    expect(visits).toBe(1)
    expect(next.memory).toEqual(empty_behavior_memory())
  })
  test('unavailable selection falls through but waiting and replanning do not', () => {
    const tree: Node = { type: 'selector', children: [action('gather'), action('buy')] }
    expect(
      evaluate_behavior(
        tree,
        empty_behavior_memory(),
        () => true,
        (value) => (value === 'gather' ? 'failure' : 'action')
      ).action
    ).toBe('buy')
    for (const status of ['waiting', 'replan'] as const)
      expect(
        evaluate_behavior(
          tree,
          empty_behavior_memory(),
          () => true,
          () => status
        )
      ).toMatchObject({ status, action: 'gather' })
  })
  test('explicit completion propagates out of nested loops', () => {
    expect(
      evaluate_behavior(
        { type: 'loop', child: { type: 'sequence', children: [condition('goal'), { type: 'complete' }] } },
        empty_behavior_memory(),
        () => true
      ).status
    ).toBe('complete')
  })

  test('unknown priority preserves completed effects in the selected branch', () => {
    const memory = { completed: ['root/1/0'], selected: { root: 1 } }
    const blocked = evaluate_behavior(branch, memory, () => null)
    expect(blocked.memory).toEqual(memory)
    expect(blocked.blocked).toBe(true)
    expect(evaluate_behavior(branch, blocked.memory, () => false).action).toBe('craft')
  })

  test('an authored completion carries its reason out of the tree', () => {
    const tree: Node = {
      type: 'loop',
      child: {
        type: 'selector',
        children: [
          {
            type: 'sequence',
            children: [
              { type: 'condition', condition: 'capped' },
              { type: 'complete', reason: 'cap' },
            ],
          },
          { type: 'action', action: 'work' },
        ],
      },
    }
    expect(evaluate_behavior(tree, empty_behavior_memory(), () => true)).toMatchObject({
      status: 'complete',
      reason: 'cap',
    })
    expect(evaluate_behavior(tree, empty_behavior_memory(), () => false)).toMatchObject({ status: 'action' })
    expect(evaluate_behavior({ type: 'complete' }, empty_behavior_memory(), () => true).reason).toBeUndefined()
  })
})

describe('behavior plan', () => {
  const run_for = (script: BehaviorScript): BehaviorRun => ({
    id: 'run',
    bot_id: 'bot',
    grant_id: 'grant',
    lane_key: 'lane',
    character_id: character.id,
    fingerprint: 'fixture',
    script: parse_behavior_script(script),
    revision: 1,
    memory: empty_behavior_memory(),
    pending_node: null,
    activation: null,
    consumed_command_id: null,
    status: 'active',
    actions_started: 0,
    last_command_id: null,
    created_at: 0,
  })
  const objective: BehaviorScript = {
    version: '1',
    objective: { title: 'Authored gather and craft branches' },
    tree: {
      type: 'selector',
      children: [
        {
          type: 'sequence',
          children: [
            {
              type: 'condition',
              condition: { fact: { type: 'level', character_id: character.id }, op: 'gte', value: 30 },
            },
            { type: 'complete' },
          ],
        },
        {
          type: 'sequence',
          children: [
            {
              type: 'condition',
              condition: {
                fact: { type: 'quantity', character_id: character.id, key: resource.item_type },
                op: 'lt',
                value: recipe.inputs[resource.item_type]!,
              },
            },
            {
              type: 'action',
              action: { type: 'gather', character_id: character.id, item_type: resource.item_type, order: 'nearest' },
            },
          ],
        },
        {
          type: 'action',
          action: {
            type: 'call',
            kind: 'craft',
            payload: { character_id: character.id, output_type: recipe.output_type, attempts: 1 },
          },
        },
      ],
    },
  }
  test('authored conditions select gathering, crafting and explicit objective completion from current state', () => {
    const run = run_for(objective)
    const context = profession_context()
    expect(next_behavior_action(run, null, context).action?.kind).toBe('gather')
    const inventory = context.snapshot.inventory!
    const supplied = {
      ...context,
      snapshot: {
        ...context.snapshot,
        inventory: {
          ...inventory,
          items: [...inventory.items, item(resource.item_type, recipe.inputs[resource.item_type]!)],
        },
      },
    }
    expect(next_behavior_action(run, null, supplied).action?.kind).toBe('craft')
    const done = { ...context, snapshot: { ...context.snapshot, characters: [{ ...character, level: 30 }] } }
    expect(next_behavior_action(run, null, done).state).toBe('completed')
    const missing = { ...context, snapshot: { ...context.snapshot, inventory: { ...inventory, loaded: false } } }
    expect(next_behavior_action(run, null, missing).state).toBe('waiting')
  })
  test('a completed observation leaf still advances a fresh paginated market sweep', () => {
    const observation = {
      kind: 'offers' as const,
      category: 'resource' as const,
      request: 1,
      item_type: resource.item_type,
    }
    const run = run_for({
      version: '1',
      objective: { title: 'Inspect market' },
      tree: {
        type: 'sequence',
        children: [{ type: 'action', action: { type: 'observe_market', observation } }, { type: 'wait' }],
      },
    })
    const context = profession_context()
    const inventory = {
      ...context.snapshot.inventory!,
      market: {
        observation,
        next_cursor: 'page-two',
        listings: [],
        pages: [{ cursor: '', next_cursor: 'page-two', ids: [] }],
        complete: false,
      },
    }
    const next = next_behavior_action({ ...run, observation, memory: { completed: ['root/0'], selected: {} } }, null, {
      ...context,
      snapshot: { ...context.snapshot, inventory },
    })
    expect(next.record.observation).toMatchObject({ cursor: 'page-two' })
  })
})

describe('planning failure', () => {
  const fixture = async () => {
    const f = await runtime_fixture()
    const control = create_control_service(f.store, f.options.config, 60000, () => f.clock.now)
    const lease = await control.acquire(f.bot, 'actor', 10000)
    const key = lane_key_for(f.bot)
    await control.observed(key, 'actor', lease.fence, true)
    const run = await control.start_behavior(f.grant, {
      idempotency_key: 'diagnostic',
      decision_revision: 0,
      observation_revision: 1,
      script: {
        version: '1',
        objective: { title: 'Gather' },
        tree: {
          type: 'action',
          action: { type: 'gather', character_id: character.id, item_type: resource.item_type, order: 'nearest' },
        },
      },
    })
    const input = {
      store: f.store,
      config: f.options.config,
      actor_id: 'actor',
      fence: lease.fence,
      now: f.clock.now,
      context: profession_context(),
      run,
    }
    return { ...f, control, key, input, get_run: async () => (await f.store.read<BehaviorRun>(`behavior:${run.id}`))! }
  }
  const broken = (context: ReturnType<typeof profession_context>) => ({
    ...context,
    snapshot: {
      ...context.snapshot,
      get characters(): typeof context.snapshot.characters {
        throw new TypeError('secret implementation payload')
      },
    },
  })
  test('expected planning issues stay explicit and implementation errors are not domain refusals', () => {
    expect(planning_issue(new Error('needs_resync'))).toEqual({ state: 'waiting', issue: 'needs_resync' })
    expect(planning_issue(new Error('ingredients_required'))).toEqual({
      state: 'failure',
      issue: 'ingredients_required',
    })
    // A blocker holds its leaf like a wait, so its code reaches the run instead of falling through.
    expect(planning_issue(new Error('area_unreachable'))).toEqual({ state: 'waiting', issue: 'area_unreachable' })
    expect(command_issue('failed', 'Error: area_unreachable')).toBe('area_unreachable')
    expect(planning_issue(new TypeError('needs_resync'))).toBeUndefined()
    expect(planning_issue(new Error('secret implementation payload'))).toBeUndefined()
  })
  test('the refusals of the direct commands are domain codes: each fails its leaf and reaches a client as itself', () => {
    // Emptying an empty slot, creating a hero, withdrawing a listing, collecting proceeds.
    for (const code of [
      'slot_empty',
      'character_name_taken',
      'invalid_character_name',
      'listing_gone',
      'nothing_to_collect',
    ]) {
      expect(planning_issue(new Error(code))).toEqual({ state: 'failure', issue: code })
      expect(command_issue('failed', `Error: ${code}`)).toBe(code)
      expect(public_command_error('failed', code)).toBe(code)
    }
    // A failure names what happened, in words made only of our own Move names and codes: the chain refused it
    // before signing (nothing spent), it ran and failed (gas spent), or its outcome is not known.
    const abort =
      "abort code: 1712, in '0x427af9b0d1cc5145a5112bd5b473dd615d48b5389de296eb7c512afdec160e1d::fight::close'"
    for (const [stored, code] of [
      [
        `Error: [sdk] dry run failed — transaction NOT submitted (zero gas): ${abort}`,
        'chain_refused:fight_close_1712',
      ],
      [
        `Error: [sdk] transaction 6ccMkZqMcNBX8JLVKA55j38QooMgVCxxvztgYxQbsY3e failed on-chain: ${abort}`,
        'chain_failed:fight_close_1712',
      ],
      [
        'Error: [sdk] transaction outcome unknown: 6ccMkZ; check this transaction before trying again',
        'outcome_unknown',
      ],
      // A settled receipt keeps the chain's own words, with no SDK prefix: it ran, so its gas was spent.
      [abort, 'chain_failed:fight_close_1712'],
      // An earlier submission is still being settled: this command was never sent.
      [
        'Error: [sdk] previous transaction recovered: 6ccMkZ; refresh your game state before trying again',
        'command_failed',
      ],
      ['Error: something private about redis://user:secret@host', 'command_failed'],
      ['localhost:6379', 'command_failed'],
    ] as const) {
      expect(command_issue('failed', stored)).toBe(code)
      expect(public_command_error('failed', stored)).toBe(code)
      expect(public_command_error('failed', code)).toBe(code)
    }
  })
  test('unexpected planning failure waits visibly, re-evaluates, and reports once after commit', async () => {
    const f = await fixture()
    const reports: unknown[] = []
    const committed: Promise<BehaviorRun>[] = []
    const input = {
      ...f.input,
      context: broken(f.input.context),
      report_failure: (error: unknown) => {
        reports.push(error)
        committed.push(f.get_run())
      },
    }
    await run_tick(input)
    expect((await committed[0])?.status).toBe('waiting')
    const run = await f.get_run()
    expect(run).toMatchObject({ status: 'waiting', issue: 'internal_error', actions_started: 0 })
    expect(Object.values((await f.store.read<Lane>(f.key))?.runs ?? {})).toEqual([run.id])
    // Still scheduled: a fault is a fact the next tick reads again, never a stop.
    expect(await f.store.scan_pending(20)).toContain(`behavior:${run.id}`)
    await run_tick({ ...input, run })
    await run_tick({ ...input, run: await f.get_run() })
    await run_tick({ ...f.input, run: await f.get_run() })
    expect((await f.get_run()).status).toBe('active')
    expect(reports).toHaveLength(1)
    expect((reports[0] as { operation: unknown }).operation).toEqual({ run_id: run.id, revision: 1, type: 'TypeError' })
    expect(String(reports[0])).not.toContain('secret')
    await f.runtime.stop()
  })

  test('unknown condition blocks an authored fallback with an explicit observation reason', async () => {
    const f = await fixture()
    const run = await f.get_run()
    const decision = next_behavior_action(
      {
        ...run,
        script: {
          ...run.script,
          tree: {
            type: 'selector',
            children: [
              {
                type: 'condition',
                condition: { fact: { type: 'level', character_id: character.id }, op: 'gte', value: 30 },
              },
              run.script.tree,
            ],
          },
        },
      },
      null,
      { ...f.input.context, snapshot: { ...f.input.context.snapshot, characters: [] } }
    )
    expect(decision).toMatchObject({ state: 'waiting', issue: 'observation_unavailable' })
    expect(decision.action).toBeUndefined()
    expect(decision.diagnostic).toBeUndefined()
    await f.runtime.stop()
  })

  test('a refused leaf fails so a selector takes its next branch', async () => {
    const f = await fixture()
    const run = await f.get_run()
    const refused = {
      type: 'action',
      action: { type: 'call', kind: 'raise_spell', payload: { character_id: character.id, spell: 'Tricky Trap' } },
    }
    const decision = next_behavior_action(
      {
        ...run,
        script: { ...run.script, tree: { type: 'selector', children: [refused, run.script.tree] } },
      } as BehaviorRun,
      null,
      f.input.context
    )
    expect(decision).toMatchObject({ state: 'action', action: { kind: 'gather' }, node: 'root/1' })
    await f.runtime.stop()
  })
  test('a refusal that spent no gas is tried again after the retry delay; a gas-spending failure is not', async () => {
    for (const [spent, retried] of [
      [false, 'active'],
      [true, 'waiting'],
    ] as const) {
      const f = await fixture()
      await run_tick(f.input)
      const command = (await f.store.read<Command>(`command:${(await f.get_run()).last_command_id}`))!
      // As the executor leaves each failure: refused before submission, or settled from an aborted receipt.
      const failure = spent ? { result: { digest: 'd', gas_mist: '5' } } : { refused_at: f.clock.now }
      await put(f.store, `command:${command.id}`, { ...command, status: 'failed', error: 'MoveAbort', ...failure })
      // The slot is free again, and the lease renewed as the live actor does on every tick.
      const lease_until = f.clock.now + 2 * f.options.config.refusal_retry_ms
      await put(f.store, f.key, { ...(await f.store.read<Lane>(f.key))!, active_command: null, lease_until })
      const tick = async (now: number) => run_tick({ ...f.input, now, run: await f.get_run() })
      await expect(tick(f.clock.now + f.options.config.refusal_retry_ms - 1)).resolves.toBe('waiting')
      await expect(tick(f.clock.now + f.options.config.refusal_retry_ms)).resolves.toBe(retried)
      await f.runtime.stop()
    }
  })
})
