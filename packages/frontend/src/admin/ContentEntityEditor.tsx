// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { item_icon } from '../content/assets.ts'

import { as_record, NumberField, SheetSection, string_value, TextField, titleize_field } from './ContentFields.tsx'
import { ItemContentEditor, type ItemRecipeBinding } from './ItemContentEditor.tsx'
import { JsonEditor } from './JsonEditor.tsx'
import { MobContentEditor } from './MobContentEditor.tsx'
import type { JsonPath, JsonValue, SeedDomain } from './seed_editor.ts'
import { StructurePackEditor } from './StructurePackEditor.tsx'

type Props = Readonly<{
  domain: SeedDomain
  value: JsonValue
  on_change: (path: JsonPath, value: JsonValue) => void
  is_readonly: (path: JsonPath) => boolean
  save?: () => void
  item_recipe?: ItemRecipeBinding
}>

const ItemThumb = ({ item_type }: Readonly<{ item_type: string }>) => (
  <span className="grid size-9 shrink-0 place-items-center border border-white/8 bg-black/25">
    {item_icon(item_type) ? (
      <img alt="" className="size-8 object-contain" src={item_icon(item_type)!} />
    ) : (
      <span className="text-[6px] text-[#555b66]">NO ICON</span>
    )}
  </span>
)

const ShopEditor = ({ value, on_change }: Pick<Props, 'value' | 'on_change'>) => {
  const sale = as_record(value)
  if (!sale) return null
  const item_type = string_value(sale.item_type)
  return (
    <div className="mx-auto max-w-2xl" data-content-editor="shop">
      <section className="flex items-center gap-4 border-b border-white/9 pb-5">
        <ItemThumb item_type={item_type} />
        <div className="flex flex-wrap items-end gap-3">
          <TextField change={(next) => on_change(['item_type'], next)} label="Item" value={item_type} width="w-56" />
          <NumberField
            change={(next) => on_change(['price'], next)}
            label="Price"
            value={typeof sale.price === 'number' ? sale.price : 0}
            width="w-24"
          />
          <NumberField
            change={(next) => on_change(['supply'], next)}
            label="Supply"
            value={typeof sale.supply === 'number' ? sale.supply : 0}
            width="w-24"
          />
        </div>
      </section>
    </div>
  )
}

const AirdropEditor = ({ value, on_change, is_readonly }: Pick<Props, 'value' | 'on_change' | 'is_readonly'>) => {
  const row = as_record(value)
  if (!row) return null
  const identity_keys = ['id', 'name', 'kind'] as const
  const identity = identity_keys.filter((key) => key in row)
  const rest = Object.freeze(
    Object.fromEntries(Object.entries(row).filter(([key]) => !identity_keys.includes(key as never)))
  )
  return (
    <div className="mx-auto max-w-3xl space-y-5" data-content-editor="airdrop">
      <section className="flex flex-wrap items-end gap-3 border-b border-white/9 pb-4">
        {identity.map((key) => (
          <TextField
            change={(next) => on_change([key], next)}
            key={key}
            label={titleize_field(key)}
            value={string_value(row[key])}
            width={key === 'name' ? 'w-64' : 'w-44'}
          />
        ))}
      </section>
      {Object.keys(rest).length > 0 && (
        <SheetSection accent="#b584e8" note="Distribution, custody, and asset facts for this entry." title="Entry data">
          <JsonEditor is_readonly={is_readonly} on_change={on_change} value={rest} />
        </SheetSection>
      )}
    </div>
  )
}

export const ContentEntityEditor = ({ domain, value, on_change, is_readonly, save, item_recipe }: Props) => {
  if (domain === 'items')
    return (
      <ItemContentEditor
        is_readonly={is_readonly}
        item_recipe={item_recipe}
        on_change={on_change}
        save={save}
        value={value}
      />
    )
  if (domain === 'mobs') return <MobContentEditor on_change={on_change} save={save} value={value} />
  if (domain === 'shop') return <ShopEditor on_change={on_change} value={value} />
  if (domain === 'airdrop') return <AirdropEditor is_readonly={is_readonly} on_change={on_change} value={value} />
  if (domain === 'structure_packs') return <StructurePackEditor on_change={on_change} save={save} value={value} />
  return <JsonEditor is_readonly={is_readonly} on_change={on_change} value={value} />
}
