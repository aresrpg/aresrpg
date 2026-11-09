// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { randomUUID } from 'node:crypto'

import { lane_key_for, lane_owned_elsewhere, type Lane, type Observe } from './control.ts'
import { assert_live_grant, type Bot, type BotConfig, type Grant } from './model.ts'
import type { ControlStore } from './store.ts'

type Request = Readonly<{
  type: 'request'
  id: string
  sender: string
  actor_id: string
  grant_id: string
  fence: number
  deadline: number
  payload: Readonly<Record<string, unknown>>
}>
type Outcome = Readonly<{ ok: true; value: unknown }> | Readonly<{ ok: false; error: string }>
type Reply = Readonly<{ type: 'reply'; id: string; sender: string; fence: number; outcome: Outcome }>
type Bus = Readonly<{
  publish: (channel: string, message: string) => Promise<number>
  subscribe: (channel: string, listener: (message: string, channel: string) => void) => Promise<unknown>
  unsubscribe: (channel: string) => Promise<unknown>
}>
const topic = (actor: string) => `bot:observations:${actor}`
const pending_read = () => ({ status: 'pending' })
const message_error = (error: unknown) => (error instanceof Error ? error.message : String(error))
const acquire_race = (error: unknown) =>
  ['actor_owned', 'control_transaction_conflict', 'actor_fenced'].includes(message_error(error))
const decode = (raw: string): Request | Reply => {
  const message = JSON.parse(raw) as Request | Reply
  if (
    ![typeof message.id === 'string', typeof message.sender === 'string', Number.isSafeInteger(message.fence)].every(
      Boolean
    )
  )
    throw new Error('invalid_observation_message')
  if (message.type === 'reply') return message
  if (
    message.type !== 'request' ||
    ![
      typeof message.actor_id === 'string',
      typeof message.grant_id === 'string',
      Number.isFinite(message.deadline),
      message.payload !== null,
      typeof message.payload === 'object',
      !Array.isArray(message.payload),
    ].every(Boolean)
  )
    throw new Error('invalid_observation_message')
  return message
}

/** Ephemeral reads only. Redis CAS, leases and journals remain the admission authority.
 * This fails if recovery reopens gameplay after takeover or a reply bypasses current ownership/grant. */
export const create_observation_router = async (
  options: Readonly<{
    store: ControlStore
    config: BotConfig
    actor_id: string
    local: Observe
    publisher: Pick<Bus, 'publish'>
    subscriber: Pick<Bus, 'subscribe' | 'unsubscribe'>
    timeout_ms: number
    now?: () => number
    report_failure: (error: unknown) => void
  }>
) => {
  const now = options.now ?? Date.now
  const awaiting = new Map<string, { owner: string; fence: number; resolve: (value: Outcome) => void }>()
  const serving = new Set<Promise<void>>()
  const lifetime = new AbortController()
  let subscribed = false
  const ready = () => subscribed && !lifetime.signal.aborted
  const bounded = async <T>(operation: Promise<T>, deadline: number): Promise<T> => {
    let timer: ReturnType<typeof setTimeout> | undefined
    let cancel = () => undefined as void
    const expiration = new Promise<never>((_resolve, reject) => {
      cancel = () => reject(new Error('observation_unavailable'))
      lifetime.signal.addEventListener('abort', cancel, { once: true })
      timer = setTimeout(() => reject(new Error('observation_timeout')), Math.max(0, deadline - now()))
      if (!ready()) cancel()
    })
    try {
      return await Promise.race([operation, expiration])
    } finally {
      clearTimeout(timer)
      lifetime.signal.removeEventListener('abort', cancel)
    }
  }
  const live = async (id: string) => {
    const grant = await options.store.read<Grant>(`grant:${id}`)
    const bot = grant ? await options.store.read<Bot>(`bot:${grant.bot_id}`) : null
    if (!grant || !bot) throw new Error('invalid_token')
    assert_live_grant(options.config, grant, bot, now())
    if (!grant.scopes.includes('bot:observe')) throw new Error('insufficient_scope')
    return { grant, bot }
  }
  const current_lane = async (bot: Bot) => {
    const lane = await options.store.read<Lane>(lane_key_for(bot))
    if (lane?.transport_stopped) throw new Error('ACTOR_TERMINAL')
    return lane
  }
  const owner_matches = async (bot: Bot, actor: string, fence: number) => {
    const lane = await current_lane(bot)
    return [lane?.actor_id === actor, lane?.fence === fence, (lane?.lease_until ?? 0) > now()].every(Boolean)
  }
  const reply = async (request: Request, outcome: Outcome) => {
    if (!ready() || now() >= request.deadline) return
    await bounded(
      options.publisher.publish(
        topic(request.sender),
        JSON.stringify({
          type: 'reply',
          id: request.id,
          sender: options.actor_id,
          fence: request.fence,
          outcome,
        } satisfies Reply)
      ),
      request.deadline
    )
  }
  const serve_value = async (request: Request) => {
    const { grant, bot } = await live(request.grant_id)
    if (!(await owner_matches(bot, options.actor_id, request.fence))) return pending_read()
    if (!ready()) throw new Error('observation_unavailable')
    const value = await options.local(grant, request.payload, { actor_id: request.actor_id, fence: request.fence })
    await live(request.grant_id)
    return (await owner_matches(bot, options.actor_id, request.fence)) ? value : pending_read()
  }
  const serve = async (request: Request) => {
    if (request.actor_id !== options.actor_id || request.deadline <= now()) return
    // A peer cannot extend this process's transport deadline.
    const deadline = Math.min(request.deadline, now() + options.timeout_ms)
    let outcome: Outcome
    try {
      outcome = { ok: true, value: await bounded(serve_value(request), deadline) }
    } catch (error) {
      options.report_failure(error)
      outcome = { ok: false, error: message_error(error) }
    }
    await reply({ ...request, deadline }, outcome)
  }
  const receive = (raw: string) => {
    if (!ready()) return
    try {
      const message = decode(raw)
      if (message.type === 'reply') {
        const waiting = awaiting.get(message.id)
        if (waiting?.owner === message.sender && waiting.fence === message.fence) waiting.resolve(message.outcome)
        return
      }
      const task = serve(message)
        .catch(options.report_failure)
        .finally(() => {
          serving.delete(task)
        })
      serving.add(task)
    } catch (error) {
      options.report_failure(error)
    }
  }
  await options.subscriber.subscribe(topic(options.actor_id), receive)
  subscribed = true
  const remote = async (grant: Grant, payload: Readonly<Record<string, unknown>>, lane: Lane) => {
    const id = randomUUID()
    const deadline = Math.min(lane.lease_until, now() + options.timeout_ms)
    const response = new Promise<Outcome>((resolve) => {
      awaiting.set(id, { owner: lane.actor_id, fence: lane.fence, resolve })
    })
    const exchange = async () => {
      const receivers = await options.publisher.publish(
        topic(lane.actor_id),
        JSON.stringify({
          type: 'request',
          id,
          sender: options.actor_id,
          actor_id: lane.actor_id,
          grant_id: grant.id,
          fence: lane.fence,
          deadline,
          payload,
        } satisfies Request)
      )
      if (receivers === 0) throw new Error('observation_unavailable')
      const outcome = await response
      const { bot } = await live(grant.id)
      if (!(await owner_matches(bot, lane.actor_id, lane.fence))) return pending_read()
      if (!outcome.ok) throw new Error(outcome.error)
      return outcome.value
    }
    try {
      return await bounded(exchange(), deadline)
    } finally {
      awaiting.delete(id)
    }
  }
  const foreign = (lane: Lane | null): lane is Lane => lane_owned_elsewhere(lane, options.actor_id, now())
  const read: Observe = async (grant, payload) => {
    if (!ready()) throw new Error('observation_unavailable')
    const current = await live(grant.id)
    if (![current.grant.bot_id === grant.bot_id, current.grant.address === grant.address].every(Boolean))
      throw new Error('invalid_token')
    const lane = await current_lane(current.bot)
    if (foreign(lane)) return remote(current.grant, payload, lane)
    try {
      const value = await options.local(current.grant, payload)
      await live(grant.id)
      await current_lane(current.bot)
      if (!ready()) throw new Error('observation_unavailable')
      return value
    } catch (error) {
      if (!acquire_race(error)) throw error
      // Losing acquisition never replays a mutation or steals a live lease.
      const winner = await current_lane(current.bot)
      if (foreign(winner)) return remote(current.grant, payload, winner)
      throw error
    }
  }
  return {
    observe: ((grant, payload) => bounded(read(grant, payload), now() + options.timeout_ms)) as Observe,
    ready,
    fail: () => lifetime.abort(),
    stop: async () => {
      lifetime.abort()
      for (const wait of awaiting.values()) wait.resolve({ ok: false, error: 'observation_unavailable' })
      awaiting.clear()
      await Promise.all([...serving])
      if (!subscribed) return
      subscribed = false
      await options.subscriber.unsubscribe(topic(options.actor_id))
    },
  }
}
