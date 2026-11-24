// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { recent_tournament_result, type TournamentRow } from '@aresrpg/protocol'
import {
  ADMISSION_MS,
  match_kind,
  team_access,
  team_creation_blocker,
  tournament_claims,
  tournament_match_action,
  tournament_next_action,
  tournament_owned_match,
  tournament_podium,
  tournament_registration,
  tournament_rounds,
  tournament_seats,
  tournament_start_soon,
  type TournamentCharacter,
  type TournamentNextAction,
  type TournamentViewer,
} from '@aresrpg/protocol/tournament-rules'

import { chain_now, type ChainClock } from './chain_clock.ts'
import { action_key, type TournamentState } from './tournament.ts'

type Character = TournamentCharacter
const status = (reason: Extract<TournamentNextAction, { kind: 'status' }>['reason']): TournamentNextAction => ({
  kind: 'status',
  reason,
})
export type TournamentViewSource = Readonly<{
  tournament: TournamentState
  chain_clock: ChainClock
  session: Readonly<{
    wallet: Readonly<{ address: string }> | null
    characters: readonly Character[]
    selected_character_id: string | null
  }>
}>
export const selected_tournament = (
  rows: readonly TournamentRow[],
  address: string | null,
  selected: string | null
): TournamentRow | null =>
  [
    rows.find((t) => t.id === selected),
    rows.find((t) => t.status === 'in_progress'),
    rows.find((t) => t.status === 'open'),
    rows.find((t) => tournament_claims(t, address).length > 0),
    rows[0],
  ].find(Boolean) ?? null

const primary_action = (
  t: TournamentState,
  row: TournamentRow | null,
  viewer: TournamentViewer
): TournamentNextAction => {
  if (t.feed_status !== 'loaded') return status(t.feed_status)
  if (t.pending) return status('pending')
  return row ? tournament_next_action(row, viewer) : status('none')
}

const entry_failure = (t: TournamentState, row: TournamentRow | null, primary: TournamentNextAction) => {
  if (!row || primary.kind !== 'write' || primary.action.kind !== 'enter') return null
  return t.entry_failures[action_key(row, primary.action)] ?? null
}

export const select_tournament_view = (state: TournamentViewSource, selected: string | null, monotonic_ms: number) => {
  const { rows } = state.tournament
  const address = state.session.wallet?.address ?? null
  const row = selected_tournament(rows, address, selected)
  const now_ms = chain_now(state.chain_clock, monotonic_ms)
  const viewer: TournamentViewer = {
    address,
    character: state.session.characters.find((c) => c.id === state.session.selected_character_id) ?? null,
    characters: state.session.characters,
    now_ms,
    observed_ms: now_ms === null ? null : state.chain_clock!.chain_ms,
  }
  const primary = primary_action(state.tournament, row, viewer)
  const recovery = rows
    .filter((t) => t !== row)
    .flatMap((t) => {
      const actions = tournament_claims(t, address)
      return actions.length ? [{ row: t, actions }] : []
    })
  const visible = rows.some((t) => ['open', 'in_progress'].includes(t.status))
  const results =
    rows
      .filter((t) => !visible && (recent_tournament_result(t, now_ms) || tournament_claims(t, address).length > 0))
      .toSorted((a, b) => (b.finished_at_ms ?? 0) - (a.finished_at_ms ?? 0))[0] ?? null
  return {
    row,
    viewer,
    primary,
    recovery,
    results,
    ...tournament_controls(row, viewer, state.tournament),
    ...tournament_attendance(row, viewer),
    entry_failure: entry_failure(state.tournament, row, primary),
    card: visible ? ('event' as const) : results ? ('results' as const) : ('hidden' as const),
  }
}

const t_ready = (state: TournamentState): boolean => state.feed_status === 'loaded' && state.pending === null

const tournament_controls = (row: TournamentRow | null, viewer: TournamentViewer, state: TournamentState) => {
  const ready = t_ready(state)
  const can_write = [ready, viewer.address !== null].every(Boolean)
  if (!row)
    return {
      ready,
      can_write,
      registration_open: false,
      registration_invite: false,
      registration_expired: false,
      can_register: false,
      can_open_team_creation: false,
      team_creation_blocker: team_creation_blocker(viewer, row),
    }
  const registration_open = [
    row.status === 'open',
    viewer.now_ms !== null,
    (viewer.now_ms ?? Infinity) < row.start_before_ms,
  ].every(Boolean)
  const can_register = [can_write, registration_open].every(Boolean)
  const registered = row.teams.some((team) => team.seats.some((seat) => seat.owner === viewer.address))
  return {
    ready,
    can_write,
    registration_open,
    registration_invite: [registration_open, !registered].every(Boolean),
    can_register,
    registration_expired: [row.status === 'open', (viewer.now_ms ?? -Infinity) >= row.start_before_ms].every(Boolean),
    can_open_team_creation: [can_register, !registered, tournament_registration(row).can_create].every(Boolean),
    team_creation_blocker: team_creation_blocker(viewer, row),
  }
}

const tournament_attendance = (row: TournamentRow | null, viewer: TournamentViewer) => {
  if (!row) return { team: undefined, match_index: -1, match: undefined, admission: false, deadline: 0 }
  const team = row.teams.find((team) => team.seats.some((seat) => seat.owner === viewer.address))
  const match_index = tournament_owned_match(row, viewer)
  const match = row.matches[match_index]
  const admission = match ? match_kind(match, viewer.now_ms) === 'admission' : false
  return {
    team,
    match_index,
    match,
    admission,
    deadline: admission ? match.available_ms + ADMISSION_MS : row.start_before_ms,
  }
}
