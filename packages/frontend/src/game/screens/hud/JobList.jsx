// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The Jobs drawer's LEFT rail — every job grouped by its category, each row a selectable button with a
// per-job level chip. Split out of JobsDrawer.jsx (issue #2052); the component is unchanged.
import { JOBS, JOB_CATEGORY, job_level_progress } from '@aresrpg/sdk/jobs'

import { JobGlyph, covers_label } from './jobs_visuals.jsx'
import i18n from '../../../i18n'
import './hud-panels.css'
import './jobs.css'

const CATEGORY_ORDER = /** @type {const} */ ([
  { key: JOB_CATEGORY.GATHERING, label_key: 'jobs.category.gathering' },
  { key: JOB_CATEGORY.WEAPON, label_key: 'jobs.category.weapon' },
  { key: JOB_CATEGORY.EQUIPMENT, label_key: 'jobs.category.equipment' },
  { key: JOB_CATEGORY.CONSUMABLE, label_key: 'jobs.category.consumable' },
])

/**
 * LEFT rail — jobs grouped by category, each a selectable row with a level chip.
 * @param {{
 *   selected_id: string,
 *   job_xp: Record<string, number>,
 *   active_job_id: string | null,
 *   on_select: (id: string) => void,
 * }} props
 */
export function JobList({ selected_id, job_xp, active_job_id, on_select }) {
  return (
    <div className="jobs__list">
      {CATEGORY_ORDER.map(({ key, label_key }) => {
        const jobs = JOBS.filter((j) => j.category === key)
        if (!jobs.length) return null
        return (
          <div key={key} className="jobs__list-group">
            <div className="jobs__list-head">
              <span className="jobs__list-glyph" aria-hidden="true">
                <JobGlyph kind={/** @type {any} */ (key)} />
              </span>
              {i18n.t(label_key)}
            </div>
            {jobs.map((job) => {
              const { level } = job_level_progress(job_xp[job.id] ?? 0)
              const is_selected = selected_id === job.id
              return (
                <button
                  key={job.id}
                  type="button"
                  className={`jobs__list-row${is_selected ? ' is-selected' : ''}`}
                  onClick={() => on_select(job.id)}
                >
                  <span className="jobs__list-id">
                    <span className="jobs__list-name">{job.label}</span>
                    <span className="jobs__list-sub">
                      {job.category === JOB_CATEGORY.GATHERING
                        ? job.tool
                        : covers_label(job.covers) || i18n.t('jobs.recipes_fallback')}
                    </span>
                  </span>
                  {active_job_id === job.id && <span className="jobs__list-tag">{i18n.t('jobs.equipped')}</span>}
                  <span className="jobs__list-lvl hud-num">{level}</span>
                </button>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}
