// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { titleize, type ConsumableEffect } from '../content/catalog.ts'

import type { EncyclopediaText } from './copy.ts'

export const consumable_effect_text = (consumable: ConsumableEffect, text: EncyclopediaText): string => {
  if (consumable.type === 'heal') return text('consumable_heal', { amount: consumable.amount })
  if (consumable.type === 'reset_stats') return text('consumable_reset_stats')
  if (consumable.type === 'reset_spells') return text('consumable_reset_spells')
  if (consumable.type === 'recall') return text('consumable_recall')
  if (consumable.type === 'city') return text('consumable_city', { city: titleize(consumable.city) })
  return text('consumable_loot_box')
}

export const ConsumableEffectSection = ({
  consumable,
  text,
}: Readonly<{ consumable?: ConsumableEffect; text: EncyclopediaText }>) => {
  if (!consumable) return null
  return (
    <section className="flex flex-col gap-2" data-consumable-effect="">
      <span className="text-[9px] font-semibold tracking-[0.25em] text-[#6b7280] uppercase">{text('effects')}</span>
      <div className="border-l-2 border-l-[#ff66b2]/40 bg-white/3 px-3 py-2 text-[10px] tracking-wide text-[#ff66b2]">
        {consumable_effect_text(consumable, text)}
      </div>
    </section>
  )
}
