// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { craft_required_level, craft_xp_from_ingredient_count } from '@aresrpg/immutable'

import { item_icon } from '../content/assets.ts'
import { encyclopedia_catalog, titleize, type SeedRecipe } from '../content/catalog.ts'

import type { EncyclopediaText } from './copy.ts'

const RecipeCard = ({
  recipe,
  select_item,
  text,
}: Readonly<{ recipe: SeedRecipe; select_item: (id: string) => void; text: EncyclopediaText }>) => {
  const output = encyclopedia_catalog.item(recipe.output_type)?.item
  const craft_xp = craft_xp_from_ingredient_count(Object.keys(recipe.inputs).length)
  return (
    <button
      className="flex cursor-pointer flex-col gap-1.5 border-l-2 border-l-[#c8963c]/25 bg-white/2 px-2 py-2 text-left transition-colors hover:bg-white/3"
      data-job-recipe={recipe.output_type}
      onClick={() => select_item(recipe.output_type)}
      type="button"
    >
      <span className="flex min-w-0 items-center gap-2">
        {item_icon(recipe.output_type) && (
          <img alt="" className="size-6 object-contain" src={item_icon(recipe.output_type)!} />
        )}
        <span className="min-w-0 flex-1 truncate text-[9px] tracking-[0.1em] text-[#e8e4dc] uppercase">
          {output?.name ?? titleize(recipe.output_type)}
        </span>
      </span>
      <span className="flex flex-wrap items-center gap-1">
        <span className="border border-[#c8963c]/30 bg-[#c8963c]/8 px-1.5 py-px text-[7px] tracking-[0.15em] text-[#c8963c] uppercase">
          {text('required_level')} {craft_required_level(Object.keys(recipe.inputs).length)}
        </span>
        {craft_xp > 0 && (
          <span className="border border-[#4a9eff]/30 bg-[#4a9eff]/6 px-1.5 py-px text-[7px] tracking-[0.15em] text-[#4a9eff] uppercase">
            {text('xp_suffix', { xp: craft_xp })}
          </span>
        )}
      </span>
      <span className="flex flex-col gap-0.5">
        {Object.entries(recipe.inputs).map(([item_type, quantity]) => (
          <span className="flex min-w-0 items-center gap-1.5" key={item_type}>
            <span className="shrink-0 text-[8px] text-[#c8963c]/70">×{quantity}</span>
            <span className="truncate text-[8px] text-[#6b7280]">
              {encyclopedia_catalog.item(item_type)?.item.name ?? titleize(item_type)}
            </span>
          </span>
        ))}
      </span>
    </button>
  )
}

export const JobRecipesSection = ({
  recipes,
  select_item,
  text,
}: Readonly<{ recipes: readonly SeedRecipe[]; select_item: (id: string) => void; text: EncyclopediaText }>) => {
  if (recipes.length === 0) return null
  const rows = recipes.toSorted(
    (left, right) =>
      (encyclopedia_catalog.item(left.output_type)?.item.level ?? 0) -
      (encyclopedia_catalog.item(right.output_type)?.item.level ?? 0)
  )
  return (
    <section className="flex flex-col gap-2">
      <div className="h-px w-full bg-white/6" />
      <span className="text-[9px] font-semibold tracking-[0.25em] text-[#6b7280] uppercase">
        {text('job_recipes')} ({rows.length})
      </span>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-1.5">
        {rows.map((recipe) => (
          <RecipeCard key={recipe.output_type} recipe={recipe} select_item={select_item} text={text} />
        ))}
      </div>
    </section>
  )
}
