// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// AUTO-SEARCH VIEW (#1106) — the scouter's markup as PURE functions of props: the compact HUD row (gold
// switch + cog) and the settings sheet. Nothing here reads a store, the engine, or the chain — the container
// (AutoSearchPanel.jsx) owns every fact and every handler, so this file renders in the repo's no-DOM test
// harness. House tokens only: near-black glass, gold accent, JetBrains Mono, uppercase micro-labels, sharp
// corners (auto-search.css).

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { createPortal } from 'react-dom'

/**
 * The settings cog — inline SVG, no icon dependency. A real GEAR: one closed 6-tooth outline (trapezoid
 * teeth on a 24-grid, root r=6.4 / tip r=9.4) plus the hub, so every edge carries the SAME stroke width and
 * reads as teeth at HUD size — the old 8-spoke asterisk read as a sun.
 */
export function CogIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="15"
      height="15"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M9.2 6.2L9.6 2.9L14.4 2.9L14.8 6.2L15.6 6.7L18.6 5.4L21.1 9.6L18.4 11.6L18.4 12.4L21.1 14.4L18.6 18.6L15.6 17.3L14.8 17.8L14.4 21.1L9.6 21.1L9.2 17.8L8.4 17.3L5.4 18.6L2.9 14.4L5.6 12.4L5.6 11.6L2.9 9.6L5.4 5.4L8.4 6.7Z" />
      <circle cx="12" cy="12" r="3.1" />
    </svg>
  )
}

/**
 * The HUD row: the label, then the settings cog, then the switch FLUSH RIGHT — a REAL switch (role=switch +
 * aria-checked, never a checkbox), pill-shaped with a circular knob.
 * @param {{ armed: boolean, on_toggle: (next: boolean) => void, on_config: () => void }} props
 */
export function AutoSearchRow({ armed, on_toggle, on_config }) {
  const { t } = useTranslation()
  return (
    <div className="gw-asrch gw-panel">
      <span className="gw-asrch__label">{t('auto_search.label')}</span>
      <button
        type="button"
        className="gw-asrch__cog"
        title={t('auto_search.config_title')}
        aria-label={t('auto_search.config_title')}
        onClick={on_config}
      >
        <CogIcon />
      </button>
      <button
        type="button"
        role="switch"
        aria-checked={armed}
        aria-label={t('auto_search.label')}
        className={`gw-asrch__switch${armed ? ' gw-asrch__switch--on' : ''}`}
        onClick={() => on_toggle(!armed)}
      >
        <span className="gw-asrch__knob" />
      </button>
    </div>
  )
}

/** The three things a scouting run can be looking for (#2029) — the fold's own `TARGET_MODES` order. */
const TARGET_CHOICES = /** @type {const} */ ([
  { mode: 'mobs', label_key: 'auto_search.targets_mobs' },
  { mode: 'gatherables', label_key: 'auto_search.targets_gatherables' },
  { mode: 'both', label_key: 'auto_search.targets_both' },
])

/**
 * A pick list: the filtered rows as toggle chips, with an honest empty when nothing matches.
 * @param {{ rows: { id: string, name: string }[], selected: string[], loading?: boolean,
 *   empty: string, on_toggle: (id: string) => void }} props
 */
function PickList({ rows, selected, loading = false, empty, on_toggle }) {
  const { t } = useTranslation()
  return (
    <div className="gw-asrch__mobs">
      {rows.map((row) => (
        <button
          key={row.id}
          type="button"
          className={`gw-asrch__mob${selected.includes(row.id) ? ' gw-asrch__mob--on' : ''}`}
          aria-pressed={selected.includes(row.id)}
          onClick={() => on_toggle(row.id)}
        >
          {row.name}
        </button>
      ))}
      {rows.length === 0 && <span className="gw-asrch__empty">{loading ? t('common.loading') : empty}</span>}
    </div>
  )
}

/**
 * The settings sheet: what the run is looking for, the scouting annulus (from–to blocks off the world
 * centre), and the wanted mob templates / gathering nodes. Portaled to <body> for the same reason every
 * other HUD modal is — every `.gw-panel` sets `backdrop-filter`, which would anchor a fixed child to the
 * panel instead of the viewport. Every setting here persists (#2029); arming never does.
 * @param {{ from_m: number, to_m: number, wanted: string[], wanted_resources: string[],
 *   targets: 'mobs'|'gatherables'|'both',
 *   rows: { template_id: string, name: string }[], resource_rows: { id: string, name: string }[],
 *   loading: boolean,
 *   on_range: (next: { from_m?: number, to_m?: number }) => void,
 *   on_targets: (mode: 'mobs'|'gatherables'|'both') => void,
 *   on_toggle_mob: (template_id: string) => void, on_toggle_resource: (id: string) => void,
 *   on_close: () => void }} props
 */
export function AutoSearchSheet({
  from_m,
  to_m,
  wanted,
  wanted_resources,
  targets,
  rows,
  resource_rows,
  loading,
  on_range,
  on_targets,
  on_toggle_mob,
  on_toggle_resource,
  on_close,
}) {
  const { t } = useTranslation()
  const [filter, set_filter] = useState('')
  const term = filter.trim().toLowerCase()
  const match = (/** @type {{ name: string }[]} */ list) =>
    term ? list.filter((row) => row.name.toLowerCase().includes(term)) : list
  const visible = match(rows).map((row) => ({ id: row.template_id, name: row.name }))
  const visible_resources = match(resource_rows)
  const shows_mobs = targets === 'mobs' || targets === 'both'
  const shows_resources = targets === 'gatherables' || targets === 'both'

  return createPortal(
    <div className="gw-asrch__backdrop" onClick={on_close}>
      <div
        className="gw-asrch__sheet"
        role="dialog"
        aria-modal="true"
        aria-label={t('auto_search.config_title')}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="gw-asrch__title">{t('auto_search.config_title')}</div>

        <div className="gw-asrch__section">{t('auto_search.targets_label')}</div>
        <div className="gw-asrch__targets" role="radiogroup" aria-label={t('auto_search.targets_label')}>
          {TARGET_CHOICES.map(({ mode, label_key }) => (
            <button
              key={mode}
              type="button"
              role="radio"
              aria-checked={targets === mode}
              className={`gw-asrch__target${targets === mode ? ' gw-asrch__target--on' : ''}`}
              onClick={() => on_targets(mode)}
            >
              {t(label_key)}
            </button>
          ))}
        </div>

        <div className="gw-asrch__section">{t('auto_search.range_label')}</div>
        <div className="gw-asrch__range">
          <label className="gw-asrch__field">
            <span>{t('auto_search.range_from')}</span>
            <input
              type="number"
              min="0"
              step="100"
              value={from_m}
              aria-label={t('auto_search.range_from')}
              onChange={(event) => on_range({ from_m: Number(event.target.value) })}
            />
          </label>
          <label className="gw-asrch__field">
            <span>{t('auto_search.range_to')}</span>
            <input
              type="number"
              min="0"
              step="100"
              value={to_m}
              aria-label={t('auto_search.range_to')}
              onChange={(event) => on_range({ to_m: Number(event.target.value) })}
            />
          </label>
        </div>

        <input
          type="search"
          className="gw-asrch__filter"
          value={filter}
          placeholder={t('auto_search.mobs_filter')}
          aria-label={t('auto_search.mobs_filter')}
          onChange={(event) => set_filter(event.target.value)}
        />

        {shows_mobs && (
          <>
            <div className="gw-asrch__section">
              {t('auto_search.mobs_label')}
              <span className="gw-asrch__count">{t('auto_search.selected', { count: wanted.length })}</span>
            </div>
            <PickList
              rows={visible}
              selected={wanted}
              loading={loading}
              empty={t('auto_search.mobs_empty')}
              on_toggle={on_toggle_mob}
            />
          </>
        )}

        {shows_resources && (
          <>
            <div className="gw-asrch__section">
              {t('auto_search.gatherables_label')}
              <span className="gw-asrch__count">{t('auto_search.selected', { count: wanted_resources.length })}</span>
            </div>
            <PickList
              rows={visible_resources}
              selected={wanted_resources}
              empty={t('auto_search.gatherables_empty')}
              on_toggle={on_toggle_resource}
            />
          </>
        )}

        <button type="button" className="gw-asrch__done" onClick={on_close}>
          {t('common.close')}
        </button>
      </div>
    </div>,
    document.body
  )
}
