// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// ACTIVE EFFECT ROWS — the shared visible reading of every fighter's presented persistent effects. The board
// hover and turn card both render these same compact rows: localized effect name/value + remaining turns. Own +
// enemy + peer fighters use the same projection — chain truth is public, nothing here reads whose turn it is.
//
// DATA SOURCE (#301 — the coordinate is MERGED): packages/fight's engine_view fighters projection exposes the
// full per-fighter status list (project.js `effects_of`, LEG Q) — the chain's Fight.fx.statuses /
// spell_board::FighterStatus{fighter,kind,effect,remaining_turns,source} decoded generically end to end
// (fight_status_snapshot.js → board_state.js → fold.js `statuses` → project.js `f.effects`). `effects` is an
// array of raw per-fighter status rows `{ id, kind, remaining_turns, element?, value?, stat?, chance? }` —
// undecoded chain ints, same convention project.js already uses for `element` on mobs.
//
// DECODE REUSE (one grammar, zero drift): `project_spell_effect` (fight-spells.js) turns the raw ints into the
// SAME display shape the grimoire/armed-readout already use; `seed_effect_parts` + `EffectLine` are the existing
// localized row grammar. Remaining duration is appended from `remaining_turns` for every live status, whatever
// its kind — an active projection row must always say how long it remains.

import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import './effect-badges.css'
import { spell_state_name_resolver } from '../../data/spell-text.js'
import { use_spell_corpus } from '../../data/use_spell_corpus.js'
import { EffectLine } from './EffectLine.jsx'
import { project_spell_effect } from './fight-spells.js'
import { seed_effect_line, seed_effect_parts } from './seed-effect-line.js'

/**
 * One raw per-fighter status row → its visible row model. Pure — no JSX, so projection-to-render tests can pin
 * the exact localized reading. Active damage-over-time rows carry a resolved value rather than an authored range;
 * mapping that value to equal bounds lets the shared damage grammar print the real magnitude instead of an em dash.
 * @param {(key: string, params?: object) => string} t
 * @param {{ id?: string | number, kind: number, remaining_turns: number, element?: number, value?: number,
 *   stat?: number, chance?: number, source?: number }} raw
 */
export const effect_badge_view = (t, raw, { locale = 'en', resolve_state_name } = {}) => {
  // DISPLAY LAW (#2000, D42) — the reference client renders the counter raw and a LIVE row never displays
  // zero. Our counter is the bearer's turns STILL TO COME, so a 0 is a row on its last covered turn: with the
  // lifecycle collecting spent rows at the bearer's turn END, a 0 reaches this view only during that final
  // turn, and reads 1. Floor, never a blanket +1 — a freshly cast 2-turn row must still read 2, not 3.
  const turns = Math.max(1, Number(raw.remaining_turns) || 0)
  const resolved_value = raw.value == null ? null : Number(raw.value)
  const fx = project_spell_effect({
    ...raw,
    turns: 0,
    ...(Number.isFinite(resolved_value) ? { damageMin: resolved_value, damageMax: resolved_value } : {}),
  })
  const duration = t('spells.fx_turns', { count: turns })
  const base_view = seed_effect_parts(t, fx, { locale, resolve_state_name })
  const view = { ...base_view, meta: [base_view.meta, duration].filter(Boolean).join(' · ') }
  return {
    id: raw.id ?? `${raw.kind}-${raw.source ?? 0}`,
    turns,
    label: `${seed_effect_line(t, fx, { locale, resolve_state_name })} · ${duration}`,
    view,
  }
}

/**
 * Shared compact effect rows for a fighter. `t` is injected so TooltipCard stays a pure-props renderer; the turn
 * card's EffectBadges wrapper supplies the hook-owned translator below.
 *
 * EVERY row it is handed gets a badge (#2000, D42): `remaining_turns` counts the bearer's turns STILL TO COME, so
 * a 0 is a row on its LAST covered turn — live on chain, kept by the fold's `age_statuses`, priced by the
 * prediction — and the lifetime the family pins renders 3 → 2 → 1 → 0. Expiry is upstream's call, made by
 * REMOVING the row; a `> 0` filter here hid a buff on the one turn a player most needs to see it.
 * @param {{ effects?: Array<{ id?: string | number, kind: number, remaining_turns: number }>,
 *   t: (key:string, params?:object) => string }} props
 */
export function ActiveEffectRows({ effects, t, locale = 'en', resolve_state_name }) {
  const rows = (effects ?? []).map((row) => effect_badge_view(t, row, { locale, resolve_state_name }))
  if (rows.length === 0) return null

  return (
    <div className="hud-effects" aria-label={t('spells.effects')}>
      {rows.map((row) => (
        <EffectLine key={row.id} view={row.view} />
      ))}
    </div>
  )
}

/** Turn-card adapter: hook at the component edge, pure shared rows beneath it. */
export function EffectBadges({ effects }) {
  const { t, i18n } = useTranslation()
  const corpus = use_spell_corpus()
  const locale = i18n.resolvedLanguage || i18n.language || 'en'
  const resolve_state_name = useMemo(() => spell_state_name_resolver(corpus, locale), [corpus, locale])
  return <ActiveEffectRows effects={effects} t={t} locale={locale} resolve_state_name={resolve_state_name} />
}
