// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The home page's sale header: the in-game Blast card's facts on one line, present only while the
// sale is live. It reads the same sale state and sends buyers to the same allocation page.

import { ArrowUpRight } from 'lucide-react'

import { public_line, useMinuteClock } from '../allocation/clock.tsx'
import { copy_text, type AppCopy } from '../i18n/copy.ts'
import { useNumbers } from '../i18n/useNumbers.ts'

import { blast_phase, type BlastState } from './blast.ts'
import { useBlastSale } from './useBlastSale.ts'
import './blast.css'

const wordmark = '/branding/blast/wordmark.svg'

export const BlastSaleBarView = ({ copy, state, now }: Readonly<{ copy: AppCopy; state: BlastState; now: number }>) => {
  const { sui, number } = useNumbers()
  const { snapshot } = state
  if (blast_phase(state) !== 'live' || !snapshot) return null
  const text = copy.kares_page
  const percent = snapshot.progress_bps / 100
  const everyone = public_line(snapshot, now, copy_text(copy.allocation_page))
  return (
    <a className="blast-sale-bar" href="/allocation">
      <span className="blast-sale-bar-brand">
        KARES <span>×</span>
        <img src={wordmark} alt="Blast" />
      </span>
      <strong>{text.blast_live}</strong>
      <span className="blast-sale-bar-funding">
        {sui(snapshot.committed, 0)} / {sui(snapshot.target, 0)} SUI · {number(percent, { maximumFractionDigits: 1 })}%
      </span>
      <span
        className="blast-sale-bar-track"
        role="progressbar"
        aria-label={text.blast_progress}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
      >
        <span style={{ width: `${percent}%` }} />
      </span>
      {everyone && <span className="blast-sale-bar-funding">{everyone}</span>}
      <span className="blast-sale-bar-action">
        {copy.allocation_page.sale_buy}
        <ArrowUpRight size={14} aria-hidden="true" />
      </span>
    </a>
  )
}

const BlastSaleBar = ({ copy }: Readonly<{ copy: AppCopy }>) => (
  <BlastSaleBarView copy={copy} state={useBlastSale()} now={useMinuteClock()} />
)
export default BlastSaleBar
