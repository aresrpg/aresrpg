// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import { create_control_service, lane_key_for, type Lane, type Command } from '../src/control.ts'
import { next_behavior_action } from '../src/behavior_plan.ts'
import { run_tick } from '../src/run_runtime.ts'
import { refresh_run_command } from '../src/run_refresh.ts'
import { planning_issue } from '../src/planning_failure.ts'
import type { BehaviorRun } from '../src/behavior_script.ts'

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
  expect(planning_issue(new Error('ingredients_required'))).toEqual({
    state: 'awaiting_ai',
    issue: 'ingredients_required',
  })
  expect(planning_issue(new TypeError('needs_resync'))).toBeUndefined()
  expect(planning_issue(new Error('secret implementation payload'))).toBeUndefined()
})
test('unexpected planning failure commits a visible blocker and reports once after commit', async () => {
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
  await run_tick('behavior', input)
  expect((await committed[0])?.status).toBe('awaiting_ai')
  const run = await f.get_run()
  expect(run).toMatchObject({ status: 'awaiting_ai', issue: 'internal_error', actions_started: 0 })
  expect((await f.store.read<Lane>(f.key))?.run_ref).toEqual({ kind: 'behavior', id: run.id })
  expect(await f.store.scan_pending(20)).not.toContain(`behavior:${run.id}`)
  await run_tick('behavior', { ...input, run })
  expect(reports).toHaveLength(1)
  expect(String(reports[0])).toContain(run.id)
  expect(String(reports[0])).toContain('"revision":1')
  expect(String(reports[0])).toContain('TypeError')
  expect(String(reports[0])).not.toContain('secret')
  await f.runtime.stop()
})
test('unexpected refresh failure retires only the unsent draft before surfacing its diagnostic', async () => {
  const f = await fixture()
  await run_tick('behavior', f.input)
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
  expect(await f.get_run()).toMatchObject({ status: 'awaiting_ai', issue: 'internal_error', last_command_id: null })
  expect((await f.store.read<Command>(`command:${command.id}`))?.status).toBe('cancelled')
  expect(await f.store.read<Lane>(f.key)).toMatchObject({
    pending: null,
    active_command: null,
    run_ref: { kind: 'behavior', id: run.id },
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
test('canonical equipment refusals remain external instruction blockers', () => {
  for (const issue of ['wrong_slot', 'level_too_low', 'relic_duplicate', 'item_listed'])
    expect(planning_issue(new Error(issue))).toEqual({ state: 'awaiting_ai', issue })
})
