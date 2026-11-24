// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { FightStateRow, RunEnding } from '@aresrpg/protocol'
import type { Receipt } from '@aresrpg/sdk/cache'

import { create_behavior_control } from './behavior_control.ts'
import type { ActionBaseline } from './action_reconciliation.ts'
import type { FightReplay } from './fight_runtime.ts'
import {
  authorize,
  CONTROL_SCOPES,
  control_method,
  hash_secret,
  type Bot,
  type BotConfig,
  type ControlMethod,
  type Grant,
} from './model.ts'
import { parse_gameplay_action, type GameplayActionName } from './gameplay.ts'
import { lane_key_for, public_command, queue_command } from './command_admission.ts'
import { create_combat_control } from './combat_control.ts'
import type { ControlStore } from './store.ts'

export { admit_command, lane_key_for } from './command_admission.ts'

export type Envelope = Readonly<{
  command_id: string
  grant_id: string
  digest: string
  phase: 'prepared' | 'signed' | 'submitting'
  bytes: string
  signatures?: readonly string[]
  gas_budget_mist: string
  include?: object
  gas_scope?: string
  gas_payer?: string
}>
export type Lane = Readonly<{
  execution_busy?: boolean
  /** One behavior run per character: character ID to run ID. */
  runs?: Readonly<Record<string, string>>
  /** Run key to the last command that run admitted. */
  run_commands?: Readonly<Record<string, string>>
  /** The runs that ended by themselves, each with its reason: run ID to ending. One stays told to the
   * owner until its hero starts again. Stored with the lane. */
  ended?: Readonly<Record<string, RunEnding>>
  /** The wallet's one direct command: a one-shot queue entry until it takes the signing slot, then
   * readable until the next direct command is accepted. */
  direct?: string | null
  reconciliation_command?: string | null
  fight_replays?: Readonly<Record<string, FightReplay>>
  catalogue_receipts?: Readonly<Record<string, Readonly<{ digest: string; version: string; command_id: string }>>>
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
  active_command: string | null
  /** The last admitted command; it stays readable until the lane admits the next one. */
  latest_command?: string | null
  pending: Envelope | null
  /** Net network fees of every receipt this wallet's bot settled, in MIST. Stored with the lane and never reset. */
  fees_mist?: string
}>
/** An interface, so the gameplay catalogue it names can describe the context that holds it. */
export interface Command {
  /** The hero run that issued this command; absent on a direct command. */
  readonly run_id?: string
  readonly behavior_binding?: Readonly<{ revision: number; node: string }>
  readonly waiting_for_resume?: boolean
  readonly action_baseline?: ActionBaseline
  readonly fight_baseline?: FightStateRow
  readonly id: string
  readonly grant_id: string
  readonly bot_id: string
  readonly lane_key: string
  readonly fingerprint: string
  readonly kind: 'observe' | GameplayActionName
  readonly payload: Readonly<Record<string, unknown>>
  readonly decision_revision: number
  readonly observation_revision: number
  readonly status: 'accepted' | 'executing' | 'completed' | 'failed' | 'uncertain' | 'cancelled'
  readonly result?: unknown
  /** The certified receipt, settled with result; process-local and never returned to a client. */
  readonly receipt?: Receipt
  readonly error?: string
  /** The SUI balance a funding refusal was judged against; its run waits until the wallet holds more. */
  readonly funding_balance_mist?: string
  /** When a command was refused before submission, at no gas cost; its run may try again on a clock. */
  readonly refused_at?: number
}
/** Existing envelope/command work precedes objectives which depend on its reconciliation. */
export const lane_work_key = (key: string, lane: Lane | null): string => {
  const command_id = lane?.pending?.command_id ?? lane?.active_command
  return command_id ? `command:${command_id}` : key
}
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

/** A control operation run at the process that owns the wallet's lane. */
export type OwnerControl = (grant: Grant, method: ControlMethod, args: readonly unknown[]) => Promise<unknown>
type OwnerExpectation = Readonly<{ actor_id: string; fence: number; deadline: number }>
export type LocalOwnerControl = (
  grant: Grant,
  method: ControlMethod,
  args: readonly unknown[],
  expected: OwnerExpectation
) => Promise<unknown>
// Durable stop authority and static validation do not require a live actor. Stop writes only its
// hero's run record. Pause writes the lane on purpose: it fences the whole wallet, so the only
// in-flight transition its write can refuse is one that a paused wallet refuses anyway. Observation
// has its own route.
const LOCAL_METHODS: readonly string[] = ['observe', 'pause', 'stop_behavior', 'validate_behavior']
const route_owner_controls = <T extends object>(local: T, route?: OwnerControl): T => {
  if (!route) return local
  return Object.fromEntries(
    Object.entries(local).map(([method, operation]) => [
      method,
      control_method(method) && !LOCAL_METHODS.includes(method)
        ? (grant: Grant, ...args: readonly unknown[]) => route(grant, method, args)
        : operation,
    ])
  ) as T
}
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
  },
  routed_control?: OwnerControl
) => {
  const observe: Observe = async (grant, payload) => {
    const current = await authorize(store.read, config, grant, CONTROL_SCOPES.observe, now())
    return read_observation(current.grant, payload)
  }
  const acquire = async (bot: Bot, actor_id: string, lease_ms: number) => {
    const key = lane_key_for(bot)
    return store.transaction([key], async (tx) => {
      const previous = (await tx.get<Lane>(key)) ?? empty_lane(bot)
      if (previous.lease_until > now() && previous.actor_id !== actor_id) throw new Error('actor_owned')
      const lane = {
        ...previous,
        execution_busy: false,
        active_command: null,
        pending: null,
        reconciliation_command: null,
        run_commands: undefined,
        direct: null,
        fight_replays: undefined,
        catalogue_receipts: undefined,
        observed_at: 0,
        decision_revision: previous.decision_revision + Number(previous.fence > 0),
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
        needs_resync: [!ready, lane.reconciliation_command].some(Boolean),
      })
    })
  const accept = async (
    grant: Grant,
    input: Readonly<{
      idempotency_key: string
      kind: GameplayActionName
      payload: Readonly<Record<string, unknown>>
      decision_revision: number
      observation_revision: number
    }>
  ) => {
    parse_gameplay_action(input.kind, input.payload)
    const id = hash_secret(`${grant.id}:${input.idempotency_key}`)
    const lane_key = lane_key_for(grant)
    const fingerprint = hash_secret(JSON.stringify(input))
    // The held command's key is locked with the lane; a lane that names another one by then is busy.
    const held = (await store.read<Lane>(lane_key))?.direct
    const keys = [`grant:${grant.id}`, `bot:${grant.bot_id}`, lane_key, `command:${id}`]
    return store.transaction(held ? [...keys, `command:${held}`] : keys, async (tx) => {
      const { grant: current } = await authorize(tx.get, config, grant, CONTROL_SCOPES.accept, now())
      const prior = await tx.get<Command>(`command:${id}`)
      if (prior) {
        if (prior.fingerprint !== fingerprint) throw new Error('idempotency_conflict')
        return public_command(prior)
      }
      const lane = (await tx.get<Lane>(lane_key)) ?? empty_lane(grant)
      if (lane.direct && lane.direct !== held) throw new Error('bot_busy_or_paused')
      const waiting = held ? await tx.get<Command>(`command:${held}`) : null
      queue_command(current, lane, waiting, input, now(), freshness_ms)
      // Like a hero's run, a queued command never advances the wallet decision: it must not fence a neighbour.
      const command: Command = {
        id,
        grant_id: grant.id,
        bot_id: grant.bot_id,
        lane_key,
        fingerprint,
        kind: input.kind,
        payload: input.payload,
        decision_revision: lane.decision_revision,
        observation_revision: lane.observation_revision,
        status: 'accepted',
      }
      await tx.put(`command:${id}`, command)
      await tx.put(lane_key, { ...lane, direct: command.id })
      return command
    })
  }
  const status = async (grant: Grant, id: string) => {
    await authorize(store.read, config, grant, CONTROL_SCOPES.status, now())
    const command = await store.read<Command>(`command:${id}`)
    if (!command || command.grant_id !== grant.id || command.bot_id !== grant.bot_id)
      throw new Error('command_not_found')
    return public_command(command)
  }
  const pause = async (grant: Grant) => {
    const key = lane_key_for(grant)
    await store.transaction([key, `grant:${grant.id}`, `bot:${grant.bot_id}`], async (tx) => {
      await authorize(tx.get, config, grant, CONTROL_SCOPES.pause, now())
      const lane = (await tx.get<Lane>(key)) ?? empty_lane(grant)
      await tx.put(key, { ...lane, paused: true, decision_revision: lane.decision_revision + 1 })
    })
    return { paused: true, notice: 'Already signed or submitted transactions may still settle.' }
  }
  const resume = async (grant: Grant, decision_revision: number, observation_revision: number) => {
    const key = lane_key_for(grant)
    await store.transaction([key, `grant:${grant.id}`, `bot:${grant.bot_id}`], async (tx) => {
      await authorize(tx.get, config, grant, CONTROL_SCOPES.resume, now())
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
  return route_owner_controls(
    {
      observe,
      acquire,
      heartbeat,
      observed,
      accept,
      status,
      pause,
      resume,
      ...create_behavior_control(store, config, now),
      ...create_combat_control(config, observe),
    },
    routed_control
  )
}
