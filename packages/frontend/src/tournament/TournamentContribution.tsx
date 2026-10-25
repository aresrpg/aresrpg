// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { useState } from 'react'
import { Button } from '@aresrpg/ui'
import { resolve_pins } from '@aresrpg/sdk/pins'
import type { TournamentRow } from '@aresrpg/protocol'

import { env } from '../env.ts'
import { useNumbers } from '../i18n/useNumbers.ts'
import type { CopyText } from '../i18n/copy.ts'
import { parse_kolizeum_pledge } from '../modules/kolizeum.ts'
import { action_key } from '../modules/tournament.ts'

import { TournamentDialog, TournamentOperationNotice } from './TournamentControls.tsx'
import { tournament_act, operation_status } from './presentation.ts'
import type { TournamentView } from './useTournamentView.ts'

type Contribution = Readonly<{ asset: 'sui' | 'kares'; amount: bigint; submitted: boolean }>

const ContributionReview = ({
  row,
  view,
  review,
  update,
  close,
  t,
}: Readonly<{
  row: TournamentRow
  view: TournamentView
  review: Contribution
  update: (review: Contribution) => void
  close: () => void
  t: CopyText
}>) => {
  const numbers = useNumbers()
  const action = { kind: 'donate' as const, asset: review.asset, amount: review.amount }
  const key = action_key(row, action)
  const status = operation_status(view.tournament, key, review.submitted)
  const confirmed = status.phase === 'confirmed'
  const can_confirm = [view.can_register, !review.submitted || status.phase === 'failed'].every(Boolean)
  const pool = BigInt(review.asset === 'sui' ? row.sui_pool : row.token_pool)
  return (
    <TournamentDialog title={t('contribution_review')} close={close} t={t}>
      <h3>{row.name}</h3>
      <strong className="tourney-review-amount">
        {numbers.sui(review.amount, 9)} {review.asset.toUpperCase()}
      </strong>
      {!review.submitted && (
        <p>{t('pool_after', { amount: numbers.sui(pool + review.amount, 9), asset: review.asset.toUpperCase() })}</p>
      )}
      <p>{t('donation_notice')}</p>
      <p className="tourney-note">{t('organizer_address', { address: row.organizer })}</p>
      <TournamentOperationNotice status={status} t={t} confirmed="contribution_confirmed" />
      {view.registration_expired && <p role="status">{t('reason_closed')}</p>}
      <footer className="tourney-dialog-actions">
        <Button onClick={close}>{t(confirmed ? 'close' : 'cancel')}</Button>
        {!confirmed && (
          <Button
            tone="primary"
            disabled={!can_confirm}
            onClick={() => {
              update({ ...review, submitted: true })
              tournament_act(row.id, action)
            }}
          >
            {t('confirm')}
          </Button>
        )}
      </footer>
    </TournamentDialog>
  )
}

export const TournamentContribution = ({
  row,
  view,
  t,
}: Readonly<{ row: TournamentRow; view: TournamentView; t: CopyText }>) => {
  const [asset, set_asset] = useState<'sui' | 'kares'>('sui')
  const [amount, set_amount] = useState('')
  const [review, set_review] = useState<Contribution | null>(null)
  const value = parse_kolizeum_pledge(amount)
  const token_available = Boolean(resolve_pins(env.network).kares_coin_type)
  const enabled = view.can_register
  return (
    <section className="tourney-contribution">
      <div>
        <h3>{t('donate')}</h3>
        <p>{t('donation_notice')}</p>
      </div>
      <div className="tourney-contribution-fields">
        <label className="aui-field">
          {t('asset')}
          <select value={asset} onChange={(e) => set_asset(e.target.value === 'sui' ? 'sui' : 'kares')}>
            <option value="sui">SUI</option>
            <option value="kares" disabled={!token_available}>
              KARES
            </option>
          </select>
        </label>
        <label className="aui-field">
          {t('amount')}
          <input inputMode="decimal" value={amount} onChange={(e) => set_amount(e.target.value)} />
        </label>
        <Button
          tone="primary"
          disabled={!enabled || value === null || value <= 0n || (asset === 'kares' && !token_available)}
          onClick={() => value !== null && set_review({ asset, amount: value, submitted: false })}
        >
          {t('donate')}
        </Button>
      </div>
      {!token_available && <p className="tourney-note">{t('token_unavailable')}</p>}
      {review && (
        <ContributionReview
          row={row}
          view={view}
          review={review}
          update={set_review}
          close={() => set_review(null)}
          t={t}
        />
      )}
    </section>
  )
}
