// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import { create_wallet_runtime } from '../../src/wallet/runtime.ts'

const address = `0x${'1'.repeat(64)}`
const second = `0x${'2'.repeat(64)}`
const fixture = () => {
  const values = new Map<string, string>()
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value)
    },
    removeItem: (key: string) => {
      values.delete(key)
    },
  }
  const calls = { authorize: [] as boolean[], connect: [] as string[], disconnect: 0 }
  const session = {
    address,
    wallet_name: 'Test wallet',
    disconnect: async () => {
      calls.disconnect += 1
    },
  }
  const wallet = {
    name: session.wallet_name,
    authorize: async (silent = false) => {
      calls.authorize.push(silent)
      return [address, second]
    },
    connect: async (selected: string) => {
      calls.connect.push(selected)
      return { ...session, address: selected }
    },
    disconnect: session.disconnect,
  }
  const options = { network: 'testnet', storage, create_auth: async () => ({ wallets: () => [wallet] }) }
  return { values, storage, calls, wallet, options }
}

test('one connection persists only the selected wallet and address, restores silently, and forgets on disconnect', async () => {
  const { options, calls, values } = fixture()
  const first = create_wallet_runtime(options)
  const stop = first.start()
  await Bun.sleep(0)
  first.dispatch({ type: 'external_wallet/authorize', wallet_name: 'Test wallet' })
  await Bun.sleep(0)
  first.dispatch({ type: 'external_wallet/select', address: second })
  await Bun.sleep(0)
  expect(calls.authorize).toEqual([false])
  expect(JSON.parse([...values.values()][0])).toEqual({ wallet_name: 'Test wallet', address: second })
  stop()
  const restored = create_wallet_runtime(options)
  const stop_restored = restored.start()
  await Bun.sleep(0)
  expect(calls.authorize).toEqual([false, true])
  expect(restored.store.getState().session?.address).toBe(second)
  restored.dispatch({ type: 'external_wallet/disconnect' })
  await Bun.sleep(0)
  expect(values.size).toBe(0)
  expect(restored.store.getState().session).toBeNull()
  expect(calls.disconnect).toBe(1)
  stop_restored()
  const next = create_wallet_runtime(options)
  const stop_next = next.start()
  await Bun.sleep(0)
  expect(calls.authorize).toEqual([false, true])
  expect(next.store.getState().session).toBeNull()
  stop_next()
})

test('restoration never substitutes another authorized account', async () => {
  const { options, wallet, values, calls } = fixture()
  values.set('aresrpg:external-wallet:testnet', JSON.stringify({ wallet_name: 'Test wallet', address: second }))
  wallet.authorize = async (silent = false) => {
    calls.authorize.push(silent)
    return [address]
  }
  const runtime = create_wallet_runtime(options)
  const stop = runtime.start()
  await Bun.sleep(0)
  expect(calls.authorize).toEqual([true])
  expect(calls.connect).toEqual([])
  expect(runtime.store.getState().session).toBeNull()
  expect(values.size).toBe(0)
  stop()
})

test('disconnect invalidates a delayed restore before it can recreate a session', async () => {
  const { options, wallet, values, calls } = fixture()
  values.set('aresrpg:external-wallet:testnet', JSON.stringify({ wallet_name: 'Test wallet', address }))
  const deferred = Promise.withResolvers<string[]>()
  wallet.authorize = () => deferred.promise
  const runtime = create_wallet_runtime(options)
  const stop = runtime.start()
  await Bun.sleep(0)
  runtime.dispatch({ type: 'external_wallet/disconnect' })
  deferred.resolve([address])
  await Bun.sleep(0)
  expect(runtime.store.getState().session).toBeNull()
  expect(values.size).toBe(0)
  expect(calls.connect).toEqual([])
  stop()
})

test('a saved selection waits for late provider registration and remains network scoped', async () => {
  const { options, values, wallet, calls } = fixture()
  values.set('aresrpg:external-wallet:testnet', JSON.stringify({ wallet_name: wallet.name, address }))
  let available = false
  let changed: () => void = () => undefined
  const runtime = create_wallet_runtime({
    ...options,
    create_auth: async () => ({
      wallets: () => (available ? [wallet] : []),
      on_wallets_changed: (listener: () => void) => {
        changed = listener
        return () => {
          changed = () => undefined
        }
      },
    }),
  })
  const stop = runtime.start()
  await Bun.sleep(0)
  expect(runtime.store.getState().session).toBeNull()
  available = true
  changed()
  await Bun.sleep(0)
  expect(runtime.store.getState().session?.address).toBe(address)
  expect(calls.authorize).toEqual([true])
  stop()
  const other_network = create_wallet_runtime({ ...options, network: 'mainnet' })
  const stop_other = other_network.start()
  await Bun.sleep(0)
  expect(other_network.store.getState().session).toBeNull()
  expect(calls.authorize).toEqual([true])
  stop_other()
})

test('observer rearming preserves one session and reattaches provider invalidation', async () => {
  const { options, wallet, values, calls } = fixture()
  let invalidate: () => void = () => undefined
  let disposals = 0
  const runtime = create_wallet_runtime({
    ...options,
    create_auth: async () => ({
      wallets: () => [
        {
          ...wallet,
          connect: async (selected: string) => ({
            ...(await wallet.connect(selected)),
            dispose: () => {
              disposals += 1
            },
            on_invalidated: (listener: () => void) => {
              invalidate = listener
              return () => {
                invalidate = () => undefined
              }
            },
          }),
        },
      ],
    }),
  })
  const stop = runtime.start()
  await Bun.sleep(0)
  runtime.dispatch({ type: 'external_wallet/authorize', wallet_name: wallet.name })
  await Bun.sleep(0)
  runtime.dispatch({ type: 'external_wallet/select', address })
  await Bun.sleep(0)
  const { session } = runtime.store.getState()
  stop()
  const stop_again = runtime.start()
  await Bun.sleep(0)
  expect(runtime.store.getState().session).toBe(session)
  expect(calls.connect).toEqual([address])
  expect(disposals).toBe(0)
  invalidate()
  expect(runtime.store.getState().session).toBeNull()
  expect(values.size).toBe(0)
  expect(disposals).toBe(1)
  stop_again()
})

test('disconnect forgets the selection before a failed provider disconnect finishes', async () => {
  const { options, wallet, values } = fixture()
  const deferred = Promise.withResolvers<void>()
  const runtime = create_wallet_runtime({
    ...options,
    create_auth: async () => ({
      wallets: () => [
        {
          ...wallet,
          connect: async (selected: string) => ({
            ...(await wallet.connect(selected)),
            disconnect: () => deferred.promise,
          }),
        },
      ],
    }),
  })
  const stop = runtime.start()
  await Bun.sleep(0)
  runtime.dispatch({ type: 'external_wallet/authorize', wallet_name: wallet.name })
  await Bun.sleep(0)
  runtime.dispatch({ type: 'external_wallet/select', address })
  await Bun.sleep(0)
  runtime.dispatch({ type: 'external_wallet/disconnect' })
  expect(values.size).toBe(0)
  expect(runtime.store.getState().session).toBeNull()
  deferred.reject(new Error('provider unavailable'))
  await Bun.sleep(0)
  expect(runtime.store.getState().error).toBe('provider unavailable')
  expect(values.size).toBe(0)
  stop()
})
