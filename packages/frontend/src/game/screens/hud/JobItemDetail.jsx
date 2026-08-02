// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The Jobs drawer's RIGHT-SECTION item detail — the clicked resource or recipe rendered through the EXACT
// encyclopedia item-display (ItemDetailView) over the EXACT same live /v1 row projection the Encyclopedia
// tab renders (item_view_model.ts + encyclopedia_item_asset — one home for the shape, one home for the art
// slug): HD icon, type, DESCRIPTION + characteristics. Split out of JobsDrawer.jsx (issue #2052); the
// component is unchanged.
import { useMemo } from 'react'

import { ItemDetailView } from '../../../components/entity_display'
import { encyclopedia_item_view } from '../../../pages/encyclopedia/item_view_model'
import { encyclopedia_item_asset } from '../../../pages/encyclopedia/encyclopedia_assets'
import { use_template_t } from '../../../i18n/template_t'
import { CraftControls } from './JobCraft.jsx'
import i18n from '../../../i18n'
import './jobs.css'

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
