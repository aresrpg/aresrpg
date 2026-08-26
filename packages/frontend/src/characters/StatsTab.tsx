// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// STATS — the canon character sheet, markup and classes ported from the proven Stats panel
// (stats.css + the .stats__ half of hud-panels.css, verbatim): hero header with the xp bar,
// the points capital with Reset/Confirm, the health/AP/MP vitals, the six characteristic
// rows with +/- steppers, the element-coloured resistance shields, and the secondary rows.
// Only the wiring is new: chain truth arrives on the CharacterRow, staging is local, and
// Confirm composes ONE raise_stats transaction whose proven receipt folds in the reducer.

import { useState } from 'react'
import {
  characteristic_allocation_quote,
  characteristic_cost_step,
  characteristic_names,
  experience_progress,
  is_class_name,
  type CharacteristicName,
  type CharacteristicValues,
} from '@aresrpg/immutable'
import type { CharacterRow } from '@aresrpg/protocol'

import action_icon from '../assets/statistics/action.png'
import health_icon from '../assets/statistics/health.png'
import movement_icon from '../assets/statistics/movement.png'
import { StatIdentity } from '../components/StatIdentity.tsx'
import { titleize } from '../content/catalog.ts'
import { stat_identities } from '../visual_identity.ts'
import {
  action_points,
  character_max_hp,
  equipment_bonus,
  movement_points,
  projected_hp,
} from '../game/character_stats.ts'
import { copy_text, type AppCopy } from '../i18n/copy.ts'
import { dispatch_app, useAppStore } from '../store.ts'
import { toast } from '../toast.ts'

import './stats.css'
import './stats_panels.css'

/** Fire / Water / Earth / Air — the canon shield order and colours. */
const RESISTANCES = [
  { stat: 'fire_resistance', element: 'fire', color: '#ef5350' },
  { stat: 'water_resistance', element: 'water', color: '#42a5f5' },
  { stat: 'earth_resistance', element: 'earth', color: '#c9905a' },
  { stat: 'air_resistance', element: 'air', color: '#66bb6a' },
] as const

/** The canon secondary rows (allow-list): critical + raw damage. */
const SECONDARY = [
  { stat: 'critical', label_key: 'stat.critical_hit', desc_key: 'stats.description.critical_hit', tint: '#ffb454' },
  { stat: 'raw_damage', label_key: 'stat.raw_damage', desc_key: 'stats.description.raw_damage', tint: '#ef5350' },
] as const

const empty_allocation = (): Record<CharacteristicName, number> =>
  Object.fromEntries(characteristic_names.map((stat) => [stat, 0])) as Record<CharacteristicName, number>

const bar_pct = (value: number): number => Math.max(0, Math.min(100, value))

export default function StatsTab({ character, copy }: Readonly<{ character: Readonly<CharacterRow>; copy: AppCopy }>) {
  const t = copy_text(copy.characters_page)
  const wallet = useAppStore(({ session }) => session.wallet)
  const [alloc, set_alloc] = useState(empty_allocation)
  const [pending_tx, set_pending_tx] = useState(false)

  const classe = is_class_name(character.classe) ? character.classe : null
  const current = Object.fromEntries(
    characteristic_names.map((stat) => [stat, character[stat]])
  ) as CharacteristicValues
  const quote = classe ? characteristic_allocation_quote(classe, current, alloc) : null
  const staged_clicks = characteristic_names.reduce((total, stat) => total + alloc[stat], 0)
  const remaining = Math.max(0, character.available_points - (quote?.cost ?? 0))
  const has_pending = staged_clicks > 0
  const can_confirm = !!wallet && has_pending && !!quote && quote.cost <= character.available_points && !pending_tx

  const experience = Number(character.experience)
  const { level, into, span, percent } = experience_progress(experience)

  const max_health = character_max_hp(character)
  const health = projected_hp(character, Date.now())

  const confirm = (): void => {
    if (!can_confirm || !wallet) return
    const spending = { ...quote!.costs }
    set_pending_tx(true)
    const pending = toast.loading(t('stats.tx_pending'))
    void wallet.character
      .raise_stats({
        character_id: character.id,
        spending,
        custody: { kiosk: character.kiosk, kiosk_cap: character.kiosk_cap },
      })
      .then(() => {
        dispatch_app({ type: 'character/stats_raised', character_id: character.id, spending })
        set_alloc(empty_allocation())
        pending.success(t('stats.tx_success'))
      })
      .catch(pending.error)
      .finally(() => set_pending_tx(false))
  }

  return (
    <div className="stats">
      {/* hero header — identity + class + experience */}
      <div className="stats__hero">
        <div className="stats__hero-body">
          <div className="stats__hero-top">
            <span className="stats__hero-name">{character.name}</span>
            <span className="stats__hero-lvl hud-num">{t('stats.level', { level })}</span>
          </div>
          <div className="stats__hero-class">{titleize(character.classe)}</div>
          <div className="stats__hero-xp-head">
            <span className="stats__hero-xp-label">{t('common.experience')}</span>
            <span className="stats__hero-xp-value hud-num">
              {into.toLocaleString()} / {span.toLocaleString()}
            </span>
          </div>
          <div className="stats__bar">
            <div className="stats__bar-fill stats__bar-fill--xp" style={{ width: `${bar_pct(percent)}%` }} />
          </div>
        </div>
      </div>

      {/* capital card — the points to assign */}
      <div className={`stats__assign${remaining > 0 ? ' is-active' : ''}`}>
        <span className="stats__assign-num hud-num">{remaining}</span>
        <div className="stats__assign-text">
          <span className="stats__assign-title">{t('stats.points_to_assign')}</span>
          <span className="stats__assign-sub">{t('stats.spend_hint')}</span>
        </div>
        <div className="stats__assign-actions flex gap-2">
          <button
            className="stats__assign-btn btn-outline px-3 py-1.5"
            disabled={!has_pending || pending_tx}
            onClick={() => set_alloc(empty_allocation())}
            type="button"
          >
            {t('stats.reset')}
          </button>
          <button
            aria-busy={pending_tx || undefined}
            className="stats__assign-btn btn-gold px-3 py-1.5"
            disabled={!can_confirm}
            onClick={confirm}
            type="button"
          >
            {pending_tx ? t('stats.tx_pending') : t('common.confirm')}
          </button>
        </div>
      </div>

      {/* scrolling remainder — hero + capital stay pinned */}
      <div className="stats__scroll">
        {/* vitals: health / AP / MP */}
        <div className="stats__vitals">
          <div className="stats__vital stats__vital--health">
            <img alt="" className="stats__vital-icon" src={health_icon} />
            <span className="stats__vital-label">{t('stats.health')}</span>
            <span className="stats__vital-value hud-num">
              {health} / {max_health}
            </span>
          </div>
          <div className="stats__vital stats__vital--action">
            <img alt="" className="stats__vital-icon" src={action_icon} />
            <span className="stats__vital-label">{t('stats.action')}</span>
            <span className="stats__vital-value hud-num">{action_points(character)}</span>
          </div>
          <div className="stats__vital stats__vital--move">
            <img alt="" className="stats__vital-icon" src={movement_icon} />
            <span className="stats__vital-label">{t('stats.move')}</span>
            <span className="stats__vital-value hud-num">{movement_points(character)}</span>
          </div>
        </div>

        {/* PRIMARY (allocatable) characteristics */}
        <div className="stats__section">{t('stats.characteristics')}</div>
        <div className="stats__card">
          {characteristic_names.map((stat) => {
            const label = t(`stat.${stat}`)
            const base = character[stat]
            const pending_clicks = alloc[stat]
            const pending_gain = quote?.gains[stat] ?? 0
            const bonus = equipment_bonus(character, stat)
            const signed_bonus = bonus > 0 ? `+${bonus}` : String(bonus)
            const step = classe ? characteristic_cost_step(classe, stat, base + pending_gain) : null
            const next_quote = classe
              ? characteristic_allocation_quote(classe, current, { ...alloc, [stat]: pending_clicks + 1 })
              : null
            const can_add = !!next_quote && next_quote.cost <= character.available_points && !pending_tx
            return (
              <div className="stats__prow" key={stat}>
                <StatIdentity description={t(`stats.description.${stat}`)} label={label} stat={stat} />
                <span className="stats__prow-allocation">
                  {step && (
                    <span className="stats__prow-cost">
                      {t('stats.point_cost', { cost: step.cost, gain: step.gain })}
                    </span>
                  )}
                  <span className="stats__prow-value hud-num">
                    {base}
                    {bonus !== 0 && <span className="stats__prow-bonus"> ({signed_bonus})</span>}
                    {pending_gain > 0 && <span className="stats__prow-pending"> +{pending_gain}</span>}
                  </span>
                </span>
                <button
                  aria-label={t('stats.remove_point', { stat: label })}
                  className="stats__step btn-outline"
                  disabled={pending_clicks <= 0 || pending_tx}
                  onClick={() => set_alloc({ ...alloc, [stat]: Math.max(0, pending_clicks - 1) })}
                  type="button"
                >
                  −
                </button>
                <button
                  aria-label={t('stats.add_point', { stat: label })}
                  className="stats__step stats__step--add btn-gold"
                  disabled={!can_add}
                  onClick={() => set_alloc({ ...alloc, [stat]: pending_clicks + 1 })}
                  type="button"
                >
                  +
                </button>
              </div>
            )
          })}
        </div>

        {/* RESISTANCES — the element-coloured shield block */}
        <div className="stats__section">{t('stats.resistances')}</div>
        <div className="stats__resists">
          {RESISTANCES.map(({ stat, element, color }) => {
            const value = equipment_bonus(character, stat)
            return (
              <div
                className="stats__resist"
                key={stat}
                style={{ '--rc': color } as React.CSSProperties}
                title={t(`stat.${stat}`)}
              >
                <div className="stats__resist-head">
                  <svg aria-hidden="true" className="stats__resist-glyph" viewBox="0 0 24 24">
                    <path
                      d="M12 2.5 20 5.5 V11 C20 16 16.4 19.7 12 21.5 C7.6 19.7 4 16 4 11 V5.5 Z"
                      fill="none"
                      stroke="currentColor"
                      strokeLinejoin="round"
                      strokeWidth="2"
                    />
                  </svg>
                  <span className="stats__resist-label">{t(`stats.element.${element}`)}</span>
                  <span className="stats__resist-value hud-num">{value}%</span>
                </div>
                <div className="stats__resist-bar">
                  <div className="stats__resist-fill" style={{ width: `${bar_pct(value)}%` }} />
                </div>
              </div>
            )
          })}
        </div>

        {/* SECONDARY (read-only derived) stats */}
        <div className="stats__section">{t('stats.secondary')}</div>
        <div className="stats__card stats__card--secondary">
          {SECONDARY.map(({ stat, label_key, desc_key, tint }) => (
            <div className="stats__srow" key={stat} title={t(label_key)}>
              <span aria-hidden="true" className="stats__srow-mark" style={{ '--tint': tint } as React.CSSProperties} />
              <span className="stats__srow-labels">
                <span className="stats__srow-label">{t(label_key)}</span>
                <span className="stats__srow-desc">{t(desc_key)}</span>
              </span>
              <span className="stats__srow-value hud-num">{equipment_bonus(character, stat)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
