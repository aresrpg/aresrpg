// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Read-only job progress for the Stats window's Skills tab.

import {
  job_groups,
  job_level_from_xp,
  job_max_level,
  job_xp_for_level,
  type JobKind,
  type JobSlug,
} from '@aresrpg/immutable'
import type { CharacterRow } from '@aresrpg/protocol'

type SkillCharacter = Readonly<Pick<CharacterRow, 'id' | 'name' | 'jobs'>>

export type JobProgress = Readonly<{ level: number; into: number; span: number; percent: number }>

/** Level plus progress inside it; `span` is 0 at the max level. */
export const job_progress = (experience: number): JobProgress => {
  const level = job_level_from_xp(experience)
  const floor = job_xp_for_level(level) ?? 0
  const ceiling = level >= job_max_level ? floor : (job_xp_for_level(level + 1) ?? floor)
  const span = Math.max(0, ceiling - floor)
  const into = Math.max(0, experience - floor)
  const percent = span > 0 ? Math.max(0, Math.min(100, (into / span) * 100)) : 100
  return Object.freeze({ level, into, span, percent })
}

const progress_of = (character: SkillCharacter, job: JobSlug): JobProgress =>
  job_progress(Number(character.jobs[job] ?? 0))

export const skill_groups = (character: SkillCharacter) =>
  Object.freeze(
    (Object.keys(job_groups) as JobKind[]).map((kind) =>
      Object.freeze({
        kind,
        jobs: job_groups[kind].map((job) => Object.freeze({ job, progress: progress_of(character, job) })),
      })
    )
  )

/** Which crafting note fits: the viewed character is the craft-lock crafter, someone else is, or no lock. */
export const crafter_note = (
  viewed_id: string,
  crafter_id: string | null | undefined,
  roster: readonly SkillCharacter[]
): Readonly<{ key: 'crafter_self' | 'crafter_other'; crafter: string }> | null => {
  const crafter = crafter_id ? roster.find(({ id }) => id === crafter_id) : undefined
  if (!crafter) return null
  return Object.freeze({ key: crafter.id === viewed_id ? 'crafter_self' : 'crafter_other', crafter: crafter.name })
}
