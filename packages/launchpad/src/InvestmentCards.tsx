// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { Coins, Ticket, Wallet } from 'lucide-react'
import {
  Metric,
  KaresLogo,
  SuiLogo,
  finance_button,
  format_amount,
  finance_empty_message,
  type FinanceState,
  type KaresCopy,
} from '@aresrpg/frontend/finance'
import { open_wallet_dialog } from '@aresrpg/frontend/finance'

import { offering_preview } from './offering_model.ts'

type Preview = ReturnType<typeof offering_preview>
const price_value = (preview: Preview | null) => {
  if (!preview || preview.price === null) return '—'
  const amount = preview.price === 0n ? '<0.000000001' : format_amount(preview.price, 9)
  return (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-2" data-price-quote="">
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-gold-light">
        <KaresLogo size={24} />
        <span>1 $KARES</span>
      </span>
      <span className="text-muted">=</span>
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-cyan">
        <SuiLogo size={18} />
        <span>{`${amount} $SUI`}</span>
      </span>
    </span>
  )
}
const participant_metrics = (preview: Preview | null, copy: KaresCopy, pending_note: string) => {
  if (!preview)
    return [
      { label: copy.your_investment, value: '—', note: pending_note },
      { label: copy.your_allocation, value: '—', note: pending_note },
    ]
  if (preview.phase === 'successful')
    return [
      { label: copy.claimable_tokens, value: `${format_amount(preview.tokens, 2)} KARES`, note: copy.unclaimed_note },
      { label: copy.refundable_sui, value: `${format_amount(preview.refund, 9)} SUI`, note: copy.unclaimed_note },
    ]
  if (preview.phase === 'refundable')
    return [
      { label: copy.full_refund, value: `${format_amount(preview.refund, 9)} SUI`, note: copy.refundable },
      { label: copy.your_allocation, value: '0 KARES', note: copy.refundable },
    ]
  return [
    { label: copy.your_investment, value: `${format_amount(preview.contribution, 9)} SUI`, note: copy.unclaimed_note },
    {
      label: copy.your_allocation,
      value: preview.allocation_ready ? `${format_amount(preview.tokens, 2)} KARES` : '—',
      note: preview.allocation_ready ? copy.estimated_until_close : copy.awaiting_minimum,
    },
  ]
}

export const InvestmentCards = ({ state, copy }: Readonly<{ state: FinanceState; copy: KaresCopy }>) => {
  const preview = state.snapshot ? offering_preview(state.snapshot) : null
  const participant = state.address ? participant_metrics(preview, copy, finance_empty_message(state, copy)) : []
  const price_status = preview?.price_status ?? 'unavailable'
  const price_labels = {
    unavailable: copy.current_price,
    preview: copy.current_price,
    final: copy.final_price,
    refunded: copy.current_price,
  }
  const price_notes = {
    unavailable: preview ? copy.awaiting_minimum : finance_empty_message(state, copy),
    preview: copy.price_cap_note,
    final: copy.price_cap_note,
    refunded: copy.refundable,
  }
  const rows = [
    ...participant,
    { label: price_labels[price_status], value: price_value(preview), note: price_notes[price_status] },
  ]
  const icons = [Wallet, Ticket, Coins]
  return (
    <section className="mt-5 grid gap-3 lg:grid-cols-3" data-investment-cards="">
      {!state.address && (
        <div className="flex items-center justify-center py-5 lg:col-span-2">
          <button aria-haspopup="dialog" className={finance_button} onClick={open_wallet_dialog} type="button">
            <Wallet size={16} />
            {copy.connect}
          </button>
        </div>
      )}
      {rows.map(({ label, value, note }, index) => {
        const Icon = state.address ? icons[index] : Coins
        return (
          <article className="border border-white/10 bg-surface-low/75 p-5" key={label}>
            <div className="mb-4 flex items-center gap-2 text-gold">
              <Icon size={16} />
            </div>
            <Metric label={label}>{value}</Metric>
            <p className="mt-3 text-[9px] leading-5 text-muted">{note}</p>
          </article>
        )
      })}
    </section>
  )
}
