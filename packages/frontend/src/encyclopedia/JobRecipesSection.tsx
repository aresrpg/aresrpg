// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { item_icon } from '../content/assets.ts'
import { encyclopedia_catalog, titleize, type SeedRecipe } from '../content/catalog.ts'

import type { EncyclopediaText } from './copy.ts'
import { EntityButton, EntityGrid } from './components.tsx'

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
        {text('craftable_items')} ({rows.length})
      </span>
      <EntityGrid>
        {rows.map((recipe, index) => {
          const output = encyclopedia_catalog.item(recipe.output_type)?.item
          return (
            <EntityButton
              active={false}
              badge={output && output.level > 0 ? text('level_short', { level: output.level }) : undefined}
              icon={item_icon(recipe.output_type)}
              index={index}
              key={recipe.output_type}
              meta={titleize(output?.category ?? '')}
              name={output?.name ?? titleize(recipe.output_type)}
              select={() => select_item(recipe.output_type)}
            />
          )
        })}
      </EntityGrid>
    </section>
  )
}
