// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { Zap } from 'lucide-react'
import { useCallback, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'

import { use_auth, type AuthState } from '../auth'
import { SELF_PAY_THRESHOLD_MIST } from '../chain/money_route'
import { use_sponsor_allowance } from '../rpc/use_sponsor_allowance'
import { rolling_gas_spend_mist, subscribe_gas_spend } from '../tx/gas_spend_ledger'
import { format_mist_to_sui } from '../utils/sui_mist'

import { GasSpentLine } from './gas_spent_line'

// SponsorAllowanceBar — the sidebar sponsored-transaction-fee gauge (Claude-usage-limit style): a compact
// gold/mono card under the wallet showing `remaining / allowance SUI` of the daily sponsor allowance,
// with a thin fuel bar that depletes gold → amber → red and the reset time on hover. Renders nothing
// when logged out. Display-only: the sponsor enforces the real cap; past it the player simply self-pays.
//
// SELF-PAY STATE (the gauge sat at "1.00 / 1.00" all session for a self-pay wallet — confusing): a wallet
// holding > SELF_PAY_THRESHOLD_MIST ALWAYS self-pays gameplay gas — the sponsor refuses it outright — so the
// allowance never moves for a funded wallet. That's mechanically correct, just illegible, so above the
// threshold the gauge dims and swaps its label instead of sitting at a misleading static full bar.
// (A ≤0.2 SUI wallet hitting a separate client routing bug never reached the sponsor at all — fixed in
// another lane. This dim/active split is orthogonal to that fix and still correct: it keys purely on the
// wallet's OWN balance vs the sponsor's threshold, nothing else.)
// Reuses the SAME wallet-balance store the sidebar WalletBar reads (no new fetch).
export function SponsorAllowanceBar() {
  const { t } = useTranslation()
  const allowance = use_sponsor_allowance()
  const balance_mist = use_auth((s: AuthState) => s.sui_balance_mist)
  const address = use_auth((s: AuthState) => s.address)
  const read_spent_mist = useCallback(() => rolling_gas_spend_mist(address), [address])
  const spent_mist = useSyncExternalStore(subscribe_gas_spend, read_spent_mist, () => 0n)
  if (!allowance) return null // logged out

  const { allowance_mist, remaining_mist, resets_at } = allowance
  const known = resets_at != null // real data loaded (null while first-loading or after a failed poll)
  const self_paying = balance_mist != null && balance_mist > SELF_PAY_THRESHOLD_MIST
  const pct = allowance_mist > 0n ? Number((remaining_mist * 100n) / allowance_mist) : 0
  // Fuel colour: healthy gold, running-low amber, depleted red — mirrors the depletion, not the spend.
  const color = pct > 33 ? '#c8963c' : pct > 0 ? '#f59e0b' : '#ef4444'
  const hover_title = self_paying
    ? t('sponsor.self_pay_tooltip', { threshold: format_mist_to_sui(SELF_PAY_THRESHOLD_MIST, 2) })
    : resets_at != null
      ? t('sponsor.active_tooltip', {
          time: new Date(resets_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        })
      : ''

  return (
    <div
      className={`border border-border bg-surface/40 p-2.5 flex flex-col gap-1.5${self_paying ? ' opacity-50' : ''}`}
      title={hover_title}
    >
      <div className="flex flex-col gap-0.5">
        <div className="flex min-w-0 items-center gap-1.5">
          <Zap size={11} className="text-gold opacity-60 shrink-0" />
          <span className="min-w-0 text-gold/80 text-[8px] leading-[1.35] tracking-[0.08em] uppercase font-mono">
            {self_paying ? t('sponsor.self_pay_label') : t('sponsor.free_gameplay')}
          </span>
        </div>
        {/* Design ruling 2026-07-15: a self-paying wallet shows NO allowance fraction and NO fuel bar — the sponsor gauge
            is meaningless when you spend your own SUI; the card keeps the label + the real spend line only. */}
        {!self_paying && (
          <span className="text-right text-text text-[10px] font-mono tabular-nums whitespace-nowrap">
            {known
              ? `${format_mist_to_sui(remaining_mist, 2)} / ${format_mist_to_sui(allowance_mist, 2)}`
              : '--- / ---'}
          </span>
        )}
      </div>
      {!self_paying && (
        <div className="h-1 w-full bg-border/60 overflow-hidden">
          {known && (
            <div
              className="h-full transition-all duration-500"
              style={{ width: `${pct}%`, background: color, boxShadow: `0 0 6px ${color}80` }}
            />
          )}
        </div>
      )}
      <GasSpentLine spent_mist={spent_mist} />
    </div>
  )
}
