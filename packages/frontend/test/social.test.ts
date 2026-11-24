// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Players together through the game's real store. A trade: one invitation at a time, an offer that waits for its
// projected revision, one acceptance and exactly one settlement, nothing a late packet can bring back. A party or a
// trade operation ends as soon as the server shows its result or the row is gone, so no lock outlives its subject.
import { afterEach, expect, test } from 'bun:test'
import type { TradeRow } from '@aresrpg/protocol'

import { GAME_MODULES } from '../src/game/game_modules.ts'
import { duel_accept_was_canceled, duels_awaiting } from '../src/modules/duel.ts'
import { reconcile_trade_row } from '../src/modules/trade.ts'

import { character_row, fake_wallet, settle, sign_in, start_surface, type Started } from './harness.ts'

const running: Started[] = []
afterEach(() => running.splice(0).forEach(({ stop }) => stop()))
const ME = `0x${'a'.repeat(64)}`
const trades = (rows: readonly TradeRow[]) => ({ type: 'packet/trades', trades: rows })
const trade_row = (overrides: Partial<TradeRow> = {}): TradeRow => ({
  id: '0xt',
  a: ME,
  b: '0xher',
  phase: 'negotiating',
  offer_revision: 2,
  accept_a: false,
  accept_b: false,
  sui_a: '0',
  sui_b: '0',
  kares_a: '0',
  kares_b: '0',
  caps_a: [],
  caps_b: [],
  ...overrides,
})

test('a trade invites once, commits an offer once, accepts once and settles exactly once', async () => {
  const calls: string[] = []
  const gates = { accept: Promise.withResolvers<void>(), settle: Promise.withResolvers<void>() }
  const wallet = fake_wallet({
    create_trade: async () => {
      calls.push('create')
      return { digest: 'created', trade: trade_row({ id: '0xrequest', phase: 'requested' }) }
    },
    trade: () => ({
      commit_offer: async () => {
        calls.push('offer')
        return { digest: 'offer', offer_revision: 3 }
      },
      accept: async () => {
        calls.push('accept')
        await gates.accept.promise
        return { digest: 'accept' }
      },
      settle_all: async () => {
        calls.push('settle')
        await gates.settle.promise
        return {
          digest: 'settle',
          delta: {
            trade: '0xt',
            phase: 'settling',
            offer_revision: 4,
            remove_caps: [],
            clear_balances: 'b',
            closed: false,
          },
        }
      },
    }),
  })
  const game = await start_surface(GAME_MODULES, { seat: true, account: { wallet, remembered: 'Sign in with Google' } })
  running.push(game)
  await sign_in(game)
  // No invitation leaves before the account's trades are known; then one at a time.
  game.dispatch({ type: 'trade/create', counterparty: '0xher' })
  await settle()
  expect(calls).toEqual([])
  game.receive(trades([]))
  game.dispatch({ type: 'trade/create', counterparty: '0xher' })
  await settle()
  game.dispatch({ type: 'trade/create', counterparty: '0xother' })
  await settle()
  expect(calls).toEqual(['create'])

  // An offer stays pending until the server projects the revision it wrote.
  const row = trade_row()
  game.receive(trades([row]))
  game.dispatch({ type: 'trade/commit_offer', trade: row.id, additions: [], removals: [], sui: 1n, kares: 0n })
  await settle()
  expect(calls).toEqual(['create', 'offer'])
  expect(game.state().trade.pending).toBe(`offer:${row.id}:3`)
  const offered = { ...row, offer_revision: 3, sui_a: '1', sui_b: '2', accept_b: true }
  game.receive(trades([offered]))
  expect(game.state().trade.pending).toBeNull()

  // Two acceptance gestures sign once; the settling rows the server replays start no settlement before it answers.
  game.dispatch({ type: 'trade/open', trade: row.id })
  game.dispatch({ type: 'trade/accept', trade: row.id })
  game.dispatch({ type: 'trade/accept', trade: row.id })
  await settle()
  expect(calls.filter((call) => call === 'accept')).toHaveLength(1)
  const settling = { ...offered, phase: 'settling' as const, offer_revision: 4, accept_a: true }
  game.receive(trades([settling]), trades([settling]))
  expect(calls).not.toContain('settle')
  gates.accept.resolve()
  await settle(5)
  expect(calls.filter((call) => call === 'settle')).toHaveLength(1)
  game.dispatch({ type: 'trade/settle', trade: row.id })
  gates.settle.resolve()
  await settle(5)
  expect(game.state().trade.active).toBeNull()
  game.receive(trades([settling]))
  await settle(5)
  expect(calls.filter((call) => call === 'settle')).toHaveLength(1)
  // A late packet cannot bring back a currency the settlement already paid out.
  const claimed = { ...settling, sui_a: '0', kares_a: '0' }
  const folded = reconcile_trade_row(claimed, { ...settling, sui_a: '5', kares_a: '7' })
  expect([folded.sui_a, folded.kares_a]).toEqual(['0', '0'])
})

test('a party or trade operation ends when its row shows the result or disappears, so nothing stays locked', async () => {
  const game = await start_surface(GAME_MODULES, {
    seat: true,
    account: { wallet: fake_wallet(), remembered: 'Sign in with Google' },
  })
  running.push(game)
  await sign_in(game)
  // The invitee accepted before the inviter's packet: the invite ends on membership too.
  game.dispatch({ type: 'party/pending', character_id: '0xa', operation: 'invite:0xb' })
  game.receive({
    type: 'packet/party',
    character_id: '0xa',
    party: {
      id: '0xp',
      members: [
        { character_id: '0xa', name: 'A' },
        { character_id: '0xb', name: 'B' },
      ],
      invited: [],
    },
  })
  expect(game.state().party.pending_by_character['0xa']).toBeUndefined()
  // A kick ends when the party itself is gone.
  game.dispatch({ type: 'party/pending', character_id: '0xa', operation: 'kick:0xb' })
  game.receive({ type: 'packet/party', character_id: '0xa', party: null })
  expect(game.state().party.pending_by_character['0xa']).toBeUndefined()
  // A destroyed trade, or one missing from the next full list, ends the account's pending trade operation.
  game.dispatch({ type: 'trade/pending', operation: 'accept:0xt' })
  game.receive({ type: 'packet/trade_destroyed', trade: '0xt' })
  expect(game.state().trade.pending).toBeNull()
  game.dispatch({ type: 'trade/pending', operation: 'offer:0xu:3' })
  game.receive(trades([]))
  expect(game.state().trade.pending).toBeNull()
})

test('a duel invitation is a waiting fight that reserves the hero being played, and nothing else', async () => {
  const game = await start_surface(GAME_MODULES, {
    seat: true,
    account: { wallet: fake_wallet(), remembered: 'Sign in with Google' },
  })
  running.push(game)
  // Playing no hero, no fight can name us.
  await sign_in(game)
  const created = (id: string, opener_b: string | null, phase = 'placement') => ({
    type: 'packet/fight_created',
    fight: {
      id,
      world: 'w',
      x: 50_000,
      z: 50_000,
      phase,
      access_a: 1,
      access_b: opener_b ? 2 : 255,
      opener_a: '0xhim',
      opener_b,
      managed: false,
      wagered: false,
      placement_ms: '0',
    },
  })
  game.receive(created('0xf0', '0xme'))
  expect(duels_awaiting(game.state())).toEqual([])
  game.receive({ type: 'packet/characters', characters: [character_row('0xme', { world: 'w' })] })
  game.dispatch({ type: 'character/select', character_id: '0xme' })
  game.receive({ type: 'packet/tracked_zones', character_id: '0xme', world: 'w', zones: [{ zx: 97, zz: 97 }] })
  // Our reserved seat is an invitation; another hero's duel beside us, an open fight or a started one is scenery.
  game.receive(
    created('0xf1', '0xme'),
    created('0xf2', '0xsomeone'),
    created('0xf3', null),
    created('0xf4', '0xme', 'active')
  )
  expect(duels_awaiting(game.state()).map(({ id }) => id)).toEqual(['0xf1'])
  // An ended fight leaves no invitation behind.
  game.receive({ type: 'packet/fight_phase', fight: '0xf1', phase: 'ended' })
  expect(duels_awaiting(game.state())).toEqual([])
  // Only the join placement abort means the challenger cancelled before we accepted.
  expect(
    duel_accept_was_canceled(
      new Error("MoveAbort in 2nd command, abort code: 1706, in '0xgame::fight::jg' (instruction 7)")
    )
  ).toBe(true)
  expect(duel_accept_was_canceled(new Error("abort code: 1706, in '0xgame::fight::aa'"))).toBe(false)
  expect(duel_accept_was_canceled(new Error("abort code: 1724, in '0xgame::fight::jg'"))).toBe(false)
})
