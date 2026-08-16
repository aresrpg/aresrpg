// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { consumable_types, element_names, item_categories } from '@aresrpg/immutable'

import { item_icon } from '../content/assets.ts'
import { stat_colors, stat_identities } from '../visual_identity.ts'

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
import { ItemPowerPanel } from './ItemPowerPanel.tsx'
import { item_stat_weight } from './item_power.ts'
import { JsonEditor } from './JsonEditor.tsx'
import type { JsonPath, JsonValue } from './seed_editor.ts'

type EditorProps = Readonly<{
  value: JsonValue
  on_change: (path: JsonPath, value: JsonValue) => void
  is_readonly: (path: JsonPath) => boolean
}>

const known_keys = new Set(['item_type', 'name', 'category', 'level', 'stats', 'damages', 'consumable'])

const StatsEditor = ({
  item,
  on_change,
}: Readonly<{ item: Readonly<Record<string, JsonValue>>; on_change: EditorProps['on_change'] }>) => {
  const stats = as_record(item.stats)
  const minimum = as_record(stats?.min)
  const maximum = as_record(stats?.max)
  if (!minimum || !maximum) return null
  const names = [...new Set([...Object.keys(minimum), ...Object.keys(maximum)])]
  return (
    <div className="grid gap-x-5 gap-y-1 sm:grid-cols-2" data-item-stats="">
      {names.map((stat) => {
        const identity = stat_identities[stat]
        const color = stat_colors[stat] ?? '#c8963c'
        const min = typeof minimum[stat] === 'number' ? minimum[stat] : 0
        const max = typeof maximum[stat] === 'number' ? maximum[stat] : 0
        return (
          <div
            className="grid min-h-11 grid-cols-[24px_minmax(100px,1fr)_62px_auto_62px_auto] items-center gap-2 border-b border-white/6 px-1"
            key={stat}
          >
            <span className="grid size-6 place-items-center" style={{ color }}>
              {identity ? (
                <img alt="" className="size-5 object-contain" src={identity.icon} />
              ) : (
                <span className="size-2" style={{ background: color }} />
              )}
            </span>
            <span className="truncate text-[9px] text-[#b7b3ac]">{titleize_field(stat)}</span>
            <input
              aria-label={`${stat} from`}
              className="h-7 w-full border border-white/10 bg-[#090a10] px-2 text-right text-[10px] tabular-nums outline-none focus:border-[#4a9eff]/60"
              onChange={(event) => on_change(['stats', 'min', stat], Number(event.target.value))}
              type="number"
              value={min}
            />
            <span className="text-[7px] text-[#555b66] uppercase">to</span>
            <input
              aria-label={`${stat} to`}
              className="h-7 w-full border border-white/10 bg-[#090a10] px-2 text-right text-[10px] tabular-nums outline-none focus:border-[#4a9eff]/60"
              onChange={(event) => on_change(['stats', 'max', stat], Number(event.target.value))}
              type="number"
              value={max}
            />
            <span className="text-[7px] tabular-nums text-[#656a74]">{item_stat_weight(stat, max)} UPU</span>
          </div>
        )
      })}
    </div>
  )
}

const DamageEditor = ({
  item,
  on_change,
}: Readonly<{ item: Readonly<Record<string, JsonValue>>; on_change: EditorProps['on_change'] }>) => {
  const damages = Array.isArray(item.damages) ? item.damages : []
  return (
    <div className="space-y-1" data-item-damages="">
      {damages.map((value, index) => {
        const damage = as_record(value)
        if (!damage) return null
        const element = string_value(damage.element)
        return (
          <div className="flex min-h-11 flex-wrap items-center gap-2 border-b border-white/6 px-2" key={index}>
            <span
              className="size-2.5"
              style={{
                background:
                  stat_colors[
                    element === 'earth'
                      ? 'strength'
                      : element === 'fire'
                        ? 'intelligence'
                        : element === 'water'
                          ? 'chance'
                          : 'agility'
                  ] ?? '#aaa',
              }}
            />
            <span className="w-16 text-[8px] text-[#777b86] uppercase">Damage</span>
            <input
              className="h-7 w-16 border border-white/10 bg-[#090a10] px-2 text-right text-[10px]"
              onChange={(event) => on_change(['damages', index, 'from'], Number(event.target.value))}
              type="number"
              value={typeof damage.from === 'number' ? damage.from : 0}
            />
            <span className="text-[7px] text-[#555b66] uppercase">to</span>
            <input
              className="h-7 w-16 border border-white/10 bg-[#090a10] px-2 text-right text-[10px]"
              onChange={(event) => on_change(['damages', index, 'to'], Number(event.target.value))}
              type="number"
              value={typeof damage.to === 'number' ? damage.to : 0}
            />
            <select
              className="h-7 w-28 border border-white/10 bg-[#090a10] px-2 text-[9px]"
              onChange={(event) => on_change(['damages', index, 'element'], event.target.value)}
              value={element}
            >
              {element_names.map((name) => (
                <option key={name} value={name}>
                  {titleize_field(name)}
                </option>
              ))}
            </select>
            <span className="text-[8px] text-[#777b86]">weapon</span>
            <button
              className={`${button_class} ml-auto`}
              onClick={() =>
                on_change(
                  ['damages'],
                  damages.filter((_, row) => row !== index)
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
        onClick={() =>
          on_change(['damages'], [...damages, { from: 1, to: 1, damage_type: 'weapon', element: 'earth' }])
        }
        type="button"
      >
        + Damage line
      </button>
    </div>
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

export const ItemContentEditor = ({ value, on_change, is_readonly }: EditorProps) => {
  const item = as_record(value)
  if (!item) return null
  const category = string_value(item.category)
  const unknown = Object.freeze(Object.fromEntries(Object.entries(item).filter(([key]) => !known_keys.has(key))))
  return (
    <div className="mx-auto max-w-4xl space-y-5" data-content-editor="item">
      <section className="flex flex-wrap items-end gap-3 border-b border-white/9 pb-4">
        <TextField
          change={(next) => on_change(['name'], next)}
          label="Name"
          value={string_value(item.name)}
          width="w-64 max-w-full"
        />
        <SelectField
          change={(next) => on_change(['category'], next)}
          label="Category"
          options={item_categories}
          value={category}
        />
        <NumberField
          change={(next) => on_change(['level'], next)}
          label="Level"
          value={typeof item.level === 'number' ? item.level : 0}
        />
        <TextField
          change={(next) => on_change(['item_type'], next)}
          disabled={is_readonly(['item_type'])}
          hint="locked identity"
          label="Item type"
          value={string_value(item.item_type)}
          width="w-52"
        />
      </section>
      <ItemPowerPanel value={value} />
      {item.stats && (
        <SheetSection accent="#b584e8" note="Maximum rolls feed the Dofus power budget." title="Characteristics">
          <StatsEditor item={item} on_change={on_change} />
        </SheetSection>
      )}
      {item.damages && (
        <SheetSection accent="#e86a73" note="Each weapon damage line contributes to item power." title="Weapon damage">
          <DamageEditor item={item} on_change={on_change} />
        </SheetSection>
      )}
      <ConsumableEditor item={item} on_change={on_change} />
      {Object.keys(unknown).length > 0 && (
        <SheetSection title="Additional authored fields">
          <JsonEditor is_readonly={is_readonly} on_change={on_change} value={unknown} />
        </SheetSection>
      )}
    </div>
  )
}
