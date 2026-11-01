// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Compact adaptation of @MidwestGentleman's read-only Skills tab: https://github.com/aresrpg/aresrpg/pull/2355
import { job_groups, type JobKind } from '@aresrpg/immutable'
import type { CharacterRow } from '@aresrpg/protocol'

import { copy_text, type AppCopy } from '../i18n/copy.ts'
import { useNumbers } from '../i18n/useNumbers.ts'

import { JobEmblem } from './JobEmblem.tsx'
import { job_progress } from './job_progress.ts'

const job_kinds = Object.keys(job_groups) as JobKind[]

/** One line per profession, grouped by the same job families as the encyclopedia. */
export const SkillsPanel = ({ character, copy }: Readonly<{ character: Readonly<CharacterRow>; copy: AppCopy }>) => {
  const t = copy_text(copy.characters_page)
  const jobs = copy_text(copy.leaderboard_page)
  const families = copy_text(copy.encyclopedia_page)
  const numbers = useNumbers()
  return (
    <div className="chr-professions">
      {job_kinds.map((kind) => (
        <section className="chr-profession-group" key={kind} aria-label={families(`job_category.${kind}`)}>
          <h4 aria-hidden="true">{families(`job_category.${kind}`)}</h4>
          {job_groups[kind].map((job) => {
            const { level, into, span, percent } = job_progress(Number(character.jobs[job] ?? 0))
            const name = jobs(`job_${job}`)
            const progress =
              span > 0
                ? t('jobs.detail.xp_progress', { current: numbers.number(into), needed: numbers.number(span) })
                : t('common.max')
            return (
              <div className="chr-profession" data-skill={job} data-max={span === 0 || undefined} key={job}>
                <JobEmblem job={job} />
                <strong>{name}</strong>
                <span className="chr-profession-level">{t('jobs.lv_badge', { level })}</span>
                <progress aria-label={`${name} · ${progress}`} max={100} value={percent} />
                <small>{progress}</small>
              </div>
            )
          })}
        </section>
      ))}
    </div>
  )
}
