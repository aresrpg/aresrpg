// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { CSSProperties } from 'react'
import { Check, ChevronsRight } from 'lucide-react'
import { format_amount, type FinanceSnapshot, type KaresCopy } from '@aresrpg/frontend/finance'

import { offering_preview } from './offering_model.ts'
import { FundingTexture } from './FundingTexture.tsx'

export const funding_track_view = (snapshot: FinanceSnapshot | null) => {
  if (!snapshot)
    return {
      known: false,
      progress: undefined,
      position: 0,
      minimum_position: 0,
      minimum_line: false,
      minimum_met: false,
      oversubscribed: false,
      minimum: '—',
      cap: '—',
      percent: '—',
      excess: null,
    }
  const preview = offering_preview(snapshot)
  return {
    known: true,
    progress: preview.progress,
    position: preview.progress,
    minimum_position: preview.minimum_marker,
    minimum_line: true,
    minimum_met: preview.minimum_met,
    oversubscribed: preview.oversubscribed,
    minimum: `${format_amount(snapshot.offering.min_raise)} SUI`,
    cap: `${format_amount(snapshot.offering.max_raise)} SUI`,
    percent: `${preview.subscription_hundredths}%`,
    excess: preview.oversubscribed ? `${format_amount(preview.deposited - preview.accepted, 9)} SUI` : null,
  }
}

export const FundingTrack = ({ snapshot, copy }: Readonly<{ snapshot: FinanceSnapshot | null; copy: KaresCopy }>) => {
  const track = funding_track_view(snapshot)
  const unknown = track.known ? undefined : copy.funding_unknown
  return (
    <div
      className="funding-track relative mt-7"
      data-funding-known={track.known}
      data-minimum-reached={track.minimum_met}
      data-oversubscribed={track.oversubscribed}
    >
      <div className="mb-4 flex items-baseline justify-between gap-4">
        <span className="text-xs text-muted">{copy.raised}</span>
        <span className="text-right">
          <strong className="text-2xl font-medium text-gold-light tabular-nums">{track.percent}</strong>
          <span className="ml-2 text-[11px] text-muted">{copy.subscribed}</span>
        </span>
      </div>
      <div className="relative">
        <div
          aria-label={copy.offering}
          aria-valuemax={100}
          aria-valuemin={0}
          aria-valuenow={track.progress}
          aria-valuetext={unknown}
          className="relative h-12 overflow-hidden border border-white/20 bg-black/40 shadow-[inset_0_2px_10px_#0005]"
          role="progressbar"
          title={unknown}
        >
          <div
            className="funding-fill relative h-full overflow-hidden"
            style={{ width: `${track.position}%`, '--funding-gold': `${track.position}%` } as CSSProperties}
          >
            {track.position > 0 && <FundingTexture progress={track.position} />}
          </div>
        </div>
        {track.minimum_line && (
          <span aria-hidden="true" className="funding-success-marker" style={{ left: `${track.minimum_position}%` }} />
        )}
        <span aria-hidden="true" className="funding-playhead" style={{ left: `${track.position}%` }} />
        <span
          aria-hidden="true"
          className="absolute right-0 top-0 flex h-12 items-center border-r-2 border-purple-200/65 pr-2 text-purple-100/70"
        >
          <ChevronsRight size={18} />
        </span>
      </div>
      <div className="mt-5 grid grid-cols-2 gap-5">
        <div className="funding-success-label">
          <div className="flex items-center gap-2 text-base font-semibold tabular-nums sm:text-lg">
            <Check size={16} />
            {track.minimum}
          </div>
          <p className="mt-1 text-[11px] leading-5">{copy.success_threshold}</p>
        </div>
        <div className="text-right">
          <div className="text-base font-semibold text-text tabular-nums sm:text-lg">{track.cap}</div>
          <p className="mt-1 text-[11px] leading-5 text-muted">{copy.sale_cap}</p>
        </div>
      </div>
      {track.excess && (
        <div className="mt-5 flex flex-wrap items-baseline gap-x-3 gap-y-1 border border-purple-200/30 bg-purple-200/8 px-4 py-3">
          <span className="text-[10px] tracking-wider text-purple-200 uppercase">{copy.cap_overflow}</span>
          <strong className="text-base text-purple-100 tabular-nums">{track.excess}</strong>
          <span className="text-[11px] text-muted">{copy.overflow_refunds}</span>
        </div>
      )}
    </div>
  )
}
