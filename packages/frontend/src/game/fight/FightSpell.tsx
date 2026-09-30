// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { useText } from '../../i18n/useText.ts'
// Browser-only spell presentation. Keeping seed assets behind this lazy boundary preserves the pure app shell.

import { item_icon, spell_icon } from '../../content/assets.ts'
import { EffectLines } from '../../encyclopedia/SpellCardEffects.tsx'
import { useEffect, useId, useLayoutEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

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

/** The fight projection already resolves this turn's normal/critical branch and rolls. */
export const fight_spell_effects = (spell: Readonly<FightSpellView>) =>
  Object.freeze((spell.turn?.effects ?? spell.details.effects).map(number_effect))

export const FightSpellEffects = ({ spell, name }: Readonly<{ spell: FightSpellView; name: string }>) => (
  <div className="fight-spell-preview" data-fight-spell-effects="">
    <strong>{name}</strong>
    <EffectLines
      compact
      effects={fight_spell_effects(spell)}
      critical_effects={[]}
      level_index={Number(spell.level - 1n)}
    />
  </div>
)

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
  const tooltip_id = useId()
  const [detail_open, set_detail_open] = useState(false)
  const tooltip = useRef<HTMLDivElement>(null)
  const anchor = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!detail_open) return
    const dismiss_outside = (event: Readonly<Event>): void => {
      if (event.composedPath().some((target) => target === anchor.current || target === tooltip.current)) return
      set_detail_open(false)
    }
    document.addEventListener('pointerdown', dismiss_outside, true)
    document.addEventListener('focusin', dismiss_outside, true)
    return () => {
      document.removeEventListener('pointerdown', dismiss_outside, true)
      document.removeEventListener('focusin', dismiss_outside, true)
    }
  }, [detail_open])
  useLayoutEffect(() => {
    const element = tooltip.current
    if (!element) return
    const place = (): void => {
      const origin = anchor.current!.getBoundingClientRect()
      const { width, height } = element.getBoundingClientRect()
      const x = Math.max(8, Math.min(globalThis.innerWidth - width - 8, origin.left + origin.width / 2 - width / 2))
      const y = Math.max(8, Math.min(globalThis.innerHeight - height - 8, origin.top - height - 12))
      element.style.setProperty('left', `${x}px`)
      element.style.setProperty('top', `${y}px`)
    }
    const observer = new ResizeObserver(place)
    observer.observe(element)
    globalThis.addEventListener('resize', place)
    place()
    return () => {
      observer.disconnect()
      globalThis.removeEventListener('resize', place)
    }
  }, [detail_open])
  const name = displayed_name(spell.name, display_name)
  const critical = displays_critical(spell, disabled)
  const critical_class = critical ? ' critical' : ''
  const close_hover = (event: Readonly<MouseEvent<HTMLDivElement>>): void => {
    const target = event.relatedTarget
    if (target instanceof Node && (anchor.current?.contains(target) || tooltip.current?.contains(target))) return
    set_detail_open(false)
  }
  return (
    <div
      ref={anchor}
      className={`fight-hud__spell-shell${critical_class}`}
      onFocus={() => set_detail_open(true)}
      onPointerDown={() => set_detail_open(true)}
      onMouseEnter={() => set_detail_open(true)}
      onMouseLeave={close_hover}
    >
      <button
        aria-label={ui('ui.spell_action', {
          name,
          level: String(spell.level),
          cost: String(spell.details.ap_cost),
          unit: ui('fight_hud.unit_ap'),
        })}
        aria-pressed={selected}
        aria-describedby={detail_open ? tooltip_id : undefined}
        className={`fight-hud__spell${disabled ? ' disabled' : ''}${selected ? ' selected' : ''}${critical_class}`}
        data-turn-critical={critical || undefined}
        disabled={disabled}
        onClick={select}
        type="button"
      >
        <FightActionIcon spell={spell} item_type={item_type} name={name} fallback={fallback_icon} />
        <b>{spell.details.ap_cost.toString()}</b>
        {spell.cooldown > 0n && <em className="fight-hud__spell-cooldown">{spell.cooldown.toString()}</em>}
      </button>
      {detail_open &&
        createPortal(
          <div
            ref={tooltip}
            id={tooltip_id}
            role="tooltip"
            onMouseLeave={close_hover}
            className={`fight-hud__spell-detail fight-hud__spell-detail--small${critical_class}`}
          >
            <FightSpellEffects spell={spell} name={name} />
          </div>,
          document.body
        )}
    </div>
  )
}
