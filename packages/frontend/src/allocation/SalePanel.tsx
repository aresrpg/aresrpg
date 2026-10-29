// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { ReactNode } from 'react'
import { Check } from 'lucide-react'
import { blast_claim_preview, blast_tokens_for, type BlastCommitment, type BlastSnapshot } from '@aresrpg/sdk/blast'

import type { CopyText } from '../i18n/copy.ts'
import type { Locale } from '../i18n/locale.ts'
import { format_sui } from '../wallet_amount.ts'
import { explorer_transaction_url } from '../explorer.ts'
import { env } from '../env.ts'

import { spot_stage, type SaleState, type SpotStage } from './sale.ts'

export const sui_text = (mist: bigint, locale: Locale): string => format_sui(mist, 2, locale).replace(/[.,]00$/, '')
export const kares_text = (atomic: bigint, locale: Locale): string =>
  new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(Number(atomic / 1_000_000_000n))
export const countdown_text = (ms: number, text: CopyText): string => {
  const minutes = Math.max(0, Math.floor(ms / 60_000))
  return text('sale_countdown', {
    days: Math.floor(minutes / 1440),
    hours: Math.floor(minutes / 60) % 24,
    minutes: minutes % 60,
  })
}

const Row = ({ label, children }: Readonly<{ label: string; children: ReactNode }>) => (
  <p className="sale-row">
    <span>{label}</span>
    <i aria-hidden="true" />
    <span>{children}</span>
  </p>
)

export type SpotAction = Readonly<{ buy: () => void; claim: () => void; connect: () => void }>
type PanelProps = Readonly<{
  label: string
  cap: bigint
  sale: BlastSnapshot
  commitment: BlastCommitment | null | undefined
  balance: bigint | null
  signed: boolean
  ready: boolean
  busy: boolean
  state: SaleState
  address: string
  now: number
  text: CopyText
  locale: Locale
  act: SpotAction
}>
type StageProps = PanelProps & Readonly<{ stage: SpotStage }>

const SpotRows = ({ stage, sale, text, locale, cap, commitment, balance }: StageProps) => {
  const bought = commitment?.quote ?? 0n
  return (
    <>
      <div className="sale-bought">
        <Row label={text('sale_bought')}>
          <b>{sui_text(bought, locale)}</b> / {sui_text(cap, locale)} SUI
        </Row>
        <span className="sale-track" aria-hidden="true">
          <span style={{ width: `${Number((bought * 100n) / cap)}%` }} />
        </span>
      </div>
      {stage === 'full' ? (
        <Row label={text('sale_receive')}>
          <b>≈ {kares_text(blast_tokens_for(sale, bought), locale)} KARES</b>
        </Row>
      ) : (
        balance !== null && <Row label={text('sale_in_wallet')}>{sui_text(balance, locale)} SUI</Row>
      )}
    </>
  )
}
const ClaimRows = ({ sale, text, locale, commitment }: StageProps) => {
  const quote = commitment?.quote ?? 0n
  const preview = blast_claim_preview(sale, quote)
  if (!preview) return null
  return (
    <>
      {sale.phase === 'complete' ? (
        <Row label="KARES">
          <b>{kares_text(preview.tokens, locale)}</b>
        </Row>
      ) : (
        <Row label={text('sale_bought')}>{sui_text(quote, locale)} SUI</Row>
      )}
      <Row label={text('sale_refund')}>{sui_text(preview.refund, locale)} SUI</Row>
    </>
  )
}
const WaitingRows = ({ sale, text, locale, commitment }: StageProps) => (
  <>
    <Row label={text('sale_bought')}>{sui_text(commitment?.quote ?? 0n, locale)} SUI</Row>
    <Row label={text('sale_raised')}>
      {sui_text(sale.committed, locale)} / {sui_text(sale.target, locale)} SUI
    </Row>
  </>
)
const ROWS: Readonly<Record<SpotStage, ((props: StageProps) => ReactNode) | null>> = {
  soon: SpotRows,
  live: SpotRows,
  full: SpotRows,
  waiting: WaitingRows,
  claim: ClaimRows,
  settled: null,
  checking: null,
}

// Stages whose only action is to say what happens next.
const NOTES: Readonly<Partial<Record<SpotStage, string>>> = {
  full: 'sale_claim_after',
  waiting: 'sale_waiting',
  settled: 'sale_settled',
  checking: 'sale_checking',
}
const opening = ({ sale, now, text }: StageProps): string => {
  const wait = Number(sale.start_ms) - now
  return sale.start_ms > 0n && wait > 0
    ? text('sale_opens_in', { time: countdown_text(wait, text) })
    : text('sale_opens_soon')
}
const SignedAction = ({ stage, sale, text, locale, act, busy, ready, commitment }: StageProps) => {
  if (stage !== 'claim')
    return (
      <button className="btn sale-action is-blast" disabled={busy || !ready} onClick={act.buy}>
        {text(ready ? 'sale_buy' : 'sale_not_ready')}
      </button>
    )
  const refund = sale.phase === 'cancelled'
  return (
    <button className={`btn sale-action ${refund ? 'is-ink' : 'is-blast'}`} disabled={busy} onClick={act.claim}>
      {refund ? text('sale_claim_refund', { sui: sui_text(commitment?.quote ?? 0n, locale) }) : text('sale_claim')}
    </button>
  )
}
const Action = (props: StageProps) => {
  const { stage, text, label, act, busy } = props
  const note = NOTES[stage]
  if (note) return <p className="sale-note">{text(note)}</p>
  if (stage === 'soon')
    return (
      <button className="btn sale-action" disabled>
        {opening(props)}
      </button>
    )
  if (props.signed) return <SignedAction {...props} />
  return (
    <button className="btn sale-action" disabled={busy} onClick={act.connect}>
      {text(stage === 'claim' ? 'sale_connect_claim' : 'sale_connect_buy', { wallet: label })}
    </button>
  )
}

const Outcome = ({ state, address, text, locale }: StageProps) => {
  if (state.error?.address === address)
    return (
      <p className="sale-outcome is-error" role="alert">
        {text('sale_failed')}
      </p>
    )
  const { receipt } = state
  if (receipt?.address !== address) return null
  return (
    <p className="sale-outcome" role="status">
      <Check size={14} aria-hidden="true" />
      <span>
        {receipt.kind === 'buy'
          ? text('sale_committed', { sui: sui_text(receipt.amount, locale) })
          : text('sale_claimed')}
      </span>
      <a href={explorer_transaction_url(env.network, receipt.digest)} target="_blank" rel="noopener noreferrer">
        {text('sale_receipt')}
      </a>
    </p>
  )
}

export const SalePanel = (props: PanelProps) => {
  const stage = spot_stage(props.sale.phase, props.commitment, props.cap)
  const staged = { ...props, stage }
  const Rows = ROWS[stage]
  return (
    <section className="sale-panel" data-sale-stage={stage} aria-label={props.label}>
      <header>
        <b>{props.label}</b>
        <span className={props.signed ? 'is-signed' : ''}>
          {props.text(props.signed ? 'sale_signed' : 'sale_not_connected')}
        </span>
      </header>
      {Rows && <Rows {...staged} />}
      <Outcome {...staged} />
      <Action {...staged} />
    </section>
  )
}
