// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import type { AgentStatus, ClientPacket } from '@aresrpg/protocol'

import { owned_run_observation } from '../src/actor_observation.ts'
import type { BehaviorScript } from '../src/behavior_script.ts'
import { empty_lane } from '../src/control.ts'
import { ended_run } from '../src/run_ref.ts'
import { create_status_sharer } from '../src/status_sharer.ts'
import type { ControlStore } from '../src/store.ts'
import { live_value, persistent_value } from '../src/store_projection.ts'

import { fixture_bot } from './helpers/control_fixture.ts'
import { fixture } from './helpers/hero_runs_fixture.ts'
import { character, resource } from './helpers/profession_fixture.ts'

const lane_key = `lane:mainnet:${fixture_bot.address}`
const lane = { ...empty_lane(fixture_bot), lease_until: 60_000 }
const objective = { title: 'Herbalist level 30', description: 'Gather, then craft.', steps: ['Gather plants'] }
const run = {
  id: 'current',
  bot_id: fixture_bot.id,
  lane_key,
  character_id: 'hero',
  status: 'active',
  script: { version: '1', objective, tree: { type: 'wait' } },
}
const command = { id: 'work', bot_id: fixture_bot.id, kind: 'gather', payload: {}, status: 'accepted' }

/** A wallet's records as the sharer reads them; each share reports the status it sent, or none. */
const wallet = (records: Readonly<Record<string, unknown>>) => {
  const rows = new Map<string, unknown>(Object.entries({ [`bot:${fixture_bot.id}`]: fixture_bot, ...records }))
  const sent: AgentStatus[] = []
  let connected = true
  let ready = true
  const sharer = create_status_sharer(
    { read: async (key: string) => rows.get(key) ?? null } as unknown as ControlStore,
    fixture_bot,
    7,
    () => ready,
    () => 1_000,
    () => 10,
    async (packet) => {
      if (!connected) return false
      if (packet.type === 'packet/agent_status') sent.push(packet.status)
      return true
    }
  )
  return {
    connect: (next: boolean) => {
      connected = next
      ready = next
    },
    put: (key: string, value: unknown) => rows.set(key, value),
    share: async (always = false) => {
      const before = sent.length
      await sharer.share(always)
      return sent.length > before ? sent.at(-1)! : null
    },
    observed: sharer.observed,
    sent,
  }
}

test('a hero run is told with its authored objective and issue; an ended run leaves the wallet idle', async () => {
  const w = wallet({ [lane_key]: { ...lane, runs: { hero: 'current' } }, 'behavior:current': run })
  expect(await w.share()).toMatchObject({
    state: 'active',
    runs: [{ id: 'current', character_id: 'hero', status: 'active', objective }],
  })
  w.put('behavior:current', { ...run, status: 'awaiting_ai', issue: 'Supplies unavailable' })
  expect(await w.share()).toMatchObject({
    state: 'awaiting_ai',
    runs: [{ status: 'awaiting_ai', issue: 'Supplies unavailable', objective }],
  })
  w.put('behavior:current', { ...run, status: 'completed' })
  expect(await w.share()).toMatchObject({ state: 'idle', runs: [{ status: 'completed' }] })
  w.put(lane_key, { ...lane, runs: { hero: 'current' }, paused: true })
  expect(await w.share()).toMatchObject({ state: 'paused' })
})

test('the status carries the fees of the wallet and of each run, and sends again when they move', async () => {
  const tallied = { ...run, tally: { fees_mist: '46', dungeon_runs: 2, in_dungeon: false } }
  const hosted = { ...lane, runs: { hero: 'current' } }
  const w = wallet({ [lane_key]: { ...hosted, fees_mist: '69' }, 'behavior:current': tallied })
  expect(await w.share()).toMatchObject({
    fees_mist: '69',
    runs: [{ id: 'current', fees_mist: '46', dungeon_runs: 2 }],
  })
  expect(await w.share()).toBeNull()
  // Another receipt settled: the figures moved, so the owner is told.
  w.put(lane_key, { ...hosted, fees_mist: '92' })
  w.put('behavior:current', { ...tallied, tally: { ...tallied.tally, fees_mist: '69' } })
  expect(await w.share()).toMatchObject({ fees_mist: '92', runs: [{ fees_mist: '69', dungeon_runs: 2 }] })
  // A wallet and a run that paid nothing say zero, never nothing.
  const fresh = wallet({ [lane_key]: hosted, 'behavior:current': run })
  expect(await fresh.share()).toMatchObject({ fees_mist: '0', runs: [{ fees_mist: '0', dungeon_runs: 0 }] })
})

test('a command in flight, a blocked command and an expired lease are told apart from hero work', async () => {
  const w = wallet({ [lane_key]: { ...lane, active_command: 'work' }, 'command:work': command })
  expect(await w.share()).toMatchObject({ state: 'active', runs: [] })
  w.put('command:work', { ...command, waiting_for_resume: true })
  expect(await w.share()).toMatchObject({ state: 'waiting' })
  w.put(lane_key, { ...lane, active_command: 'work', lease_until: 1 })
  expect(await w.share()).toMatchObject({ state: 'unavailable' })
  w.put('command:work', null)
  // A lane that names a command it no longer holds is unavailable too.
  w.put(lane_key, { ...lane, active_command: 'work' })
  expect(await w.share(true)).toMatchObject({ state: 'unavailable' })
})

test('an unchanged status is not sent again, except to an owner who just started watching', async () => {
  const w = wallet({ [lane_key]: lane })
  // The baseline became ready: that is told once.
  await w.observed({ type: 'packet/pong' })
  expect(w.sent).toMatchObject([{ ready: true, state: 'idle', sampled_at: 10 }])
  expect(await w.share()).toBeNull()
  await w.observed({ type: 'packet/pong' })
  expect(w.sent).toHaveLength(1)
  await w.observed({ type: 'packet/agent_status_wanted' })
  expect(w.sent).toHaveLength(2)
})

test('a socket that drops and returns is told the status again, though nothing else moved', async () => {
  const w = wallet({ [lane_key]: lane })
  await w.observed({ type: 'packet/pong' })
  expect(w.sent).toMatchObject([{ ready: true, state: 'idle' }])
  // The socket drops: the status that says so cannot leave.
  w.connect(false)
  await w.observed({ type: 'packet/pong' })
  expect(w.sent).toHaveLength(1)
  // It returns with the same wallet state: the new socket still gets its first status.
  w.connect(true)
  await w.observed({ type: 'packet/pong' })
  expect(w.sent).toMatchObject([{ ready: true }, { ready: true, state: 'idle' }])
  // A status that could not leave is not counted as shared.
  w.put(lane_key, { ...lane, paused: true })
  w.connect(false)
  expect(await w.share()).toBeNull()
  w.connect(true)
  expect(await w.share()).toMatchObject({ state: 'paused' })
})

test('overlapping shares run one at a time, and each stamp is taken before its reads', async () => {
  const reads: ReturnType<typeof Promise.withResolvers<null>>[] = []
  const store = {
    read: () => {
      const pending = Promise.withResolvers<null>()
      reads.push(pending)
      return pending.promise
    },
  } as unknown as ControlStore
  let now = 10
  let ready = false
  const sent: ClientPacket[] = []
  const sharer = create_status_sharer(
    store,
    fixture_bot,
    7,
    () => ready,
    () => 0,
    () => now,
    async (packet) => {
      sent.push(packet)
      return true
    }
  )
  const first = sharer.share()
  const second = sharer.share()
  await Promise.resolve()
  // The second share has read nothing: it waits for the first to finish. Each share reads the lane and the bot.
  expect(reads).toHaveLength(2)
  now = 20
  for (const read of reads) read.resolve(null)
  await first
  expect(reads).toHaveLength(4)
  ready = true
  now = 30
  for (const read of reads) read.resolve(null)
  await second
  expect(sent).toMatchObject([
    { type: 'packet/agent_status', status: { ready: false, event_fence: 7, sampled_at: 10 } },
    { type: 'packet/agent_status', status: { ready: true, event_fence: 7, sampled_at: 20 } },
  ])
})

/** A tree that harvests until its hero holds the level it was sent for. The fixture hero already does,
 * so its first tick ends it. `reason` is what its author wrote on the end. */
const until_level = (reason?: string): BehaviorScript => ({
  version: '1',
  objective: { title: 'Reach level 1' },
  tree: {
    type: 'loop',
    child: {
      type: 'selector',
      children: [
        {
          type: 'sequence',
          children: [
            {
              type: 'condition',
              condition: { fact: { type: 'level', character_id: character.id }, op: 'gte', value: 1 },
            },
            { type: 'complete', ...(reason ? { reason } : {}) },
          ],
        },
        {
          type: 'action',
          action: { type: 'gather', character_id: character.id, item_type: resource.item_type, order: 'nearest' },
        },
      ],
    },
  },
})
/** The real control, run tick and store of one wallet, and the owner who watches its pushed status. */
const watched = async () => {
  const f = await fixture()
  const sent: AgentStatus[] = []
  const sharer = create_status_sharer(
    f.store,
    f.bot,
    f.first_fence,
    () => true,
    () => f.clock.now,
    () => 10,
    async (packet) => {
      if (packet.type === 'packet/agent_status') sent.push(packet.status)
      return true
    }
  )
  let started = 0
  return {
    ...f,
    begin: (script: BehaviorScript) => {
      started += 1
      const idempotency_key = `start-${started}`
      return f.control.start_behavior(f.grant, {
        idempotency_key,
        script,
        decision_revision: 0,
        observation_revision: 1,
      })
    },
    /** The status this share sent to the owner, or null when it sent none. */
    share: async (always = false) => {
      const before = sent.length
      await sharer.share(always)
      return sent.length > before ? sent.at(-1)! : null
    },
  }
}

test('a run that ends because its target is reached is told with its reason until its hero starts again', async () => {
  const w = await watched()
  const run = await w.begin(until_level('objective_reached'))
  expect((await w.share())?.runs).toMatchObject([{ id: run.id, status: 'active' }])
  expect(await w.tick(run.id)).toBe('completed')
  // The ended run gave its slot back, and the owner is told why it ended.
  expect((await w.lane()).runs).toEqual({})
  const told = await w.share()
  expect(told).toMatchObject({
    state: 'idle',
    runs: [
      {
        id: run.id,
        character_id: character.id,
        status: 'completed',
        ended: 'objective_reached',
        objective: { title: 'Reach level 1' },
        fees_mist: '0',
      },
    ],
  })
  // Nothing moved: it is not sent twice. An owner who starts watching later is still told.
  expect(await w.share()).toBeNull()
  expect((await w.share(true))?.runs).toEqual(told!.runs)
  // A read of the bot says the same, and a restart of the bot keeps it.
  const read = await owned_run_observation(w.store, await w.lane(), { bot_id: w.bot.id })
  expect(read.runs).toMatchObject([{ id: run.id, status: 'completed', ended: 'objective_reached' }])
  const stored = persistent_value(w.key, await w.lane())
  expect(live_value(w.key, stored)).toMatchObject({ ended: { [run.id]: 'objective_reached' } })
  // The hero starts again: its last ending is no longer told.
  const again = await w.begin(until_level('objective_reached'))
  expect((await w.lane()).ended).toEqual({})
  const restarted = (await w.share())!.runs
  expect(restarted).toMatchObject([{ id: again.id, status: 'active' }])
  expect(restarted[0]).not.toHaveProperty('ended')
  await w.runtime.stop()
})

test('every ending a tree reaches by itself is one listed code; a run the player stopped is told none', async () => {
  const endings = async (reason?: string) => {
    const w = await watched()
    const run = await w.begin(until_level(reason))
    await w.tick(run.id)
    const { runs } = (await w.share())!
    await w.runtime.stop()
    return runs.map(({ ended }) => ended)
  }
  expect(await endings('fee_cap_reached')).toEqual(['fee_cap_reached'])
  expect(await endings('run_cap_reached')).toEqual(['run_cap_reached'])
  // An authored end with no reason, or with words of its author's own, is a plain completion.
  expect(await endings()).toEqual(['completed'])
  expect(await endings('The bag is full, I am going home')).toEqual(['completed'])
  // The player stops a playing run: the next queue pass frees its slot, and no ending is told.
  const w = await watched()
  await w.begin(until_level('objective_reached'))
  await w.control.stop_behavior(w.grant, character.id)
  await w.pass()
  expect(await w.share()).toMatchObject({ runs: [] })
  expect((await w.lane()).ended ?? {}).toEqual({})
  // A stop written on a run that already ended by itself takes its ending back.
  const run = await w.begin(until_level('objective_reached'))
  await w.tick(run.id)
  expect((await w.share())?.runs).toMatchObject([{ ended: 'objective_reached' }])
  await w.control.stop_behavior(w.grant, character.id)
  expect(await w.share()).toMatchObject({ runs: [] })
  await w.runtime.stop()
})

test('only an authored end names an ending: a live run keeps its slot, and a stop or a pause frees it unexplained', () => {
  const lane = {
    runs: { hero: 'run', ally: 'other' },
    run_commands: { 'behavior:run': 'command' },
    ended: { earlier: 'completed' },
  } as const
  const freed = { runs: { ally: 'other' }, run_commands: {}, ended: { earlier: 'completed' } }
  // A run that plays, waits, or waits for its author still holds its hero.
  for (const status of ['active', 'waiting', 'awaiting_ai'])
    expect(ended_run(lane, 'run', { status, issue: 'objective_reached' })).toEqual({})
  for (const status of ['stopped', 'paused', 'failed'])
    expect(ended_run(lane, 'run', { status, issue: 'objective_reached' })).toEqual(freed)
  expect(ended_run(lane, 'run', { status: 'completed', issue: 'run_cap_reached' })).toEqual({
    ...freed,
    ended: { earlier: 'completed', run: 'run_cap_reached' },
  })
})
