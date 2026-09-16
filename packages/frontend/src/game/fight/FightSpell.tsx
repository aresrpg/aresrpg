// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { useText } from '../../i18n/useText.ts'
// Browser-only spell presentation. Keeping seed assets behind this lazy boundary preserves the pure app shell.

import { item_icon, spell_icon } from '../../content/assets.ts'
import { SpellCard } from '../../encyclopedia/SpellCard.tsx'
import { useState, type FocusEvent, type ReactNode } from 'react'

import type { FightSpellView } from './fight_projection.ts'

const card_element = (element: string): '' | 'earth' | 'fire' | 'water' | 'air' =>
  element === 'earth' || element === 'fire' || element === 'water' || element === 'air' ? element : ''
const displayed_name = (identity: string, display_name: string | undefined): string => display_name ?? identity
const displays_critical = (spell: Readonly<FightSpellView>, disabled: boolean): boolean =>
  spell.turn?.critical === true && spell.details.crit_effects.length > 0 && !disabled

const number_effect = (effect: Readonly<FightSpellView['details']['effects'][number]>) =>
  Object.freeze({
    kind: Number(effect.kind),
    element: card_element(effect.element),
    value: Number(effect.value),
    value_max: Number(effect.value_max),
    area_shape: Number(effect.area_shape),
    area_size: Number(effect.area_size),
    target_filter: Number(effect.target_filter),
    chance_bp: Number(effect.chance_bp),
    turns: Number(effect.turns),
    stat: Number(effect.stat),
  })

const number_level = (
  level: Readonly<FightSpellView['details']>,
  effects: Readonly<FightSpellView['details']['effects']> = level.effects,
  crit_1_in: bigint = level.crit_1_in
) =>
  Object.freeze({
    ap_cost: Number(level.ap_cost),
    range_min: Number(level.range_min),
    range_max: Number(level.range_max),
    modifiable_range: level.modifiable_range,
    line_of_sight: level.line_of_sight,
    line_launch: level.line_launch,
    free_cell: level.free_cell,
    casts_per_turn: Number(level.casts_per_turn),
    casts_per_target: Number(level.casts_per_target),
    cooldown_turns: Number(level.cooldown_turns),
    crit_1_in: Number(crit_1_in),
    effects: Object.freeze(effects.map(number_effect)),
    crit_effects: Object.freeze([]),
  })

export const fight_spell_detail = (spell: Readonly<FightSpellView>) => {
  const invested_index = Number(spell.level - 1n)
  return Object.freeze({
    name: spell.name,
    classe: spell.source.classe,
    unlock_level: Number(spell.source.unlock_level),
    levels: Object.freeze(
      spell.source.levels.map((level, index) =>
        index === invested_index && spell.turn
          ? number_level(level, spell.turn.effects, spell.turn.crit_1_in)
          : number_level(level)
      )
    ),
  })
}

const FightActionIcon = ({
  spell,
  item_type,
  name,
  fallback,
}: Readonly<{ spell: FightSpellView; item_type?: string; name: string; fallback?: ReactNode }>) => {
  const icon = item_type ? item_icon(item_type) : spell_icon(spell.source.classe, spell.name)
  return icon ? (
    <img alt="" data-item-type={item_type} draggable={false} src={icon} />
  ) : (
    <span>{fallback ?? name.slice(0, 1).toUpperCase()}</span>
  )
}

export const FightSpell = ({
  spell,
  disabled,
  selected,
  select,
  fallback_icon,
  item_type,
  display_name,
}: Readonly<{
  spell: FightSpellView
  disabled: boolean
  selected: boolean
  select: () => void
  fallback_icon?: ReactNode
  item_type?: string
  display_name?: string
}>) => {
  const ui = useText()
  const [detail_open, set_detail_open] = useState(false)
  const name = displayed_name(spell.name, display_name)
  const detail = fight_spell_detail(spell)
  const critical = displays_critical(spell, disabled)
  const close_focus = (event: Readonly<FocusEvent<HTMLDivElement>>): void => {
    if (event.relatedTarget && event.currentTarget.contains(event.relatedTarget)) return
    set_detail_open(false)
  }
  return (
    <div
      className={`fight-hud__spell-shell${critical ? ' critical' : ''}`}
      onBlur={close_focus}
      onFocus={() => set_detail_open(true)}
      onMouseEnter={() => set_detail_open(true)}
      onMouseLeave={() => set_detail_open(false)}
    >
      <button
        aria-label={ui('ui.spell_action', {
          name,
          level: String(spell.level),
          cost: String(spell.details.ap_cost),
          unit: ui('fight_hud.unit_ap'),
        })}
        aria-pressed={selected}
        className={`fight-hud__spell${disabled ? ' disabled' : ''}${selected ? ' selected' : ''}${critical ? ' critical' : ''}`}
        data-turn-critical={critical || undefined}
        disabled={disabled}
        onClick={select}
        type="button"
      >
        <FightActionIcon spell={spell} item_type={item_type} name={name} fallback={fallback_icon} />
        <b>{spell.details.ap_cost.toString()}</b>
        {spell.cooldown > 0n && <em className="fight-hud__spell-cooldown">{spell.cooldown.toString()}</em>}
      </button>
      {detail_open && (
        <div className="fight-hud__spell-detail fight-hud__spell-detail--small">
          <SpellCard
            display_name={name}
            initial_level={Number(spell.level)}
            key={`${spell.name}:${spell.level}`}
            small
            spell={detail}
          />
        </div>
      )}
    </div>
  )
}
