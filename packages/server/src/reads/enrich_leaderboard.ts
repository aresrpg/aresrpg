// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { job_slugs, job_level_from_xp, job_xp_for_level, job_max_level } from '@aresrpg/immutable'
import type { LeaderboardEntry, LeaderboardSnapshot } from '@aresrpg/protocol'

import type { Graph } from '../graph.ts'
import type { ResolveName } from '../suins.ts'
import logger from '../logger.ts'

const log = logger(import.meta)
const ENRICHMENT_BUDGET_MS = 250

const MAX_JOB_XP = job_xp_for_level(job_max_level)!

/** Character badges are current presentation. Neither their presence nor their count gates rank. */
export const enrich_leaderboard = async (
  graph: Graph,
  resolve_name: ResolveName,
  snapshot: LeaderboardSnapshot
): Promise<LeaderboardSnapshot> => {
  const entries = snapshot.self ? [...snapshot.entries, snapshot.self] : snapshot.entries
  const addresses = [...new Set(entries.map(({ address }) => address))]
  let timer: ReturnType<typeof setTimeout>
  const deadline = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, ENRICHMENT_BUDGET_MS)
  })
  const within = <T>(read: () => Promise<T>, fallback: T): Promise<T> => {
    const result = Promise.resolve()
      .then(read)
      .catch((error: unknown) => {
        log.warn(
          { error: error instanceof Error ? error.message : String(error) },
          'leaderboard enrichment read failed'
        )
        return fallback
      })
    return Promise.race([result, deadline.then(() => fallback)])
  }
  const names_read = Promise.all(
    addresses.map(async (address) => [address, await within(() => resolve_name(address), null)] as const)
  )
  const rows_read =
    snapshot.observation.metric === 'xp' && addresses.length
      ? within(
          () =>
            graph.read(
              `MATCH (c:Character) WHERE c.owner IN $addresses
       WITH c ORDER BY c.level DESC, size(c.experience) DESC, c.experience DESC, c.id
       RETURN c.owner AS address, count(c) AS total,
              collect({name: c.name, classe: c.classe, level: c.level})[0..6] AS characters`,
              { addresses }
            ),
          []
        )
      : Promise.resolve([])
  const jobs_read =
    snapshot.observation.metric === 'jobs' && addresses.length
      ? within(
          () =>
            graph.read(
              `MATCH (c:Character) WHERE c.owner IN $addresses RETURN c.owner AS address, ${job_slugs
                .map((job) => {
                  const property = `coalesce(c.job_${job.toLowerCase()}, '0')`
                  // Clamp values wider than the final level threshold before graph integer conversion.
                  return `max(CASE WHEN size(${property}) > ${String(MAX_JOB_XP).length} THEN ${MAX_JOB_XP} ELSE toInteger(${property}) END) AS ${job}`
                })
                .join(', ')}`,
              { addresses }
            ),
          []
        )
      : Promise.resolve([])
  const [name_rows, rows, job_rows] = await Promise.all([names_read, rows_read, jobs_read]).finally(() =>
    clearTimeout(timer)
  )
  const names = new Map(name_rows)
  const jobs = new Map(
    job_rows.map((row) => [
      String(row.address),
      job_slugs
        .map((job) => ({
          job,
          level: job_level_from_xp(Number(row[job] ?? 0)),
        }))
        .filter(({ level }) => level > 1),
    ])
  )
  const badges = new Map(rows.map((row) => [String(row.address), row]))
  const enrich = (entry: LeaderboardEntry): LeaderboardEntry => ({
    ...entry,
    jobs: jobs.get(entry.address) ?? [],
    name: names.get(entry.address) ?? null,
    characters: (badges.get(entry.address)?.characters ?? []) as LeaderboardEntry['characters'],
    character_count: Number(badges.get(entry.address)?.total ?? 0),
  })
  return { ...snapshot, entries: snapshot.entries.map(enrich), self: snapshot.self ? enrich(snapshot.self) : null }
}
