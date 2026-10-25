// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { TournamentRow } from '@aresrpg/protocol'

import type { CopyText } from '../i18n/copy.ts'
import type { TournamentNextAction } from '../modules/tournament_selectors.ts'
import { advancing_side, tournament_rounds, type AdvancingSide } from '../modules/tournament_selectors.ts'
import { dispatch_app } from '../store.ts'
import type { TournamentAction, TournamentState } from '../modules/tournament.ts'

export const tournament_act = (id: string, action: TournamentAction): void =>
  dispatch_app({ type: 'tournament/action', id, action })

export const action_label = (action: TournamentNextAction, t: CopyText): string => {
  switch (action.kind) {
    case 'status':
      return t(`reason_${action.reason}`)
    case 'write':
      return t(`action_${action.name}`)
    case 'watch':
      return t('spectate')
    case 'return':
      return t('return_fight')
    case 'claims':
      return t('claim_count', { count: action.actions.length })
    case 'bracket':
      return t('show_bracket')
  }
}

export const countdown = (deadline: number, now: number | null): string => {
  if (now === null) return '—'
  const seconds = Math.max(0, Math.ceil((deadline - now) / 1000))
  const minutes = Math.floor(seconds / 60)
  return minutes >= 60
    ? `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
    : `${minutes}:${String(seconds % 60).padStart(2, '0')}`
}

export const team_initial = (name: string): string => Array.from(name)[0]?.toLocaleUpperCase() ?? '—'
export const character_label = (name: string | null | undefined, id: string): string =>
  name ?? `${id.slice(0, 6)}…${id.slice(-4)}`
export const round_label = (depth: number, t: CopyText): string =>
  ['final', 'semifinals', 'quarterfinals'][depth]
    ? t(['final', 'semifinals', 'quarterfinals'][depth])
    : t('round_of', { count: 2 ** (depth + 1) })
export const own_team = (row: TournamentRow, address: string | null): number =>
  row.teams.findIndex((team) => team.seats.some((seat) => seat.owner === address))

export const bracket_side_label = (row: TournamentRow, side: AdvancingSide, t: CopyText): string => {
  if ('team' in side) return row.teams[side.team].name
  return side.kind === 'pending' ? t(`from_${side.via}`, { match: side.match + 1 }) : t('empty_bracket')
}

export const match_label = (row: TournamentRow, index: number, t: CopyText): string => {
  const bracket = tournament_rounds(row, null)
  const round = bracket.rounds.find((round) => round.matches.some((match) => match.index === index))
  return round ? round_label(round.depth, t) : t('bronze')
}

export const match_opponent = (row: TournamentRow, index: number, address: string | null, t: CopyText): string => {
  const own = own_team(row, address)
  return ([0, 1] as const)
    .map((side) => advancing_side(row, index, side))
    .filter((side) => !('team' in side) || side.team !== own)
    .map((side) => bracket_side_label(row, side, t))
    .join(' / ')
}

export const operation_status = (state: TournamentState, key: string, submitted: boolean) => {
  if (state.pending === key) return { phase: 'pending' as const, reason: null }
  if (!submitted) return { phase: 'idle' as const, reason: null }
  const result = state.outcome
  if (!result || result.key !== key) return { phase: 'submitted' as const, reason: null }
  return { phase: result.reason === null ? ('confirmed' as const) : ('failed' as const), reason: result.reason }
}
