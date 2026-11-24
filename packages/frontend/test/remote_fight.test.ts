// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// A fight played against the chain through the game's real store and socket: a turn is committed once with the
// actions drafted on the board, a refused commit restores the confirmed board, and a Kolizeum wager joins and
// starts through its escrow with the hero the player chose, never through the generic fight hand.
import { afterEach, expect, test } from 'bun:test'
import type { HydratedFightCheckpoint } from '@aresrpg/fight'

import { GAME_MODULES } from '../src/game/game_modules.ts'
import { terminal_remote_draft_needs_commit } from '../src/modules/fight_lifecycle.ts'

import { fight_state } from './fixtures/fight_state.ts'
import { character_row, fake_wallet, settle, sign_in, start_surface, type Started } from './harness.ts'

const running: Started[] = []
afterEach(() => running.splice(0).forEach(({ stop }) => stop()))
const REMEMBERED = 'Sign in with Google'
const start_game = async (hands: Readonly<Record<string, unknown>>, custody: 'fight' | 'kiosk') => {
  const wallet = fake_wallet(hands)
  const game = await start_surface(GAME_MODULES, { seat: true, account: { wallet, remembered: REMEMBERED } })
  running.push(game)
  await sign_in(game, {
    characters: [
      character_row('0xa', { custody, kiosk: '0xka', kiosk_cap: '0xcap-a' }),
      character_row('0xb', { kiosk: '0xkb', kiosk_cap: '0xcap-b' }),
    ],
  })
  game.dispatch({ type: 'character/select', character_id: '0xa' })
  return { game, wallet }
}

test('a turn commits once with its drafted moves, a second End Turn waits, and a refused commit restores the board', async () => {
  const commits: unknown[] = []
  const refusal = Promise.withResolvers<never>()
  const { game, wallet } = await start_game(
    {
      fight: {
        commit_turn: (turn: unknown) => {
          commits.push(turn)
          return refusal.promise
        },
      },
    },
    'fight'
  )
  game.receive(fight_state(wallet.address))
  const move = (cell: bigint) =>
    game.dispatch({
      type: 'fight/input',
      fight: '0xf1',
      origin: 'local',
      input: { type: 'move_to', fighter: 0n, path: [cell] },
    })
  // Moves are drafted on the board without a transaction.
  move(2n)
  expect(game.state().fight.transaction_pending).toBe(false)
  expect(game.state().fight.checkpoint?.contract.fighters[0]?.cell).toBe(2n)
  move(3n)
  expect(commits).toEqual([])
  game.dispatch({
    type: 'fight/input',
    fight: '0xf1',
    origin: 'local',
    input: { type: 'end_turn', fighter: 0n, observed_ms: 99_000n },
  })
  expect(game.state().fight.transaction_pending).toBe(true)
  expect(commits).toEqual([
    {
      fight: '0xf1',
      actions: [
        { type: 'move', path: [2n] },
        { type: 'move', path: [3n] },
      ],
    },
  ])
  // While the commit is pending, End Turn cannot queue a second submission.
  game.dispatch({ type: 'fight/end_turn_queued', fight: '0xf1', queued: true })
  expect(game.state().fight.end_turn_queued).toBe(false)
  refusal.reject(new Error('MoveAbort 1725'))
  await settle(5)
  expect(game.state().fight).toMatchObject({ transaction_pending: false, end_turn_submitted: false })
  expect(game.state().fight.checkpoint?.contract.fighters[0]?.cell).toBe(1n)
  expect(commits).toHaveLength(1)
})

test('a Kolizeum join belongs to the hero and side the player chose, and a wagered Ready goes through the escrow', async () => {
  const joins: unknown[] = []
  const readies: unknown[] = []
  const joined = Promise.withResolvers<{ digest: string; fight: string }>()
  const { game, wallet } = await start_game(
    {
      kolizeum: {
        join: (args: unknown) => (joins.push(args), joined.promise),
        ready: async (args: unknown) => (readies.push(args), { digest: 'ready', started: true, turn_witnesses: [] }),
      },
      fight: { ready: async () => Promise.reject(new Error('the generic hand must not start a wager')) },
    },
    'kiosk'
  )
  const fighters = [0, 1, 2].map((seat) => ({
    seat,
    team: 0 as const,
    character_id: `0xc${seat}`,
    name: 'Seat',
    classe: 'senshi',
    level: 10,
    settled: false,
  }))
  const lobby = {
    id: '0xk1',
    fight: '0xf1',
    creator: '0xowner',
    format: 3,
    pledge_mist: '1000000000',
    pot_mist: '2000000000',
    level_min: 1,
    level_max: 100,
    public: true,
    can_join: true,
    status: 'open',
    fighters,
  }
  game.receive({ type: 'packet/kolizeums', lobbies: [{ ...lobby, fighters: [] }] })
  // Another hero is on screen; the join still names the hero and side the player picked, with that hero's custody.
  game.dispatch({ type: 'character/select', character_id: '0xb' })
  game.dispatch({ type: 'kolizeum/join', kolizeum: '0xk1', side: 1, character_id: '0xa' })
  expect(joins).toEqual([
    {
      kolizeum: '0xk1',
      fight: '0xf1',
      pledge_mist: 1_000_000_000n,
      side: 1,
      character_id: '0xa',
      custody: { kiosk: '0xka', kiosk_cap: '0xcap-a' },
    },
  ])
  expect(game.state().kolizeum.pending_by_character).toEqual({ '0xa': 'join:0xk1' })
  joined.resolve({ digest: 'joined', fight: '0xf1' })
  await settle()
  // The wagered fight starts through its Kolizeum manager.
  game.dispatch({ type: 'character/select', character_id: '0xa' })
  game.receive(fight_state(wallet.address, { placement: true, kolizeum: { id: '0xk1', pledge_mist: '1000000000' } }))
  game.dispatch({ type: 'fight/input', fight: '0xf1', origin: 'local', input: { type: 'ready', fighter: 0n } })
  await settle(5)
  expect(readies).toEqual([{ kolizeum: '0xk1', fight: '0xf1', fighter_idx: 0n }])
  expect(game.state().fight.kolizeum_by_fight).toEqual({ '0xf1': { id: '0xk1', pledge_mist: 1_000_000_000n } })
})

test('placement: a refused place restores the board without a retry, and Ready all signs only the unready seats it owns', async () => {
  const places: unknown[] = []
  const refusal = Promise.withResolvers<never>()
  const readies: unknown[] = []
  type Progress = Readonly<{ completed: number; total: number; fighter_idx: bigint; started: boolean }>
  const { game, wallet } = await start_game(
    {
      fight: {
        place: (args: unknown) => (places.push(args), refusal.promise),
        ready_many: async (
          args: Readonly<{
            fight: string
            fighter_indices: readonly bigint[]
            on_progress: (progress: Progress) => void
          }>
        ) => {
          readies.push({ fight: args.fight, fighter_indices: args.fighter_indices })
          args.on_progress({ completed: 1, total: 1, fighter_idx: 0n, started: false })
          return { digest: 'ready-all', started: false, turn_witnesses: [] }
        },
      },
    },
    'fight'
  )
  game.receive(fight_state(wallet.address, { placement: true }))
  const cells = () => game.state().fight.checkpoint?.contract.fighters.map(({ cell }) => cell)
  const before = cells()
  game.dispatch({
    type: 'fight/input',
    fight: '0xf1',
    origin: 'local',
    input: { type: 'place', fighter: 0n, cell: 9n },
  })
  await settle()
  expect(places).toHaveLength(1)
  refusal.reject(new Error('placement refused'))
  await settle(5)
  expect(cells()).toEqual(before)
  expect(places).toHaveLength(1)
  // Ready all: the other player's seat is never signed for.
  game.dispatch({ type: 'fight/ready_all', fight: '0xf1', fighters: [0n, 1n] })
  await settle(5)
  expect(readies).toEqual([{ fight: '0xf1', fighter_indices: [0n] }])
  expect(game.state().fight.environments['0xf1']).toMatchObject({
    ready_submitted_seats: [0],
    ready_all_progress: { completed: 1, total: 1, status: 'complete' },
  })
  // A dead active fighter's draft is committed once, and only by a remote fight with nothing queued or pending.
  const dead = {
    mode: 'remote' as const,
    presentations: [],
    canonical_ended: false,
    end_turn_queued: false,
    end_turn_submitted: false,
    transaction_pending: false,
    checkpoint: {
      contract: { round: 1n, ended: false, queue: [0n, 1n], turn_ptr: 0n, fighters: [{ dead: true }, { dead: false }] },
    } as HydratedFightCheckpoint,
  }
  const blocked = [
    { end_turn_queued: true },
    { end_turn_submitted: true },
    { transaction_pending: true },
    { mode: 'local' as const },
  ]
  expect(terminal_remote_draft_needs_commit(dead)).toBe(true)
  expect(blocked.map((patch) => terminal_remote_draft_needs_commit({ ...dead, ...patch }))).toEqual(
    blocked.map(() => false)
  )
  const alive = {
    ...dead.checkpoint,
    contract: { ...dead.checkpoint.contract, turn_ptr: 1n },
  } as HydratedFightCheckpoint
  expect(terminal_remote_draft_needs_commit({ ...dead, checkpoint: alive })).toBe(false)
})
