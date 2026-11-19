// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import type { AgentStatus, ClientPacket } from '@aresrpg/protocol'

import { empty_lane } from '../src/control.ts'
import { create_status_sharer } from '../src/status_sharer.ts'
import type { ControlStore } from '../src/store.ts'

import { fixture_bot } from './helpers/control_fixture.ts'

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
