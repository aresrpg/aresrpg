// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { element_names, item_stat_center } from '@aresrpg/immutable'
import { useState } from 'react'

import { InlineField } from '../components/ItemDetailView.tsx'
import { MobCoreStats } from '../components/MobCoreStats.tsx'
import { mob_icon } from '../content/assets.ts'
import type { SeedSpell } from '../content/catalog.ts'
import { SpellCard } from '../encyclopedia/SpellCard.tsx'
import { element_colors, stat_identities } from '../visual_identity.ts'

import { as_record, button_class, SheetSection, string_value, titleize_field } from './ContentFields.tsx'
import { JsonEditor } from './JsonEditor.tsx'
import { ItemReferencePicker } from './ItemReferencePicker.tsx'
import { MobPowerPanel } from './MobPowerPanel.tsx'
import { mob_loot_chance_range, mob_power_summary, type MobPowerSummary } from './mob_power.ts'
import type { JsonPath, JsonValue } from './seed_editor.ts'

type EditorProps = Readonly<{
  value: JsonValue
  on_change: (path: JsonPath, value: JsonValue) => void
  save?: () => void
  mob_templates?: readonly JsonValue[]
}>

const known_keys = new Set([
  'mob_type',
  'name',
  'element',
  'role',
  'family',
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

const detail_input_class =
  'h-8 border border-white/12 bg-bg px-2 text-[10px] text-[#e8e4dc] outline-none focus:border-[#c8963c]/60'

const StatRange = ({ label, value }: Readonly<{ label: string; value: number }>) => (
  <div className="border border-white/8 bg-black/15 px-3 py-2 text-center">
    <p className="text-[7px] tracking-[0.12em] text-[#777b86] uppercase">{label}</p>
    <p className="mt-1 text-[12px] font-semibold tabular-nums text-[#e8b44f]">{value.toLocaleString('en-US')}</p>
  </div>
)

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

type MobSpellClone = Readonly<{
  name: string
  source_type: string
  spell: JsonValue
}>

const spell_has_effect = (spell: Readonly<Record<string, JsonValue>>): boolean => {
  const levels = Array.isArray(spell.levels) ? spell.levels : []
  const level = as_record(levels[0])
  return (
    levels.length === 1 &&
    !!level &&
    ((Array.isArray(level.effects) && level.effects.length > 0) ||
      (Array.isArray(level.crit_effects) && level.crit_effects.length > 0))
  )
}

export const same_family_spell_clones = (
  value: JsonValue,
  mob_templates: readonly JsonValue[]
): readonly MobSpellClone[] => {
  const mob = as_record(value)
  const family = string_value(mob?.family)
  const mob_type = string_value(mob?.mob_type)
  if (!mob || !family) return Object.freeze([])
  const current_names = new Set(
    (Array.isArray(mob.spells) ? mob.spells : []).flatMap((spell) => {
      const row = as_record(spell)
      const name = string_value(row?.name)
      return name ? [name] : []
    })
  )
  const candidates = new Map<string, MobSpellClone>()
  for (const template_value of mob_templates) {
    const template = as_record(template_value)
    if (
      !template ||
      string_value(template.family) !== family ||
      string_value(template.mob_type) === mob_type ||
      !Array.isArray(template.spells)
    )
      continue
    for (const spell_value of template.spells) {
      const spell = as_record(spell_value)
      const name = string_value(spell?.name)
      if (!spell || !name || current_names.has(name) || candidates.has(name) || !spell_has_effect(spell)) continue
      candidates.set(name, Object.freeze({ name, source_type: string_value(template.mob_type), spell: spell_value }))
    }
  }
  return Object.freeze([...candidates.values()])
}

export const clone_mob_spell = (spell: JsonValue): JsonValue => structuredClone(spell)

const Resistances = ({
  mob,
  on_change,
  ranges,
}: Readonly<{
  mob: Readonly<Record<string, JsonValue>>
  on_change: EditorProps['on_change']
  ranges?: Readonly<{
    minimum: MobPowerSummary['minimum']['resistances']
    maximum: MobPowerSummary['maximum']['resistances']
  }>
}>) => {
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
              className="h-7 w-20 border border-white/10 bg-bg px-2 text-right text-[10px] tabular-nums"
              onChange={(event) => on_change(['resistances', element], Number(event.target.value) + item_stat_center)}
              type="number"
              value={value}
            />
            <span className="text-[9px] text-[#777b86]">%</span>
            {ranges && element in ranges.minimum && (
              <span
                className="whitespace-nowrap text-[7px] tabular-nums text-[#666b75]"
                data-mob-resistance-range={element}
              >
                min {ranges.minimum[element as keyof typeof ranges.minimum]}% · max{' '}
                {ranges.maximum[element as keyof typeof ranges.maximum]}%
              </span>
            )}
          </label>
        )
      })}
    </div>
  )
}

const MobSpells = ({
  mob,
  mob_templates,
  on_change,
}: Readonly<{
  mob: Readonly<Record<string, JsonValue>>
  mob_templates: readonly JsonValue[]
  on_change: EditorProps['on_change']
}>) => {
  const spells = Array.isArray(mob.spells) ? mob.spells : []
  const clone_candidates = same_family_spell_clones(mob, mob_templates)
  const [selected_index, set_selected_index] = useState(0)
  const safe_index = Math.min(selected_index, Math.max(0, spells.length - 1))
  const selected = as_record(spells[safe_index])
  return (
    <SheetSection accent="#c8963c" note="Mob spells use the same editable detail card as class spells." title="Spells">
      <div className="grid min-h-0 grid-cols-[190px_minmax(0,1fr)] border border-white/8">
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
          <div className="flex flex-wrap gap-1 p-2">
            <button
              className={button_class}
              disabled={spells.length >= 5}
              onClick={() => {
                if (spells.length >= 5) return
                on_change(['spells'], [...spells, { name: 'New spell', levels: [blank_level] }])
                set_selected_index(spells.length)
              }}
              type="button"
            >
              + Spell
            </button>
            {clone_candidates.map((candidate) => (
              <button
                aria-label={`Clone ${candidate.name}`}
                className={button_class}
                data-mob-spell-clone={candidate.source_type}
                disabled={spells.length >= 5}
                key={`${candidate.source_type}:${candidate.name}`}
                onClick={() => {
                  if (spells.length >= 5) return
                  on_change(['spells'], [...spells, clone_mob_spell(candidate.spell)])
                  set_selected_index(spells.length)
                }}
                title={`Clone from ${candidate.source_type}`}
                type="button"
              >
                Clone {candidate.name}
              </button>
            ))}
          </div>
        </nav>
        <div className="min-w-0 p-4">
          {selected && (
            <>
              <SpellCard
                edit={{
                  change: (path, next) => on_change(['spells', safe_index, ...path], next),
                  save: () => undefined,
                }}
                key={safe_index}
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
  const level_min = typeof mob.level_min === 'number' ? mob.level_min : 0
  const level_max = typeof mob.level_max === 'number' ? mob.level_max : level_min
  const chance_percent = (basis_points: number): string =>
    (basis_points / 100).toLocaleString('en-US', { maximumFractionDigits: 2 })
  return (
    <SheetSection
      accent="#65c993"
      note="Authored chance is the band midpoint. The displayed endpoints resolve before the winning team's Chance bonus."
      title="Loot"
    >
      <div className="space-y-1" data-mob-loot="">
        {loot.map((value, index) => {
          const row = as_record(value)
          if (!row) return null
          const item_type = string_value(row.item_type)
          const chance_bp = typeof row.chance_bp === 'number' ? row.chance_bp : 0
          const chance_range = mob_loot_chance_range(chance_bp, level_min, level_max)
          return (
            <div
              className="grid min-h-14 grid-cols-[minmax(210px,1fr)_170px_60px_auto_60px_auto] items-center gap-2 border-b border-white/6 px-1"
              key={`${item_type}-${index}`}
            >
              <ItemReferencePicker
                label="loot item"
                select={(next) => on_change(['loot', index, 'item_type'], next)}
                value={item_type}
              />
              <label className="flex min-w-0 flex-col gap-1">
                <span className="flex items-center gap-1">
                  <input
                    aria-label="Drop chance"
                    className="h-7 w-16 border border-white/10 bg-bg px-2 text-right text-[9px]"
                    onChange={(event) =>
                      on_change(['loot', index, 'chance_bp'], Math.round(Number(event.target.value) * 100))
                    }
                    step="0.01"
                    type="number"
                    value={chance_bp / 100}
                  />
                  <span className="text-[8px] text-[#777b86]">%</span>
                </span>
                <span
                  className="whitespace-nowrap text-[7px] tabular-nums text-[#666b75]"
                  data-mob-loot-chance-range=""
                >
                  min {chance_percent(chance_range.minimum)}% · max {chance_percent(chance_range.maximum)}%
                </span>
                <span className="text-[6px] tracking-[0.08em] text-[#555b66] uppercase">before team Chance</span>
              </label>
              <input
                aria-label="Minimum quantity"
                className="h-7 w-full border border-white/10 bg-bg px-2 text-right text-[9px]"
                onChange={(event) => on_change(['loot', index, 'min_qty'], Number(event.target.value))}
                type="number"
                value={typeof row.min_qty === 'number' ? row.min_qty : 0}
              />
              <span className="text-[7px] text-[#555b66] uppercase">to</span>
              <input
                aria-label="Maximum quantity"
                className="h-7 w-full border border-white/10 bg-bg px-2 text-right text-[9px]"
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

export const MobContentEditor = ({ value, on_change, save, mob_templates = Object.freeze([]) }: EditorProps) => {
  const mob = as_record(value)
  if (!mob) return null
  const mob_type = string_value(mob.mob_type)
  const element = string_value(mob.element)
  const role = string_value(mob.role)
  const family = string_value(mob.family)
  const icon = mob_icon(mob_type)
  const level_min = typeof mob.level_min === 'number' ? mob.level_min : 0
  const level_max = typeof mob.level_max === 'number' ? mob.level_max : 0
  const median_level = Math.floor((level_min + level_max) / 2)
  const power = mob_power_summary(value)
  const edit = Object.freeze({
    change: on_change,
    save: save ?? (() => undefined),
  })
  const unknown = Object.freeze(Object.fromEntries(Object.entries(mob).filter(([key]) => !known_keys.has(key))))
  return (
    <div className="mx-auto max-w-5xl space-y-5" data-content-editor="mob">
      <header
        className="mx-auto flex w-full max-w-3xl items-start gap-4 border-b border-white/9 pb-5"
        data-mob-detail-header=""
      >
        {icon && (
          <img
            alt=""
            className="size-[94px] shrink-0 object-contain drop-shadow-[0_0_8px_rgba(200,150,60,0.3)]"
            src={icon}
          />
        )}
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <div className="flex items-center gap-3">
            <InlineField
              class_name="min-w-0 flex-1"
              display={
                <span className="block truncate text-[13px] font-semibold tracking-[0.15em] text-[#c8963c] uppercase">
                  {string_value(mob.name) || 'Add name'}
                </span>
              }
              edit={edit}
              editor={
                <input
                  aria-label="Mob name"
                  autoFocus
                  className={`${detail_input_class} w-full`}
                  onChange={(event) => on_change(['name'], event.target.value)}
                  value={string_value(mob.name)}
                />
              }
              label="mob name"
            />
            <InlineField
              class_name="ml-auto shrink-0"
              display={
                <span className="block border border-[#c8963c]/35 bg-[#c8963c]/10 px-1.5 py-0.5 text-[9px] font-semibold tracking-[0.1em] whitespace-nowrap text-[#c8963c] uppercase">
                  Lv. {median_level}
                </span>
              }
              edit={edit}
              editor={
                <span className="flex items-center gap-2">
                  <input
                    aria-label="Minimum mob level"
                    autoFocus
                    className={`${detail_input_class} w-16 text-right`}
                    onChange={(event) => on_change(['level_min'], Number(event.target.value))}
                    type="number"
                    value={level_min}
                  />
                  <span className="text-[7px] text-[#555b66] uppercase">to</span>
                  <input
                    aria-label="Maximum mob level"
                    className={`${detail_input_class} w-16 text-right`}
                    onChange={(event) => on_change(['level_max'], Number(event.target.value))}
                    type="number"
                    value={level_max}
                  />
                </span>
              }
              label="mob level"
            />
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <InlineField
              class_name="w-fit"
              display={
                <span className="text-[9px] tracking-[0.14em] uppercase" style={{ color: element_colors[element] }}>
                  {titleize_field(element)}
                </span>
              }
              edit={edit}
              editor={
                <select
                  aria-label="Mob element"
                  autoFocus
                  className={`${detail_input_class} w-32`}
                  onChange={(event) => on_change(['element'], event.target.value)}
                  value={element}
                >
                  {element_names.map((option) => (
                    <option key={option} value={option}>
                      {titleize_field(option)}
                    </option>
                  ))}
                </select>
              }
              label="mob element"
            />
            <InlineField
              class_name="w-fit"
              display={
                <span className="text-[8px] tracking-[0.12em] text-[#858b96] uppercase">
                  {titleize_field(role) || 'Add role'}
                </span>
              }
              edit={edit}
              editor={
                <input
                  aria-label="Mob role"
                  autoFocus
                  className={`${detail_input_class} w-32`}
                  onChange={(event) => on_change(['role'], event.target.value)}
                  value={role}
                />
              }
              label="mob role"
            />
            <InlineField
              class_name="w-fit"
              display={
                <span className="text-[8px] tracking-[0.12em] text-[#65c993] uppercase">
                  {titleize_field(family) || 'Add family'}
                </span>
              }
              edit={edit}
              editor={
                <input
                  aria-label="Mob family"
                  autoFocus
                  className={`${detail_input_class} w-32`}
                  onChange={(event) => on_change(['family'], event.target.value)}
                  value={family}
                />
              }
              label="mob family"
            />
          </div>
          <p className="text-[7px] tracking-[0.1em] text-[#555b66] uppercase" data-mob-type={mob_type}>
            {mob_type} · Levels {level_min}–{level_max}
          </p>
        </div>
      </header>
      {power && <MobPowerPanel reference={power.retro} />}
      <SheetSection
        accent={element_colors[element] ?? '#e86a73'}
        note="Level range and rewards frame the authored combat profile."
        title="Combat profile"
      >
        <MobCoreStats
          change={(stat, next) => on_change([stat], next)}
          labels={{ xp: 'Base XP' }}
          ranges={
            power
              ? Object.freeze({
                  hp: { minimum: power.minimum.hp, maximum: power.maximum.hp },
                  ap: { minimum: power.minimum.ap, maximum: power.maximum.ap },
                  mp: { minimum: power.minimum.mp, maximum: power.maximum.mp },
                  agility: { minimum: power.minimum.agility, maximum: power.maximum.agility },
                  tackle: { minimum: power.minimum.tackle, maximum: power.maximum.tackle },
                  dodge: { minimum: power.minimum.dodge, maximum: power.maximum.dodge },
                  wisdom: { minimum: power.minimum.wisdom, maximum: power.maximum.wisdom },
                  xp: { minimum: power.minimum.xp, maximum: power.maximum.xp },
                })
              : undefined
          }
          values={Object.freeze({ ...mob, dodge: power?.dodge, tackle: power?.tackle })}
        />
      </SheetSection>
      <SheetSection
        accent="#78b5ff"
        note="Displayed values are real percentages; storage keeps the centered integer representation."
        title="Resistances"
      >
        <Resistances
          mob={mob}
          on_change={on_change}
          ranges={power ? { minimum: power.minimum.resistances, maximum: power.maximum.resistances } : undefined}
        />
      </SheetSection>
      {power && (
        <SheetSection
          accent="#e8b44f"
          note="Maximum direct single-target spell output with the available AP and authored cast limits."
          title="Damage output"
        >
          <div className="grid grid-cols-2 gap-2" data-mob-damage-range="">
            <StatRange label={`Min · Lv ${power.minimum.level}`} value={power.minimum.damage} />
            <StatRange label={`Max · Lv ${power.maximum.level}`} value={power.maximum.damage} />
          </div>
        </SheetSection>
      )}
      <MobSpells mob={mob} mob_templates={mob_templates} on_change={on_change} />
      <LootEditor mob={mob} on_change={on_change} />
      {Object.keys(unknown).length > 0 && (
        <SheetSection title="Additional authored fields">
          <JsonEditor on_change={on_change} value={unknown} />
        </SheetSection>
      )}
    </div>
  )
}
