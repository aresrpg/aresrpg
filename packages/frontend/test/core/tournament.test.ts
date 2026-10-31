// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import { tournament_fixture } from '../helpers/tournament.ts'
import {
  automatic_actions,
  open_team,
  initial_tournament_state,
  tournament_opened_elsewhere,
} from '../../src/modules/tournament.ts'
import { create_app, initial_app_state, reduce_app_state, type AppState } from '../../src/store.ts'

const state_for = (row = tournament_fixture()): AppState => {
  const state = initial_app_state({ quality: 'medium', music_enabled: true, render_distance: null })
  return {
    ...state,
    tournament: { ...initial_tournament_state(), rows: [row] },
    session: {
      ...state.session,
      wallet: { address: 'owner' } as never,
      characters: [{ id: 'a', custody: 'kiosk' }] as never,
    },
  }
}

test('automatic admission uses confirmed owned seats and stops at the placement deadline', () => {
  const state = state_for()
  expect(automatic_actions(state, 1000)).toEqual([{ id: 'cup', action: { kind: 'enter', index: 0, character: 'a' } }])
  expect(automatic_actions(state, 61_000)).toEqual([])
  const joined = {
    ...tournament_fixture(),
    matches: [{ ...tournament_fixture().matches[0], fight: 'fight', joined: ['a'] }],
  }
  expect(automatic_actions(state_for(joined), 2000)).toEqual([])
  expect(
    automatic_actions(
      { ...state, session: { ...state.session, characters: [{ id: 'a', custody: 'fight' }] as never } },
      1000
    )
  ).toEqual([])
})

test('ended fights can be recorded without waiting for custody settlement', () => {
  const row = tournament_fixture()
  expect(
    automatic_actions(state_for({ ...row, matches: [{ ...row.matches[0], fight: 'fight', phase: 'ended' }] }), 99_000)
  ).toEqual([{ id: 'cup', action: { kind: 'crank', index: 0 } }])
})

test('prize recovery includes absent registered teammates but excludes other wallets and claimed items', () => {
  const row = tournament_fixture()
  const winner = { ...row, status: 'finished' as const, teams: [{ ...row.teams[0], place: 1 }, row.teams[1]] }
  expect(automatic_actions(state_for(winner), 99_000)).toEqual([
    { id: 'cup', action: { kind: 'coins', team: 0, seat: 0 } },
    { id: 'cup', action: { kind: 'item', team: 0, seat: 0, reward: 0 } },
  ])
  expect(
    automatic_actions(
      state_for({
        ...winner,
        teams: [
          { ...winner.teams[0], seats: [{ ...winner.teams[0].seats[0], sui_claimed: true, items_claimed: '1' }] },
        ],
      }),
      99_000
    )
  ).toEqual([])
})

test('team finding fills an existing team without placing a wallet on opposing sides', () => {
  const row = tournament_fixture()
  expect(open_team(row, 'new', 'new-owner')).toBe(0)
  expect(open_team(row, 'new', 'owner')).toBe(0)
  expect(open_team({ ...row, format: 1 }, 'new', 'owner')).toBe(-1)
  expect(open_team({ ...row, teams: [row.teams[1]] }, 'stranger', 'stranger')).toBe(-1)
})

test('stale tournament snapshots cannot resurrect already claimed prizes', () => {
  const state = state_for({ ...tournament_fixture(), version: '9', status: 'finished' })
  const next = reduce_app_state(state, {
    type: 'server/packet',
    packet: { type: 'packet/tournaments', tournaments: [tournament_fixture()] },
  })
  expect(next.tournament.rows[0].status).toBe('finished')
  expect(next.tournament.rows[0].version).toBe('9')
  expect(reduce_app_state(next, { type: 'auth/disconnected' }).tournament).toEqual(initial_tournament_state())
})

test('independently stale KARES pool snapshots cannot resurrect token claims', () => {
  const row = { ...tournament_fixture(), kares_pool: 'pool', token_version: '12' }
  const state = state_for(row)
  const next = reduce_app_state(state, {
    type: 'server/packet',
    packet: { type: 'packet/tournaments', tournaments: [{ ...row, version: '6', token_version: '11' }] },
  })
  expect(next.tournament.rows[0]).toBe(row)
})

test('zero coin allocations never generate an automatic write, including item-only prizes', () => {
  const row = tournament_fixture()
  const finished = {
    ...row,
    status: 'finished' as const,
    sui_total: '0',
    token_total: '0',
    teams: [{ ...row.teams[0], place: 1 }, row.teams[1]],
  }
  expect(automatic_actions(state_for(finished), 99_000)).toEqual([
    { id: 'cup', action: { kind: 'item', team: 0, seat: 0, reward: 0 } },
  ])
  expect(
    automatic_actions(state_for({ ...finished, sui_total: '100', sui_bps: [0, 10000, 0, 0, 0], rewards: [] }), 99_000)
  ).toEqual([])
})

test('lost opening races admit every owned character to the confirmed fight once across reloads', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  const values = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => void values.set(key, value),
      removeItem: (key: string) => void values.delete(key),
    },
  })
  const calls: string[] = []
  const row = tournament_fixture()
  const own = {
    ...row,
    teams: [{ ...row.teams[0], seats: row.teams[0].seats.map((seat) => ({ ...seat, owner: 'owner' })) }, row.teams[1]],
  }
  const wallet = {
    address: 'owner',
    tournament: {
      open: async ({ character_id }: { character_id: string }) => {
        calls.push(`open:${character_id}`)
        throw new Error(
          '[sdk] transaction resolution failed — NOT submitted: MoveAbort in 2nd command, abort code: 3204, in 0xc133::tournament::link_fight (instruction 10)'
        )
      },
      join: async ({ character_id }: { character_id: string }) => {
        calls.push(`join:${character_id}`)
        return { digest: `joined-${character_id}` }
      },
    },
  }
  const load = () => {
    const app = create_app()
    const stop = app.observe(['tournament'])
    app.dispatch({ type: 'auth/connecting' })
    app.dispatch({ type: 'auth/connected', session: wallet as never })
    app.dispatch({
      type: 'server/packet',
      packet: {
        type: 'packet/characters',
        characters: ['a', 'b'].map((id) => ({ id, custody: 'kiosk', kiosk: 'kiosk' })) as never,
      },
    })
    app.dispatch({ type: 'clock/observed', chain_ms: 2000, received_ms: performance.now() })
    return { app, stop }
  }
  const first = load()
  let second: ReturnType<typeof load> | undefined
  try {
    first.app.dispatch({ type: 'server/packet', packet: { type: 'packet/tournaments', tournaments: [own] } })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(calls).toEqual(['open:a'])
    expect(Object.values(first.app.store.getState().tournament.entry_failures).map((entry) => entry.character)).toEqual(
      []
    )
    first.stop()
    second = load()
    second.app.dispatch({ type: 'server/packet', packet: { type: 'packet/tournaments', tournaments: [own] } })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(calls).toEqual(['open:a'])
    const linked = { ...own, version: '6', matches: [{ ...own.matches[0], fight: 'confirmed-fight', joined: ['c'] }] }
    second.app.dispatch({ type: 'server/packet', packet: { type: 'packet/tournaments', tournaments: [linked] } })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(calls).toEqual(['open:a', 'join:a', 'join:b'])
    second.app.dispatch({
      type: 'server/packet',
      packet: { type: 'packet/tournaments', tournaments: [{ ...linked, version: '7' }] },
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(calls).toHaveLength(3)
  } finally {
    first.stop()
    second?.stop()
    if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor)
    else Reflect.deleteProperty(globalThis, 'localStorage')
  }
})

test('manual coin recovery submits only positive unclaimed assets and ignores empty claims', async () => {
  const calls: unknown[] = []
  const app = create_app()
  const stop = app.observe(['tournament'])
  const row = tournament_fixture()
  const completed = { ...row, status: 'finished' as const, kares_pool: 'pool', token_total: '20' }
  try {
    app.dispatch({ type: 'auth/connecting' })
    app.dispatch({
      type: 'auth/connected',
      session: {
        address: 'owner',
        tournament: {
          claim_coins: async (...args: unknown[]) => {
            calls.push(args)
            return { digest: 'paid' }
          },
        },
      } as never,
    })
    for (const [sui_claimed, token_claimed] of [
      [true, false],
      [false, true],
      [true, true],
    ]) {
      const t = {
        ...completed,
        teams: [
          { ...row.teams[0], place: 1, seats: [{ ...row.teams[0].seats[0], sui_claimed, token_claimed }] },
          row.teams[1],
        ],
      }
      app.dispatch({ type: 'server/packet', packet: { type: 'packet/tournaments', tournaments: [t] } })
      app.dispatch({ type: 'tournament/action', id: 'cup', action: { kind: 'coins', team: 0, seat: 0 } })
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
    expect(calls).toEqual([
      ['cup', 0, 0, { sui: false, pool: 'pool' }],
      ['cup', 0, 0, { sui: true, pool: null }],
    ])
  } finally {
    stop()
  }
})

test('only the unsigned tournament link collision is treated as an opening race', () => {
  const collision = 'MoveAbort in 2nd command, abort code: 3204, in 0xc133::tournament::link_fight (instruction 10)'
  expect(
    tournament_opened_elsewhere(new Error(`[sdk] transaction resolution failed — NOT submitted: ${collision}`))
  ).toBe(true)
  expect(tournament_opened_elsewhere(new Error(`[sdk] transaction digest failed on-chain: ${collision}`))).toBe(false)
  expect(
    tournament_opened_elsewhere(
      new Error(`[sdk] transaction resolution failed — NOT submitted: ${collision.replace('link_fight', 'ready')}`)
    )
  ).toBe(false)
  expect(tournament_opened_elsewhere(new Error('Connection failed'))).toBe(false)
})

test('the opening seat is chosen from characters currently available in their kiosks', () => {
  const row = tournament_fixture()
  const state = state_for({
    ...row,
    teams: [{ ...row.teams[0], seats: row.teams[0].seats.map((seat) => ({ ...seat, owner: 'owner' })) }, row.teams[1]],
  })
  expect(
    automatic_actions(
      {
        ...state,
        session: {
          ...state.session,
          characters: [
            { id: 'a', custody: 'fight' },
            { id: 'b', custody: 'kiosk' },
          ] as never,
        },
      },
      2000
    )
  ).toEqual([{ id: 'cup', action: { kind: 'enter', index: 0, character: 'b' } }])
})

test('reaching the scheduled start never automatically submits a start transaction', () => {
  const row = { ...tournament_fixture(), status: 'open' as const }
  expect(automatic_actions(state_for(row), row.start_before_ms)).toEqual([])
  expect(automatic_actions(state_for(row), row.start_before_ms + 600_000)).toEqual([])
})
