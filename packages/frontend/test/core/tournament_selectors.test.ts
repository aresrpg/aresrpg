// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import type { TournamentMatch, TournamentRow } from '@aresrpg/protocol'

import { initial_app_state, reduce_app_state, type AppState } from '../../src/store.ts'
import { action_key, initial_tournament_state } from '../../src/modules/tournament.ts'
import {
  advancing_side,
  match_kind,
  select_tournament_view,
  team_access,
  tournament_next_action,
  tournament_podium,
  tournament_registration,
  tournament_rounds,
  tournament_seats,
  tournament_review_available,
  type TournamentViewer,
  type MatchKind,
} from '../../src/modules/tournament_selectors.ts'
import { tournament_fixture } from '../helpers/tournament.ts'

const viewer = (): TournamentViewer => ({
  address: 'owner',
  character: { id: 'a', name: 'A', custody: 'kiosk' },
  characters: [{ id: 'a', name: 'A', custody: 'kiosk' }],
  now_ms: 2000,
  observed_ms: 2000,
})

test('reviewed registration and no-winner actions recheck character, roster revision and fresh chain time', () => {
  const row = { ...tournament_fixture(), status: 'open' as const }
  const alt = { id: 'alt', name: 'Alt', custody: 'kiosk' as const }
  const context = { ...viewer(), characters: [...viewer().characters, alt] }
  const join = { kind: 'join' as const, team: 0, revision: '0', character: 'alt' }
  expect(tournament_review_available(row, join, context)).toBe(true)
  expect(
    tournament_review_available({ ...row, teams: row.teams.map((team) => ({ ...team, revision: '1' })) }, join, context)
  ).toBe(false)
  expect(tournament_review_available(row, join, { ...context, now_ms: null })).toBe(false)
  const empty = { ...row, teams: [] }
  expect(tournament_review_available(empty, { kind: 'find', character: 'alt' }, context)).toBe(true)
  const timed = { ...viewer(), now_ms: 1_801_001, observed_ms: 1_801_001 }
  expect(tournament_review_available(tournament_fixture(), { kind: 'crank', index: 0 }, timed)).toBe(true)
  expect(
    tournament_review_available(tournament_fixture(), { kind: 'crank', index: 0 }, { ...timed, observed_ms: null })
  ).toBe(false)
})
const state_for = (rows: readonly TournamentRow[]): AppState => {
  const base = initial_app_state({ quality: 'medium', music_enabled: true, render_distance: null })
  return {
    ...base,
    tournament: { ...initial_tournament_state(), feed_status: 'loaded', rows },
    session: {
      ...base.session,
      wallet: { address: 'owner' } as never,
      selected_character_id: 'a',
      characters: viewer().characters as never,
    },
    chain_clock: { chain_ms: 2000, received_ms: 0 },
  }
}

test('completed results remain for one day but yield to an open or running event', () => {
  const finished = {
    ...tournament_fixture(),
    id: 'finished',
    status: 'finished' as const,
    teams: [],
    finished_at_ms: 1000,
  }
  const state = state_for([finished])
  expect(select_tournament_view(state, null, 0)).toMatchObject({ card: 'results', results: { id: 'finished' } })
  const later = { ...state, chain_clock: { chain_ms: 86_401_000, received_ms: 0 } }
  expect(select_tournament_view(later, null, 0)).toMatchObject({ card: 'hidden', results: null })
  for (const status of ['open', 'in_progress'] as const) {
    const active = { ...tournament_fixture(), id: 'active', status }
    expect(select_tournament_view(state_for([active, finished]), null, 0)).toMatchObject({
      card: 'event',
      row: { id: 'active' },
      results: null,
    })
  }
})

test('team creation remains discoverable while character custody explains why it cannot submit', () => {
  const state = state_for([{ ...tournament_fixture(), status: 'open', teams: [] }])
  const view = (custody: 'kiosk' | 'fight' | undefined) =>
    select_tournament_view(
      {
        ...state,
        session: { ...state.session, characters: state.session.characters.map((row) => ({ ...row, custody })) },
      },
      null,
      0
    )
  expect(view('fight')).toMatchObject({ can_open_team_creation: true, team_creation_blocker: 'fight' })
  expect(view(undefined)).toMatchObject({ can_open_team_creation: true, team_creation_blocker: 'syncing' })
  expect(view('kiosk')).toMatchObject({ can_open_team_creation: true, team_creation_blocker: null })
  expect(
    select_tournament_view({ ...state, session: { ...state.session, selected_character_id: null } }, null, 0)
  ).toMatchObject({ can_open_team_creation: true, team_creation_blocker: 'character' })
  expect(
    select_tournament_view({ ...state, tournament: { ...state.tournament, pending: 'write' } }, null, 0)
  ).toMatchObject({ can_open_team_creation: false })
})
const bracket_fixture = (): TournamentRow => {
  const row = tournament_fixture()
  const teams = ['a', 'b', 'c', 'd'].map((id, index) => ({
    ...row.teams[0],
    name: id,
    seats: [{ ...row.teams[0].seats[0], character: id, owner: index === 0 ? 'owner' : 'other' }],
  }))
  const waiting: TournamentMatch = {
    a: null,
    b: null,
    available_ms: 0,
    state: 0,
    winner: null,
    loser: null,
    fight: null,
  }
  return {
    ...row,
    format: 1,
    teams,
    matches: [
      waiting,
      { ...waiting, a: 0, b: 1, state: 2, winner: 0, loser: 1 },
      { ...waiting, a: 2, b: 3, state: 1, available_ms: 1000, fight: 'semi', phase: 'active' },
      waiting,
    ],
  }
}

test('match status preserves resolved outcomes and ended fights before evaluating timeouts', () => {
  const [m] = tournament_fixture().matches
  const scenarios: readonly (readonly [Partial<TournamentMatch>, number | null, MatchKind])[] = [
    [{ state: 0 }, 9_000_000, 'waiting'],
    [{ state: 2 }, 0, 'no_winner'],
    [{ state: 2, winner: 0, b: null }, 0, 'bye'],
    [{ state: 2, winner: 0 }, 0, 'walkover'],
    [{ state: 2, winner: 0, loser: 1 }, 0, 'done'],
    [{ phase: 'ended' }, 9_000_000, 'recording'],
    [{ phase: 'active' }, 1_800_999, 'live'],
    [{ phase: 'active' }, 1_801_000, 'timed_out'],
    [{}, 60_999, 'admission'],
    [{}, 61_000, 'force_due'],
    [{}, null, 'clock_unknown'],
    [{ phase: 'active' }, null, 'live'],
  ]
  for (const [change, now, kind] of scenarios) expect(match_kind({ ...m, ...change }, now)).toBe(kind)
})

test('known child results preview final and bronze sides without activating or mutating the parent', () => {
  const row = bracket_fixture()
  const before = JSON.stringify(row)
  expect(advancing_side(row, 0, 0)).toEqual({ kind: 'advancing', team: 0 })
  expect(advancing_side(row, 0, 1)).toEqual({ kind: 'pending', match: 2, via: 'winner' })
  expect(advancing_side(row, 3, 0)).toEqual({ kind: 'advancing', team: 1 })
  expect(advancing_side(row, 3, 1)).toEqual({ kind: 'pending', match: 2, via: 'loser' })
  const no_loser = { ...row, matches: row.matches.map((m, i) => (i === 1 ? { ...m, loser: null } : m)) }
  expect(advancing_side(no_loser, 3, 0)).toEqual({ kind: 'empty' })
  expect(JSON.stringify(row)).toBe(before)
  expect(row.matches[0].state).toBe(0)
})

test('round grouping handles empty, two-team, and 64-team brackets with one separate bronze match', () => {
  const row = tournament_fixture()
  expect(tournament_rounds({ ...row, matches: [] }, 2000)).toEqual({ rounds: [], bronze: null })
  expect(tournament_rounds(row, 2000).rounds.map((r) => r.matches.length)).toEqual([1])
  const big = tournament_rounds(
    { ...row, matches: Array.from({ length: 64 }, () => ({ ...row.matches[0], state: 0, a: null, b: null })) },
    2000
  )
  expect(big.rounds.map((r) => r.matches.length)).toEqual([32, 16, 8, 4, 2, 1])
  expect(big.bronze?.index).toBe(63)
})

test('team access applies restrictions to additional owned characters and preserves consent', () => {
  const row = { ...tournament_fixture(), status: 'open' as const }
  expect(team_access(row, 0, viewer())).toBe('registered')
  const extra = { ...viewer(), character: { id: 'extra', name: 'Extra', custody: 'kiosk' as const } }
  expect(team_access(row, 0, extra)).toBe('add')
  expect(team_access(row, 1, extra)).toBe('elsewhere')
  expect(team_access({ ...row, teams: [{ ...row.teams[0], allowed: ['a', 'b'] }] }, 0, extra)).toBe('restricted')
  expect(team_access({ ...row, format: 1 }, 0, extra)).toBe('full')
  expect(team_access(row, 0, { ...extra, character: { ...extra.character, custody: 'fight' } })).toBe('custody')
  expect(team_access(row, 0, { ...extra, now_ms: null })).toBe('clock')
  expect(team_access(row, 0, { ...extra, now_ms: row.start_before_ms })).toBe('closed')
})

test('registration counts honor both asset tables, item placements, and reusable empty team slots', () => {
  const row = tournament_fixture()
  expect(tournament_registration(row)).toMatchObject({ teams: 2, complete: 0, minimum: 4, can_create: true })
  expect(tournament_registration({ ...row, token_bps: [0, 0, 0, 0, 10000] }).minimum).toBe(8)
  expect(
    tournament_registration({ ...row, sui_bps: [10000, 0, 0, 0, 0], token_bps: [10000, 0, 0, 0, 0] }).minimum
  ).toBe(2)
  expect(tournament_registration({ ...row, rewards: [{ place: 5, amount: 1, template: 'prize' }] }).minimum).toBe(8)
  const full = {
    ...row,
    status: 'open' as const,
    format: 1 as const,
    teams: Array.from({ length: 64 }, () => ({
      ...row.teams[0],
      seats: [{ ...row.teams[0].seats[0], owner: 'other', character: 'other' }],
    })),
  }
  expect(tournament_registration({ ...full, teams: full.teams.slice(0, 63) }).can_create).toBe(true)
  expect(tournament_next_action(full, viewer())).toEqual({ kind: 'status', reason: 'full' })
  expect(
    tournament_next_action({ ...full, teams: [{ ...full.teams[0], seats: [] }, ...full.teams.slice(1)] }, viewer())
  ).toMatchObject({ name: 'find' })
})

test('reserved seats use character IDs, deduplicate reservations, and leave unknown names unset', () => {
  const row = tournament_fixture()
  const t = {
    ...row,
    teams: [
      {
        ...row.teams[0],
        allowed: ['a', 'reserved', 'reserved'],
        allowed_names: { reserved: 'A' },
        seats: [{ ...row.teams[0].seats[0], name: 'A' }],
      },
    ],
  }
  expect(tournament_seats(t, 0, 'owner')).toEqual([
    { kind: 'registered', character: 'a', name: 'A', own: true },
    { kind: 'reserved', character: 'reserved', name: 'A' },
    { kind: 'empty' },
  ])
  expect(tournament_seats({ ...t, teams: [{ ...t.teams[0], allowed_names: {} }] }, 0, 'owner')[1]).toEqual({
    kind: 'reserved',
    character: 'reserved',
    name: null,
  })
})

test('one primary registration rule chooses only an eligible owned character and the shown revision', () => {
  const row = { ...tournament_fixture(), status: 'open' as const }
  const extra = { id: 'extra', name: 'Extra', custody: 'kiosk' as const }
  const v = { ...viewer(), characters: [...viewer().characters, extra] }
  expect(tournament_next_action(row, v)).toMatchObject({
    kind: 'write',
    name: 'add',
    action: { kind: 'join', team: 0, revision: '0', character: 'extra' },
  })
  expect(tournament_next_action({ ...row, teams: [{ ...row.teams[0], allowed: ['a', 'b'] }] }, v)).toEqual({
    kind: 'status',
    reason: 'registered',
  })
  expect(tournament_next_action(row, { ...v, now_ms: 10000, observed_ms: 9999 })).toEqual({
    kind: 'status',
    reason: 'clock',
  })
  expect(tournament_next_action(row, { ...v, now_ms: 10000, observed_ms: 10000 })).toMatchObject({
    kind: 'write',
    action: { kind: 'expire' },
  })
})

test('admission never uses an unrelated selected character, and an unopened no-show ends without a winner', () => {
  const row = tournament_fixture()
  const unrelated = { id: 'unregistered', name: 'Other', custody: 'kiosk' as const }
  expect(
    tournament_next_action(row, { ...viewer(), character: unrelated, characters: [unrelated, ...viewer().characters] })
  ).toMatchObject({ name: 'open', action: { kind: 'enter', character: 'a' } })
  expect(tournament_next_action(row, { ...viewer(), now_ms: 61000, observed_ms: 60999 })).toEqual({
    kind: 'status',
    reason: 'clock',
  })
  expect(tournament_next_action(row, { ...viewer(), now_ms: 61000, observed_ms: 61000 })).toMatchObject({
    name: 'end',
    confirm: true,
    action: { kind: 'crank', index: 0 },
  })
})

test('waiting for an opponent exposes recovery before spectating, and any owned fight blocks Watch', () => {
  const row = bracket_fixture()
  expect(tournament_next_action(row, viewer())).toEqual({ kind: 'watch', index: 2, fight: 'semi', character: 'a' })
  const busy = { ...viewer(), characters: [{ id: 'elsewhere', name: 'Busy', custody: 'fight' as const }] }
  expect(tournament_next_action(row, busy)).toEqual({ kind: 'status', reason: 'cannot_watch' })
  const ended = { ...row, matches: row.matches.map((m, i) => (i === 2 ? { ...m, phase: 'ended' as const } : m)) }
  expect(tournament_next_action(ended, { ...viewer(), now_ms: 2_000_000, observed_ms: 2_000_000 })).toMatchObject({
    name: 'record',
    action: { kind: 'crank', index: 2 },
  })
  expect(tournament_next_action(row, { ...viewer(), now_ms: 1_801_000, observed_ms: 1_801_000 })).toMatchObject({
    name: 'end',
    confirm: true,
  })
})

test('dependency recovery follows earlier rounds and prioritizes confirmed work over an estimated deadline', () => {
  const row = bracket_fixture()
  const waiting: TournamentMatch = {
    a: null,
    b: null,
    available_ms: 0,
    state: 0,
    winner: null,
    loser: null,
    fight: null,
  }
  const completed = { ...waiting, state: 2 as const, a: 0, b: 1, winner: 0, loser: 1 }
  const teams = [
    ...row.teams,
    ...['e', 'f', 'g', 'h'].map((id) => ({
      ...row.teams[1],
      name: id,
      seats: [{ ...row.teams[1].seats[0], character: id }],
    })),
  ]
  const earlier = {
    ...row,
    teams,
    matches: [
      waiting,
      { ...completed, b: 2, loser: 2 },
      waiting,
      completed,
      { ...completed, a: 2, b: 3, winner: 2, loser: 3 },
      { ...waiting, state: 1 as const, a: 4, b: 5, fight: 'waiting', phase: 'placement' as const, available_ms: 1000 },
      { ...waiting, state: 1 as const, a: 6, b: 7, fight: 'ended', phase: 'ended' as const, available_ms: 1000 },
      waiting,
    ],
  }
  expect(tournament_next_action(earlier, { ...viewer(), now_ms: 62000, observed_ms: 60000 })).toMatchObject({
    name: 'record',
    action: { kind: 'crank', index: 6 },
  })
})

test('returning to a fight requires actual owned custody, including placement with an unavailable clock', () => {
  const row = tournament_fixture()
  const linked = { ...row, matches: [{ ...row.matches[0], fight: 'fight', phase: 'active' as const }] }
  expect(tournament_next_action(linked, viewer())).toMatchObject({ kind: 'watch' })
  const seated = { id: 'a', name: 'A', custody: 'fight' as const, active_fight: { id: 'fight', seat: 0 } }
  const v = { ...viewer(), character: seated, characters: [seated], now_ms: null, observed_ms: null }
  expect(tournament_next_action(linked, v)).toEqual({ kind: 'return', fight: 'fight', character: 'a' })
  expect(tournament_next_action({ ...linked, matches: [{ ...linked.matches[0], phase: 'placement' }] }, v)).toEqual({
    kind: 'return',
    fight: 'fight',
    character: 'a',
  })
})

test('podium uses frozen totals and one shared fifth-place tier while claims remain per seat', () => {
  const row = tournament_fixture()
  const t = {
    ...row,
    status: 'finished' as const,
    sui_total: '1001',
    sui_pool: '1',
    sui_bps: [0, 0, 0, 0, 10000],
    teams: [0, 1, 2, 3].map(() => ({ ...row.teams[0], place: 5, seats: [row.teams[0].seats[0]] })),
  }
  const [, , , , fifth] = tournament_podium(t)
  expect(fifth.sui).toBe(1001n)
  expect(fifth.seats.map((s) => s.sui)).toEqual([251n, 250n, 250n, 250n])
  expect(tournament_next_action(t, viewer())).toMatchObject({
    kind: 'claims',
    actions: [0, 1, 2, 3].map((team) => ({ kind: 'coins', team, seat: 0 })),
  })
  expect(
    tournament_podium({ ...t, status: 'cancelled' }).every(
      (p) => p.sui === 0n && p.kares === 0n && p.seats.length === 0
    )
  ).toBe(true)
  expect(tournament_podium({ ...t, teams: [] }).every((p) => p.sui === 0n)).toBe(true)
})

test('card and action projections distinguish unknown feeds, empty feeds, and older unclaimed events', () => {
  const empty = state_for([])
  expect(select_tournament_view(empty, null, 0)).toMatchObject({
    card: 'hidden',
    primary: { kind: 'status', reason: 'none' },
  })
  expect(select_tournament_view({ ...empty, tournament: initial_tournament_state() }, null, 0).card).toBe('hidden')
  const row = tournament_fixture()
  const winner = { ...row, id: 'old', status: 'finished' as const, teams: [{ ...row.teams[0], place: 1 }] }
  const state = state_for([{ ...row, status: 'cancelled' }, winner])
  expect(select_tournament_view(state, null, 0)).toMatchObject({
    row: { id: 'old' },
    card: 'results',
    primary: { kind: 'claims' },
  })
  expect(
    select_tournament_view({ ...state, tournament: { ...state.tournament, feed_status: 'unavailable' } }, null, 0)
  ).toMatchObject({ card: 'results', primary: { reason: 'unavailable' } })
  const live = state_for([row])
  const key = action_key(row, { kind: 'enter', index: 0, character: 'a' })
  const failed = {
    ...live,
    tournament: {
      ...live.tournament,
      entry_failures: { [key]: { id: row.id, index: 0, character: 'a', version: row.version, reason: 'Gas shortage' } },
    },
  }
  expect(select_tournament_view(failed, null, 0).entry_failure?.reason).toBe('Gas shortage')
  expect(select_tournament_view(live, null, 16000).primary).toEqual({ kind: 'status', reason: 'clock_unknown' })
})

test('the HUD keeps Blast until a relevant tournament is received and retains known events across reconnects', () => {
  const initial = { ...state_for([]), tournament: initial_tournament_state() }
  const view = (state: AppState) => select_tournament_view(state, null, 0)
  expect(view(initial)).toMatchObject({ card: 'hidden', primary: { reason: 'loading' }, can_write: false })
  const failed = reduce_app_state(initial, {
    type: 'server/packet',
    packet: { type: 'packet/tournaments_error', reason: 'unavailable' },
  })
  expect(view(failed)).toMatchObject({ card: 'hidden', primary: { reason: 'unavailable' }, can_write: false })
  const known = reduce_app_state(failed, {
    type: 'server/packet',
    packet: { type: 'packet/tournaments', tournaments: [{ ...tournament_fixture(), status: 'open' }] },
  })
  expect(view(known).card).toBe('event')
  const disconnected = reduce_app_state(known, { type: 'link/failed', error: 'offline' })
  expect(view(disconnected)).toMatchObject({ card: 'event', primary: { reason: 'unavailable' }, can_write: false })
  const reconnecting = reduce_app_state(disconnected, { type: 'link/connecting' })
  expect(view(reconnecting)).toMatchObject({ card: 'event', primary: { reason: 'loading' }, can_write: false })
  const empty = reduce_app_state(reconnecting, {
    type: 'server/packet',
    packet: { type: 'packet/tournaments', tournaments: [] },
  })
  expect(view(empty).card).toBe('hidden')
  expect(view(reduce_app_state(known, { type: 'auth/disconnected' })).card).toBe('hidden')
})
