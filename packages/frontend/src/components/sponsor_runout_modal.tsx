// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { createPortal } from 'react-dom'
import { Zap } from 'lucide-react'
import { create } from 'zustand'

import { use_auth, type AuthState } from '../auth'
import { use_sponsor_allowance } from '../rpc/use_sponsor_allowance'

import { AddFundsModal } from './add_funds_modal'

// RUN-OUT MODAL — "your free daily gameplay is over". Shown when the connected player has
// spent their daily sponsor allowance; it offers the ONLY sanctioned continuation: top up and pay your own
// gas (an explicit click — we NEVER auto-spend the player's SUI), or wait out the countdown to the reset.
// It NEVER limits gameplay — past the allowance the player simply self-pays (which needs >0.2 SUI held, so
// a player seeing this modal is below that threshold and genuinely must top up to keep going).

// "Effectively out" = less than one sponsored tx of allowance left. This MIRRORS the sponsor's own refusal
// condition (api/sponsor.mjs refuses when spent + EST_GAS_MIST > cap, i.e. when remaining < EST_GAS_MIST),
// so the modal fires exactly when the next gameplay tx WOULD be refused — honest, never premature.
const EST_ONE_TX_MIST = 2_000_000n // ~0.002 SUI, mirrors SPONSOR_EST_GAS_MIST

// Open-state store. Reactive: the host syncs it from the polled allowance, with a dismiss latch so a closed
// modal doesn't reopen every poll. The latch clears when the allowance RECOVERS (top-up / UTC-midnight
// reset), so a later exhaustion can show it again. A refusal catch-site may also imperatively show() it.
interface RunoutState {
  open: boolean
  dismissed: boolean
  /** Imperative open (e.g. from a caught daily-cap refusal). Respects the dismiss latch. */
  show: () => void
  /** User closed it — latch shut until the allowance recovers. */
  dismiss: () => void
  /** Reactive: exhausted → open (unless latched); recovered → clear latch + close. */
  sync: (exhausted: boolean) => void
}
export const use_sponsor_runout = create<RunoutState>((set) => ({
  open: false,
  dismissed: false,
  show: () => set((s) => (s.dismissed ? s : { open: true })),
  dismiss: () => set({ open: false, dismissed: true }),
  sync: (exhausted) =>
    set((s) => {
      if (!exhausted) return s.open || s.dismissed ? { open: false, dismissed: false } : s
      return s.dismissed || s.open ? s : { open: true }
    }),
}))

function format_countdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}h ${pad(m)}m` : `${m}m ${pad(s)}s`
}

// Always-mounted host: watches the polled allowance and opens the modal when the player is effectively out
// of free gameplay. Renders nothing until then. Mount ONCE (app.tsx), beside <Toasts/>.
export function SponsorRunoutModalHost() {
  const allowance = use_sponsor_allowance()
  const open = use_sponsor_runout((s) => s.open)
  const sync = use_sponsor_runout((s) => s.sync)

  useEffect(() => {
    if (!allowance || allowance.resets_at == null) return // logged out / no data — don't touch open state
    sync(allowance.remaining_mist <= EST_ONE_TX_MIST)
  }, [allowance, sync])

  if (!open || !allowance || allowance.resets_at == null) return null
  return <SponsorRunoutModal resets_at={allowance.resets_at} />
}

function SponsorRunoutModal({ resets_at }: { resets_at: string }) {
  const { t } = useTranslation()
  const address = use_auth((s: AuthState) => s.address)
  const dismiss = use_sponsor_runout((s) => s.dismiss)
  const [show_add_funds, set_show_add_funds] = useState(false)
  const [now, set_now] = useState(() => Date.now())

  // Live countdown to the UTC-midnight reset (ticks each second).
  useEffect(() => {
    const id = setInterval(() => set_now(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  // Escape-to-close + body-scroll-lock (house modal behaviour, mirrors shop_success_modal).
  useEffect(() => {
    const on_key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dismiss()
    }
    window.addEventListener('keydown', on_key)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', on_key)
      document.body.style.overflow = prev
    }
  }, [dismiss])

  // "Top up & pay your own gas" → the existing Add Funds flow (the sanctioned self-pay path: add SUI, then
  // gameplay auto-self-pays). Closing it dismisses the run-out modal too.
  if (show_add_funds && address)
    return (
      <AddFundsModal
        address={address}
        on_close={() => {
          set_show_add_funds(false)
          dismiss()
        }}
      />
    )

  const countdown = format_countdown(new Date(resets_at).getTime() - now)

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }}
      onClick={(e) => {
        if (e.target === e.currentTarget) dismiss()
      }}
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
          <Zap size={34} style={{ color: '#c8963c', filter: 'drop-shadow(0 0 12px rgba(200,150,60,0.5))' }} />
          <div className="text-gradient text-[13px] font-semibold tracking-[0.28em] uppercase text-center">
            {t('sponsor.runout_title')}
          </div>

          <div className="w-full h-px bg-border" />

          <div className="text-text/70 text-[10px] tracking-wide text-center leading-relaxed">
            {t('sponsor.runout_body')}
          </div>
          <div className="text-muted text-[10px] tracking-[0.15em] uppercase font-mono tabular-nums">
            {t('sponsor.runout_resets_in', { countdown })}
          </div>

          <div className="flex gap-3 w-full mt-2">
            <button
              type="button"
              className="btn-gold flex-1 py-2.5 px-4 text-[10px] tracking-[0.15em] cursor-pointer"
              onClick={() => set_show_add_funds(true)}
            >
              {t('sponsor.runout_topup')}
            </button>
            <button
              type="button"
              className="btn-outline flex-1 py-2.5 px-4 text-[10px] tracking-[0.2em] cursor-pointer"
              onClick={dismiss}
            >
              {t('sponsor.runout_dismiss')}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}
