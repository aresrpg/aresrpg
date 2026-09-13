// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { useMemo } from 'react'

import { mob_icon } from '../content/assets.ts'
import { copy_text } from '../i18n/copy.ts'
import { useAppStore } from '../store.ts'

import { as_record, number_value, SheetSection, string_value } from './ContentFields.tsx'
import type { JsonValue } from './seed_editor.ts'

/** Read the live draft, not the compiled catalog: unsaved loot changes are visible immediately. */
export const item_drop_sources = (value: JsonValue | undefined, item_type: string) => {
  if (!Array.isArray(value) || !item_type) return []
  return value
    .flatMap((value) => {
      const mob = as_record(value)
      if (!mob || !Array.isArray(mob.loot)) return []
      return mob.loot.flatMap((value, index) => {
        const drop = as_record(value)
        if (drop?.item_type !== item_type) return []
        return [
          {
            key: `${string_value(mob.mob_type)}:${index}`,
            mob_type: string_value(mob.mob_type),
            name: string_value(mob.name) || string_value(mob.mob_type),
            level_min: number_value(mob.level_min),
            level_max: number_value(mob.level_max),
            chance_bp: number_value(drop.chance_bp),
            min_qty: number_value(drop.min_qty),
            max_qty: number_value(drop.max_qty),
          },
        ]
      })
    })
    .toSorted((a, b) => a.level_min - b.level_min || a.name.localeCompare(b.name))
}

export const ItemDropSources = ({ item_type }: Readonly<{ item_type: string }>) => {
  const mobs = useAppStore((state) => state.editor.files.mobs?.value)
  const copy = useAppStore((state) => state.copy)
  const sources = useMemo(() => item_drop_sources(mobs, item_type), [mobs, item_type])
  if (!copy) return null
  const text = copy_text(copy.item_drop_sources)
  return (
    <SheetSection title={text('title')} note={text('note')} accent="#c8963c">
      <div data-item-drop-sources="" className="overflow-x-auto">
        {sources.length === 0 ? (
          <p className="py-3 text-[10px] text-muted">{text(mobs === undefined ? 'loading' : 'empty')}</p>
        ) : (
          <table className="w-full text-left text-[10px]">
            <thead className="text-[8px] tracking-widest text-muted uppercase">
              <tr>
                <th className="pb-2 font-normal">{text('mob')}</th>
                <th className="pb-2 text-right font-normal">{text('rate')}</th>
                <th className="pb-2 pl-4 text-right font-normal">{text('quantity')}</th>
              </tr>
            </thead>
            <tbody>
              {sources.map((source) => (
                <tr key={source.key} className="border-t border-white/8">
                  <td className="py-2 pr-3">
                    <div className="flex items-center gap-3">
                      <img src={mob_icon(source.mob_type) ?? undefined} alt="" className="size-9 object-contain" />
                      <div>
                        <div className="font-semibold text-gold">{source.name}</div>
                        <div className="mt-1 text-[8px] text-muted">
                          {text('levels', { min: source.level_min, max: source.level_max })}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="text-right text-gold tabular-nums">{(source.chance_bp / 100).toFixed(2)}%</td>
                  <td className="pl-4 text-right tabular-nums">
                    {source.min_qty === source.max_qty ? source.min_qty : `${source.min_qty}–${source.max_qty}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </SheetSection>
  )
}
