// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import { create_control_service, lane_key_for, type Lane, type Command } from '../src/control.ts'
import { next_behavior_action } from '../src/behavior_plan.ts'
import { run_tick } from '../src/run_runtime.ts'
import { refresh_run_command } from '../src/run_refresh.ts'
import { command_issue, planning_issue, public_command_error } from '../src/planning_failure.ts'
import type { BehaviorRun } from '../src/behavior_script.ts'

import { put } from './helpers/control_fixture.ts'
import { runtime_fixture } from './helpers/runtime_fixture.ts'
import { profession_context, character, resource } from './helpers/profession_fixture.ts'

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
  expect(planning_issue(new Error('ingredients_required'))).toEqual({ state: 'failure', issue: 'ingredients_required' })
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
  expect(String(reports[0])).toContain(run.id)
  expect(String(reports[0])).toContain('"revision":1')
  expect(String(reports[0])).toContain('TypeError')
  expect(String(reports[0])).not.toContain('secret')
  await f.runtime.stop()
})
test('unexpected refresh failure retires only the unsent draft before surfacing its diagnostic', async () => {
  const f = await fixture()
  await run_tick(f.input)
  const run = await f.get_run()
  const command = (await f.store.read<Command>(`command:${run.last_command_id}`))!
  await expect(
    refresh_run_command(
      f.store,
      f.options.config,
      { command, actor_id: 'actor', fence: f.input.fence },
      broken(f.input.context),
      f.clock.now
    )
  ).rejects.toThrow('run_planning_internal_error')
  expect(await f.get_run()).toMatchObject({ status: 'waiting', issue: 'internal_error', last_command_id: null })
  expect((await f.store.read<Command>(`command:${command.id}`))?.status).toBe('cancelled')
  expect(await f.store.read<Lane>(f.key)).toMatchObject({
    pending: null,
    active_command: null,
    runs: { [run.character_id!]: run.id },
  })
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

test('explicit wait and completion do not invent an unhandled reason', async () => {
  const f = await fixture()
  const run = await f.get_run()
  for (const type of ['wait', 'complete'] as const) {
    const decision = next_behavior_action({ ...run, script: { ...run.script, tree: { type } } }, null, f.input.context)
    expect(decision.state).toBe(type === 'wait' ? 'waiting' : 'completed')
    expect(decision.issue).toBeUndefined()
    expect(decision.diagnostic).toBeUndefined()
  }
  await f.runtime.stop()
})
test('canonical equipment refusals fail the leaf so the tree can choose again', () => {
  for (const issue of ['wrong_slot', 'level_too_low', 'relic_duplicate', 'item_listed'])
    expect(planning_issue(new Error(issue))).toEqual({ state: 'failure', issue })
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
