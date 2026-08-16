// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { element_names, item_stat_center } from '@aresrpg/immutable'
import { useState } from 'react'

import { item_icon } from '../content/assets.ts'
import type { SeedSpell } from '../content/catalog.ts'
import { SpellCard } from '../encyclopedia/SpellCard.tsx'
import { element_colors, stat_identities } from '../visual_identity.ts'

import {
  as_record,
  button_class,
  NumberField,
  number_value,
  SelectField,
  SheetSection,
  string_value,
  TextField,
  titleize_field,
} from './ContentFields.tsx'
import { JsonEditor } from './JsonEditor.tsx'
import type { JsonPath, JsonValue } from './seed_editor.ts'

type EditorProps = Readonly<{
  value: JsonValue
  on_change: (path: JsonPath, value: JsonValue) => void
  save?: () => void
}>

const known_keys = new Set([
  'mob_type',
  'name',
  'element',
  'role',
  'level_min',
  'level_max',
  'hp',
  'ap',
  'mp',
  'agility',
  'wisdom',
  'resistances',
  'spells',
  'loot',
  'xp',
])

const blank_level = Object.freeze({
  ap_cost: 1,
  range_min: 0,
  range_max: 1,
  modifiable_range: false,
  line_of_sight: true,
  line_launch: false,
  free_cell: false,
  casts_per_turn: 0,
  casts_per_target: 0,
  cooldown_turns: 0,
  crit_1_in: 0,
  effects: Object.freeze([]),
  crit_effects: Object.freeze([]),
})

const CoreStats = ({
  mob,
  on_change,
}: Readonly<{ mob: Readonly<Record<string, JsonValue>>; on_change: EditorProps['on_change'] }>) => (
  <div className="grid grid-cols-3 gap-x-4 gap-y-3 sm:grid-cols-6">
    {[
      ['hp', 'HP'],
      ['ap', 'AP'],
      ['mp', 'MP'],
      ['agility', 'Agility'],
      ['wisdom', 'Wisdom'],
      ['xp', 'XP reward'],
    ].map(([key, label]) => (
      <NumberField
        change={(next) => on_change([key!], next)}
        key={key}
        label={label!}
        value={number_value(mob[key!])}
        width="w-full"
      />
    ))}
  </div>
)

const Resistances = ({
  mob,
  on_change,
}: Readonly<{ mob: Readonly<Record<string, JsonValue>>; on_change: EditorProps['on_change'] }>) => {
  const resistances = as_record(mob.resistances)
  if (!resistances) return null
  return (
    <div className="grid gap-2 sm:grid-cols-2" data-mob-resistances="">
      {Object.entries(resistances).map(([element, raw]) => {
        const identity =
          stat_identities[
            element === 'earth'
              ? 'strength'
              : element === 'fire'
                ? 'intelligence'
                : element === 'water'
                  ? 'chance'
                  : 'agility'
          ]
        const value = typeof raw === 'number' ? raw - item_stat_center : 0
        return (
          <label className="flex h-11 items-center gap-3 border-b border-white/6 px-2" key={element}>
            {identity && <img alt="" className="size-6 object-contain" src={identity.icon} />}
            <span className="min-w-0 flex-1 text-[9px]" style={{ color: element_colors[element] ?? '#aaa' }}>
              {titleize_field(element)}
            </span>
            <input
              className="h-7 w-20 border border-white/10 bg-[#090a10] px-2 text-right text-[10px] tabular-nums"
              onChange={(event) => on_change(['resistances', element], Number(event.target.value) + item_stat_center)}
              type="number"
              value={value}
            />
            <span className="text-[9px] text-[#777b86]">%</span>
          </label>
        )
      })}
    </div>
  )
}

const MobSpells = ({
  mob,
  on_change,
  save,
}: Readonly<{ mob: Readonly<Record<string, JsonValue>>; on_change: EditorProps['on_change']; save?: () => void }>) => {
  const spells = Array.isArray(mob.spells) ? mob.spells : []
  const [selected_index, set_selected_index] = useState(0)
  const safe_index = Math.min(selected_index, Math.max(0, spells.length - 1))
  const selected = as_record(spells[safe_index])
  return (
    <SheetSection accent="#c8963c" note="Mob spells use the same editable detail card as class spells." title="Spells">
      <div className="grid min-h-0 grid-cols-[150px_minmax(0,1fr)] border border-white/8">
        <nav className="border-r border-white/8 bg-black/15 py-1">
          {spells.map((value, index) => {
            const spell = as_record(value)
            return (
              <button
                className={`block w-full border-l-2 px-3 py-2 text-left text-[8px] uppercase ${index === safe_index ? 'border-[#c8963c] bg-[#c8963c]/8 text-[#e0b86b]' : 'border-transparent text-[#777b86]'}`}
                key={`${string_value(spell?.name)}-${index}`}
                onClick={() => set_selected_index(index)}
                type="button"
              >
                {string_value(spell?.name) || `Spell ${index + 1}`}
              </button>
            )
          })}
          <button
            className={`${button_class} m-2`}
            onClick={() => {
              on_change(['spells'], [...spells, { name: 'New spell', levels: [blank_level] }])
              set_selected_index(spells.length)
            }}
            type="button"
          >
            + Spell
          </button>
        </nav>
        <div className="min-w-0 p-4">
          {selected && (
            <>
              <SpellCard
                edit={{
                  change: (path, next) => on_change(['spells', safe_index, ...path], next),
                  save: save ?? (() => undefined),
                }}
                key={`${safe_index}-${string_value(selected.name)}`}
                spell={
                  {
                    classe: string_value(mob.mob_type),
                    levels: selected.levels,
                    name: string_value(selected.name),
                    unlock_level: 1,
                  } as unknown as SeedSpell
                }
              />
              <button
                className={`${button_class} mt-3`}
                onClick={() => {
                  on_change(
                    ['spells'],
                    spells.filter((_, index) => index !== safe_index)
                  )
                  set_selected_index(Math.max(0, safe_index - 1))
                }}
                type="button"
              >
                Remove spell
              </button>
            </>
          )}
        </div>
      </div>
    </SheetSection>
  )
}

const LootEditor = ({
  mob,
  on_change,
}: Readonly<{ mob: Readonly<Record<string, JsonValue>>; on_change: EditorProps['on_change'] }>) => {
  const loot = Array.isArray(mob.loot) ? mob.loot : []
  return (
    <SheetSection
      accent="#65c993"
      note="Chance is displayed as a percentage; the JSON remains basis points."
      title="Loot"
    >
      <div className="space-y-1" data-mob-loot="">
        {loot.map((value, index) => {
          const row = as_record(value)
          if (!row) return null
          const item_type = string_value(row.item_type)
          return (
            <div
              className="grid min-h-12 grid-cols-[32px_minmax(140px,1fr)_80px_60px_auto_60px_auto] items-center gap-2 border-b border-white/6 px-1"
              key={`${item_type}-${index}`}
            >
              <span className="grid size-8 place-items-center border border-white/8 bg-black/25">
                {item_icon(item_type) && <img alt="" className="size-7 object-contain" src={item_icon(item_type)!} />}
              </span>
              <input
                aria-label="Loot item"
                className="h-7 min-w-0 border border-white/10 bg-[#090a10] px-2 text-[9px]"
                onChange={(event) => on_change(['loot', index, 'item_type'], event.target.value)}
                value={item_type}
              />
              <label className="flex items-center gap-1">
                <input
                  aria-label="Drop chance"
                  className="h-7 w-16 border border-white/10 bg-[#090a10] px-2 text-right text-[9px]"
                  onChange={(event) =>
                    on_change(['loot', index, 'chance_bp'], Math.round(Number(event.target.value) * 100))
                  }
                  step="0.01"
                  type="number"
                  value={typeof row.chance_bp === 'number' ? row.chance_bp / 100 : 0}
                />
                <span className="text-[8px] text-[#777b86]">%</span>
              </label>
              <input
                aria-label="Minimum quantity"
                className="h-7 w-full border border-white/10 bg-[#090a10] px-2 text-right text-[9px]"
                onChange={(event) => on_change(['loot', index, 'min_qty'], Number(event.target.value))}
                type="number"
                value={typeof row.min_qty === 'number' ? row.min_qty : 0}
              />
              <span className="text-[7px] text-[#555b66] uppercase">to</span>
              <input
                aria-label="Maximum quantity"
                className="h-7 w-full border border-white/10 bg-[#090a10] px-2 text-right text-[9px]"
                onChange={(event) => on_change(['loot', index, 'max_qty'], Number(event.target.value))}
                type="number"
                value={typeof row.max_qty === 'number' ? row.max_qty : 0}
              />
              <button
                className={button_class}
                onClick={() =>
                  on_change(
                    ['loot'],
                    loot.filter((_, row_index) => row_index !== index)
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
          onClick={() => on_change(['loot'], [...loot, { item_type: '', chance_bp: 10000, min_qty: 1, max_qty: 1 }])}
          type="button"
        >
          + Loot
        </button>
      </div>
    </SheetSection>
  )
}

export const MobContentEditor = ({ value, on_change, save }: EditorProps) => {
  const mob = as_record(value)
  if (!mob) return null
  const element = string_value(mob.element)
  const unknown = Object.freeze(Object.fromEntries(Object.entries(mob).filter(([key]) => !known_keys.has(key))))
  return (
    <div className="mx-auto max-w-5xl space-y-5" data-content-editor="mob">
      <section className="flex flex-wrap items-end gap-3 border-b border-white/9 pb-4">
        <TextField
          change={(next) => on_change(['name'], next)}
          label="Name"
          value={string_value(mob.name)}
          width="w-64 max-w-full"
        />
        <TextField
          change={(next) => on_change(['mob_type'], next)}
          label="Mob type"
          value={string_value(mob.mob_type)}
          width="w-52"
        />
        <SelectField
          change={(next) => on_change(['element'], next)}
          label="Element"
          options={element_names}
          value={element}
        />
        <TextField
          change={(next) => on_change(['role'], next)}
          label="Role"
          value={string_value(mob.role)}
          width="w-32"
        />
      </section>
      <SheetSection
        accent={element_colors[element] ?? '#e86a73'}
        note="Level range and rewards frame the authored combat profile."
        title="Combat profile"
      >
        <div className="mb-4 flex items-end gap-2">
          <NumberField
            change={(next) => on_change(['level_min'], next)}
            label="Level range"
            value={typeof mob.level_min === 'number' ? mob.level_min : 0}
          />
          <span className="mb-2 text-[8px] text-[#555b66] uppercase">to</span>
          <NumberField
            change={(next) => on_change(['level_max'], next)}
            label="Maximum"
            value={typeof mob.level_max === 'number' ? mob.level_max : 0}
          />
        </div>
        <CoreStats mob={mob} on_change={on_change} />
      </SheetSection>
      <SheetSection
        accent="#78b5ff"
        note="Displayed values are real percentages; storage keeps the centered integer representation."
        title="Resistances"
      >
        <Resistances mob={mob} on_change={on_change} />
      </SheetSection>
      <MobSpells mob={mob} on_change={on_change} save={save} />
      <LootEditor mob={mob} on_change={on_change} />
      {Object.keys(unknown).length > 0 && (
        <SheetSection title="Additional authored fields">
          <JsonEditor on_change={on_change} value={unknown} />
        </SheetSection>
      )}
    </div>
  )
}
