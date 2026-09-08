// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { useEffect, useLayoutEffect, useRef } from 'react'
import { Sparkles } from 'lucide-react'
import {
  countdown_parts,
  useCountdown,
  finance_empty_message,
  finance_label,
  offering_phase,
  format_amount,
  type FinanceInput,
  type FinanceState,
  type FinanceSnapshot,
  type KaresCopy,
} from '@aresrpg/frontend/finance'
import type { Locale } from '@aresrpg/frontend/locale'
import { FinanceStatus } from '@aresrpg/frontend/finance'

import { offering_preview, subscription_ratio } from './offering_model.ts'
import { SaleStages, RefundPromise } from './SaleStages.tsx'
import { InvestmentCards } from './InvestmentCards.tsx'
import { ContributionPanel } from './ContributionPanel.tsx'
import { env } from './env.ts'
import { FundingTrack } from './FundingTrack.tsx'
import { LaunchMarketCap } from './LaunchMarketCap.tsx'

export const FundingCountdown = ({
  snapshot,
  copy,
  dispatch,
}: Readonly<{ snapshot: FinanceSnapshot; copy: KaresCopy; dispatch: (input: FinanceInput) => void }>) => {
  const phase = offering_phase(snapshot)
  const targets = {
    upcoming: snapshot.offering.started ? snapshot.offering.opens_ms : undefined,
    open: snapshot.offering.closes_ms,
    successful: undefined,
    refundable: undefined,
  }
  const labels = {
    upcoming: snapshot.offering.started ? copy.opens_in : copy.upcoming,
    open: copy.closes_in,
    successful: copy.successful,
    refundable: copy.refundable,
  }
  const deadline = targets[phase]
  const now = useCountdown(snapshot.clock_ms, deadline)
  const expired = deadline !== undefined && now >= deadline
  useEffect(() => {
    if (expired) dispatch({ type: 'request', request: { kind: 'refresh' } })
  }, [dispatch, expired])
  if (deadline === undefined)
    return <span className="text-[10px] tracking-wider text-cyan uppercase">{labels[phase]}</span>
  const parts = countdown_parts(deadline - now)
  return (
    <div className="text-left sm:text-right">
      <p className={finance_label}>{labels[phase]}</p>
      <time
        aria-live="off"
        className="mt-2 block text-xl font-medium tracking-wide text-gold-light tabular-nums sm:text-2xl"
        dateTime={new Date(Number(deadline)).toISOString()}
        role="timer"
      >
        {parts.days}
        {copy.days_short} {parts.hours}:{parts.minutes}:{parts.seconds}
      </time>
    </div>
  )
}

const SaleContent = ({
  state,
  copy,
  dispatch,
  locale,
}: Readonly<{ state: FinanceState; copy: KaresCopy; locale: Locale; dispatch: (input: FinanceInput) => void }>) => {
  const { snapshot } = state
  if (!snapshot)
    return (
      <section
        aria-busy={!!state.request}
        className="mt-7 border border-gold/25 bg-surface-low/90 p-6 sm:p-8"
        data-funding-progress=""
        id="funding"
      >
        <h1 className="text-xl font-medium tracking-tight text-gold-light">{copy.offering}</h1>
        <p className="mt-5 text-xs leading-6 text-muted">{finance_empty_message(state, copy)}</p>
        <FundingTrack copy={copy} snapshot={null} />
        <SaleStages copy={copy} snapshot={null} />
        <RefundPromise copy={copy} snapshot={null} />
        <InvestmentCards copy={copy} state={state} />
        <div className="mt-4" id="contribute">
          <FinanceStatus copy={copy} network={env.network} state={state} />
        </div>
      </section>
    )
  const preview = offering_preview(snapshot)
  const demand_tone = preview.oversubscribed
    ? {
        panel: 'funding-panel-oversubscribed border-gold/55',
        badge: (
          <span className="inline-flex items-center gap-2 border border-gold/50 bg-gold/15 px-3 py-2 text-[10px] font-semibold text-gold">
            <Sparkles size={13} />
            {subscription_ratio(preview.subscription_hundredths)} {copy.oversubscribed}
          </span>
        ),
      }
    : { panel: 'border-gold/25', badge: null }

  return (
    <section
      className={`funding-panel relative mt-7 overflow-hidden border p-6 sm:p-8 ${demand_tone.panel}`}
      data-funding-progress=""
      id="funding"
      data-oversubscribed={preview.oversubscribed}
    >
      <div className="relative flex flex-wrap items-start justify-between gap-5">
        <div>
          <h1 className="text-xl font-medium tracking-tight text-gold-light">{copy.offering}</h1>
          <span
            className="mt-2 inline-block text-[9px] tracking-wider text-cyan uppercase"
            data-sale-phase={preview.phase}
          >
            {copy[preview.phase]}
          </span>
          <div className="mt-3 flex flex-wrap items-baseline gap-3">
            <strong className="text-4xl font-medium tracking-tight text-gold-light tabular-nums sm:text-5xl">
              {format_amount(preview.deposited)}
            </strong>
            <span className="text-sm text-muted">SUI</span>
            {demand_tone.badge}
          </div>
        </div>
        <div className="space-y-5 text-left sm:text-right">
          <LaunchMarketCap amount={preview.launch_market_cap} copy={copy} />
          <FundingCountdown copy={copy} dispatch={dispatch} snapshot={snapshot} />
        </div>
      </div>
      <FundingTrack copy={copy} snapshot={snapshot} />
      {preview.oversubscribed && preview.phase === 'open' && (
        <p className="relative mt-4 max-w-3xl text-[11px] leading-6 text-gold-light/80">{copy.oversub_note}</p>
      )}
      <SaleStages copy={copy} snapshot={snapshot} />
      <RefundPromise copy={copy} snapshot={snapshot} />
      <InvestmentCards copy={copy} state={state} />
      <div className="relative mt-6 border-t border-white/10 pt-6" id="contribute">
        <ContributionPanel copy={copy} dispatch={dispatch} locale={locale} snapshot={snapshot} state={state} />
        <div className="mt-4">
          <FinanceStatus copy={copy} network={env.network} state={state} />
        </div>
      </div>
    </section>
  )
}

export const SaleSection = (props: Parameters<typeof SaleContent>[0]) => {
  const container = useRef<HTMLDivElement>(null)
  const content = useRef<HTMLDivElement>(null)
  const last_height = useRef(0)
  const has_snapshot = !!props.state.snapshot
  useLayoutEffect(() => {
    const outer = container.current
    const inner = content.current
    if (!outer || !inner) return
    const resize = () => {
      const measured = inner.getBoundingClientRect().height
      // A certified receipt invalidates the data, not the space occupied by the sale.
      const height = has_snapshot ? measured : Math.max(last_height.current, measured)
      last_height.current = height
      outer.style.height = `${height}px`
    }
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(inner)
    return () => observer.disconnect()
  }, [has_snapshot])
  return (
    <div className="sale-size-transition" ref={container}>
      <div className="flow-root" ref={content}>
        <SaleContent {...props} />
      </div>
    </div>
  )
}
