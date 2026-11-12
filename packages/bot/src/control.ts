// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { FightStateRow } from '@aresrpg/protocol'

import type { ActionBaseline } from './action_reconciliation.ts'
import type { FightReplay } from './fight_runtime.ts'
import { assert_live_grant, type Bot, type BotConfig, type Grant } from './model.ts'
import { parse_gameplay_action, type GameplayActionName } from './gameplay.ts'
import { create_profession_control } from './profession_control.ts'
import { hash_secret } from './security.ts'
import type { ControlStore } from './store.ts'

export type Envelope = Readonly<{
  command_id: string
  grant_id: string
  digest: string
  phase: 'prepared' | 'signed' | 'submitting'
  encrypted: string
  gas_budget_mist: string
  include?: object
  gas_scope?: string
  gas_payer?: string
}>
export type Lane = Readonly<{
  reconciliation_command?: string | null
  transport_stopped?: boolean
  fight_replays?: Readonly<Record<string, FightReplay>>
  network: 'mainnet'
  address: string
  actor_id: string
  fence: number
  lease_until: number
  decision_revision: number
  observation_revision: number
  observed_at: number
  needs_resync: boolean
  paused: boolean
  profession_run_id?: string | null
  active_command: string | null
  pending: Envelope | null
}>
export type Command = Readonly<{
  waiting_for_resume?: boolean
  action_baseline?: ActionBaseline
  fight_baseline?: FightStateRow
  profession_run_id?: string
  id: string
  grant_id: string
  bot_id: string
  lane_key: string
  fingerprint: string
  kind: 'observe' | GameplayActionName
  payload: Readonly<Record<string, unknown>>
  decision_revision: number
  observation_revision: number
  status: 'accepted' | 'executing' | 'completed' | 'failed' | 'uncertain' | 'cancelled'
  result?: unknown
  error?: string
}>
export const lane_key_for = (bot: Pick<Bot, 'network' | 'address'>) => `lane:${bot.network}:${bot.address}`
export const empty_lane = (bot: Pick<Bot, 'network' | 'address'>): Lane => ({
  network: bot.network,
  address: bot.address,
  actor_id: '',
  fence: 0,
  lease_until: 0,
  decision_revision: 0,
  observation_revision: 0,
  observed_at: 0,
  needs_resync: true,
  paused: false,
  active_command: null,
  pending: null,
})
export const assert_lease = (lane: Lane | null, actor_id: string, fence: number, now: number): Lane => {
  if (!lane || lane.actor_id !== actor_id || lane.fence !== fence || lane.lease_until <= now)
    throw new Error('actor_fenced')
  return lane
}
export const lane_owned_elsewhere = (lane: Lane | null, actor_id: string, now: number): lane is Lane =>
  Boolean(lane && lane.actor_id !== actor_id && lane.lease_until > now)

export type Observe = (
  grant: Grant,
  payload: Readonly<Record<string, unknown>>,
  expected?: Readonly<{ actor_id: string; fence: number }>
) => Promise<unknown>
export const create_control_service = (
  store: ControlStore,
  config: BotConfig,
  freshness_ms: number,
  now = Date.now,
  read_observation: Observe = async () => {
    throw new Error('observation_unavailable')
  }
) => {
  const observe: Observe = async (grant, payload) => {
    const current = await store.read<Grant>(`grant:${grant.id}`)
    if (!current || current.bot_id !== grant.bot_id || current.address !== grant.address)
      throw new Error('invalid_token')
    assert_live_grant(config, current, await store.read<Bot>(`bot:${current.bot_id}`), now())
    if (!current.scopes.includes('bot:observe')) throw new Error('insufficient_scope')
    return read_observation(current, payload)
  }
  const acquire = async (bot: Bot, actor_id: string, lease_ms: number) => {
    const key = lane_key_for(bot)
    return store.transaction([key], async (tx) => {
      const previous = (await tx.get<Lane>(key)) ?? empty_lane(bot)
      if (previous.lease_until > now() && previous.actor_id !== actor_id) throw new Error('actor_owned')
      const lane = {
        ...previous,
        actor_id,
        fence: previous.fence + 1,
        lease_until: now() + lease_ms,
        needs_resync: true,
      }
      await tx.put(key, lane)
      return lane
    })
  }
  const heartbeat = async (key: string, actor_id: string, fence: number, lease_ms: number) =>
    store.transaction([key], async (tx) => {
      const lane = assert_lease(await tx.get<Lane>(key), actor_id, fence, now())
      await tx.put(key, { ...lane, lease_until: now() + lease_ms })
    })
  const observed = async (key: string, actor_id: string, fence: number, ready: boolean, changed = true) =>
    store.transaction([key], async (tx) => {
      const lane = assert_lease(await tx.get<Lane>(key), actor_id, fence, now())
      await tx.put(key, {
        ...lane,
        observation_revision: lane.observation_revision + Number(changed),
        observed_at: now(),
        needs_resync: [!ready, lane.reconciliation_command, lane.transport_stopped].some(Boolean),
      })
    })
  const accept = async (
    grant: Grant,
    input: Readonly<{
      idempotency_key: string
      kind: Command['kind']
      payload: Readonly<Record<string, unknown>>
      decision_revision: number
      observation_revision: number
    }>
  ) => {
    if (!input.idempotency_key) throw new Error('invalid_action')
    if (input.kind === 'observe') throw new Error('invalid_action')
    parse_gameplay_action(input.kind, input.payload)
    const id = hash_secret(`${grant.id}:${input.idempotency_key}`)
    const lane_key = lane_key_for(grant)
    const fingerprint = hash_secret(JSON.stringify(input))
    return store.transaction([`grant:${grant.id}`, `bot:${grant.bot_id}`, lane_key, `command:${id}`], async (tx) => {
      const current = await tx.get<Grant>(`grant:${grant.id}`)
      if (!current) throw new Error('invalid_token')
      const bot = await tx.get<Bot>(`bot:${grant.bot_id}`)
      assert_live_grant(config, current, bot, now())
      const prior = await tx.get<Command>(`command:${id}`)
      if (prior) {
        if (prior.fingerprint !== fingerprint) throw new Error('idempotency_conflict')
        return prior
      }
      const lane = (await tx.get<Lane>(lane_key)) ?? empty_lane(grant)
      admit_command(current, lane, input, now(), freshness_ms)
      const revision = lane.decision_revision + 1
      const command: Command = {
        id,
        grant_id: grant.id,
        bot_id: grant.bot_id,
        lane_key,
        fingerprint,
        kind: input.kind,
        payload: input.payload,
        decision_revision: revision,
        observation_revision: lane.observation_revision,
        status: 'accepted',
      }
      await tx.put(`command:${id}`, command)
      await tx.put(lane_key, { ...lane, decision_revision: command.decision_revision, active_command: command.id })
      return command
    })
  }
  const status = async (grant: Grant, id: string) => {
    const command = await store.read<Command>(`command:${id}`)
    if (!command || command.grant_id !== grant.id || command.bot_id !== grant.bot_id)
      throw new Error('command_not_found')
    return command
  }
  const pause = async (grant: Grant) => {
    const key = lane_key_for(grant)
    await store.transaction([key, `grant:${grant.id}`, `bot:${grant.bot_id}`], async (tx) => {
      const current = await tx.get<Grant>(`grant:${grant.id}`)
      if (!current) throw new Error('invalid_token')
      if (!current.scopes.includes('bot:pause')) throw new Error('insufficient_scope')
      assert_live_grant(config, current, await tx.get<Bot>(`bot:${grant.bot_id}`), now())
      const lane = (await tx.get<Lane>(key)) ?? empty_lane(grant)
      await tx.put(key, { ...lane, paused: true, decision_revision: lane.decision_revision + 1 })
    })
    return { paused: true, notice: 'Already signed or submitted transactions may still settle.' }
  }
  const resume = async (grant: Grant, decision_revision: number, observation_revision: number) => {
    const key = lane_key_for(grant)
    await store.transaction([key, `grant:${grant.id}`, `bot:${grant.bot_id}`], async (tx) => {
      const current = await tx.get<Grant>(`grant:${grant.id}`)
      if (!current) throw new Error('invalid_token')
      assert_live_grant(config, current, await tx.get<Bot>(`bot:${grant.bot_id}`), now())
      if (!current.scopes.includes('bot:pause')) throw new Error('insufficient_scope')
      const lane = (await tx.get<Lane>(key)) ?? empty_lane(grant)
      const unsafe = [
        lane.pending,
        lane.active_command,
        lane.needs_resync,
        lane.lease_until <= now(),
        lane.observed_at + freshness_ms <= now(),
        lane.decision_revision !== decision_revision,
        lane.observation_revision !== observation_revision,
      ]
      if (unsafe.some(Boolean)) throw new Error('needs_resync_or_reconciliation')
      await tx.put(key, { ...lane, paused: false, decision_revision: lane.decision_revision + 1 })
    })
    return { paused: false }
  }
  return {
    observe,
    acquire,
    heartbeat,
    observed,
    accept,
    status,
    pause,
    resume,
    ...create_profession_control(store, config, now, observe),
  }
}
export const admit_command = (
  grant: Grant,
  lane: Lane,
  input: Readonly<{
    kind: Command['kind']
    decision_revision: number
    observation_revision: number
  }>,
  now: number,
  freshness_ms: number
) => {
  if (input.kind === 'observe') throw new Error('invalid_action')
  if (!grant.scopes.includes('bot:play')) throw new Error('insufficient_scope')
  if ([lane.paused, lane.active_command, lane.pending, lane.profession_run_id].some(Boolean))
    throw new Error('bot_busy_or_paused')
  if (
    [
      lane.needs_resync,
      lane.observed_at + freshness_ms <= now,
      lane.lease_until <= now,
      input.decision_revision !== lane.decision_revision,
      input.observation_revision !== lane.observation_revision,
    ].some(Boolean)
  )
    throw new Error('needs_resync')
}
