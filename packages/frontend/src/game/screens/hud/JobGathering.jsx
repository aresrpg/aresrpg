// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The Jobs drawer's GATHERING surfaces — the 11-tier resource table and the Gather affordance a
// gathering job's detail stacks above it. Split out of JobsDrawer.jsx (issue #2052); both components
// are unchanged.
import { useEffect, useRef, useState } from 'react'

import {
  GATHER_RESOURCES,
  tier_to_level,
  gather_xp,
  gather_amount,
  gather_time,
  respawn_secs,
} from '@aresrpg/sdk/jobs'

import { use_game_state, context } from '../../store.js'
import { ItemIcon } from './jobs_visuals.jsx'
import i18n from '../../../i18n'
import './hud-panels.css'
import './jobs.css'

/** Flat resource lookup by id (== items.json id), across all 3 gathering jobs. */
const RESOURCE_BY_ID = /** @type {Record<string, { id: string, name: string, tier: number, icon: string }>} */ (
  Object.values(GATHER_RESOURCES)
    .flat()
    .reduce((map, res) => ({ ...map, [res.id]: res }), {})
)

/**
 * Gathering tiers table (Tier | Req level | Resource | Yield | XP per harvest), locked tiers greyed.
 * The YIELD is the live per-harvest quantity range at the player's current job level (gather_amount,
 * which widens as the job out-levels the tier); a per-row tooltip carries the full gather detail
 * (yield, xp, gather time, respawn). Gathering jobs show their 11-tier table, locked tiers
 * greyed with the required level.
 * @param {{
 *   job: import('@aresrpg/sdk/jobs').JobDef,
 *   level: number,
 *   on_select: (item_id: string) => void,
 *   selected_id?: string | null,
 * }} props
 */
export function ResourceTable({ job, level, on_select, selected_id = null }) {
  const resources = GATHER_RESOURCES[job.id] ?? []
  // Clicking a resource opens its detail in the RIGHT-SECTION (the encyclopedia ItemDetailView), NOT a
  // modal/little-card. All 33 gather resources resolve to a seeded items.json id.
  return (
    <div className="jobs__table">
      <div className="jobs__table-head">
        <span className="jobs__col-tier">{i18n.t('jobs.table.tier')}</span>
        <span className="jobs__col-req">{i18n.t('jobs.table.req_lvl')}</span>
        <span className="jobs__col-name">{i18n.t('jobs.table.resource')}</span>
        <span className="jobs__col-yield">{i18n.t('jobs.table.yield')}</span>
        <span className="jobs__col-xp">{i18n.t('jobs.table.xp')}</span>
      </div>
      {resources.map((res) => {
        const req = tier_to_level(res.tier)
        const locked = level < req
        const [min, max] = gather_amount(level, req)
        const yield_text = locked ? '-' : min === max ? `${min}` : `${min}-${max}`
        return (
          <button
            key={res.id}
            type="button"
            className={`jobs__table-row${locked ? ' is-locked' : ''}${res.id === selected_id ? ' is-selected' : ''}`}
            onClick={() => on_select(res.id)}
            title={
              locked
                ? i18n.t('jobs.table.unlocks_at', { name: res.name, level: req })
                : i18n.t('jobs.table.gather_detail', {
                    name: res.name,
                    gather: gather_time(level),
                    respawn: respawn_secs(req, job.id),
                  })
            }
          >
            <span className="jobs__col-tier hud-num">{i18n.t('jobs.tier_badge', { tier: res.tier })}</span>
            <span className="jobs__col-req hud-num">{i18n.t('jobs.lv_badge', { level: req })}</span>
            <span className="jobs__col-name">
              <ItemIcon icon={res.icon} size={24} />
              {res.name}
            </span>
            <span className="jobs__col-yield hud-num">
              {locked ? i18n.t('jobs.table.locked') : `x${yield_text}`}
            </span>
            <span className="jobs__col-xp hud-num">{locked ? '-' : `+${gather_xp(req)}`}</span>
          </button>
        )
      })}
    </div>
  )
}

/**
 * The Gather affordance (Wave GATHER), shown in a gathering job's detail. It targets the world node the
 * player SELECTED (state.gather_target, set by clicking a node in the roam world). When that node belongs
 * to THIS job: a "Gather <Resource>" accent button that re-issues the walk-in + harvest intent (the roam
 * scene listens for action/gather_target and walks the avatar into range). While a harvest of THIS job is
 * running (state.gather.active) it shows a live progress bar instead — the SERVER is the authority; the bar
 * just extrapolates per_ms + started_at_ms (the same clock the 3D ring uses). With nothing selected it
 * shows a one-line hint. House design: ice-blue accent, mono nums, no pills.
 * @param {{ job: import('@aresrpg/sdk/jobs').JobDef }} props
 * @returns {import('react').JSX.Element}
 */
export function GatherBar({ job }) {
  const gather = use_game_state((s) => s.gather)
  const gather_target = use_game_state((s) => s.gather_target)
  // A local clock so the active harvest bar advances smoothly between server pushes.
  const [, force] = useState(0)
  const raf = useRef(/** @type {number | null} */ (null))
  const active = !!(gather?.active && gather.job_id === job.id)
  useEffect(() => {
    if (!active) return undefined
    const tick = () => {
      force((n) => (n + 1) % 1_000_000)
      raf.current = requestAnimationFrame(tick)
    }
    raf.current = requestAnimationFrame(tick)
    return () => {
      if (raf.current != null) cancelAnimationFrame(raf.current)
    }
  }, [active, gather?.started_at_ms])

  if (gather && gather.active && gather.job_id === job.id) {
    const res = RESOURCE_BY_ID[gather.resource_id]
    const pct = Math.max(0, Math.min(100, ((Date.now() - gather.started_at_ms) / Math.max(1, gather.per_ms)) * 100))
    return (
      <div className="jobs__gather is-active">
        <span className="jobs__gather-label">
          {i18n.t('jobs.gather.in_progress', { name: res?.name ?? gather.resource_id })}
        </span>
        <div className="jobs__gather-bar">
          <div className="jobs__gather-fill" style={{ width: `${pct}%` }} />
        </div>
      </div>
    )
  }

  const target = gather_target?.job_id === job.id ? gather_target : null
  if (target) {
    const res = RESOURCE_BY_ID[target.resource_id]
    return (
      <div className="jobs__gather">
        <button
          type="button"
          className="hud-btn hud-btn--accent jobs__gather-btn"
          onClick={() => context.dispatch('action/gather_target', target)}
        >
          {i18n.t('jobs.gather.button', { name: res?.name ?? target.resource_id })}
        </button>
        <span className="jobs__gather-hint hud-num">{i18n.t('jobs.tier_badge', { tier: target.tier })}</span>
      </div>
    )
  }

  return (
    <div className="jobs__gather">
      <span className="jobs__gather-hint">{i18n.t('jobs.gather.hint', { job: job.label })}</span>
    </div>
  )
}
