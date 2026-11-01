// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Adapted from @MidwestGentleman's contribution: https://github.com/aresrpg/aresrpg/pull/2355
import { job_level_from_xp, job_max_level, job_xp_for_level } from '@aresrpg/immutable'

/** The Jobs window and read-only profession overview share the same level-relative XP. */
export const job_progress = (experience: number) => {
  const level = job_level_from_xp(experience)
  const floor = job_xp_for_level(level) ?? 0
  const ceiling = level >= job_max_level ? floor : (job_xp_for_level(level + 1) ?? floor)
  const span = Math.max(0, ceiling - floor)
  const into = Math.max(0, experience - floor)
  const percent = span > 0 ? Math.max(0, Math.min(100, (into / span) * 100)) : 100
  return Object.freeze({ level, into, span, percent })
}
