// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { useState } from 'react'
import { Button } from '@aresrpg/ui'
import { LockKeyhole, Plus, UserPlus } from 'lucide-react'
import type { TournamentRow } from '@aresrpg/protocol'

import { copy_text, type CopyText } from '../i18n/copy.ts'
import { useAppStore } from '../store.ts'
import {
  team_access,
  tournament_registration,
  tournament_seats,
  type SeatView,
} from '../modules/tournament_selectors.ts'
import { action_key, type TournamentAction } from '../modules/tournament.ts'
import { toast } from '../toast.ts'

import { TournamentConfirm, TournamentDialog, TournamentOperationNotice } from './TournamentControls.tsx'
import { character_label, team_initial, tournament_act, operation_status, tournament_name } from './presentation.ts'
import type { TournamentView } from './useTournamentView.ts'

type SeatIntent = Readonly<{
  action: Extract<TournamentAction, { kind: 'join' | 'leave' }>
  character: string
  team: string
}>

const SEAT_REVIEW = {
  join: { title: 'take_seat', body: 'join_review' },
  leave: { title: 'leave', body: 'leave_review' },
} as const

const Seat = ({
  seat,
  available,
  leave,
  join,
  t,
}: Readonly<{
  seat: SeatView
  available: boolean
  leave: (seat: Extract<SeatView, { kind: 'registered' }>) => void
  join: () => void
  t: CopyText
}>) => {
  if (seat.kind === 'registered')
    return (
      <div className={`tourney-seat${seat.own ? ' is-own' : ''}`}>
        <span>{character_label(seat.name, seat.character)}</span>
        {seat.own && (
          <Button
            className="tourney-leave"
            disabled={!available}
            onClick={() => leave(seat)}
            aria-label={t('leave_character', { name: character_label(seat.name, seat.character) })}
          >
            {t('leave')}
          </Button>
        )}
      </div>
    )
  if (seat.kind === 'reserved' && !available)
    return (
      <div className="tourney-seat is-reserved">
        <LockKeyhole size={14} aria-hidden="true" />
        <span>{seat.name ?? t('reserved_seat')}</span>
      </div>
    )
  return (
    <Button className="tourney-seat is-empty" disabled={!available} onClick={join}>
      <UserPlus size={14} aria-hidden="true" />
      {t(available ? 'take_seat' : 'open_seat')}
    </Button>
  )
}

export const TournamentTeams = ({
  row,
  view,
  create,
  t,
}: Readonly<{
  row: TournamentRow
  view: TournamentView
  create: () => void
  t: CopyText
}>) => {
  const [intent, set_intent] = useState<SeatIntent | null>(null)
  const registration = tournament_registration(row)
  const { viewer, tournament } = view
  const open = view.can_register
  return (
    <section className="tourney-teams" aria-label={t('teams')}>
      <header className="tourney-section-heading">
        <div>
          <h3>{t('teams')}</h3>
          <p>
            {t('team_counts', {
              teams: registration.teams,
              complete: registration.complete,
              minimum: registration.minimum,
            })}
          </p>
        </div>
        <Button disabled={!view.can_open_team_creation} onClick={create}>
          <Plus size={14} aria-hidden="true" />
          {t('create_team')}
        </Button>
      </header>
      <p className="tourney-note">{t('complete_notice')}</p>
      {row.teams.map((team, index) => {
        if (team.seats.length === 0) return null
        const access = team_access(row, index, viewer)
        const joinable = open && ['join', 'add'].includes(access)
        return (
          <article className="tourney-team" key={`${index}:${team.revision}`}>
            <div className="tourney-team-heading">
              <span className="tourney-monogram" aria-hidden="true">
                {team_initial(team.name)}
              </span>
              <div>
                <h4>
                  <bdi>{tournament_name(team.name)}</bdi>
                </h4>
                <p>
                  {t(team.allowed.length ? 'named_only' : 'open_anyone')} · {team.seats.length}/{row.format}
                </p>
                {!['join', 'add', 'registered', 'elsewhere'].includes(access) && (
                  <p className="tourney-access">{t(`reason_${access}`)}</p>
                )}
              </div>
            </div>
            <div className="tourney-seats" style={{ gridTemplateColumns: `repeat(${row.format}, minmax(0, 1fr))` }}>
              {tournament_seats(row, index, viewer.address).map((seat, ordinal) => (
                <Seat
                  key={ordinal}
                  seat={seat}
                  t={t}
                  available={
                    seat.kind === 'registered'
                      ? open
                      : joinable && (seat.kind !== 'reserved' || seat.character === viewer.character?.id)
                  }
                  leave={(registered) =>
                    set_intent({
                      action: { kind: 'leave', team: index, character: registered.character },
                      character: character_label(registered.name, registered.character),
                      team: tournament_name(team.name),
                    })
                  }
                  join={() =>
                    set_intent({
                      action: { kind: 'join', team: index, revision: team.revision, character: viewer.character!.id },
                      character: viewer.character!.name,
                      team: tournament_name(team.name),
                    })
                  }
                />
              ))}
            </div>
          </article>
        )
      })}
      {registration.teams === 0 && <p className="tourney-empty">{t('no_teams')}</p>}
      {intent && (
        <TournamentConfirm
          title={t(SEAT_REVIEW[intent.action.kind].title)}
          body={t(SEAT_REVIEW[intent.action.kind].body, {
            character: intent.character,
            team: intent.team,
          })}
          disabled={
            !open ||
            (intent.action.kind === 'join' && row.teams[intent.action.team]?.revision !== intent.action.revision)
          }
          close={() => set_intent(null)}
          t={t}
          confirm={() => {
            tournament_act(row.id, intent.action)
            set_intent(null)
          }}
        >
          {intent.action.kind === 'join' && <p className="tourney-note">{t('roster_notice')}</p>}
        </TournamentConfirm>
      )}
    </section>
  )
}

export const CreateTournamentTeam = ({
  row,
  view,
  close,
}: Readonly<{
  row: TournamentRow
  view: TournamentView
  close: () => void
}>) => {
  const copy = useAppStore((state) => state.copy)!
  const t = copy_text(copy.tournament_page)
  const [name, set_name] = useState('')
  const [submitted, set_submitted] = useState(false)
  const [restricted, set_restricted] = useState(false)
  const [names, set_names] = useState('')
  const { wallet, viewer } = view
  const { character } = viewer
  if (view.team_creation_blocker)
    return (
      <TournamentDialog title={t('create_team')} close={close} t={t}>
        <p role="alert">{t(`reason_${view.team_creation_blocker}`)}</p>
        <footer className="tourney-dialog-actions">
          <Button onClick={close}>{t('close')}</Button>
        </footer>
      </TournamentDialog>
    )
  if (!wallet || !character) return null
  const status = operation_status(
    view.tournament,
    action_key(row, { kind: 'create', name, allowed: [], character: character.id }),
    submitted
  )
  const confirmed = status.phase === 'confirmed'
  const locked = submitted && status.phase !== 'failed'
  const member_names = names
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
  const allowed_count = new Set([character.name, ...member_names].map((value) => value.toLowerCase())).size
  const ready = [
    view.can_open_team_creation,
    !locked,
    name.trim().length > 0,
    new TextEncoder().encode(name.trim()).length <= 40,
    !restricted || allowed_count <= row.format,
  ].every(Boolean)
  const create = (): void => {
    if (!ready) return
    try {
      const allowed = restricted ? [...new Set([character.id, ...member_names.map(wallet.derive_character_id)])] : []
      set_submitted(true)
      tournament_act(row.id, { kind: 'create', name: name.trim(), allowed, character: character.id })
    } catch (error) {
      toast.add(error)
    }
  }
  return (
    <TournamentDialog title={t('create_team')} close={close} t={t}>
      <p>{character.name}</p>
      <TournamentOperationNotice status={status} t={t} confirmed="transaction_confirmed" />
      <label className="aui-field">
        {t('team_name')}
        <input autoFocus maxLength={40} disabled={locked} value={name} onChange={(e) => set_name(e.target.value)} />
      </label>
      <label className="tourney-check">
        <input
          type="checkbox"
          disabled={locked}
          checked={restricted}
          onChange={(e) => set_restricted(e.target.checked)}
        />
        {t('named_only')}
      </label>
      {restricted && (
        <label className="aui-field">
          {t('allowed_names')}
          <input disabled={locked} value={names} onChange={(e) => set_names(e.target.value)} />
        </label>
      )}
      {restricted && allowed_count > row.format && <p role="alert">{t('too_many_names', { count: row.format })}</p>}
      <p className="tourney-note">{t('consent_notice')}</p>
      <p className="tourney-note">{t('roster_notice')}</p>
      <footer className="tourney-dialog-actions">
        <Button onClick={close}>{t(confirmed ? 'close' : 'cancel')}</Button>
        {!confirmed && (
          <Button tone="primary" disabled={!ready} onClick={create}>
            {t('create_team')}
          </Button>
        )}
      </footer>
    </TournamentDialog>
  )
}
