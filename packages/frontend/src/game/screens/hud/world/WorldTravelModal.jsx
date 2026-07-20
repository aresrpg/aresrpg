// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// WORLD TRAVEL MODAL — a modal with world cards, filtering, level gates, and resource/mob details — the destination picker the
// sidebar panel collapsed away. PURE VIEW: the caller derives the cards (world_travel_state.js — live /v1
// join gates + authored corpus knowledge) and owns every piece of state; this renders props and calls back.
//
// Portaled to <body> (the ConfirmDialog precedent): the switcher mounts inside a `.gw-panel`, and every
// .gw-panel sets `backdrop-filter` — which re-anchors `position: fixed` descendants to the panel instead of
// the viewport. Portaling out sidesteps any ancestor containing-block/stacking trap, for the mobile drawer
// mount too. Explicit colours out here (body is outside the HUD var scope — the pmenu/confirm idiom).
// House DNA: near-black glass, gold accents, JetBrains mono, uppercase micro-labels, sharp corners.

import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'

import { EncyclopediaLink } from '../../../../pages/encyclopedia/EncyclopediaLink'

/**
 * @param {{
 *   open: boolean,
 *   on_close: () => void,
 *   cards: import('./world_travel_state.js').WorldCard[],
 *   accessible_only: boolean,
 *   on_filter: (accessible_only: boolean) => void,
 *   can_travel: boolean,
 *   on_travel: (card: import('./world_travel_state.js').WorldCard) => void,
 * }} props
 * @returns {import('react').ReactElement | null}
 */
export function WorldTravelModal({ open, on_close, cards, accessible_only, on_filter, can_travel, on_travel }) {
  const { t } = useTranslation()

  // Esc closes, matching every other companion overlay (bound only while open).
  useEffect(() => {
    if (!open) return
    const on_key = /** @param {KeyboardEvent} e */ (e) => {
      if (e.key === 'Escape') on_close()
    }
    window.addEventListener('keydown', on_key)
    return () => window.removeEventListener('keydown', on_key)
  }, [open, on_close])

  if (!open) return null

  return createPortal(
    <div className="gw-travel__backdrop" onClick={on_close}>
      <div
        className="gw-travel"
        role="dialog"
        aria-modal="true"
        aria-label={t('world_switcher.title')}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="gw-travel__head">
          <div>
            <h2 className="gw-travel__title">{t('world_switcher.title')}</h2>
            <p className="gw-travel__sub">{t('world_switcher.modal_sub')}</p>
          </div>
          <button type="button" className="gw-travel__x" aria-label={t('common.cancel')} onClick={on_close}>
            ✕
          </button>
        </header>

        {/* The ONE light filter (deliberately light, not bloated): all worlds vs level-accessible. */}
        <div className="gw-travel__filters" role="group" aria-label={t('world_switcher.filter_accessible')}>
          <button
            type="button"
            className={`gw-travel__ftab${accessible_only ? '' : ' active'}`}
            onClick={() => on_filter(false)}
          >
            {t('world_switcher.filter_all')}
          </button>
          <button
            type="button"
            className={`gw-travel__ftab${accessible_only ? ' active' : ''}`}
            onClick={() => on_filter(true)}
          >
            {t('world_switcher.filter_accessible')}
          </button>
        </div>

        <div className="gw-travel__grid">
          {cards.map((card) => (
            <article key={card.id} className={`gw-travel__card${card.here ? ' here' : ''}${card.locked ? ' locked' : ''}`}>
              <div className="gw-travel__row">
                <span className="gw-travel__name">{card.label}</span>
                {/* The LIVE on-chain join gate (/v1 — zones::join_world asserts it). Null = not yet
                    projected → an honest gap, never a fabricated "Lv 1+". */}
                {card.required_level != null && (
                  <span className="gw-travel__gate">{t('world_switcher.level_req', { level: card.required_level })}</span>
                )}
              </div>
              {(card.biome || card.band) && (
                <div className="gw-travel__row gw-travel__meta">
                  {card.biome && <span className="gw-travel__biome">{card.biome.replace(/_/g, ' ')}</span>}
                  {card.band && (
                    <span className="gw-travel__band">
                      {t('world_switcher.level_band', { min: card.band[0], max: card.band[1] })}
                    </span>
                  )}
                </div>
              )}
              {/* Authored corpus knowledge (the encyclopedia's join) — mob roster / boss / gatherable counts.
                  A world with no corpus row simply shows nothing here (derived, never invented). */}
              {(card.mob_count != null || card.resource_count != null) && (
                // The mob/resource counts deep-link to this world's encyclopedia
                // detail via the ONE link idiom. `card.id` is the world object id the /encyclopedia/worlds/:id route
                // matches on; an id-less card degrades to a plain (non-clickable) row inside EncyclopediaLink.
                <EncyclopediaLink kind="world" id={card.id} className="gw-travel__facts">
                  {card.mob_count != null && <span>{t('world_switcher.mob_count', { count: card.mob_count })}</span>}
                  {card.boss_count ? <span>{t('world_switcher.boss_count', { count: card.boss_count })}</span> : null}
                  {card.resource_count != null && (
                    <span>{t('world_switcher.resource_count', { count: card.resource_count })}</span>
                  )}
                </EncyclopediaLink>
              )}
              <button
                type="button"
                className="gw-travel__go"
                disabled={card.here || card.locked || !can_travel}
                onClick={() => on_travel(card)}
              >
                {card.here
                  ? t('world_switcher.current')
                  : card.locked
                    ? t('world_switcher.level_req', { level: card.required_level })
                    : t('world_switcher.join')}
              </button>
            </article>
          ))}
          {cards.length === 0 && <p className="gw-travel__none">{t('world_switcher.filter_empty')}</p>}
        </div>
      </div>
    </div>,
    document.body
  )
}
