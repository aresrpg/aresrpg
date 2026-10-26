// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { Trophy } from 'lucide-react'
import type { ReactNode } from 'react'
import { CONTRACT_CONSTANTS } from '@aresrpg/fight/move_contract'
import type { TournamentRow } from '@aresrpg/protocol'

import { BlastSaleCard } from '../kares/BlastSaleCard.tsx'
import { dispatch_app } from '../store.ts'
import { copy_text, type AppCopy, type CopyText } from '../i18n/copy.ts'
import { player_error_text } from '../i18n/player_error.ts'
import { tournament_owned_match, tournament_registration, tournament_rounds } from '../modules/tournament_selectors.ts'

import { useTournamentView, type TournamentView } from './useTournamentView.ts'
import { action_label, countdown, match_label, own_team, tournament_name } from './presentation.ts'
import { TeamPips, TournamentPool } from './TournamentControls.tsx'
import { tournament_path } from './navigation.ts'
import { useHudPlacement } from './useHudPlacement.ts'
import './tournament.css'

const HudCards = ({ children }: Readonly<{ children: ReactNode }>) => {
  const root = useHudPlacement()
  return (
    <aside ref={root} className="blast-sale-hud tourney-hud-desktop tourney-hud-stack">
      {children}
    </aside>
  )
}

const MiniBracket = ({ row, view }: Readonly<{ row: TournamentRow; view: TournamentView }>) => {
  const own = own_team(row, view.viewer.address)
  const rounds = tournament_rounds(row, view.viewer.now_ms).rounds.slice(-3)
  return (
    <span className="tourney-mini-bracket" aria-hidden="true">
      {rounds.map((round) => (
        <span key={round.depth}>
          {round.matches.map((node) => (
            <i
              key={node.index}
              className={`${node.sides.some((side) => 'team' in side && side.team === own) ? 'is-own' : ''} ${node.kind === 'live' ? 'is-live' : ''}`}
            />
          ))}
        </span>
      ))}
    </span>
  )
}

const HudBody = ({ row, view, t }: Readonly<{ row: TournamentRow; view: TournamentView; t: CopyText }>) => {
  const team = own_team(row, view.viewer.address)
  const index = tournament_owned_match(row, view.viewer)
  const match = row.matches[index]
  const registration = tournament_registration(row)
  const results = row.matches.filter((entry) => entry.state === 2 && entry.winner !== null)
  const result = results[Math.floor((view.viewer.now_ms ?? 0) / 6000) % results.length]
  if (row.status === 'open')
    return (
      <>
        <span className="tourney-hud-rosters">
          {row.teams.map((roster, ordinal) => (
            <TeamPips t={t} key={ordinal} seats={roster.seats} format={row.format} />
          ))}
        </span>
        <small>{t('ready_count', { complete: registration.complete, minimum: registration.minimum })}</small>
      </>
    )
  return (
    <>
      {team >= 0 && (
        <strong>
          <bdi>{tournament_name(row.teams[team].name)}</bdi>
          {match && ` → ${match_label(row, index, t)}`}
          {row.teams[team].place > 0 && <small> · {t('place_number', { place: row.teams[team].place })}</small>}
        </strong>
      )}
      {match && (
        <span className="tourney-hud-opponents">
          {[match.a, match.b].map((side, ordinal) => (
            <span key={ordinal}>
              {side === null ? t('waiting') : <bdi>{tournament_name(row.teams[side].name)}</bdi>}
              {side !== null && (
                <TeamPips
                  t={t}
                  seats={row.teams[side].seats}
                  format={row.format}
                  joined={match.fight === null ? [] : match.joined}
                />
              )}
            </span>
          ))}
        </span>
      )}
      {row.status === 'in_progress' && <MiniBracket row={row} view={view} />}
      {result && (
        <small className="tourney-result-line">
          {t('result_line', { team: tournament_name(row.teams[result.winner!].name) })}
        </small>
      )}
    </>
  )
}

const TournamentResultsCard = ({ row, t }: Readonly<{ row: TournamentRow | null; t: CopyText }>) => {
  if (!row) return null
  const winners = row.teams
    .filter((team) => team.place === 1)
    .map((team) => tournament_name(team.name))
    .join(', ')
  return (
    <button
      type="button"
      className="tourney-hud-card tourney-results-card"
      aria-label={t('open_results', { name: tournament_name(row.name) })}
      onClick={() => dispatch_app({ type: 'tournament/podium_opened', id: row.id })}
    >
      <span className="tourney-hud-eyebrow">
        <span>
          <Trophy size={14} aria-hidden="true" />
          {t('results')}
        </span>
      </span>
      <span className="tourney-hud-heading">
        <strong>
          <bdi>{tournament_name(row.name)}</bdi>
        </strong>
      </span>
      <small>{winners ? t('champion', { team: winners }) : t('no_champion')}</small>
      <span className="tourney-hud-footer">
        <b>{t('podium')}</b>
      </span>
    </button>
  )
}

const HudEvent = ({ row, view, copy }: Readonly<{ row: TournamentRow; view: TournamentView; copy: AppCopy }>) => {
  const t = copy_text(copy.tournament_page)
  const { admission, deadline } = view
  const emphasis = admission ? ' is-admission' : ''
  const timer = countdown(deadline, view.viewer.now_ms)
  const live = row.matches.filter((entry) => entry.state === 1 && entry.phase === 'active').length
  const open = (): void => dispatch_app({ type: 'path/open', pathname: tournament_path(row.id) })
  const labels = {
    open: timer,
    in_progress: t('live_count', { count: live }),
    finished: t('claim'),
    cancelled: t('cancelled'),
  }
  const mobile_label = admission ? `${t('join')} ${timer}` : labels[row.status]
  return (
    <>
      <HudCards>
        <TournamentResultsCard row={view.results} t={t} />
        <button
          type="button"
          className={`tourney-hud-card${emphasis}`}
          onClick={open}
          aria-label={t('open_event', { name: tournament_name(row.name) })}
        >
          <span className="tourney-hud-eyebrow">
            <span>
              <Trophy size={14} aria-hidden="true" />
              {t('title')} · {row.format}v{row.format}
            </span>
            <span>{t(row.status)}</span>
          </span>
          <span className="tourney-hud-heading">
            <strong>
              <bdi>{tournament_name(row.name)}</bdi>
            </strong>
            {(row.status === 'open' || admission) && (
              <span className="tourney-hud-clock">
                <time>{timer}</time>
                <small>{t(admission ? 'match_admission' : 'deadline')}</small>
              </span>
            )}
          </span>
          <span className="tourney-hud-pool">
            <TournamentPool row={row} t={t} />
          </span>
          <HudBody row={row} view={view} t={t} />
          {admission && (
            <span className="tourney-admission-track" aria-hidden="true">
              <span
                style={{
                  width: `${Math.max(0, Math.min(100, ((deadline - view.viewer.now_ms!) / Number(CONTRACT_CONSTANTS.placement_force_ms)) * 100))}%`,
                }}
              />
            </span>
          )}
          {view.entry_failure && (
            <span className="tourney-error">{player_error_text(copy, view.entry_failure.reason)}</span>
          )}
          <span className="tourney-hud-footer">
            <small>
              {view.recovery.length ? t('older_claims', { count: view.recovery.length }) : t('open_window')}
            </small>
            <b>{action_label(view.primary, t)}</b>
          </span>
        </button>
      </HudCards>
      <button
        type="button"
        className={`tourney-hud-mobile${emphasis}`}
        onClick={open}
        aria-label={t('open_event', { name: tournament_name(row.name) })}
      >
        <Trophy size={18} aria-hidden="true" />
        <span>{mobile_label}</span>
      </button>
    </>
  )
}

export const TournamentHud = ({ copy }: Readonly<{ copy: AppCopy }>) => {
  const view = useTournamentView()
  const t = copy_text(copy.tournament_page)
  const results = view.wallet ? view.results : null
  return view.wallet && view.card === 'event' && view.row ? (
    <HudEvent row={view.row} view={view} copy={copy} />
  ) : (
    <>
      <HudCards>
        <TournamentResultsCard row={results} t={t} />
        <BlastSaleCard copy={copy} />
      </HudCards>
      {results && (
        <button
          type="button"
          className="tourney-hud-mobile"
          aria-label={t('open_results', { name: tournament_name(results.name) })}
          onClick={() => dispatch_app({ type: 'tournament/podium_opened', id: results.id })}
        >
          <Trophy size={18} aria-hidden="true" />
          <span>{t('results')}</span>
        </button>
      )}
    </>
  )
}
