// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The world's ARTISAN COMMISSION modal — a world-tab overlay that MIRRORS DungeonsModal's mount: a
// store-flag-gated panel (`s.commissions_modal`, toggled by `action/commissions_modal`) rendered once in
// GameWorldHud, closing on backdrop click / the ✕ / Esc. Two views share the panel behind a tab row:
//   CUSTOMER  — pick an artisan, browse the recipes THAT artisan can craft, priced against your own kiosk
//               stock (greyed when you can't supply the ingredients), and REQUEST a craft with an optional
//               SUI payment.
//   ARTISAN   — the incoming commission queue (other players asking YOU to craft), each with ACCEPT CRAFT.
//
// CHAIN-DECOUPLED: every read/write lives behind commission_actions.js (mock data today) — the Move v2
// commission redesign runs in PARALLEL, so this UI is complete + demoable NOW. House DNA: near-black glass,
// gold primary, JetBrains mono, uppercase, sharp (reuses .gw-dg-backdrop + .gw-panel from game-world-hud.css).

import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useGameState, context } from '../../../../store.js'
import { CommissionCustomerView } from './CommissionCustomerView.jsx'
import { CommissionArtisanView } from './CommissionArtisanView.jsx'
import './commission.css'

const close = () => context.dispatch('action/commissions_modal', false)

/** @returns {import('react').JSX.Element | null} */
export function CommissionModal() {
  const { t } = useTranslation()
  const open = useGameState(s => s.commissions_modal)
  const [tab, set_tab] = useState(/** @type {'customer' | 'artisan'} */ ('customer'))

  // Esc closes, matching every other world overlay.
  useEffect(() => {
    if (!open) return undefined
    const on_key = /** @param {KeyboardEvent} e */ e => {
      if (e.code === 'Escape') close()
    }
    window.addEventListener('keydown', on_key)
    return () => window.removeEventListener('keydown', on_key)
  }, [open])

  // DEV opener — the REAL trigger is the artisan NPC (the parallel Move v2 lane wires it); this window hook
  // lets the harness drive the modal now for manual QA. DEV-gated + statically tree-shaken from prod, matching
  // GameWorldHud's __ARES_DEV_* convention. Nothing gameplay: it only flips the UI open flag.
  useEffect(() => {
    // ASI trap (2026-07-14 prod crash): a bare `return undefined` followed by a line opening with `(`
    // (the JSDoc cast) parses as `return undefined(window)...` — prod-only TypeError. Keep the cast
    // on its own const so no statement here ever starts with a parenthesis.
    if (!import.meta.env.DEV) return undefined
    const w = /** @type {any} */ (window)
    w.__ARES_DEV_OPEN_COMMISSIONS = () => context.dispatch('action/commissions_modal', true)
    return () => {
      Reflect.deleteProperty(w, '__ARES_DEV_OPEN_COMMISSIONS')
    }
  }, [])

  if (!open) return null

  return (
    <div className="gw-dg-backdrop" onClick={close}>
      <div className="gw-cm gw-panel" onClick={e => e.stopPropagation()}>
        <header className="gw-cm__head">
          <div>
            <h2 className="gw-cm__title">{t('commission.title')}</h2>
            <p className="gw-cm__sub">{t('commission.subtitle')}</p>
          </div>
          <button type="button" className="gw-cm__x" aria-label={t('commission.close')} onClick={close}>
            ✕
          </button>
        </header>

        <div className="gw-cm__tabs">
          <button
            type="button"
            className={`gw-cm__tab${tab === 'customer' ? ' is-active' : ''}`}
            onClick={() => set_tab('customer')}
          >
            {t('commission.tab_customer')}
          </button>
          <button
            type="button"
            className={`gw-cm__tab${tab === 'artisan' ? ' is-active' : ''}`}
            onClick={() => set_tab('artisan')}
          >
            {t('commission.tab_artisan')}
          </button>
        </div>

        {tab === 'customer' ? <CommissionCustomerView /> : <CommissionArtisanView />}
      </div>
    </div>
  )
}
