// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { useState } from 'react'
import { Button } from '@aresrpg/ui'
import type { TournamentRow } from '@aresrpg/protocol'
import { CONTRACT_CONSTANTS } from '@aresrpg/fight/move_contract'
import { TOURNAMENT_MATCH_MS } from '@aresrpg/sdk/tournament'

import { dispatch_app, useAppStore } from '../store.ts'
import { copy_text, type CopyText } from '../i18n/copy.ts'
import { player_error_text } from '../i18n/player_error.ts'
import { match_kind, tournament_registration, tournament_rounds } from '../modules/tournament_selectors.ts'
import { tournament_claims, type TournamentAction } from '../modules/tournament.ts'
import { PracticeButton } from '../practice/PracticeButton.tsx'

import { useTournamentView, type TournamentView } from './useTournamentView.ts'
import { countdown, match_label, match_opponent, round_label, tournament_name } from './presentation.ts'
import {
  TeamPips,
  TournamentActionButton,
  TournamentIntentReview,
  TournamentPool,
  TournamentEntryFee,
  TournamentLevelLimit,
} from './TournamentControls.tsx'
import { CreateTournamentTeam, TournamentTeams } from './TournamentTeams.tsx'
import { TournamentBracket } from './TournamentBracket.tsx'
import { TournamentPodium } from './TournamentPodium.tsx'
import { tournament_path, tournament_route, type TournamentTab as Tab } from './navigation.ts'
import './tournament.css'

const DEFAULT_TAB: Readonly<Record<TournamentRow['status'], Tab>> = {
  open: 'main',
  in_progress: 'main',
  finished: 'podium',
  cancelled: 'podium',
}

const EventHeading = ({
  row,
  view,
  podium,
  t,
}: Readonly<{
  row: TournamentRow
  view: TournamentView
  podium: () => void
  t: CopyText
}>) => {
  const registration = tournament_registration(row)
  const { rounds } = tournament_rounds(row, view.viewer.now_ms)
  const current = rounds.find((round) => round.matches.some((match) => match.match.state === 1))
  const champion = row.teams.find((team) => team.place === 1)
  return (
    <header className="tourney-masthead">
      <div className="tourney-identity">
        <p className="tourney-eyebrow">
          <span className={`tourney-status is-${row.status}`}>{t(row.status)}</span>
          <span>
            {row.format}v{row.format} · {t('single_elimination')} ·{' '}
            {t('registered_count', { count: registration.teams })}
          </span>
        </p>
        <h2>
          <bdi>{tournament_name(row.name)}</bdi>
        </h2>
      </div>
      <div className="tourney-event-progress">
        <small>{t(row.status === 'open' ? 'deadline' : row.status)}</small>
        {view.registration_open && (
          <>
            <time>{countdown(row.start_before_ms, view.viewer.now_ms)}</time>
            <small>{t('latest_start_notice')}</small>
          </>
        )}
        {row.status === 'in_progress' && <strong>{current ? round_label(current.depth, t) : t('waiting')}</strong>}
        {row.status === 'finished' && (
          <strong>{champion ? t('champion', { team: tournament_name(champion.name) }) : t('no_champion')}</strong>
        )}
      </div>
      <Button className="tourney-pool-summary" onClick={podium} aria-label={t('podium')}>
        <small>{t(row.status === 'open' ? 'prize_pool' : 'frozen_pool')}</small>
        <TournamentPool row={row} t={t} />
      </Button>
    </header>
  )
}

const DockMatch = ({
  row,
  view,
  t,
  show,
}: Readonly<{
  row: TournamentRow
  view: TournamentView
  t: CopyText
  show: () => void
}>) => {
  const { match, match_index: index, viewer } = view
  if (!match) return <small>{t(row.status === 'open' ? 'stay_online' : row.status)}</small>
  const kind = match_kind(match, viewer.now_ms)
  const opponent = match_opponent(row, index, viewer.address, t)
  const deadline =
    match.available_ms + (kind === 'admission' ? Number(CONTRACT_CONSTANTS.placement_force_ms) : TOURNAMENT_MATCH_MS)
  return (
    <div className="tourney-dock-match">
      <div>
        <small>{match_label(row, index, t)}</small>
        <b title={opponent}>{t('versus', { team: opponent })}</b>
        <small className="tourney-dock-state">
          <span>{t(`match_${kind}`)}</span>
          {['admission', 'live'].includes(kind) && <time>{countdown(deadline, viewer.now_ms)}</time>}
        </small>
      </div>
      <Button className="tourney-show-match" onClick={show} aria-label={t('show_my_match')} title={t('show_my_match')}>
        ◎
      </Button>
    </div>
  )
}

const ActionDock = ({
  row,
  view,
  t,
  navigate,
  create,
  confirm,
}: Readonly<{
  row: TournamentRow
  view: TournamentView
  t: CopyText
  navigate: (tab: Tab) => void
  create: () => void
  confirm: (action: TournamentAction) => void
}>) => {
  const copy = useAppStore((state) => state.copy)!
  const { team, match, match_index: index } = view
  const disabled = !view.can_write
  const show_match = (): void => {
    navigate('main')
    document
      .getElementById(`tournament-${row.id}-match-${index}`)
      ?.scrollIntoView({ block: 'center', inline: 'center' })
  }
  return (
    <footer className="tourney-dock">
      <label className="tourney-character">
        <span className="sr-only">{t('character')}</span>
        <select
          aria-label={t('character')}
          value={view.viewer.character ? view.viewer.character.id : ''}
          onChange={(event) => dispatch_app({ type: 'character/select', character_id: event.target.value })}
        >
          <option value="" disabled>
            {t('reason_character')}
          </option>
          {view.characters.map((character) => (
            <option key={character.id} value={character.id}>
              {character.name}
            </option>
          ))}
        </select>
      </label>
      <div className="tourney-dock-team">
        <small>{t('your_team')}</small>
        <b>{team ? <bdi>{tournament_name(team.name)}</bdi> : t('not_registered')}</b>
        {team && <TeamPips t={t} seats={team.seats} format={row.format} joined={match?.joined} />}
      </div>
      <div className="tourney-dock-context">
        <DockMatch row={row} view={view} t={t} show={show_match} />
        {view.entry_failure && (
          <p className="tourney-error" role="alert">
            {player_error_text(copy, view.entry_failure.reason)}
          </p>
        )}
      </div>
      <div className="tourney-dock-actions">
        <PracticeButton open={row.status === 'open'} t={t} />
        {view.can_open_team_creation && (
          <Button disabled={disabled} onClick={create}>
            {t('create_team')}
          </Button>
        )}
        <TournamentActionButton
          row={row}
          action={view.primary}
          disabled={disabled}
          t={t}
          navigate={navigate}
          confirm={confirm}
        />
      </div>
    </footer>
  )
}

const TournamentEvent = ({ row, view, t }: Readonly<{ row: TournamentRow; view: TournamentView; t: CopyText }>) => {
  const pathname = useAppStore((state) => state.navigation.pathname)
  const route = tournament_route(pathname)
  const tab = route.id === row.id ? (route.tab ?? DEFAULT_TAB[row.status]) : DEFAULT_TAB[row.status]
  const navigate = (next: Tab): void => dispatch_app({ type: 'path/open', pathname: tournament_path(row.id, next) })
  const [creating, set_creating] = useState(false)
  const [confirmation, set_confirmation] = useState<TournamentAction | null>(null)
  const claims = tournament_claims(row, view.viewer.address).length
  const expired = view.registration_expired
  return (
    <>
      <EventHeading row={row} view={view} podium={() => navigate('podium')} t={t} />
      {row.status === 'cancelled' && <p className="tourney-notice">{t('cancelled_notice')}</p>}
      <TournamentEntryFee amount={BigInt(row.entry_fee_mist)} t={t} />
      <TournamentLevelLimit level={row.max_level} t={t} />
      {expired && <p className="tourney-notice">{t('expired_notice')}</p>}
      <nav className="tourney-tabs" aria-label={t('event_sections')}>
        <Button aria-pressed={tab === 'main'} onClick={() => navigate('main')}>
          {t(row.status === 'open' ? 'teams' : 'bracket')}
        </Button>
        <Button aria-pressed={tab === 'podium'} onClick={() => navigate('podium')}>
          {claims ? t('podium_claims', { count: claims }) : t('podium')}
        </Button>
      </nav>
      <div className="tourney-content">
        {tab === 'podium' ? (
          <TournamentPodium row={row} view={view} t={t} />
        ) : row.status === 'open' ? (
          <TournamentTeams row={row} view={view} create={() => set_creating(true)} t={t} />
        ) : (
          <TournamentBracket row={row} view={view} t={t} confirm={set_confirmation} navigate={navigate} />
        )}
      </div>
      <ActionDock
        row={row}
        view={view}
        t={t}
        navigate={navigate}
        create={() => set_creating(true)}
        confirm={set_confirmation}
      />
      {creating && <CreateTournamentTeam row={row} view={view} close={() => set_creating(false)} />}
      <TournamentIntentReview
        row={row}
        action={confirmation}
        viewer={view.viewer}
        close={() => set_confirmation(null)}
        t={t}
        disabled={!view.can_write}
      />
    </>
  )
}

export const TournamentPanel = () => {
  const copy = useAppStore((state) => state.copy)
  const pathname = useAppStore((state) => state.navigation.pathname)
  const selected = tournament_route(pathname).id
  const view = useTournamentView(selected)
  if (!copy) return null
  const t = copy_text(copy.tournament_page)
  return (
    <section className="tourney-panel" aria-label={t('title')}>
      {view.tournament.rows.length > 1 && (
        <label className="tourney-event-selector">
          {t('event')}
          <select
            value={view.row?.id ?? ''}
            onChange={(event) => dispatch_app({ type: 'path/open', pathname: tournament_path(event.target.value) })}
          >
            {view.tournament.rows.map((row) => (
              <option value={row.id} key={row.id}>
                {tournament_name(row.name)}
                {tournament_claims(row, view.viewer.address).length ? ` · ${t('your_rewards')}` : ''}
              </option>
            ))}
          </select>
        </label>
      )}
      {view.tournament.feed_status !== 'loaded' && (
        <p className="tourney-notice" role="status">
          {t(`reason_${view.tournament.feed_status}`)}
        </p>
      )}
      {view.row ? (
        <TournamentEvent key={view.row.id} row={view.row} view={view} t={t} />
      ) : (
        view.tournament.feed_status === 'loaded' && <p className="tourney-empty">{t('no_event')}</p>
      )}
    </section>
  )
}
