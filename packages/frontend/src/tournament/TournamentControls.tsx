// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { Button, GameWindow, NativeModal } from '@aresrpg/ui'
import { useId, type ReactNode, type CSSProperties } from 'react'
import { resolve_pins } from '@aresrpg/sdk/pins'
import type { TournamentRow } from '@aresrpg/protocol'

import { env } from '../env.ts'
import { dispatch_app, useAppStore } from '../store.ts'
import { useNumbers } from '../i18n/useNumbers.ts'
import { SuiLogo } from '../components/SuiLogo.tsx'
import { KaresLogo } from '../components/KaresLogo.tsx'
import type { CopyText } from '../i18n/copy.ts'
import {
  tournament_review_available,
  advancing_side,
  type TournamentNextAction,
  type TournamentViewer,
} from '../modules/tournament_selectors.ts'
import type { TournamentAction } from '../modules/tournament.ts'
import { player_error_text } from '../i18n/player_error.ts'

import {
  action_label,
  tournament_name,
  bracket_side_label,
  character_label,
  match_label,
  tournament_act,
  type operation_status,
} from './presentation.ts'

export const TournamentOperationNotice = ({
  status,
  t,
  confirmed,
}: Readonly<{
  status: Readonly<ReturnType<typeof operation_status>>
  t: CopyText
  confirmed: string
}>) => {
  const copy = useAppStore((state) => state.copy)!
  switch (status.phase) {
    case 'idle':
      return null
    case 'pending':
      return <p role="status">{t('reason_pending')}</p>
    case 'submitted':
      return <p role="status">{t('submitted_notice')}</p>
    case 'confirmed':
      return <p role="status">{t(confirmed)}</p>
    case 'failed':
      return (
        <p className="tourney-error" role="alert">
          {player_error_text(copy, status.reason)}
        </p>
      )
  }
}

export const TournamentCoin = ({
  amount,
  asset,
  reveal = false,
}: Readonly<{ amount: bigint; asset: 'SUI' | 'KARES'; reveal?: boolean }>) => {
  const numbers = useNumbers()
  const id = useId()
  const Logo = asset === 'SUI' ? SuiLogo : KaresLogo
  const exact = `${numbers.sui(amount, 9)} ${asset}`
  const amount_label = (
    <span className="tourney-coin" title={exact}>
      {reveal && <Logo size={17} />}
      <span>
        {numbers.sui(amount, 2)} <small>{asset}</small>
      </span>
    </span>
  )
  if (!reveal) return amount_label
  const anchor = `--amount-${id.replace(/[^a-z0-9_-]/gi, '')}`
  return (
    <span className="tourney-coin-reveal" style={{ '--tourney-price-anchor': anchor } as CSSProperties}>
      <Button className="tourney-coin-button" popoverTarget={id} aria-label={exact}>
        {amount_label}
      </Button>
      <span id={id} popover="auto" className="tourney-exact-amount">
        {exact}
      </span>
    </span>
  )
}

export const TournamentDialog = ({
  title,
  close,
  children,
  t,
}: Readonly<{
  title: string
  close: () => void
  children: ReactNode
  t: CopyText
}>) => (
  <NativeModal close={close} label={title} className="aui-modal-scrim">
    <GameWindow title={title} close={close} close_label={t('cancel')} className="tourney-dialog">
      <div className="tourney-dialog-body">{children}</div>
    </GameWindow>
  </NativeModal>
)

export const TournamentConfirm = ({
  title,
  body,
  close,
  confirm,
  disabled,
  t,
  children,
}: Readonly<{
  title: string
  body: string
  close: () => void
  confirm: () => void
  disabled: boolean
  t: CopyText
  children?: ReactNode
}>) => (
  <TournamentDialog title={title} close={close} t={t}>
    <p>{body}</p>
    {children}
    <footer className="tourney-dialog-actions">
      <Button onClick={close}>{t('cancel')}</Button>
      <Button tone="primary" disabled={disabled} onClick={confirm}>
        {t('confirm')}
      </Button>
    </footer>
  </TournamentDialog>
)

export const TournamentActionButton = ({
  row,
  action,
  disabled = false,
  t,
  navigate,
  confirm,
}: Readonly<{
  row: TournamentRow
  action: TournamentNextAction
  disabled?: boolean
  t: CopyText
  navigate: (tab: 'main' | 'podium') => void
  confirm: (action: TournamentAction) => void
}>) => {
  const activate = (): void => {
    switch (action.kind) {
      case 'status':
        return
      case 'claims':
        navigate('podium')
        return
      case 'bracket':
        navigate('main')
        return
      case 'write':
        if (action.confirm || ['find', 'join'].includes(action.action.kind)) confirm(action.action)
        else tournament_act(row.id, action.action)
        return
      case 'return':
        dispatch_app({ type: 'character/select', character_id: action.character })
        dispatch_app({ type: 'page/open', page: 'world' })
        return
      case 'watch':
        dispatch_app({ type: 'fight/spectating', character_id: action.character, fight: action.fight })
        dispatch_app({ type: 'page/open', page: 'world' })
        return
    }
  }
  return action.kind === 'status' ? (
    <span className="tourney-action-status" role="status">
      {action_label(action, t)}
    </span>
  ) : (
    <Button tone="primary" disabled={disabled} onClick={activate}>
      {action_label(action, t)}
    </Button>
  )
}

export const TournamentIntentReview = ({
  row,
  action,
  close,
  disabled,
  viewer,
  t,
}: Readonly<{
  row: TournamentRow
  action: TournamentAction | null
  close: () => void
  disabled: boolean
  viewer: TournamentViewer
  t: CopyText
}>) => {
  const characters = useAppStore((state) => state.session.characters)
  if (!action) return null
  const name =
    'character' in action
      ? character_label(characters.find((c) => c.id === action.character)?.name, action.character)
      : ''
  const reviews: Partial<Record<TournamentAction['kind'], Readonly<{ title: string; body: string }>>> = {
    find: { title: t('find_team'), body: t('find_review', { character: name }) },
    join: {
      title: t('take_seat'),
      body: t('join_review', {
        character: name,
        team: action.kind === 'join' ? tournament_name(row.teams[action.team].name) : '',
      }),
    },
    crank: { title: t('action_end'), body: t('end_review') },
  }
  const review = reviews[action.kind]
  if (!review) return null
  return (
    <TournamentConfirm
      {...review}
      close={close}
      disabled={disabled || !tournament_review_available(row, action, viewer)}
      t={t}
      confirm={() => {
        tournament_act(row.id, action)
        close()
      }}
    >
      {action.kind === 'crank' && (
        <p>
          <strong>
            {t('match_number', { match: action.index + 1 })} · {match_label(row, action.index, t)}
          </strong>
          <br />
          {([0, 1] as const)
            .map((side) => bracket_side_label(row, advancing_side(row, action.index, side), t))
            .join(' — ')}
        </p>
      )}
      {action.kind !== 'crank' && <p className="tourney-note">{t('roster_notice')}</p>}
    </TournamentConfirm>
  )
}

export const TeamPips = ({
  seats,
  format,
  joined,
  t,
}: Readonly<{
  seats: readonly Readonly<{ character: string }>[]
  format: number
  joined?: readonly string[]
  t: CopyText
}>) => (
  <span className="tourney-attendance">
    <span className="tourney-pips" aria-hidden="true">
      {Array.from({ length: format }, (_, index) => (
        <i
          key={index}
          className={seats[index] ? (joined?.includes(seats[index].character) ? 'is-joined' : 'is-filled') : ''}
        />
      ))}
    </span>
    {joined !== undefined && (
      <small>
        {t('joined_count', {
          count: seats.filter((seat) => joined.includes(seat.character)).length,
          total: seats.length,
        })}
      </small>
    )}
  </span>
)

export const TournamentPool = ({
  row,
  t,
  reveal = false,
}: Readonly<{ row: TournamentRow; t: CopyText; reveal?: boolean }>) => {
  const [sui, kares] = (row.status === 'open' ? [row.sui_pool, row.token_pool] : [row.sui_total, row.token_total]).map(
    BigInt
  )
  const bound = Boolean(row.kares_pool || resolve_pins(env.network).kares_coin_type)
  return (
    <div className="tourney-pool-lines">
      <TournamentCoin amount={sui} asset="SUI" reveal={reveal} />
      {bound ? (
        <TournamentCoin amount={kares} asset="KARES" reveal={reveal} />
      ) : (
        <small>{t('token_unavailable')}</small>
      )}
      {row.rewards.length > 0 && (
        <small>{t(sui === 0n && kares === 0n ? 'items_only' : 'item_count', { count: row.rewards.length })}</small>
      )}
    </div>
  )
}
