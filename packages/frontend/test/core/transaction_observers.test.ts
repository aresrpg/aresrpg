// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { afterEach, expect, test } from 'bun:test'
import type { ListingRow } from '@aresrpg/protocol'

import { publish_pose } from '../../src/game/core/pose_feed.ts'
import { create_app } from '../../src/store.ts'

const settings = Object.freeze({
  quality: 'medium',
  flat_mode: false,
  music_enabled: true,
  render_distance: null,
} as const)
const tick = () => new Promise((resolve) => setTimeout(resolve, 0))
const character = { id: '0xc', name: 'C', custody: 'kiosk', kiosk: '0xk', kiosk_cap: '0xcap' }

afterEach(() => publish_pose(null))

test('rapid marketplace intents execute one wallet transaction', async () => {
  let calls = 0
  let release!: () => void
  const pending = new Promise<void>((resolve) => {
    release = resolve
  })
  const listing: ListingRow = {
    version: '1',
    kind: 'item',
    id: '0xi',
    name: 'Wool',
    item_type: 'wool',
    category: 'resource',
    level: 1,
    amount: 1,
    price_mist: '1',
    kiosk: '0xother',
    seller: '0xother',
    at_ms: 1,
  }
  const wallet = {
    address: '0xme',
    marketplace: {
      buy: async () => {
        calls += 1
        await pending
        return { digest: 'bought', version: '2' }
      },
    },
  }
  const app = create_app()
  app.initialize(settings)
  const stop = app.observe(['marketplace'])
  app.dispatch({ type: 'auth/connecting' })
  app.dispatch({ type: 'auth/connected', session: wallet as never })
  app.dispatch({ type: 'market/buy_requested', listing })
  app.dispatch({ type: 'market/buy_requested', listing })
  await tick()
  expect(calls).toBe(1)
  release()
  await tick()
  stop()
})

test('rapid duel challenges create one fight transaction', async () => {
  let calls = 0
  let release!: () => void
  const pending = new Promise<void>((resolve) => {
    release = resolve
  })
  const wallet = {
    address: '0xme',
    fight: {
      challenge_duel: async () => {
        calls += 1
        await pending
        return { digest: 'duel', fight: '0xf' }
      },
    },
  }
  const app = create_app()
  app.initialize(settings)
  const stop = app.observe(['duel'])
  app.dispatch({ type: 'auth/connecting' })
  app.dispatch({ type: 'auth/connected', session: wallet as never })
  app.dispatch({ type: 'server/packet', packet: { type: 'packet/characters', characters: [character] as never } })
  publish_pose({ character_id: character.id, x: 1, y: 2, z: 3, yaw: 0, riding: false, time_of_day: 0.5 })
  app.dispatch({ type: 'duel/challenged', character_id: '0xtarget', name: 'Target' })
  app.dispatch({ type: 'duel/challenged', character_id: '0xtarget', name: 'Target' })
  await tick()
  expect(calls).toBe(1)
  release()
  await tick()
  stop()
})

for (const rejected of [false, true]) {
  test(`market collection stays with its wallet when an old ${rejected ? 'failure' : 'success'} arrives`, async () => {
    const app = create_app()
    app.initialize(settings)
    const stop = app.observe(['marketplace'])
    let finish_old!: () => void
    let finish_new!: () => void
    let new_calls = 0
    const login = (wallet: unknown) => {
      app.dispatch({ type: 'auth/connecting' })
      app.dispatch({ type: 'auth/connected', session: wallet as never })
    }
    const history = (kiosk: string) =>
      app.dispatch({
        type: 'server/packet',
        packet: {
          type: 'packet/market_history',
          sales: [],
          total: 0,
          revenue_30d_mist: '0',
          profits: [{ kiosk, amount_mist: '100' }],
        },
      })
    try {
      login({
        address: '0xold',
        marketplace: {
          collect: () =>
            new Promise<void>((resolve, reject) => {
              finish_old = () => (rejected ? reject(new Error('old collection refused')) : resolve())
            }),
        },
      })
      history('old-kiosk')
      app.dispatch({ type: 'market/collect_requested' })
      app.dispatch({ type: 'auth/disconnected' })
      login({
        address: '0xnew',
        marketplace: {
          collect: () => {
            new_calls++
            return new Promise<void>((resolve) => {
              finish_new = resolve
            })
          },
        },
      })
      history('new-kiosk')
      app.dispatch({ type: 'market/collect_requested' })
      expect(new_calls).toBe(1)
      finish_old()
      await tick()
      expect(app.store.getState().marketplace.profits).toEqual([{ kiosk: 'new-kiosk', amount_mist: '100' }])
      expect(app.store.getState().marketplace.pending).toBe('collect')
      finish_new()
      await tick()
      expect(app.store.getState().marketplace.profits).toEqual([])
      expect(app.store.getState().marketplace.pending).toBeNull()
    } finally {
      stop()
    }
  })
}
