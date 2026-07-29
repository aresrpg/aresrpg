// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The encyclopedia JOBS tab's RECIPES section — every live `crafting::Recipe` whose `required_job` is this
// job, with the bill of materials the chain will actually burn. Projected through the ONE home
// (recipes.ts `craft_recipes_for_job`, the same walk the in-game Jobs drawer and the commission board
// craft from), so re-jobbing a recipe on chain moves it between job pages with no frontend edit — and a
// GATHERING job's own crafts (flours / powders / blends) show up exactly like a smith's (#1670).
//
// This REPLACED the flat RELATED ITEMS list, which re-derived "recipes of this job" in a second place and
// showed only the output name — a player could see that flour exists but never how it is made.
//
// Multi-column by construction: the old single-column list left most of the page empty.
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { SectionDivider, SectionTitle } from '../../components/entity_display'
import { ItemImage } from '../../components/items'
import type { RpcEncyclopediaItem, RpcRecipe } from '../../rpc/views'

import { encyclopedia_item_asset } from './encyclopedia_assets'
import { craft_recipes_for_job, type CraftRecipeRow } from './recipes'

/** One craft card: the output (icon + name + chain gates) over its exact bill of materials. */
function RecipeCard({ row, on_navigate_to_item }: { row: CraftRecipeRow; on_navigate_to_item: (id: string) => void }) {
  const { t } = useTranslation()
  const asset = encyclopedia_item_asset({ id: row.id, item_type: row.item_type, name: row.name })
  return (
    <div
      className="flex flex-col gap-1.5 px-2 py-2 cursor-pointer transition-colors hover:bg-white/[0.03]"
      data-job-recipe={row.recipe_id}
      style={{ background: 'rgba(255,255,255,0.02)', borderLeft: '2px solid #c8963c40' }}
      onClick={() => on_navigate_to_item(row.id)}
    >
      <div className="flex items-center gap-2 min-w-0">
        <ItemImage id={asset.id} image_url={asset.image_url} category={row.category} style={{ width: 24, height: 24 }} />
        <span className="text-[9px] tracking-[0.1em] uppercase truncate flex-1 text-text">{row.name}</span>
        {row.output_quantity > 1 && <span className="text-[8px] shrink-0 text-muted">&times;{row.output_quantity}</span>}
      </div>
      <div className="flex items-center gap-1 flex-wrap">
        <span
          className="text-[7px] tracking-[0.15em] uppercase px-1.5 py-px text-gold"
          style={{ border: '1px solid rgba(200,150,60,0.3)', background: 'rgba(200,150,60,0.08)' }}
        >
          {t('encyclopedia.required_level')} {row.required_level}
        </span>
        {row.craft_xp > 0 && (
          <span
            className="text-[7px] tracking-[0.15em] uppercase px-1.5 py-px text-cyan"
            style={{ border: '1px solid rgba(74,158,255,0.3)', background: 'rgba(74,158,255,0.06)' }}
          >
            {t('encyclopedia.xp_suffix', { xp: row.craft_xp })}
          </span>
        )}
      </div>
      {/* The bill of materials — verbatim chain quantities, the whole point of the section. */}
      <div className="flex flex-col gap-0.5">
        {row.ingredients.map((ingredient) => (
          <div key={ingredient.template_id} className="flex items-center gap-1.5 min-w-0">
            <span className="text-[8px] shrink-0 text-gold/70">&times;{ingredient.qty}</span>
            <span className="text-[8px] truncate text-muted">{ingredient.name}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * The job page's crafts. Renders nothing when the chain lists no recipe for this job — the honest gap
 * (PetFoodSection idiom), never an empty shell.
 */
export function JobRecipesSection({
  recipes,
  items,
  job_index,
  on_navigate_to_item,
}: {
  recipes: RpcRecipe[] | undefined
  items: RpcEncyclopediaItem[] | undefined
  job_index: number
  on_navigate_to_item: (id: string) => void
}) {
  const { t } = useTranslation()
  const rows = useMemo(() => craft_recipes_for_job(recipes, items, job_index), [recipes, items, job_index])
  if (rows.length === 0) return null
  return (
    <div className="flex flex-col gap-2">
      <SectionDivider />
      <SectionTitle title={`${t('encyclopedia.job_recipes')} (${rows.length})`} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))', gap: 6 }}>
        {rows.map((row) => (
          <RecipeCard key={row.recipe_id} row={row} on_navigate_to_item={on_navigate_to_item} />
        ))}
      </div>
    </div>
  )
}
