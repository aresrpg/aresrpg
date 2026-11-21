// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { DIRECT_UNSETTLED, type CharacterRow, type ListingRow } from '@aresrpg/protocol'
import type { StrategyScript } from '@aresrpg/protocol/strategies'
import type { CharacterCreateInput } from '@aresrpg/sdk/character'

import type { MarketPanel } from '../marketplace/MarketSource.tsx'

import { account_bag, strongest_first, type DappAccount } from './account.ts'
import { advance_bag_feed, EMPTY_BAG_FEED, type BagFeed } from './bag_feed.ts'
import {
  create_request,
  direct_open,
  followed_direct,
  hero_request,
  proven_direct,
  type DirectPayload,
  type DirectRequest,
  type DirectSeen,
  type HeroDirectAction,
} from './direct.ts'
import { buy_request, delist_request, sell_request } from './market.ts'
import { newest_observation, type DappObservation } from './observation.ts'
import {
  advance_position,
  finish_position,
  open_position,
  retained_positions,
  sync_positions,
  type DappPosition,
} from './positions.ts'
import {
  cap_valid,
  EMPTY_PLAN,
  plan_keys_missing,
  plan_start,
  RAID_TEAM,
  type DappActivity,
  type Difficulty,
  type QuestPlace,
  type StartSpec,
  type WorkPick,
} from './strategies.ts'
import { best_worker, work_job } from './work.ts'

export type DappTab = 'home' | 'quest' | 'raid' | 'heroes' | 'market'
export type DappLink = Readonly<
  | { phase: 'idle' }
  | { phase: 'disconnected'; error: string | null }
  | { phase: 'authorizing' }
  | { phase: 'exchanging' }
  // The grant itself lives only in device storage, where every tab and the shared client read it.
  | { phase: 'connected' }
>
/** One request to the bot to start or stop one hero. `uncertain` waits for an observation; it is never resent. */
export type DappCommand = Readonly<
  ({ kind: 'start'; spec: StartSpec; script: StrategyScript } | { kind: 'stop' }) & {
    id: string
    hero_id: string
    status: 'pending' | 'uncertain' | 'refused'
    error: string | null
  }
>
/** The player's choices on the Quest tab. Ids are kept as chosen; who can still go is derived at read. */
export type QuestPick = Readonly<{
  kind: 'fight' | 'work'
  /** The order the player picked the heroes in. */
  hero_ids: readonly string[]
  place: QuestPlace
  difficulty: Difficulty | null
  work: WorkPick
  /** The SUI, in MIST, one hero's run may pay in network fees; null is no cap. */
  fee_cap_mist: string | null
}>
/** The player's choices on the Raid tab. */
export type RaidPick = Readonly<{
  /** Null: the page proposes a dungeon whose key is held. */
  dungeon: string | null
  /** The seats, in order: a full fight side at most. */
  hero_ids: readonly string[]
  /** Dungeon runs each hero sees end before its raid ends; null raids while keys last. */
  runs: number | null
  fee_cap_mist: string | null
}>
export type DappState = Readonly<{
  tab: DappTab
  /** The panel the Market tab opens on: Buy, unless the player asked to sell. */
  market_panel: MarketPanel
  link: DappLink
  observation: DappObservation | null
  observe_error: string | null
  /** The hero the Heroes tab shows, once the player chose one. */
  hero_id: string | null
  quest: QuestPick
  raid: RaidPick
  /** At most one running position per hero: the local view of that hero's run. */
  positions: readonly DappPosition[]
  bag_feed: BagFeed
  /** At most one start or stop per hero, so no hero ever waits for another. */
  commands: Readonly<Record<string, DappCommand>>
  /** The one direct request of the bot wallet; the next one replaces it once it is resolved. */
  direct: DirectRequest | null
  /** When the bot last answered a command. Only a read of the bot requested later proves what runs. */
  settled_ms: number
  /** The `settled_ms` a read has proven. While both are equal, a newer pushed status is proof too. */
  proven_ms: number
}>
export type CommandOutcome = Readonly<{ kind: 'done' } | { kind: 'refused'; error: string } | { kind: 'uncertain' }>
export type DappInput = Readonly<
  /** `panel` names the panel the Market tab opens on; without one it is Buy. */
  | { type: 'dapp/tab'; tab: DappTab; panel?: MarketPanel }
  | { type: 'dapp/link'; link: DappLink }
  | { type: 'dapp/connect' }
  | { type: 'dapp/disconnect' }
  /** `requested_ms` is when this page asked the bot; a status the bot pushed has none. */
  | { type: 'dapp/observed'; observation: DappObservation; requested_ms: number | null; now: number }
  | { type: 'dapp/observe_failed'; error: string }
  | { type: 'dapp/select_hero'; hero_id: string }
  | { type: 'dapp/quest_pick'; pick: Partial<QuestPick> }
  | { type: 'dapp/raid_pick'; pick: Partial<RaidPick> }
  | { type: 'dapp/start'; id: string; spec: StartSpec; title: string }
  | { type: 'dapp/stop'; id: string; hero_ids: readonly string[] }
  | { type: 'dapp/command_settled'; hero_id: string; id: string; outcome: CommandOutcome; now: number }
  | { type: 'dapp/hero_direct'; id: string; hero_id: string; action: HeroDirectAction; payload: DirectPayload }
  | { type: 'dapp/create_hero'; id: string; payload: CharacterCreateInput }
  | { type: 'dapp/buy'; id: string; listing: ListingRow }
  | { type: 'dapp/sell'; id: string; listing: Pick<ListingRow, 'id' | 'item_type' | 'amount' | 'price_mist'> }
  | { type: 'dapp/delist'; id: string; listing: Pick<ListingRow, 'id' | 'kiosk'> }
  | { type: 'dapp/direct_sent'; id: string; outcome: CommandOutcome; now: number }
  | { type: 'dapp/direct_dismissed' }
  | { type: 'dapp/dismiss'; position_id: string }
  /** The feed this device kept for the bot account now followed; empty when it kept none. */
  | { type: 'dapp/bag_feed_restored'; feed: BagFeed }
>

export const initial_dapp_state = (): DappState => ({
  tab: 'home',
  market_panel: 'BUY',
  link: { phase: 'idle' },
  observation: null,
  observe_error: null,
  hero_id: null,
  quest: {
    kind: 'fight',
    hero_ids: [],
    place: null,
    difficulty: null,
    work: { mode: 'auto', job: null },
    fee_cap_mist: null,
  },
  raid: { dungeon: null, hero_ids: [], runs: null, fee_cap_mist: null },
  positions: [],
  bag_feed: EMPTY_BAG_FEED,
  commands: {},
  direct: null,
  settled_ms: 0,
  proven_ms: 0,
})

/** A refused command is only a message; any other still waits for the bot or for an observation. */
const unresolved = (command: DappCommand | undefined): command is DappCommand =>
  command !== undefined && command.status !== 'refused'
/** Anything the bot was asked and has not answered for good: a hero's command or the direct request. */
export const commands_unresolved = (state: DappState): boolean =>
  Object.values(state.commands).some(unresolved) || direct_open(state.direct)
export const hero_command = (state: DappState, hero_id: string): DappCommand | null => {
  const command = state.commands[hero_id]
  return unresolved(command) ? command : null
}
export const running_position = (state: DappState, hero_id: string): DappPosition | null =>
  state.positions.find((position) => position.hero_id === hero_id && position.finished_ms === null) ?? null
/** A hero the bot plays, or is being asked about: it shows its activity and a Stop, never a Start. */
export const hero_hosted = (state: DappState, hero_id: string): boolean =>
  running_position(state, hero_id) !== null || hero_command(state, hero_id) !== null
export const bot_ready = (state: DappState): boolean =>
  state.link.phase === 'connected' && state.observation?.ready === true
/** The last read of the bot failed and it has said nothing usable: the page cannot reach it. */
export const bot_unreachable = (state: DappState): boolean => !bot_ready(state) && state.observe_error !== null
/** The bot holds one direct command at a time and signs it in turn with its heroes, so only another
 * direct request makes the next one wait. The bot's own word counts too: an answered request, or a
 * command the bot sent itself, is still held until the bot says it is over. */
export const direct_free = (state: DappState): boolean =>
  [
    bot_ready(state),
    !DIRECT_UNSETTLED.includes(state.observation?.direct?.status ?? ''),
    !direct_open(state.direct),
  ].every(Boolean)

/** The hero the Heroes tab shows: the player's choice while it exists, else the strongest hero. */
export const selected_hero = (state: DappState, account: DappAccount): CharacterRow | null =>
  account.characters.find(({ id }) => id === state.hero_id) ?? strongest_first(account.characters)[0] ?? null
/** Heroes the bot neither plays nor is being asked about. */
export const free_heroes = (state: DappState, account: DappAccount): readonly CharacterRow[] =>
  account.characters.filter(({ id }) => !hero_hosted(state, id))
/** The picked heroes that still exist and are free, in the order they were picked. */
const picked = (state: DappState, account: DappAccount, ids: readonly string[]): readonly CharacterRow[] =>
  ids.flatMap((hero_id) => free_heroes(state, account).find(({ id }) => id === hero_id) ?? [])
export const quest_heroes = (state: DappState, account: DappAccount): readonly CharacterRow[] =>
  picked(state, account, state.quest.hero_ids)
export const raid_seats = (state: DappState, account: DappAccount): readonly CharacterRow[] =>
  picked(state, account, state.raid.hero_ids)
/** What the Quest tab would start with the player's choices as they stand. */
export const quest_spec = (state: DappState, account: DappAccount): StartSpec => {
  const { kind, place, difficulty, work, fee_cap_mist } = state.quest
  const hero_ids = quest_heroes(state, account).map(({ id }) => id)
  return kind === 'fight'
    ? { activity: 'train', hero_ids, place, difficulty, fee_cap_mist }
    : { activity: 'gather', hero_ids, work, fee_cap_mist }
}

export type HeroStatus = 'fight' | 'dungeon' | 'activity' | 'free'
/**
 * A fight and a dungeon are facts of the hero row; an activity is a run this page holds. "Free" is the
 * bot's word that it plays nothing for this hero, so it is null until the bot has answered.
 */
export const hero_status = (state: DappState, hero: Readonly<CharacterRow>): HeroStatus | null => {
  if (hero.active_fight) return 'fight'
  if (hero.dungeon_run) return 'dungeon'
  if (hero_hosted(state, hero.id)) return 'activity'
  return bot_ready(state) ? 'free' : null
}
/** The heroes that can be sent now, strongest first: none of them fights, raids or is already out. */
export const idle_heroes = (state: DappState, { characters }: DappAccount): readonly CharacterRow[] =>
  strongest_first(characters).filter((hero) => [null, 'free'].includes(hero_status(state, hero)))
/** The picked quest heroes that can still be sent, in the order picked. */
export const picked_heroes = (state: DappState, account: DappAccount): readonly CharacterRow[] => {
  const idle = idle_heroes(state, account)
  return state.quest.hero_ids.flatMap((hero_id) => idle.find(({ id }) => id === hero_id) ?? [])
}
/** Who a fight quest would send: the player's pick, else the strongest hero that can go. A proposal
 * is made only while nothing is picked, and a start stores it as the pick: a second press then finds
 * that hero out and proposes nobody else. */
export const fight_heroes = (state: DappState, account: DappAccount): readonly CharacterRow[] =>
  state.quest.hero_ids.length ? picked_heroes(state, account) : idle_heroes(state, account).slice(0, 1)
export const fight_spec = (state: DappState, account: DappAccount): StartSpec => ({
  ...quest_spec(state, account),
  hero_ids: fight_heroes(state, account).map(({ id }) => id),
})
/** Who would work: the player's pick, else the best free hero of the pick's profession, else the
 * strongest. A proposal, like the fight's: only shown. */
export const work_worker = (state: DappState, account: DappAccount): CharacterRow | null => {
  if (state.quest.hero_ids.length) return picked_heroes(state, account)[0] ?? null
  const idle = idle_heroes(state, account)
  const job = work_job(state.quest.work)
  return (job ? best_worker(idle, job)?.hero : idle[0]) ?? null
}
export const work_spec = (state: DappState, account: DappAccount): StartSpec => {
  const worker = work_worker(state, account)
  return { ...quest_spec(state, account), hero_ids: worker ? [worker.id] : [] }
}
/** Heroes out, by the tab that follows them: a raid on Raid, anything else on Quest. */
export const tab_badges = ({ positions }: DappState): Readonly<Record<'quest' | 'raid', number>> => {
  const running = positions.filter(({ finished_ms }) => finished_ms === null)
  const raiding = running.filter(({ activity }) => activity === 'raid').length
  return { quest: running.length - raiding, raid: raiding }
}

const starting = (command: DappCommand | undefined, activity: DappActivity): boolean =>
  command?.kind === 'start' && command.status === 'pending' && command.spec.activity === activity
/** What one Start offers its heroes: who is out on that activity, who is free, and the plan for those. */
export const activity_offer = (state: DappState, account: DappAccount, spec: StartSpec, title: string) => {
  const scoped = account.characters.filter(({ id }) => spec.hero_ids.includes(id))
  const free = scoped.filter(({ id }) => !hero_hosted(state, id))
  const hero_ids = spec.hero_ids.filter((hero_id) => free.some(({ id }) => id === hero_id))
  return {
    out: scoped.filter(({ id }) => running_position(state, id)?.activity === spec.activity),
    free,
    sending: scoped.some(({ id }) => starting(state.commands[id], spec.activity)),
    plan: bot_ready(state)
      ? plan_start({ ...spec, hero_ids }, account.characters, account_bag(account), title)
      : EMPTY_PLAN,
  }
}

/**
 * The same start, sent again from a finished position that kept what it asked for; null when it kept
 * nothing. It is ready while the bot can be asked and the hero is free. A raid whose team is now short
 * of keys is not offered: the Raid tab confirms that case before anything is sent.
 */
export const send_again = (
  state: DappState,
  account: DappAccount,
  { sent, hero_id, objective }: Pick<DappPosition, 'sent' | 'hero_id' | 'objective'>,
  fallback_title: string
): Readonly<{ title: string; ready: boolean }> | null => {
  if (!sent) return null
  const title = objective ?? fallback_title
  if (plan_keys_missing(activity_offer(state, account, sent, title).plan) > 0) return null
  return { title, ready: bot_ready(state) && !hero_hosted(state, hero_id) }
}

/** An unknown answer resolves from a fresh observation: a start by its visible run, anything else by itself. */
const resolved_commands = (commands: DappState['commands'], observation: DappObservation): DappState['commands'] =>
  Object.fromEntries(
    Object.entries(commands).flatMap(([hero_id, command]) => {
      if (command.status !== 'uncertain') return [[hero_id, command] as const]
      const unconfirmed = command.kind === 'start' && !observation.runs[hero_id]
      return unconfirmed ? [[hero_id, { ...command, status: 'refused', error: 'start_unconfirmed' }] as const] : []
    })
  )
const uncertain_start = (command: DappCommand | undefined): StartSpec | null =>
  command?.kind === 'start' && command.status === 'uncertain' ? command.spec : null
/** A start whose answer was lost keeps what it asked for on the position its visible run opens. */
const with_sent = (positions: readonly DappPosition[], commands: DappState['commands']): readonly DappPosition[] =>
  positions.map((position) => {
    const sent = uncertain_start(commands[position.hero_id])
    return sent && position.finished_ms === null && position.sent === null ? { ...position, sent } : position
  })

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
  const synced = sync_positions(state.positions, observation, account.characters, now)
  return {
    ...next,
    positions: retained_positions(with_sent(synced, state.commands)),
    commands: resolved_commands(state.commands, observation),
    direct: followed_direct(state.direct, observation, account),
  }
}

const same_rows = <T>(left: readonly T[], right: readonly T[]): boolean =>
  left.length === right.length && left.every((row, index) => row === right[index])
/**
 * The account is pushed by the game server, so every input folds it by value: positions take their
 * heroes' gains and fight results, the bag feed takes the bag's, and a creation left unconfirmed is
 * proven by its new hero. Nothing new in the account returns the same state.
 */
export const account_followed = (state: DappState, account: DappAccount): DappState => {
  if (state.link.phase !== 'connected') return state
  const advanced = state.positions.map((position) => advance_position(position, account))
  const positions = same_rows(advanced, state.positions) ? state.positions : advanced
  const bag_feed = advance_bag_feed(state.bag_feed, account)
  const direct = proven_direct(state.direct, account)
  const unchanged = [positions === state.positions, bag_feed === state.bag_feed, direct === state.direct].every(Boolean)
  return unchanged ? state : { ...state, positions, bag_feed, direct }
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

/** A confirmed stop finishes its position; a confirmed start opens one that keeps what it asked for. */
const done_positions = (
  state: DappState,
  command: DappCommand,
  now: number,
  heroes: readonly CharacterRow[]
): readonly DappPosition[] => {
  const running = running_position(state, command.hero_id)
  if (command.kind === 'stop')
    return state.positions.map((position) => (position === running ? finish_position(position, now) : position))
  if (running) return state.positions
  const { spec } = command
  return [open_position(command.hero_id, now, heroes, { activity: spec.activity, sent: spec }), ...state.positions]
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

/** The bot's answer to a direct request: taken into its queue, refused untouched, or unknown until observed. */
const direct_sent = (state: DappState, input: Extract<DappInput, { type: 'dapp/direct_sent' }>): DappState => {
  const { direct } = state
  if (direct?.id !== input.id || direct.status !== 'pending') return state
  const { outcome, now } = input
  if (outcome.kind === 'refused') return { ...state, direct: { ...direct, status: 'refused', error: outcome.error } }
  const status = outcome.kind === 'done' ? 'accepted' : 'uncertain'
  return { ...state, settled_ms: now, direct: { ...direct, status } }
}
/** One direct request at a time, and one direct command at the bot: a repeated tap changes nothing. */
const requested = (state: DappState, account: DappAccount, request: (seen: DirectSeen) => DirectRequest): DappState =>
  direct_free(state) ? { ...state, direct: request({ observation: state.observation!, account }) } : state

const unique = (ids: readonly string[]): readonly string[] => [...new Set(ids)]
type Caps = Readonly<{ fee_cap_mist?: string | null; runs?: number | null }>
/** A pick that carries a malformed cap is ignored whole: it never becomes "no cap". */
const caps_valid = ({ fee_cap_mist = null, runs = null }: Caps): boolean => cap_valid(fee_cap_mist) && cap_valid(runs)
/** Heroes are picked once each, and a raid seats a full fight side at most. */
const seated = ({ hero_ids }: Readonly<{ hero_ids?: readonly string[] }>, seats: number) =>
  hero_ids ? { hero_ids: unique(hero_ids).slice(0, seats) } : {}

type Handlers = {
  readonly [K in DappInput['type']]: (
    state: DappState,
    input: Extract<DappInput, { type: K }>,
    account: DappAccount
  ) => DappState
}
/** One handler per input keeps every rule small; the table is the reducer's whole vocabulary. */
const HANDLERS: Handlers = {
  'dapp/tab': (state, { tab, panel = 'BUY' }) =>
    tab === state.tab && panel === state.market_panel ? state : { ...state, tab, market_panel: panel },
  'dapp/observed': (state, input, account) =>
    state.link.phase === 'connected' ? observed(state, input, account) : state,
  'dapp/observe_failed': (state, { error }) => ({ ...state, observe_error: error }),
  'dapp/select_hero': (state, { hero_id }, { characters }) =>
    characters.some(({ id }) => id === hero_id) ? { ...state, hero_id } : state,
  'dapp/quest_pick': (state, { pick }) =>
    caps_valid(pick) ? { ...state, quest: { ...state.quest, ...pick, ...seated(pick, Infinity) } } : state,
  'dapp/raid_pick': (state, { pick }) =>
    caps_valid(pick) ? { ...state, raid: { ...state.raid, ...pick, ...seated(pick, RAID_TEAM) } } : state,
  'dapp/link': (state, { link }) => {
    if (link.phase === 'idle') return initial_dapp_state()
    // A dropped grant leaves no fresh view of the bot; positions stay until a new grant observes them.
    return link.phase === 'disconnected'
      ? { ...state, link, observation: null, commands: {}, direct: null }
      : { ...state, link }
  },
  'dapp/connect': (state) =>
    state.link.phase === 'disconnected' ? { ...state, link: { phase: 'authorizing' } } : state,
  'dapp/disconnect': (state) =>
    state.link.phase === 'connected' && !commands_unresolved(state)
      ? { ...initial_dapp_state(), link: { phase: 'disconnected', error: null } }
      : state,
  'dapp/start': (state, { id, spec, title }, account) => {
    const issued = activity_offer(state, account, spec, title).plan.starts.map(({ hero_id, script }): DappCommand => ({
      id: `${id}:${hero_id}`,
      hero_id,
      kind: 'start',
      spec,
      script,
      status: 'pending',
      error: null,
    }))
    // A quest started from a proposal keeps its heroes as the pick: a second press proposes nobody else.
    const proposed = issued.length > 0 && spec.activity !== 'raid' && !state.quest.hero_ids.length
    return with_commands(proposed ? { ...state, quest: { ...state.quest, hero_ids: spec.hero_ids } } : state, issued)
  },
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
  'dapp/command_settled': settled,
  'dapp/hero_direct': (state, { id, hero_id, action, payload }, account) =>
    account.characters.some((hero) => hero.id === hero_id)
      ? requested(state, account, (seen) => hero_request(id, seen, { hero_id, action, payload }))
      : state,
  'dapp/create_hero': (state, { id, payload }, account) =>
    requested(state, account, (seen) => create_request(id, seen, payload)),
  'dapp/buy': (state, { id, listing }, account) => requested(state, account, (seen) => buy_request(id, seen, listing)),
  'dapp/sell': (state, { id, listing }, account) =>
    requested(state, account, (seen) => sell_request(id, seen, listing)),
  'dapp/delist': (state, { id, listing }, account) =>
    requested(state, account, (seen) => delist_request(id, seen, listing)),
  'dapp/direct_sent': direct_sent,
  'dapp/direct_dismissed': (state) => (direct_open(state.direct) ? state : { ...state, direct: null }),
  'dapp/dismiss': (state, { position_id }) => ({
    ...state,
    positions: state.positions.filter(({ id, finished_ms }) => id !== position_id || finished_ms === null),
  }),
  'dapp/bag_feed_restored': (state, { feed }) => ({ ...state, bag_feed: feed }),
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
