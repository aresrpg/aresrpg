// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The inventory paper doll wired to the seed catalog and the shared picker/detail components.

import { equipment_slot_accepts, type CharacterEquipmentSlot } from '@aresrpg/immutable'
import { useMemo, useState } from 'react'

import { EquipmentDoll } from '../components/EquipmentDoll.tsx'
import { ItemDetailView } from '../components/ItemDetailView.tsx'
import { SearchPickerModal, type PickerCopy, type PickerItem } from '../components/SearchPickerModal.tsx'
import { item_icon } from '../content/assets.ts'
import { encyclopedia_catalog } from '../content/catalog.ts'
import { encyclopedia_text } from '../encyclopedia/copy.ts'
import type { AppCopy } from '../i18n/copy.ts'
import type { SimulatorCharacter } from '../modules/simulator.ts'
import { dispatch_app } from '../store.ts'

const template = (source: string, values: Readonly<Record<string, string | number>>): string =>
  Object.entries(values).reduce((text, [key, value]) => text.replaceAll(`{${key}}`, String(value)), source)

export const LoadoutSection = ({
  copy,
  character,
}: Readonly<{
  copy: AppCopy
  character: SimulatorCharacter
}>) => {
  const [picking, set_picking] = useState<CharacterEquipmentSlot | null>(null)
  const text = copy.simulator_page
  const { loadout } = character
  const encyclopedia = encyclopedia_text(copy)
  const item_for = (slot: CharacterEquipmentSlot) =>
    encyclopedia_catalog.items.find(({ item_type }) => item_type === loadout[slot]) ?? null
  const options = useMemo(
    () =>
      picking
        ? encyclopedia_catalog.items.filter(({ category }) => equipment_slot_accepts(picking, category))
        : Object.freeze([]),
    [picking]
  )
  const items = useMemo<readonly PickerItem[]>(
    () =>
      Object.freeze(
        options.map((item) =>
          Object.freeze({
            id: item.item_type,
            label: item.name,
            category: item.category,
            sublabel: template(text.level, { level: item.level }),
            icon: item_icon(item.item_type),
          })
        )
      ),
    [options, text]
  )
  const picker_copy = useMemo<PickerCopy>(
    () =>
      Object.freeze({
        search: (title: string) => template(text.picker_search, { title }),
        all: text.picker_all,
        no_results: text.picker_no_results,
        results: (filtered: number, total: number) => template(text.picker_results, { filtered, total }),
        selected: (label: string) => template(text.picker_selected, { label }),
        new_label: text.picker_new,
      }),
    [text]
  )
  return (
    <>
      <EquipmentDoll item_for={item_for} open={set_picking} />
      {picking && (
        <SearchPickerModal
          copy={picker_copy}
          items={items}
          on_close={() => set_picking(null)}
          on_select={(item_type) => {
            dispatch_app({
              type: 'simulator/loadout_set',
              character_id: character.id,
              slot: picking,
              item_type,
            })
            set_picking(null)
          }}
          render_tooltip={(item_type) => {
            const item = encyclopedia_catalog.items.find((candidate) => candidate.item_type === item_type)
            return item ? (
              <div className="w-[296px] border border-[#c8963c]/30 bg-[#12121a] p-4 shadow-2xl">
                <ItemDetailView
                  category={item.category}
                  damages={item.damages ?? []}
                  icon={item_icon(item.item_type)}
                  labels={{
                    characteristics: encyclopedia('characteristics'),
                    damages: encyclopedia('damages'),
                    level_short: encyclopedia('level_short', { level: item.level }),
                    range_to: encyclopedia('range_to'),
                  }}
                  level={item.level}
                  name={item.name}
                  stats={item.stats}
                >
                  <span className="text-[8px] tracking-[0.18em] text-[#c8963c] uppercase">{text.max_roll}</span>
                </ItemDetailView>
              </div>
            ) : null
          }}
          title={picking.replaceAll('_', ' ')}
          value={loadout[picking]}
        />
      )}
    </>
  )
}
