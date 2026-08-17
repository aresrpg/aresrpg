// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { consumable_types, is_weapon_category } from '@aresrpg/immutable'

import { ItemDetailView } from '../components/ItemDetailView.tsx'
import { item_icon } from '../content/assets.ts'

import { as_record, button_class, NumberField, SelectField, SheetSection, string_value } from './ContentFields.tsx'
import { ItemPowerPanel } from './ItemPowerPanel.tsx'
import { ItemRecipeEditor, type ItemRecipeBinding } from './ItemRecipeEditor.tsx'
import { ItemReferencePicker } from './ItemReferencePicker.tsx'
import { JsonEditor } from './JsonEditor.tsx'
import type { JsonPath, JsonValue } from './seed_editor.ts'

type EditorProps = Readonly<{
  value: JsonValue
  on_change: (path: JsonPath, value: JsonValue) => void
  is_readonly: (path: JsonPath) => boolean
  item_recipe?: ItemRecipeBinding
  save?: () => void
}>

export type { ItemRecipeBinding } from './ItemRecipeEditor.tsx'

const known_keys = new Set(['item_type', 'name', 'category', 'level', 'pet_foods', 'stats', 'damages', 'consumable'])
const resource_categories = new Set(['resource'])

const numeric_record = (value: JsonValue | undefined): Readonly<Record<string, number>> | null => {
  const record = as_record(value)
  return record
    ? Object.freeze(
        Object.fromEntries(
          Object.entries(record).flatMap(([key, amount]) => (typeof amount === 'number' ? [[key, amount]] : []))
        )
      )
    : null
}

const detail_stats = (item: Readonly<Record<string, JsonValue>>) => {
  const stats = as_record(item.stats)
  const min = numeric_record(stats?.min)
  const max = numeric_record(stats?.max)
  return min && max ? Object.freeze({ min, max }) : undefined
}

const detail_damages = (item: Readonly<Record<string, JsonValue>>) =>
  Object.freeze(
    (Array.isArray(item.damages) ? item.damages : []).flatMap((value) => {
      const damage = as_record(value)
      return damage && typeof damage.from === 'number' && typeof damage.to === 'number'
        ? [
            Object.freeze({
              from: damage.from,
              to: damage.to,
              element: string_value(damage.element),
              damage_type: string_value(damage.damage_type),
            }),
          ]
        : []
    })
  )

const PetFoodsEditor = ({
  item,
  on_change,
}: Readonly<{ item: Readonly<Record<string, JsonValue>>; on_change: EditorProps['on_change'] }>) => {
  const foods = Array.isArray(item.pet_foods)
    ? item.pet_foods.filter((value): value is string => typeof value === 'string')
    : []
  return (
    <SheetSection accent="#65c993" note="Only these authored resources can feed this pet." title="Diet">
      <div className="grid gap-2 sm:grid-cols-2">
        {foods.map((food_type, index) => (
          <div className="flex min-w-0 items-center gap-2" key={`${food_type}-${index}`}>
            <ItemReferencePicker
              categories={resource_categories}
              class_name="min-w-0 flex-1"
              excluded={new Set(foods.filter((_, row) => row !== index))}
              label="pet food"
              select={(next) => on_change(['pet_foods', index], next)}
              value={food_type}
            />
            <button
              className={button_class}
              onClick={() =>
                on_change(
                  ['pet_foods'],
                  foods.filter((_, row) => row !== index)
                )
              }
              type="button"
            >
              Remove
            </button>
          </div>
        ))}
        <ItemReferencePicker
          categories={resource_categories}
          excluded={new Set(foods)}
          label="add pet food"
          select={(food_type) => on_change(['pet_foods'], [...foods, food_type])}
          value=""
        />
      </div>
    </SheetSection>
  )
}

const ConsumableEditor = ({
  item,
  on_change,
}: Readonly<{ item: Readonly<Record<string, JsonValue>>; on_change: EditorProps['on_change'] }>) => {
  const consumable = as_record(item.consumable)
  if (!consumable) return null
  const type = string_value(consumable.type)
  const rewards = Array.isArray(consumable.rewards) ? consumable.rewards : []
  return (
    <SheetSection accent="#65c993" note="The effect applied when this item is consumed." title="Consumable">
      <div className="flex flex-wrap items-end gap-3">
        <SelectField
          change={(next) =>
            on_change(
              ['consumable'],
              next === 'heal'
                ? { type: next, amount: 1 }
                : next === 'loot_box'
                  ? { type: next, rewards: [] }
                  : { type: next }
            )
          }
          label="Effect"
          options={consumable_types}
          value={type}
        />
        {type === 'heal' && (
          <NumberField
            change={(next) => on_change(['consumable', 'amount'], next)}
            label="Healing"
            value={typeof consumable.amount === 'number' ? consumable.amount : 0}
          />
        )}
      </div>
      {type === 'loot_box' && (
        <div className="mt-3 space-y-1">
          {rewards.map((value, index) => {
            const reward = as_record(value)
            if (!reward) return null
            const item_type = string_value(reward.item_type)
            return (
              <div
                className="grid min-h-11 grid-cols-[30px_minmax(150px,1fr)_78px_78px_auto] items-center gap-2 border-b border-white/6"
                key={`${item_type}-${index}`}
              >
                <span className="grid size-7 place-items-center">
                  {item_icon(item_type) && <img alt="" className="size-7 object-contain" src={item_icon(item_type)!} />}
                </span>
                <input
                  aria-label="Reward item"
                  className="h-7 min-w-0 border border-white/10 bg-[#090a10] px-2 text-[9px]"
                  onChange={(event) => on_change(['consumable', 'rewards', index, 'item_type'], event.target.value)}
                  value={item_type}
                />
                <label className="flex items-center gap-1 text-[8px] text-[#777b86]">
                  Weight
                  <input
                    aria-label="Reward weight"
                    className="h-7 w-12 border border-white/10 bg-[#090a10] px-1 text-right text-[9px]"
                    onChange={(event) =>
                      on_change(['consumable', 'rewards', index, 'weight'], Number(event.target.value))
                    }
                    type="number"
                    value={typeof reward.weight === 'number' ? reward.weight : 0}
                  />
                </label>
                <label className="flex items-center gap-1 text-[8px] text-[#777b86]">
                  ×
                  <input
                    aria-label="Reward amount"
                    className="h-7 w-14 border border-white/10 bg-[#090a10] px-1 text-right text-[9px]"
                    onChange={(event) =>
                      on_change(['consumable', 'rewards', index, 'amount'], Number(event.target.value))
                    }
                    type="number"
                    value={typeof reward.amount === 'number' ? reward.amount : 0}
                  />
                </label>
                <button
                  className={button_class}
                  onClick={() =>
                    on_change(
                      ['consumable', 'rewards'],
                      rewards.filter((_, row) => row !== index)
                    )
                  }
                  type="button"
                >
                  Remove
                </button>
              </div>
            )
          })}
          <button
            className={button_class}
            onClick={() => on_change(['consumable', 'rewards'], [...rewards, { item_type: '', weight: 1, amount: 1 }])}
            type="button"
          >
            + Reward
          </button>
        </div>
      )}
    </SheetSection>
  )
}

export const ItemContentEditor = ({ value, on_change, is_readonly, item_recipe, save }: EditorProps) => {
  const item = as_record(value)
  if (!item) return null
  const category = string_value(item.category)
  const level = typeof item.level === 'number' ? item.level : 0
  const edit_item = (path: JsonPath, next: JsonValue): void => {
    on_change(path, next)
    if (path.length !== 1 || path[0] !== 'category' || typeof next !== 'string' || !item_recipe?.value) return
    item_recipe.category_changed(next)
  }
  const unknown = Object.freeze(Object.fromEntries(Object.entries(item).filter(([key]) => !known_keys.has(key))))
  return (
    <div className="mx-auto max-w-4xl space-y-5 pt-3" data-content-editor="item">
      <ItemDetailView
        allow_damage_add={is_weapon_category(category)}
        category={category}
        damages={detail_damages(item)}
        edit={{ change: edit_item, save: save ?? (() => undefined) }}
        icon={item_icon(string_value(item.item_type))}
        labels={{ characteristics: 'Characteristics', damages: 'damages', level_short: `Lv. ${level}`, range_to: 'to' }}
        level={level}
        name={string_value(item.name)}
        stat_budget={<ItemPowerPanel value={value} />}
        stats={detail_stats(item)}
      />
      {category === 'pet' && <PetFoodsEditor item={item} on_change={on_change} />}
      <ConsumableEditor item={item} on_change={on_change} />
      {item_recipe && <ItemRecipeEditor category={category} recipe={item_recipe} />}
      {Object.keys(unknown).length > 0 && (
        <SheetSection title="Additional authored fields">
          <JsonEditor is_readonly={is_readonly} on_change={on_change} value={unknown} />
        </SheetSection>
      )}
    </div>
  )
}
