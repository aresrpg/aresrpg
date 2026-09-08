// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { ArrowUpRight, Check, Radio } from 'lucide-react'

import { KaresLogo } from '../components/KaresLogo.tsx'
import { env } from '../env.ts'
import type { AppCopy } from '../i18n/copy.ts'

import { countdown_parts, useCountdown } from './countdown.ts'
import type { KaresCopy } from './copy.ts'
import { format_amount, offering_phase, type FinanceSnapshot } from './model.ts'
import { useFinance } from './useFinance.ts'

import './public_sale_card.css'

const SaleFunding = ({ offering, copy }: Readonly<{ offering: FinanceSnapshot['offering']; copy: KaresCopy }>) => {
  const reached = offering.total_contributed >= offering.min_raise
  const excess = offering.total_contributed - offering.max_raise
  const funded_target = reached ? offering.min_raise : offering.total_contributed
  const progress = Number((funded_target * 10_000n) / offering.min_raise) / 100
  return (
    <span className="sale-card-funding">
      <span className="sale-card-micro">{copy.raised}</span>
      <strong className="sale-card-raised">
        {format_amount(offering.total_contributed, 9)} <small>SUI</small>
      </strong>
      <span className="sale-card-track" aria-hidden="true">
        <span style={{ width: `${progress}%` }} />
      </span>
      <span className="sale-card-target" data-reached={reached}>
        {reached ? (
          <>
            <Check size={11} aria-hidden="true" />
            {copy.sale_card_target_reached}
          </>
        ) : (
          <>
            {copy.minimum} · {format_amount(offering.min_raise, 9)} SUI
          </>
        )}
      </span>
      {excess > 0n && (
        <span className="sale-card-overflow">
          <span>{copy.oversubscribed}</span>
          <strong>+{format_amount(excess, 9)} SUI</strong>
        </span>
      )}
    </span>
  )
}

const SaleCountdown = ({ now, deadline, copy }: Readonly<{ now: bigint; deadline: bigint; copy: KaresCopy }>) => {
  const parts = countdown_parts(deadline - now)
  return (
    <span className="sale-card-countdown">
      <span className="sale-card-micro">{copy.closes_in}</span>
      <time aria-live="off" dateTime={new Date(Number(deadline)).toISOString()} role="timer">
        {parts.days}
        {copy.days_short} {parts.hours}:{parts.minutes}:{parts.seconds}
      </time>
    </span>
  )
}

export const PublicSaleCardView = ({
  copy: app_copy,
  snapshot,
}: Readonly<{ copy: AppCopy; snapshot: FinanceSnapshot | null }>) => {
  const copy = app_copy.kares_page
  const deadline = snapshot?.offering.started ? snapshot.offering.closes_ms : undefined
  const now = useCountdown(snapshot?.clock_ms ?? 0n, deadline)
  const phase = snapshot ? offering_phase({ ...snapshot, clock_ms: now }) : 'unknown'
  const active = phase === 'open'
  const completed = ['successful', 'refundable'].includes(phase)
  const presentation = {
    unknown: { title: copy.offering, note: copy.funding_unknown, action: copy.sale_card_soon_action },
    upcoming: { title: copy.sale_card_soon_title, note: copy.sale_card_soon_note, action: copy.sale_card_soon_action },
    open: { title: copy.sale_card_live_title, note: null, action: copy.contribute },
    successful: { title: copy.sale_card_done_title, note: copy.sale_card_done_note, action: copy.claim },
    refundable: { title: copy.sale_card_done_title, note: copy.sale_card_refund_note, action: copy.refund },
  }[phase]
  return (
    <a
      className="public-sale-card"
      data-public-sale-card=""
      data-phase={phase}
      href="https://launchpad.aresrpg.world/#contribute"
      rel="noopener noreferrer"
      target="_blank"
    >
      <span className="sale-card-atmosphere" aria-hidden="true" />
      <span className="sale-card-eyebrow">
        {active && <Radio size={11} aria-hidden="true" />}
        {active ? copy.sale_card_live_label : copy.offering}
      </span>
      <span className="sale-card-emblem">
        <KaresLogo size={56} />
        {completed && (
          <span className="sale-card-seal">
            <Check size={13} aria-hidden="true" />
          </span>
        )}
      </span>
      <strong className="sale-card-title">{presentation.title}</strong>
      {presentation.note && <span className="sale-card-note">{presentation.note}</span>}
      {active && snapshot && (
        <>
          <SaleFunding offering={snapshot.offering} copy={copy} />
          <SaleCountdown now={now} deadline={snapshot.offering.closes_ms} copy={copy} />
        </>
      )}
      <span className="sale-card-action">
        <span>{presentation.action}</span>
        <ArrowUpRight size={13} aria-hidden="true" />
      </span>
    </a>
  )
}

export const PublicSaleCard = ({ copy }: Readonly<{ copy: AppCopy }>) => {
  const { state } = useFinance({ network: env.network, rpc_url: env.sui_rpc_url })
  return <PublicSaleCardView copy={copy} snapshot={state.snapshot} />
}
