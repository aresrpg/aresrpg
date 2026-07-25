// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// SPELL ROW — the ONE home for "what one spell looks like in a list": its art tile, its i18n-first name, its
// element·kind subline, and a trailing control slot.
//
// Extracted VERBATIM out of Spellbook.jsx (the grimoire), which now re-composes it. The no-divergence law is
// the reason: the simulator's build editor lists the same class spells off the same `grimoire()` projection
// and must render them identically — a local lookalike would be a second truth about what a spell row is.
// The trailing slot is what genuinely differs (the grimoire shows a level badge / lock chip, the simulator a
// level dropdown), so it is a prop, not a fork.
//
// Presentation only: no store, no chain read — it mounts anywhere with a projected row.

import { useState } from 'react'

import { spell_icon_url } from '@aresrpg/sdk/jobs'

import { Tooltip } from './Tooltip.jsx'
import './spellbook.css'

/** i18n-first spell copy with the on-chain string as the honest fallback (the fight lane's spell_card rule);
 *  a missing key + no fallback renders NOTHING (suffix keys like `_desc` never show a raw slug). */
export const spell_copy = (
  /** @type {any} */ t,
  /** @type {string} */ name_key,
  /** @type {string} */ suffix = '',
  /** @type {string | null} */ fallback = null
) => {
  const key = `spells.spell_${name_key}${suffix}`
  const translated = t(key)
  return translated === key ? fallback : translated
}

/** Spell art tile with a graceful element-tinted fallback (only ~24 seeded spells carry CDN art). */
export function SpellIcon({ icon, color, name, cls = 'sb__ic' }) {
  const [failed, set_failed] = useState(false)
  const url = failed ? null : spell_icon_url(icon)
  if (!url)
    return (
      <span
        className={`${cls} sb__art--fallback`}
        style={/** @type {import('react').CSSProperties} */ ({ '--el': color })}
        aria-hidden="true"
      >
        {(name || '?').slice(0, 1).toUpperCase()}
      </span>
    )
  return <img className={cls} src={url} alt="" draggable={false} onError={() => set_failed(true)} />
}

/**
 * One spell row: art · name + subline · the caller's trailing control.
 *
 * `on_click` makes the row a <button> (the grimoire's select-a-spell affordance); WITHOUT it the row is a
 * plain <div>, which is what a row carrying its own interactive control (a <select>) requires — a form
 * control nested in a button is neither valid HTML nor operable.
 * `tip` wraps the row in the house Tooltip so hovering shows the full spell detail card.
 * `dense` is the LIST-density knob: smaller art and the subline inline after the name, so a whole class
 * (~20 spells) fits a screen instead of demanding three of them. Nothing is dropped — the same three facts
 * are on one line instead of two, and the hover card still carries the full detail.
 *
 * @param {{ row: { icon: string, color: string, name_key: string }, name: string, subline: string,
 *   selected?: boolean, locked?: boolean, dense?: boolean, on_click?: () => void,
 *   right?: import('react').ReactNode, tip?: import('react').ReactNode }} props
 */
export function SpellRow({
  row,
  name,
  subline,
  selected = false,
  locked = false,
  dense = false,
  on_click,
  right = null,
  tip = null,
}) {
  const className = `sb__row${dense ? ' sb__row--dense' : ''}${selected ? ' is-sel' : ''}${
    locked ? ' is-locked' : ''
  }`
  const style = /** @type {import('react').CSSProperties} */ ({ '--el': row.color })
  const body = (
    <>
      <SpellIcon icon={row.icon} color={row.color} name={name} cls="sb__ic" />
      <span className="sb__meta">
        <span className="sb__nm">{name}</span>
        <span className="sb__rl">{subline}</span>
      </span>
      <span className="sb__right">{right}</span>
    </>
  )
  const element = on_click ? (
    <button type="button" onClick={on_click} className={className} style={style} data-spell-row={row.name_key}>
      {body}
    </button>
  ) : (
    <div className={className} style={style} data-spell-row={row.name_key}>
      {body}
    </div>
  )
  return tip ? (
    <Tooltip content={tip} className="tt-card--spell" placement="top">
      {element}
    </Tooltip>
  ) : (
    element
  )
}
