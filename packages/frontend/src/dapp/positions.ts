// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { CharacterRow, FightResolutionRow, RunEnding } from '@aresrpg/protocol'

import { run_notice, type RunNotice } from '../agents/activity.ts'

import { hero_experience, job_experience, type DappAccount } from './account.ts'
import type { DappObservation, DappRun } from './observation.ts'
import { strategy_activity, type DappActivity, type StartSpec } from './strategies.ts'

/** Finished positions kept for review until dismissed (mockup round 9 ruling). */
export const FINISHED_POSITIONS_KEPT = 6
/** Fight results a position keeps with their loot, newest last. A hero that fights for hours would
 * otherwise grow the open page without end; the won and lost counts keep every fight. */
export const FIGHT_RESULTS_KEPT = 24

/** What one hero won while this page followed its run. What entered the bag is the bag feed's.
 * `fights` are the fights the hero was seen seated in; `won` and `lost` are those whose result was told. */
export type PositionTotals = Readonly<{
  xp: bigint
  levels: number
  job_xp: bigint
  fights: readonly string[]
  won: readonly string[]
  lost: readonly string[]
}>
/** One ended fight of the hero: its side won or lost, the dungeon room it was, and its loot once rolled. */
export type FightResult = Readonly<{
  fight: string
  won: boolean
  room: number | null
  drops: readonly Readonly<{ item_type: string; qty: number }>[]
}>
/** Why a run that plays is not acting right now: one sentence each, `dapp_page.run_wait_<wait>`. */
export type RunWait = 'travel' | 'other'
type HeroSample = Readonly<{ experience: bigint; job_experience: bigint; level: number }>
export type DappPosition = Readonly<{
  id: string
  hero_id: string
  /** Null for a run whose tree was not bound from the shared catalogue. */
  activity: DappActivity | null
  /** What this page's Start asked for; null for a run found in an observation. */
  sent: StartSpec | null
  started_ms: number
  finished_ms: number | null
  /** Why its run ended by itself, one sentence each, `dapp_page.run_ended_<ended>`. Null while it runs,
   * after the player's stop, and when the bot named no reason this page lists. */
  ended: RunEnding | null
  /** The help this run last needed from the player; null while it plays and after a plain end. */
  notice: RunNotice | null
  /** Set while the run waits by itself and needs nothing from the player. */
  wait: RunWait | null
  /** The bot's own code or words for that blocker or wait: diagnostics, never text the player reads. */
  issue: string | null
  /** The title the run's author gave its goal. */
  objective: string | null
  /** Net network fees the run paid, in MIST, and the dungeon runs it saw end: the bot's last word. */
  fees_mist: bigint | null
  dungeon_runs: number | null
  totals: PositionTotals
  results: readonly FightResult[]
  sample: HeroSample | null
}>
const EMPTY_TOTALS: PositionTotals = Object.freeze({ xp: 0n, levels: 0, job_xp: 0n, fights: [], won: [], lost: [] })
const NO_RESULTS: readonly FightResult[] = Object.freeze([])
const gain = (next: bigint, previous: bigint): bigint => (next > previous ? next - previous : 0n)
const sample_of = (hero: Readonly<CharacterRow>): HeroSample => ({
  experience: hero_experience(hero),
  job_experience: job_experience(hero),
  level: hero.level,
})
/** What the bot says of one run, copied by value. */
type RunFacts = Readonly<
  Pick<DappPosition, 'activity' | 'notice' | 'wait' | 'issue' | 'objective' | 'fees_mist' | 'dungeon_runs'>
>
type Blocker = Pick<RunFacts, 'notice' | 'wait' | 'issue'>
const UNBLOCKED: Blocker = Object.freeze({ notice: null, wait: null, issue: null })
/** The bot's waiting codes the page has a sentence for. Any other wait is told without a reason. */
const WAITS: Readonly<Record<string, RunWait>> = Object.freeze({
  travel_not_ready: 'travel',
})
/** The game overlay's classifier decides what blocks a run: an ordinary wait is never a blocker. */
const blocker_of = ({ status, issue }: DappRun): Blocker => {
  const notice = run_notice(status, issue)
  if (notice) return { notice, wait: null, issue: issue ?? status }
  if (status !== 'waiting') return UNBLOCKED
  const [code = ''] = (issue ?? '').split(':', 1)
  return { notice: null, wait: Object.hasOwn(WAITS, code) ? WAITS[code]! : 'other', issue }
}
const run_facts = (run: DappRun): RunFacts => ({
  activity: strategy_activity(run.strategy),
  ...blocker_of(run),
  objective: run.objective,
  fees_mist: run.fees_mist,
  dungeon_runs: run.dungeon_runs,
})
const NO_FACTS: RunFacts = Object.freeze({
  ...UNBLOCKED,
  activity: null,
  objective: null,
  fees_mist: null,
  dungeon_runs: null,
})

export const open_position = (
  hero_id: string,
  now: number,
  heroes: readonly CharacterRow[],
  opened: Readonly<Partial<Pick<DappPosition, 'activity' | 'sent'>>> = {}
): DappPosition => {
  const hero = heroes.find(({ id }) => id === hero_id)
  return {
    id: `${hero_id}:${now}`,
    hero_id,
    ...NO_FACTS,
    sent: null,
    ...opened,
    started_ms: now,
    finished_ms: null,
    ended: null,
    totals: EMPTY_TOTALS,
    results: NO_RESULTS,
    sample: hero ? sample_of(hero) : null,
  }
}

const same_sample = (left: HeroSample, right: HeroSample): boolean =>
  (Object.keys(left) as readonly (keyof HeroSample)[]).every((key) => left[key] === right[key])
/** A fight is counted once, when its hero is first seen seated in it. */
const fights_with = (fights: readonly string[], fight_id: string | undefined): readonly string[] =>
  fight_id === undefined || fights.includes(fight_id) ? fights : [...fights, fight_id]
const with_gains = (
  totals: PositionTotals,
  previous: HeroSample,
  sample: HeroSample,
  fight_id: string | undefined
): PositionTotals => {
  const fights = fights_with(totals.fights, fight_id)
  if (same_sample(sample, previous) && fights === totals.fights) return totals
  return {
    ...totals,
    xp: totals.xp + gain(sample.experience, previous.experience),
    levels: totals.levels + Math.max(0, sample.level - previous.level),
    job_xp: totals.job_xp + gain(sample.job_experience, previous.job_experience),
    fights,
  }
}

type Told = Readonly<Pick<DappPosition, 'totals' | 'results'>>
/**
 * The game server lists an ended fight until it is settled, so the same row arrives many times. Its
 * result is told once, when the winner is first known, and its loot joins it when it is rolled.
 */
const with_result = (told: Told, row: Readonly<FightResolutionRow>): Told => {
  const { totals, results } = told
  const result = { fight: row.fight, won: row.winner === row.team, room: row.dungeon_room, drops: row.drops }
  const known = results.find(({ fight }) => fight === row.fight)
  if (known) {
    const rolled = known.drops.length === 0 && row.drops.length > 0
    return rolled ? { totals, results: results.map((entry) => (entry === known ? result : entry)) } : told
  }
  // A result that left the kept list was counted already.
  if ([...totals.won, ...totals.lost].includes(row.fight)) return told
  const side = result.won ? 'won' : 'lost'
  return {
    totals: { ...totals, [side]: [...totals[side], row.fight] },
    results: [...results, result].slice(-FIGHT_RESULTS_KEPT),
  }
}

/** A running position folds its hero's gains and fight results by value, so the same account seen
 * twice changes nothing. */
export const advance_position = (
  position: DappPosition,
  { characters, resolutions }: Readonly<Pick<DappAccount, 'characters' | 'resolutions'>>
): DappPosition => {
  const hero = characters.find(({ id }) => id === position.hero_id)
  if (position.finished_ms !== null || !hero) return position
  const sample = sample_of(hero)
  const previous = position.sample
  if (!previous) return { ...position, sample }
  const gained = with_gains(position.totals, previous, sample, hero.active_fight?.id)
  const { totals, results } = resolutions
    .filter(({ character, winner }) => character === hero.id && winner !== null)
    .reduce(with_result, { totals: gained, results: position.results })
  const same = totals === position.totals && results === position.results
  return same ? position : { ...position, sample, totals, results }
}

/** A finished position keeps what its run last said, but it waits for nothing any more. `ended` is the
 * reason of a run that ended by itself; a position that is already finished never takes a later one. */
export const finish_position = (position: DappPosition, now: number, ended: RunEnding | null = null): DappPosition =>
  position.finished_ms === null ? { ...position, finished_ms: now, wait: null, ended } : position

const same_facts = (position: DappPosition, facts: RunFacts): boolean =>
  (Object.keys(facts) as readonly (keyof RunFacts)[]).every((key) => position[key] === facts[key])
/**
 * A fresh observation is the truth of what runs: a followed run that is gone finishes its position,
 * with the reason the bot gives when the run ended by itself; a run this page does not follow yet
 * opens one, and every run says its own activity, blocker and fees.
 */
export const sync_positions = (
  positions: readonly DappPosition[],
  observation: DappObservation,
  heroes: readonly CharacterRow[],
  now: number
): readonly DappPosition[] => {
  const followed = positions.map((position) => {
    const run = observation.runs[position.hero_id]
    if (position.finished_ms !== null || !run)
      return finish_position(position, now, observation.ended[position.hero_id] ?? null)
    const facts = run_facts(run)
    return same_facts(position, facts) ? position : { ...position, ...facts }
  })
  const running = new Set(followed.flatMap(({ hero_id, finished_ms }) => (finished_ms === null ? [hero_id] : [])))
  const opened = Object.entries(observation.runs)
    .filter(([hero_id]) => !running.has(hero_id))
    .map(([hero_id, run]) => ({ ...open_position(hero_id, now, heroes), ...run_facts(run) }))
  return [...opened, ...followed]
}

/** Running positions first; the oldest finished ones beyond the review limit are dropped. */
export const retained_positions = (positions: readonly DappPosition[]): readonly DappPosition[] => {
  const running = positions.filter(({ finished_ms }) => finished_ms === null)
  const finished = positions
    .filter(({ finished_ms }) => finished_ms !== null)
    .toSorted((left, right) => (right.finished_ms ?? 0) - (left.finished_ms ?? 0))
    .slice(0, FINISHED_POSITIONS_KEPT)
  return [...running, ...finished]
}
