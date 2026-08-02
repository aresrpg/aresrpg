// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// PET FOOD — the two pet-food display surfaces: the encyclopedia shows what food a pet is
// using, and the item detail card in the inventory (hover) does too. The mechanic is
// PET-AGNOSTIC (D757 — see pet_foods.ts): every pet eats the ONE global configured food set, one unit
// per UTC day, so both surfaces render that set honestly — never a fabricated per-pet diet.
//   • <PetFoodSection>  the encyclopedia pet detail section (mob_spells_section idiom): the living food
//     items as icon tiles; hovering opens the food's own item card (the SHARED ItemDetailView — one
//     item renderer app-wide) and clicking navigates to the food's encyclopedia page (RecipeSections idiom).
//   • <PetFoodHoverRow> the compact line inside the inventory hover card (entity_tooltip mounts it for
//     PET items): the food count + a first-glance strip of food icons. A hover card cannot nest hovers,
//     so it stays a summary; the encyclopedia section is the full detail.
// Data arrives as PROPS (items_tab / entity_tooltip bind `pet_food_slugs` from virtual:item_catalog and
// the seed receipt at their edges) so this file stays bun-renderable for tests, zero Vite coupling.
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { SectionDivider, SectionTitle, ItemDetailView } from '../../components/entity_display'
import { ItemImage } from '../../components/items'
import { Tooltip } from '../../game/screens/hud/Tooltip.jsx'
import { useTemplateT } from '../../i18n/template_t'

import { encyclopedia_item_asset } from './encyclopedia_assets'
import { pet_food_rows } from './pet_foods'

/** The living /v1 encyclopedia row shape the items tab passes down (see items_tab.tsx `items`). */
interface PetFoodItemRow {
  id: string
  slug?: string
  name?: string
  level?: number
  category: string
  rarity?: string
  stats?: Record<string, number | [number, number]>
  damages?: { element: string; from: number; to: number; damage_type?: string }[]
  [key: string]: unknown
}

const HOVER_ICON_LIMIT = 8

/** The food's own item card as hover content — the same bounded box entity_tooltip draws. */
function FoodCard({ item, name }: { item: PetFoodItemRow; name: string }) {
  return (
    <div
      style={{
        background: 'var(--color-bg)',
        border: '1px solid rgba(200,150,60,0.3)',
        boxShadow: '0 0 20px rgba(200,150,60,0.1)',
        padding: '12px 16px',
        maxWidth: 280,
        fontFamily: 'JetBrains Mono, monospace',
      }}
    >
      <ItemDetailView
        item={{
          id: encyclopedia_item_asset(item).id,
          image_url: encyclopedia_item_asset(item).image_url,
          name,
          category: item.category,
          rarity: item.rarity || '',
          level: item.level || 0,
          damages: item.damages || [],
          stats: item.stats || {},
        }}
      />
    </div>
  )
}

/**
 * The encyclopedia pet detail's FOOD section: every LIVING food item as an icon tile — hover opens the
 * food's item card, click navigates to its encyclopedia page. Renders nothing when no food is minted
 * (the honest pre-seed gap, mirroring MobSpellsSection).
 */
export function PetFoodSection({
  items,
  food_slugs,
  on_select_item,
}: {
  items: readonly PetFoodItemRow[]
  food_slugs: readonly string[]
  on_select_item: (id: string) => void
}) {
  const { t } = useTranslation()
  const tt = useTemplateT()
  const rows = useMemo(() => pet_food_rows(food_slugs, items), [food_slugs, items])
  if (rows.length === 0) return null
  return (
    <>
      <SectionDivider />
      <div className="flex flex-col gap-2">
        <SectionTitle title={t('encyclopedia.pet_food')} />
        <span className="text-[9px] leading-relaxed text-muted">{t('pet.diet_note', { count: rows.length })}</span>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 4 }}>
          {rows.map((item) => {
            const asset = encyclopedia_item_asset(item)
            const name = tt(item, 'name')
            return (
              <Tooltip key={item.id} content={<FoodCard item={item} name={name} />}>
                <div
                  className="flex items-center gap-2 px-2 py-1.5 cursor-pointer"
                  data-pet-food={item.slug}
                  style={{ background: 'rgba(255,255,255,0.02)', borderLeft: '2px solid #c8963c40' }}
                  onClick={() => on_select_item(item.id)}
                  onMouseEnter={(event) => {
                    event.currentTarget.style.background = 'rgba(200,150,60,0.08)'
                  }}
                  onMouseLeave={(event) => {
                    event.currentTarget.style.background = 'rgba(255,255,255,0.02)'
                  }}
                >
                  <ItemImage
                    id={asset.id}
                    image_url={asset.image_url}
                    category={item.category}
                    className="w-6 h-6 shrink-0"
                  />
                  <span className="text-[9px] tracking-[0.1em] uppercase truncate flex-1 text-text">{name}</span>
                  <span className="text-[8px] shrink-0 text-muted">
                    {t('entity.level_short', { level: item.level || 0 })}
                  </span>
                </div>
              </Tooltip>
            )
          })}
        </div>
      </div>
    </>
  )
}

/**
 * The inventory hover card's compact pet-food line: "FOOD · N foods, one per day" + the first food
 * icons. `food_slugs` is the MINTED set (the caller joins minted_pet_food_slugs over the seed receipt);
 * icons resolve straight from the slug quilt, names stay on the encyclopedia surface.
 */
export function PetFoodHoverRow({ food_slugs }: { food_slugs: readonly string[] }) {
  const { t } = useTranslation()
  if (food_slugs.length === 0) return null
  const preview = food_slugs.slice(0, HOVER_ICON_LIMIT)
  const overflow = food_slugs.length - preview.length
  return (
    <div className="flex flex-col gap-1.5" data-pet-food-row>
      <span className="text-[9px] tracking-[0.25em] uppercase font-semibold text-muted">
        {t('encyclopedia.pet_food')}
      </span>
      <span className="text-[9px] leading-relaxed text-muted">{t('pet.diet_note', { count: food_slugs.length })}</span>
      <div className="flex items-center gap-1 flex-wrap">
        {preview.map((slug) => (
          <ItemImage key={slug} id={slug} category="RESOURCE" className="w-4 h-4" eager />
        ))}
        {overflow > 0 && <span className="text-[8px] text-muted shrink-0">+{overflow}</span>}
      </div>
    </div>
  )
}
