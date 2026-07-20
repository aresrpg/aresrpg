// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// EFFECT BADGES — compact persistent-effect chips for every fight nameplate: a cast persistent effect
// must show in its target's nametag, naming the effect and how many turns remain — every
// persistent effect renders in the nametag, compact but intuitive. Own + enemy + peer fighters
// all render the same chips — chain truth is public, nothing here reads whose turn it is.
//
// DATA SOURCE (BLOCKED-COORDINATE at ship time — see the lane return): packages/fight's engine_view fighters
// projection currently exposes only a boolean `invisible` (project.js:343/368), folded from a single-kind
// decode (fight_status_snapshot.js hardcodes INVISIBILITY_STATUS_KIND=27 and drops every other status row —
// the chain's Fight.fx.statuses / spell_board::FighterStatus{fighter,kind,effect,remaining_turns,source} is
// already generic). This component takes the general shape that getter needs to grow into: `effects` is an
// array of raw per-fighter status rows `{ id, kind, remaining_turns, element?, value?, stat?, chance? }` —
// undecoded chain ints, same convention project.js already uses for `element` on mobs. Until the getter merges,
// `effects` is simply absent on every fighter and this renders nothing (verified below) — the wire-up the
// moment it lands is the one-line `f.effects` prop pass in FightTimeline.jsx.
//
// DECODE REUSE (one grammar, zero drift): `project_spell_effect` (fight-spells.js) turns the raw ints into the
// SAME display shape the grimoire/armed-readout already use; `seed_effect_line` (seed-effect-line.js) turns
// that + a turns count into the exact localized sentence spell-coverage.test.js already locks — reused
// verbatim for the hover tooltip, never a second copy of the fx_* grammar.

import { useTranslation } from 'react-i18next'

import './effect-badges.css'
import { Tooltip } from './Tooltip.jsx'
import { project_spell_effect } from './fight-spells.js'
import { seed_effect_line } from './seed-effect-line.js'

// Chips beyond this collapse into one "+N" tile — a compact row never grows unbounded (a stacked-debuff mob
// could otherwise carry a dozen rows).
const MAX_VISIBLE = 4

// kind (decoded string, project_spell_effect) → a 2-3 letter mono glyph — NO invented art, text only, matching
// the tiny uppercase mono-chip house language. Curated for the full spell_effect.move taxonomy so no two kinds
// that could plausibly coexist on one fighter (e.g. REDUCE_DAMAGE vs REFLECT_DAMAGE — two different ward
// shapes) collide on the same 3 letters; an unmapped FUTURE kind (a reseed) falls back to its own first 3
// characters so a new kind never renders blank.
const GLYPH = {
  DAMAGE: 'DMG',
  PERCENT_LIFE: 'PCT',
  LIFE_STEAL: 'LFS',
  CASTER_DAMAGE: 'REC',
  PUNISHMENT: 'PUN',
  HEAL: 'HEA',
  GIVE_POINTS: 'GIV',
  REMOVE_POINTS: 'RMV',
  STEAL_POINTS: 'STP',
  ALTER_STAT: 'ALT',
  STEAL_STAT: 'STL',
  ALTER_RESIST: 'RES',
  PUSH: 'PSH',
  PULL: 'PLL',
  TELEPORT: 'TLP',
  SWAP: 'SWP',
  CARRY: 'CRY',
  THROW: 'THR',
  PLACE_TRAP: 'TRP',
  PLACE_GLYPH: 'GLY',
  APPLY_DOT: 'DOT',
  APPLY_STATE: 'STA',
  REMOVE_STATE: 'CLR',
  REDUCE_DAMAGE: 'ABS',
  REFLECT_DAMAGE: 'RFL',
  DISPEL: 'DSP',
  INVISIBILITY: 'INV',
  REVEAL: 'REV',
  RETURN_SPELL: 'RTN',
}
const glyph_of = (kind) => GLYPH[kind] ?? String(kind).slice(0, 3).toUpperCase()

/**
 * One raw per-fighter status row → its chip view model. Pure — no JSX, so it's directly unit-testable and
 * reusable if a second surface ever needs the same chip (grimoire-style detail popover, etc.).
 * @param {(key: string, params?: object) => string} t
 * @param {{ id?: string | number, kind: number, remaining_turns: number, element?: number, value?: number,
 *   stat?: number, chance?: number, source?: number }} raw
 */
export const effect_badge_view = (t, raw) => {
  const fx = project_spell_effect(raw)
  const turns = Math.max(0, Number(raw.remaining_turns) || 0)
  return {
    id: raw.id ?? `${raw.kind}-${raw.source ?? 0}`,
    glyph: glyph_of(fx.kind),
    turns,
    label: seed_effect_line(t, { ...fx, turns }),
  }
}

/**
 * The compact chip row for one fighter's active persistent effects. Renders nothing (no empty container) when
 * there are none — including the common today-at-HEAD case where `effects` is absent entirely.
 * @param {{ effects?: Array<{ id?: string | number, kind: number, remaining_turns: number }> }} props
 */
export function EffectBadges({ effects }) {
  const { t } = useTranslation()
  const active = (effects ?? []).filter((row) => (Number(row?.remaining_turns) || 0) > 0)
  if (active.length === 0) return null

  const shown = active.slice(0, MAX_VISIBLE)
  const overflow = active.length - shown.length

  return (
    <div className="hud-effects">
      {shown.map((raw) => {
        const view = effect_badge_view(t, raw)
        return (
          <Tooltip key={view.id} text={view.label}>
            <span className="hud-effect">
              <span className="hud-effect__glyph">{view.glyph}</span>
              <span className="hud-effect__turns hud-num">{view.turns}</span>
            </span>
          </Tooltip>
        )
      })}
      {overflow > 0 && (
        <span className="hud-effect hud-effect--more" aria-hidden="true">
          +{overflow}
        </span>
      )}
    </div>
  )
}
