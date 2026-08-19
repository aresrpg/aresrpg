// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Browser-only spell presentation. Keeping seed assets behind this lazy boundary preserves the pure app shell.

import { spell_icon } from '../../content/assets.ts'
import { SpellCard } from '../../encyclopedia/SpellCard.tsx'
import { useState, type FocusEvent, type ReactNode } from 'react'

import type { FightSpellView } from './fight_projection.ts'

const card_element = (element: string): '' | 'earth' | 'fire' | 'water' | 'air' =>
  element === 'earth' || element === 'fire' || element === 'water' || element === 'air' ? element : ''

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
  crit_effects: Readonly<FightSpellView['details']['effects']> = level.crit_effects,
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
    crit_effects: Object.freeze(crit_effects.map(number_effect)),
  })

export const fight_spell_detail = (spell: Readonly<FightSpellView>) => {
  const invested_index = Number(spell.level - 1n)
  const resolved_effects = spell.turn?.effects.filter(({ critical_only }) => !critical_only)
  const resolved_critical_effects = spell.turn?.critical ? spell.turn.effects : Object.freeze([])
  return Object.freeze({
    name: spell.name,
    classe: spell.source.classe,
    unlock_level: Number(spell.source.unlock_level),
    levels: Object.freeze(
      spell.source.levels.map((level, index) =>
        index === invested_index && spell.turn
          ? number_level(level, resolved_effects, resolved_critical_effects, spell.turn.crit_1_in)
          : number_level(level, level.effects, Object.freeze([]))
      )
    ),
  })
}

export const FightSpell = ({
  spell,
  disabled,
  selected,
  select,
  fallback_icon,
}: Readonly<{
  spell: FightSpellView
  disabled: boolean
  selected: boolean
  select: () => void
  fallback_icon?: ReactNode
}>) => {
  const [detail_open, set_detail_open] = useState(false)
  const icon = spell_icon(spell.source.classe, spell.name)
  const detail = fight_spell_detail(spell)
  const critical = spell.turn?.critical === true && !disabled
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
        aria-label={`${spell.name}, level ${spell.level}, ${spell.details.ap_cost} AP`}
        aria-pressed={selected}
        className={`fight-hud__spell${disabled ? ' disabled' : ''}${selected ? ' selected' : ''}${critical ? ' critical' : ''}`}
        data-turn-critical={critical || undefined}
        disabled={disabled}
        onClick={select}
        type="button"
      >
        {icon ? (
          <img alt="" draggable={false} src={icon} />
        ) : (
          <span>{fallback_icon ?? spell.name.slice(0, 1).toUpperCase()}</span>
        )}
        <b>{spell.details.ap_cost.toString()}</b>
        {spell.cooldown > 0n && <em className="fight-hud__spell-cooldown">{spell.cooldown.toString()}</em>}
      </button>
      {detail_open && (
        <div className="fight-hud__spell-detail fight-hud__spell-detail--small">
          <SpellCard initial_level={Number(spell.level)} key={`${spell.name}:${spell.level}`} small spell={detail} />
        </div>
      )}
    </div>
  )
}
