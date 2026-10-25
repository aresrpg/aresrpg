// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
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

import { BracketCard, BracketTeam, BracketTree } from './BracketView.tsx'
import { TeamPips, TournamentActionButton } from './TournamentControls.tsx'
import { countdown, own_team, round_label } from './presentation.ts'
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
      <BracketTeam
        unresolved
        name={side.kind === 'pending' ? t(`from_${side.via}`, { match: side.match + 1 }) : t('empty_bracket')}
        t={t}
      />
    )
  const team = row.teams[side.team]
  return (
    <BracketTeam
      name={team.name}
      own={side.team === own}
      won={match.winner === side.team}
      lost={match.state === 2 && match.winner !== side.team}
      t={t}
    >
      {side.kind === 'advancing' && <small>{t('advancing')}</small>}
      {match.state === 1 && (
        <TeamPips t={t} seats={team.seats} format={row.format} joined={match.fight === null ? [] : match.joined} />
      )}
    </BracketTeam>
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
    <BracketCard
      id={`tournament-${row.id}-match-${node.index}`}
      index={node.index}
      kind={node.kind}
      own={yours}
      label={t(`match_${node.kind}`)}
      deadline={['admission', 'live'].includes(node.kind) && <time>{countdown(deadline, view.viewer.now_ms)}</time>}
      action={
        action &&
        action.kind !== 'status' && (
          <TournamentActionButton
            row={row}
            action={action}
            t={t}
            confirm={confirm}
            navigate={navigate}
            disabled={view.tournament.pending !== null || view.tournament.feed_status !== 'loaded'}
          />
        )
      }
    >
      {node.sides.map((side, index) => (
        <BracketSide key={index} side={side} row={row} match={node.match} own={own} t={t} />
      ))}
    </BracketCard>
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
  const { rounds, bronze } = tournament_rounds(row, view.viewer.now_ms)
  const selected = tournament_owned_match(row, view.viewer)
  const fifth = row.teams.filter((team) => team.place === 5)
  return (
    <BracketTree
      identity={row.id}
      selected={selected}
      t={t}
      rounds={rounds.map((round) => ({
        depth: round.depth,
        title: round_label(round.depth, t),
        summary: t('round_counts', { live: round.live, done: round.done, count: round.matches.length }),
        matches: round.matches.map((node) => (
          <BracketMatch
            key={node.index}
            row={row}
            node={node}
            view={view}
            t={t}
            confirm={confirm}
            navigate={navigate}
          />
        )),
      }))}
      placement={
        bronze && (
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
        )
      }
    />
  )
}
