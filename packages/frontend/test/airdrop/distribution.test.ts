// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { afterEach, beforeEach, expect, test } from 'bun:test'

import { rolled_item_types } from '../../src/modules/claims.ts'
import { gift_link_from_url } from '../../src/modules/distribution.ts'
import { create_app } from '../../src/store.ts'

const location_descriptor = Object.getOwnPropertyDescriptor(globalThis, 'location')
const history_descriptor = Object.getOwnPropertyDescriptor(globalThis, 'history')
const local_storage_descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')

beforeEach(() => {
  const values = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => void values.set(key, value),
      removeItem: (key: string) => void values.delete(key),
    },
  })
})

const storage_descriptor = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage')

const restore = (
  key: 'location' | 'history' | 'sessionStorage' | 'localStorage',
  descriptor: PropertyDescriptor | undefined
): void => {
  if (descriptor) Object.defineProperty(globalThis, key, descriptor)
  else Reflect.deleteProperty(globalThis, key)
}

afterEach(() => {
  restore('location', location_descriptor)
  restore('history', history_descriptor)
  restore('sessionStorage', storage_descriptor)
  restore('localStorage', local_storage_descriptor)
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
  app.dispatch({ type: 'server/packet', packet: { type: 'packet/characters', characters: [] } })
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
    error: 'gift_login',
  })
  expect(values.size).toBe(1)
  stop()
})

const flush = async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

test('plain wallet transfer automatically redeems once and stale snapshots cannot resurrect the voucher', async () => {
  const [template] = [...rolled_item_types()].find(([, item_type]) => item_type === 'sui_crate')!
  const card = { id: '0xgift', template, amount: 1 }
  const transfers: unknown[] = []
  const redemptions: string[] = []
  const holder = {
    address: '0xexternal',
    read_giftcards: async () => [card],
    transfer_giftcards: async (rows: unknown) => {
      transfers.push(rows)
      return { digest: 'sent', giftcards: [card] }
    },
    disconnect: async () => undefined,
  }
  const wallet = {
    address: '0xgame',
    identity: 'zklogin',
    redeem_giftcard: async () => {
      redemptions.push(card.id)
      return { digest: 'redeemed', item_id: '0xitem', item_version: '10' }
    },
  }
  const app = create_app()
  const stop = app.observe(['distribution'])
  app.dispatch({ type: 'auth/connecting' })
  app.dispatch({ type: 'auth/connected', session: wallet as never })
  app.dispatch({ type: 'server/packet', packet: { type: 'packet/characters', characters: [] } })
  app.dispatch({ type: 'path/open', pathname: '/claim' })
  app.dispatch({ type: 'external_wallet/connected', sequence: 0, session: holder as never })
  await flush()
  app.dispatch({ type: 'distribution/import', giftcard: card })
  await flush()
  expect(transfers).toEqual([[{ id: card.id, recipient: '0xgame' }]])
  expect(redemptions).toEqual([card.id])
  app.dispatch({ type: 'server/packet', packet: { type: 'packet/giftcards', giftcards: [card] } })
  await flush()
  expect(app.store.getState().session.giftcards).toEqual([])
  expect(redemptions).toEqual([card.id])
  stop()
})

test('a failed redemption remains held and does not automatically retry on repeated snapshots', async () => {
  const [template] = [...rolled_item_types()].find(([, item_type]) => item_type === 'sui_crate')!
  const card = { id: '0xgift', template, amount: 1 }
  let attempts = 0
  const wallet = {
    address: '0xgame',
    identity: 'zklogin',
    redeem_giftcard: async () => {
      attempts++
      throw new Error('transaction outcome uncertain')
    },
  }
  const app = create_app()
  const stop = app.observe(['distribution'])
  app.dispatch({ type: 'auth/connecting' })
  app.dispatch({ type: 'auth/connected', session: wallet as never })
  app.dispatch({ type: 'server/packet', packet: { type: 'packet/characters', characters: [] } })
  app.dispatch({ type: 'path/open', pathname: '/claim' })
  for (let i = 0; i < 3; i++) {
    app.dispatch({ type: 'server/packet', packet: { type: 'packet/giftcards', giftcards: [card] } })
    await flush()
  }
  expect(attempts).toBe(1)
  expect(app.store.getState().session.giftcards).toEqual([card])
  stop()
})

test('received vouchers redeem without waiting for inventory projection', async () => {
  const [template] = [...rolled_item_types()].find(([, item_type]) => item_type === 'sui_crate')!
  const calls: string[] = []
  const app = create_app()
  const stop = app.observe(['distribution'])
  app.dispatch({ type: 'auth/connecting' })
  app.dispatch({
    type: 'auth/connected',
    session: {
      address: '0xgame',
      identity: 'zklogin',
      redeem_giftcard: async ({ card }: { card: { id: string } }) => {
        calls.push(card.id)
        return { digest: card.id }
      },
    } as never,
  })
  app.dispatch({ type: 'path/open', pathname: '/claim' })
  app.dispatch({ type: 'server/packet', packet: { type: 'packet/characters', characters: [] } })
  app.dispatch({
    type: 'server/packet',
    packet: {
      type: 'packet/giftcards',
      giftcards: [
        { id: '0xa', template, amount: 1 },
        { id: '0xb', template, amount: 1 },
      ],
    },
  })
  await flush()
  expect(calls).toEqual(['0xa', '0xb'])
  expect(app.store.getState().session.giftcards).toEqual([])
  stop()
})

test('plain /claim intent survives a reload without pretending to be a bearer link', () => {
  const values = new Map<string, string>()
  Object.defineProperty(globalThis, 'sessionStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => void values.set(key, value),
      removeItem: (key: string) => void values.delete(key),
    },
  })
  Object.defineProperty(globalThis, 'location', {
    configurable: true,
    value: {
      href: 'https://aresrpg.world/claim',
      pathname: '/claim',
      search: '',
    },
  })
  const first = create_app()
  const stop_first = first.observe(['distribution'])
  expect(first.store.getState().distribution.gift_link_ready).toBeFalse()
  stop_first()
  Object.defineProperty(globalThis, 'location', {
    configurable: true,
    value: {
      href: 'https://aresrpg.world/',
      pathname: '/',
      search: '',
    },
  })
  const callback = create_app()
  const stop_callback = callback.observe(['distribution'])
  expect(callback.store.getState().navigation.pathname).toBe('/claim')
  expect(callback.store.getState().distribution.gift_link_ready).toBeFalse()
  stop_callback()
})

test('a late holder transfer failure cannot replace the next recipient session state', async () => {
  const card = { id: '0xoldgift', template: '0xtemplate', amount: 1 }
  let reject_transfer: (error: Error) => void = () => undefined
  const holder = {
    address: '0xholder',
    read_giftcards: async () => [card],
    transfer_giftcards: () =>
      new Promise((_resolve, reject) => {
        reject_transfer = reject
      }),
  }
  const app = create_app()
  const stop = app.observe(['distribution'])
  const login = (address: string) => {
    app.dispatch({ type: 'auth/connecting' })
    app.dispatch({ type: 'auth/connected', session: { address, identity: 'zklogin' } as never })
    app.dispatch({ type: 'server/packet', packet: { type: 'packet/characters', characters: [] } })
  }
  login('0xfirst')
  app.dispatch({ type: 'path/open', pathname: '/claim' })
  app.dispatch({ type: 'external_wallet/connected', sequence: 0, session: holder as never })
  await flush()
  app.dispatch({ type: 'distribution/import', giftcard: card })
  expect(app.store.getState().distribution.pending).toBe(`import:${card.id}`)
  app.dispatch({ type: 'auth/disconnected' })
  login('0xsecond')
  reject_transfer(new Error('old holder failure'))
  await flush()
  expect(app.store.getState().distribution.error).toBeNull()
  stop()
})

test('switching holder during inspection loads the new holder and ignores the late old snapshot', async () => {
  const old_card = { id: '0xold', template: '0xt', amount: 1 }
  const new_card = { id: '0xnew', template: '0xt', amount: 1 }
  let finish_old: (cards: (typeof old_card)[]) => void = () => undefined
  const old_holder = {
    address: '0xoldholder',
    read_giftcards: () =>
      new Promise((resolve) => {
        finish_old = resolve
      }),
  }
  const new_holder = { address: '0xnewholder', read_giftcards: async () => [new_card] }
  const app = create_app()
  const stop = app.observe(['distribution'])
  app.dispatch({ type: 'path/open', pathname: '/claim' })
  app.dispatch({ type: 'external_wallet/connected', sequence: 0, session: old_holder as never })
  expect(app.store.getState().distribution.pending).toBe('load')
  app.dispatch({ type: 'external_wallet/invalidated', session: old_holder as never })
  app.dispatch({ type: 'external_wallet/connected', sequence: 1, session: new_holder as never })
  await flush()
  expect(app.store.getState().distribution.holder_giftcards).toEqual([new_card])
  finish_old([old_card])
  await flush()
  expect(app.store.getState().distribution.holder_giftcards).toEqual([new_card])
  stop()
})
