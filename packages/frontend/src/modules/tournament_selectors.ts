// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { coin_share, type CharacterRow, type TournamentMatch, type TournamentRow } from '@aresrpg/protocol'
import { CONTRACT_CONSTANTS } from '@aresrpg/fight/move_contract'
import { TOURNAMENT_MATCH_MS, TOURNAMENT_MAX_TEAMS } from '@aresrpg/sdk/tournament'

import { chain_now, type ChainClock } from './chain_clock.ts'
import { action_key, open_team, tournament_claims, type TournamentAction, type TournamentState } from './tournament.ts'

const ADMISSION_MS = Number(CONTRACT_CONSTANTS.placement_force_ms)
type Character = Readonly<Pick<CharacterRow, 'id' | 'name' | 'custody' | 'active_fight'>>
export type TournamentViewSource = Readonly<{
  tournament: TournamentState
  chain_clock: ChainClock
  session: Readonly<{
    wallet: Readonly<{ address: string }> | null
    characters: readonly Character[]
    selected_character_id: string | null
  }>
}>
export type TournamentViewer = Readonly<{
  address: string | null
  character: Character | null
  characters: readonly Character[]
  now_ms: number | null
  observed_ms: number | null
}>
export type MatchKind =
  | 'waiting'
  | 'admission'
  | 'force_due'
  | 'live'
  | 'recording'
  | 'timed_out'
  | 'done'
  | 'walkover'
  | 'bye'
  | 'no_winner'
  | 'clock_unknown'
export type AdvancingSide =
  | Readonly<{ kind: 'assigned' | 'advancing'; team: number }>
  | Readonly<{ kind: 'pending'; match: number; via: 'winner' | 'loser' }>
  | Readonly<{ kind: 'empty' }>

export const match_kind = (match: TournamentMatch, now_ms: number | null): MatchKind => {
  // Ordered facts: a recorded result beats time, and an ended Fight beats expiry.
  const outcome: readonly (readonly [boolean, MatchKind])[] = [
    [match.winner === null, 'no_winner'],
    [[match.a, match.b].includes(null), 'bye'],
    [match.loser === null, 'walkover'],
    [true, 'done'],
  ]
  const age = now_ms === null ? -Infinity : now_ms - match.available_ms
  const states: readonly (readonly [boolean, MatchKind])[] = [
    [match.state === 0, 'waiting'],
    [match.state === 2, outcome.find(([yes]) => yes)![1]],
    [match.phase === 'ended', 'recording'],
    [age >= TOURNAMENT_MATCH_MS, 'timed_out'],
    [match.phase === 'active', 'live'],
    [now_ms === null, 'clock_unknown'],
    [age >= ADMISSION_MS, 'force_due'],
    [true, 'admission'],
  ]
  return states.find(([yes]) => yes)![1]
}

const tree_count = (row: TournamentRow): number =>
  row.matches.length > 1 ? row.matches.length - 1 : row.matches.length
const feeders = (row: TournamentRow, index: number): readonly number[] => {
  const count = tree_count(row)
  if (count > 1 && index === count) return [1, 2]
  return [2 * index + 1, 2 * index + 2].filter((child) => child < count)
}

export const advancing_side = (row: TournamentRow, index: number, side: 0 | 1): AdvancingSide => {
  const team = side === 0 ? row.matches[index].a : row.matches[index].b
  if (team !== null) return { kind: 'assigned', team }
  const source = feeders(row, index)[side]
  if (source === undefined) return { kind: 'empty' }
  const via = index === tree_count(row) ? 'loser' : 'winner'
  const child = row.matches[source]
  if (child.state !== 2) return { kind: 'pending', match: source, via }
  const advancing = child[via]
  return advancing === null ? { kind: 'empty' } : { kind: 'advancing', team: advancing }
}

export const tournament_rounds = (row: TournamentRow, now_ms: number | null) => {
  const count = tree_count(row)
  const depths = Math.log2(count + 1)
  const view = (index: number) => ({
    index,
    match: row.matches[index],
    kind: match_kind(row.matches[index], now_ms),
    sides: [advancing_side(row, index, 0), advancing_side(row, index, 1)] as const,
  })
  return {
    rounds: Array.from({ length: depths }, (_, round) => {
      const depth = depths - 1 - round
      const matches = Array.from({ length: 2 ** depth }, (_, offset) => view(2 ** depth - 1 + offset))
      return {
        depth,
        matches,
        live: matches.filter((m) => m.kind === 'live').length,
        done: matches.filter((m) => m.match.state === 2).length,
      }
    }),
    bronze: count > 1 ? view(count) : null,
  }
}

export type TeamAccess =
  | 'registered'
  | 'join'
  | 'add'
  | 'closed'
  | 'clock'
  | 'wallet'
  | 'character'
  | 'elsewhere'
  | 'full'
  | 'restricted'
  | 'custody'
export const team_access = (row: TournamentRow, team: number, viewer: TournamentViewer): TeamAccess => {
  const { character } = viewer
  const own = row.teams.findIndex((t) => t.seats.some((seat) => seat.owner === viewer.address))
  const registered = row.teams.findIndex((t) => t.seats.some((seat) => seat.character === character?.id))
  const roster = row.teams[team]
  const allowed = roster.allowed.length === 0 || roster.allowed.some((id) => id === character?.id)
  const rules: readonly (readonly [boolean, TeamAccess])[] = [
    [row.status !== 'open', 'closed'],
    [viewer.now_ms === null, 'clock'],
    [(viewer.now_ms ?? -Infinity) >= row.start_before_ms, 'closed'],
    [viewer.address === null, 'wallet'],
    [character === null, 'character'],
    [registered === team && own === team, 'registered'],
    [registered >= 0, 'elsewhere'],
    [own >= 0 && own !== team, 'elsewhere'],
    [roster.seats.length >= row.format, 'full'],
    [!allowed, 'restricted'],
    [character?.custody !== 'kiosk', 'custody'],
    [own === team, 'add'],
    [true, 'join'],
  ]
  return rules.find(([yes]) => yes)![1]
}

export type SeatView = Readonly<
  | { kind: 'registered'; character: string; name: string | null; own: boolean }
  | { kind: 'reserved'; character: string; name: string | null }
  | { kind: 'empty' }
>
export const tournament_seats = (row: TournamentRow, team: number, address: string | null): readonly SeatView[] => {
  const roster = row.teams[team]
  const registered: readonly SeatView[] = roster.seats.map((seat) => ({
    kind: 'registered',
    character: seat.character,
    name: seat.name ?? null,
    own: seat.owner === address,
  }))
  const reserved: readonly SeatView[] = [...new Set(roster.allowed)]
    .filter((id) => !roster.seats.some((seat) => seat.character === id))
    .map((id) => ({ kind: 'reserved', character: id, name: roster.allowed_names?.[id] ?? null }))
  const empty = Array.from({ length: Math.max(0, row.format - registered.length - reserved.length) }, (): SeatView => ({
    kind: 'empty',
  }))
  return [...registered, ...reserved, ...empty]
}

export const minimum_tournament_teams = (row: Pick<TournamentRow, 'sui_bps' | 'token_bps' | 'rewards'>): number => {
  const places = row.sui_bps.flatMap((bps, index) => (bps + row.token_bps[index] > 0 ? [index + 1] : []))
  const last_place = Math.max(1, ...places, ...row.rewards.map((reward) => reward.place))
  return 2 ** Math.ceil(last_place / 2)
}

export const tournament_registration = (row: TournamentRow) => {
  return {
    teams: row.teams.filter((team) => team.seats.length > 0).length,
    complete: row.teams.filter((team) => team.seats.length === row.format).length,
    minimum: minimum_tournament_teams(row),
    can_create: row.teams.length < TOURNAMENT_MAX_TEAMS || row.teams.some((team) => team.seats.length === 0),
  }
}

export const tournament_refund_available = (row: TournamentRow): boolean =>
  [row.kares_pool !== null, !row.token_refunded, ['finished', 'cancelled'].includes(row.status)].every(Boolean)

export const tournament_podium = (row: TournamentRow) => {
  const final = row.status === 'finished'
  const sui_total = row.status === 'open' ? row.sui_pool : row.sui_total
  const token_total = row.kares_pool ? (row.status === 'open' ? row.token_pool : row.token_total) : '0'
  return Array.from({ length: 5 }, (_, index) => {
    const place = index + 1
    const teams = final ? row.teams.flatMap((team, team_index) => (team.place === place ? [team_index] : [])) : []
    const seats = teams.flatMap((team) => row.teams[team].seats.map((member, seat) => ({ team, seat, member })))
    const payable = row.status !== 'cancelled' && (row.status !== 'finished' || seats.length > 0)
    const sui = payable ? coin_share(sui_total, row.sui_bps[index], 1, 0) : 0n
    const kares = payable ? coin_share(token_total, row.token_bps[index], 1, 0) : 0n
    return {
      place,
      teams,
      sui,
      kares,
      final: row.status === 'finished',
      items: row.rewards.flatMap((reward, reward_index) =>
        reward.place === place && payable ? [{ ...reward, index: reward_index }] : []
      ),
      seats: seats.map((seat, ordinal) => ({
        ...seat,
        sui: coin_share(sui_total, row.sui_bps[index], seats.length, ordinal),
        kares: coin_share(token_total, row.token_bps[index], seats.length, ordinal),
      })),
    }
  })
}

type WriteName = 'find' | 'add' | 'open' | 'join' | 'start' | 'record' | 'end' | 'expire' | 'refund'
type ActionReason =
  | TeamAccess
  | MatchKind
  | TournamentState['feed_status']
  | 'none'
  | 'pending'
  | 'finished'
  | 'cancelled'
  | 'cannot_watch'
export type TournamentNextAction =
  | Readonly<{ kind: 'status'; reason: ActionReason }>
  | Readonly<{ kind: 'write'; name: WriteName; action: TournamentAction; confirm: boolean }>
  | Readonly<{ kind: 'watch'; index: number; fight: string; character: string }>
  | Readonly<{ kind: 'return'; fight: string; character: string }>
  | Readonly<{ kind: 'claims'; actions: readonly TournamentAction[] }>
  | Readonly<{ kind: 'bracket' }>
const status = (reason: ActionReason): TournamentNextAction => ({ kind: 'status', reason })
const write = (name: WriteName, action: TournamentAction, confirm = false): TournamentNextAction => ({
  kind: 'write',
  name,
  action,
  confirm,
})
const owns_fight = (viewer: TournamentViewer): boolean =>
  viewer.characters.some((c) => c.custody === 'fight' || c.active_fight !== undefined)

const return_to_fight = (match: TournamentMatch, viewer: TournamentViewer): TournamentNextAction | null => {
  const seated = viewer.characters.find((c) => c.active_fight?.id === match.fight)
  return seated ? { kind: 'return', fight: match.fight!, character: seated.id } : null
}

const watch = (row: TournamentRow, index: number, viewer: TournamentViewer): TournamentNextAction => {
  const match = row.matches[index]
  if (!viewer.character || owns_fight(viewer) || !match.fight) return status('cannot_watch')
  if (match.phase !== 'active' && match.phase !== 'placement') return status('waiting')
  return { kind: 'watch', index, fight: match.fight, character: viewer.character.id }
}

const registration_action = (row: TournamentRow, viewer: TournamentViewer): TournamentNextAction => {
  const own = row.teams.findIndex((team) => team.seats.some((seat) => seat.owner === viewer.address))
  if (own < 0) {
    if (!viewer.character) return status('character')
    if (viewer.character.custody !== 'kiosk') return status('custody')
    const { can_create } = tournament_registration(row)
    if (!can_create && open_team(row, viewer.character.id, viewer.address!) < 0) return status('full')
    return write('find', { kind: 'find', character: viewer.character.id })
  }
  const eligible = [viewer.character, ...viewer.characters].find(
    (character) => character && team_access(row, own, { ...viewer, character }) === 'add'
  )
  return eligible
    ? write('add', { kind: 'join', team: own, revision: row.teams[own].revision, character: eligible.id })
    : status('registered')
}

export const tournament_owned_match = (row: TournamentRow, viewer: TournamentViewer): number => {
  const own = row.teams.findIndex((team) => team.seats.some((seat) => seat.owner === viewer.address))
  if (own < 0) return -1
  const pending = row.matches.flatMap((match, index) =>
    match.state !== 2 &&
    [0, 1].some((side) => {
      const value = advancing_side(row, index, side as 0 | 1)
      return 'team' in value && value.team === own
    })
      ? [index]
      : []
  )
  return pending.find((index) => row.matches[index].state === 1) ?? pending[0] ?? -1
}

const active_feeders = (row: TournamentRow, index: number): readonly number[] => {
  const match = row.matches[index]
  if (match.state === 2) return []
  return match.state === 1 ? [index] : feeders(row, index).flatMap((child) => active_feeders(row, child))
}

export const match_recovery = (
  row: TournamentRow,
  index: number,
  viewer: TournamentViewer
): TournamentNextAction | null => {
  const match = row.matches[index]
  const kind = match_kind(match, viewer.now_ms)
  if (kind === 'recording') return write('record', { kind: 'crank', index })
  if (!['timed_out', 'force_due'].includes(kind)) return null
  const due = match.available_ms + (kind === 'timed_out' ? TOURNAMENT_MATCH_MS : ADMISSION_MS)
  if ((viewer.observed_ms ?? -Infinity) < due) return status('clock')
  const no_winner = kind === 'timed_out' || match.fight === null
  return write(no_winner ? 'end' : 'start', { kind: 'crank', index }, no_winner)
}

const admission_action = (row: TournamentRow, index: number, viewer: TournamentViewer): TournamentNextAction => {
  const match = row.matches[index]
  const registered = [match.a, match.b]
    .flatMap((team) => (team === null ? [] : row.teams[team].seats))
    .filter((seat) => seat.owner === viewer.address)
    .map((seat) => seat.character)
  const eligible = [viewer.character, ...viewer.characters].find(
    (c) => c && c.custody === 'kiosk' && registered.includes(c.id) && !match.joined?.includes(c.id)
  )
  if (eligible) return write(match.fight ? 'join' : 'open', { kind: 'enter', index, character: eligible.id })
  return return_to_fight(match, viewer) ?? status('custody')
}

const waiting_action = (row: TournamentRow, index: number, viewer: TournamentViewer): TournamentNextAction => {
  const waiting = active_feeders(row, index)
  const repairs = waiting.map((child) => match_recovery(row, child, viewer))
  const repair = repairs.find((action) => action?.kind === 'write') ?? repairs.find(Boolean)
  if (repair) return repair
  const live = waiting.find((child) => ['active', 'placement'].includes(row.matches[child].phase ?? ''))
  return live === undefined ? status('waiting') : watch(row, live, viewer)
}

export const tournament_match_action = (
  row: TournamentRow,
  index: number,
  viewer: TournamentViewer
): TournamentNextAction => {
  if (!viewer.address) return status('wallet')
  const recovery = match_recovery(row, index, viewer)
  if (recovery) return recovery
  const match = row.matches[index]
  const kind = match_kind(match, viewer.now_ms)
  const owned = [match.a, match.b].some(
    (team) => team !== null && row.teams[team].seats.some((seat) => seat.owner === viewer.address)
  )
  if (kind === 'admission' && owned) return admission_action(row, index, viewer)
  const seated = return_to_fight(match, viewer)
  if (seated) return seated
  if (kind === 'live') return watch(row, index, viewer)
  return kind === 'waiting' ? waiting_action(row, index, viewer) : status(kind)
}

const running_action = (row: TournamentRow, viewer: TournamentViewer): TournamentNextAction => {
  const index = tournament_owned_match(row, viewer)
  if (index >= 0) return tournament_match_action(row, index, viewer)
  const live = row.matches.findIndex((match) => match_kind(match, viewer.now_ms) === 'live')
  return live >= 0 ? watch(row, live, viewer) : { kind: 'bracket' }
}

const open_action = (row: TournamentRow, viewer: TournamentViewer): TournamentNextAction => {
  if (viewer.now_ms === null) return status('clock')
  if (viewer.now_ms < row.start_before_ms) return registration_action(row, viewer)
  return (viewer.observed_ms ?? -Infinity) >= row.start_before_ms
    ? write('expire', { kind: 'expire' })
    : status('clock')
}

const PHASE_ACTIONS: Readonly<
  Record<TournamentRow['status'], (row: TournamentRow, viewer: TournamentViewer) => TournamentNextAction>
> = {
  open: open_action,
  in_progress: running_action,
  finished: (row, viewer) => {
    const actions = tournament_claims(row, viewer.address)
    return actions.length ? { kind: 'claims', actions } : status('finished')
  },
  cancelled: (row) => (tournament_refund_available(row) ? write('refund', { kind: 'refund' }) : status('cancelled')),
}
export const tournament_next_action = (row: TournamentRow, viewer: TournamentViewer): TournamentNextAction =>
  viewer.address ? PHASE_ACTIONS[row.status](row, viewer) : status('wallet')

/** A dialog retains its reviewed character and revision, but rechecks current eligibility. */
export const tournament_review_available = (
  row: TournamentRow,
  action: TournamentAction,
  viewer: TournamentViewer
): boolean => {
  if (action.kind === 'crank') {
    const current = match_recovery(row, action.index, viewer)
    return current?.kind === 'write' && current.confirm
  }
  if (action.kind !== 'find' && action.kind !== 'join') return false
  const character = viewer.characters.find((entry) => entry.id === action.character) ?? null
  const context = { ...viewer, character }
  if (action.kind === 'join')
    return [
      row.teams[action.team]?.revision === action.revision,
      ['join', 'add'].includes(team_access(row, action.team, context)),
    ].every(Boolean)
  const current = tournament_next_action(row, context)
  return current.kind === 'write' && current.action.kind === 'find' && current.action.character === action.character
}

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
  const visible = rows.some(
    (t) => ['open', 'in_progress'].includes(t.status) || tournament_claims(t, address).length > 0
  )
  return {
    row,
    viewer,
    primary,
    recovery,
    ...tournament_controls(row, viewer, state.tournament),
    ...tournament_attendance(row, viewer),
    entry_failure: entry_failure(state.tournament, row, primary),
    card: visible ? ('event' as const) : ('hidden' as const),
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
      registration_expired: false,
      can_register: false,
      can_create_team: false,
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
    can_register,
    registration_expired: [row.status === 'open', (viewer.now_ms ?? -Infinity) >= row.start_before_ms].every(Boolean),
    can_create_team: [
      can_register,
      !registered,
      tournament_registration(row).can_create,
      viewer.character?.custody === 'kiosk',
    ].every(Boolean),
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
