// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { useState } from 'react'
import { Button } from '@aresrpg/ui'
import { resolve_pins } from '@aresrpg/sdk/pins'
import type { TournamentRow } from '@aresrpg/protocol'

import { env } from '../env.ts'
import { dispatch_app, useAppStore } from '../store.ts'
import { copy_text, type CopyText } from '../i18n/copy.ts'
import { AdminWalletControl } from '../admin/AdminWalletControl.tsx'
import type { TournamentAdminAction } from '../modules/tournament.ts'
import { minimum_tournament_teams, tournament_registration } from '../modules/tournament_selectors.ts'

import { TournamentDialog, TournamentOperationNotice } from './TournamentControls.tsx'
import { TournamentReward } from './TournamentReward.tsx'
import { TournamentSettingsForm } from './TournamentSettingsForm.tsx'
import { useTournamentView, type TournamentView } from './useTournamentView.ts'
import { operation_status } from './presentation.ts'
import './tournament.css'

type Review = Readonly<{ action: TournamentAdminAction; row: TournamentRow | null; submitted: boolean }>
const ACTION_LABELS = {
  display: 'setup_display',
  create: 'create_event',
  start: 'start',
  cancel: 'cancel_event',
} as const

const ReviewDetails = ({ review, t }: Readonly<{ review: Review; t: CopyText }>) => {
  const { action, row } = review
  if (action.kind === 'display') return <p>{t('display_notice')}</p>
  if (action.kind !== 'create') {
    if (!row) return null
    const counts = tournament_registration(row)
    const excluded = row.teams.filter((team) => team.seats.length > 0 && team.seats.length < row.format)
    return (
      <>
        <h3>{row.name}</h3>
        {action.kind === 'start' && (
          <>
            <p>{t('team_counts', { teams: counts.teams, complete: counts.complete, minimum: counts.minimum })}</p>
            <p>{t('start_review')}</p>
            <p>{t('excluded_teams', { teams: excluded.map((team) => team.name).join(', ') || t('none_excluded') })}</p>
          </>
        )}
        {action.kind === 'cancel' && <p>{t('cancel_review')}</p>}
        <p className="tourney-note">{t('organizer_address', { address: row.organizer })}</p>
      </>
    )
  }
  const { settings } = action
  return (
    <div className="tourney-admin-review">
      <h3>{settings.name}</h3>
      <dl>
        <dt>{t('format')}</dt>
        <dd>
          {settings.format}v{settings.format}
        </dd>
        <dt>{t('deadline')}</dt>
        <dd>
          {new Date(settings.start_before_ms).toLocaleString()} ({Intl.DateTimeFormat().resolvedOptions().timeZone})
        </dd>
        <dt>{t('minimum_label')}</dt>
        <dd>{minimum_tournament_teams(settings)}</dd>
      </dl>
      <table className="tourney-admin-split">
        <thead>
          <tr>
            <th>{t('place')}</th>
            <th>SUI %</th>
            <th>KARES %</th>
          </tr>
        </thead>
        <tbody>
          {settings.sui_bps.map((bps, index) => (
            <tr key={index}>
              <td>{index === 4 ? t('joint_fifth') : index + 1}</td>
              <td>{bps / 100}</td>
              <td>{settings.token_bps[index] / 100}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {settings.rewards.map((reward, index) => (
        <div key={index}>
          <small>{t('place_number', { place: reward.place })}</small>
          <TournamentReward template={reward.template} amount={reward.amount} />
        </div>
      ))}
      <p>{t('immutable_notice')}</p>
      <p>{t('minimum_notice')}</p>
      <p>{t('recipient_notice')}</p>
      <p>{t('donation_notice')}</p>
    </div>
  )
}

const reviewed_action_available = (review: Review, view: TournamentView): boolean => {
  const now = view.viewer.now_ms
  if (review.action.kind === 'create') return now !== null && review.action.settings.start_before_ms > now
  if (review.action.kind === 'display') return true
  const { id } = review.action
  const current = view.tournament.rows.find((row) => row.id === id)
  if (!current) return false
  const unchanged = [current.version === review.row?.version, current.status === 'open'].every(Boolean)
  const counts = tournament_registration(current)
  const before_start = [
    now !== null,
    (now ?? Infinity) < current.start_before_ms,
    counts.complete >= counts.minimum,
  ].every(Boolean)
  return [unchanged, review.action.kind === 'cancel' || before_start].every(Boolean)
}

const AdminReview = ({
  review,
  update,
  close,
  view,
  disabled,
  t,
}: Readonly<{
  review: Review
  update: (review: Review) => void
  close: () => void
  view: TournamentView
  disabled: boolean
  t: CopyText
}>) => {
  const status = operation_status(view.tournament, 'admin', review.submitted)
  const confirmed = status.phase === 'confirmed'
  const available = reviewed_action_available(review, view)
  const can_confirm = [!disabled, available, !review.submitted || status.phase === 'failed'].every(Boolean)
  return (
    <TournamentDialog title={`${t('confirm')} · ${t(ACTION_LABELS[review.action.kind])}`} close={close} t={t}>
      <ReviewDetails review={review} t={t} />
      <TournamentOperationNotice status={status} t={t} confirmed="transaction_confirmed" />
      {!available && !review.submitted && <p role="alert">{t('review_changed')}</p>}
      <footer className="tourney-dialog-actions">
        <Button onClick={close}>{t(confirmed ? 'close' : 'cancel')}</Button>
        {!confirmed && (
          <Button
            tone="primary"
            disabled={!can_confirm}
            onClick={() => {
              update({ ...review, submitted: true })
              dispatch_app({ type: 'tournament/admin', action: review.action })
            }}
          >
            {t('confirm')}
          </Button>
        )}
      </footer>
    </TournamentDialog>
  )
}

const AdminEvent = ({
  row,
  view,
  disabled,
  admin,
  review,
  t,
}: Readonly<{
  row: TournamentRow
  view: TournamentView
  disabled: boolean
  admin: string
  review: (review: Review) => void
  t: CopyText
}>) => {
  const counts = tournament_registration(row)
  const can_start =
    view.viewer.now_ms !== null && view.viewer.now_ms < row.start_before_ms && counts.complete >= counts.minimum
  return (
    <article className="tourney-admin-event">
      <div>
        <h3>
          {row.name} · {t(row.status)}
        </h3>
        <p>{t('team_counts', { teams: counts.teams, complete: counts.complete, minimum: counts.minimum })}</p>
      </div>
      {row.status === 'open' && (
        <>
          <Button
            tone="primary"
            disabled={disabled || !can_start}
            onClick={() => review({ action: { kind: 'start', id: row.id, admin }, row, submitted: false })}
          >
            {t('start')}
          </Button>
          <Button
            tone="danger"
            disabled={disabled}
            onClick={() => review({ action: { kind: 'cancel', id: row.id, admin }, row, submitted: false })}
          >
            {t('cancel_event')}
          </Button>
        </>
      )}
      {row.status === 'in_progress' && <p className="tourney-note">{t('running_admin_notice')}</p>}
    </article>
  )
}

export const TournamentAdmin = () => {
  const copy = useAppStore((state) => state.copy)
  const connected = useAppStore((state) => !!state.external_wallet.session)
  const view = useTournamentView()
  const [admin, set_admin] = useState(() => String(resolve_pins(env.network).admin_cap ?? ''))
  const [review, set_review] = useState<Review | null>(null)
  if (!copy) return null
  const t = copy_text(copy.tournament_page)
  const current = view.tournament.rows.filter((row) => ['open', 'in_progress'].includes(row.status))
  const disabled = view.tournament.pending !== null || !connected || view.tournament.feed_status !== 'loaded'
  return (
    <details className="tourney-admin">
      <summary>{t('admin')}</summary>
      {current.length > 0 ? (
        <div className="tourney-admin-events">
          <AdminWalletControl />
          <label className="aui-field">
            {t('admin_cap')}
            <input value={admin} onChange={(e) => set_admin(e.target.value)} />
          </label>
          {current.map((row) => (
            <AdminEvent
              key={row.id}
              row={row}
              view={view}
              disabled={disabled}
              admin={admin}
              review={set_review}
              t={t}
            />
          ))}
        </div>
      ) : (
        <TournamentSettingsForm
          admin={admin}
          set_admin={set_admin}
          disabled={disabled}
          now={view.viewer.now_ms}
          t={t}
          review={(settings) => set_review({ action: { kind: 'create', settings }, row: null, submitted: false })}
        />
      )}
      <details className="tourney-admin-metadata">
        <summary>{t('deployment_metadata')}</summary>
        <p className="tourney-note">{t('display_notice')}</p>
        <Button
          disabled={disabled}
          onClick={() => set_review({ action: { kind: 'display' }, row: null, submitted: false })}
        >
          {t('setup_display')}
        </Button>
      </details>
      {review && (
        <AdminReview
          review={review}
          update={set_review}
          close={() => set_review(null)}
          view={view}
          disabled={disabled}
          t={t}
        />
      )}
    </details>
  )
}
