// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { ArrowUpRight } from 'lucide-react'
import type { Locale } from '@aresrpg/frontend/locale'
import {
  AmountForm,
  Metric,
  finance_button,
  format_amount,
  type FinanceInput,
  type FinanceState,
  type FinanceSnapshot,
  type KaresCopy,
} from '@aresrpg/frontend/finance'

import { env } from './env.ts'
import { offering_preview } from './offering_model.ts'

const date_label = (
  timestamp: bigint,
  locale: Locale,
  offering: FinanceSnapshot['offering'],
  copy: KaresCopy
): string =>
  offering.started
    ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(Number(timestamp))
    : copy.upcoming

const token_claim_label = (copy: KaresCopy, refund: bigint): string => (refund > 0n ? copy.claim : copy.claim_kares)

export const ContributionPanel = ({
  state,
  dispatch,
  copy,
  locale,
  snapshot,
}: Readonly<{
  snapshot: FinanceSnapshot
  state: FinanceState
  dispatch: (input: FinanceInput) => void
  copy: KaresCopy
  locale: Locale
}>) => {
  const preview = offering_preview(snapshot)
  const { phase } = preview
  const { offering } = snapshot
  const balance = state.balances === null ? 0n : state.balances.sui_balance
  const claim_action = ({ upcoming: null, open: null, successful: 'claim_offering', refundable: 'refund' } as const)[
    phase
  ]
  return (
    <div className="space-y-6">
      {state.address && phase === 'open' ? (
        <AmountForm
          asset="SUI"
          balance={balance}
          disabled={!state.balances}
          busy={!!state.request}
          copy={copy}
          label={copy.contribute}
          submit={(amount) =>
            dispatch({ type: 'request', request: { kind: 'execute', action: { kind: 'contribute', amount } } })
          }
        />
      ) : (
        <p className="text-[11px] leading-6 text-muted">{copy[phase]}</p>
      )}
      {preview.contribution > 0n && preview.oversubscribed && (
        <section className="border-y border-white/10 py-5">
          <Metric label={copy.excess_refund}>{format_amount(preview.refund, 9)} SUI</Metric>
          <p className="mt-3 text-[9px] leading-5 text-muted">
            {phase === 'open' ? copy.estimated_until_close : copy.unclaimed_note}
          </p>
        </section>
      )}
      {claim_action && snapshot.contributions.length > 0 && (
        <button
          className={finance_button}
          data-finance-claim=""
          disabled={!!state.request}
          onClick={() =>
            dispatch({
              type: 'request',
              request: {
                kind: 'execute',
                action: { kind: claim_action, ids: snapshot.contributions.map(({ id }) => id) },
              },
            })
          }
          type="button"
        >
          {{ claim_offering: token_claim_label(copy, preview.refund), refund: copy.refund }[claim_action]}
        </button>
      )}
      <div className="space-y-3 text-[10px] leading-5">
        <div className="flex flex-wrap justify-between gap-2">
          <span className="text-muted">{copy.closes}</span>
          <span>{date_label(offering.closes_ms, locale, offering, copy)}</span>
        </div>
        <p className="text-muted">{copy.price_cap_note}</p>
      </div>
      <a
        className="inline-flex items-center gap-2 text-[9px] text-muted underline underline-offset-4 hover:text-cyan"
        href={`https://suiscan.xyz/${env.network}/object/${offering.id}`}
        rel="noreferrer"
        target="_blank"
      >
        {copy.offering_contract}
        <ArrowUpRight size={11} />
      </a>
    </div>
  )
}
