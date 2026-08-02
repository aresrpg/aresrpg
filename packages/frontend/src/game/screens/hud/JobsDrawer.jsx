// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Jobs drawer body — a master/detail panel ported from the aresrpg companion encyclopedia JOBS tab
// (../../aresrpg/packages/frontend/src/pages/encyclopedia/jobs_tab.tsx): a LEFT job-list rail
// (grouped by the 4 categories, with a per-job level chip) + a RIGHT detail panel (job header, XP
// bar, and stacked Resources / Recipes sections). Restyled to the house glass + ice-blue tokens
// (mono tabular nums, hairline dividers). Every craft job shows ALL RECIPES,
// both UNLOCKED and LOCKED (locked greyed with the unlock level); gathering jobs show their 11-tier
// resource table (locked tiers greyed with the required level).
//
// The sections live in sibling files (split for the 600-LoC house budget, issue #2052): the left rail is
// JobList.jsx, the gathering table + Gather affordance are JobGathering.jsx, the recipe grid + craft
// controls are JobCraft.jsx, the right-section item detail is JobItemDetail.jsx, and the render
// primitives they share are jobs_visuals.jsx. This file owns the two composers — JobDetail and the
// drawer itself.
//
// SSOT: job definitions + the XP curve + gathering formulas live in @aresrpg/sdk/jobs (ported 1:1 from
// the reference corpus's Job.java / JobExperience.java / GatheringFormulas.java; the 11-tier gatherables
// ride along). This component renders them — it computes no balance.
//
// RECIPES ARE CHAIN TRUTH (issue #765): the crafting rows come from the live `/v1/encyclopedia`
// projection of the on-chain `crafting::Recipe` objects, through the ONE home every crafting surface
// reads — pages/encyclopedia/recipes.ts. They used to come from the bundled seed snapshot
// (packages/sdk/src/{items,recipes}.json), which is `{}` in this repo BY CONSTRUCTION — the content
// boundary means content reaches the game only as published chain state — so every profession rendered
// the empty state forever while 1434 recipes sat live on chain. A job with no live recipe still renders
// the honest empty; nothing is ever fabricated to fill it.
//
// Clicking a resource or recipe opens its detail in the RIGHT-SECTION
// (right-section, not a modal/little-card): the SAME encyclopedia item-display (ItemDetailView) the inventory + the
// encyclopedia render — NO modal, NO little card. A craftable recipe also shows the inline bill of
// materials + a Craft button below the characteristics.
//
// Item art: ItemIcon renders the real assets-CDN art with a neutral glyph fallback (the
// companion ItemImage pattern). FLAG: the assets bucket returns AccessDenied to non-companion
// origins, so confirmed real art needs the house asset pipeline — the glyph is the live fallback.
//
// FLAG (server-authoritative, out of this client task): per-job XP is read from `character.jobs`
// (a { [job_id]: total_xp } map). The Move Character struct + the indexer do not yet project job XP,
// so until that lands every job shows level 1 / 0 xp (job XP must persist
// on-chain — Move field + server save on gather + indexer projection + this read). The gather/craft
// actions themselves (mint at the legacy reference rates, node spawn/respawn) are the Wave-2 SERVER work.

import { useEffect, useMemo, useState } from 'react'

import {
  JOBS,
  JOB_CATEGORY,
  job_level_progress,
  job_from_tool,
  equipped_gather_tool,
} from '@aresrpg/sdk/jobs'

import { use_game_state } from '../../store.js'
import { craft_recipes_for_job } from '../../../pages/encyclopedia/recipes'
import { get_encyclopedia } from '../../../rpc/client'
import { use_rpc_view } from '../../../rpc/use_view'
import { Tooltip } from './Tooltip.jsx'
import { JobGlyph, covers_label } from './jobs_visuals.jsx'
import { JobList } from './JobList.jsx'
import { ResourceTable, GatherBar } from './JobGathering.jsx'
import { RecipeGrid } from './JobCraft.jsx'
import { JobItemDetail } from './JobItemDetail.jsx'
import i18n from '../../../i18n'
import './hud-panels.css'
import './jobs.css'

/**
 * RIGHT detail panel — header + XP bar + stacked Resources/Recipes sections.
 * @param {{
 *   job: import('@aresrpg/sdk/jobs').JobDef,
 *   xp: number,
 *   active: boolean,
 *   owned: Record<string, number>,
 * }} props
 */
export function JobDetail({ job, xp, active, owned }) {
  const is_gathering = job.category === JOB_CATEGORY.GATHERING
  // The clicked resource/recipe shown in the right-section as the encyclopedia ItemDetailView
  // (no modal/little-card). `recipe` is set only for a craftable recipe click (drives
  // the inline Craft controls); null for a gathered resource.
  const [selected, set_selected] = useState(
    /** @type {{ item_id: string, recipe: import('../../../pages/encyclopedia/recipes').CraftRecipeRow | null } | null} */ (
      null
    )
  )
  // The live crafting corpus (issue #765) — ONE batched, session-cached `/v1/encyclopedia` read (items +
  // recipes in a single envelope, content_get-memoized), projected to this job. Fetched here, at the only
  // component that owns both the grid and the selected row, so the bill of materials the Craft button
  // gates on is the SAME object the grid rendered.
  const { data: encyclopedia, loading } = use_rpc_view((signal) => get_encyclopedia(undefined, signal), { deps: [] })
  const job_index = useMemo(() => JOBS.findIndex((j) => j.id === job.id), [job.id])
  const recipes = useMemo(
    () => craft_recipes_for_job(encyclopedia?.recipes, encyclopedia?.items, job_index),
    [encyclopedia, job_index]
  )
  // THE JOIN: the selected row's live /v1 record, from the read this component already owns. Two disjoint
  // keys because two surfaces select by two different identities — a recipe cell by its output TEMPLATE id
  // (`recipe.id`), a gather row by its resource SLUG (== the row's `item_type`). Absent → the detail pane
  // renders its honest fallback, never a fabricated one.
  const item_by_key = useMemo(() => {
    const map = new Map()
    for (const it of encyclopedia?.items ?? []) {
      map.set(it.template_id, it)
      if (it.item_type) map.set(it.item_type, it)
    }
    return map
  }, [encyclopedia])
  const { level, current, needed } = job_level_progress(xp)
  const pct = needed > 0 ? Math.max(0, Math.min(100, (current / needed) * 100)) : 100

  // Clear the open item detail when the job changes (back to the job's browse view).
  useEffect(() => {
    set_selected(null)
  }, [job.id])

  return (
    <div className="jobs__detail">
      <div className="jobs__detail-head">
        <div className="jobs__icon" aria-hidden="true">
          <JobGlyph kind={/** @type {any} */ (job.category)} />
        </div>
        <div className="jobs__detail-id">
          <div className="jobs__detail-title-row">
            <span className="jobs__detail-name">{job.label}</span>
            {active && <span className="jobs__list-tag">{i18n.t('jobs.equipped')}</span>}
          </div>
          <span className="jobs__detail-sub">
            {is_gathering ? (
              <>
                {i18n.t('jobs.detail.tool_label')} <span className="jobs__tool">{job.tool}</span>
              </>
            ) : (
              <>{i18n.t('jobs.detail.crafts_label', { covers: covers_label(job.covers) })}</>
            )}
          </span>
        </div>
        <span className="jobs__detail-lvl hud-num">{i18n.t('jobs.lv_badge', { level })}</span>
      </div>

      <Tooltip
        text={i18n.t('jobs.detail.xp_progress', {
          current,
          needed: needed > 0 ? needed : i18n.t('common.max'),
        })}
      >
        <div className="jobs__xp">
          <div className="jobs__xp-fill" style={{ width: `${pct}%` }} />
          <span className="jobs__xp-num hud-num">
            {needed > 0 ? i18n.t('jobs.detail.xp_progress', { current, needed }) : i18n.t('common.max')}
          </span>
        </div>
      </Tooltip>

      {/* Encyclopedia pattern (T74): selecting an item does NOT replace the list — the browse
          collapses to a narrower column and the item detail opens in a sibling RIGHT pane, so you can
          keep scrolling resources/recipes while a detail is open and switch items in place. */}
      <div className={`jobs__browse-area${selected ? ' has-detail' : ''}`}>
        <div className="jobs__browse">
          {is_gathering && <GatherBar job={job} />}

          {is_gathering && (
            <>
              <div className="jobs__section-head">
                <span>{i18n.t('jobs.tabs.resources')}</span>
              </div>
              <ResourceTable
                job={job}
                level={level}
                selected_id={selected?.item_id ?? null}
                on_select={(item_id) => set_selected({ item_id, recipe: null })}
              />
            </>
          )}

          <div className="jobs__section-head">
            <span>{i18n.t('jobs.tabs.recipes')}</span>
          </div>
          <RecipeGrid
            recipes={recipes}
            loading={loading}
            level={level}
            selected_id={selected?.item_id ?? null}
            on_select={(recipe) => set_selected({ item_id: recipe.id, recipe })}
          />
        </div>

        {selected && (
          <JobItemDetail
            item={item_by_key.get(selected.item_id) ?? null}
            recipe={selected.recipe}
            job={job}
            level={level}
            owned={owned}
            on_back={() => set_selected(null)}
          />
        )}
      </div>
    </div>
  )
}

/**
 * Jobs drawer body. Reads the selected character's per-job XP (server-authoritative, see FLAG) and
 * resolves the active gathering job from the equipped weapon-slot tool. Master/detail: a job list on
 * the left, the selected job's detail (XP + stacked Resources/Recipes) on the right.
 * @returns {import('react').JSX.Element}
 */
export function JobsDrawer() {
  const characters = use_game_state((s) => s.sui.characters)
  const selected_character_id = use_game_state((s) => s.selected_character_id)
  const gather_target_job = use_game_state((s) => s.gather_target?.job_id ?? null)
  const [selected_job_id, set_selected_job_id] = useState(JOBS[0].id)

  // Selecting a world node (a roam node-click) jumps the drawer to that gathering job so its Gather
  // affordance is front and centre when the player opens Jobs.
  useEffect(() => {
    if (gather_target_job) set_selected_job_id(gather_target_job)
  }, [gather_target_job])

  const character = useMemo(
    () => characters?.find((c) => c.id === selected_character_id) ?? null,
    [characters, selected_character_id]
  )

  // Owned units per template slug from the ON-CHAIN bag (s.sui.items — the single chain-truth home the
  // inventory + quest ladder already read; item_type IS the seed slug, amount is the stack size). Drives the
  // ingredient GREEN/ORANGE rows + the craft affordability gate, so the client gate matches EXACTLY what the
  // craft tx can burn. Replaces the retired WS off-chain `resources` ledger (core/modules/craft.js), which no
  // longer fills without the backend — an on-chain-only ingredient is now honestly counted, not shown missing.
  const bag_items = use_game_state((s) => s.sui.items)
  const owned = useMemo(() => {
    /** @type {Record<string, number>} */
    const map = {}
    for (const it of bag_items ?? []) {
      if (!it?.item_type) continue
      map[it.item_type] = (map[it.item_type] || 0) + (Number(it.amount) || 1)
    }
    return map
  }, [bag_items])

  // Active gathering job = the one whose tool is equipped. The read-model keys equipped items by their
  // on-chain item_category and every gathering tool collapses onto the gather slot (`character.pickaxe`),
  // NEVER `character.weapon` — so resolve the tool from the actual gather slot (equipped_gather_tool).
  const active_job = useMemo(() => job_from_tool(equipped_gather_tool(character)), [character])

  if (!character) {
    return <div className="hud-panel__empty">{i18n.t('jobs.no_character')}</div>
  }

  /** @type {Record<string, number>} */
  const job_xp = character.jobs ?? {}
  const selected_job = JOBS.find((j) => j.id === selected_job_id) ?? JOBS[0]

  return (
    <div className="jobs">
      <JobList
        selected_id={selected_job.id}
        job_xp={job_xp}
        active_job_id={active_job?.id ?? null}
        on_select={set_selected_job_id}
      />
      <JobDetail
        job={selected_job}
        xp={job_xp[selected_job.id] ?? 0}
        active={active_job?.id === selected_job.id}
        owned={owned}
      />
    </div>
  )
}

// Launcher intent for the integration stage (Hud.jsx / TopLaunchers.jsx): the bottom-right dock slot.
//   key:   'jobs'
//   label: 'Jobs'
//   icon:  a sickle/wheat glyph (Lucide-style). Add to icons.js as `icon_jobs`, e.g.:
//     export const icon_jobs = svg('<path d="M2 22 16 8"/><path d="M17 7l5-5"/><path d="M14 4l6 6"/>')
//   Open as a RIGHT DRAWER titled "Jobs" rendering <JobsDrawer/> (all menus are right drawers).
export const JOBS_LAUNCHER = /** @type {const} */ ({
  key: 'jobs',
  label: 'Jobs',
})
