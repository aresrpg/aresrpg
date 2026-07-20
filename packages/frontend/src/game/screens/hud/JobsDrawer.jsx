// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Jobs drawer body — a master/detail panel ported from the aresrpg companion encyclopedia JOBS tab
// (../../aresrpg/packages/frontend/src/pages/encyclopedia/jobs_tab.tsx): a LEFT job-list rail
// (grouped by the 4 categories, with a per-job level chip) + a RIGHT detail panel (job header, XP
// bar, and a Resources | Recipes sub-tab section). Restyled to the house glass + ice-blue tokens
// (tabs not pills, mono tabular nums, hairline dividers). Every craft job shows ALL RECIPES,
// both UNLOCKED and LOCKED (locked greyed with the unlock level); gathering jobs show their 11-tier
// resource table (locked tiers greyed with the required level).
//
// SSOT: all job definitions + the XP curve + gathering formulas + the recipe + ingredient data live
// in @aresrpg/sdk/jobs (ported 1:1 from the reference corpus's Job.java / JobExperience.java / GatheringFormulas.java;
// the 11-tier gatherables + the crafting recipes/ingredients projected 1:1 from the real aresrpg
// content seed — items.json + recipes.json). This component renders them — it computes no balance.
// Resources + recipes + ingredients all carry the REAL companion display name + icon key (no
// placeholder "?" names remain). Clicking a resource or recipe opens its detail in the RIGHT-SECTION
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

import { useEffect, useMemo, useRef, useState } from 'react'

import {
  JOBS,
  JOB_CATEGORY,
  GATHER_RESOURCES,
  craft_recipes,
  recipe_ingredients,
  craft_affordability,
  item_icon_url,
  job_level_progress,
  job_from_tool,
  equipped_gather_tool,
  tier_to_level,
  gather_xp,
  gather_amount,
  gather_time,
  respawn_secs,
} from '@aresrpg/sdk/jobs'

import { use_game_state, context } from '../../store.js'
import { Tooltip } from './Tooltip.jsx'
// Item detail REUSES the EXACT encyclopedia item-display (ItemDetailView) fed the same seeded content
// (use_content) the Encyclopedia tab + the Inventory render — bigger icon, type, rarity, DESCRIPTION +
// characteristics (right-section, not a modal/little-card).
import { ItemDetailView } from '../../../components/entity_display'
import { use_content } from '../../../pages/encyclopedia/content'
import { use_template_t } from '../../../i18n/template_t'
import { craft_item } from '../../../world-shell/craft_actions.js'
import { use_toast } from '../../../toast'
import i18n from '../../../i18n'
import './hud-panels.css'
import './jobs.css'

const CATEGORY_ORDER = /** @type {const} */ ([
  { key: JOB_CATEGORY.GATHERING, label_key: 'jobs.category.gathering' },
  { key: JOB_CATEGORY.WEAPON, label_key: 'jobs.category.weapon' },
  { key: JOB_CATEGORY.EQUIPMENT, label_key: 'jobs.category.equipment' },
  { key: JOB_CATEGORY.CONSUMABLE, label_key: 'jobs.category.consumable' },
])

/** Flat resource lookup by id (== items.json id), across all 3 gathering jobs. */
const RESOURCE_BY_ID = /** @type {Record<string, { id: string, name: string, tier: number, icon: string }>} */ (
  Object.values(GATHER_RESOURCES)
    .flat()
    .reduce((map, res) => ({ ...map, [res.id]: res }), {})
)

/** Per-category accent glyph (inline SVG, currentColor). */
const CATEGORY_GLYPH = {
  [JOB_CATEGORY.GATHERING]: <path d="M2 22 16 8M17 7l5-5M14 4l6 6M9 9l4 4" />,
  [JOB_CATEGORY.WEAPON]: <path d="M14.5 17.5 3 6V3h3l11.5 11.5M13 19l6-6M16 16l4 4" />,
  [JOB_CATEGORY.EQUIPMENT]: <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />,
  [JOB_CATEGORY.CONSUMABLE]: <path d="M5 3h14l-1 7a6 6 0 0 1-12 0zM12 17v4M8 21h8" />,
}

/** @param {{ kind: keyof typeof CATEGORY_GLYPH }} props */
function JobGlyph({ kind }) {
  return (
    <svg
      className="jobs__glyph"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {CATEGORY_GLYPH[kind]}
    </svg>
  )
}

/**
 * An item icon — the REAL aresrpg asset art (assets CDN) with a graceful fallback. Mirrors the
 * companion `ItemImage`: tries `${ASSETS_URL}/items/<icon>.png` with `referrerPolicy="no-referrer"`,
 * and on load error swaps to a tasteful diamond GLYPH in the neutral steel tone (so a blocked or
 * missing asset never renders a broken-image box). FLAG: the assets bucket currently returns
 * AccessDenied to non-companion origins, so confirmed real art needs the house asset pipeline — the
 * glyph is the live fallback until then.
 * @param {{ icon: string, size?: number }} props
 */
function ItemIcon({ icon, size = 28 }) {
  const [failed, set_failed] = useState(false)
  const url = item_icon_url(icon)
  if (!url || failed) {
    return (
      <span className="jobs__item-glyph" style={{ width: size, height: size }} aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
          <path d="M12 3 21 12 12 21 3 12Z" strokeWidth="1.6" strokeLinejoin="round" />
        </svg>
      </span>
    )
  }
  return (
    <img
      className="jobs__item-img"
      src={url}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => set_failed(true)}
    />
  )
}

/** A capitalized covered-category label, e.g. ['longsword','sword'] -> "Longsword, Sword". */
const covers_label = (/** @type {string[]} */ covers) =>
  covers.map((c) => c.replace(/_/g, ' ').replace(/^\w/, (m) => m.toUpperCase())).join(', ')

/**
 * LEFT rail — jobs grouped by category, each a selectable row with a level chip.
 * @param {{
 *   selected_id: string,
 *   job_xp: Record<string, number>,
 *   active_job_id: string | null,
 *   on_select: (id: string) => void,
 * }} props
 */
function JobList({ selected_id, job_xp, active_job_id, on_select }) {
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
function ResourceTable({ job, level, on_select, selected_id = null }) {
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
 * Inline craft controls — rendered as ItemDetailView CHILDREN in the right-section,
 * NOT a modal. The bill of materials: each ingredient row = ICON + NAME + LVL + AMOUNT shown as
 * OWNED/REQUIRED with COLOR (GREEN when owned >= required, ORANGE when short), then the CRAFT button —
 * enabled ONLY when the player's job level >= the recipe level AND the ingredients are affordable (off the
 * on-chain bag; else disabled WITH the reason). Clicking crafts ONE unit as a REAL self-pay tx
 * (world-shell/craft_actions.js → crafting::craft): burn the exact kiosk-locked ingredient stacks, mint the
 * output into the same kiosk, all atomic — no server, no queue. ONE honest toast per outcome.
 *
 * @param {{
 *   recipe: import('@aresrpg/sdk/jobs').CraftRecipe,
 *   job: import('@aresrpg/sdk/jobs').JobDef,
 *   level: number,
 *   owned: Record<string, number>,
 * }} props
 * @returns {import('react').JSX.Element}
 */
function CraftControls({ recipe, job, level, owned }) {
  const ingredients = useMemo(() => recipe_ingredients(recipe.id), [recipe.id])
  // The ON-CHAIN bag — the exact stacks the craft tx burns (chain-truth home; also drives affordability above).
  const bag_items = use_game_state((s) => s.sui.items)
  // The crafter's active character — the reference-corpus success roll runs at ITS job level (craft_ptb requires the id).
  const selected_character_id = use_game_state((s) => s.selected_character_id)
  const [pending, set_pending] = useState(false)
  const afford = useMemo(() => craft_affordability(recipe.id, owned, 1), [recipe.id, owned])
  // Per-ingredient have/need (drives the GREEN/ORANGE rows), keyed by ingredient id.
  const have_need = useMemo(() => {
    /** @type {Record<string, { have: number, need: number, enough: boolean }>} */
    const map = {}
    for (const row of afford?.rows ?? []) map[row.id] = row
    return map
  }, [afford])

  const level_ok = level >= recipe.level
  const can_craft = level_ok && !!afford?.affordable && ingredients.length > 0

  // REAL on-chain craft (world-shell/craft_actions.js): resolve the live Recipe object chain-direct, burn the
  // exact kiosk-locked ingredient stacks, mint the output — ONE self-pay tx through the standard run_tx choke
  // (dryRun-guarded, no auto-retry). ONE honest toast per outcome; a success repaints the bag (load_roster),
  // which flips the onboarding quest-ladder 'craft' step the moment the crafted item lands.
  const on_craft = async () => {
    if (!can_craft || pending) return
    set_pending(true)
    try {
      await craft_item({ recipe, items: bag_items, character_id: selected_character_id })
      use_toast.getState().add(i18n.t('inventory.craft_success', { name: recipe.name?.trim() || recipe.id }), 'info')
    } catch (error) {
      // no-silent-failure law: the humanized/translated copy reaches the player; the digest + raw abort stay in console.
      use_toast.getState().add(error?.message || i18n.t('errors.craft_failed'), 'error')
    } finally {
      set_pending(false)
    }
  }

  if (ingredients.length === 0) {
    return (
      <div className="jobs__craft">
        <div className="jobs__craft-head">{i18n.t('jobs.craft.recipe_head')}</div>
        <div className="jobs__recipe-empty">{i18n.t('jobs.craft.recipe_not_seeded')}</div>
      </div>
    )
  }

  return (
    <div className="jobs__craft">
      <div className="jobs__craft-head">{i18n.t('jobs.craft.ingredients_head')}</div>
      <div className="jobs__ingredients">
        {ingredients.map((ing) => {
          const hn = have_need[ing.id]
          const enough = hn?.enough ?? false
          return (
            <div key={ing.id} className="jobs__ingredient">
              <ItemIcon icon={ing.icon} size={32} />
              <span className="jobs__ingredient-id">
                <span className="jobs__ingredient-name">{ing.name}</span>
                <span className="jobs__ingredient-lvl hud-num">{i18n.t('jobs.lv_badge', { level: ing.level })}</span>
              </span>
              {/* OWNED/REQUIRED: GREEN when owned>=required, ORANGE when short */}
              <span className={`jobs__ingredient-amt hud-num ${enough ? 'is-enough' : 'is-short'}`}>
                {hn?.have ?? owned[ing.id] ?? 0} / {hn?.need ?? ing.qty}
              </span>
            </div>
          )
        })}
      </div>

      <div className="jobs__craft-bar">
        <Tooltip
          text={
            !level_ok
              ? i18n.t('jobs.craft.requires_level', { job: job.label, required: recipe.level, level })
              : !afford?.affordable
                ? i18n.t('jobs.craft.not_enough')
                : i18n.t('jobs.craft.craft_tooltip', { name: recipe.name?.trim() || recipe.id })
          }
        >
          <button
            type="button"
            className="hud-btn hud-btn--accent jobs__craft-btn"
            disabled={!can_craft || pending}
            onClick={on_craft}
          >
            {pending
              ? i18n.t('inventory.craft_pending')
              : level_ok
                ? i18n.t('jobs.craft.craft_button')
                : i18n.t('jobs.craft.locked_level', { level: recipe.level })}
          </button>
        </Tooltip>
      </div>
    </div>
  )
}

/**
 * The selected item's detail in the RIGHT-SECTION — the EXACT encyclopedia
 * item-display (ItemDetailView), fed the SAME seeded content (use_content) the inventory + encyclopedia
 * render, so it shows the big icon, type, rarity, DESCRIPTION + characteristics. A craftable recipe also
 * renders the inline CraftControls (bill of materials + Craft button) as ItemDetailView children. NO
 * modal, NO little card. A "Back" affordance returns to the job's resource/recipe browse.
 * @param {{
 *   item_id: string,
 *   recipe: import('@aresrpg/sdk/jobs').CraftRecipe | null,
 *   job: import('@aresrpg/sdk/jobs').JobDef,
 *   level: number,
 *   owned: Record<string, number>,
 *   on_back: () => void,
 * }} props
 * @returns {import('react').JSX.Element}
 */
function JobItemDetail({ item_id, recipe, job, level, owned, on_back }) {
  const content_items = use_content().templates.item
  const tt = use_template_t()

  const content = useMemo(() => content_items.find((it) => it.id === item_id) ?? null, [content_items, item_id])

  // The ItemDetailView shape, resolved from the seed (mirrors Inventory.jsx). Falls back to the raw
  // recipe row for any craft output not present in the seed.
  const detail_item = content
    ? {
        id: content.id,
        appearance: content.appearance,
        name: tt(content, 'name'),
        category: content.category,
        rarity: content.rarity,
        level: content.level || 0,
        damages: content.damages || [],
        stats: content.stats || {},
        description: tt(content, 'description'),
        weapon_class: content.weapon_class,
      }
    : recipe
      ? {
          id: recipe.id,
          name: recipe.name?.trim() || recipe.id,
          category: String(recipe.category ?? '').toUpperCase(),
          rarity: recipe.quality ?? 'common',
          level: recipe.level ?? 0,
          damages: [],
          stats: {},
        }
      : null

  return (
    <div className="jobs__item-detail">
      <button
        type="button"
        className="jobs__detail-close"
        onClick={on_back}
        aria-label={i18n.t('jobs.detail.close_aria')}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <path d="M6 6l12 12M18 6 6 18" />
        </svg>
      </button>
      {detail_item ? (
        <ItemDetailView item={detail_item}>
          {recipe && <CraftControls recipe={recipe} job={job} level={level} owned={owned} />}
        </ItemDetailView>
      ) : (
        <div className="jobs__recipe-empty">{i18n.t('jobs.detail.item_not_seeded')}</div>
      )}
    </div>
  )
}

/**
 * Craft recipe grid — ALL recipes for the job, grouped Unlocked vs Locked (locked greyed with the
 * unlock level). A recipe is unlocked when the job level >= the item's level. Each cell carries the
 * item icon (NO quality dot, NO left-accent rail — no-tiers + house law) and opens the recipe's detail in
 * the RIGHT-SECTION on click, NOT a modal.
 * @param {{
 *   job: import('@aresrpg/sdk/jobs').JobDef,
 *   level: number,
 *   on_select: (recipe: import('@aresrpg/sdk/jobs').CraftRecipe) => void,
 *   selected_id?: string | null,
 * }} props
 */
function RecipeGrid({ job, level, on_select, selected_id = null }) {
  const recipes = useMemo(() => craft_recipes(job.id), [job.id])
  const { unlocked, locked } = useMemo(() => {
    /** @type {import('@aresrpg/sdk/jobs').CraftRecipe[]} */
    const u = []
    /** @type {import('@aresrpg/sdk/jobs').CraftRecipe[]} */
    const l = []
    for (const r of recipes) (level >= r.level ? u : l).push(r)
    return { unlocked: u, locked: l }
  }, [recipes, level])

  if (!recipes.length) {
    return <div className="jobs__recipe-empty">{i18n.t('jobs.recipes.empty_seed')}</div>
  }

  /** @param {import('@aresrpg/sdk/jobs').CraftRecipe} r @param {boolean} is_locked */
  // T87: NO hover tooltip on recipe cards — clicking a card opens the full item detail on the
  // right (the T74 encyclopedia panel), so the tooltip was redundant. The card stays clickable.
  const recipe_cell = (r, is_locked) => (
    <button
      key={r.id}
      type="button"
      className={`jobs__recipe${is_locked ? ' is-locked' : ''}${r.id === selected_id ? ' is-selected' : ''}`}
      onClick={() => on_select(r)}
    >
      <ItemIcon icon={r.icon} size={32} />
      <span className="jobs__recipe-id">
        <span className="jobs__recipe-name">{r.name?.trim() || r.id}</span>
        <span className="jobs__recipe-meta hud-num">
          {i18n.t('jobs.recipes.meta', { level: r.level, category: r.category })}
        </span>
      </span>
    </button>
  )

  return (
    <div className="jobs__recipes">
      {unlocked.length > 0 && (
        <div className="jobs__recipe-block">
          <div className="jobs__recipe-block-head">
            {i18n.t('jobs.recipes.unlocked')} <span className="hud-num">({unlocked.length})</span>
          </div>
          <div className="jobs__recipe-grid">{unlocked.map((r) => recipe_cell(r, false))}</div>
        </div>
      )}
      {locked.length > 0 && (
        <div className="jobs__recipe-block">
          <div className="jobs__recipe-block-head is-locked">
            {i18n.t('jobs.recipes.locked')} <span className="hud-num">({locked.length})</span>
          </div>
          <div className="jobs__recipe-grid">{locked.map((r) => recipe_cell(r, true))}</div>
        </div>
      )}
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
function GatherBar({ job }) {
  const gather = use_game_state((s) => s.gather)
  const gather_target = use_game_state((s) => s.gather_target)
  // A local clock so the active harvest bar advances smoothly between server pushes (mirrors CraftToast).
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

/**
 * RIGHT detail panel — header + XP bar + Resources/Recipes sub-tabs.
 * @param {{
 *   job: import('@aresrpg/sdk/jobs').JobDef,
 *   xp: number,
 *   active: boolean,
 *   owned: Record<string, number>,
 * }} props
 */
function JobDetail({ job, xp, active, owned }) {
  const is_gathering = job.category === JOB_CATEGORY.GATHERING
  const [tab, set_tab] = useState(/** @type {'resources' | 'recipes'} */ (is_gathering ? 'resources' : 'recipes'))
  // The clicked resource/recipe shown in the right-section as the encyclopedia ItemDetailView
  // (no modal/little-card). `recipe` is set only for a craftable recipe click (drives
  // the inline Craft controls); null for a gathered resource.
  const [selected, set_selected] = useState(
    /** @type {{ item_id: string, recipe: import('@aresrpg/sdk/jobs').CraftRecipe | null } | null} */ (null)
  )
  const { level, current, needed } = job_level_progress(xp)
  const pct = needed > 0 ? Math.max(0, Math.min(100, (current / needed) * 100)) : 100

  // Clear the open item detail when the job changes (back to the job's browse view).
  useEffect(() => {
    set_selected(null)
  }, [job.id])

  // Reset the tab to the job's natural default when the job changes.
  const natural_tab = is_gathering ? 'resources' : 'recipes'
  const effective_tab =
    (is_gathering && tab === 'recipes') || (!is_gathering && tab === 'resources') ? natural_tab : tab

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

          <div className="jobs__subtabs">
            {is_gathering && (
              <button
                type="button"
                className={`jobs__subtab${effective_tab === 'resources' ? ' is-active' : ''}`}
                onClick={() => set_tab('resources')}
              >
                {i18n.t('jobs.tabs.resources')}
              </button>
            )}
            {!is_gathering && (
              <button
                type="button"
                className={`jobs__subtab${effective_tab === 'recipes' ? ' is-active' : ''}`}
                onClick={() => set_tab('recipes')}
              >
                {i18n.t('jobs.tabs.recipes')}
              </button>
            )}
          </div>

          {effective_tab === 'resources' ? (
            <ResourceTable
              job={job}
              level={level}
              selected_id={selected?.item_id ?? null}
              on_select={(item_id) => set_selected({ item_id, recipe: null })}
            />
          ) : (
            <RecipeGrid
              job={job}
              level={level}
              selected_id={selected?.item_id ?? null}
              on_select={(recipe) => set_selected({ item_id: recipe.id, recipe })}
            />
          )}
        </div>

        {selected && (
          <JobItemDetail
            item_id={selected.item_id}
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
 * the left, the selected job's detail (XP + Resources/Recipes) on the right.
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
