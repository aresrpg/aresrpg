// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { craft_xp_from_ingredient_count, job_slugs } from '@aresrpg/immutable'

import { item_icon } from '../content/assets.ts'

import {
  as_record,
  button_class,
  NumberField,
  SelectField,
  SheetSection,
  string_value,
  TextField,
  titleize_field,
} from './ContentFields.tsx'
import { ItemContentEditor } from './ItemContentEditor.tsx'
import { JsonEditor } from './JsonEditor.tsx'
import { MobContentEditor } from './MobContentEditor.tsx'
import type { JsonPath, JsonValue, SeedDomain } from './seed_editor.ts'

type Props = Readonly<{
  domain: SeedDomain
  value: JsonValue
  on_change: (path: JsonPath, value: JsonValue) => void
  is_readonly: (path: JsonPath) => boolean
  save?: () => void
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

const RecipeEditor = ({ value, on_change }: Pick<Props, 'value' | 'on_change'>) => {
  const recipe = as_record(value)
  if (!recipe) return null
  const inputs = as_record(recipe.inputs) ?? {}
  const rows = Object.entries(inputs)
  const replace_input = (index: number, item_type: string, quantity: number): void => {
    const current_type = rows[index]?.[0]
    if (item_type !== current_type && Object.hasOwn(inputs, item_type)) return
    on_change(
      ['inputs'],
      Object.freeze(
        Object.fromEntries(
          rows.map(([current, amount], row) => (row === index ? [item_type, quantity] : [current, amount]))
        )
      )
    )
  }
  return (
    <div className="mx-auto max-w-3xl space-y-5" data-content-editor="recipe">
      <section className="flex flex-wrap items-end gap-3 border-b border-white/9 pb-4">
        <TextField
          change={(next) => on_change(['output_type'], next)}
          label="Crafted item"
          value={string_value(recipe.output_type)}
          width="w-56"
        />
        <SelectField
          change={(next) => on_change(['job'], next)}
          label="Profession"
          options={job_slugs}
          value={string_value(recipe.job)}
          width="w-48"
        />
        <div>
          <span className="mb-1.5 block text-[7px] tracking-[0.13em] text-[#737883] uppercase">Craft XP</span>
          <strong className="block h-8 border border-[#65c993]/25 bg-[#65c993]/6 px-3 py-2 text-[9px] font-normal tabular-nums text-[#82dba8]">
            {craft_xp_from_ingredient_count(rows.length)}
          </strong>
        </div>
      </section>
      <SheetSection
        accent="#65c993"
        note="Craft XP derives only from the number of distinct ingredient slots."
        title={`Ingredients · ${rows.length}`}
      >
        <div className="space-y-1">
          {rows.map(([item_type, amount], index) => (
            <div
              className="grid min-h-12 grid-cols-[36px_minmax(180px,1fr)_80px_auto] items-center gap-2 border-b border-white/6 px-1"
              key={`${item_type}-${index}`}
            >
              <ItemThumb item_type={item_type} />
              <input
                aria-label="Ingredient"
                className="h-8 min-w-0 border border-white/10 bg-[#090a10] px-2 text-[9px]"
                onChange={(event) => replace_input(index, event.target.value, typeof amount === 'number' ? amount : 0)}
                value={item_type}
              />
              <label className="flex items-center gap-2">
                <span className="text-[8px] text-[#777b86]">×</span>
                <input
                  aria-label="Quantity"
                  className="h-8 w-16 border border-white/10 bg-[#090a10] px-2 text-right text-[9px]"
                  onChange={(event) => replace_input(index, item_type, Number(event.target.value))}
                  type="number"
                  value={typeof amount === 'number' ? amount : 0}
                />
              </label>
              <button
                className={button_class}
                onClick={() =>
                  on_change(['inputs'], Object.freeze(Object.fromEntries(rows.filter((_, row) => row !== index))))
                }
                type="button"
              >
                Remove
              </button>
            </div>
          ))}
          <button
            className={button_class}
            onClick={() => on_change(['inputs'], Object.freeze({ ...inputs, '': 1 }))}
            type="button"
          >
            + Ingredient
          </button>
        </div>
      </SheetSection>
    </div>
  )
}

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

export const ContentEntityEditor = ({ domain, value, on_change, is_readonly, save }: Props) => {
  if (domain === 'items') return <ItemContentEditor is_readonly={is_readonly} on_change={on_change} value={value} />
  if (domain === 'mobs') return <MobContentEditor on_change={on_change} save={save} value={value} />
  if (domain === 'recipes') return <RecipeEditor on_change={on_change} value={value} />
  if (domain === 'shop') return <ShopEditor on_change={on_change} value={value} />
  if (domain === 'airdrop') return <AirdropEditor is_readonly={is_readonly} on_change={on_change} value={value} />
  return <JsonEditor is_readonly={is_readonly} on_change={on_change} value={value} />
}
