// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The tracked simulator character modal. Only its state and catalog doors changed during the frontend rebuild.

import { EFFECT_KINDS } from '@aresrpg/fight/move_contract'
import { class_names, max_level, stat_names } from '@aresrpg/immutable'
import { RotateCcw, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'

import { ModalFrame } from '../components/ModalFrame.tsx'
import { SpellRow } from '../components/SpellRow.tsx'
import { StatIdentity } from '../components/StatIdentity.tsx'
import { spell_icon } from '../content/assets.ts'
import { encyclopedia_catalog, titleize, type SeedSpell } from '../content/catalog.ts'
import type { AppCopy } from '../i18n/copy.ts'
import { element_colors } from '../visual_identity.ts'
import {
  CHARACTER_STATS,
  MAX_SIMULATOR_NAME_LENGTH,
  next_simulator_character_id,
  spell_budget,
  spell_point_cost,
  stat_budget,
  type SimulatorCharacter,
} from '../modules/simulator.ts'
import { dispatch_app, useAppStore } from '../store.ts'

import { LoadoutSection } from './LoadoutSection.tsx'
import './character_modal.css'

const GOLD = '#c8963c'
const micro = 'text-[9px] tracking-[0.22em] uppercase'
const secondary_stats = stat_names.filter((stat) => !(CHARACTER_STATS as readonly string[]).includes(stat))
const damaging_effects = new Set(
  [
    EFFECT_KINDS.damage,
    EFFECT_KINDS.pct_life,
    EFFECT_KINDS.caster_damage,
    EFFECT_KINDS.punishment,
    EFFECT_KINDS.steal,
  ].map(Number)
)

const template = (source: string, values: Readonly<Record<string, string | number>>): string =>
  Object.entries(values).reduce((text, [key, value]) => text.replaceAll(`{${key}}`, String(value)), source)

const class_display = (classe: string): string => (classe === 'yogan' ? 'Yogen' : titleize(classe))

function Label({ text }: Readonly<{ text: string }>) {
  return <span className={`${micro} font-semibold text-muted`}>{text}</span>
}

function ClassGrid({
  copy,
  selected,
  on_pick,
}: Readonly<{ copy: AppCopy; selected: string | null; on_pick: (classe: string) => void }>) {
  const text = copy.simulator_page
  return (
    <div className="grid grid-cols-3 gap-x-6 gap-y-1 sm:grid-cols-4 lg:grid-cols-6">
      {class_names.map((classe) => {
        const active = classe === selected
        return (
          <button
            key={classe}
            type="button"
            className="cursor-pointer py-1.5 text-left opacity-80 transition-colors hover:opacity-100"
            style={{
              borderLeft: `2px solid ${active ? GOLD : 'transparent'}`,
              paddingLeft: '8px',
              opacity: active ? 1 : undefined,
            }}
            onClick={() => on_pick(classe)}
          >
            <div
              className="truncate text-[10px] tracking-[0.12em] uppercase"
              style={{ color: active ? GOLD : '#e8e4dc' }}
            >
              {class_display(classe)}
            </div>
            <div className={`${micro} truncate text-muted`}>{text[`class_${classe}_title`]}</div>
          </button>
        )
      })}
    </div>
  )
}

function SexToggle({
  copy,
  male,
  on_pick,
}: Readonly<{ copy: AppCopy; male: boolean; on_pick: (male: boolean) => void }>) {
  return (
    <div className="flex gap-1">
      {[true, false].map((value) => (
        <button
          key={String(value)}
          type="button"
          className={`${micro} cursor-pointer px-3 py-1.5`}
          style={{
            borderBottom: `2px solid ${male === value ? GOLD : 'transparent'}`,
            color: male === value ? GOLD : undefined,
          }}
          onClick={() => on_pick(value)}
        >
          {value ? copy.male : copy.female}
        </button>
      ))}
    </div>
  )
}

function BudgetHeader({
  copy,
  title,
  left,
  total,
  on_reset,
}: Readonly<{ copy: AppCopy; title: string; left: number; total: number; on_reset: () => void }>) {
  return (
    <div className="flex items-baseline justify-between">
      <Label text={title} />
      <div className="flex items-center gap-2">
        <span className={micro} style={{ color: left > 0 ? GOLD : '#6b7280' }}>
          {template(copy.simulator_page.points_left, { left, total })}
        </span>
        <button
          type="button"
          className="cursor-pointer text-muted hover:text-white"
          title={copy.simulator_page.reset}
          onClick={on_reset}
        >
          <RotateCcw size={11} />
        </button>
      </div>
    </div>
  )
}

const equipment_stats = (character: Readonly<SimulatorCharacter>): Readonly<Record<string, number>> =>
  Object.freeze(
    Object.fromEntries(
      stat_names.map((stat) => [
        stat,
        Object.values(character.loadout).reduce((total, item_type) => {
          const item = encyclopedia_catalog.items.find((candidate) => candidate.item_type === item_type)
          return total + (item?.stats?.max[stat] ?? 0)
        }, 0),
      ])
    )
  )

function StatEditor({ character, copy }: Readonly<{ character: SimulatorCharacter; copy: AppCopy }>) {
  const text = copy.simulator_page
  const budget = stat_budget(character.level)
  const spent = CHARACTER_STATS.reduce((total, stat) => total + character[stat], 0)
  const bonuses = equipment_stats(character)

  return (
    <div className="flex flex-col gap-2">
      <BudgetHeader
        copy={copy}
        title={text.stats}
        left={budget - spent}
        total={budget}
        on_reset={() => dispatch_app({ type: 'simulator/stats_reset', character_id: character.id })}
      />
      <div>
        {CHARACTER_STATS.map((stat) => {
          const bonus = bonuses[stat] ?? 0
          return (
            <div className="stats__prow" key={stat}>
              <StatIdentity label={text[`stat_${stat}`]} stat={stat} />
              <input
                type="number"
                aria-label={text[`stat_${stat}`]}
                className="template-input w-16 text-right"
                value={character[stat]}
                min={0}
                max={budget}
                onChange={(event) =>
                  dispatch_app({
                    type: 'simulator/stat_set',
                    character_id: character.id,
                    stat,
                    value: Number(event.target.value),
                  })
                }
              />
              {bonus !== 0 && <span className="stats__prow-bonus"> ({bonus > 0 ? `+${bonus}` : bonus})</span>}
            </div>
          )
        })}
        {secondary_stats.map((stat) => {
          const bonus = bonuses[stat] ?? 0
          return bonus === 0 ? null : (
            <div className="stats__prow" key={stat}>
              <StatIdentity label={text[`stat_${stat}`]} stat={stat} />
              <span className="stats__prow-bonus"> ({bonus > 0 ? `+${bonus}` : bonus})</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

const spell_row_view = (spell: Readonly<SeedSpell>, level: number): Readonly<{ color: string; subline: string }> => {
  const selected = spell.levels[level - 1]
  const damage = selected?.effects.find((effect) => damaging_effects.has(effect.kind))
  const kind = damage?.element ? titleize(damage.element) : 'Utility'
  const range = selected?.range_max ?? 0
  const descriptor = range === 0 ? 'Self' : range <= 1 && damage ? 'Melee' : range <= 1 ? 'Self' : 'Ranged'
  return Object.freeze({
    color: element_colors[damage?.element ?? ''] ?? GOLD,
    subline: `${kind} · ${descriptor}`,
  })
}

function SpellEditor({ character, copy }: Readonly<{ character: SimulatorCharacter; copy: AppCopy }>) {
  const text = copy.simulator_page
  const rows = useMemo(
    () =>
      (encyclopedia_catalog.class(character.classe)?.spells ?? Object.freeze([]))
        .filter(({ unlock_level }) => unlock_level <= character.level)
        .toSorted((left, right) => left.unlock_level - right.unlock_level || left.name.localeCompare(right.name)),
    [character.classe, character.level]
  )
  const budget = spell_budget(character.level)
  const spent = Object.values(character.spell_levels).reduce((total, level) => total + spell_point_cost(level), 0)

  return (
    <div className="flex flex-col gap-2">
      <BudgetHeader
        copy={copy}
        title={text.spells}
        left={budget - spent}
        total={budget}
        on_reset={() => dispatch_app({ type: 'simulator/spells_reset', character_id: character.id })}
      />
      {rows.length === 0 ? (
        <span className={`${micro} text-muted`}>{text.spells_unavailable}</span>
      ) : (
        <div className="sb__rows sb__rows--grid">
          {rows.map((spell) => {
            const level = character.spell_levels[spell.name] ?? 1
            const available = budget - spent + spell_point_cost(level)
            const view = spell_row_view(spell, level)
            return (
              <SpellRow
                color={view.color}
                icon={spell_icon(character.classe, spell.name)}
                key={spell.name}
                name={spell.name}
                right={
                  <select
                    className="template-input w-24 cursor-pointer"
                    aria-label={template(text.spell_level, { name: spell.name })}
                    value={level}
                    onChange={(event) =>
                      dispatch_app({
                        type: 'simulator/spell_level_set',
                        character_id: character.id,
                        spell_name: spell.name,
                        level: Number(event.target.value),
                        max_level: spell.levels.length,
                      })
                    }
                  >
                    {spell.levels.map((_, index) => {
                      const option = index + 1
                      return (
                        <option disabled={spell_point_cost(option) > available} key={option} value={option}>
                          {template(text.spell_level_option, { level: option, cost: spell_point_cost(option) })}
                        </option>
                      )
                    })}
                  </select>
                }
                subline={`Lv. ${spell.unlock_level} · ${view.subline}`}
              />
            )
          })}
        </div>
      )}
    </div>
  )
}

function CreateForm({ copy, on_created }: Readonly<{ copy: AppCopy; on_created: (character_id: string) => void }>) {
  const characters = useAppStore(({ simulator }) => simulator.characters)
  const [classe, set_classe] = useState<string>(class_names[0] ?? '')
  const [name, set_name] = useState('')
  const [male, set_male] = useState(true)

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Label text={copy.class_label} />
        <ClassGrid copy={copy} selected={classe} on_pick={set_classe} />
      </div>
      <div className="flex flex-col gap-2">
        <Label text={copy.name_label} />
        <input
          className="template-input w-full max-w-[460px]"
          value={name}
          maxLength={MAX_SIMULATOR_NAME_LENGTH}
          placeholder={copy.name_label}
          aria-label={copy.name_label}
          onChange={(event) => set_name(event.target.value)}
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label text={copy.simulator_page.appearance} />
        <SexToggle copy={copy} male={male} on_pick={set_male} />
      </div>
      <button
        type="button"
        className={`${micro} cursor-pointer self-start px-3 py-2 disabled:cursor-not-allowed disabled:opacity-35`}
        disabled={!name.trim()}
        style={{ border: `1px solid ${GOLD}`, color: GOLD, background: 'rgba(200,150,60,0.08)' }}
        onClick={() => {
          const character_id = next_simulator_character_id(characters)
          if (!character_id) return
          dispatch_app({ type: 'simulator/character_added', character_id, classe, name, male })
          on_created(character_id)
        }}
      >
        {copy.simulator_page.create}
      </button>
    </div>
  )
}

export function CharacterEditor({
  character,
  copy,
  on_deleted,
}: Readonly<{ character: SimulatorCharacter; copy: AppCopy; on_deleted: () => void }>) {
  const text = copy.simulator_page
  const [confirming, set_confirming] = useState(false)

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
        <div className="flex min-w-[220px] max-w-[460px] flex-1 flex-col gap-2">
          <Label text={copy.name_label} />
          <input
            className="template-input w-full"
            value={character.name}
            maxLength={MAX_SIMULATOR_NAME_LENGTH}
            aria-label={copy.name_label}
            onChange={(event) =>
              dispatch_app({ type: 'simulator/character_named', character_id: character.id, name: event.target.value })
            }
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label text={text.level_label} />
          <input
            type="number"
            className="template-input w-20"
            aria-label={text.level_label}
            value={character.level}
            min={1}
            max={max_level}
            onChange={(event) =>
              dispatch_app({
                type: 'simulator/level_set',
                character_id: character.id,
                level: Number(event.target.value),
              })
            }
          />
        </div>
        <SexToggle
          copy={copy}
          male={character.male}
          on_pick={(male) => dispatch_app({ type: 'simulator/character_sex_set', character_id: character.id, male })}
        />
        <button
          type="button"
          className={`${micro} ml-auto flex cursor-pointer items-center gap-1 pb-2`}
          style={{ color: confirming ? '#ff5f5f' : undefined }}
          onClick={() => {
            if (!confirming) return set_confirming(true)
            dispatch_app({ type: 'simulator/character_removed', character_id: character.id })
            on_deleted()
          }}
        >
          <Trash2 size={11} />
          {confirming ? text.delete_confirm : text.delete}
        </button>
      </div>

      <div className="flex flex-col gap-2">
        <Label text={copy.class_label} />
        <ClassGrid
          copy={copy}
          selected={character.classe}
          on_pick={(classe) =>
            dispatch_app({ type: 'simulator/character_class_set', character_id: character.id, classe })
          }
        />
        <span className={`${micro} text-muted`} style={{ opacity: 0.6 }}>
          {text.class_change_hint}
        </span>
      </div>

      <div className="flex flex-wrap gap-x-12 gap-y-6">
        <div className="min-w-[280px] max-w-[460px] flex-1">
          <StatEditor character={character} copy={copy} />
        </div>
        <div className="flex flex-col gap-2">
          <Label text={text.equipment_short} />
          <LoadoutSection character={character} copy={copy} />
        </div>
      </div>

      <SpellEditor character={character} copy={copy} />
    </div>
  )
}

export function CharacterModal({
  character,
  copy,
  close,
  created,
}: Readonly<{
  character: SimulatorCharacter | null
  copy: AppCopy
  close: () => void
  created: (character_id: string) => void
}>) {
  const title = character ? copy.simulator_page.edit_character : copy.simulator_page.new_character

  return (
    <ModalFrame close={close} close_label={copy.wallet_close} label={title} max_width="max-w-6xl">
      <div className="gw-tab gw-tab--carrier">
        <div className="flex flex-col gap-5 px-7 py-6">
          <div className="text-gradient text-[12px] font-semibold tracking-[0.28em] uppercase">{title}</div>
          <div className="h-px w-full bg-border" />
          {character ? (
            <CharacterEditor character={character} copy={copy} on_deleted={close} />
          ) : (
            <CreateForm copy={copy} on_created={created} />
          )}
        </div>
      </div>
    </ModalFrame>
  )
}
