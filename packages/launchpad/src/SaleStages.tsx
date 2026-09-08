// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { Check, ShieldCheck } from 'lucide-react'
import type { FinanceSnapshot, KaresCopy } from '@aresrpg/frontend/finance'

import { offering_preview } from './offering_model.ts'

export const sale_stage = (snapshot: FinanceSnapshot): number => {
  const preview = offering_preview(snapshot)
  if (!preview.minimum_met) return 0
  return preview.oversubscribed ? 2 : 1
}

export const SaleStages = ({ snapshot, copy }: Readonly<{ snapshot: FinanceSnapshot | null; copy: KaresCopy }>) => {
  const preview = snapshot ? offering_preview(snapshot) : null
  const active = preview?.phase === 'open' && snapshot ? sale_stage(snapshot) : -1
  const completed = [
    preview?.minimum_met,
    preview && preview.deposited >= snapshot!.offering.max_raise,
    preview?.oversubscribed,
  ]
  return (
    <ol className="relative mt-6 grid gap-2 sm:grid-cols-3" data-sale-stages="">
      {[copy.stage_minimum, copy.stage_maximum, copy.oversubscribed].map((label, index) => (
        <li
          aria-current={active === index ? 'step' : undefined}
          data-reached={!!completed[index]}
          className="sale-stage flex min-h-12 items-center gap-3 border border-white/10 bg-black/10 px-3 py-3 text-[10px] text-muted"
          key={label}
        >
          <span className="grid size-6 shrink-0 place-items-center border border-current/25 text-[9px]">
            {completed[index] ? <Check size={12} /> : index + 1}
          </span>
          <span>{label}</span>
        </li>
      ))}
    </ol>
  )
}

export const RefundPromise = ({ snapshot, copy }: Readonly<{ snapshot: FinanceSnapshot | null; copy: KaresCopy }>) => {
  const preview = snapshot ? offering_preview(snapshot) : null
  if (preview?.minimum_met) return null
  const refundable = preview?.phase === 'refundable'
  return (
    <div className="relative mt-5 flex gap-3 border border-cyan/25 bg-cyan/5 px-4 py-4" data-refund-promise="">
      <ShieldCheck className="mt-0.5 shrink-0 text-cyan" size={18} />
      <div>
        <p className="text-[11px] font-medium text-cyan">
          {refundable ? copy.full_refund_available : copy.minimum_refund}
        </p>
        <p className="mt-2 text-[9px] leading-5 text-muted">{copy.refund_claim_note}</p>
      </div>
    </div>
  )
}
