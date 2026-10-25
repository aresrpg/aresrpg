// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { useEffect, useRef } from 'react'
import type { TournamentRow } from '@aresrpg/protocol'
import { CONTRACT_CONSTANTS } from '@aresrpg/fight/move_contract'
import { TOURNAMENT_MATCH_MS } from '@aresrpg/sdk/tournament'

import type { CopyText } from '../i18n/copy.ts'
import type { TournamentAction } from '../modules/tournament.ts'
import {
  tournament_match_action,
  tournament_owned_match,
  tournament_rounds,
  type AdvancingSide,
} from '../modules/tournament_selectors.ts'

import { TeamPips, TournamentActionButton } from './TournamentControls.tsx'
import { countdown, own_team, round_label, team_initial } from './presentation.ts'
import type { TournamentView } from './useTournamentView.ts'

type MatchView = ReturnType<typeof tournament_rounds>['rounds'][number]['matches'][number]

const BracketSide = ({
  side,
  row,
  match,
  own,
  t,
}: Readonly<{
  side: AdvancingSide
  row: TournamentRow
  match: MatchView['match']
  own: number
  t: CopyText
}>) => {
  if (!('team' in side))
    return (
      <div className="tourney-match-team is-unresolved">
        <span className="tourney-monogram" aria-hidden="true">
          —
        </span>
        <span>{side.kind === 'pending' ? t(`from_${side.via}`, { match: side.match + 1 }) : t('empty_bracket')}</span>
      </div>
    )
  const team = row.teams[side.team]
  const won = match.winner === side.team
  const lost = match.state === 2 && match.winner !== side.team
  return (
    <div className={`tourney-match-team${side.team === own ? ' is-own' : ''}${lost ? ' is-lost' : ''}`}>
      <span className="tourney-monogram" aria-hidden="true">
        {team_initial(team.name)}
      </span>
      <span title={team.name}>{team.name}</span>
      {won && <span aria-label={t('winner')}>✓</span>}
      {side.kind === 'advancing' && <small>{t('advancing')}</small>}
      {match.state === 1 && (
        <TeamPips t={t} seats={team.seats} format={row.format} joined={match.fight === null ? [] : match.joined} />
      )}
    </div>
  )
}

const BracketMatch = ({
  row,
  node,
  view,
  t,
  confirm,
  navigate,
}: Readonly<{
  row: TournamentRow
  node: MatchView
  view: TournamentView
  t: CopyText
  confirm: (action: TournamentAction) => void
  navigate: (tab: 'main' | 'podium') => void
}>) => {
  const own = own_team(row, view.viewer.address)
  const yours = node.sides.some((side) => 'team' in side && side.team === own)
  const action = node.match.state === 1 ? tournament_match_action(row, node.index, view.viewer) : null
  const deadline =
    node.match.available_ms +
    (node.kind === 'admission' ? Number(CONTRACT_CONSTANTS.placement_force_ms) : TOURNAMENT_MATCH_MS)
  return (
    <article
      id={`tournament-${row.id}-match-${node.index}`}
      data-match-index={node.index}
      className={`tourney-match is-${node.kind}${yours ? ' is-own' : ''}`}
    >
      <header>
        <span>
          M{node.index + 1} · {t(`match_${node.kind}`)}
        </span>
        {['admission', 'live'].includes(node.kind) && <time>{countdown(deadline, view.viewer.now_ms)}</time>}
      </header>
      {node.sides.map((side, index) => (
        <BracketSide key={index} side={side} row={row} match={node.match} own={own} t={t} />
      ))}
      {action && action.kind !== 'status' && (
        <div className="tourney-match-action">
          <TournamentActionButton
            row={row}
            action={action}
            t={t}
            confirm={confirm}
            navigate={navigate}
            disabled={view.tournament.pending !== null || view.tournament.feed_status !== 'loaded'}
          />
        </div>
      )}
    </article>
  )
}

export const TournamentBracket = ({
  row,
  view,
  t,
  confirm,
  navigate,
}: Readonly<{
  row: TournamentRow
  view: TournamentView
  t: CopyText
  confirm: (action: TournamentAction) => void
  navigate: (tab: 'main' | 'podium') => void
}>) => {
  const root = useRef<HTMLDivElement>(null)
  const { rounds, bronze } = tournament_rounds(row, view.viewer.now_ms)
  const selected = tournament_owned_match(row, view.viewer)
  useEffect(() => {
    root.current
      ?.querySelector(`[data-match-index="${selected}"]`)
      ?.scrollIntoView({ block: 'center', inline: 'center' })
  }, [row.id, selected])
  const leaves = rounds[0]?.matches.length ?? 1
  const fifth = row.teams.filter((team) => team.place === 5)
  if (!rounds.length) return <p className="tourney-empty">{t('no_matches')}</p>
  return (
    <div className="tourney-bracket-scroll" ref={root} tabIndex={0} role="region" aria-label={t('bracket')}>
      <div
        className={`tourney-tree${leaves >= 8 ? ' is-dense' : ''}`}
        style={{ '--tourney-leaves': leaves } as React.CSSProperties}
      >
        {rounds.map((round, index) => (
          <section className="tourney-round" key={round.depth}>
            <header>
              <b>{round_label(round.depth, t)}</b>
              <span>{t('round_counts', { live: round.live, done: round.done, count: round.matches.length })}</span>
            </header>
            <div className="tourney-round-matches">
              {round.matches.map((node, ordinal) => (
                <div
                  className={`tourney-match-slot${index > 0 ? ' has-feeders' : ''}${index < rounds.length - 1 ? ' has-parent' : ''}`}
                  key={node.index}
                  style={{ gridRow: `${ordinal * 2 ** index + 1} / span ${2 ** index}` }}
                >
                  <BracketMatch row={row} node={node} view={view} t={t} confirm={confirm} navigate={navigate} />
                </div>
              ))}
            </div>
          </section>
        ))}
        {bronze && (
          <section className="tourney-placement">
            <header>{t('placement')}</header>
            <div>
              <h4>{t('bronze')}</h4>
              <BracketMatch row={row} node={bronze} view={view} t={t} confirm={confirm} navigate={navigate} />
              <section className="tourney-fifth">
                <h4>{t('joint_fifth')}</h4>
                {fifth.length ? (
                  fifth.map((team, index) => <p key={index}>{team.name}</p>)
                ) : (
                  <p>{t('fifth_pending')}</p>
                )}
                <small>{t('fifth_notice')}</small>
              </section>
            </div>
          </section>
        )}
      </div>
    </div>
  )
}
