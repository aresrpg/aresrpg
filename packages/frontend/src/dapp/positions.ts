// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { CharacterRow, ItemRow } from '@aresrpg/protocol'

import { held_items, hero_experience, job_experience, type DappAccount } from './account.ts'
import type { DappObservation, DappRun } from './observation.ts'
import { strategy_activity, type DappActivity } from './strategies.ts'

/** Finished positions kept for review until dismissed (mockup round 9 ruling). */
export const FINISHED_POSITIONS_KEPT = 6

/** What one hero won while this page followed its run. The bag and the fees belong to the haul. */
export type PositionTotals = Readonly<{ xp: bigint; levels: number; job_xp: bigint; fights: readonly string[] }>
type HeroSample = Readonly<{ experience: bigint; job_experience: bigint; level: number }>
export type DappPosition = Readonly<{
  id: string
  hero_id: string
  /** Null for a run whose tree was not bound from the shared catalogue. */
  activity: DappActivity | null
  started_ms: number
  finished_ms: number | null
  /** The bot's last reported blocker for this run; null while it plays and after a plain end. */
  issue: string | null
  totals: PositionTotals
  sample: HeroSample | null
}>
/** What the heroes brought to the bot's shared bag and what its wallet paid, while any of them was out. */
export type DappHaul = Readonly<{
  found: Readonly<Record<string, number>>
  /** Everything that left the wallet: network fees, and what the owner bought or moved out. */
  spent_mist: bigint
  /** Units of the page's own purchase already left out of the finds, so each is left out once. */
  bought: Readonly<{ id: string; units: number }> | null
  sample: Readonly<{ rows: readonly ItemRow[]; balance_mist: bigint | null }>
}>

const EMPTY_TOTALS: PositionTotals = Object.freeze({ xp: 0n, levels: 0, job_xp: 0n, fights: [] })
const gain = (next: bigint, previous: bigint): bigint => (next > previous ? next - previous : 0n)
const sample_of = (hero: Readonly<CharacterRow>): HeroSample => ({
  experience: hero_experience(hero),
  job_experience: job_experience(hero),
  level: hero.level,
})
const blocker_of = (run: DappRun): string | null => (run.status === 'awaiting_ai' ? (run.issue ?? run.status) : null)

export const open_position = (
  hero_id: string,
  activity: DappActivity | null,
  now: number,
  heroes: readonly CharacterRow[]
): DappPosition => {
  const hero = heroes.find(({ id }) => id === hero_id)
  return {
    id: `${hero_id}:${now}`,
    hero_id,
    activity,
    started_ms: now,
    finished_ms: null,
    issue: null,
    totals: EMPTY_TOTALS,
    sample: hero ? sample_of(hero) : null,
  }
}

const same_sample = (left: HeroSample, right: HeroSample): boolean =>
  (Object.keys(left) as readonly (keyof HeroSample)[]).every((key) => left[key] === right[key])
/** A fight is counted once, when its hero is first seen seated in it. */
const fights_with = (fights: readonly string[], fight_id: string | undefined): readonly string[] =>
  fight_id === undefined || fights.includes(fight_id) ? fights : [...fights, fight_id]
/** A running position folds its hero's gains by value, so the same hero row seen twice changes nothing. */
export const advance_position = (position: DappPosition, heroes: readonly CharacterRow[]): DappPosition => {
  const hero = heroes.find(({ id }) => id === position.hero_id)
  if (position.finished_ms !== null || !hero) return position
  const sample = sample_of(hero)
  const previous = position.sample
  if (!previous) return { ...position, sample }
  const { totals } = position
  const fights = fights_with(totals.fights, hero.active_fight?.id)
  if (same_sample(sample, previous) && fights === totals.fights) return position
  return {
    ...position,
    sample,
    totals: {
      xp: totals.xp + gain(sample.experience, previous.experience),
      levels: totals.levels + Math.max(0, sample.level - previous.level),
      job_xp: totals.job_xp + gain(sample.job_experience, previous.job_experience),
      fights,
    },
  }
}

export const finish_position = (position: DappPosition, now: number): DappPosition =>
  position.finished_ms === null ? { ...position, finished_ms: now } : position

/**
 * A fresh observation is the truth of what runs: a followed run that is gone finishes its position,
 * a run this page does not follow yet opens one, and every run says its own activity and blocker.
 */
export const sync_positions = (
  positions: readonly DappPosition[],
  observation: DappObservation,
  heroes: readonly CharacterRow[],
  now: number
): readonly DappPosition[] => {
  const followed = positions.map((position) => {
    const run = observation.runs[position.hero_id]
    if (position.finished_ms !== null || !run) return finish_position(position, now)
    const [issue, activity] = [blocker_of(run), strategy_activity(run.strategy)]
    return issue === position.issue && activity === position.activity ? position : { ...position, issue, activity }
  })
  const running = new Set(followed.flatMap(({ hero_id, finished_ms }) => (finished_ms === null ? [hero_id] : [])))
  const opened = Object.entries(observation.runs)
    .filter(([hero_id]) => !running.has(hero_id))
    .map(([hero_id, run]) => ({
      ...open_position(hero_id, strategy_activity(run.strategy), now, heroes),
      issue: blocker_of(run),
    }))
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

/** A purchase this page asked for. Its units enter the bag like a find, and are not one. */
export type HaulPurchase = Readonly<{ id: string; item_type: string; amount: number }>
const found_items = (
  found: DappHaul['found'],
  previous: Readonly<Record<string, number>>,
  next: Readonly<Record<string, number>>,
  bought: Readonly<Record<string, number>>
): DappHaul['found'] => {
  const gains = Object.entries(next)
    .map(([type, amount]) => [type, amount - (previous[type] ?? 0) - (bought[type] ?? 0)] as const)
    .filter(([, gained]) => gained > 0)
  if (!gains.length) return found
  return Object.fromEntries([
    ...Object.entries(found),
    ...gains.map(([type, gained]) => [type, (found[type] ?? 0) + gained] as const),
  ])
}
/**
 * The bag's gains as finds, minus the page's own purchase. Each bought unit is left out once: the
 * haul remembers how many it already left out, so a bought item that is spent and won again counts
 * as the find it is.
 */
const haul_finds = (
  haul: DappHaul,
  previous: Readonly<Record<string, number>>,
  next: Readonly<Record<string, number>>,
  purchase: HaulPurchase | null
): Pick<DappHaul, 'found' | 'bought'> => {
  if (!purchase) return { found: found_items(haul.found, previous, next, {}), bought: haul.bought }
  const { id, item_type, amount } = purchase
  const left_out = haul.bought?.id === id ? haul.bought.units : 0
  const gained = (next[item_type] ?? 0) - (previous[item_type] ?? 0)
  const units = Math.max(0, Math.min(gained, amount - left_out))
  return {
    found: found_items(haul.found, previous, next, { [item_type]: units }),
    bought: units ? { id, units: left_out + units } : haul.bought,
  }
}

/** What left the wallet between two known balances; an unknown balance proves no payment. */
const paid = (before: bigint | null, after: bigint | null): bigint =>
  before !== null && after !== null ? gain(before, after) : 0n
/**
 * The haul folds increases of the bag only, and only while a hero is out: deposits, sales and
 * transfers never erase it, and an idle bag only moves its baseline. A bag not read yet moves nothing.
 * What this page bought is not a find: the units of its own purchase are left out.
 */
export const advance_haul = (
  haul: DappHaul | null,
  account: DappAccount,
  out: boolean,
  purchase: HaulPurchase | null = null
): DappHaul | null => {
  if (account.phase !== 'ready') return haul
  const sample = { rows: account.inventory, balance_mist: account.sui_balance_mist }
  if (!haul) return out ? { found: {}, spent_mist: 0n, bought: null, sample } : null
  const { rows, balance_mist } = haul.sample
  if (rows === sample.rows && balance_mist === sample.balance_mist) return haul
  if (!out) return { ...haul, sample }
  return {
    ...haul_finds(haul, held_items(rows), held_items(sample.rows), purchase),
    spent_mist: haul.spent_mist + paid(balance_mist, sample.balance_mist),
    sample,
  }
}
