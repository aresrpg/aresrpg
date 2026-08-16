// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// A red cell's established editor: choose one authored mob, then choose a level inside its authored range.

import { Trash2 } from 'lucide-react'
import { useState } from 'react'

import { ModalFrame } from '../components/ModalFrame.tsx'
import { mob_icon } from '../content/assets.ts'
import { encyclopedia_catalog } from '../content/catalog.ts'
import { EntityIcon } from '../encyclopedia/components.tsx'
import { encyclopedia_text } from '../encyclopedia/copy.ts'
import { SpellCard } from '../encyclopedia/SpellCard.tsx'
import type { AppCopy } from '../i18n/copy.ts'
import { dispatch_app, useAppStore } from '../store.ts'

import { MobPicker } from './MobPicker.tsx'

const template = (source: string, values: Readonly<Record<string, string | number>>): string =>
  Object.entries(values).reduce((text, [key, value]) => text.replaceAll(`{${key}}`, String(value)), source)

export const MobModal = ({ cell, close, copy }: Readonly<{ cell: bigint; close: () => void; copy: AppCopy }>) => {
  const placement = useAppStore(({ simulator }) => simulator.mob_placements[Number(cell)])
  const [picking, set_picking] = useState(placement === undefined)
  const [spell_index, set_spell_index] = useState(0)
  const mob = placement
    ? (encyclopedia_catalog.mobs.find(({ mob_type }) => mob_type === placement.mob_type) ?? null)
    : null
  const text = copy.simulator_page

  if (picking || !placement || !mob)
    return (
      <MobPicker
        close={placement ? () => set_picking(false) : close}
        copy={copy}
        pick={(picked) => {
          dispatch_app({
            type: 'simulator/mob_placed',
            cell,
            mob_type: picked.mob_type,
            level: placement?.level ?? picked.level_min,
            level_min: picked.level_min,
            level_max: picked.level_max,
          })
          set_spell_index(0)
          set_picking(false)
        }}
        value={placement?.mob_type}
      />
    )

  const selected_spell = mob.spells[Math.min(spell_index, mob.spells.length - 1)]
  const levels = Array.from({ length: mob.level_max - mob.level_min + 1 }, (_, index) => mob.level_min + index)
  return (
    <ModalFrame close={close} close_label={copy.wallet_close} label={mob.name} max_width="max-w-2xl">
      <div className="flex flex-col gap-5 px-6 py-6">
        <header className="flex items-center gap-3 pr-8">
          <EntityIcon label={mob.name} size="size-12" src={mob_icon(mob.mob_type)} />
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-[12px] tracking-[0.2em] text-[#c8963c] uppercase">{mob.name}</h2>
            <p className="mt-1 text-[8px] tracking-[0.16em] text-[#6b7280] uppercase">
              {template(text.level_range, { min: mob.level_min, max: mob.level_max })}
            </p>
          </div>
        </header>
        <div className="h-px bg-white/6" />
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-[8px] tracking-[0.16em] text-[#6b7280] uppercase">
            {template(text.level, { level: placement.level })}
            <select
              className="mt-2 block h-9 w-24 border border-white/10 bg-[#0a0a0f] px-2 text-[10px] text-[#e8e4dc]"
              onChange={(event) =>
                dispatch_app({
                  type: 'simulator/mob_placed',
                  cell,
                  mob_type: mob.mob_type,
                  level: Number(event.target.value),
                  level_min: mob.level_min,
                  level_max: mob.level_max,
                })
              }
              value={placement.level}
            >
              {levels.map((level) => (
                <option key={level} value={level}>
                  {level}
                </option>
              ))}
            </select>
          </label>
          <button
            className="h-9 cursor-pointer border border-white/10 px-3 text-[8px] tracking-[0.14em] text-[#a3a5ad] uppercase"
            onClick={close}
            type="button"
          >
            {text.pick_mob}
          </button>
          <button
            className="flex h-9 cursor-pointer items-center gap-1 border border-[#ff5f5f]/40 px-3 text-[8px] tracking-[0.14em] text-[#ff7d7d] uppercase"
            onClick={() => {
              dispatch_app({ type: 'simulator/mob_unplaced', cell })
              close()
            }}
            type="button"
          >
            <Trash2 size={11} /> {text.remove_mob}
          </button>
        </div>
        {mob.spells.length > 0 && (
          <section className="grid min-h-0 grid-cols-[150px_minmax(0,1fr)] border border-white/8">
            <div className="border-r border-white/8">
              {mob.spells.map((spell, index) => (
                <button
                  className={`block w-full cursor-pointer border-l-2 px-3 py-2 text-left text-[8px] uppercase ${index === spell_index ? 'border-[#c8963c] bg-[#c8963c]/8 text-[#c8963c]' : 'border-transparent text-[#6b7280]'}`}
                  key={`${spell.name}-${index}`}
                  onClick={() => set_spell_index(index)}
                  type="button"
                >
                  {spell.name}
                </button>
              ))}
            </div>
            <div className="min-w-0 p-4">
              {selected_spell && (
                <SpellCard
                  spell={{
                    classe: mob.mob_type,
                    levels: selected_spell.levels,
                    name: selected_spell.name,
                    unlock_level: 1,
                  }}
                  text={encyclopedia_text(copy)}
                />
              )}
            </div>
          </section>
        )}
      </div>
    </ModalFrame>
  )
}
