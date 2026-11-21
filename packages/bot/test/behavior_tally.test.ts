// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import { bind_strategy, strategies, type StrategyBinding } from '@aresrpg/protocol/strategies'

import dungeons from '../../../seed/content/dungeons.json'
import { told_run } from '../src/actor_observation.ts'
import { behavior_condition } from '../src/behavior_facts.ts'
import { next_behavior_action } from '../src/behavior_plan.ts'
import { parse_behavior_script, type BehaviorCondition, type BehaviorScript } from '../src/behavior_script.ts'
import { charge_run, observe_dungeon, run_tally } from '../src/behavior_tally.ts'
import type { Command, Lane } from '../src/control.ts'
import { live_value, persistent_value } from '../src/store_projection.ts'
import { create_transaction_lifecycle } from '../src/transaction_lifecycle.ts'

import { put } from './helpers/control_fixture.ts'
import { fixture } from './helpers/hero_runs_fixture.ts'
import { character, profession_context, resource } from './helpers/profession_fixture.ts'
import { hero_in, run_of, world_context, WORLD } from './helpers/travel_fixture.ts'

const inside = { dungeon: dungeons[0]!.dungeon, room: 1 }

test('a tally starts empty, adds the net gas of each receipt and counts a dungeon run only when it ends', () => {
  const run = {}
  expect(run_tally(run)).toEqual({ fees_mist: '0', dungeon_runs: 0, in_dungeon: false })
  // A rebate larger than the cost is a negative fee: the sum stays the sum of the receipts.
  const charged = [23n, 1_000_000_000n, -75n].reduce(charge_run, run)
  expect(run_tally(charged).fees_mist).toBe('999999948')
  const hero = hero_in({ zx: 98, zz: 97 })
  const looks = [undefined, inside, inside, undefined, undefined, { ...inside, room: 2 }, undefined]
  const counts = looks.reduce<readonly number[]>((seen, dungeon_run, index) => {
    const prior = looks
      .slice(0, index)
      .reduce((folded, row) => observe_dungeon(folded, { ...hero, dungeon_run: row }), run)
    return [...seen, run_tally(observe_dungeon(prior, { ...hero, dungeon_run })).dungeon_runs]
  }, [])
  expect(counts).toEqual([0, 0, 0, 1, 1, 1, 2])
  // A hero the bot does not observe changes nothing: absence is not "outside".
  const entered = observe_dungeon(run, { ...hero, dungeon_run: inside })
  expect(observe_dungeon(entered, undefined)).toBe(entered)
})

test('a tree reads its own tally: fees in MIST, dungeon runs ended, and whether its hero is inside a run', () => {
  const context = profession_context()
  const run = { tally: { fees_mist: '10000000000', dungeon_runs: 2, in_dungeon: false } }
  const fees = (op: string, value: string) => ({ type: 'fees_spent', op, value }) as BehaviorCondition
  const runs = (op: string, value: number) => ({ type: 'dungeon_runs', op, value }) as BehaviorCondition
  expect(behavior_condition(fees('gte', '10000000000'), context, run)).toBe(true)
  expect(behavior_condition(fees('gt', '10000000000'), context, run)).toBe(false)
  expect(behavior_condition(fees('lt', '18446744073709551615'), context, run)).toBe(true)
  expect(behavior_condition(runs('gte', 2), context, run)).toBe(true)
  expect(behavior_condition(runs('gte', 3), context, run)).toBe(false)
  // A run that tallied nothing answers from zero; it never waits for an observation.
  expect(behavior_condition(fees('gte', '1'), context, {})).toBe(false)
  expect(behavior_condition(runs('eq', 0), context)).toBe(true)
  const fact = { fact: { type: 'dungeon_run', character_id: character.id }, op: 'eq', value: true } as const
  expect(behavior_condition(fact, context)).toBe(false)
  const raiding = { ...context.snapshot, characters: [{ ...character, dungeon_run: inside }] }
  expect(behavior_condition(fact, { ...context, snapshot: raiding })).toBe(true)
  for (const invalid of [fees('gte', '-1'), fees('gte', '1.5'), runs('gte', -1), { type: 'fees_spent', op: 'gte' }])
    expect(() =>
      parse_behavior_script({
        version: '1',
        objective: { title: 'Cap' },
        tree: { type: 'condition', condition: invalid },
      })
    ).toThrow('invalid_behavior_condition')
})

/** What each tree cannot be bound without. */
const required: Partial<StrategyBinding> = { dungeon: inside.dungeon, item: resource.item_type, tool: 'any_tool' }
test('every catalogue tree bound with a fee cap ends before its next step once its fees reach the cap', () => {
  const context = world_context(hero_in({ zx: 98, zz: 97 }))
  for (const { id: strategy } of strategies) {
    const script = parse_behavior_script(
      bind_strategy(strategy, {
        character: character.id,
        title: 'Capped',
        area: { world: WORLD },
        ...required,
        fee_cap_mist: '100',
      })
    )
    const capped = next_behavior_action(run_of(script, { tally: run_tally(charge_run({}, 100n)) }), null, context)
    expect(capped).toMatchObject({ state: 'completed', issue: 'fee_cap_reached' })
    expect(capped.action).toBeUndefined()
    const under = next_behavior_action(run_of(script, { tally: run_tally(charge_run({}, 99n)) }), null, context)
    expect(under.issue).not.toBe('fee_cap_reached')
    // No cap bound: no sum of fees ends the run.
    const open = parse_behavior_script(
      bind_strategy(strategy, { character: character.id, title: 'Open', area: { world: WORLD }, ...required })
    )
    const rich = run_of(open, { tally: run_tally(charge_run({}, 10n ** 18n)) })
    expect(next_behavior_action(rich, null, context).issue).not.toBe('fee_cap_reached')
  }
})

/** A tree that harvests until its fees reach fifty MIST. */
const capped_gather: BehaviorScript = {
  version: '1',
  objective: { title: 'Capped' },
  tree: {
    type: 'loop',
    child: {
      type: 'selector',
      children: [
        {
          type: 'sequence',
          children: [
            { type: 'condition', condition: { type: 'fees_spent', op: 'gte', value: '50' } },
            { type: 'complete', reason: 'fee_cap_reached' },
          ],
        },
        {
          type: 'action',
          action: { type: 'gather', character_id: character.id, item_type: resource.item_type, order: 'nearest' },
        },
      ],
    },
  },
}
const receipt = (digest: string, success = true) => ({
  Transaction: {
    digest,
    effects: {
      status: success ? { success } : { success, error: { message: 'fixture abort' } },
      gasUsed: { computationCost: '20', storageCost: '5', storageRebate: '2' },
    },
  },
})

test('a run pays until its receipts reach the cap, then ends: its tally is the sum of the receipts', async () => {
  const f = await fixture()
  const start = (script: BehaviorScript, idempotency_key: string) =>
    f.control.start_behavior(f.grant, { idempotency_key, script, decision_revision: 0, observation_revision: 1 })
  const run = await start(capped_gather, 'capped')
  /** Sign, settle from a certified receipt, then observe its effect: the signing slot is free again. */
  const settle = async (success = true) => {
    const command = await f.command_of(run.id)
    const journal = create_transaction_lifecycle(
      f.store,
      f.options.config,
      () => ({ command, actor_id: 'actor', fence: f.first_fence }),
      () => f.clock.now
    )
    const prepared = { digest: command.id, bytes: new Uint8Array([1]), gas_budget_mist: '100' }
    await journal.prepared(prepared)
    await journal.settled(receipt(command.id, success), { ...prepared, phase: 'submitted' })
    // The same receipt delivered again charges nothing more.
    await journal.settled(receipt(command.id, success), { ...prepared, phase: 'submitted' })
    const lane = await f.lane()
    await put(f.store, f.key, {
      ...lane,
      reconciliation_command: null,
      needs_resync: false,
      observation_revision: lane.observation_revision + 1,
    })
  }
  const fees = async () => run_tally(await f.run(run.id)).fees_mist
  /** A loop yields once after each traversal, so the pass after a finished harvest only starts the next one. */
  const act = async () => ((await f.tick(run.id)) === 'waiting' ? f.tick(run.id) : 'active')
  // Each harvest costs 23 MIST net. Two of them stay under the cap of 50: the run goes on.
  expect(await act()).toBe('active')
  await settle()
  expect(await fees()).toBe('23')
  expect(await act()).toBe('active')
  // A transaction that executed and failed paid its gas too.
  await settle(false)
  expect(await fees()).toBe('46')
  expect(await act()).toBe('active')
  await settle()
  // The third receipt crossed the cap: 69 MIST, 19 over, less than the one transaction that crossed it.
  expect(await fees()).toBe('69')
  expect((await f.lane()).fees_mist).toBe('69')
  const last = (await f.run(run.id)).last_command_id
  expect(await f.tick(run.id)).toBe('completed')
  const ended = await f.run(run.id)
  expect(ended).toMatchObject({ status: 'completed', issue: 'fee_cap_reached', last_command_id: last })
  expect((await f.store.read<Command>(`command:${last}`))?.status).toBe('completed')
  expect(told_run(ended)).toMatchObject({ status: 'completed', fees_mist: '69', dungeon_runs: 0 })
  // A new start of the same hero is a new run: its tally starts at zero, the wallet's total stays.
  const again = await start(capped_gather, 'capped-again')
  expect(run_tally(await f.run(again.id)).fees_mist).toBe('0')
  expect((await f.store.read<Lane>(f.key))?.fees_mist).toBe('69')
  await f.runtime.stop()
})

test('a tally is stored with its run: a restart keeps it, a replacement starts a new one, a stop keeps it', async () => {
  const f = await fixture()
  const run = await f.start(character.id)
  const tally = { fees_mist: '46', dungeon_runs: 3, in_dungeon: false }
  await put(f.store, `behavior:${run.id}`, { ...(await f.run(run.id)), tally })
  // What the permanent store keeps of a run and of a lane now includes what they paid.
  expect(persistent_value('behavior:run', { id: 'run', status: 'active', tally, memory: {} })).toEqual({
    id: 'run',
    status: 'active',
    tally,
  })
  expect(persistent_value('lane:wallet', { fence: 1, fees_mist: '69', pending: null })).toMatchObject({
    fence: 1,
    fees_mist: '69',
  })
  expect(live_value('behavior:run', { id: 'run', revision: 1, status: 'active', tally })).toMatchObject({ tally })
  // A new actor lifetime evaluates the tree from its root and keeps the tally.
  const fence = await f.lease()
  await f.tick(run.id, fence)
  expect(await f.run(run.id)).toMatchObject({ execution_fence: fence, tally })
  await f.settle(run.id)
  const stopped = await f.control.stop_behavior(f.grant, character.id)
  expect(stopped).toMatchObject({ status: 'stopped', tally })
  const lane = await f.lane()
  const replaced = await f.control.replace_behavior(f.grant, {
    character_id: character.id,
    expected_revision: stopped.revision,
    script: capped_gather,
    decision_revision: lane.decision_revision,
    observation_revision: lane.observation_revision,
  })
  expect(replaced.revision).toBe(stopped.revision + 1)
  expect((await f.run(replaced.id)).tally).toBeUndefined()
  expect(run_tally(await f.run(replaced.id))).toEqual({ fees_mist: '0', dungeon_runs: 0, in_dungeon: false })
  await f.runtime.stop()
})

test('a settled receipt charges the wallet once, and the run that signed it only while it is still that run', async () => {
  const f = await fixture()
  const run = await f.start(character.id)
  const journal_of = (command: Command) =>
    create_transaction_lifecycle(
      f.store,
      f.options.config,
      () => ({ command, actor_id: 'actor', fence: f.first_fence }),
      () => f.clock.now
    )
  const fees = async () => ({ wallet: (await f.lane()).fees_mist, run: (await f.run(run.id)).tally?.fees_mist })
  const free_slot = async (active_command: string | null) =>
    put(f.store, f.key, { ...(await f.lane()), active_command, reconciliation_command: null, needs_resync: false })
  // A direct command belongs to no run: only the wallet is charged.
  const lane = await f.lane()
  const direct: Command = {
    id: 'direct',
    grant_id: f.grant.id,
    bot_id: f.bot.id,
    lane_key: f.key,
    fingerprint: 'fixture',
    kind: 'raise_stats',
    payload: {},
    decision_revision: lane.decision_revision,
    observation_revision: lane.observation_revision,
    status: 'accepted',
  }
  await put(f.store, 'command:direct', direct)
  await free_slot('direct')
  const first = { digest: 'first', bytes: new Uint8Array([1]), gas_budget_mist: '100' }
  await journal_of(direct).prepared(first)
  await journal_of(direct).settled(receipt('first'), { ...first, phase: 'submitted' })
  expect(await fees()).toEqual({ wallet: '23', run: undefined })
  // The hero's run signs the next one. Receipt recovery settles it while another command is bound.
  await free_slot(null)
  await f.tick(run.id)
  const step = await f.command_of(run.id)
  const second = { ...first, digest: 'second' }
  await journal_of(step).prepared(second)
  await journal_of(direct).settled(receipt('second'), { ...second, phase: 'submitted' })
  // The same receipt delivered again is a no-op: nothing is charged twice.
  await journal_of(step).settled(receipt('second'), { ...second, phase: 'submitted' })
  expect(await fees()).toEqual({ wallet: '46', run: '23' })
  // A tree accepted before a late receipt arrives is another run: it is not charged for the old one.
  await put(f.store, 'command:late', { ...step, id: 'late', status: 'executing' })
  await put(f.store, f.key, {
    ...(await f.lane()),
    active_command: 'late',
    pending: { command_id: 'late', grant_id: f.grant.id, digest: 'third', phase: 'submitting', bytes: 'AQ==' },
  })
  await put(f.store, `behavior:${run.id}`, { ...(await f.run(run.id)), revision: 2, tally: undefined })
  await journal_of(step).settled(receipt('third'), { ...first, digest: 'third', phase: 'submitted' })
  expect(await fees()).toEqual({ wallet: '69', run: undefined })
  await f.runtime.stop()
})
