// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { job_slugs, job_level_from_xp, job_xp_for_level, job_max_level } from '@aresrpg/immutable'

const MAX_JOB_XP = job_xp_for_level(job_max_level)!

// Clamp decimal u64 strings before graph integer conversion, including values above i64.
export const PROFILE_JOB_COLUMNS = job_slugs
  .map((job) => {
    const property = `coalesce(c.job_${job.toLowerCase()}, '0')`
    return `max(CASE WHEN size(${property}) > ${String(MAX_JOB_XP).length} THEN ${MAX_JOB_XP} ELSE toInteger(${property}) END) AS ${job}`
  })
  .join(', ')

export const profile_jobs = (row: Readonly<Record<string, unknown>>) =>
  job_slugs.map((job) => ({ job, level: job_level_from_xp(Number(row[job] ?? 0)) }))
