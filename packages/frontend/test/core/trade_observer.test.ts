// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'
import type { TradeCapRow, TradeRow } from '@aresrpg/protocol'

import { trade_offer_additions_available } from '../../src/modules/trade.ts'
import { create_app } from '../../src/store.ts'

const settings = Object.freeze({
  quality: 'medium',
  flat_mode: false,
  music_enabled: true,
  render_distance: null,
} as const)

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))
const trade_packet = (trades: TradeRow[]) => ({
  type: 'packet/trades' as const,
  trades,
})

test('the app creates at most one outgoing invitation at a time', async () => {
  let calls = 0
  const request: TradeRow = {
    id: '0xrequest',
    a: '0xme',
    b: '0xher',
    phase: 'requested',
    offer_revision: 0,
    accept_a: false,
    accept_b: false,
    sui_a: '0',
    sui_b: '0',
    caps_a: [],
    caps_b: [],
  }
  const wallet = {
    address: '0xme',
    create_trade: async () => {
      calls += 1
      return { digest: 'created', trade: request }
    },
  }
  const app = create_app()
  app.initialize(settings)
  const stop = app.observe(['trade'])
  app.dispatch({ type: 'auth/connecting' })
  app.dispatch({ type: 'auth/connected', session: wallet as never })
  app.dispatch({ type: 'trade/create', counterparty: '0xher' })
  await tick()
  expect(calls).toBe(0)
  app.dispatch({ type: 'server/packet', packet: trade_packet([]) })
  app.dispatch({ type: 'trade/create', counterparty: '0xher' })
  await tick()
  app.dispatch({ type: 'trade/create', counterparty: '0xother' })
  await tick()
  expect(calls).toBe(1)
  stop()
})

test('one staged offer commit stays pending until its projected revision arrives', async () => {
  let calls = 0
  const row: TradeRow = {
    id: '0xt',
    a: '0xme',
    b: '0xher',
    phase: 'negotiating',
    offer_revision: 2,
    accept_a: false,
    accept_b: false,
    sui_a: '0',
    sui_b: '0',
    caps_a: [],
    caps_b: [],
  }
  const wallet = {
    address: '0xme',
    trade: () => ({
      commit_offer: async () => {
        calls += 1
        return { digest: 'offer', offer_revision: 3 }
      },
    }),
  }
  const app = create_app()
  app.initialize(settings)
  const stop = app.observe(['trade'])
  app.dispatch({ type: 'auth/connecting' })
  app.dispatch({ type: 'auth/connected', session: wallet as never })
  app.dispatch({ type: 'server/packet', packet: trade_packet([row]) })
  app.dispatch({ type: 'trade/commit_offer', trade: row.id, additions: [], removals: [], sui: 1n })
  await tick()
  expect(calls).toBe(1)
  expect(app.store.getState().trade.pending).toBe(`offer:${row.id}:3`)
  app.dispatch({ type: 'server/packet', packet: trade_packet([{ ...row, offer_revision: 3, sui_a: '1' }]) })
  expect(app.store.getState().trade.pending).toBeNull()
  stop()
})

test('a stale staged stack is refused before transaction construction', async () => {
  let calls = 0
  const row: TradeRow = {
    id: '0xt',
    a: '0xme',
    b: '0xher',
    phase: 'negotiating',
    offer_revision: 2,
    accept_a: false,
    accept_b: false,
    sui_a: '0',
    sui_b: '0',
    caps_a: [],
    caps_b: [],
  }
  const item = {
    id: '0xitem',
    kiosk: '0xkiosk',
    item_type: 'wool',
    category: 'resource',
    amount: 10,
    name: 'Wool',
    level: 1,
  }
  const wallet = {
    address: '0xme',
    trade: () => ({
      commit_offer: async () => {
        calls += 1
        return { digest: 'offer', offer_revision: 3 }
      },
    }),
  }
  const app = create_app()
  app.initialize(settings)
  const stop = app.observe(['trade'])
  app.dispatch({ type: 'auth/connecting' })
  app.dispatch({ type: 'auth/connected', session: wallet as never })
  app.dispatch({ type: 'server/packet', packet: trade_packet([row]) })
  app.dispatch({ type: 'server/packet', packet: { type: 'packet/inventory', items: [item] } as never })

  app.dispatch({
    type: 'trade/commit_offer',
    trade: row.id,
    additions: [{ item: { ...item, amount: 9 } as never, amount: 4 }],
    removals: [],
    sui: 0n,
  })
  await tick()

  expect(calls).toBe(0)
  expect(app.store.getState().trade.pending).toBeNull()
  stop()
})

test('a later removal keeps an earlier staged target amount valid without listing the whole stack', () => {
  const offered = (object: string): TradeCapRow => ({
    object,
    kiosk: '0xkiosk',
    item_type: 'wool',
    category: 'resource',
    amount: 10,
    name: 'Wool',
    level: 1,
  })
  const first = offered('0xfirst')
  const second = offered('0xsecond')
  const row: TradeRow = {
    id: '0xt',
    a: '0xme',
    b: '0xher',
    phase: 'negotiating',
    offer_revision: 2,
    accept_a: false,
    accept_b: false,
    sui_a: '0',
    sui_b: '0',
    caps_a: [first, second],
    caps_b: [],
  }
  const target = {
    id: '0xtarget',
    kiosk: '0xkiosk',
    item_type: 'wool',
    category: 'resource',
    amount: 5,
    name: 'Wool',
    level: 1,
  }
  const merge_target = { id: target.id, kiosk: target.kiosk, amount: target.amount }
  expect(
    trade_offer_additions_available(
      { session: { inventory: [target] }, marketplace: { own_listings: [] }, trade: { rows: [row] } } as never,
      [{ item: { ...target, amount: 15 }, amount: 15 }],
      [
        { cap: first, target: merge_target },
        { cap: second, target: merge_target },
      ]
    )
  ).toBeTrue()
})

test('acceptance arms exactly one settlement and replayed settling rows cannot launch another', async () => {
  let accept_calls = 0
  let settle_calls = 0
  let finish_accept!: () => void
  let finish_settlement!: () => void
  const acceptance = new Promise<void>((resolve) => {
    finish_accept = resolve
  })
  const settlement = new Promise<void>((resolve) => {
    finish_settlement = resolve
  })
  const wallet = {
    address: '0xme',
    trade: () => ({
      accept: async () => {
        accept_calls += 1
        await acceptance
        return { digest: 'accept' }
      },
      settle_all: async () => {
        settle_calls += 1
        await settlement
        return {
          digest: 'settle',
          delta: {
            trade: '0xt',
            phase: 'settling' as const,
            offer_revision: 3,
            remove_caps: [],
            clear_sui: 'b' as const,
            closed: false,
          },
        }
      },
    }),
  }
  const row = {
    id: '0xt',
    a: '0xme',
    b: '0xher',
    phase: 'negotiating' as const,
    offer_revision: 2,
    accept_a: false,
    accept_b: true,
    sui_a: '0',
    sui_b: '1',
    caps_a: [],
    caps_b: [],
  }
  const app = create_app()
  app.initialize(settings)
  const stop = app.observe(['trade'])
  app.dispatch({ type: 'auth/connecting' })
  app.dispatch({ type: 'auth/connected', session: wallet as never })
  app.dispatch({ type: 'server/packet', packet: trade_packet([row]) })
  app.dispatch({ type: 'trade/open', trade: row.id })
  app.dispatch({ type: 'trade/accept', trade: row.id })
  app.dispatch({ type: 'trade/accept', trade: row.id })
  await tick()
  expect(accept_calls).toBe(1)

  const settling = { ...row, phase: 'settling' as const, offer_revision: 3, accept_a: true }
  app.dispatch({ type: 'server/packet', packet: trade_packet([settling]) })
  app.dispatch({ type: 'server/packet', packet: trade_packet([settling]) })
  expect(settle_calls).toBe(0)

  finish_accept()
  await tick()
  expect(settle_calls).toBe(1)
  app.dispatch({ type: 'trade/settle', trade: row.id })
  expect(settle_calls).toBe(1)

  finish_settlement()
  await tick()
  expect(app.store.getState().trade.active).toBeNull()
  app.dispatch({ type: 'server/packet', packet: trade_packet([settling]) })
  await tick()
  expect(settle_calls).toBe(1)
  stop()
})

test('disconnect clears the old session latch without letting its promise write into the new session', async () => {
  let calls = 0
  const never = new Promise<never>(() => undefined)
  const wallet = (blocked: boolean) => ({
    address: '0xme',
    trade: () => ({
      accept: async () => {
        calls += 1
        if (blocked) return never
        return { digest: 'accepted' }
      },
    }),
  })
  const row = {
    id: '0xt',
    a: '0xme',
    b: '0xher',
    phase: 'negotiating' as const,
    offer_revision: 2,
    accept_a: false,
    accept_b: false,
    sui_a: '0',
    sui_b: '0',
    caps_a: [],
    caps_b: [],
  }
  const app = create_app()
  app.initialize(settings)
  const stop = app.observe(['trade'])
  app.dispatch({ type: 'auth/connecting' })
  app.dispatch({ type: 'auth/connected', session: wallet(true) as never })
  app.dispatch({ type: 'server/packet', packet: trade_packet([row]) })
  app.dispatch({ type: 'trade/accept', trade: row.id })
  await tick()
  app.dispatch({ type: 'auth/disconnected' })
  app.dispatch({ type: 'auth/connecting' })
  app.dispatch({ type: 'auth/connected', session: wallet(false) as never })
  app.dispatch({ type: 'server/packet', packet: trade_packet([row]) })
  app.dispatch({ type: 'trade/accept', trade: row.id })
  await tick()
  expect(calls).toBe(2)
  stop()
})

test('an old promise cannot delete the matching operation token of a new session', async () => {
  let calls = 0
  let finish_old!: () => void
  let finish_new!: () => void
  const old_accept = new Promise<void>((resolve) => {
    finish_old = resolve
  })
  const new_accept = new Promise<void>((resolve) => {
    finish_new = resolve
  })
  const wallet = (acceptance: Promise<void>) => ({
    address: '0xme',
    trade: () => ({
      accept: async () => {
        calls += 1
        await acceptance
        return { digest: 'accepted' }
      },
    }),
  })
  const row = {
    id: '0xt',
    a: '0xme',
    b: '0xher',
    phase: 'negotiating' as const,
    offer_revision: 2,
    accept_a: false,
    accept_b: false,
    sui_a: '0',
    sui_b: '0',
    caps_a: [],
    caps_b: [],
  }
  const app = create_app()
  app.initialize(settings)
  const stop = app.observe(['trade'])
  const old_wallet = wallet(old_accept)
  app.dispatch({ type: 'auth/connecting' })
  app.dispatch({ type: 'auth/connected', session: old_wallet as never })
  app.dispatch({ type: 'server/packet', packet: trade_packet([row]) })
  app.dispatch({ type: 'trade/accept', trade: row.id })
  await tick()

  app.dispatch({ type: 'auth/disconnected' })
  app.dispatch({ type: 'auth/connecting' })
  app.dispatch({ type: 'auth/connected', session: wallet(new_accept) as never })
  app.dispatch({ type: 'server/packet', packet: trade_packet([row]) })
  app.dispatch({ type: 'trade/accept', trade: row.id })
  await tick()
  app.dispatch({ type: 'server/packet', packet: trade_packet([{ ...row, accept_a: true }]) })
  finish_old()
  await tick()
  app.dispatch({ type: 'trade/accept', trade: row.id })
  await tick()
  expect(calls).toBe(2)

  finish_new()
  await tick()
  stop()
})
