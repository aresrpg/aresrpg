// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { createPortal } from 'react-dom'
import { RefreshCw } from 'lucide-react'

import { use_game_state } from '../game/store.js'

// STRICT SPONSOR UPGRADE modal. A retired-package refusal latches its state through the engine reducer; this
// host only projects that state. Blocking by design: refreshing onto the latest package is the sole safe exit.
export function SponsorUpgradeModalHost() {
  const upgrade_required = use_game_state((state) => state.sponsor_upgrade_required)

  if (!upgrade_required) return null
  return <SponsorUpgradeModal />
}

function SponsorUpgradeModal() {
  const { t } = useTranslation()

  useEffect(() => {
    const previous_overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous_overflow
    }
  }, [])

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center"
      style={{ backgroundColor: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(6px)' }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="sponsor-upgrade-title"
      aria-describedby="sponsor-upgrade-body"
    >
      <div
        className="bg-surface w-full max-w-md mx-4"
        style={{
          animation: 'modal-enter 0.3s ease-out',
          border: '1px solid var(--color-border)',
          borderImage: 'linear-gradient(135deg, #c8963c, #8b6914, #f5d0a9) 1',
          boxShadow: '0 0 30px rgba(200,150,60,0.12), inset 0 0 30px rgba(200,150,60,0.03)',
        }}
      >
        <div className="flex flex-col items-center px-8 py-8 gap-5">
          <RefreshCw size={34} style={{ color: '#c8963c', filter: 'drop-shadow(0 0 12px rgba(200,150,60,0.5))' }} />
          <div
            id="sponsor-upgrade-title"
            className="text-gradient text-[13px] font-semibold tracking-[0.28em] uppercase text-center"
          >
            {t('sponsor.upgrade_title')}
          </div>

          <div className="w-full h-px bg-border" />

          <div id="sponsor-upgrade-body" className="text-text/70 text-[10px] tracking-wide text-center leading-relaxed">
            {t('sponsor.upgrade_body')}
          </div>

          <button
            type="button"
            className="btn-gold w-full mt-2 py-2.5 px-4 text-[10px] tracking-[0.15em] cursor-pointer flex items-center justify-center gap-1.5"
            onClick={() => window.location.reload()}
          >
            <RefreshCw size={11} />
            {t('sponsor.upgrade_refresh')}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
