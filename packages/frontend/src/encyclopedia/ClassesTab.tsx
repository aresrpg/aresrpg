// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { useState } from 'react'

import { spell_icon } from '../content/assets.ts'
import { encyclopedia_catalog, titleize } from '../content/catalog.ts'

import type { EncyclopediaText } from './copy.ts'
import { Empty } from './components.tsx'
import { SpellCard } from './SpellCard.tsx'

export const ClassesTab = ({
  selected_id,
  select_class,
  text,
}: Readonly<{
  selected_id: string | null
  select_class: (id: string) => void
  text: EncyclopediaText
}>) => {
  const [spell_name, set_spell_name] = useState<string | null>(null)
  const detail = selected_id ? encyclopedia_catalog.class(selected_id) : null
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
      <aside className="w-[300px] shrink-0 overflow-y-auto border-r border-[#1e1e2e]">
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
            <div className="flex min-h-[420px] border border-[#1e1e2e] bg-black/10">
              <div className="w-48 shrink-0 border-r border-[#1e1e2e] py-1">
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
                      <span className="min-w-0 flex-1 truncate text-[9px] tracking-[0.1em] uppercase">{row.name}</span>
                      <span className="shrink-0 text-[7px] tracking-[0.08em] text-[#777b86] uppercase">
                        Lv. {row.unlock_level}
                      </span>
                    </button>
                  )
                })}
              </div>
              <div className="min-w-0 flex-1 p-5">
                {spell && <SpellCard key={spell.name} spell={spell} text={text} />}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
