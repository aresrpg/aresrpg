// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { useState } from 'react'
import { characteristic_ladders, characteristic_names, is_class_name } from '@aresrpg/immutable'

import { spell_icon } from '../content/assets.ts'
import { encyclopedia_catalog, titleize } from '../content/catalog.ts'

import type { EncyclopediaText } from './copy.ts'
import { Empty } from './components.tsx'
import { SpellCard } from './SpellCard.tsx'

export const ClassesTab = ({
  selected_id,
  select_class,
  text,
  spell_name: display_spell_name,
}: Readonly<{
  selected_id: string | null
  select_class: (id: string) => void
  text: EncyclopediaText
  spell_name: (identity: string) => string
}>) => {
  const [spell_name, set_spell_name] = useState<string | null>(null)
  const detail = selected_id ? encyclopedia_catalog.class(selected_id) : null
  const classe = detail && is_class_name(detail.id) ? detail.id : null
  const spells = detail?.spells.toSorted(
    (left, right) => left.unlock_level - right.unlock_level || left.name.localeCompare(right.name)
  )
  const spell = spells?.find(({ name }) => name === spell_name) ?? spells?.[0]
  const choose_class = (id: string): void => {
    set_spell_name(null)
    select_class(id)
  }
  return (
    <div className="flex min-h-0 flex-1">
      <aside className="w-[300px] shrink-0 overflow-y-auto border-r border-border">
        {encyclopedia_catalog.classes.map((row, index) => {
          const active = selected_id === row.id
          return (
            <button
              className="flex w-full border-l-2 px-3 py-3 text-left"
              key={row.id}
              onClick={() => choose_class(row.id)}
              style={{
                borderLeftColor: active ? '#c8963c' : 'transparent',
                background: active ? 'rgba(200,150,60,0.08)' : index % 2 ? 'rgba(255,255,255,0.02)' : 'transparent',
              }}
              type="button"
            >
              <span className="bg-[linear-gradient(135deg,#fad9b3,#d4a145,#f0c474)] bg-clip-text text-[11px] font-semibold tracking-[0.15em] text-transparent uppercase">
                {titleize(row.id)}
              </span>
            </button>
          )
        })}
      </aside>
      <div className="min-h-0 flex-1 overflow-y-auto p-4 pt-14">
        {!detail ? (
          <Empty>{text('select_class')}</Empty>
        ) : (
          <div className="mx-auto flex max-w-6xl flex-col gap-4">
            <header>
              <h2 className="bg-[linear-gradient(135deg,#fad9b3,#d4a145,#f0c474)] bg-clip-text text-[14px] font-semibold tracking-[0.25em] text-transparent uppercase">
                {titleize(detail.id)}
              </h2>
              <p className="mt-1 text-[9px] tracking-[0.15em] text-[#6b7280] uppercase">
                {text('spells_count', { count: detail.spells.length })}
              </p>
            </header>
            {classe && (
              <section className="border border-border bg-black/10" data-characteristic-costs="">
                <div className="border-b border-border px-3 py-2">
                  <h3 className="text-[9px] tracking-[0.18em] text-[#c8963c] uppercase">
                    {text('characteristic_costs')}
                  </h3>
                  <p className="mt-1 text-[8px] text-[#777b86]">{text('characteristic_costs_desc')}</p>
                </div>
                <div>
                  {characteristic_names.map((stat) => (
                    <div
                      className="grid grid-cols-[130px_1fr] gap-3 border-b border-border/60 px-3 py-2 last:border-b-0"
                      data-characteristic={stat}
                      key={stat}
                    >
                      <span className="text-[8px] tracking-[0.12em] text-[#b7bbc4] uppercase">
                        {text(`gameplay.stat_${stat}`)}
                      </span>
                      <span className="flex flex-wrap gap-1.5">
                        {characteristic_ladders[classe][stat].map((step, index, rows) => {
                          const cap = rows[index + 1]?.from
                          return (
                            <span
                              className="border border-white/8 bg-white/3 px-2 py-1 text-[7px] text-[#9298a3]"
                              data-cost={step.cost}
                              data-from={step.from}
                              key={step.from}
                            >
                              {text(cap === undefined ? 'characteristic_cost_unlimited' : 'characteristic_cost_band', {
                                cost: step.cost,
                                gain: step.gain,
                                cap: cap ?? 0,
                              })}
                            </span>
                          )
                        })}
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            )}
            <div className="flex min-h-[420px] border border-border bg-black/10">
              <div className="w-48 shrink-0 border-r border-border py-1">
                {spells?.map((row) => {
                  const active = spell?.name === row.name
                  return (
                    <button
                      className={`flex w-full items-center gap-2 border-l-2 px-2.5 py-2 text-left ${active ? 'border-[#c8963c] bg-[#c8963c]/8 text-[#c8963c]' : 'border-transparent text-[#e8e4dc]'}`}
                      key={row.name}
                      onClick={() => set_spell_name(row.name)}
                      type="button"
                    >
                      {spell_icon(row.classe, row.name) && (
                        <img alt="" className="size-5 shrink-0 object-cover" src={spell_icon(row.classe, row.name)!} />
                      )}
                      <span className="min-w-0 flex-1 truncate text-[9px] tracking-[0.1em] uppercase">
                        {display_spell_name(row.name)}
                      </span>
                      <span className="shrink-0 text-[7px] tracking-[0.08em] text-[#777b86] uppercase">
                        Lv. {row.unlock_level}
                      </span>
                    </button>
                  )
                })}
              </div>
              <div className="min-w-0 flex-1 p-5">
                {spell && (
                  <SpellCard display_name={display_spell_name(spell.name)} key={spell.name} spell={spell} text={text} />
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
