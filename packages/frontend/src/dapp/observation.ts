// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { run_ending, type RunEnding } from '@aresrpg/protocol'
import { run_live } from '@aresrpg/protocol/strategies'

/** One hero's hosted behaviour tree. `awaiting_ai` means the bot cannot continue it by itself.
 * `strategy` is the catalogue entry the bot says the tree was bound from; an authored tree has none. */
export type DappRun = Readonly<{
  status: string | null
  issue: string | null
  strategy: string | null
  /** The title its author gave the run's goal; null for a run of a retired shape. */
  objective: string | null
  /** Net network fees the run paid since its tree was started or replaced, in MIST. A storage rebate
   * can make it negative. Null from a bot that reports none. */
  fees_mist: bigint | null
  /** Dungeon runs the run saw end since its tree was started or replaced; null when not reported. */
  dungeon_runs: number | null
}>
/** The wallet's one direct command with its outcome; a sent command is followed here, never sent again. */
export type DappDirect = Readonly<{
  id: string
  kind: string
  status: string
  error: string | null
  payload: Readonly<Record<string, unknown>>
}>
/** What only the bot knows about its wallet: its runs and its one direct command.
 * Heroes, bag, balance and market offers are chain facts and come from the game socket.
 * The bot pushes it through the game server on change; a read of the bot returns the same shape. */
export type DappObservation = Readonly<{
  ready: boolean
  /** The bot's own order of two observations: its owner process first, then that process's clock. */
  fence: number
  sampled_at: number
  direct: DappDirect | null
  /** Every run the wallet hosts and still plays or holds its hero, by hero, whichever client started it. */
  runs: Readonly<Record<string, DappRun>>
  /** Why the last run of a hero ended by itself, by hero. The bot tells it until that hero starts again. */
  ended: Readonly<Record<string, RunEnding>>
  /** Net network fees of every transaction this wallet's bot settled, in MIST; null when not reported. */
  fees_mist: bigint | null
}>
/** The wallet revisions a command is admitted under; they come only from a read made for that command. */
export type DappRevisions = Readonly<{ decision_revision: number; observation_revision: number }>

/** The bot answers `status: pending` until its authenticated baseline is ready: nothing is known yet. */
const PENDING: DappObservation = Object.freeze({
  ready: false,
  fence: 0,
  sampled_at: 0,
  direct: null,
  runs: {},
  ended: {},
  fees_mist: null,
})

const record = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
const revision = (value: unknown): number | null =>
  Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : null
const text = (value: unknown): string | null => (typeof value === 'string' ? value : null)

/** A fee is optional on the wire and a signed decimal when present; a count is a whole number. */
const valid_mist = (value: unknown): boolean => value === undefined || /^-?\d+$/.test(text(value) ?? '')
const valid_count = (value: unknown): boolean => value === undefined || revision(value) !== null
const mist = (value: unknown): bigint | null => (typeof value === 'string' ? BigInt(value) : null)
/** An ending is optional on the wire and a code when present. */
const valid_ending = (value: unknown): boolean => value === undefined || text(value) !== null
const valid_run = (value: unknown): boolean => {
  const run = record(value)
  return [valid_mist(run?.fees_mist), valid_count(run?.dungeon_runs), valid_ending(run?.ended)].every(Boolean)
}

const hosted_run = (run: Readonly<Record<string, unknown>> | null, status: string): DappRun => ({
  status,
  issue: text(run?.issue),
  strategy: text(run?.strategy),
  objective: text(record(run?.objective)?.title),
  fees_mist: mist(run?.fees_mist),
  dungeon_runs: revision(run?.dungeon_runs),
})
/** The bot lists a stopped or ended run until its next queue pass; only a live run holds its hero. */
const runs_of = (rows: readonly unknown[]): DappObservation['runs'] =>
  Object.fromEntries(
    rows.flatMap((value) => {
      const run = record(value)
      const [hero_id, status] = [text(run?.character_id), text(run?.status)]
      return hero_id && status && run_live({ status }) ? [[hero_id, hosted_run(run, status)] as const] : []
    })
  )

/** A run that ended by itself says why. A code this page does not list explains nothing: a plain end. */
const ended_of = (rows: readonly unknown[]): DappObservation['ended'] =>
  Object.fromEntries(
    rows.flatMap((value) => {
      const run = record(value)
      const [hero_id, ending] = [text(run?.character_id), run_ending(run?.ended)]
      return hero_id && ending ? [[hero_id, ending] as const] : []
    })
  )

const direct_of = (value: unknown): DappDirect | null => {
  const command = record(value) ?? {}
  const [id, kind, status] = [command.id, command.kind, command.status].map(text)
  const payload = record(command.payload)
  return id && kind && status && payload ? { id, kind, status, error: text(command.error), payload } : null
}
/** Game data is untrusted observation: an unknown shape is no observation, never zeros. */
export const parse_observation = (value: unknown): DappObservation | null => {
  const raw = record(value) ?? {}
  if (raw.status === 'pending') return PENDING
  const fence = revision(raw.event_fence)
  if (fence === null || !Number.isFinite(raw.sampled_at) || !Array.isArray(raw.runs)) return null
  // One malformed figure or ending refuses the whole status: a fee is never shown beside a guess.
  if (!valid_mist(raw.fees_mist) || !raw.runs.every(valid_run)) return null
  return {
    ready: raw.ready === true,
    fence,
    sampled_at: Number(raw.sampled_at),
    direct: direct_of(raw.direct),
    runs: runs_of(raw.runs),
    ended: ended_of(raw.runs),
    fees_mist: mist(raw.fees_mist),
  }
}
export const parse_revisions = (value: unknown): DappRevisions | null => {
  const raw = record(value) ?? {}
  const [decision_revision, observation_revision] = [raw.decision_revision, raw.observation_revision].map(revision)
  return decision_revision === null || observation_revision === null
    ? null
    : { decision_revision, observation_revision }
}
/** The later of two observations of one wallet, by the bot's own order. */
export const newest_observation = (current: DappObservation | null, next: DappObservation): DappObservation => {
  if (!current) return next
  const later = next.fence === current.fence ? next.sampled_at >= current.sampled_at : next.fence > current.fence
  return later ? next : current
}
