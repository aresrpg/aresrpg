// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import {
  character_checkpoint,
  run_ending,
  type AgentStatus,
  type CharacterRow,
  type FightResolutionRow,
  type HostedObjective,
  type RunEnding,
} from '@aresrpg/protocol'

import type { SessionState } from '../modules/session.ts'

import type { AgentInventoryView } from './inventory_state.ts'
import { owner_connected } from './owner_state.ts'

type WalletState = AgentStatus['state']
/** The kind of help a blocked run needs from the player: one sentence each, `agent_page.run_notice_<notice>`. */
export type RunNotice = 'funding' | 'requirement' | 'plan' | 'place'
export type HeroActivity = Readonly<{
  status: WalletState
  objective: HostedObjective | null
  /** Set for a hero with a run: what the player must change for it to continue, null when nothing. */
  notice?: RunNotice | null
  /** The bot's own code or words for the run's last tick: diagnostics, never text the player reads. */
  issue?: string
}>
/** Run statuses that say a hero is being played. An ended run says nothing. */
const PLAYED: readonly string[] = ['active', 'waiting', 'awaiting_ai', 'paused'] satisfies readonly WalletState[]

/**
 * The issue codes of a run that only the player can lift. The bot owns the codes (`packages/bot/src`,
 * admitted by `planning_failure.ts`); this table names them and invents none. Every issue absent from
 * it is ordinary play that the status line already tells: a wait, a refused command, an ended run.
 */
const NOTICE_OF: Readonly<Record<string, RunNotice>> = Object.freeze({
  funding_required: 'funding',
  // The hero lacks what the activity spends or requires, or it left the bot wallet.
  gathering_tool_required: 'requirement',
  tool_unavailable: 'requirement',
  gathering_level_required: 'requirement',
  crafting_level_required: 'requirement',
  equipment_level_required: 'requirement',
  level_too_low: 'requirement',
  ingredients_required: 'requirement',
  recipe_unavailable: 'requirement',
  craft_batch_limit: 'requirement',
  insufficient_consumables: 'requirement',
  unsupported_consumable: 'requirement',
  insufficient_spell_points: 'requirement',
  spell_not_learned: 'requirement',
  wrong_slot: 'requirement',
  character_not_owned: 'requirement',
  character_authority_mismatch: 'requirement',
  // The tree itself cannot play: its author has to change it.
  no_legal_tactic: 'plan',
  unavailable_spells: 'plan',
  invalid_region: 'plan',
  region_outside_tracked_window: 'plan',
  invalid_target_options: 'plan',
  target_outside_area: 'plan',
  target_group_mismatch: 'plan',
  invalid_market_lot: 'plan',
  unsupported_fight_mode: 'plan',
  // The place the hero was sent to cannot be walked to from where it stands.
  area_unreachable: 'place',
})

/**
 * What a run asks of the player, for the game overlay and the Connect Your Agent page alike. A run that waits for its
 * author needs a new plan whatever reason it gives; any other issue is a notice only when the table
 * lists its code (the part before a `:` detail). An unknown code and free text are never a notice,
 * so a code the bot adds later cannot reach the player raw.
 */
export const run_notice = (status: string | null, issue: string | null | undefined): RunNotice | null => {
  const [code = ''] = (issue ?? '').split(':', 1)
  const listed = Object.hasOwn(NOTICE_OF, code) ? NOTICE_OF[code]! : null
  return status === 'awaiting_ai' && listed !== 'funding' ? 'plan' : listed
}

const stopped = ({ ready, state }: AgentStatus): WalletState | null => {
  if (!ready) return 'unavailable'
  return state === 'paused' || state === 'unavailable' ? state : null
}

/** The hero a direct command in flight acts for; null when none is in flight or it acts for the wallet. */
const commanded = ({ direct }: AgentStatus): string | null => {
  const hero = direct && ['accepted', 'executing'].includes(direct.status) ? direct.payload.character_id : null
  return typeof hero === 'string' ? hero : null
}
/** The wallet's work belongs to other heroes: their runs, or a direct command for one of them. */
const others_work = (status: AgentStatus, played: number, hero: string | null): boolean => {
  const target = commanded(status)
  return target === null ? played > 0 : target !== hero
}

/**
 * What the bot's pushed status says about one hero. A stopped wallet is said first; then the hero's
 * own run with its objective; the wallet's state describes a hero with no run only when the wallet's
 * work is not another hero's: a direct command in flight for this hero, or no hero played at all.
 */
export const hero_activity = (status: AgentStatus, hero: string | null): HeroActivity | null => {
  const halted = stopped(status)
  const played = status.runs.filter((run) => PLAYED.includes(run.status))
  const run = played.find(({ character_id }) => character_id === hero)
  if (run) {
    const { objective = null, issue } = run
    return { status: halted ?? (run.status as WalletState), objective, notice: run_notice(run.status, issue), issue }
  }
  if (halted) return { status: halted, objective: null }
  return others_work(status, played.length, hero) ? null : { status: status.state, objective: null }
}

/** The bot's own status, scoped to the exact observed wallet and character, never the last displayed task. */
export const current_agent_activity = (session: SessionState): HeroActivity | null => {
  const { request, status: view } = session.agent_view
  const { status } = session.agent_inventory
  if (![view === 'ready', session.link_status === 'ready', owner_connected(session)].every(Boolean)) return null
  if (!status || request?.pairing.address !== session.inventory_pairing?.address) return null
  return hero_activity(status, session.selected_character_id)
}

/** Where a hero's chain row places it, most binding first: seated in a fight, inside a dungeon, in a world. */
export const hero_whereabouts = ({
  active_fight,
  dungeon_run,
  world,
}: Readonly<Pick<CharacterRow, 'active_fight' | 'dungeon_run' | 'world'>>): 'fight' | 'dungeon' | 'world' | null => {
  if (active_fight) return 'fight'
  if (dungeon_run) return 'dungeon'
  return world ? 'world' : null
}

/** What a hero's chain row alone tells. The in-game card observes nothing else. */
export type AgentActivity =
  | Readonly<{ kind: 'level'; level: number }>
  | Readonly<{ kind: 'profession' | 'travel' | 'fight_entered' | 'fight_left' | 'dungeon_left' }>
  | Readonly<{ kind: 'experience'; gained: string }>
  | Readonly<{ kind: 'dungeon'; dungeon: string; room: number }>
/** A run's line: it plays, it ended, or it names the help it needs from the player. */
export type RunPhase = 'working' | 'ended' | RunNotice
/**
 * Every line of a hero's log. A fight's result and its loot come from its resolution row; a run and a
 * command come from the bot's pushed status. A run's `id` is the bot's; its `title` is its author's own
 * words; `continued` is false only when the page sees it start; its `ending` is why it ended by itself,
 * when the bot names a listed reason. A command's
 * `action` is the bot's name for it and its `error` the bot's code. A view looks the codes up and never
 * prints them.
 */
export type HeroEvent =
  | AgentActivity
  | Readonly<{ kind: 'fight_won' | 'fight_lost' }>
  | Readonly<{ kind: 'loot'; drops: readonly Readonly<{ item_type: string; qty: number }>[] }>
  | Readonly<{ kind: 'run'; id: string; title: string | null; phase: RunPhase; continued: boolean; ending?: RunEnding }>
  | Readonly<{ kind: 'command'; action: string; error: string | null }>

const changed_location = (before: Readonly<CharacterRow>, after: Readonly<CharacterRow>): boolean =>
  !!character_checkpoint(before) &&
  !!character_checkpoint(after) &&
  (after.at_ms ?? 0) >= (before.at_ms ?? 0) &&
  [before.world !== after.world, before.x !== after.x, before.z !== after.z].some(Boolean)
const profession_progressed = (before: Readonly<CharacterRow>, after: Readonly<CharacterRow>): boolean =>
  Object.entries(after.jobs).some(([job, xp]) => BigInt(xp) > BigInt(before.jobs[job] ?? '0'))
const dungeon_room = ({ dungeon_run: run }: Readonly<CharacterRow>): string => (run ? `${run.dungeon}:${run.room}` : '')

/** One hero's row seen twice: each fact that moved is one line, and a row seen again is none. */
const row_changes = (before: Readonly<CharacterRow>, after: Readonly<CharacterRow>): readonly AgentActivity[] => {
  const gained = BigInt(after.experience) - BigInt(before.experience)
  const { dungeon_run: run } = after
  const observations: readonly Readonly<{ changed: boolean; event: AgentActivity }>[] = [
    { changed: changed_location(before, after), event: { kind: 'travel' } },
    { changed: profession_progressed(before, after), event: { kind: 'profession' } },
    {
      changed: dungeon_room(before) !== dungeon_room(after),
      event: run ? { kind: 'dungeon', dungeon: run.dungeon, room: run.room } : { kind: 'dungeon_left' },
    },
    {
      changed: before.active_fight?.id !== after.active_fight?.id,
      event: { kind: after.active_fight ? 'fight_entered' : 'fight_left' },
    },
    { changed: gained > 0n, event: { kind: 'experience', gained: String(gained) } },
    { changed: after.level > before.level, event: { kind: 'level', level: after.level } },
  ]
  return observations.filter(({ changed }) => changed).map(({ event }) => event)
}

/** A bounded log grows at its end and drops its oldest lines; with nothing to add it is the same log. */
const kept_lines = <Line>(lines: readonly Line[], added: readonly Line[], kept: number): readonly Line[] =>
  added.length ? [...lines, ...added].slice(-kept) : lines

/** The approved compact overlay shows two confirmed lines plus the derived current state. */
const OVERLAY_LINES = 2
/** Accepted indexed snapshots establish activity; initial reads and duplicate delivery stay silent. */
export const fold_agent_activity = (
  history: readonly AgentActivity[],
  before: Readonly<CharacterRow> | null | undefined,
  after: Readonly<CharacterRow> | null | undefined,
  previous_status = 'ready',
  failed = false
): readonly AgentActivity[] => {
  if (previous_status !== 'ready' || failed || !before || !after || before.id !== after.id) return []
  return kept_lines(history, row_changes(before, after), OVERLAY_LINES)
}

/** A hero's run as its log tells it: `phase` is the help it needs from the player, or that it plays. */
export type RunFacts = Readonly<{ id: string; title: string | null; phase: RunPhase }>
type BotFacts = NonNullable<HeroFacts['bot']>
type CommandFacts = Readonly<{ id: string; action: string; settled: boolean; error: string | null }>
/**
 * What the account's own page knows about one hero, each fact copied by value from the store: its
 * chain row, its fight results, and what the bot says of it. `bot` is null while the bot has not
 * spoken or is not ready: an unknown bot neither starts nor ends anything.
 */
export type HeroFacts = Readonly<{
  hero: CharacterRow
  results: readonly FightResolutionRow[]
  bot: Readonly<{ run: RunFacts | null; ending: RunEnding | null; command: CommandFacts | null }> | null
}>
export type ObservedHeroes = Readonly<Record<string, HeroFacts>>

/** The run the bot plays for a hero now, null when none. */
export const run_facts = ({ runs }: AgentStatus, hero: string): RunFacts | null => {
  const run = runs.find(({ character_id, status }) => character_id === hero && PLAYED.includes(status))
  if (!run) return null
  const { id, objective, issue } = run
  return { id, title: objective?.title ?? null, phase: run_notice(run.status, issue) ?? 'working' }
}
/** Why the hero's last run ended by itself. The bot tells it until the hero starts again. */
const ending_facts = ({ runs }: AgentStatus, hero: string): RunEnding | null =>
  run_ending(runs.find(({ character_id, ended }) => character_id === hero && ended !== undefined)?.ended) ?? null
/** Command statuses that will not change again. An uncertain command is still being reconciled. */
const SETTLED: readonly string[] = ['completed', 'failed', 'cancelled']
const command_facts = ({ direct }: AgentStatus, hero: string): CommandFacts | null => {
  if (direct?.payload.character_id !== hero) return null
  const { id, kind, status, error = '' } = direct
  return { id, action: kind, settled: SETTLED.includes(status), error: status === 'completed' ? null : error }
}

const bot_facts = (status: AgentStatus, hero: string): BotFacts => ({
  run: run_facts(status, hero),
  ending: ending_facts(status, hero),
  command: command_facts(status, hero),
})

const NO_HEROES: ObservedHeroes = Object.freeze({})
/**
 * The one slice a hero log folds. It is empty until the account's snapshot is complete, so the first
 * read of an account, and a read after a new subscription, is a baseline and never a line.
 */
export const observed_heroes = ({
  phase,
  characters,
  resolutions,
  status,
}: Readonly<Pick<AgentInventoryView, 'phase' | 'characters' | 'resolutions' | 'status'>>): ObservedHeroes =>
  phase === 'ready'
    ? Object.fromEntries(
        characters.map((hero) => [
          hero.id,
          {
            hero,
            results: resolutions.filter(({ character }) => character === hero.id),
            bot: status?.ready ? bot_facts(status, hero.id) : null,
          },
        ])
      )
    : NO_HEROES

const run_line = ({ id, title }: RunFacts, phase: RunPhase, continued: boolean): HeroEvent => ({
  kind: 'run',
  id,
  title,
  phase,
  continued,
})
/** A run that is gone, or that another run replaced, ended. One that is gone says why when the bot does. */
const ended_run = (before: RunFacts | null, { run, ending }: BotFacts): readonly HeroEvent[] => {
  if (!before || before.id === run?.id) return []
  return [{ ...run_line(before, 'ended', true), ...(ending && !run ? { ending } : {}) }]
}
/** A run is told when it appears, and again each time it starts or stops needing the player. */
const told_run = (before: RunFacts | null, after: RunFacts | null): readonly HeroEvent[] =>
  after && (before?.id !== after.id || before.phase !== after.phase)
    ? [run_line(after, after.phase, before?.id === after.id)]
    : []
/** A direct command is one line, when it settles. The same settled command seen again is none. */
const command_changes = (before: CommandFacts | null, after: CommandFacts | null): readonly HeroEvent[] => {
  if (!after?.settled) return []
  const told = before?.id === after.id && before.settled
  return told ? [] : [{ kind: 'command', action: after.action, error: after.error }]
}
/** What a fight not seen yet had told: no winner and no loot. */
const UNSEEN: Readonly<Pick<FightResolutionRow, 'winner' | 'drops'>> = Object.freeze({ winner: null, drops: [] })
/** Results diff by fight: a winner is told when it is first known, the loot when it is first rolled. */
const result_changes = (
  before: readonly FightResolutionRow[],
  after: readonly FightResolutionRow[]
): readonly HeroEvent[] =>
  after.flatMap((row): readonly HeroEvent[] => {
    const seen = before.find(({ fight }) => fight === row.fight) ?? UNSEEN
    const decided = row.winner !== null && seen.winner === null
    const rolled = row.drops.length > 0 && seen.drops.length === 0
    return [
      ...(decided ? [{ kind: row.winner === row.team ? 'fight_won' : 'fight_lost' } as const] : []),
      ...(rolled ? [{ kind: 'loot', drops: row.drops } as const] : []),
    ]
  })

const bot_changes = (before: BotFacts, after: BotFacts): readonly HeroEvent[] => [
  ...ended_run(before.run, after),
  ...told_run(before.run, after.run),
  ...command_changes(before.command, after.command),
]

/** Everything that moved for one hero between two observations of it, oldest cause first. */
export const observed_activity = (before: HeroFacts, after: HeroFacts): readonly HeroEvent[] => [
  ...result_changes(before.results, after.results),
  ...row_changes(before.hero, after.hero),
  ...(before.bot && after.bot ? bot_changes(before.bot, after.bot) : []),
]

/**
 * Lines kept for one hero on the open page. The page is a live view and stores nothing: a hero that
 * gathers adds a few lines a minute, so an open tab would otherwise grow without end. 200 lines hold
 * the recent stretch of play and keep the log's markup small; older lines are dropped first.
 */
export const HERO_LOG_LINES = 200
/** One kept line: `id` counts a hero's lines from 1 and names a line for as long as it is kept. */
export type LoggedEvent = Readonly<{ id: number; at: number; event: HeroEvent }>
export type HeroLogs = Readonly<Record<string, readonly LoggedEvent[]>>
const numbered = (lines: readonly LoggedEvent[], events: readonly HeroEvent[], at: number): readonly LoggedEvent[] => {
  const last = lines.at(-1)?.id ?? 0
  return events.map((event, index) => ({ id: last + index + 1, at, event }))
}
/**
 * Each hero's log, folded from two observations of the account. Only a hero present in both can have
 * moved; `at` is when the page observed the change. The same observation seen again returns `logs` itself.
 */
export const fold_hero_logs = (logs: HeroLogs, before: ObservedHeroes, after: ObservedHeroes, at: number): HeroLogs => {
  const grown = Object.entries(after).flatMap(([hero, facts]) => {
    const events = Object.hasOwn(before, hero) ? observed_activity(before[hero]!, facts) : []
    const lines = logs[hero] ?? []
    return events.length ? [[hero, kept_lines(lines, numbered(lines, events, at), HERO_LOG_LINES)] as const] : []
  })
  return grown.length ? { ...logs, ...Object.fromEntries(grown) } : logs
}

/** A run as the transcript heads it: the bot's run, its last told phase and, once it ended by itself, why. */
export type RunHead = Readonly<{ id: string; title: string | null; phase: RunPhase; ending?: RunEnding }>
/** A stretch of one hero's log: the lines seen while one run played, under its head, or lines outside any run. */
export type LogGroup = Readonly<{ run: RunHead | null; lines: readonly LoggedEvent[] }>

const playing = ({ run }: LogGroup): boolean => run === null || run.phase !== 'ended'
/**
 * A line joins the group it was seen in. A run's first line opens its group and is its head; a later line of the
 * same run (a blocker, a restart, its end) updates the head and stays as a line. A run the page did not see start
 * was already playing the loose lines just before its first line, so it takes them; that line stays as a line.
 */
const grouped_line = (groups: readonly LogGroup[], line: LoggedEvent): readonly LogGroup[] => {
  const last = groups.at(-1)
  const before = groups.slice(0, -1)
  const { event } = line
  if (event.kind !== 'run')
    return last && playing(last)
      ? [...before, { ...last, lines: [...last.lines, line] }]
      : [...groups, { run: null, lines: [line] }]
  const same_run = last?.run?.id === event.id
  const unseen_start = event.continued && last?.run === null
  if (last && (same_run || unseen_start)) return [...before, { run: event, lines: [...last.lines, line] }]
  return [...groups, { run: event, lines: event.continued ? [line] : [] }]
}

/**
 * One hero's log as the runs it saw, oldest first. `live` is the run the bot plays for the hero now: it heads the
 * loose lines at the end, which it played since the page opened, or stands alone while nothing was seen yet.
 */
export const log_groups = (lines: readonly LoggedEvent[], live: RunFacts | null): readonly LogGroup[] => {
  const groups = lines.reduce(grouped_line, [] as readonly LogGroup[])
  if (!live || groups.some(({ run }) => run?.id === live.id)) return groups
  const last = groups.at(-1)
  return last?.run === null
    ? [...groups.slice(0, -1), { run: live, lines: last.lines }]
    : [...groups, { run: live, lines: [] }]
}
