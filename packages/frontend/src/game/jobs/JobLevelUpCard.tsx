// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { Sparkles } from 'lucide-react'
import { useEffect } from 'react'

import { titleize } from '../../content/catalog.ts'
import { play_procedural_cue } from '../audio/procedural_cues.ts'
import { copy_text, type AppCopy } from '../../i18n/copy.ts'
import { dispatch_app, useAppStore } from '../../store.ts'

import './job_level_up.css'

export const JobLevelUpCard = ({ copy }: Readonly<{ copy: AppCopy }>) => {
  const level_up = useAppStore(({ job_level_up }) => job_level_up.current)
  const text = copy_text(copy.characters_page)
  useEffect(() => {
    if (level_up) play_procedural_cue('level_up')
  }, [level_up])
  if (!level_up) return null
  return (
    <section aria-label={text('jobs.level_up_title')} aria-modal="true" className="joblvl-stage" role="dialog">
      <div className="joblvl-card">
        <div aria-hidden="true" className="joblvl-grid" />
        <div aria-hidden="true" className="joblvl-glow" />
        <div className="joblvl-label">
          <Sparkles size={13} /> {text('jobs.level_up_title')}
        </div>
        <div className="joblvl-level">
          <span>{text('jobs.level_up_reached')}</span>
          <strong>{level_up.level_after}</strong>
        </div>
        <div className="joblvl-job">{titleize(level_up.job)}</div>
        <div className="joblvl-character">{text('jobs.level_up_character', { name: level_up.character_name })}</div>
        <div className="joblvl-progress">
          {text('jobs.level_up_progress', {
            before: level_up.level_before,
            after: level_up.level_after,
          })}
        </div>
        <button onClick={() => dispatch_app({ type: 'job_level_up/acknowledged' })} type="button">
          {text('jobs.level_up_continue')}
        </button>
      </div>
    </section>
  )
}
