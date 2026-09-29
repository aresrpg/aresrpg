// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { useState } from 'react'
import { MapPin } from 'lucide-react'

import { useNumbers } from '../i18n/useNumbers.ts'
import { useText } from '../i18n/useText.ts'
import { useItemCategoryName } from '../i18n/useItemCategoryName.ts'
import { MobCoreStats } from '../components/MobCoreStats.tsx'
import { mob_icon } from '../content/assets.ts'
import { centered_resistance, encyclopedia_catalog, titleize } from '../content/catalog.ts'
import { element_colors, item_category_colors, stat_identities } from '../visual_identity.ts'

import { EntityIcon, Section } from './components.tsx'
import type { EncyclopediaText } from './copy.ts'
import { EncyclopediaItemIcon } from './EncyclopediaItemIcon.tsx'
import { SpellCard } from './SpellCard.tsx'

type MobLootRow = NonNullable<ReturnType<typeof encyclopedia_catalog.mob>>['loot'][number]
const mob_loot_view = ({ drop, item }: MobLootRow) =>
  Object.freeze({
    chance: drop.chance_bp / 100,
    quantity: drop.min_qty === drop.max_qty ? `×${drop.min_qty}` : `×${drop.min_qty}–${drop.max_qty}`,
    category: item?.category ?? '',
    name: item?.name ?? titleize(drop.item_type),
  })

export const CatalogueMobDetails = ({
  mob_type,
  select_item,
  select_world,
  text,
}: Readonly<{
  mob_type: string
  select_item: (id: string) => void
  select_world: (id: string) => void
  text: EncyclopediaText
}>) => {
  const ui = useText()
  const category_name = useItemCategoryName()
  const numbers = useNumbers()
  const [spell_index, set_spell_index] = useState(0)
  const detail = encyclopedia_catalog.mob(mob_type)
  if (!detail) return null
  const selected_spell = detail.mob.spells[Math.min(spell_index, detail.mob.spells.length - 1)]
  return (
    <div className="aui-mob-catalogue" data-mob-catalogue={mob_type}>
      <div className="mx-auto flex max-w-2xl flex-col gap-5">
        <header className="flex items-center gap-3">
          <EntityIcon label={detail.mob.name} size="size-[73px]" src={mob_icon(detail.mob.mob_type)} />
          <div>
            <h2
              className="text-[14px] font-semibold tracking-[0.15em] uppercase"
              style={{ color: element_colors[detail.mob.element] }}
            >
              {detail.mob.name}
            </h2>
            <p className="mt-1 text-[9px] tracking-[0.12em] text-[#6b7280] uppercase">
              {text(`world_role.${detail.mob.role === 'normal' ? 'trash' : detail.mob.role}`)} ·{' '}
              {text('level_range', { min: detail.mob.level_min, max: detail.mob.level_max })}
            </p>
          </div>
        </header>
        <MobCoreStats
          labels={{
            agility: text('gameplay.stat_agility'),
            wisdom: text('gameplay.stat_wisdom'),
            xp: ui('ui.xp'),
          }}
          values={detail.mob}
        />
        <Section title={text('gameplay.resistance')}>
          <div className="grid gap-2 sm:grid-cols-2">
            {Object.entries(detail.mob.resistances).map(([name, value]) => {
              const resistance = centered_resistance(value)
              const identity =
                stat_identities[
                  name === 'earth'
                    ? 'strength'
                    : name === 'fire'
                      ? 'intelligence'
                      : name === 'water'
                        ? 'chance'
                        : 'agility'
                ]
              const color = resistance < 0 ? '#ff7d7d' : (element_colors[name] ?? '#78b5ff')
              return (
                <div
                  className="flex min-h-11 items-center gap-3 border border-white/8 bg-white/[0.018] px-3 py-2"
                  data-mob-resistance={name}
                  key={name}
                >
                  {identity && <img alt="" className="size-6 object-contain" src={identity.icon} />}
                  <span className="min-w-0 flex-1 text-[8px] tracking-[0.12em] uppercase" style={{ color }}>
                    {text(`element.${name}`)}
                  </span>
                  <span className="text-[11px] font-semibold tabular-nums" style={{ color }}>
                    {resistance > 0 ? '+' : ''}
                    {resistance}%
                  </span>
                </div>
              )
            })}
          </div>
        </Section>
        <Section title={text('gameplay.section_loot')}>
          {detail.loot.length === 0 ? (
            <p className="text-[9px] italic text-[#6b7280]">{text('no_drops')}</p>
          ) : (
            <div className="flex flex-col gap-1">
              {detail.loot.map(({ drop, item }) => {
                const { chance, quantity, category, name } = mob_loot_view({ drop, item })
                return (
                  <button
                    className="flex cursor-pointer flex-col bg-white/2 px-2 py-1.5 text-left hover:bg-[#c8963c]/8"
                    key={drop.item_type}
                    onClick={() => select_item(drop.item_type)}
                    type="button"
                  >
                    <span className="flex items-center justify-between gap-3">
                      <span className="flex min-w-0 items-center gap-2">
                        <EncyclopediaItemIcon item_type={drop.item_type} label={name} />
                        <span className="truncate text-[10px] text-[#e8e4dc]">{name}</span>
                        {category && (
                          <span
                            className="shrink-0 text-[8px] tracking-wide uppercase"
                            style={{ color: item_category_colors[category] ?? '#6b728080' }}
                          >
                            {category_name(category)}
                          </span>
                        )}
                      </span>
                      <span className="flex shrink-0 items-center gap-2">
                        <span className="text-[10px] font-semibold tabular-nums text-[#c8963c]">
                          ~{numbers.decimal(chance)}%
                        </span>
                        <span className="text-[9px] text-[#6b7280]">{quantity}</span>
                      </span>
                    </span>
                    <span className="mt-1 h-[3px] w-full bg-white/5" data-mob-loot-progress="">
                      <span
                        className="block h-full bg-[linear-gradient(90deg,rgba(200,150,60,0.6),rgba(200,150,60,0.3))]"
                        style={{ width: `${Math.min(100, chance)}%` }}
                      />
                    </span>
                  </button>
                )
              })}
            </div>
          )}
        </Section>
        {detail.locations.length > 0 && (
          <Section title={text('found_in')}>
            <div className="flex flex-col gap-1" data-mob-found-in="">
              {detail.locations.map((location) => {
                const places = [...location.biomes, ...location.cities]
                return (
                  <button
                    className="flex cursor-pointer items-center gap-2 bg-white/2 px-2 py-1.5 text-left hover:bg-[#c8963c]/8"
                    key={location.world}
                    onClick={() => select_world(location.world)}
                    type="button"
                  >
                    <MapPin className="shrink-0 text-[#c8963c]/60" size={11} />
                    <span className="min-w-0 flex-1 text-[10px] tracking-[0.1em] text-[#c8963c] uppercase">
                      {titleize(location.world)}
                    </span>
                    {places.length > 0 && (
                      <span
                        className="text-[8px] tracking-[0.12em] text-[#6b7280] uppercase"
                        data-mob-location-places={location.world}
                      >
                        {places.map(titleize).join(' · ')}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          </Section>
        )}
        {detail.mob.spells.length > 0 && (
          <Section title={text('mob_spells')}>
            <div className="border border-border" data-mob-spell-tabs="">
              <div className="flex min-w-0 overflow-x-auto border-b border-border bg-black/15" role="tablist">
                {detail.mob.spells.map((spell, index) => (
                  <button
                    aria-selected={index === spell_index}
                    className={`aui-button ${index === spell_index ? 'aui-button--primary' : 'aui-button--neutral'}`}
                    key={`${spell.name}-${index}`}
                    onClick={() => set_spell_index(index)}
                    role="tab"
                    type="button"
                  >
                    {spell.name}
                  </button>
                ))}
              </div>
              <div className="min-w-0 p-4">
                {selected_spell && (
                  <SpellCard
                    key={selected_spell.name}
                    show_icon={false}
                    spell={{
                      classe: detail.mob.mob_type,
                      levels: selected_spell.levels,
                      name: selected_spell.name,
                    }}
                    text={text}
                  />
                )}
              </div>
            </div>
          </Section>
        )}
      </div>
    </div>
  )
}
