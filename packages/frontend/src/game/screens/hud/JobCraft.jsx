// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The Jobs drawer's CRAFT surfaces — the recipe grid a craft job browses and the inline craft controls
// (bill of materials + the real on-chain Craft button) its detail pane renders. Split out of
// JobsDrawer.jsx (issue #2052); both components are unchanged.
//
// RECIPES ARE CHAIN TRUTH (issue #765): the rows come from the live `/v1/encyclopedia` projection of the
// on-chain `crafting::Recipe` objects, through the ONE home every crafting surface reads —
// pages/encyclopedia/recipes.ts. Nothing here resolves a recipe through the bundled seed catalog.
import { useMemo, useState } from 'react'

import { craft_affordability_of } from '../../../pages/encyclopedia/recipes'
import { use_game_state } from '../../store.js'
import { Tooltip } from './Tooltip.jsx'
import { ItemIcon } from './jobs_visuals.jsx'
import { EncyclopediaLink } from '../../../pages/encyclopedia/EncyclopediaLink'
import { craft_item } from '../../../world-shell/craft_actions.js'
import { craft_success_percent } from '../../../world-shell/craft_outcome.js'
import { play_discovery_sfx, play_fight_sfx } from '../../core/audio/sfx.js'
import { use_toast } from '../../../toast'
import i18n from '../../../i18n'
import './hud-panels.css'
import './jobs.css'

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
export function CraftControls({ recipe, job, level, owned }) {
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
