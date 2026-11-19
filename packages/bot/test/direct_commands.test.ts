// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import type { Command } from '../src/control.ts'
import { refresh_run_command, stale_run_draft } from '../src/run_refresh.ts'
import { owned_run_observation } from '../src/actor_observation.ts'
import type { ActorSnapshot } from '../src/actor_snapshot.ts'
import { id } from '../../sdk/test/helpers/transport.ts'

import { put } from './helpers/control_fixture.ts'
import { character } from './helpers/profession_fixture.ts'
import { character as fighter, row_of, started, fight_id } from './helpers/combat_runtime_fixture.ts'
import { ally, context, fixture } from './helpers/hero_runs_fixture.ts'

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

test('a waiting direct command signs after the hero whose turn another wallet could pass', async () => {
  const f = await fixture()
  const active = started()
  const rival = structuredClone(active.contract.fighters[0]!)
  if (rival.kind.type !== 'player') throw new Error('invalid fixture')
  Object.assign(rival.kind, { owner: id(66), character: id(67) })
  active.contract.fighters.push(rival)
  const contested = { characters: [fighter()], fights: { [fight_id]: row_of(active) } } as unknown as ActorSnapshot
  const [ring, urgent] = [await f.start(character.id), await f.start(fighter().id)]
  const buy = await direct(f, character.id)
  // Nobody can sign, so one pass asks every entry in signing order.
  await put(f.store, f.key, { ...(await f.lane()), needs_resync: true })
  expect(await f.pass(contested)).toBeNull()
  expect(f.asked.map(({ id: asked }) => asked)).toEqual([`behavior:${urgent.id}`, buy.id, `behavior:${ring.id}`])
  expect(await status_of(f, buy.id)).toBe('accepted')
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

test('a direct command in the slot binds to a newer observation instead of failing', async () => {
  const f = await fixture()
  const buy = await direct(f, character.id)
  const admitted = (await f.pass())!
  // An observation lands between taking the slot and the validation.
  await f.control.observed(f.key, 'actor', f.first_fence, true)
  const lane = await f.lane()
  expect(stale_run_draft(admitted, lane, new Error('needs_resync'))).toBe(true)
  const fresh = await refresh_run_command(
    f.store,
    f.options.config,
    { command: admitted, actor_id: 'actor', fence: f.first_fence },
    context(lane.observation_revision),
    f.clock.now
  )
  expect(fresh).toMatchObject({ id: buy.id, status: 'accepted', observation_revision: lane.observation_revision })
  expect(fresh!.payload).toEqual(buy.payload)
  expect(stale_run_draft(fresh!, lane, new Error('needs_resync'))).toBe(false)
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

test('stopping one hero does not cancel the waiting direct command of another', async () => {
  const f = await fixture()
  const [first] = [await f.start(character.id), await f.start(ally.id)]
  await f.pass()
  const buy = await direct(f, ally.id)
  await f.control.stop_behavior(f.grant, character.id)
  await f.control.stop_behavior(f.grant, ally.id)
  await f.settle(first.id)
  expect(await f.pass()).toMatchObject({ id: buy.id })
  expect(await f.lane()).toMatchObject({ runs: {}, active_command: buy.id })
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

test('a purchase refuses itself when another connector holds the market view', async () => {
  const f = await fixture()
  const buy = await direct(f, character.id, 'buy', KEY)
  expect(
    await f.pass(undefined, async () => {
      throw new Error('OBSERVATION_SLOT_BUSY')
    })
  ).toBeNull()
  expect(await f.store.read<Command>(`command:${buy.id}`)).toMatchObject({
    status: 'failed',
    error: 'market_unavailable',
  })
  // Any other failure to reach the game leaves the order waiting, and is reported.
  const retry = await direct(f, character.id, 'retry', KEY)
  await f.pass(undefined, async () => {
    throw new Error('ACTOR_TERMINAL')
  })
  expect(await status_of(f, retry.id)).toBe('accepted')
  expect(f.errors.map(String)).toEqual(['Error: ACTOR_TERMINAL'])
  await f.runtime.stop()
})
