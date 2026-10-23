// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Stats window Skills tab: read-only job levels, so the craft lock never hides another character's jobs.

import type { CharacterRow } from '@aresrpg/protocol'

import { copy_text, type AppCopy } from '../i18n/copy.ts'
import { useNumbers } from '../i18n/useNumbers.ts'
import { useVocabulary } from '../i18n/useVocabulary.ts'

import { JobEmblem } from './JobEmblem.tsx'
import { CATEGORY_LABEL_KEY, covers_label } from './job_labels.ts'
import { skill_groups, type JobProgress, type crafter_note } from './skill_rows.ts'

import './skills.css'

export const SkillsNote = ({
  character,
  note,
  copy,
}: Readonly<{ character: Readonly<CharacterRow>; note: ReturnType<typeof crafter_note>; copy: AppCopy }>) => {
  const t = copy_text(copy.characters_page)
  return (
    <footer className="aui-character-points chr-skills-note">
      <span>
        {note ? t(`stats.${note.key}`, { name: character.name, crafter: note.crafter }) : t('stats.skills_no_crafter')}
      </span>
    </footer>
  )
}

export const SkillsPanel = ({ character, copy }: Readonly<{ character: Readonly<CharacterRow>; copy: AppCopy }>) => {
  const t = copy_text(copy.characters_page)
  const vocabulary = useVocabulary()
  const numbers = useNumbers()
  const xp_text = ({ into, span }: JobProgress): string =>
    span > 0
      ? t('jobs.detail.xp_progress', { current: numbers.number(into), needed: numbers.number(span) })
      : t('common.max')
  return (
    <div className="chr-skills">
      {skill_groups(character).map(({ kind, jobs }) => (
        <section className="chr-skills-group" key={kind}>
          <h4>
            {t(CATEGORY_LABEL_KEY[kind])}
            <small>{covers_label(copy, kind)}</small>
          </h4>
          {jobs.map(({ job, progress }) => (
            <div className="chr-skill-row" data-skill={job} key={job}>
              <JobEmblem job={job} />
              <strong className="chr-skill-name">{vocabulary.job(job)}</strong>
              <span className="chr-skill-level hud-num">{t('jobs.lv_badge', { level: progress.level })}</span>
              <span className="chr-skill-progress" title={xp_text(progress)}>
                <span className="chr-skill-bar" aria-hidden="true">
                  <span style={{ width: `${progress.percent}%` }} />
                </span>
                <small className="hud-num">{xp_text(progress)}</small>
              </span>
            </div>
          ))}
        </section>
      ))}
    </div>
  )
}
