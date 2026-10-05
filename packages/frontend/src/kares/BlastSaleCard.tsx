// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { ArrowUpRight } from 'lucide-react'
import { useEffect, useMemo } from 'react'
import { useStore } from 'zustand'

import pilot from '../../../../seed/icons/branding/blast/pilot.png'
import helmet from '../../../../seed/icons/branding/blast/helmet.svg'
import wordmark from '../../../../seed/icons/branding/blast/wordmark.svg'
import { env } from '../env.ts'
import type { AppCopy } from '../i18n/copy.ts'
import { useNumbers } from '../i18n/useNumbers.ts'

import { blast_phase, create_blast_runtime, type BlastState } from './blast.ts'
import './blast.css'

export const BlastSaleCardView = ({ copy, state }: Readonly<{ copy: AppCopy; state: BlastState }>) => {
  const phase = blast_phase(state)
  const text = copy.kares_page
  const { sui, number } = useNumbers()
  const { snapshot } = state
  const show_progress = snapshot && ['live', 'closing', 'funded', 'complete'].includes(phase)
  return (
    <a className="blast-sale-card" data-blast-phase={phase} href={state.url} target="_blank" rel="noopener noreferrer">
      <img className="blast-sale-pilot" src={pilot} alt="" />
      <span className="blast-sale-brand">
        <img src={helmet} alt="" /> KARES <span>×</span>
        <img className="blast-sale-wordmark" src={wordmark} alt="Blast" />
      </span>
      <strong className="blast-sale-title">{text[`blast_${phase}`]}</strong>
      <span className="blast-sale-note">{text.blast_note}</span>
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
        {text.blast_action}
        <ArrowUpRight size={14} aria-hidden="true" />
      </span>
    </a>
  )
}

export const BlastSaleCard = ({ copy }: Readonly<{ copy: AppCopy }>) => {
  const runtime = useMemo(() => create_blast_runtime({ network: env.network, rpc_url: env.sui_rpc_url }), [])
  const state = useStore(runtime.store)
  useEffect(() => runtime.start(), [runtime])
  return <BlastSaleCardView copy={copy} state={state} />
}
