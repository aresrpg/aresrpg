// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Chain-backed character sheet: stage six primaries, then compose one stat-allocation PTB.

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'

import { raise_stat_ptb } from '@aresrpg/sdk/game'
import { get_secondary_stats, get_total_stat, STATISTICS } from '@aresrpg/sdk/stats'
import { xp_progress } from '@aresrpg/sdk/experience'

import { use_auth } from '../../../auth'
import { DEMO_NETWORK } from '../../../chain/deployment'
import { get_sdk } from '../../../chain/sdk'
import { projected_hp, character_max_hp } from '../../../chain/read_character.js'
import { get_characters, rpc_get } from '../../../rpc/client'
import { RpcStale } from '../../../rpc/RpcStale'
import { use_rpc_view } from '../../../rpc/use_view'
import { kiosk_for_character } from '../../../world-shell/kiosk_resolve.js'
import { mark_ui_updated, run_tx } from '../../../world-shell/tx.js'
import { use_toast } from '../../../toast'

import { use_game_state } from '../../store.js'
import { humanize_tx_error } from '../../core/abort_copy.js'
import { get_class } from '../../data/classes.js'
import { color_to_hue } from '../../data/color.js'
import { CharacterPortrait } from './CharacterPortrait.jsx'
import { Tooltip } from './Tooltip.jsx'
import vitality_icon from '../../assets/statistics/vitality.png'
import wisdom_icon from '../../assets/statistics/wisdom.png'
import strength_icon from '../../assets/statistics/strength.png'
import intelligence_icon from '../../assets/statistics/intelligence.png'
import chance_icon from '../../assets/statistics/chance.png'
import agility_icon from '../../assets/statistics/agility.png'
import health_icon from '../../assets/statistics/health.png'
import action_icon from '../../assets/statistics/action.png'
import movement_icon from '../../assets/statistics/movement.png'
import './hud-panels.css'
import './Stats.css'

/** Move order differs from display order: Agility=4, Chance=5. */
export const STAT_INDEX = Object.freeze({
  [STATISTICS.VITALITY]: 0,
  [STATISTICS.WISDOM]: 1,
  [STATISTICS.STRENGTH]: 2,
  [STATISTICS.INTELLIGENCE]: 3,
  [STATISTICS.AGILITY]: 4,
  [STATISTICS.CHANCE]: 5,
})

/** @type {{ key: string, stat: number, icon: string, tint: string }[]} */
const PRIMARY = [
  { key: STATISTICS.VITALITY, stat: STAT_INDEX.vitality, icon: vitality_icon, tint: '#ef5350' },
  { key: STATISTICS.WISDOM, stat: STAT_INDEX.wisdom, icon: wisdom_icon, tint: '#b07cff' },
  { key: STATISTICS.STRENGTH, stat: STAT_INDEX.strength, icon: strength_icon, tint: '#c9905a' },
  {
    key: STATISTICS.INTELLIGENCE,
    stat: STAT_INDEX.intelligence,
    icon: intelligence_icon,
    tint: '#5db4ff',
  },
  { key: STATISTICS.CHANCE, stat: STAT_INDEX.chance, icon: chance_icon, tint: '#4fd6a0' },
  { key: STATISTICS.AGILITY, stat: STAT_INDEX.agility, icon: agility_icon, tint: '#ffce85' },
]

const PRIMARY_KEYS = PRIMARY.map(({ key }) => key)

/** label + sim-truth description (issue #371) per stat row, primary or secondary — literal t() calls keep
 * the 6-locale coverage gate authoritative; formula citations (file:line) live in the PR body. */
const stat_text = (t, key) => {
  switch (key) {
    case STATISTICS.VITALITY:
      return { label: t('stat.vitality'), description: t('stats.description.vitality') }
    case STATISTICS.WISDOM:
      return { label: t('stat.wisdom'), description: t('stats.description.wisdom') }
    case STATISTICS.STRENGTH:
      return { label: t('stat.strength'), description: t('stats.description.strength') }
    case STATISTICS.INTELLIGENCE:
      return { label: t('stat.intelligence'), description: t('stats.description.intelligence') }
    case STATISTICS.CHANCE:
      return { label: t('stat.chance'), description: t('stats.description.chance') }
    case STATISTICS.AGILITY:
      return { label: t('stat.agility'), description: t('stats.description.agility') }
    case STATISTICS.CRITICAL:
      return { label: t('stat.critical_hit'), description: t('stats.description.critical_hit') }
    case STATISTICS.RAW_DAMAGE:
      return { label: t('stat.raw_damage'), description: t('stats.description.raw_damage') }
    default:
      return { label: '', description: '' }
  }
}

/** @type {{ key: string, color: string }[]} Fire / Water / Earth / Air. */
const RESISTANCES = [
  { key: STATISTICS.FIRE_RESISTANCE, color: '#ef5350' },
  { key: STATISTICS.WATER_RESISTANCE, color: '#42a5f5' },
  { key: STATISTICS.EARTH_RESISTANCE, color: '#c9905a' },
  { key: STATISTICS.AIR_RESISTANCE, color: '#66bb6a' },
]

const resistance_label = (t, key) => {
  switch (key) {
    case STATISTICS.FIRE_RESISTANCE:
      return { short: t('stats.element.fire'), full: t('stat.fire_resistance') }
    case STATISTICS.WATER_RESISTANCE:
      return { short: t('stats.element.water'), full: t('stat.water_resistance') }
    case STATISTICS.EARTH_RESISTANCE:
      return { short: t('stats.element.earth'), full: t('stat.earth_resistance') }
    case STATISTICS.AIR_RESISTANCE:
      return { short: t('stats.element.air'), full: t('stat.air_resistance') }
    default:
      return { short: '', full: '' }
  }
}

/** Allow-list only real combat item stats. This excludes legacy Pods and any future unconsumed SDK row. */
const SECONDARY_KEYS = new Set([STATISTICS.CRITICAL, STATISTICS.RAW_DAMAGE])

const SECONDARY_TINT = /** @type {Record<string, string>} */ ({
  critical: '#ffb454',
  raw_damage: '#ef5350',
})

// The drawer remounts this tab on roster/tab changes. Keep the in-flight lock and receipt projections alive
// across those remounts so a stale /v1 snapshot can never offer the same points twice.
let allocation_session = { tx_pending: false, confirmed_characters: {} }
const allocation_listeners = new Set()
export const allocation_session_snapshot = () => allocation_session
const subscribe_allocation_session = (listener) => {
  allocation_listeners.add(listener)
  return () => allocation_listeners.delete(listener)
}
const update_allocation_session = (update) => {
  const next = update(allocation_session)
  if (next === allocation_session) return
  allocation_session = next
  for (const listener of allocation_listeners) listener()
}
export const set_allocation_tx_pending = (tx_pending) =>
  update_allocation_session((current) =>
    current.tx_pending === tx_pending ? current : { ...current, tx_pending }
  )
export const record_confirmed_character = (id, character) =>
  update_allocation_session((current) => ({
    ...current,
    confirmed_characters: { ...current.confirmed_characters, [id]: character },
  }))
export const clear_confirmed_character = (id, expected) =>
  update_allocation_session((current) => {
    if (current.confirmed_characters[id] !== expected) return current
    const confirmed_characters = { ...current.confirmed_characters }
    delete confirmed_characters[id]
    return { ...current, confirmed_characters }
  })
const use_allocation_session = () =>
  useSyncExternalStore(subscribe_allocation_session, allocation_session_snapshot, allocation_session_snapshot)

export const empty_allocation = () => Object.fromEntries(PRIMARY_KEYS.map((key) => [key, 0]))

export const allocation_total = (alloc) =>
  PRIMARY_KEYS.reduce((sum, key) => sum + Math.max(0, Number(alloc?.[key] ?? 0)), 0)

export const remaining_points = (available_points, alloc) =>
  Math.max(0, Math.max(0, Number(available_points ?? 0)) - allocation_total(alloc))

/** Pure +/- staging with a total-points clamp. Invalid/dead stat keys are inert. */
export function stage_allocation(alloc, key, delta, available_points) {
  if (!Object.hasOwn(STAT_INDEX, key)) return alloc
  const current = Math.max(0, Number(alloc?.[key] ?? 0))
  const room = Math.max(0, Number(available_points ?? 0) - allocation_total(alloc))
  const next = Math.max(0, Math.min(current + room, current + Number(delta ?? 0)))
  return next === current ? alloc : { ...alloc, [key]: next }
}

export const reset_allocation = () => empty_allocation()

/** SDK builder is already shipped; bind only the frontend's selected network. */
const build_raise_stat = raise_stat_ptb({ network: DEMO_NETWORK })

/** Thread every nonzero row through one PTB; `build` is injectable for exact-shape tests. */
export function compose_stat_allocation(build, handle, character_id, alloc) {
  let tx
  for (const { key, stat } of PRIMARY) {
    const points = Math.max(0, Number(alloc?.[key] ?? 0))
    if (!points) continue
    tx = build({
      kiosk_id: handle.kiosk_id,
      personal_kiosk_cap_id: handle.personal_kiosk_cap_id,
      character_id,
      stat,
      points,
      tx,
    })
  }
  return tx ?? null
}

/** Merge only /v1's canonical stat/HP vocabulary over the richer store character. */
export function merge_character_doc(character, doc) {
  if (!character || !doc || character.id !== doc.id) return character
  const next = { ...character }
  for (const key of [...PRIMARY_KEYS, 'available_points']) next[key] = Number(doc[key] ?? next[key] ?? 0)
  for (const key of ['current_hp', 'hp_updated_ms', 'gear_vitality']) {
    if (doc[key] != null) next[key] = Number(doc[key])
  }
  return next
}

/** Confirmed stat allocation is deterministic, so paint its exact receipt effect while /v1 catches up. */
export function apply_confirmed_allocation(character, alloc) {
  const next = { id: character?.id }
  for (const key of PRIMARY_KEYS) next[key] = Number(character?.[key] ?? 0) + Number(alloc?.[key] ?? 0)
  next.available_points = remaining_points(character?.available_points, alloc)
  return next
}

export function stat_doc_caught_up(doc, expected) {
  if (!doc || !expected || doc.id !== expected.id) return false
  return PRIMARY_KEYS.every((key) => Number(doc[key] ?? 0) >= Number(expected[key] ?? 0))
}

/** Equipment-only contribution to a primary stat. `character[key]` is the on-chain confirmed base and
 * `get_total_stat` is base + every equipped item's stat — pending allocation never reaches `character`
 * (it lives only in local `alloc` state), so no third term is needed. One home: never inline this per row. */
export const equipment_bonus = (character, key) => get_total_stat(character, key) - Number(character?.[key] ?? 0)

export const visible_secondary_stats = (character) =>
  get_secondary_stats(character).filter(({ key }) => SECONDARY_KEYS.has(key))

const CLASS_TITLES = {
  senshi: (t) => t('simulator.classes.SENSHI.title'),
  yogen: (t) => t('simulator.classes.YOGEN.title'),
  yajin: (t) => t('simulator.classes.YAJIN.title'),
  ikari: (t) => t('simulator.classes.IKARI.title'),
  mori: (t) => t('simulator.classes.MORI.title'),
  tokei: (t) => t('simulator.classes.TOKEI.title'),
  shugo: (t) => t('simulator.classes.SHUGO.title'),
  rojin: (t) => t('simulator.classes.ROJIN.title'),
  shusen: (t) => t('simulator.classes.SHUSEN.title'),
  tomoda: (t) => t('simulator.classes.TOMODA.title'),
  asobi: (t) => t('simulator.classes.ASOBI.title'),
  iyashi: (t) => t('simulator.classes.IYASHI.title'),
}

const class_title = (t, class_id) => {
  const title = CLASS_TITLES[String(class_id ?? '').toLowerCase()]
  return title ? title(t) : t('stats.adventurer')
}

/** House-system actions, exported for DOM-less disabled-state proofs. */
export function AllocationActions({ t, has_pending, can_confirm, on_reset, on_confirm }) {
  const { tx_pending } = use_allocation_session()
  return (
    <div className="stats__assign-actions flex gap-2">
      <button
        type="button"
        className="stats__assign-btn btn-outline px-3 py-1.5"
        disabled={!has_pending || tx_pending}
        onClick={on_reset}
      >
        {t('stats.reset')}
      </button>
      <button
        type="button"
        className="stats__assign-btn btn-gold px-3 py-1.5"
        disabled={!can_confirm || tx_pending}
        aria-busy={tx_pending || undefined}
        onClick={on_confirm}
      >
        {tx_pending ? t('stats.tx_pending') : t('common.confirm')}
      </button>
    </div>
  )
}

/** @param {number} n @returns {number} clamp to a 0-100 bar percentage */
const bar_pct = (n) => Math.max(0, Math.min(100, n))

/** @returns {import('react').JSX.Element} */
export function Stats() {
  const { t } = useTranslation()
  const characters = use_game_state((s) => s.sui.characters)
  const selected_character_id = use_game_state((s) => s.selected_character_id)
  const selected_character_id_ref = useRef(selected_character_id)
  selected_character_id_ref.current = selected_character_id

  const store_character = useMemo(
    () => characters?.find((c) => c.id === selected_character_id) ?? null,
    [characters, selected_character_id]
  )

  // /v1 is the stat/points/HP display source; the hook visibly reports stale/offline data.
  const character_view = use_rpc_view(
    async (signal) => {
      const rows = selected_character_id ? await get_characters({ id: selected_character_id }, signal) : []
      if (!rows[0]) throw new Error('character document unavailable')
      return rows[0]
    },
    { enabled: !!selected_character_id, deps: [selected_character_id] }
  )

  const documented_character = useMemo(
    () => merge_character_doc(store_character, character_view.data),
    [store_character, character_view.data]
  )
  // Hold the confirmed projection until /v1 catches up, so indexer lag cannot restore spent points.
  const { confirmed_characters, tx_pending } = use_allocation_session()
  const confirmed_character = confirmed_characters[selected_character_id] ?? null
  const character =
    confirmed_character?.id === selected_character_id && documented_character
      ? { ...documented_character, ...confirmed_character }
      : documented_character
  const [alloc, set_alloc] = useState(empty_allocation)

  useEffect(() => {
    set_alloc(reset_allocation())
  }, [selected_character_id])

  useEffect(() => {
    if (!stat_doc_caught_up(character_view.data, confirmed_character)) return
    clear_confirmed_character(selected_character_id, confirmed_character)
  }, [character_view.data, confirmed_character, selected_character_id])

  const secondary = useMemo(() => (character ? visible_secondary_stats(character) : []), [character])

  if (!character) {
    return <div className="hud-panel-empty">{t('stats.no_character')}</div>
  }

  const cls = get_class(character.classe ?? character.class_id)
  const hue = color_to_hue(character.color_1 ?? 0)

  const { level, into, span, pct } = xp_progress(character.experience)
  const xp_percent = Math.round(pct)

  // Never fall back to vestigial `health`; only canonical /v1 HP fields render.
  const hp_ready = character.current_hp != null && character.gear_vitality != null
  const max_health = hp_ready ? character_max_hp(character) : null
  const health = hp_ready ? projected_hp(character, Date.now()) : null

  const available_points = Math.max(0, Number(character.available_points ?? 0))
  const pending_total = allocation_total(alloc)
  const remaining = remaining_points(available_points, alloc)
  const allocation_ready = character_view.data?.id === character.id && character_view.error == null
  const can_upgrade = allocation_ready && remaining > 0 && !tx_pending
  const has_pending = pending_total > 0
  const can_confirm = allocation_ready && has_pending && pending_total <= available_points && !tx_pending

  const add_point = (/** @type {string} */ key) => {
    if (!can_upgrade) return
    set_alloc((prev) => stage_allocation(prev, key, 1, available_points))
  }

  const remove_point = (/** @type {string} */ key) => {
    if (tx_pending) return
    set_alloc((prev) => stage_allocation(prev, key, -1, available_points))
  }

  const cancel = () => {
    if (!tx_pending) set_alloc(reset_allocation())
  }

  const confirm = async () => {
    if (!can_confirm) return
    const staged = { ...alloc }
    set_allocation_tx_pending(true)
    try {
      const { address } = use_auth.getState()
      if (!address) throw new Error(t('stats.not_connected'))
      const sdk = await get_sdk()
      const handle = await kiosk_for_character(sdk, address, character.id)
      if (!handle) throw new Error(t('stats.character_busy'))
      const tx = compose_stat_allocation(build_raise_stat, handle, character.id, staged)
      if (!tx) return

      const { timing } = await run_tx('stat_allocation', tx)
      record_confirmed_character(character.id, apply_confirmed_allocation(character, staged))
      set_alloc(reset_allocation())
      mark_ui_updated(timing)
      use_toast.getState().add(t('stats.tx_success'), 'info')
      try {
        // Bypass the 3s client LRU after our own write. The response warms that cache, then the active view
        // adopts it; if the user switched characters, the exact transacted id was still refreshed.
        await rpc_get('/v1/characters', { ids: character.id }, undefined, true)
        if (selected_character_id_ref.current === character.id) character_view.refetch()
      } catch {
        use_toast.getState().add(t('stats.refresh_failed'), 'error')
      }
    } catch (error) {
      // ONE decoder owns raw/pre-flight/executed error copy. run_tx never retries an executed digest.
      use_toast.getState().add(humanize_tx_error(error), 'error')
    } finally {
      set_allocation_tx_pending(false)
    }
  }

  return (
    <div className="stats">
      {/* hero header — portrait + identity + class + experience */}
      <div className="stats__hero">
        <CharacterPortrait
          sprites={cls?.sprites ?? '/sprites/senshi'}
          hue={hue}
          size={64}
          className="stats__hero-portrait"
        />
        <div className="stats__hero-body">
          <div className="stats__hero-top">
            <span className="stats__hero-name">{character.name}</span>
            <span className="stats__hero-lvl hud-num">{t('stats.level', { level })}</span>
          </div>
          <div className="stats__hero-class">{class_title(t, character.classe ?? character.class_id)}</div>
          <div className="stats__hero-xp-head">
            <span className="stats__hero-xp-label">{t('common.experience')}</span>
            <span className="stats__hero-xp-value hud-num">
              {into.toLocaleString()} / {span.toLocaleString()}
            </span>
          </div>
          <div className="stats__bar">
            <div className="stats__bar-fill stats__bar-fill--xp" style={{ width: `${xp_percent}%` }} />
          </div>
        </div>
      </div>

      {/* capital card — the points to assign (c198: obvious + prominent) */}
      <div className={`stats__assign${allocation_ready && remaining > 0 ? ' is-active' : ''}`}>
        <span className="stats__assign-num hud-num">
          {character_view.data?.id === character.id || confirmed_character?.id === character.id ? remaining : '—'}
        </span>
        <div className="stats__assign-text">
          <span className="stats__assign-title">{t('stats.points_to_assign')}</span>
          <span className="stats__assign-sub">{t('stats.spend_hint')}</span>
          <RpcStale
            stale={character_view.stale}
            offline={character_view.error != null && character_view.data == null}
          />
        </div>
        <AllocationActions
          t={t}
          has_pending={has_pending}
          can_confirm={can_confirm}
          on_reset={cancel}
          on_confirm={confirm}
        />
      </div>

      {/* scrolling remainder — hero + capital stay pinned; the stat sections scroll (fit pass) */}
      <div className="stats__scroll">
        {/* vitals: health / AP / MP */}
        <div className="stats__vitals">
          <div className="stats__vital stats__vital--health">
            <img className="stats__vital-icon" src={health_icon} alt="" />
            <span className="stats__vital-label">{t('stats.health')}</span>
            <span className="stats__vital-value hud-num">{health == null ? '—' : `${health} / ${max_health}`}</span>
          </div>
          <div className="stats__vital stats__vital--action">
            <img className="stats__vital-icon" src={action_icon} alt="" />
            <span className="stats__vital-label">{t('stats.action')}</span>
            <span className="stats__vital-value hud-num">{get_total_stat(character, STATISTICS.ACTION)}</span>
          </div>
          <div className="stats__vital stats__vital--move">
            <img className="stats__vital-icon" src={movement_icon} alt="" />
            <span className="stats__vital-label">{t('stats.move')}</span>
            <span className="stats__vital-value hud-num">{get_total_stat(character, STATISTICS.MOVEMENT)}</span>
          </div>
        </div>

        {/* PRIMARY (allocatable) characteristics */}
        <div className="stats__section">{t('stats.characteristics')}</div>
        <div className="stats__card">
          {PRIMARY.map(({ key, icon, tint }) => {
            const { label, description } = stat_text(t, key)
            const base = character[key] ?? 0
            const pending = alloc[key] ?? 0
            const bonus = equipment_bonus(character, key)
            return (
              <div className="stats__prow" key={key}>
                <Tooltip text={label}>
                  <span
                    className="stats__prow-icon"
                    style={
                      /** @type {import('react').CSSProperties} */ ({
                        '--tint': tint,
                      })
                    }
                  >
                    <img src={icon} alt="" />
                  </span>
                </Tooltip>
                <span className="stats__prow-labels" title={description}>
                  <span className="stats__prow-label">{label}</span>
                  <span className="stats__prow-desc">{description}</span>
                </span>
                <span className="stats__prow-value hud-num">
                  {base}
                  {bonus > 0 && <span className="stats__prow-bonus"> (+{bonus})</span>}
                  {pending > 0 && <span className="stats__prow-pending"> +{pending}</span>}
                </span>
                <button
                  type="button"
                  className="stats__step"
                  disabled={pending <= 0 || tx_pending}
                  onClick={() => remove_point(key)}
                  aria-label={t('stats.remove_point', { stat: label })}
                >
                  &minus;
                </button>
                <button
                  type="button"
                  className="stats__step stats__step--add"
                  disabled={!can_upgrade}
                  onClick={() => add_point(key)}
                  aria-label={t('stats.add_point', { stat: label })}
                >
                  +
                </button>
              </div>
            )
          })}
        </div>

        {/* RESISTANCES — the dedicated element-coloured block */}
        <div className="stats__section">{t('stats.resistances')}</div>
        <div className="stats__resists">
          {RESISTANCES.map(({ key, color }) => {
            const label = resistance_label(t, key)
            const value = get_total_stat(character, key)
            return (
              <Tooltip key={key} text={label.full}>
                <div
                  className="stats__resist"
                  style={
                    /** @type {import('react').CSSProperties} */ ({
                      '--rc': color,
                    })
                  }
                >
                  <div className="stats__resist-head">
                    <svg className="stats__resist-glyph" viewBox="0 0 24 24" aria-hidden="true">
                      <path
                        d="M12 2.5 20 5.5 V11 C20 16 16.4 19.7 12 21.5 C7.6 19.7 4 16 4 11 V5.5 Z"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinejoin="round"
                      />
                    </svg>
                    <span className="stats__resist-label">{label.short}</span>
                    <span className="stats__resist-value hud-num">{value}%</span>
                  </div>
                  <div className="stats__resist-bar">
                    <div className="stats__resist-fill" style={{ width: `${bar_pct(value)}%` }} />
                  </div>
                </div>
              </Tooltip>
            )
          })}
        </div>

        {/* SECONDARY (read-only derived) stats — resistances removed (own block above) */}
        <div className="stats__section">{t('stats.secondary')}</div>
        <div className="stats__card stats__card--secondary">
          {secondary.map(({ key, value, unit }) => {
            const { label, description } = stat_text(t, key)
            // critical hit reads as "1 chance in N" per the locked sheet (1/N), not a raw percent.
            const display =
              key === STATISTICS.CRITICAL
                ? value > 0
                  ? `1 / ${Math.round(100 / value)}`
                  : '0'
                : `${value.toLocaleString()}${unit === 'percent' ? '%' : ''}`
            return (
              <Tooltip key={key} text={label}>
                <div className="stats__srow">
                  <span
                    className="stats__srow-mark"
                    aria-hidden="true"
                    style={
                      /** @type {import('react').CSSProperties} */ ({
                        '--tint': SECONDARY_TINT[key] ?? 'var(--fg-faint)',
                      })
                    }
                  />
                  <span className="stats__srow-labels" title={description}>
                    <span className="stats__srow-label">{label}</span>
                    <span className="stats__srow-desc">{description}</span>
                  </span>
                  <span className="stats__srow-value hud-num">{display}</span>
                </div>
              </Tooltip>
            )
          })}
        </div>
      </div>
    </div>
  )
}
