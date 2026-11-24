// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { pet_foods_of } from '../content/items.ts'
import { EncyclopediaItemIcon } from '../encyclopedia/EncyclopediaItemIcon.tsx'
import { useText } from '../i18n/useText.ts'

export const ItemPetDiet = ({
  item_type,
  select_item,
}: Readonly<{ item_type: string; select_item?: (id: string) => void }>) => {
  const text = useText()
  const foods = pet_foods_of(item_type)
  const Row = select_item ? 'button' : 'div'
  return (
    <section className="flex flex-col gap-2" data-pet-diet="">
      <span className="text-[9px] font-semibold tracking-[0.25em] text-faint uppercase">
        {text('encyclopedia_page.pet_food')}
      </span>
      <span className="text-[9px] leading-relaxed text-faint">
        {text(foods.length ? 'encyclopedia_page.pet_diet_note' : 'encyclopedia_page.no_diet', {
          count: foods.length,
        })}
      </span>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-1">
        {foods.map((food, index) => (
          <Row
            className={`flex items-center gap-2 px-2 py-1.5 text-left ${select_item ? 'cursor-pointer hover:bg-gold/8' : ''}`}
            key={food.item_type}
            onClick={select_item ? () => select_item(food.item_type) : undefined}
            style={{ background: index % 2 === 0 ? 'rgba(255,255,255,0.03)' : 'rgba(255,255,255,0.015)' }}
            type={select_item ? 'button' : undefined}
          >
            <EncyclopediaItemIcon item_type={food.item_type} label={food.name} />
            <span className="min-w-0 flex-1 text-[9px] tracking-[0.1em] text-text uppercase">{food.name}</span>
            <span className="shrink-0 text-[8px] text-faint">
              {text('encyclopedia_page.level_short', { level: food.level })}
            </span>
          </Row>
        ))}
      </div>
    </section>
  )
}
