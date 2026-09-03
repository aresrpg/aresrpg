// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { class_names } from '@aresrpg/immutable'
import { Check, Crosshair, Sparkles, X, Zap, type LucideIcon } from 'lucide-react'
import { useState, type FocusEvent, type ReactNode } from 'react'

import { spell_icon } from '../content/assets.ts'
import type { SpellLevel } from '../content/catalog.ts'
import { titleize } from '../content/catalog.ts'

import { EntityIcon } from './components.tsx'
import type { EncyclopediaText } from './copy.ts'
import { EffectLines, effect_color, type SpellCardEdit, type SpellCardValue } from './SpellCardEffects.tsx'

export type { SpellCardEdit, SpellCardPath, SpellCardValue } from './SpellCardEffects.tsx'

export type SpellCardLevel = SpellLevel & Readonly<{ mp_cost?: number }>
export type SpellCardSpell = Readonly<{
  classe: string
  name: string
  unlock_level: number
  levels: readonly SpellCardLevel[]
}>
type EffectsFooter = (context: Readonly<{ level: SpellCardLevel; level_index: number }>) => ReactNode
const displayed_name = (spell: SpellCardSpell, display_name: string | undefined): string => display_name ?? spell.name

const field_class =
  'h-8 border border-white/12 bg-bg px-2 text-[10px] text-[#e8e4dc] outline-none focus:border-[#c8963c]/60'

const english: EncyclopediaText = (key, values) => {
  const labels: Readonly<Record<string, string>> = Object.freeze({
    ap_cost: 'AP cost',
    range: 'Range',
    range_modifiability: 'Modifiable range',
    casts_per_turn: 'Casts / turn',
    casts_per_target: 'Casts / target',
    cooldown: 'Cooldown',
    cooldown_none: 'None',
    crit_chance: 'Critical',
    line_of_sight: 'Line of sight',
    cast_line: 'Straight-line cast',
    target_cell_empty: 'Empty target cell',
    effects: 'Effects',
    unlimited: 'Unlimited',
  })
  if (key === 'turns_value') return `${values?.n ?? 0} turns`
  return labels[key] ?? key
}

const NumberField = ({
  value,
  change,
  width = 'w-16',
  label,
  auto_focus = true,
}: Readonly<{
  value: number
  change: (value: number) => void
  width?: string
  label: string
  auto_focus?: boolean
}>) => (
  <input
    aria-label={label}
    autoFocus={auto_focus}
    className={`${field_class} ${width} tabular-nums`}
    onChange={(event) => change(Number(event.target.value))}
    type="number"
    value={value}
  />
)

const SelectField = ({
  value,
  options,
  change,
  label,
}: Readonly<{
  value: string | number
  options: readonly (readonly [string, string | number])[]
  change: (value: string | number) => void
  label: string
}>) => (
  <select
    aria-label={label}
    autoFocus
    className={`${field_class} w-36`}
    onChange={(event) => {
      const option = options.find(([, option_value]) => String(option_value) === event.target.value)
      if (option) change(option[1])
    }}
    value={value}
  >
    {options.map(([option_label, option_value]) => (
      <option key={String(option_value)} value={option_value}>
        {option_label}
      </option>
    ))}
  </select>
)

const InlineField = ({
  label,
  edit,
  display,
  editor,
  class_name = '',
}: Readonly<{
  label: string
  edit?: SpellCardEdit
  display: ReactNode
  editor: ReactNode
  class_name?: string
}>) => {
  const [editing, set_editing] = useState(false)
  const finish = (event: Readonly<FocusEvent<HTMLSpanElement>>): void => {
    if (event.relatedTarget && event.currentTarget.contains(event.relatedTarget)) return
    set_editing(false)
    edit?.save()
  }
  if (!edit) return display
  if (editing)
    return (
      <span className={class_name} onBlur={finish}>
        {editor}
      </span>
    )
  return (
    <button
      aria-label={`Edit ${label}`}
      className={`${class_name} cursor-text text-left hover:bg-white/[0.035]`}
      data-spell-inline-edit={label}
      onClick={() => set_editing(true)}
      type="button"
    >
      {display}
    </button>
  )
}

const Metric = ({
  Icon,
  label,
  color,
  children,
}: Readonly<{ Icon: LucideIcon; label: string; color: string; children: ReactNode }>) => (
  <div className="flex min-h-14 items-center gap-3 border border-white/8 bg-white/[0.018] px-3 py-2">
    <span
      className="grid size-8 shrink-0 place-items-center border"
      style={{ borderColor: `${color}55`, backgroundColor: `${color}12`, color }}
    >
      <Icon size={15} strokeWidth={1.6} />
    </span>
    <span className="min-w-0">
      <span className="block text-[8px] tracking-[0.13em] text-[#747883] uppercase">{label}</span>
      <span className="mt-1 flex items-center gap-1 text-[13px] font-semibold tabular-nums" style={{ color }}>
        {children}
      </span>
    </span>
  </div>
)

const Rule = ({
  label,
  value,
  edit,
  change,
}: Readonly<{ label: string; value: boolean; edit?: SpellCardEdit; change: (value: boolean) => void }>) => {
  const content = (
    <>
      <span className="text-[9px] text-[#a5a19a]">{label}</span>
      {value ? <Check className="text-[#68d391]" size={13} /> : <X className="text-[#ff7d8f]" size={13} />}
    </>
  )
  return (
    <InlineField
      class_name="flex min-h-10 w-full items-center justify-between gap-3 bg-surface-low px-3"
      display={content}
      edit={edit}
      editor={
        <>
          <span className="text-[9px] text-[#a5a19a]">{label}</span>
          <input
            aria-label={label}
            autoFocus
            checked={value}
            className="accent-[#68d391]"
            onChange={(event) => change(event.target.checked)}
            type="checkbox"
          />
        </>
      }
      label={label}
    />
  )
}

const Constraint = ({ label, children }: Readonly<{ label: string; children: ReactNode }>) => (
  <div className="flex min-h-10 items-center justify-between gap-3 bg-surface-low px-3">
    <span className="text-[9px] text-[#858994]">{label}</span>
    <span className="text-[10px] font-semibold text-[#d8d3ca]">{children}</span>
  </div>
)

const SpellEffects = ({
  level,
  level_index,
  edit,
  footer,
}: Readonly<{
  level: SpellCardLevel
  level_index: number
  edit?: SpellCardEdit
  footer?: EffectsFooter
}>) => (
  <>
    <EffectLines critical_effects={level.crit_effects} edit={edit} effects={level.effects} level_index={level_index} />
    {footer?.({ level, level_index })}
  </>
)

const SpellArt = ({
  visible,
  name,
  classe,
  spell_name,
}: Readonly<{ visible: boolean; name: string; classe: string; spell_name: string }>) =>
  visible ? (
    <span className="contents" data-spell-art="">
      <EntityIcon label={name} size="size-18" src={spell_icon(classe, spell_name)} />
    </span>
  ) : null

export const SpellCard = ({
  spell,
  text = english,
  edit,
  initial_level = 1,
  small = false,
  effects_footer,
  display_name,
  show_icon,
}: Readonly<{
  spell: SpellCardSpell
  text?: EncyclopediaText
  edit?: SpellCardEdit
  initial_level?: number
  small?: boolean
  effects_footer?: EffectsFooter
  display_name?: string
  show_icon?: boolean
}>) => {
  const [level_index, set_level_index] = useState(Math.max(0, initial_level - 1))
  const safe_index = Math.min(level_index, spell.levels.length - 1)
  const level = spell.levels[safe_index]
  const name = displayed_name(spell, display_name)
  if (!level) return null
  if (small)
    return (
      <article
        className="w-full max-w-sm space-y-3"
        data-spell-current-level={safe_index + 1}
        data-spell-detail-card=""
        data-spell-small=""
      >
        <header className="flex items-center justify-between gap-5 border-b border-white/9 pb-3">
          <h3 className="min-w-0 truncate text-[13px] font-semibold tracking-[0.13em] text-[#e6bf79] uppercase">
            {name}
          </h3>
          <span className="flex shrink-0 items-center gap-2 text-[9px] tracking-[0.12em] text-[#858994] uppercase">
            <Sparkles className="text-[#f0c35a]" size={13} strokeWidth={1.6} />
            {text('crit_chance')}
            <b className="text-[11px] text-[#f0c35a] tabular-nums">
              {level.crit_1_in ? `1 / ${level.crit_1_in}` : '—'}
            </b>
          </span>
        </header>
        <section className="space-y-2" data-spell-effects="">
          <h4 className="text-[9px] font-semibold tracking-[0.2em] text-[#777b86] uppercase">{text('effects')}</h4>
          <EffectLines compact critical_effects={level.crit_effects} effects={level.effects} level_index={safe_index} />
        </section>
      </article>
    )
  const accent = effect_color(level.effects.find(({ element }) => element)?.element ?? '')
  const change_level = (field: keyof SpellLevel, value: SpellCardValue): void =>
    edit?.change(['levels', safe_index, field], value)

  return (
    <article className="mx-auto w-full max-w-3xl space-y-4" data-spell-detail-card="">
      <header className="flex items-center gap-4">
        <SpellArt classe={spell.classe} name={name} spell_name={spell.name} visible={show_icon !== false} />
        <div className="min-w-0 flex-1">
          <InlineField
            class_name="block max-w-full"
            display={
              <h3 className="truncate text-[14px] font-semibold tracking-[0.13em] text-[#e6bf79] uppercase">{name}</h3>
            }
            edit={edit}
            editor={
              <input
                aria-label="Spell name"
                autoFocus
                className={`${field_class} w-full max-w-72 font-semibold text-[#e0b86b]`}
                onChange={(event) => edit?.change(['name'], event.target.value)}
                value={spell.name}
              />
            }
            label="spell name"
          />
          <InlineField
            class_name="mt-2 block w-fit"
            display={
              <p className="text-[9px] tracking-[0.14em] uppercase" style={{ color: accent }}>
                {titleize(spell.classe)}
              </p>
            }
            edit={edit}
            editor={
              <SelectField
                change={(value) => edit?.change(['classe'], value)}
                label="Class"
                options={class_names.map((value) => [titleize(value), value] as const)}
                value={spell.classe}
              />
            }
            label="class"
          />
        </div>
      </header>

      <section className="border border-white/9 bg-black/10">
        <nav className="flex h-11 items-end gap-1 border-b border-white/9 px-3" data-spell-level-tabs="">
          {spell.levels.map((_, index) => (
            <button
              aria-label={`Spell level ${index + 1}`}
              className={`relative -mb-px h-9 min-w-12 border px-4 text-[9px] font-semibold ${index === safe_index ? 'z-[1] border-[#c8963c]/55 border-b-surface-low bg-surface-low text-[#e0b86b]' : 'border-transparent text-[#626670] hover:border-white/8 hover:text-[#aaa6a0]'}`}
              key={index}
              onClick={() => set_level_index(index)}
              type="button"
            >
              {index + 1}
            </button>
          ))}
        </nav>

        <div className="space-y-5 p-4">
          <div className="grid gap-2 sm:grid-cols-3" data-spell-ap-cost={level.ap_cost}>
            <Metric Icon={Zap} color="#e8b44f" label={text('ap_cost')}>
              <InlineField
                display={level.ap_cost}
                edit={edit}
                editor={
                  <NumberField
                    change={(value) => change_level('ap_cost', value)}
                    label={text('ap_cost')}
                    value={level.ap_cost}
                    width="w-14"
                  />
                }
                label={text('ap_cost')}
              />
            </Metric>
            <Metric Icon={Crosshair} color="#67adff" label={text('range')}>
              <InlineField
                class_name="flex items-center gap-1"
                display={`${level.range_min}–${level.range_max}`}
                edit={edit}
                editor={
                  <>
                    <NumberField
                      change={(value) => change_level('range_min', value)}
                      label="Minimum range"
                      value={level.range_min}
                      width="w-12"
                    />
                    <span className="text-[#777b86]">to</span>
                    <NumberField
                      auto_focus={false}
                      change={(value) => change_level('range_max', value)}
                      label="Maximum range"
                      value={level.range_max}
                      width="w-12"
                    />
                  </>
                }
                label={text('range')}
              />
            </Metric>
            <Metric Icon={Sparkles} color="#f0c35a" label={text('crit_chance')}>
              <InlineField
                display={level.crit_1_in ? `1 / ${level.crit_1_in}` : '—'}
                edit={edit}
                editor={
                  <NumberField
                    change={(value) => change_level('crit_1_in', value)}
                    label={text('crit_chance')}
                    value={level.crit_1_in}
                    width="w-14"
                  />
                }
                label={text('crit_chance')}
              />
            </Metric>
          </div>

          <section className="space-y-2" data-spell-effects="">
            <h4 className="text-[9px] font-semibold tracking-[0.2em] text-[#777b86] uppercase">{text('effects')}</h4>
            <SpellEffects edit={edit} footer={effects_footer} level={level} level_index={safe_index} />
          </section>

          <section className="space-y-2 border-t border-white/8 pt-4">
            <div className="grid gap-px border border-white/8 bg-white/8 sm:grid-cols-2">
              <Rule
                change={(value) => change_level('modifiable_range', value)}
                edit={edit}
                label={text('range_modifiability')}
                value={level.modifiable_range}
              />
              <Rule
                change={(value) => change_level('line_of_sight', value)}
                edit={edit}
                label={text('line_of_sight')}
                value={level.line_of_sight}
              />
              <Rule
                change={(value) => change_level('line_launch', value)}
                edit={edit}
                label={text('cast_line')}
                value={level.line_launch}
              />
              <Rule
                change={(value) => change_level('free_cell', value)}
                edit={edit}
                label={text('target_cell_empty')}
                value={level.free_cell}
              />
            </div>
            <div className="grid gap-px border border-white/8 bg-white/8 sm:grid-cols-2">
              {[
                [
                  text('casts_per_turn'),
                  'casts_per_turn',
                  level.casts_per_turn,
                  level.casts_per_turn || text('unlimited'),
                ],
                [
                  text('casts_per_target'),
                  'casts_per_target',
                  level.casts_per_target,
                  level.casts_per_target || text('unlimited'),
                ],
                [
                  text('cooldown'),
                  'cooldown_turns',
                  level.cooldown_turns,
                  level.cooldown_turns || text('cooldown_none'),
                ],
              ].map(([label, field, value, display]) => (
                <Constraint key={String(field)} label={String(label)}>
                  <InlineField
                    display={display}
                    edit={edit}
                    editor={
                      <NumberField
                        change={(next) => change_level(field as keyof SpellLevel, next)}
                        label={String(label)}
                        value={Number(value)}
                      />
                    }
                    label={String(label)}
                  />
                </Constraint>
              ))}
            </div>
          </section>
        </div>
      </section>
    </article>
  )
}
