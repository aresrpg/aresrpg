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

import { useEffect, useMemo, useRef, useState } from 'react'

import {
  JOBS,
  JOB_CATEGORY,
  GATHER_RESOURCES,
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
import { craft_affordability_of, craft_recipes_for_job } from '../../../pages/encyclopedia/recipes'
import { get_encyclopedia } from '../../../rpc/client'
import { use_rpc_view } from '../../../rpc/use_view'
import { Tooltip } from './Tooltip.jsx'
// Item detail REUSES the EXACT encyclopedia item-display (ItemDetailView) over the EXACT same live /v1 row
// projection the Encyclopedia tab renders (item_view_model.ts + encyclopedia_item_asset — one home for the
// shape, one home for the art slug) — HD icon, type, DESCRIPTION + characteristics (right-section, not a
// modal/little-card).
import { ItemDetailView } from '../../../components/entity_display'
import { encyclopedia_item_view } from '../../../pages/encyclopedia/item_view_model'
import { encyclopedia_item_asset } from '../../../pages/encyclopedia/encyclopedia_assets'
import { EncyclopediaLink } from '../../../pages/encyclopedia/EncyclopediaLink'
import { use_template_t } from '../../../i18n/template_t'
import { craft_item } from '../../../world-shell/craft_actions.js'
import { craft_success_percent } from '../../../world-shell/craft_outcome.js'
import { play_discovery_sfx, play_fight_sfx } from '../../core/audio/sfx.js'
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
      crossOrigin="anonymous"
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
 * enabled ONLY when the player's job level clears the recipe's on-chain `required_level` AND the
 * ingredients are affordable (off the on-chain bag; else disabled WITH the reason) — the same two
 * conditions `crafting::craft` itself asserts. Clicking crafts ONE unit as a REAL self-pay tx
 * (world-shell/craft_actions.js → crafting::craft): burn the exact kiosk-locked ingredient stacks, mint the
 * output into the same kiosk, all atomic — no server, no queue. ONE honest toast per outcome.
 *
 * @param {{
 *   recipe: import('../../../pages/encyclopedia/recipes').CraftRecipeRow,
 *   job: import('@aresrpg/sdk/jobs').JobDef,
 *   level: number,
 *   owned: Record<string, number>,
 * }} props
 * @returns {import('react').JSX.Element}
 */
function CraftControls({ recipe, job, level, owned }) {
  // The bill of materials rides ON the live recipe row (craft_recipes_for_job resolved it against the same
  // /v1 items list) — no second lookup, no second source that could disagree with what the tx will burn.
  const ingredients = recipe.ingredients
  // The ON-CHAIN bag — the exact stacks the craft tx burns (chain-truth home; also drives affordability above).
  const bag_items = use_game_state((s) => s.sui.items)
  // The crafter's active character — the reference-corpus success roll runs at ITS job level (craft_ptb requires the id).
  const selected_character_id = use_game_state((s) => s.selected_character_id)
  const [pending, set_pending] = useState(false)
  const afford = useMemo(() => craft_affordability_of(ingredients, owned, 1), [ingredients, owned])
  // Per-ingredient have/need (drives the GREEN/ORANGE rows), keyed by the ingredient's TEMPLATE id — the
  // one key every row always has (an unsnapshotted ingredient has no slug; see CraftIngredientRow.id).
  const have_need = useMemo(() => {
    /** @type {Record<string, { have: number, need: number, enough: boolean }>} */
    const map = {}
    for (const row of afford.rows) map[row.template_id] = row
    return map
  }, [afford])

  // The chain's own gate: crafting.move asserts `crafter_level >= recipe.required_level` (EUnderLevel).
  // The old bundled path gated on the OUTPUT ITEM's level instead — a different number entirely, so the
  // button could disagree with what the tx would do.
  const level_ok = level >= recipe.required_level
  const can_craft = level_ok && afford.affordable

  // The chance the chain itself will roll for this craft — `crafting.move`'s own curve off the crafter's job
  // level, mirrored in craft_outcome.js. The player sees what they are betting BEFORE they spend (#2034).
  const success_chance = craft_success_percent(level)

  // REAL on-chain craft (world-shell/craft_actions.js): the live row already carries the Recipe object id,
  // so it just burns the exact kiosk-locked ingredient stacks and mints the output — ONE self-pay tx
  // through the standard run_tx choke (dryRun-guarded, no auto-retry).
  //
  // ONE HONEST TOAST PER OUTCOME (#2034). The craft ROLLS: inputs burn and job XP credits either way, and the
  // output mints only on a pass — so the action reports the roll (`craft_outcome`, off the `crafting::Crafted`
  // event), never "the transaction resolved". A pass is green + the discovery sparkle; a failed roll is red +
  // the restrained `deny` nudge (no failure asset exists; these are the registry's existing cues). The bag
  // repaints on both branches — craft_actions owns that, because XP moved either way.
  const on_craft = async () => {
    if (!can_craft || pending) return
    set_pending(true)
    try {
      const name = recipe.name?.trim() || recipe.id
      const { outcome, quantity } = await craft_item({
        recipe,
        items: bag_items,
        character_id: selected_character_id,
      })
      if (outcome === 'success') {
        use_toast.getState().add(i18n.t('inventory.craft_success', { qty: quantity || 1, name }), 'success')
        play_discovery_sfx()
      } else if (outcome === 'failure') {
        use_toast.getState().add(i18n.t('inventory.craft_roll_failed', { name, chance: success_chance }), 'error')
        play_fight_sfx('deny')
      } else {
        // The receipt carried no craft event: the transaction landed but nothing proves what it produced.
        // Never claim a success we cannot see — say so and let the repainted bag answer.
        use_toast.getState().add(i18n.t('inventory.craft_outcome_unknown', { name }), 'info')
      }
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
          const hn = have_need[ing.template_id]
          const enough = hn?.enough ?? false
          return (
            <div key={ing.template_id} className="jobs__ingredient">
              <ItemIcon icon={ing.id ?? ''} size={32} />
              <span className="jobs__ingredient-id">
                {/* The bill of materials names items the player has to go FIND: each name is the standard
                    clickable entity reference into the encyclopedia (the ONE encyclopedia_path idiom), keyed by
                    the TEMPLATE id — the one key an unsnapshotted ingredient still carries. */}
                <EncyclopediaLink kind="item" id={ing.template_id} className="jobs__ingredient-name">
                  {ing.name}
                </EncyclopediaLink>
                <span className="jobs__ingredient-lvl hud-num">{i18n.t('jobs.lv_badge', { level: ing.level })}</span>
              </span>
              {/* OWNED/REQUIRED: GREEN when owned>=required, ORANGE when short */}
              <span className={`jobs__ingredient-amt hud-num ${enough ? 'is-enough' : 'is-short'}`}>
                {hn?.have ?? 0} / {hn?.need ?? ing.qty}
              </span>
            </div>
          )
        })}
      </div>

      {/* The bet, stated before it is placed: crafting.move rolls this chance off the crafter's JOB level,
          so a low-level crafter can read why their inputs sometimes vanish for nothing (#2034). */}
      <div className="jobs__craft-chance">
        <span className="jobs__craft-chance-label">{i18n.t('jobs.craft.success_chance')}</span>
        <span className="jobs__craft-chance-value hud-num">{success_chance}%</span>
      </div>

      <div className="jobs__craft-bar">
        <Tooltip
          text={
            !level_ok
              ? i18n.t('jobs.craft.requires_level', { job: job.label, required: recipe.required_level, level })
              : !afford.affordable
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
                : i18n.t('jobs.craft.locked_level', { level: recipe.required_level })}
          </button>
        </Tooltip>
      </div>
    </div>
  )
}

/**
 * The selected item's detail in the RIGHT-SECTION — the EXACT encyclopedia item-display (ItemDetailView),
 * fed the SAME live `/v1` row the encyclopedia ITEMS tab renders (through the one projection home,
 * item_view_model.ts), so it shows the HD icon, type, DESCRIPTION + characteristics. A craftable recipe
 * also renders the inline CraftControls (bill of materials + Craft button) as ItemDetailView children. NO
 * modal, NO little card. A "Back" affordance returns to the job's resource/recipe browse.
 *
 * `item` is the selected row's live /v1 record, joined by the caller (JobDetail owns the read). It used to
 * resolve through `use_content()` — the bundled seed catalog, `{}` in this repo BY CONSTRUCTION — so the
 * join always missed and the pane fell through to the recipe row: an icon keyed by the Sui OBJECT ID (a
 * guaranteed 404 → the generic glyph), no description, no stats. The seed path is deleted, not ranked
 * behind /v1: it is a second home for facts the chain already carries, and it can only be wrong.
 * @param {{
 *   item: import('../../../rpc/views').RpcEncyclopediaItem | null,
 *   recipe: import('../../../pages/encyclopedia/recipes').CraftRecipeRow | null,
 *   job: import('@aresrpg/sdk/jobs').JobDef,
 *   level: number,
 *   owned: Record<string, number>,
 *   on_back: () => void,
 * }} props
 * @returns {import('react').JSX.Element}
 */
export function JobItemDetail({ item, recipe, job, level, owned, on_back }) {
  const tt = use_template_t()

  const view = useMemo(() => (item ? encyclopedia_item_view(item) : null), [item])
  // chain_icon_slug via encyclopedia_item_asset: the icon key of a live row IS its `item_type`, the same key
  // the seed uploads `items/{item_type}.png` under. The runtime object address is not an art identity —
  // deriving the icon from it 404'd every single one.
  const asset = view ? encyclopedia_item_asset(view) : null

  // The ItemDetailView shape. `supply`/`last_sale_mist` are deliberately NOT passed: the supply + marketcap
  // block under the icon is the encyclopedia's own opt-in, not a crafting fact. Falls back to the raw recipe
  // row for an output the projection has not reached — honest partial, never a fabricated stat.
  const detail_item = view
    ? {
        id: asset.id,
        image_url: asset.image_url,
        name: tt(view, 'name'),
        description: tt(view, 'description'),
        category: view.category,
        rarity: view.rarity,
        level: view.level,
        damages: view.damages,
        stats: view.stats,
      }
    : recipe
      ? {
          // The row's art slug — the SAME key the grid cell beside it renders from. Never `recipe.id`
          // (the output TEMPLATE id): an object address is not an art identity, and no slug at all is an
          // honest glyph rather than a guaranteed 404.
          id: recipe.item_type || '',
          name: recipe.name?.trim() || recipe.id,
          category: String(recipe.category ?? '').toUpperCase(),
          // The chain's item projection carries no quality/rarity field — the neutral default, never a
          // fabricated tier (the house is no-tiers anyway).
          rarity: 'common',
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
 *   recipes: import('../../../pages/encyclopedia/recipes').CraftRecipeRow[],
 *   loading: boolean,
 *   level: number,
 *   on_select: (recipe: import('../../../pages/encyclopedia/recipes').CraftRecipeRow) => void,
 *   selected_id?: string | null,
 * }} props
 */
export function RecipeGrid({ recipes, loading, level, on_select, selected_id = null }) {
  const { unlocked, locked } = useMemo(() => {
    /** @type {typeof recipes} */
    const u = []
    /** @type {typeof recipes} */
    const l = []
    // Grouped by the CHAIN's gate (required_level), so what reads "Unlocked" is exactly what
    // `crafting::craft` will accept — not the output item's level, which gates nothing.
    for (const r of recipes) (level >= r.required_level ? u : l).push(r)
    return { unlocked: u, locked: l }
  }, [recipes, level])

  // Loading is NOT emptiness — the honest-empty copy would read as "this job has no recipes" while the
  // projection is still in flight (no-silent-staleness law, use_rpc_view).
  if (loading) return <div className="jobs__recipe-empty">{i18n.t('common.loading')}</div>
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
      <ItemIcon icon={r.item_type} size={32} />
      <span className="jobs__recipe-id">
        <span className="jobs__recipe-name">{r.name?.trim() || r.id}</span>
        {/* The UNLOCK level, so the number on the card agrees with the block it sits in. The output
            item's own level rides in its detail pane (ItemDetailView), where it belongs. */}
        <span className="jobs__recipe-meta hud-num">
          {i18n.t('jobs.recipes.meta', { level: r.required_level, category: r.category })}
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
