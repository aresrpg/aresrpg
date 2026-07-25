// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// simulator/CharacterModal.tsx — ONE modal for a roster slot: creation when the slot is empty, edition once
// it holds a character. The two are the same surface deliberately — a "create" form that shows less than the
// editor teaches the player a layout they then have to unlearn.
//
// It renders the GAME's own components, never lookalikes (the no-divergence law):
//   · stat rows      → StatIdentity (hud/stat_row.jsx, extracted from the character panel's Stats)
//   · spell rows     → SpellRow + spell_copy (hud/spell_row.jsx, extracted from the grimoire's Spellbook)
//   · spell tooltip  → SpellHoverTip (hud/spell-hover-tip.jsx — the fight hotbar's own hover card)
//   · equipment      → EquipmentDoll/EquipmentSlot via LoadoutSection (the inventory's paper doll)
//   · the dialog     → ModalFrame (components/modal_frame.tsx, extracted from the maintenance modal)
// Everything numeric it shows comes from the page reducer's budgets; it computes no balance of its own.
//
// CHROME: the dialog card IS the one level of containment. Inside it every section is a micro-label plus
// whitespace — no sub-cards, no framed groups, no bordered row containers. Rows separate with a single
// hairline; the only boxes left are the atoms themselves (a slot cell, an input).
//
// DENSITY: identity (name/level/sex) on ONE row · class · stats BESIDE equipment · spells last, dense and
// two-up. The editor shows a whole build at once, so it is sized for that (max-w-6xl) and every shared
// component it borrows is asked for its compact size — `EquipmentDoll compact` and `SpellRow dense`, props
// on the ONE component, never a local lookalike. Before that, the doll's stretch-to-column cells reached
// ~210px each and twenty two-line spell rows put the gear three screens below the fold.

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { RotateCcw, Trash2 } from 'lucide-react'
import sdk_classes from '@aresrpg/sdk/classes'

import { ModalFrame } from '../components/modal_frame'
import { seed_el_label } from '../game/screens/hud/seed-effect-line.js'
import { SpellHoverTip } from '../game/screens/hud/spell-hover-tip.jsx'
import { SpellRow, spell_copy } from '../game/screens/hud/spell_row.jsx'
import { StatIdentity } from '../game/screens/hud/stat_row.jsx'

import { character_spell_rows, spell_level_options, type GrimoireRow } from './build_view'
import { LoadoutSection } from './LoadoutSection'
import {
  MAX_LEVEL,
  SIM_STATS,
  spell_budget,
  spells_spent,
  stat_budget,
  stats_spent,
  type SimCharacter,
  type SimStat,
} from './reducer'
import { use_simulator } from './store'

const GOLD = '#c8963c'
const micro = 'text-[9px] tracking-[0.22em] uppercase'

/** The narrow `t` signature the HUD's JSDoc-typed components declare (mob_spells_section.tsx's precedent). */
type Translate = (key: string, params?: object) => string

type ClassRow = { id: string; name: string; title: string }

const CLASS_ROWS: ClassRow[] = Object.entries(sdk_classes as Record<string, { name: string; title: string }>).map(
  ([id, row]) => ({ id, name: row.name, title: row.title })
)

function Label({ text }: Readonly<{ text: string }>) {
  return <span className={`${micro} font-semibold text-muted`}>{text}</span>
}

function ClassGrid({ selected, on_pick }: Readonly<{ selected: string | null; on_pick: (class_id: string) => void }>) {
  const { t } = useTranslation()
  return (
    <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-x-6 gap-y-1">
      {CLASS_ROWS.map((row) => {
        const active = row.id === selected
        return (
          <button
            key={row.id}
            type="button"
            className="py-1.5 text-left cursor-pointer transition-colors hover:opacity-100 opacity-80"
            style={{
              borderLeft: `2px solid ${active ? GOLD : 'transparent'}`,
              paddingLeft: '8px',
              opacity: active ? 1 : undefined,
            }}
            onClick={() => on_pick(row.id)}
          >
            <div
              className="text-[10px] tracking-[0.12em] uppercase truncate"
              style={{ color: active ? GOLD : '#e8e4dc' }}
            >
              {t(`simulator.classes.${row.id.toUpperCase()}.display`, { defaultValue: row.name })}
            </div>
            <div className={`${micro} text-muted truncate`}>
              {t(`simulator.classes.${row.id.toUpperCase()}.title`, { defaultValue: row.title })}
            </div>
          </button>
        )
      })}
    </div>
  )
}

function SexToggle({ male, on_pick }: Readonly<{ male: boolean; on_pick: (male: boolean) => void }>) {
  const { t } = useTranslation()
  return (
    <div className="flex gap-1">
      {[true, false].map((value) => (
        <button
          key={String(value)}
          type="button"
          className={`${micro} px-3 py-1.5 cursor-pointer`}
          style={{
            borderBottom: `2px solid ${male === value ? GOLD : 'transparent'}`,
            color: male === value ? GOLD : undefined,
          }}
          onClick={() => on_pick(value)}
        >
          {value ? t('simulator.male') : t('simulator.female')}
        </button>
      ))}
    </div>
  )
}

/** A section header carrying its point budget + the reset lever — the same row for stats and for spells. */
function BudgetHeader({
  title,
  left,
  total,
  on_reset,
}: Readonly<{ title: string; left: number; total: number; on_reset: () => void }>) {
  const { t } = useTranslation()
  return (
    <div className="flex items-baseline justify-between">
      <Label text={title} />
      <div className="flex items-center gap-2">
        <span className={micro} style={{ color: left > 0 ? GOLD : '#6b7280' }}>
          {t('simulator.points_left', { left, total })}
        </span>
        <button
          type="button"
          className="cursor-pointer text-muted hover:text-white"
          title={t('simulator.reset')}
          onClick={on_reset}
        >
          <RotateCcw size={11} />
        </button>
      </div>
    </div>
  )
}

function StatEditor({ character }: Readonly<{ character: SimCharacter }>) {
  const { t } = useTranslation()
  const input = use_simulator((state) => state.input)
  const budget = stat_budget(character.level)

  return (
    <div className="flex flex-col gap-2">
      <BudgetHeader
        title={t('simulator.stats')}
        left={budget - stats_spent(character)}
        total={budget}
        on_reset={() => input({ type: 'stats_reset', id: character.id })}
      />
      <div>
        {SIM_STATS.map((stat: SimStat) => (
          <div className="stats__prow" key={stat}>
            <StatIdentity t={t} stat_key={stat} describe={false} />
            <input
              type="number"
              aria-label={stat}
              className="template-input w-16 text-right"
              value={character.stat_alloc[stat]}
              min={0}
              max={budget}
              onChange={(event) =>
                input({ type: 'stat_set', id: character.id, stat, value: Number(event.target.value) })
              }
            />
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * The hover card for a spell AT a level — the fight hotbar's own SpellHoverTip, handed the SELECTED level as
 * its level row. Exported because it is the whole "hovering shows the full detail" contract: what the card
 * says must follow the dropdown, not the spell's level 1.
 */
export function SpellTip({
  t,
  row,
  name,
  level,
}: Readonly<{ t: Translate; row: GrimoireRow; name: string; level: number }>) {
  return <SpellHoverTip t={t} name={name} spell={{ kind: row.subline_kind, levels: [row.levels[level - 1]] }} />
}

/** One spell: the grimoire's row, a level dropdown, and the hotbar's hover card for the SELECTED level. */
export function SpellEditorRow({ character, row }: Readonly<{ character: SimCharacter; row: GrimoireRow }>) {
  const { t } = useTranslation()
  const input = use_simulator((state) => state.input)
  const level = character.spell_levels[row.name_key] ?? 1
  const options = spell_level_options(character, row)
  const translate = t as unknown as Translate
  const name = spell_copy(translate, row.name_key, '', row.name) ?? row.name

  return (
    <SpellRow
      row={row}
      name={name}
      dense
      subline={`${seed_el_label(translate, row.subline_kind)} · ${t(`spells.tag_${row.subline_descriptor}`)}`}
      tip={<SpellTip t={translate} row={row} name={name} level={level} />}
      right={
        <select
          className="template-input w-24 cursor-pointer"
          aria-label={t('simulator.spell_level', { name })}
          value={level}
          onChange={(event) =>
            input({
              type: 'spell_level_set',
              id: character.id,
              spell_id: row.name_key,
              level: Number(event.target.value),
              max_level: options.length,
            })
          }
        >
          {options.map((option) => (
            <option key={option.level} value={option.level} disabled={!option.affordable}>
              {t('simulator.spell_level_option', { level: option.level, cost: option.cost })}
            </option>
          ))}
        </select>
      }
    />
  )
}

function SpellEditor({ character }: Readonly<{ character: SimCharacter }>) {
  const { t } = useTranslation()
  const input = use_simulator((state) => state.input)
  const budget = spell_budget(character.level)
  const rows = character_spell_rows(character)

  return (
    <div className="flex flex-col gap-2">
      <BudgetHeader
        title={t('simulator.spells')}
        left={budget - spells_spent(character)}
        total={budget}
        on_reset={() => input({ type: 'spells_reset', id: character.id })}
      />
      {rows.length === 0 ? (
        <span className={`${micro} text-muted`}>{t('simulator.spells_unavailable')}</span>
      ) : (
        // TWO COLUMNS wherever the dialog is wide enough (auto-fit, so a narrow viewport collapses to one).
        // A class publishes ~20 spells; one dense column is still half a screen of scrolling, two is a list
        // you read at a glance — which is the whole point of a build editor.
        <div className="sb__rows sb__rows--grid">
          {rows.map((row) => (
            <SpellEditorRow key={row.id} character={character} row={row} />
          ))}
        </div>
      )}
    </div>
  )
}

/** The EMPTY-slot phase: pick a class, a name and an appearance. Creation focuses the new character, so the
 *  very same modal re-renders as the editor — no second screen, no re-open. */
function CreateForm({ on_created }: Readonly<{ on_created: (id: string | null) => void }>) {
  const { t } = useTranslation()
  const input = use_simulator((state) => state.input)
  const [class_id, set_class_id] = useState(CLASS_ROWS[0]?.id ?? '')
  const [name, set_name] = useState('')
  const [male, set_male] = useState(true)

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Label text={t('simulator.class')} />
        <ClassGrid selected={class_id} on_pick={set_class_id} />
      </div>
      <div className="flex flex-col gap-2">
        <Label text={t('simulator.name')} />
        {/* Same cap as the editor's identity row: a 24-character field does not need a full dialog of width. */}
        <input
          className="template-input w-full max-w-[460px]"
          value={name}
          maxLength={24}
          placeholder={t('simulator.name')}
          aria-label={t('simulator.name')}
          onChange={(event) => set_name(event.target.value)}
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label text={t('simulator.appearance')} />
        <SexToggle male={male} on_pick={set_male} />
      </div>
      <button
        type="button"
        className={`${micro} px-3 py-2 cursor-pointer self-start`}
        style={{ border: `1px solid ${GOLD}`, color: GOLD, background: 'rgba(200,150,60,0.08)' }}
        onClick={() => {
          input({ type: 'character_added', class_id, name, male })
          // The reducer focuses whatever it just created — read it back through the same door so the modal
          // flips to that character's editor in place, rather than closing and asking for a second click.
          on_created(use_simulator.getState().focus_id)
        }}
      >
        {t('simulator.create')}
      </button>
    </div>
  )
}

export function CharacterEditor({
  character,
  on_deleted,
}: Readonly<{ character: SimCharacter; on_deleted: () => void }>) {
  const { t } = useTranslation()
  const input = use_simulator((state) => state.input)
  const [confirming, set_confirming] = useState(false)

  return (
    <div className="flex flex-col gap-6">
      {/* IDENTITY on one row: the name, the level and the sex are three small controls, not three sections. */}
      <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
        <div className="flex flex-col gap-2 flex-1 min-w-[220px] max-w-[460px]">
          <Label text={t('simulator.name')} />
          <input
            className="template-input w-full"
            value={character.name}
            maxLength={24}
            aria-label={t('simulator.name')}
            onChange={(event) => input({ type: 'character_named', id: character.id, name: event.target.value })}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label text={t('simulator.level')} />
          <input
            type="number"
            className="template-input w-20"
            aria-label={t('simulator.level')}
            value={character.level}
            min={1}
            max={MAX_LEVEL}
            onChange={(event) => input({ type: 'level_set', id: character.id, level: Number(event.target.value) })}
          />
        </div>
        <SexToggle
          male={character.male}
          on_pick={(male) => input({ type: 'character_sex_set', id: character.id, male })}
        />
        <button
          type="button"
          className={`${micro} flex items-center gap-1 cursor-pointer pb-2 ml-auto`}
          style={{ color: confirming ? '#ff5f5f' : undefined }}
          onClick={() => {
            if (!confirming) return set_confirming(true)
            // The seat this modal was opened for no longer holds anything to edit — close with the delete.
            input({ type: 'character_removed', id: character.id })
            on_deleted()
          }}
        >
          <Trash2 size={11} />
          {confirming ? t('simulator.delete_confirm') : t('simulator.delete')}
        </button>
      </div>

      <div className="flex flex-col gap-2">
        <Label text={t('simulator.class')} />
        <ClassGrid
          selected={character.class_id}
          on_pick={(class_id) => input({ type: 'character_class_set', id: character.id, class_id })}
        />
        <span className={`${micro} text-muted`} style={{ opacity: 0.6 }}>
          {t('simulator.class_change_hint')}
        </span>
      </div>

      {/* STATS beside EQUIPMENT: both are short, fixed-height sections, and the dialog's width is otherwise
          spent on nothing. Reading order stays stats → equipment → spells; gear is above the spell list,
          which is the point (it is what a build IS, and it used to sit under three screens of spells). */}
      <div className="flex flex-wrap gap-x-12 gap-y-6">
        {/* Capped: a stat row is an icon, a name and a number — stretched across a full dialog it is one
            lonely digit at the end of a rule. The game's own panel gives it about this much. */}
        <div className="flex-1 min-w-[280px] max-w-[460px]">
          <StatEditor character={character} />
        </div>
        <div className="flex flex-col gap-2">
          <Label text={t('simulator.equipment')} />
          <LoadoutSection character={character} />
        </div>
      </div>

      <SpellEditor character={character} />
    </div>
  )
}

/**
 * The roster-slot modal. `character` null = the slot is empty (creation); otherwise the full editor. Deleting
 * the character closes it, because the slot it was opened for no longer holds anything to edit.
 */
export function CharacterModal({
  character,
  on_close,
  on_created,
}: Readonly<{ character: SimCharacter | null; on_close: () => void; on_created: (id: string | null) => void }>) {
  const { t } = useTranslation()
  const title = character ? t('simulator.edit_character') : t('simulator.new_character')

  return (
    // A build editor is a WIDE surface: six stats, twenty spells and twenty slots at once. At max-w-3xl the
    // dialog spent 40% of a desktop viewport on backdrop and asked for three screens of scrolling instead.
    <ModalFrame on_close={on_close} max_width="max-w-6xl" label={title}>
      {/* THE TOKEN BRIDGE (#883). Every borrowed component here — the paper doll, the stat rows, the spell
          rows — is styled in hud-panels.css against the GAME tokens, which live on `.gw-tab` (game-tab.css)
          and nowhere else; the character page gets them by BEING a `.gw-tab`. This dialog is portalled to
          <body>, outside any of it, so `var(--s-2)` resolved to nothing and every gap and row padding in the
          shared markup collapsed to zero — the doll read as a bare grid and the stat rows sat flush against
          their icons. The carrier is the house's own answer (display:contents): same tokens, no tab box. */}
      {/* The carrier is `display:contents` — it must stay a bare wrapper, never the layout box itself. */}
      <div className="gw-tab gw-tab--carrier">
        <div className="flex flex-col gap-5 px-7 py-6">
          <div className="text-gradient text-[12px] font-semibold tracking-[0.28em] uppercase">{title}</div>
          <div className="w-full h-px bg-border" />
          {character ? (
            <CharacterEditor character={character} on_deleted={on_close} />
          ) : (
            <CreateForm on_created={on_created} />
          )}
        </div>
      </div>
    </ModalFrame>
  )
}
