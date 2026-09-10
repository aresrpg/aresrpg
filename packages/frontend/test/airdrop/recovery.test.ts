// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { afterEach, beforeEach, expect, test } from 'bun:test'

import { create_giftcard_attempts } from '../../src/modules/giftcard_attempts.ts'
import { create_app } from '../../src/store.ts'

import { TEMPLATE_ID, use_template_fixture } from './fixture.ts'

use_template_fixture()

const browser_keys = ['location', 'history', 'sessionStorage', 'localStorage'] as const
const descriptors = browser_keys.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const)
const memory_storage = () => {
  const values = new Map<string, string>()
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
  }
}
const put = (key: (typeof browser_keys)[number], value: unknown) =>
  Object.defineProperty(globalThis, key, { configurable: true, value })
beforeEach(() => {
  put('localStorage', memory_storage())
  put('sessionStorage', memory_storage())
})
afterEach(() => {
  for (const [key, descriptor] of descriptors) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor)
    else Reflect.deleteProperty(globalThis, key)
  }
})
const flush = async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
}
const template = TEMPLATE_ID
const card = { id: '0xcard', template, amount: 1 }
const boot = (wallet: unknown, cards = [card]) => {
  const app = create_app()
  const stop = app.observe(['distribution'])
  app.dispatch({ type: 'auth/connecting' })
  app.dispatch({ type: 'auth/connected', session: wallet as never })
  app.dispatch({ type: 'path/open', pathname: '/claim' })
  app.dispatch({ type: 'server/packet', packet: { type: 'packet/giftcards', giftcards: cards } })
  app.dispatch({ type: 'server/packet', packet: { type: 'packet/characters', characters: [] } })
  return { app, stop }
}

test('refreshing a sanitized printed URL preserves its bearer for subsequent login', () => {
  const href = 'https://aresrpg.world/gift?network=testnet#$bearer'
  put('location', new URL(href))
  put('history', {
    replaceState: (_state: unknown, _unused: string, pathname: string) => {
      put('location', new URL(pathname, href))
    },
  })
  for (let reload = 0; reload < 3; reload++) {
    const app = create_app()
    const stop = app.observe(['distribution'])
    expect(app.store.getState().distribution.gift_link_ready).toBeTrue()
    expect(globalThis.sessionStorage.getItem('aresrpg:gift-link')).toBe(href)
    stop()
  }
})

test('certified failed redemption is not automatically repeated after reload, but manual retry remains available', async () => {
  let executions = 0
  const wallet = {
    address: '0xgame',
    identity: 'zklogin',
    redeem_giftcards: async () => {
      executions++
      throw Object.assign(new Error('executed failure'), { digest: 'certified-failed-digest' })
    },
  }
  const first = boot(wallet)
  await flush()
  expect(executions).toBe(1)
  first.app.dispatch({ type: 'auth/disconnected' })
  first.stop()
  const second = boot(wallet)
  await flush()
  expect(executions).toBe(1)
  second.app.dispatch({ type: 'distribution/redeem', giftcards: [card] })
  await flush()
  expect(executions).toBe(2)
  second.stop()
})

test('unavailable attempt persistence disables automatic submission while manual redemption remains possible', async () => {
  put('localStorage', {
    getItem: () => null,
    setItem: () => {
      throw new Error('storage blocked')
    },
  })
  let executions = 0
  const wallet = {
    address: '0xgame',
    identity: 'zklogin',
    redeem_giftcards: async () => {
      executions++
      return { digest: 'done', item_id: '0xitem', item_version: '10' }
    },
  }
  const { app, stop } = boot(wallet)
  await flush()
  expect(executions).toBe(0)
  app.dispatch({ type: 'distribution/redeem', giftcards: [card] })
  await flush()
  expect(executions).toBe(1)
  stop()
})

test('automatic-attempt markers are written before execution and scoped to the game account', async () => {
  const storage = memory_storage()
  put('localStorage', storage)
  const accounts: string[] = []
  for (const address of ['0xfirst', '0xsecond']) {
    const wallet = {
      address,
      identity: 'zklogin',
      redeem_giftcards: async () => {
        expect([...storage.values.keys()].some((key) => key.endsWith(`:${address}:${card.id}`))).toBeTrue()
        accounts.push(address)
        throw new Error('executed failure')
      },
    }
    const { stop } = boot(wallet)
    await flush()
    stop()
  }
  expect(accounts).toEqual(['0xfirst', '0xsecond'])
})

test('a fresh bearer replaces an older saved one, and a plain reload intent is consumed', () => {
  const storage = memory_storage()
  storage.setItem('aresrpg:gift-link', 'https://aresrpg.world/gift#$old')
  put('sessionStorage', storage)
  put('location', new URL('https://aresrpg.world/gift#$new'))
  const fresh = create_app()
  const stop_fresh = fresh.observe(['distribution'])
  expect(storage.getItem('aresrpg:gift-link')).toBe('https://aresrpg.world/gift#$new')
  stop_fresh()
  storage.setItem('aresrpg:gift-link', 'https://aresrpg.world/claim')
  put('location', new URL('https://aresrpg.world/'))
  const callback = create_app()
  const stop_callback = callback.observe(['distribution'])
  expect(callback.store.getState().navigation.pathname).toBe('/claim')
  expect(storage.getItem('aresrpg:gift-link')).toBeNull()
  stop_callback()
})

test('unreadable attempt storage cannot trigger an automatic transaction', async () => {
  put('localStorage', {
    getItem: () => {
      throw new Error('storage blocked')
    },
  })
  let executions = 0
  const { stop } = boot({
    address: '0xgame',
    identity: 'zklogin',
    redeem_giftcards: async () => {
      executions++
    },
  })
  await flush()
  expect(executions).toBe(0)
  stop()
})

test('attempt suppression is network scoped and normalizes account/object hex case', () => {
  const storage = memory_storage()
  const testnet = create_giftcard_attempts(storage, 'testnet')
  const mainnet = create_giftcard_attempts(storage, 'mainnet')
  expect(testnet.remember('0xAB', '0xCD')).toBeTrue()
  expect(testnet.has('0xab', '0xcd')).toBeTrue()
  expect(mainnet.has('0xab', '0xcd')).toBeFalse()
})
