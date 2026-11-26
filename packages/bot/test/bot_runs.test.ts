// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Hero runs: the tree evaluator, admission, the signing queue, direct commands, planning faults and freezes.
import { expect, test, describe } from 'bun:test'
import { CONTRACT_CONSTANTS } from '@aresrpg/fight'

import { type Command, type Lane } from '../src/control.ts'
import { signing_order, turn_deadline } from '../src/run_actor.ts'
import { MAX_WALLET_RUNS } from '../src/run_ref.ts'
import { create_transaction_lifecycle } from '../src/transaction_lifecycle.ts'
import { owned_run_observation, told_run } from '../src/actor_observation.ts'
import type { ActorSnapshot } from '../src/actor_snapshot.ts'
import type { Grant } from '../src/model.ts'
import { id } from '../../sdk/test/helpers/transport.ts'
import { type BehaviorScript } from '../src/behavior_script.ts'
import { run_tally } from '../src/behavior_tally.ts'

import { fixture_bot, put } from './fixture.ts'
import { character, resource, ally, hero_runs as fixture, tree } from './fixture_game.ts'
import { fighter, row_of, started_fight as started, fight_id, placement } from './fixture_fight.ts'

describe('hero runs', () => {
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
    ).rejects.toThrow('behavior_running')
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
      { id: started_run.id, character_id: character.id, status: 'active', issue: undefined },
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
    expect(turn_deadline(fighter().id, { ...contested, fights: { [fight_id]: row_of(placement()) } }, 'x')).toBe(
      Infinity
    )
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
})

describe('direct commands', () => {
  /** A direct command of the typed catalogue, sent under the revisions its client observed. */
  const direct = async (
    f: Awaited<ReturnType<typeof fixture>>,
    hero: string,
    idempotency_key = 'buy',
    item_type = 'lorito_key'
  ) => {
    const { decision_revision, observation_revision } = await f.lane()
    return f.control.accept(f.grant, {
      idempotency_key,
      kind: 'market_buy',
      payload: {
        character_id: hero,
        item_id: id(31),
        seller_kiosk: id(32),
        listing_version: '4',
        item_type,
        amount: 1,
        price_mist: '1000',
        max_total_mist: '1100',
      },
      decision_revision,
      observation_revision,
    })
  }
  const status_of = async (f: Awaited<ReturnType<typeof fixture>>, command_id: string) =>
    (await f.store.read<Command>(`command:${command_id}`))?.status

  test('a direct command queues while heroes run, signs in its turn and fails nobody', async () => {
    const f = await fixture()
    const [first, second] = [await f.start(character.id), await f.start(ally.id)]
    await f.pass()
    const signing = await f.command_of(first.id)
    // The first hero is signing: the purchase is admitted as a queue entry and replaces nothing.
    const buy = await direct(f, ally.id)
    expect(buy.status).toBe('accepted')
    expect(await f.lane()).toMatchObject({ active_command: signing.id, direct: buy.id, decision_revision: 0 })
    expect(await f.pass()).toBeNull()
    expect(await status_of(f, signing.id)).toBe('accepted')
    // A wallet holds one direct command at a time.
    await expect(direct(f, character.id, 'second')).rejects.toThrow('bot_busy_or_paused')
    await f.settle(first.id)
    // The slot is free and two entries are ready: the direct command signs, the second hero waits.
    expect(await f.pass()).toMatchObject({ id: buy.id, status: 'accepted' })
    expect(await f.lane()).toMatchObject({ active_command: buy.id, latest_command: buy.id, direct: buy.id })
    // Any grant of the owner follows the command from its observations.
    expect((await owned_run_observation(f.store, await f.lane(), buy)).direct).toEqual({
      id: buy.id,
      kind: 'market_buy',
      status: 'accepted',
      error: undefined,
      payload: buy.payload,
    })
    expect((await f.run(second.id)).actions_started).toBe(0)
    expect(await f.pass()).toBeNull()
    await put(f.store, `command:${buy.id}`, { ...buy, status: 'completed', result: { digest: 'fixture' } })
    await put(f.store, f.key, { ...(await f.lane()), active_command: null })
    // The next signature is the second hero's; the settled purchase stays readable and is not asked again.
    expect(await f.pass()).toBeNull()
    expect((await f.lane()).active_command).toBe((await f.run(second.id)).last_command_id)
    expect(await status_of(f, buy.id)).toBe('completed')
    for (const run of [first.id, second.id]) expect(['active', 'waiting']).toContain((await f.run(run)).status)
    expect(await status_of(f, signing.id)).toBe('completed')
    expect(f.errors).toEqual([])
    // The next direct command releases the settled one.
    const next = await direct(f, character.id, 'next')
    expect((await f.lane()).direct).toBe(next.id)
    expect(await status_of(f, buy.id)).toBeUndefined()
    await f.runtime.stop()
  })

  test('an unknown outcome of a direct command stays uncertain and is never asked to sign again', async () => {
    const f = await fixture()
    const hero = await f.start(character.id)
    const buy = await direct(f, character.id)
    expect(await f.pass()).toMatchObject({ id: buy.id })
    // The submission was lost after signing: the outcome is unknown and the slot is released.
    await put(f.store, `command:${buy.id}`, { ...buy, status: 'uncertain', error: 'Error: connection lost' })
    await put(f.store, f.key, { ...(await f.lane()), active_command: null })
    for (const _ of [1, 2, 3]) expect(await f.pass()).toBeNull()
    expect(await status_of(f, buy.id)).toBe('uncertain')
    expect((await f.lane()).active_command).toBe((await f.run(hero.id)).last_command_id)
    expect(await f.store.scan_keys('command:', 10)).toHaveLength(2)
    await f.runtime.stop()
  })

  test('a pause refuses a direct command cleanly, waiting or new', async () => {
    const f = await fixture()
    await f.start(character.id)
    await f.pass()
    const buy = await direct(f, character.id)
    await f.control.pause(f.grant)
    await expect(direct(f, ally.id, 'paused')).rejects.toThrow('bot_busy_or_paused')
    await put(f.store, f.key, { ...(await f.lane()), active_command: null })
    expect(await f.pass()).toBeNull()
    expect(await f.store.read<Command>(`command:${buy.id}`)).toMatchObject({
      status: 'failed',
      error: 'bot_busy_or_paused',
    })
    expect((await f.lane()).active_command).toBeNull()
    // A resume does not revive it: it was accepted under an older wallet decision.
    expect(await f.pass()).toBeNull()
    expect(await status_of(f, buy.id)).toBe('failed')
    await f.runtime.stop()
  })

  /** A purchase of an item the seed knows: the bot itself reads that item's offers before it signs. */
  const KEY = 'key_of_gilded_lorito'
  const market_asked = (f: Awaited<ReturnType<typeof fixture>>) =>
    f.asked
      .filter(({ payload }) => Object.hasOwn(payload, 'market'))
      .map(({ id: asker, payload }) => [asker, payload.market])

  test('a purchase takes the market view ahead of the heroes, waits for its offers, then gives the view back', async () => {
    const f = await fixture()
    const hero = await f.start(character.id)
    await put(f.store, `behavior:${hero.id}`, { ...(await f.run(hero.id)), prices: { item_type: 'wood', id: 1 } })
    const buy = await direct(f, ally.id, 'buy', KEY)
    // Nothing of the market is read yet: the order asks for its item and does not sign.
    await put(f.store, f.key, { ...(await f.lane()), needs_resync: true })
    expect(await f.pass()).toBeNull()
    const [[asker, view]] = market_asked(f) as [[string, Record<string, unknown>]]
    expect(asker).toBe(buy.id)
    expect(view).toMatchObject({ kind: 'offers', category: 'key', item_type: KEY })
    // The asking hero does not take the view while the order needs it.
    expect(f.asked.filter(({ payload }) => Object.hasOwn(payload, 'prices'))).toEqual([])
    expect(await status_of(f, buy.id)).toBe('accepted')
    // A sweep of another order's view proves nothing; the complete sweep of this one lets it sign.
    const read = (observation: unknown) =>
      ({
        characters: [],
        fights: {},
        inventory: { market: { observation, pages: [{ cursor: '' }], complete: true } },
      }) as unknown as ActorSnapshot
    expect(await f.pass(read({ ...view, request: Number(view.request) + 1 }))).toBeNull()
    await put(f.store, f.key, { ...(await f.lane()), needs_resync: false })
    f.asked.length = 0
    expect(await f.pass(read(view))).toMatchObject({ id: buy.id })
    expect(market_asked(f)).toEqual([[buy.id, null]])
    expect(f.errors).toEqual([])
    await f.runtime.stop()
  })
})

describe('behavior tally', () => {
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
})
