// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Menu } from 'lucide-react'

import { NAV_ITEMS, visible_nav_items, type Page } from '../constants/navigation'
import { useNavigatePage, useActivePage } from '../hooks/use_navigate_page'

// MOBILE PAGE SWITCHER — replaces the bottom nav bar. Landscape-only mobile can't split
// its scarce 390px height with a bar, so navigation collapses to ONE glass handle at the right edge that
// shows the CURRENT section's icon. Tapping it unfolds the section set as a COMPACT ABSOLUTE cluster (a
// 2-column grid of icon tiles — only as tall as its items, never a full-height column; design ruling
// 2026-07-18) on top of everything; picking a section navigates and re-collapses. Tiles are icon-only with the
// translated destination name as their accessible label + hover title (v3-corner-glass language). Reuses
// NAV_ITEMS + the shared visible_nav_items filter (admin/disabled). Desktop keeps the Sidebar — not here.
export function MobileSwitcher() {
  const { t } = useTranslation()
  const active_page = useActivePage()
  const navigate = useNavigatePage()
  const [open, set_open] = useState(false)

  const items = visible_nav_items(NAV_ITEMS, { mobile: true })
  const active = items.find((item) => item.id === active_page)
  // The handle wears the active section's own glyph (real state, zero decorative readouts); a route that
  // isn't a switcher destination (e.g. admin hidden for a player) falls back to the generic menu icon.
  const HandleIcon = active?.Icon ?? Menu

  const pick = (id: Page) => {
    set_open(false)
    navigate(id)
  }

  return (
    <>
      <button
        type="button"
        data-mobile-switcher-handle
        aria-label={t('nav.navigation')}
        aria-expanded={open}
        onClick={() => set_open((value) => !value)}
        className="mobile-switcher-handle"
      >
        <HandleIcon size={19} />
        <span className="mobile-switcher-handle__dots" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
      </button>

      {open && (
        <>
          {/* An outside tap collapses the stack — a full-viewport transparent catcher, never a dim scrim. */}
          <button
            type="button"
            data-mobile-switcher-scrim
            aria-label={t('common.close')}
            className="mobile-switcher-scrim"
            onClick={() => set_open(false)}
          />
          <nav data-mobile-switcher-stack aria-label={t('nav.navigation')} className="mobile-switcher-stack">
            {items.map((item) => {
              const is_active = item.id === active_page
              const label = t(item.label)
              return (
                <button
                  key={item.id}
                  type="button"
                  data-nav={item.id}
                  aria-label={label}
                  title={label}
                  aria-current={is_active ? 'page' : undefined}
                  onClick={() => pick(item.id)}
                  className={`mobile-switcher-tile${is_active ? ' is-active' : ''}`}
                >
                  <item.Icon size={18} className="mobile-switcher-tile__icon" />
                </button>
              )
            })}
          </nav>
        </>
      )}
    </>
  )
}
