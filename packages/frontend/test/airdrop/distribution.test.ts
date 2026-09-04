// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { afterEach, expect, test } from 'bun:test'

import { rolled_item_types } from '../../src/modules/claims.ts'
import { gift_link_from_url } from '../../src/modules/distribution.ts'
import { content_catalog } from '../../src/content/catalog.ts'
import { create_app } from '../../src/store.ts'

const location_descriptor = Object.getOwnPropertyDescriptor(globalThis, 'location')
const history_descriptor = Object.getOwnPropertyDescriptor(globalThis, 'history')
const storage_descriptor = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage')

const restore = (key: 'location' | 'history' | 'sessionStorage', descriptor: PropertyDescriptor | undefined): void => {
  if (descriptor) Object.defineProperty(globalThis, key, descriptor)
  else Reflect.deleteProperty(globalThis, key)
}

afterEach(() => {
  restore('location', location_descriptor)
  restore('history', history_descriptor)
  restore('sessionStorage', storage_descriptor)
})

test('only a /gift bearer fragment becomes a printable gift claim', () => {
  expect(gift_link_from_url('https://aresrpg.world/gift?network=testnet#$secret')).toBe(
    'https://aresrpg.world/gift?network=testnet#$secret'
  )
  expect(gift_link_from_url('https://aresrpg.world/gift?network=testnet#public')).toBeNull()
  expect(gift_link_from_url('https://aresrpg.world/airdrop?network=testnet#$secret')).toBeNull()
})

test('the bearer secret survives login, claims to B, then a failed B redemption remains retryable', async () => {
  const href = 'https://aresrpg.world/gift?network=testnet#$secret'
  const values = new Map<string, string>()
  const replaced: string[] = []
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
  } as Storage
  Object.defineProperty(globalThis, 'location', {
    configurable: true,
    value: { href, pathname: '/gift', search: '?network=testnet' },
  })
  Object.defineProperty(globalThis, 'history', {
    configurable: true,
    value: { replaceState: (_state: unknown, _unused: string, url: string) => void replaced.push(url) },
  })
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: storage })

  const template = [...rolled_item_types()].find(([, item_type]) => item_type === 'sui_crate')?.[0]
  if (!template) throw new Error('the Sui Crate template is not published')
  const card = Object.freeze({ id: '0xgift', template, amount: 1 })
  const claimed: string[] = []
  const redeemed: string[] = []
  const game_wallet = {
    address: '0xgame',
    identity: 'zklogin',
    claim_giftcard_link: async (url: string) => {
      claimed.push(url)
      return { digest: 'claim', giftcard: card }
    },
    redeem_giftcard: async ({ card: voucher }: { card: { id: string } }) => {
      redeemed.push(voucher.id)
      throw new Error('no valid gas coin')
    },
  }
  const app = create_app()
  const stop = app.observe(['distribution'])
  app.dispatch({ type: 'auth/connecting' })
  app.dispatch({ type: 'auth/connected', session: game_wallet as never })
  await new Promise((resolve) => setTimeout(resolve, 0))
  await new Promise((resolve) => setTimeout(resolve, 0))

  expect(replaced).toEqual(['/gift?network=testnet'])
  expect(app.store.getState().navigation).toMatchObject({ page: 'airdrop', pathname: '/gift' })
  expect(claimed).toEqual([href])
  expect(redeemed).toEqual(['0xgift'])
  expect(values.size).toBe(0)
  expect(app.store.getState().session.giftcards).toEqual([card])
  expect(app.store.getState().distribution).toMatchObject({ gift_link_ready: false, pending: null })
  stop()
})

test('a printed gift refuses an ordinary wallet as recipient B', () => {
  const href = 'https://aresrpg.world/gift?network=testnet#$secret'
  const values = new Map<string, string>()
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
  } as Storage
  Object.defineProperty(globalThis, 'location', {
    configurable: true,
    value: { href, pathname: '/gift', search: '?network=testnet' },
  })
  Object.defineProperty(globalThis, 'history', {
    configurable: true,
    value: { replaceState: () => undefined },
  })
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: storage })

  const app = create_app()
  const stop = app.observe(['distribution'])
  app.dispatch({ type: 'auth/connecting' })
  app.dispatch({
    type: 'auth/connected',
    session: { address: '0xexternal', identity: 'wallet' } as never,
  })

  expect(app.store.getState().session.wallet).toBeNull()
  expect(app.store.getState().navigation).toMatchObject({ page: 'airdrop', pathname: '/gift' })
  expect(app.store.getState().distribution).toMatchObject({
    gift_link_ready: true,
    error: 'Continue with Google to receive this gift.',
  })
  expect(values.size).toBe(1)
  stop()
})

test('a whitelist holder cannot route its voucher into an ordinary wallet B', () => {
  let claims = 0
  const [drop] = content_catalog.airdrop.drops
  if (!drop) throw new Error('an authored airdrop is required')
  const app = create_app()
  const stop = app.observe(['distribution'])
  app.dispatch({ type: 'auth/connecting' })
  app.dispatch({
    type: 'auth/connected',
    session: { address: '0xordinary', identity: 'wallet' } as never,
  })
  app.dispatch({
    type: 'distribution/holder_connected',
    session: {
      address: '0xholder',
      claim_airdrop: async () => {
        claims += 1
        throw new Error('must not run')
      },
      disconnect: async () => undefined,
    } as never,
  })
  app.dispatch({ type: 'distribution/claim', drop_id: drop.id })

  expect(claims).toBe(0)
  expect(app.store.getState().distribution.error).toBe('Continue with Google to receive this airdrop.')
  stop()
})
