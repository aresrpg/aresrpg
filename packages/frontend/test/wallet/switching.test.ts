// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import { create_wallet_runtime } from '../../src/wallet/runtime.ts'
import { initial_app_state, reduce_app_state } from '../../src/store.ts'

test('authorized accounts switch across providers without disconnecting or reopening authorization prompts', async () => {
  const calls = { authorize: [] as string[], disposed: [] as string[], disconnect: 0 }
  const wallets = ['First', 'Second'].map((name) => ({
    name,
    authorize: async (silent = false) => {
      calls.authorize.push(silent ? name + ':silent' : name)
      return ['0x1', '0x2']
    },
    connect: async (address: string) => ({
      wallet_name: name,
      address,
      dispose: () => {
        calls.disposed.push(`${name}:${address}`)
      },
      disconnect: async () => {
        calls.disconnect++
      },
    }),
    disconnect: async () => {
      calls.disconnect++
    },
  }))
  const runtime = create_wallet_runtime({
    network: 'mainnet',
    storage: null,
    create_auth: async () => ({ wallets: () => wallets }),
  })
  const stop = runtime.start()
  try {
    await Bun.sleep(0)
    runtime.dispatch({ type: 'external_wallet/authorize', wallet_name: 'First' })
    await Bun.sleep(0)
    runtime.dispatch({ type: 'external_wallet/select', wallet_name: 'First', address: '0x1' })
    await Bun.sleep(0)
    const first = runtime.store.getState().session
    runtime.dispatch({ type: 'external_wallet/authorize', wallet_name: 'Second' })
    await Bun.sleep(0)
    expect(runtime.store.getState().session).toBe(first)
    expect(runtime.store.getState().accounts).toHaveLength(4)
    runtime.dispatch({ type: 'external_wallet/cancel' })
    expect(runtime.store.getState().session).toBe(first)
    runtime.dispatch({ type: 'external_wallet/select', wallet_name: 'Second', address: '0x1' })
    expect(runtime.store.getState().session).toBeNull()
    await Bun.sleep(0)
    expect(runtime.store.getState().session?.wallet_name).toBe('Second')
    runtime.dispatch({ type: 'external_wallet/invalidated', session: first! })
    expect(runtime.store.getState().session?.wallet_name).toBe('Second')
    runtime.dispatch({ type: 'external_wallet/select', wallet_name: 'First', address: '0x2' })
    await Bun.sleep(0)
    expect(runtime.store.getState().session).toMatchObject({ wallet_name: 'First', address: '0x2' })
    expect(calls.authorize).toEqual(['First', 'First:silent', 'Second', 'Second:silent', 'First:silent'])
    expect(calls.disposed).toEqual(['First:0x1', 'Second:0x1'])
    expect(calls.disconnect).toBe(0)
    runtime.dispatch({ type: 'external_wallet/disconnect' })
    await Bun.sleep(0)
    expect(runtime.store.getState().accounts.every(({ wallet_name }) => wallet_name === 'Second')).toBe(true)
    expect(calls.disconnect).toBe(1)
  } finally {
    stop()
  }
})

test('claim transfer and redemption block wallet mutations at the app reducer', () => {
  const initial = initial_app_state({ quality: 'medium', flat_mode: false, music_enabled: true, render_distance: null })
  const session = { address: '0xholder', wallet_name: 'First' } as never
  for (const pending of ['import', 'redeem']) {
    const state = {
      ...initial,
      external_wallet: { ...initial.external_wallet, session },
      distribution: { ...initial.distribution, pending },
    }
    const next = reduce_app_state(state, { type: 'external_wallet/disconnect' })
    expect(next.external_wallet).toBe(state.external_wallet)
    expect(next.distribution.pending).toBe(pending)
  }
})
