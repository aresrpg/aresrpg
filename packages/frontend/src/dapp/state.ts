// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { CharacterRow, ListingRow } from '@aresrpg/protocol'
import type { StrategyScript } from '@aresrpg/protocol/strategies'

import { buy_order, followed_order, order_open, sell_order, type MarketOrder } from './market.ts'
import { account_bag, strongest_first, type DappAccount } from './account.ts'
import { newest_observation, type DappObservation } from './observation.ts'
import {
  advance_haul,
  advance_position,
  finish_position,
  open_position,
  retained_positions,
  sync_positions,
  type DappHaul,
  type DappPosition,
} from './positions.ts'
import { plan_activity, type ActivityPlan, type DappActivity } from './strategies.ts'

export type DappMode = 'basic' | 'advanced'
export type DappView = 'play' | 'market'
export type DappLink = Readonly<
  | { phase: 'idle' }
  | { phase: 'disconnected'; error: string | null }
  | { phase: 'authorizing' }
  | { phase: 'exchanging' }
  // The grant itself lives only in device storage, where every tab and the shared client read it.
  | { phase: 'connected' }
>
export type HeroAction = 'raise_stats' | 'raise_spell'
/** One request to the bot for one hero. `uncertain` waits for an observation; it is never resent. */
export type DappCommand = Readonly<
  (
    | { kind: 'start'; activity: DappActivity; script: StrategyScript }
    | { kind: 'stop' }
    | { kind: 'hero_action'; action: HeroAction; payload: Readonly<Record<string, unknown>> }
  ) & { id: string; hero_id: string; status: 'pending' | 'uncertain' | 'refused'; error: string | null }
>
export type DappState = Readonly<{
  mode: DappMode
  view: DappView
  link: DappLink
  observation: DappObservation | null
  observe_error: string | null
  /** The hero Advanced mode acts on. */
  hero_id: string | null
  /** At most one running position per hero: the local view of that hero's run. */
  positions: readonly DappPosition[]
  haul: DappHaul | null
  /** At most one command per hero, so no hero ever waits for another. */
  commands: Readonly<Record<string, DappCommand>>
  /** The one market order of the bot account; the next one replaces it once it is resolved. */
  order: MarketOrder | null
  /** When the bot last answered a command. Only a read of the bot requested later proves what runs. */
  settled_ms: number
  /** The `settled_ms` a read has proven. While both are equal, a newer pushed status is proof too. */
  proven_ms: number
}>
export type CommandOutcome = Readonly<{ kind: 'done' } | { kind: 'refused'; error: string } | { kind: 'uncertain' }>
export type DappInput = Readonly<
  | { type: 'dapp/mode'; mode: DappMode }
  | { type: 'dapp/view'; view: DappView }
  | { type: 'dapp/link'; link: DappLink }
  | { type: 'dapp/connect' }
  | { type: 'dapp/disconnect' }
  /** `requested_ms` is when this page asked the bot; a status the bot pushed has none. */
  | { type: 'dapp/observed'; observation: DappObservation; requested_ms: number | null; now: number }
  | { type: 'dapp/observe_failed'; error: string }
  | { type: 'dapp/select_hero'; hero_id: string }
  | { type: 'dapp/start'; id: string; activity: DappActivity; hero_ids: readonly string[]; title: string }
  | { type: 'dapp/stop'; id: string; hero_ids: readonly string[] }
  | { type: 'dapp/hero_action'; id: string; hero_id: string; action: HeroAction; payload: DappPayload }
  | { type: 'dapp/command_settled'; hero_id: string; id: string; outcome: CommandOutcome; now: number }
  | { type: 'dapp/buy'; id: string; listing: ListingRow }
  | { type: 'dapp/sell'; id: string; listing: Pick<ListingRow, 'id' | 'item_type' | 'amount' | 'price_mist'> }
  | { type: 'dapp/order_sent'; id: string; outcome: CommandOutcome; now: number }
  | { type: 'dapp/order_dismissed' }
  | { type: 'dapp/dismiss'; position_id: string }
>
type DappPayload = Readonly<Record<string, unknown>>

export const initial_dapp_state = (): DappState => ({
  mode: 'basic',
  view: 'play',
  link: { phase: 'idle' },
  observation: null,
  observe_error: null,
  hero_id: null,
  positions: [],
  haul: null,
  commands: {},
  order: null,
  settled_ms: 0,
  proven_ms: 0,
})

/** A refused command is only a message; any other still waits for the bot or for an observation. */
const unresolved = (command: DappCommand | undefined): command is DappCommand =>
  command !== undefined && command.status !== 'refused'
/** Anything the bot was asked and has not answered for good: a hero's command or the market order. */
export const commands_unresolved = (state: DappState): boolean =>
  Object.values(state.commands).some(unresolved) || order_open(state.order)
export const hero_command = (state: DappState, hero_id: string): DappCommand | null => {
  const command = state.commands[hero_id]
  return unresolved(command) ? command : null
}
export const running_position = (state: DappState, hero_id: string): DappPosition | null =>
  state.positions.find((position) => position.hero_id === hero_id && position.finished_ms === null) ?? null
/** A hero the bot plays, or is being asked about: it shows its activity and a Stop, never a Start. */
export const hero_hosted = (state: DappState, hero_id: string): boolean =>
  running_position(state, hero_id) !== null || hero_command(state, hero_id) !== null
export const selected_hero = (state: DappState, account: DappAccount): CharacterRow | null =>
  account.characters.find(({ id }) => id === state.hero_id) ?? null
const bot_ready = (state: DappState): boolean => state.link.phase === 'connected' && state.observation?.ready === true
/** A direct command the bot still holds. This is the bot's own admission rule: it takes the next one over anything else. */
const HELD: readonly string[] = ['accepted', 'executing']
/** A stat or spell change and a market order are direct commands: the bot holds one at a time and
 * signs it in turn with its heroes, so only another direct request makes the next one wait. The bot's
 * own word counts too: an answered request is still held until the bot says it is over. */
export const direct_free = (state: DappState): boolean =>
  [
    bot_ready(state),
    !HELD.includes(state.observation?.direct?.status ?? ''),
    !order_open(state.order),
    !Object.values(state.commands).some((command) => command.kind === 'hero_action' && unresolved(command)),
  ].every(Boolean)

const EMPTY_PLAN: ActivityPlan = Object.freeze({ starts: [], blocked: [], missing_keys: {} })
/** What one activity offers the heroes in scope: who is out on it, who is free, and the plan for those. */
export const activity_offer = (
  state: DappState,
  account: DappAccount,
  activity: DappActivity,
  hero_ids: readonly string[],
  title: string
) => {
  const scoped = account.characters.filter(({ id }) => hero_ids.includes(id))
  const free = scoped.filter(({ id }) => !hero_hosted(state, id))
  return {
    out: scoped.filter(({ id }) => running_position(state, id)?.activity === activity),
    free,
    sending: scoped.some(({ id }) => {
      const command = state.commands[id]
      return command?.kind === 'start' && command.activity === activity && command.status === 'pending'
    }),
    plan: bot_ready(state)
      ? plan_activity(activity, free, account_bag(account), title, state.mode === 'basic')
      : EMPTY_PLAN,
  }
}

/** Advanced mode starts on the strongest hero; an explicit selection stays while that hero exists. */
const default_hero = (state: DappState, heroes: readonly CharacterRow[]): string | null =>
  heroes.some(({ id }) => id === state.hero_id) ? state.hero_id : (strongest_first(heroes)[0]?.id ?? null)

/** An unknown answer resolves from a fresh observation: a start by its visible run, anything else by itself. */
const resolved_commands = (commands: DappState['commands'], observation: DappObservation): DappState['commands'] =>
  Object.fromEntries(
    Object.entries(commands).flatMap(([hero_id, command]) => {
      if (command.status !== 'uncertain') return [[hero_id, command] as const]
      const unconfirmed = command.kind === 'start' && !observation.runs[hero_id]
      return unconfirmed ? [[hero_id, { ...command, status: 'refused', error: 'start_unconfirmed' }] as const] : []
    })
  )

/** No command was answered since the last read that proved what runs. */
export const observation_proven = (state: DappState): boolean => state.proven_ms === state.settled_ms
/**
 * The newest observation is kept, pushed or read. It is the truth of what runs and of what became of
 * a sent command only once a read requested after the last answered command has proven it: a status
 * pushed before that answer could still miss the command.
 */
const observed = (
  state: DappState,
  input: Extract<DappInput, { type: 'dapp/observed' }>,
  account: DappAccount
): DappState => {
  const { requested_ms, now } = input
  const observation = newest_observation(state.observation, input.observation)
  const proving = requested_ms !== null && input.observation.ready && requested_ms > state.settled_ms
  const next = { ...state, observation, observe_error: null, proven_ms: proving ? state.settled_ms : state.proven_ms }
  if (!observation.ready || !observation_proven(next)) return next
  return {
    ...next,
    positions: retained_positions(sync_positions(state.positions, observation, account.characters, now)),
    commands: resolved_commands(state.commands, observation),
    order: followed_order(state.order, observation, account),
  }
}

const same_rows = <T>(left: readonly T[], right: readonly T[]): boolean =>
  left.length === right.length && left.every((row, index) => row === right[index])
/**
 * The account is pushed by the game server, so every input folds it by value: positions take their
 * heroes' gains, the haul takes the bag's, and Advanced mode keeps a hero that exists. Nothing new
 * in the account returns the same state.
 */
export const account_followed = (state: DappState, account: DappAccount): DappState => {
  if (state.link.phase !== 'connected') return state
  const advanced = state.positions.map((position) => advance_position(position, account.characters))
  const positions = same_rows(advanced, state.positions) ? state.positions : advanced
  const { order } = state
  const haul = advance_haul(
    state.haul,
    account,
    positions.some(({ finished_ms }) => finished_ms === null),
    order?.action === 'market_buy' && order.status !== 'refused' ? order : null
  )
  const hero_id = default_hero(state, account.characters)
  const unchanged = [positions === state.positions, haul === state.haul, hero_id === state.hero_id].every(Boolean)
  return unchanged ? state : { ...state, positions, haul, hero_id }
}

/** A new request answers the previous one: refusals it left on screen are cleared. */
const with_commands = (state: DappState, issued: readonly DappCommand[]): DappState =>
  issued.length
    ? {
        ...state,
        commands: Object.fromEntries(
          [...Object.values(state.commands).filter(unresolved), ...issued].map((command) => [command.hero_id, command])
        ),
      }
    : state

/** A confirmed stop finishes its position; a confirmed start opens one; hero changes leave positions alone. */
const done_positions = (
  state: DappState,
  command: DappCommand,
  now: number,
  heroes: readonly CharacterRow[]
): readonly DappPosition[] => {
  const running = running_position(state, command.hero_id)
  if (command.kind === 'stop')
    return state.positions.map((position) => (position === running ? finish_position(position, now) : position))
  return command.kind === 'start' && !running
    ? [open_position(command.hero_id, command.activity, now, heroes), ...state.positions]
    : state.positions
}

const settled = (
  state: DappState,
  input: Extract<DappInput, { type: 'dapp/command_settled' }>,
  account: DappAccount
): DappState => {
  const { hero_id, outcome, now } = input
  const command = state.commands[hero_id]
  if (command?.id !== input.id || command.status !== 'pending') return state
  // A refusal changed nothing at the bot, so it proves nothing new about what runs.
  if (outcome.kind === 'refused')
    return {
      ...state,
      commands: { ...state.commands, [hero_id]: { ...command, status: 'refused', error: outcome.error } },
    }
  if (outcome.kind === 'uncertain')
    return {
      ...state,
      settled_ms: now,
      commands: { ...state.commands, [hero_id]: { ...command, status: 'uncertain' } },
    }
  const { [hero_id]: _done, ...commands } = state.commands
  const positions = retained_positions(done_positions(state, command, now, account.characters))
  return { ...state, settled_ms: now, commands, positions }
}

/** The bot's answer to an order: taken into its queue, refused untouched, or unknown until observed. */
const order_sent = (state: DappState, input: Extract<DappInput, { type: 'dapp/order_sent' }>): DappState => {
  const { order } = state
  if (order?.id !== input.id || order.status !== 'pending') return state
  const { outcome, now } = input
  if (outcome.kind === 'refused') return { ...state, order: { ...order, status: 'refused', error: outcome.error } }
  const status = outcome.kind === 'done' ? 'accepted' : 'uncertain'
  return { ...state, settled_ms: now, order: { ...order, status } }
}
/** One market order at a time, and one direct command at the bot: a repeated tap changes nothing. */
const ordered = (state: DappState, place: (observation: DappObservation) => MarketOrder): DappState =>
  direct_free(state) ? { ...state, order: place(state.observation!) } : state

const signed_out = (state: DappState): DappState => ({ ...initial_dapp_state(), mode: state.mode })

type Handlers = {
  readonly [K in DappInput['type']]: (
    state: DappState,
    input: Extract<DappInput, { type: K }>,
    account: DappAccount
  ) => DappState
}
/** One handler per input keeps every rule small; the table is the reducer's whole vocabulary. */
const HANDLERS: Handlers = {
  'dapp/mode': (state, { mode }) => (mode === state.mode ? state : { ...state, mode }),
  'dapp/view': (state, { view }) => (view === state.view ? state : { ...state, view }),
  'dapp/observed': (state, input, account) =>
    state.link.phase === 'connected' ? observed(state, input, account) : state,
  'dapp/observe_failed': (state, { error }) => ({ ...state, observe_error: error }),
  'dapp/select_hero': (state, { hero_id }, { characters }) =>
    characters.some(({ id }) => id === hero_id) ? { ...state, hero_id } : state,
  'dapp/link': (state, { link }) => {
    if (link.phase === 'idle') return signed_out(state)
    // A dropped grant leaves no fresh view of the bot; positions stay until a new grant observes them.
    return link.phase === 'disconnected'
      ? { ...state, link, observation: null, commands: {}, order: null }
      : { ...state, link }
  },
  'dapp/connect': (state) =>
    state.link.phase === 'disconnected' ? { ...state, link: { phase: 'authorizing' } } : state,
  'dapp/disconnect': (state) =>
    state.link.phase === 'connected' && !commands_unresolved(state)
      ? { ...signed_out(state), link: { phase: 'disconnected', error: null } }
      : state,
  'dapp/start': (state, { id, activity, hero_ids, title }, account) =>
    with_commands(
      state,
      activity_offer(state, account, activity, hero_ids, title).plan.starts.map(({ hero_id, script }) => ({
        id: `${id}:${hero_id}`,
        hero_id,
        kind: 'start',
        activity,
        script,
        status: 'pending',
        error: null,
      }))
    ),
  'dapp/stop': (state, { id, hero_ids }) => {
    const stoppable = (hero_id: string) => running_position(state, hero_id) !== null && !hero_command(state, hero_id)
    return with_commands(
      state,
      (state.link.phase === 'connected' ? hero_ids.filter(stoppable) : []).map((hero_id) => ({
        id: `${id}:${hero_id}`,
        hero_id,
        kind: 'stop',
        status: 'pending',
        error: null,
      }))
    )
  },
  'dapp/hero_action': (state, { id, hero_id, action, payload }) =>
    with_commands(
      state,
      direct_free(state) ? [{ id, hero_id, kind: 'hero_action', action, payload, status: 'pending', error: null }] : []
    ),
  'dapp/command_settled': settled,
  'dapp/buy': (state, { id, listing }, account) =>
    ordered(state, (observation) => buy_order(observation, account, id, listing)),
  'dapp/sell': (state, { id, listing }, account) =>
    ordered(state, (observation) => sell_order(observation, account, id, listing)),
  'dapp/order_sent': order_sent,
  'dapp/order_dismissed': (state) => (order_open(state.order) ? state : { ...state, order: null }),
  'dapp/dismiss': (state, { position_id }) => {
    const positions = state.positions.filter(({ id, finished_ms }) => id !== position_id || finished_ms === null)
    // The haul is the story of the positions on screen: it ends with the last of them.
    return { ...state, positions, haul: positions.length ? state.haul : null }
  },
}

export const reduce_dapp = (state: DappState, input: DappInput, account: DappAccount): DappState =>
  account_followed(
    (HANDLERS[input.type] as (state: DappState, input: DappInput, account: DappAccount) => DappState)(
      state,
      input,
      account
    ),
    account
  )
