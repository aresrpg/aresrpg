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

/** The settings cog — inline SVG, no icon dependency. */
export function CogIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="11"
      height="11"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9L7 7M17 17l2.1 2.1M19.1 4.9L17 7M7 17l-2.1 2.1" />
    </svg>
  )
}

/**
 * The HUD row: a REAL switch (role=switch + aria-checked, never a checkbox) and the settings cog.
 * @param {{ armed: boolean, on_toggle: (next: boolean) => void, on_config: () => void }} props
 */
export function AutoSearchRow({ armed, on_toggle, on_config }) {
  const { t } = useTranslation()
  return (
    <div className="gw-asrch gw-panel">
      <span className="gw-asrch__label">{t('auto_search.label')}</span>
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
      <button
        type="button"
        className="gw-asrch__cog"
        title={t('auto_search.config_title')}
        aria-label={t('auto_search.config_title')}
        onClick={on_config}
      >
        <CogIcon />
      </button>
    </div>
  )
}

/**
 * The settings sheet: the scouting annulus (from–to blocks off the world centre) and the wanted mob
 * templates. Portaled to <body> for the same reason every other HUD modal is — every `.gw-panel` sets
 * `backdrop-filter`, which would anchor a fixed child to the panel instead of the viewport.
 * @param {{ from_m: number, to_m: number, wanted: string[],
 *   rows: { template_id: string, name: string }[], loading: boolean,
 *   on_range: (next: { from_m?: number, to_m?: number }) => void,
 *   on_toggle_mob: (template_id: string) => void, on_close: () => void }} props
 */
export function AutoSearchSheet({ from_m, to_m, wanted, rows, loading, on_range, on_toggle_mob, on_close }) {
  const { t } = useTranslation()
  const [filter, set_filter] = useState('')
  const term = filter.trim().toLowerCase()
  const visible = term ? rows.filter((row) => row.name.toLowerCase().includes(term)) : rows

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

        <div className="gw-asrch__section">
          {t('auto_search.mobs_label')}
          <span className="gw-asrch__count">{t('auto_search.selected', { count: wanted.length })}</span>
        </div>
        <input
          type="search"
          className="gw-asrch__filter"
          value={filter}
          placeholder={t('auto_search.mobs_filter')}
          aria-label={t('auto_search.mobs_filter')}
          onChange={(event) => set_filter(event.target.value)}
        />
        <div className="gw-asrch__mobs">
          {visible.map((row) => (
            <button
              key={row.template_id}
              type="button"
              className={`gw-asrch__mob${wanted.includes(row.template_id) ? ' gw-asrch__mob--on' : ''}`}
              aria-pressed={wanted.includes(row.template_id)}
              onClick={() => on_toggle_mob(row.template_id)}
            >
              {row.name}
            </button>
          ))}
          {visible.length === 0 && (
            <span className="gw-asrch__empty">{loading ? t('common.loading') : t('auto_search.mobs_empty')}</span>
          )}
        </div>

        <button type="button" className="gw-asrch__done" onClick={on_close}>
          {t('common.close')}
        </button>
      </div>
    </div>,
    document.body
  )
}
