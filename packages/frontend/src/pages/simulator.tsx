// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// /simulator — the LOCAL fight simulator's setup surface (docs/design/simulator_rebuild_spec.md).
//
// This page replaced the legacy build calculator wholesale: that one computed its own STAMINA/COOLDOWN
// balance math, which predates the live AP/MP model entirely. Nothing here computes balance — the page is a
// thin editor over the ONE page reducer (simulator/reducer.ts), whose budgets mirror the chain's, and every
// edit persists to IndexedDB through the store's persistence edge (reload-proof by construction).
//
// L0 scope: the shell, the roster, and the character editors (class / level / stats / spells). The board
// viewport, the mob picks and the fight itself mount in the following lanes — this page shows their region
// as an honest empty frame rather than pretending it exists.

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Dices, Plus, RotateCcw, Trash2 } from 'lucide-react'
import sdk_classes from '@aresrpg/sdk/classes'

import { STAT_COLORS, stat_label } from '../components/entity_colors'
import { class_spells } from '../game/screens/hud/fight-spells.js'
import {
  MAX_LEVEL,
  MAX_ROSTER,
  SIM_STATS,
  spell_budget,
  spell_cost,
  spells_spent,
  stat_budget,
  stats_spent,
  type SimCharacter,
  type SimStat,
} from '../simulator/reducer'
import { boot_simulator, use_simulator } from '../simulator/store'

const GOLD = '#c8963c'
const HAIRLINE = '1px solid rgba(255,255,255,0.06)'
const PANE_FILL = 'rgba(255,255,255,0.02)'

type ClassRow = { id: string; name: string; title: string; weapon_category: string }

const CLASS_ROWS: ClassRow[] = Object.entries(
  sdk_classes as Record<string, { name: string; title: string; weapon_category: string }>
).map(([id, row]) => ({ id, name: row.name, title: row.title, weapon_category: row.weapon_category }))

/** A spell row the editor can raise: the corpus template plus the highest level this character may reach. */
type SpellRow = { key: string; name: string; unlock_level: number; max_level: number }

/**
 * The class's published spells, capped per character level by the SAME two chain gates `raise_spell_level`
 * asserts: a spell unlocks at `unlock_level`, and each level of a template carries its own `min_char_level`.
 * Rows are keyed by `name_key` (stable across republishes — the SpellTemplate object id is not).
 */
const spell_rows = (class_id: string, level: number): SpellRow[] =>
  (
    class_spells(class_id) as {
      name: string
      name_key: string
      unlock_level: number
      levels: { min_char_level: number }[]
    }[]
  )
    .filter((spell) => spell.unlock_level <= level)
    .map((spell) => ({
      key: spell.name_key,
      name: spell.name,
      unlock_level: spell.unlock_level,
      max_level: spell.levels.filter(({ min_char_level }) => min_char_level <= level).length || 1,
    }))

const micro = 'text-[9px] tracking-[0.22em] uppercase'

function Label({ text }: Readonly<{ text: string }>) {
  return <span className={`${micro} font-semibold text-muted`}>{text}</span>
}

function Pane({
  title,
  children,
  className = '',
}: Readonly<{ title: string; children: ReactNode; className?: string }>) {
  return (
    <section className={`flex flex-col min-h-0 ${className}`} style={{ border: HAIRLINE, background: PANE_FILL }}>
      <header className="px-3 py-2" style={{ borderBottom: HAIRLINE }}>
        <Label text={title} />
      </header>
      <div className="flex-1 min-h-0 overflow-y-auto p-3 flex flex-col gap-4">{children}</div>
    </section>
  )
}

function RosterSlot({
  character,
  active,
  on_pick,
}: Readonly<{
  character: SimCharacter | null
  active: boolean
  on_pick: () => void
}>) {
  const { t } = useTranslation()
  const row = character ? CLASS_ROWS.find(({ id }) => id === character.class_id) : null
  return (
    <button
      type="button"
      className="px-2 py-2 text-left cursor-pointer transition-colors"
      style={{
        border: active ? `1px solid ${GOLD}` : HAIRLINE,
        background: active ? 'rgba(200,150,60,0.08)' : 'rgba(0,0,0,0.18)',
      }}
      onClick={on_pick}
    >
      {character ? (
        <>
          <div className="text-[11px] truncate" style={{ color: active ? GOLD : '#e8e4dc' }}>
            {character.name}
          </div>
          <div className={`${micro} text-muted truncate`}>
            {t(`simulator.classes.${character.class_id.toUpperCase()}.display`, { defaultValue: row?.name ?? '—' })}
          </div>
          <div className={`${micro}`} style={{ color: GOLD, opacity: 0.7 }}>
            {t('simulator.level')} {character.level}
          </div>
        </>
      ) : (
        <div className="flex items-center gap-1 py-2 text-muted">
          <Plus size={12} />
          <span className={micro}>{t('simulator.new_character')}</span>
        </div>
      )}
    </button>
  )
}

function ClassGrid({ selected, on_pick }: Readonly<{ selected: string | null; on_pick: (class_id: string) => void }>) {
  const { t } = useTranslation()
  return (
    <div className="grid grid-cols-3 gap-1">
      {CLASS_ROWS.map((row) => {
        const active = row.id === selected
        return (
          <button
            key={row.id}
            type="button"
            className="px-2 py-1.5 text-left cursor-pointer transition-colors"
            style={{
              border: active ? `1px solid ${GOLD}` : HAIRLINE,
              background: active ? 'rgba(200,150,60,0.08)' : 'rgba(255,255,255,0.02)',
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

function CreatePanel({ on_cancel }: Readonly<{ on_cancel: () => void }>) {
  const { t } = useTranslation()
  const input = use_simulator((state) => state.input)
  const [class_id, set_class_id] = useState(CLASS_ROWS[0]?.id ?? '')
  const [name, set_name] = useState('')
  const [male, set_male] = useState(true)

  return (
    <>
      <div className="flex flex-col gap-2">
        <Label text={t('simulator.class')} />
        <ClassGrid selected={class_id} on_pick={set_class_id} />
      </div>
      <div className="flex flex-col gap-2">
        <Label text={t('simulator.name')} />
        <input
          className="template-input w-full"
          value={name}
          maxLength={24}
          placeholder={t('simulator.name')}
          onChange={(event) => set_name(event.target.value)}
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label text={t('simulator.appearance')} />
        <div className="flex gap-1">
          {[true, false].map((value) => (
            <button
              key={String(value)}
              type="button"
              className={`${micro} px-3 py-1.5 cursor-pointer`}
              style={{
                border: male === value ? `1px solid ${GOLD}` : HAIRLINE,
                color: male === value ? GOLD : undefined,
              }}
              onClick={() => set_male(value)}
            >
              {value ? t('simulator.male') : t('simulator.female')}
            </button>
          ))}
        </div>
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          className={`${micro} px-3 py-2 cursor-pointer`}
          style={{ border: `1px solid ${GOLD}`, color: GOLD, background: 'rgba(200,150,60,0.08)' }}
          onClick={() => {
            input({ type: 'character_added', class_id, name, male })
            on_cancel()
          }}
        >
          {t('simulator.create')}
        </button>
        <button
          type="button"
          className={`${micro} px-3 py-2 cursor-pointer text-muted`}
          style={{ border: HAIRLINE }}
          onClick={on_cancel}
        >
          {t('simulator.cancel')}
        </button>
      </div>
    </>
  )
}

function StatEditor({ character }: Readonly<{ character: SimCharacter }>) {
  const { t } = useTranslation()
  const input = use_simulator((state) => state.input)
  const budget = stat_budget(character.level)
  const left = budget - stats_spent(character)

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between">
        <Label text={t('simulator.stats')} />
        <div className="flex items-center gap-2">
          <span className={micro} style={{ color: left > 0 ? GOLD : '#6b7280' }}>
            {t('simulator.points_left', { left, total: budget })}
          </span>
          <button
            type="button"
            className="cursor-pointer text-muted hover:text-white"
            title={t('simulator.reset')}
            onClick={() => input({ type: 'stats_reset', id: character.id })}
          >
            <RotateCcw size={11} />
          </button>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-1">
        {SIM_STATS.map((stat: SimStat) => (
          <div key={stat} className="flex items-center gap-1 px-2 py-1" style={{ border: HAIRLINE }}>
            <span className={`${micro} flex-1 truncate`} style={{ color: STAT_COLORS[stat] }}>
              {stat_label(t, stat)}
            </span>
            <input
              type="number"
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

function SpellEditor({ character }: Readonly<{ character: SimCharacter }>) {
  const { t } = useTranslation()
  const input = use_simulator((state) => state.input)
  const rows = useMemo(() => spell_rows(character.class_id, character.level), [character.class_id, character.level])
  const budget = spell_budget(character.level)
  const left = budget - spells_spent(character)

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between">
        <Label text={t('simulator.spells')} />
        <div className="flex items-center gap-2">
          <span className={micro} style={{ color: left > 0 ? GOLD : '#6b7280' }}>
            {t('simulator.points_left', { left, total: budget })}
          </span>
          <button
            type="button"
            className="cursor-pointer text-muted hover:text-white"
            title={t('simulator.reset')}
            onClick={() => input({ type: 'spells_reset', id: character.id })}
          >
            <RotateCcw size={11} />
          </button>
        </div>
      </div>
      {rows.length === 0 && <span className={`${micro} text-muted`}>{t('simulator.spells_unavailable')}</span>}
      {rows.map((row) => {
        const level = character.spell_levels[row.key] ?? 1
        return (
          <div key={row.key} className="flex items-center gap-2 px-2 py-1" style={{ border: HAIRLINE }}>
            <span className="text-[10px] flex-1 truncate">
              {t(`spells.spell_${row.key}`, { defaultValue: row.name })}
            </span>
            <span className={`${micro} text-muted`}>{t('simulator.spell_cost', { cost: spell_cost(level) })}</span>
            <input
              type="number"
              className="template-input w-14 text-right"
              value={level}
              min={1}
              max={row.max_level}
              onChange={(event) =>
                input({
                  type: 'spell_level_set',
                  id: character.id,
                  spell_id: row.key,
                  level: Number(event.target.value),
                  max_level: row.max_level,
                })
              }
            />
          </div>
        )
      })}
    </div>
  )
}

function Inspector({ character }: Readonly<{ character: SimCharacter }>) {
  const { t } = useTranslation()
  const input = use_simulator((state) => state.input)
  const [confirming, set_confirming] = useState(false)

  return (
    <>
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <Label text={t('simulator.name')} />
          <button
            type="button"
            className={`${micro} flex items-center gap-1 cursor-pointer`}
            style={{ color: confirming ? '#ff5f5f' : undefined }}
            onClick={() => (confirming ? input({ type: 'character_removed', id: character.id }) : set_confirming(true))}
          >
            <Trash2 size={11} />
            {confirming ? t('simulator.delete_confirm') : t('simulator.delete')}
          </button>
        </div>
        <input
          className="template-input w-full"
          value={character.name}
          maxLength={24}
          onChange={(event) => input({ type: 'character_named', id: character.id, name: event.target.value })}
        />
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

      <div className="flex items-end gap-3">
        <div className="flex flex-col gap-2">
          <Label text={t('simulator.level')} />
          <input
            type="number"
            className="template-input w-20"
            value={character.level}
            min={1}
            max={MAX_LEVEL}
            onChange={(event) => input({ type: 'level_set', id: character.id, level: Number(event.target.value) })}
          />
        </div>
        <div className="flex gap-1 pb-1">
          {[true, false].map((value) => (
            <button
              key={String(value)}
              type="button"
              className={`${micro} px-3 py-1.5 cursor-pointer`}
              style={{
                border: character.male === value ? `1px solid ${GOLD}` : HAIRLINE,
                color: character.male === value ? GOLD : undefined,
              }}
              onClick={() => input({ type: 'character_sex_set', id: character.id, male: value })}
            >
              {value ? t('simulator.male') : t('simulator.female')}
            </button>
          ))}
        </div>
      </div>

      <StatEditor character={character} />
      <SpellEditor character={character} />
    </>
  )
}

export function SimulatorPage() {
  const { t } = useTranslation()
  const roster = use_simulator((state) => state.roster)
  const focus_id = use_simulator((state) => state.focus_id)
  const seed = use_simulator((state) => state.seed)
  const input = use_simulator((state) => state.input)
  const [creating, set_creating] = useState(false)

  // ONE boot per mount: IndexedDB is read at the edge and re-enters as the `hydrated` input; the disposer
  // flushes whatever is still debounced when the page unmounts.
  useEffect(() => {
    const booted = boot_simulator()
    return () => void booted.then((dispose) => dispose())
  }, [])

  const focused = roster.find(({ id }) => id === focus_id) ?? null
  const slots = Array.from({ length: MAX_ROSTER }, (_, index) => roster[index] ?? null)

  return (
    <div className="flex flex-col gap-2 p-2 lg:p-3 lg:pt-14 h-full min-h-0">
      {/* TOP BAR */}
      <div className="flex flex-wrap items-center gap-4 px-3 py-2" style={{ border: HAIRLINE, background: PANE_FILL }}>
        <span className="text-[11px] tracking-[0.3em] uppercase" style={{ color: GOLD }}>
          {t('simulator.title')}
        </span>
        <div className="flex items-center gap-2">
          <Label text={t('simulator.seed')} />
          <span className="text-[11px]" style={{ color: '#e8e4dc' }}>
            {seed.toString(16).padStart(8, '0')}
          </span>
          <button
            type="button"
            className="cursor-pointer text-muted hover:text-white"
            title={t('simulator.reroll')}
            onClick={() => input({ type: 'seed_set', seed: Math.floor(Math.random() * 0xffffffff) })}
          >
            <Dices size={13} />
          </button>
        </div>
        <div className="flex items-center gap-2">
          <Label text={t('simulator.roster')} />
          <span className="text-[11px]" style={{ color: '#e8e4dc' }}>
            {roster.length}/{MAX_ROSTER}
          </span>
        </div>
      </div>

      {/* THREE PANES */}
      <div className="flex-1 min-h-0 grid gap-2 grid-cols-1 lg:grid-cols-[220px_1fr_340px]">
        <Pane title={t('simulator.roster')}>
          <div className="grid grid-cols-2 lg:grid-cols-1 gap-1">
            {slots.map((character, index) => (
              <RosterSlot
                key={character?.id ?? `empty_${index}`}
                character={character}
                active={!creating && character !== null && character.id === focus_id}
                on_pick={() => {
                  if (character) {
                    set_creating(false)
                    input({ type: 'focus_set', id: character.id })
                  } else set_creating(true)
                }}
              />
            ))}
          </div>
        </Pane>

        {/* The board viewport's region — honestly empty until the board lane mounts the engine here. */}
        <Pane title={t('simulator.board')} className="min-h-[220px]">
          <div className="flex-1 flex items-center justify-center">
            <span className={`${micro} text-muted`} style={{ opacity: 0.5 }}>
              {t('simulator.board_pending')}
            </span>
          </div>
        </Pane>

        <Pane title={creating ? t('simulator.new_character') : t('simulator.inspector')}>
          {creating ? (
            <CreatePanel on_cancel={() => set_creating(false)} />
          ) : focused ? (
            <Inspector key={focused.id} character={focused} />
          ) : (
            <div className="flex flex-col items-start gap-3">
              <span className={`${micro} text-muted`}>{t('simulator.no_selection')}</span>
              <button
                type="button"
                className={`${micro} flex items-center gap-1 px-3 py-2 cursor-pointer`}
                style={{ border: `1px solid ${GOLD}`, color: GOLD }}
                onClick={() => set_creating(true)}
              >
                <Plus size={12} />
                {t('simulator.new_character')}
              </button>
            </div>
          )}
        </Pane>
      </div>
    </div>
  )
}
