// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import { CONTRACT_CONSTANTS } from '@aresrpg/fight'
import { bind_strategy } from '@aresrpg/protocol/strategies'

import { create_control_service, lane_key_for, type Command, type Lane } from '../src/control.ts'
import { run_tick } from '../src/run_runtime.ts'
import { process_lane_runs } from '../src/run_actor.ts'
import { MAX_WALLET_RUNS } from '../src/run_ref.ts'
import { signing_order, turn_deadline } from '../src/signing_queue.ts'
import { create_transaction_lifecycle } from '../src/transaction_lifecycle.ts'
import { owned_run_observation, run_observation, told_run } from '../src/actor_observation.ts'
import { parse_behavior_script, type BehaviorRun, type BehaviorScript } from '../src/behavior_script.ts'
import type { ActorSnapshot } from '../src/actor_snapshot.ts'
import type { Grant } from '../src/model.ts'
import type { ControlStore } from '../src/store.ts'
import { id } from '../../sdk/test/helpers/transport.ts'

import { runtime_fixture } from './helpers/runtime_fixture.ts'
import { fixture_bot, put } from './helpers/control_fixture.ts'
import { profession_context, character, resource } from './helpers/profession_fixture.ts'
import { character as fighter, row_of, started, fight_id, placement } from './helpers/combat_runtime_fixture.ts'
import { ally, context, fixture, tree } from './helpers/hero_runs_fixture.ts'

test('one queue pass admits one signature and the next pass serves the next hero', async () => {
  const f = await fixture()
  const [first, second] = [await f.start(character.id), await f.start(ally.id)]
  await f.pass()
  expect((await f.lane()).active_command).toBe((await f.run(first.id)).last_command_id)
  expect((await f.run(second.id)).actions_started).toBe(0)
  await f.settle(first.id)
  await f.pass()
  expect((await f.lane()).active_command).toBe((await f.run(second.id)).last_command_id)
  expect((await f.run(first.id)).actions_started).toBe(1)
  await f.settle(second.id)
  // Both trees first consume their reconciled command; nobody signs in that pass.
  await f.pass()
  expect((await f.lane()).active_command).toBeNull()
  await f.pass()
  expect((await f.run(first.id)).actions_started).toBe(2)
  expect((await f.run(second.id)).actions_started).toBe(1)
  expect(f.errors).toEqual([])
  await f.runtime.stop()
})

test('each hero owns its run and the wallet signs one transaction at a time', async () => {
  const f = await fixture()
  const [first, second] = [await f.start(character.id), await f.start(ally.id)]
  expect((await f.lane()).runs).toEqual({ [character.id]: first.id, [ally.id]: second.id })
  expect(first.character_id).toBe(character.id)
  await f.tick(first.id)
  await f.tick(second.id)
  expect((await f.lane()).active_command).toBe((await f.run(first.id)).last_command_id)
  expect(await f.run(second.id)).toMatchObject({ status: 'waiting', actions_started: 0, last_command_id: null })
  const signed = await f.settle(first.id)
  await f.tick(second.id)
  expect((await f.command_of(second.id)).payload.character_id).toBe(ally.id)
  // The next hero's admission does not release the previous hero's command before its tree consumed it.
  expect((await f.store.read<Command>(`command:${signed.id}`))?.status).toBe('completed')
  await f.settle(second.id)
  await f.tick(first.id)
  expect((await f.run(first.id)).consumed_command_id).toBe(signed.id)
  expect((await f.lane()).decision_revision).toBe(0)
  await f.runtime.stop()
})

test('stopping one hero leaves its neighbour signing', async () => {
  const f = await fixture()
  const [first, second] = [await f.start(character.id), await f.start(ally.id)]
  await f.tick(first.id)
  const command = await f.command_of(first.id)
  const journal = create_transaction_lifecycle(
    f.store,
    f.options.config,
    () => ({ command, actor_id: 'actor', fence: f.first_fence }),
    () => f.clock.now
  )
  await f.control.stop_behavior(f.grant, ally.id)
  expect(await f.run(second.id)).toMatchObject({ status: 'stopped', issue: 'explicit_stop' })
  // The owner's queue pass, not the stop, frees the slot.
  await f.pass()
  expect((await f.lane()).runs).toEqual({ [character.id]: first.id })
  await journal.admit('prepare')
  await f.control.stop_behavior(f.grant, character.id)
  await expect(journal.admit('prepare')).rejects.toThrow('execution_not_authorized')
  await f.pass()
  expect((await f.lane()).runs).toEqual({})
  // A stopped hero frees its slot for a new run, once its own admitted command has drained.
  const again = (character_id: string) =>
    f.control.start_behavior(f.grant, {
      idempotency_key: 'again',
      script: tree(character_id),
      decision_revision: 0,
      observation_revision: 1,
    })
  expect((await f.start(ally.id)).status).toBe('stopped')
  expect((await again(ally.id)).status).toBe('active')
  await expect(again(character.id)).rejects.toThrow('bot_busy_or_paused')
  await put(f.store, f.key, { ...(await f.lane()), active_command: null })
  expect(await again(character.id)).toMatchObject({ status: 'active', revision: 2 })
  await f.runtime.stop()
})

test('a wallet hosts one run per hero and at most the owner limit', async () => {
  const f = await fixture()
  await f.start(character.id)
  await expect(
    f.control.start_behavior(f.grant, {
      idempotency_key: 'twice',
      script: tree(character.id),
      decision_revision: 0,
      observation_revision: 1,
    })
  ).rejects.toThrow('bot_busy_or_paused')
  const two_heroes = {
    ...tree(character.id),
    tree: { type: 'sequence' as const, children: [tree(character.id).tree, tree(ally.id).tree] },
  }
  await expect(f.control.validate_behavior(f.grant, two_heroes)).rejects.toThrow('behavior_needs_one_character')
  expect(MAX_WALLET_RUNS).toBe(30)
  for (let hero = 1; hero < MAX_WALLET_RUNS; hero++) await f.start(id(100 + hero))
  expect(Object.keys((await f.lane()).runs!)).toHaveLength(MAX_WALLET_RUNS)
  await expect(f.start(id(99))).rejects.toThrow('run_limit_reached')
  await f.runtime.stop()
})

test('after a restart each hero evaluates its own tree from the root', async () => {
  const f = await fixture()
  const [first, second] = [await f.start(character.id), await f.start(ally.id)]
  await f.tick(first.id)
  const before = await f.command_of(first.id)
  const fence = await f.lease()
  expect(fence).toBe(f.first_fence + 1)
  expect((await f.lane()).runs).toEqual({ [character.id]: first.id, [ally.id]: second.id })
  await f.tick(second.id, fence)
  await f.settle(second.id)
  await f.tick(first.id, fence)
  expect(await f.run(second.id)).toMatchObject({ execution_fence: fence, actions_started: 1 })
  expect(await f.run(first.id)).toMatchObject({ execution_fence: fence, actions_started: 1 })
  expect((await f.command_of(first.id)).id).not.toBe(before.id)
  await f.runtime.stop()
})

test('any live grant of the same owner sees, adopts and stops a hero run; another owner sees nothing', async () => {
  const f = await fixture()
  const second_grant: Grant = { ...f.grant, id: 'second', client_id: 'other-client' }
  const stranger: Grant = { ...f.grant, id: 'stranger', bot_id: 'other', owner: id(7), address: id(8) }
  await put(f.store, 'grant:second', second_grant)
  await put(f.store, 'grant:stranger', stranger)
  await put(f.store, 'bot:other', { ...f.bot, id: 'other', owner: stranger.owner, address: stranger.address })
  const started_run = await f.start(character.id)
  await put(f.store, 'grant:grant', { ...f.grant, revoked: true })
  await expect(f.control.behavior_status(f.grant, character.id)).rejects.toThrow('invalid_token')
  expect((await f.control.behavior_status(second_grant, character.id)).id).toBe(started_run.id)
  const observe = (grant: Grant) =>
    owned_run_observation(f.store, null, { grant_id: grant.id, bot_id: grant.bot_id } as Command).then(async () =>
      owned_run_observation(f.store, await f.lane(), { grant_id: grant.id, bot_id: grant.bot_id } as Command)
    )
  expect((await observe(second_grant)).runs).toEqual([
    { id: started_run.id, character_id: character.id, status: 'active', issue: undefined, strategy: undefined },
  ])
  expect((await observe(stranger)).runs).toEqual([])
  await expect(f.control.behavior_status(stranger, character.id)).rejects.toThrow('behavior_run_not_found')
  await expect(f.control.stop_behavior(stranger, character.id)).rejects.toThrow('behavior_run_not_found')
  // The revoked grant no longer authorizes the run: its next evaluation stops it and signs nothing.
  await f.tick(started_run.id)
  expect(await f.run(started_run.id)).toMatchObject({ status: 'stopped', issue: 'invalid_token', actions_started: 0 })
  expect((await f.lane()).runs).toEqual({})
  const adopted = await f.control.replace_behavior(second_grant, {
    character_id: character.id,
    expected_revision: 1,
    script: tree(character.id, 'Adopted'),
    decision_revision: 0,
    observation_revision: 1,
  })
  expect(adopted).toMatchObject({ grant_id: 'second', status: 'active', character_id: character.id })
  await f.tick(started_run.id)
  expect((await f.command_of(started_run.id)).grant_id).toBe('second')
  expect((await f.control.stop_behavior(second_grant, character.id)).status).toBe('stopped')
  await f.runtime.stop()
})

test('a run knows the catalogue entry it was bound from, and an authored tree names none', async () => {
  const f = await fixture()
  const script = bind_strategy('gather_craft', { character: character.id, title: 'Gather', area: { world: 'nauvis' } })
  const bound = await f.control.start_behavior(f.grant, {
    idempotency_key: 'bound',
    script,
    decision_revision: 0,
    observation_revision: 1,
  })
  const authored = await f.start(ally.id)
  const asking = { grant_id: f.grant.id, bot_id: f.grant.bot_id } as Command
  const observed = await owned_run_observation(f.store, await f.lane(), asking)
  // The wire shape of `bot_observe` runs: exactly these keys, with `strategy` only on a bound tree.
  expect(JSON.parse(JSON.stringify(observed.runs))).toEqual([
    { id: bound.id, character_id: character.id, status: 'active', strategy: 'gather_craft' },
    { id: authored.id, character_id: ally.id, status: 'active' },
  ])
  expect((await f.control.behavior_status(f.grant, character.id)).script.strategy).toBe('gather_craft')
  expect((await f.control.behavior_status(f.grant, ally.id)).script).not.toHaveProperty('strategy')
  for (const strategy of ['', 7, null])
    expect(() => parse_behavior_script({ ...script, strategy })).toThrow('invalid_behavior_script')
  await f.runtime.stop()
})

test('every hero run is listed with the objective its tree was authored with', async () => {
  const f = await fixture()
  await f.start(character.id)
  await f.start(ally.id)
  const { runs } = await run_observation(f.store, await f.lane(), { bot_id: f.bot.id }, told_run)
  expect(runs).toMatchObject([
    { character_id: character.id, status: 'active', objective: { title: 'Gather' } },
    { character_id: ally.id, status: 'active', objective: { title: 'Gather' } },
  ])
  await f.runtime.stop()
})

test('a hero whose turn another wallet could pass signs first; the others take turns', () => {
  const none = () => Infinity
  expect(signing_order(['c', 'a', 'b'], undefined, none)).toEqual(['a', 'b', 'c'])
  expect(signing_order(['c', 'a', 'b'], 'a', none)).toEqual(['b', 'c', 'a'])
  expect(signing_order(['c', 'a', 'b'], 'c', none)).toEqual(['a', 'b', 'c'])
  const due: Record<string, number> = { a: 90, c: 50 }
  expect(signing_order(['a', 'b', 'c'], 'a', (hero) => due[hero] ?? Infinity)).toEqual(['c', 'a', 'b'])
  const active = started()
  const snapshot = { characters: [fighter()], fights: { [fight_id]: row_of(active) } }
  // A fight seated only by this wallet has no clock to beat: nobody else can pass the turn.
  expect(turn_deadline(fighter().id, snapshot, fixture_bot.address)).toBe(Infinity)
  const rival = structuredClone(active.contract.fighters[0]!)
  if (rival.kind.type !== 'player') throw new Error('invalid fixture')
  Object.assign(rival.kind, { owner: id(66), character: id(67) })
  active.contract.fighters.push(rival)
  const contested = { ...snapshot, fights: { [fight_id]: row_of(active) } }
  expect(turn_deadline(fighter().id, contested, fixture_bot.address)).toBe(
    Number(active.contract.turn_started_ms + CONTRACT_CONSTANTS.turn_max_ms)
  )
  expect(CONTRACT_CONSTANTS.turn_max_ms).toBe(45_000n)
  expect(turn_deadline(fighter().id, { ...contested, fights: { [fight_id]: row_of(placement()) } }, 'x')).toBe(Infinity)
  expect(turn_deadline('absent', contested, fixture_bot.address)).toBe(Infinity)
})

test('one hero at a time holds the wallet market view', async () => {
  const f = await fixture()
  const [first, second] = [await f.start(character.id), await f.start(ally.id)]
  // Nobody can sign, so one pass asks every hero.
  await put(f.store, f.key, { ...(await f.lane()), needs_resync: true })
  await f.pass()
  const holders = () => f.asked.filter(({ payload }) => Object.hasOwn(payload, 'prices')).map(({ id: run }) => run)
  expect(f.asked).toHaveLength(2)
  expect(holders()).toEqual([`behavior:${[first.id, second.id].toSorted()[0]}`])
  const waiting = [first.id, second.id].toSorted()[1]!
  await put(f.store, `behavior:${waiting}`, { ...(await f.run(waiting)), prices: { item_type: 'wood', id: 1 } })
  f.asked.length = 0
  await f.pass()
  expect(holders()).toEqual([`behavior:${waiting}`])
  await f.runtime.stop()
})

test('a stored run of a retired shape is stopped and reported once, never executed', async () => {
  const f = await fixture()
  const stored = { bot_id: f.bot.id, grant_id: f.grant.id, lane_key: f.key, status: 'active' }
  const retired = {
    'profession:old': { ...stored, id: 'old', plan: { character_id: character.id } },
    'combat:old': { ...stored, id: 'old', fight: id(9), profiles: [] },
    'behavior:wallet-wide': { ...stored, id: 'wallet-wide', script: tree(character.id), revision: 1 },
  }
  for (const [key, record] of Object.entries(retired)) await put(f.store, key, record)
  await put(f.store, f.key, { ...(await f.lane()), profession_run_id: 'old', combat_run_id: 'old' })
  for (const key of Object.keys(retired)) await f.runtime.wake(key)
  await f.runtime.tick()
  await f.runtime.settle()
  for (const key of Object.keys(retired)) {
    expect(await f.store.read(key)).toMatchObject({ status: 'stopped' })
    expect(await f.store.scan_pending(50)).not.toContain(key)
  }
  expect(await f.store.read('profession:old')).toMatchObject({ issue: 'legacy_run_retired', plan: {} })
  expect(f.errors.map(String).toSorted()).toEqual(
    Object.keys(retired)
      .map((key) => `Error: legacy_run_retired ${key}`)
      .toSorted()
  )
  for (const key of Object.keys(retired)) await f.runtime.wake(key)
  await f.runtime.settle()
  expect(f.errors).toHaveLength(3)
  expect(await f.store.scan_keys('command:', 10)).toEqual([])
  expect(f.sockets).toEqual([])
  // The wallet is free for hero runs: the retired lane fields host nothing.
  expect((await f.start(character.id)).status).toBe('active')
  await f.runtime.stop()
})

test('the market view passes to the next asking hero once the holder has its data', async () => {
  const f = await fixture()
  const [first, second] = [await f.start(character.id), await f.start(ally.id)].map(({ id: run }) => run).toSorted()
  await put(f.store, f.key, { ...(await f.lane()), needs_resync: true })
  const ask = async (run: string, item_type: string) =>
    put(f.store, `behavior:${run}`, { ...(await f.run(run)), prices: { item_type, id: 1 } })
  await ask(first!, 'wood')
  await ask(second!, 'stone')
  const holder = async (observed_item: string | null) => {
    const base = context(1).snapshot
    const market_prices = observed_item ? { observation: { item_type: observed_item, id: 1 } } : undefined
    f.asked.length = 0
    await f.pass({ ...base, inventory: { ...base.inventory!, market_prices } } as ActorSnapshot)
    return f.asked.filter(({ payload }) => Object.hasOwn(payload, 'prices')).map(({ id: run }) => run)
  }
  expect(await holder(null)).toEqual([`behavior:${first}`])
  expect(await holder('wood')).toEqual([`behavior:${second}`])
  expect(await holder('stone')).toEqual([`behavior:${first}`])
  await f.runtime.stop()
})

test('a stop written by another process cannot fail a neighbour hero command that is signing', async () => {
  const f = await fixture()
  const [first, second] = [await f.start(character.id), await f.start(ally.id)]
  await f.tick(first.id)
  const command = await f.command_of(first.id)
  // Two processes share one store and compare-and-set. The other process commits between the
  // owner's read and its commit: the losing interleaving for the owner.
  let between = async () => {}
  const racing: ControlStore = {
    ...f.store,
    transaction: async (keys, operation) => {
      const read_all = async (get: (key: string) => Promise<unknown>) =>
        JSON.stringify(await Promise.all(keys.map(get)))
      const before = await read_all((key) => f.store.read(key))
      const writes = new Map<string, unknown>()
      const result = await operation({
        get: async <T>(key: string) => (writes.has(key) ? (writes.get(key) as T) : f.store.read<T>(key)),
        put: async (key, value) => {
          writes.set(key, value)
        },
      })
      await between()
      return f.store.transaction(keys, async (tx) => {
        if ((await read_all((key) => tx.get(key))) !== before) throw new Error('control_transaction_conflict')
        for (const [key, value] of writes) await tx.put(key, value)
        return result
      })
    },
  }
  const journal = create_transaction_lifecycle(
    racing,
    f.options.config,
    () => ({ command, actor_id: 'actor', fence: f.first_fence }),
    () => f.clock.now
  )
  between = async () => {
    between = async () => {}
    await f.control.stop_behavior(f.grant, ally.id)
  }
  await journal.prepared({ digest: 'neighbour', bytes: new Uint8Array([1]), gas_budget_mist: '100' })
  expect((await f.lane()).pending).toMatchObject({ command_id: command.id, phase: 'prepared' })
  expect((await f.store.read<Command>(`command:${command.id}`))?.status).toBe('executing')
  expect(await f.run(second.id)).toMatchObject({ status: 'stopped', issue: 'explicit_stop' })
  // The stopped hero is fenced at once by its own record; the owner's next queue pass frees its slot.
  expect((await f.lane()).runs).toEqual({ [character.id]: first.id, [ally.id]: second.id })
  await f.pass()
  expect((await f.lane()).runs).toEqual({ [character.id]: first.id })
  expect((await f.lane()).pending?.command_id).toBe(command.id)
  await f.runtime.stop()
})
