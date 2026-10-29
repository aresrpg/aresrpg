// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { BlastSnapshot } from '@aresrpg/sdk/blast'

import type { CopyText } from '../i18n/copy.ts'
import type { Locale } from '../i18n/locale.ts'
import type { KaresCopy } from '../kares/copy.ts'

import { blast_helmet, blast_wordmark } from './assets.ts'
import { countdown_text, sui_text } from './SalePanel.tsx'

const subline = (sale: BlastSnapshot, now: number, text: CopyText): string | null => {
  if (sale.phase === 'live') return text('sale_ends_in', { time: countdown_text(Number(sale.end_ms) - now, text) })
  if (sale.phase === 'soon' && sale.start_ms > 0n && Number(sale.start_ms) > now)
    return text('sale_opens_in', { time: countdown_text(Number(sale.start_ms) - now, text) })
  return null
}

export const SaleHero = ({
  sale,
  spots,
  now,
  text,
  kares,
  locale,
}: Readonly<{ sale: BlastSnapshot; spots: number; now: number; text: CopyText; kares: KaresCopy; locale: Locale }>) => {
  const detail = subline(sale, now, text)
  return (
    <div className="sale-hero">
      <span className="blast-badge">
        <img src={blast_helmet} alt="" />
        <img className="blast-word" src={blast_wordmark} alt="Blast" />
      </span>
      <p className="done-title">
        {spots && sale.phase === 'live' ? text('sale_spots_open') : kares[`blast_${sale.phase}`]}
      </p>
      {detail && <p className="deadline">{detail}</p>}
      {sale.phase !== 'soon' && sale.phase !== 'cancelled' && (
        <div className="sale-progress">
          <p>
            <span>
              {text('sale_raised')} <b>{sui_text(sale.committed, locale)}</b> / {sui_text(sale.target, locale)} SUI
            </span>
            <span>{new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(sale.progress_bps / 100)}%</span>
          </p>
          <span
            className="sale-track is-blast"
            role="progressbar"
            aria-label={kares.blast_progress}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={sale.progress_bps / 100}
          >
            <span style={{ width: `${sale.progress_bps / 100}%` }} />
          </span>
        </div>
      )}
    </div>
  )
}
