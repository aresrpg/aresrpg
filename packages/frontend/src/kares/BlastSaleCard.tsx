// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { ArrowUpRight } from 'lucide-react'

import pilot from '../../../../seed/icons/branding/blast/pilot.png'
import helmet from '../../../../seed/icons/branding/blast/helmet.svg'
import wordmark from '../../../../seed/icons/branding/blast/wordmark.svg'
import type { AppCopy } from '../i18n/copy.ts'
import { useNumbers } from '../i18n/useNumbers.ts'

import { blast_phase, type BlastState } from './blast.ts'
import { useBlastSale } from './useBlastSale.ts'
import './blast.css'

export const BlastSaleCardView = ({ copy, state }: Readonly<{ copy: AppCopy; state: BlastState }>) => {
  const phase = blast_phase(state)
  const text = copy.kares_page
  const { sui, number } = useNumbers()
  const destination =
    phase === 'soon'
      ? {
          href: '/allocation',
          title: copy.allocation_page.menu_title,
          note: copy.allocation_page.menu_note,
          action: copy.allocation_page.menu_action,
          target: undefined,
        }
      : {
          href: state.url,
          title: text[`blast_${phase}`],
          note: text.blast_note,
          action: text.blast_action,
          target: '_blank',
        }
  const { snapshot } = state
  const show_progress = snapshot && ['live', 'closing', 'funded', 'complete'].includes(phase)
  return (
    <a
      className="blast-sale-card"
      data-blast-phase={phase}
      href={destination.href}
      target={destination.target}
      rel="noopener noreferrer"
    >
      <img className="blast-sale-pilot" src={pilot} alt="" />
      <span className="blast-sale-brand">
        <img src={helmet} alt="" /> KARES <span>×</span>
        <img className="blast-sale-wordmark" src={wordmark} alt="Blast" />
      </span>
      <strong className="blast-sale-title">{destination.title}</strong>
      <span className="blast-sale-note">{destination.note}</span>
      {show_progress && (
        <span className="blast-sale-funding">
          <span className="blast-sale-amount">
            <span>
              {sui(snapshot.committed)} / {sui(snapshot.target)} SUI
            </span>
            <span>{number(snapshot.progress_bps / 100, { maximumFractionDigits: 1 })}%</span>
          </span>
          <span
            className="blast-sale-track"
            role="progressbar"
            aria-label={text.blast_progress}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={snapshot.progress_bps / 100}
          >
            <span style={{ width: `${snapshot.progress_bps / 100}%` }} />
          </span>
        </span>
      )}
      <span className="blast-sale-action">
        {destination.action}
        <ArrowUpRight size={14} aria-hidden="true" />
      </span>
    </a>
  )
}

export const BlastSaleCard = ({ copy }: Readonly<{ copy: AppCopy }>) => {
  const state = useBlastSale()
  return <BlastSaleCardView copy={copy} state={state} />
}
