// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import type { AuthSession } from '../src/auth.ts'
import type { AuthStorage } from '../src/auth_storage.ts'
import { create_remembered_auth, type AuthProvider } from '../src/remembered_auth.ts'

const memory_storage = (
  initial: Readonly<Record<string, string>> = {}
): AuthStorage & { values: Map<string, string> } => {
  const values = new Map(Object.entries(initial))
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => void values.set(key, value),
    removeItem: (key) => void values.delete(key),
  }
}
const session_named = (wallet_name: string, events: string[] = [], identity = 'zklogin'): AuthSession =>
  ({
    address: '0x7a3f00000000000000000000000000000000c91e',
    wallet_name,
    identity,
    dispose: () => void events.push('dispose'),
    disconnect: async () => void events.push('disconnect'),
  }) as unknown as AuthSession
const provider =
  (overrides: Partial<AuthProvider<AuthSession>>, events: string[] = []) =>
  async (): Promise<AuthProvider<AuthSession>> => ({
    connect_google: async () => session_named('Sign in with Google', events),
    restore: async (name) => session_named(name, events),
    dispose: () => void events.push('unregister'),
    ...overrides,
  })

test('nothing remembered restores nothing and never loads the sign-in code', async () => {
  let loads = 0
  const auth = create_remembered_auth(async () => {
    loads += 1
    return provider({})()
  }, memory_storage())
  expect(auth.returning).toBe(false)
  expect(await auth.restore()).toBeNull()
  expect(loads).toBe(0)
})

test('signing in remembers the wallet, and signing out forgets it before disconnecting', async () => {
  const events: string[] = []
  const storage = memory_storage()
  const auth = create_remembered_auth(provider({}, events), storage)
  const session = await auth.connect()
  expect(storage.values.get('last_wallet')).toBe('Sign in with Google')
  await auth.sign_out(session)
  expect(storage.values.has('last_wallet')).toBe(false)
  expect(events).toEqual(['disconnect'])
})

test('a remembered wallet restores by name and stays remembered when the surface hands over', async () => {
  const events: string[] = []
  const storage = memory_storage({ last_wallet: 'Sign in with Google' })
  const auth = create_remembered_auth(provider({}, events), storage)
  expect(auth.returning).toBe(true)
  expect((await auth.restore())?.wallet_name).toBe('Sign in with Google')
  auth.dispose()
  await Promise.resolve()
  expect(events).toEqual(['unregister'])
  expect(storage.values.get('last_wallet')).toBe('Sign in with Google')
})

test('a wallet that no longer restores is forgotten, whether the provider refuses or fails', async () => {
  const refused = memory_storage({ last_wallet: 'Gone Wallet' })
  expect(await create_remembered_auth(provider({ restore: async () => null }), refused).restore()).toBeNull()
  expect(refused.values.has('last_wallet')).toBe(false)
  const failing = memory_storage({ last_wallet: 'Gone Wallet' })
  const broken = create_remembered_auth(
    provider({
      restore: async () => {
        throw new Error('expired')
      },
    }),
    failing
  )
  expect(broken.returning).toBe(true)
  await expect(broken.restore()).rejects.toThrow('expired')
  expect(failing.values.has('last_wallet')).toBe(false)
})

test('a surface that rules wallets in connects a named wallet without Google, and refuses a missing one by code', async () => {
  let connections = 0
  const storage = memory_storage()
  const auth = create_remembered_auth(
    provider({
      connect_google: async () => {
        throw new Error('Google is unavailable in this browser')
      },
      wallets: () => [
        {
          name: 'Slush',
          connect: async () => {
            connections += 1
            return session_named('Slush', [], 'wallet')
          },
        },
      ],
    }),
    storage,
    { wallets: true }
  )
  expect((await auth.connect('Slush')).wallet_name).toBe('Slush')
  expect(connections).toBe(1)
  expect(storage.values.get('last_wallet')).toBe('Slush')
  await expect(auth.connect('Missing')).rejects.toThrow('no_wallet_app')
  expect(connections).toBe(1)
})

test('a rejected sign-in remembers nothing', async () => {
  const storage = memory_storage()
  const auth = create_remembered_auth(
    provider({
      connect_google: async () => {
        throw new Error('popup closed')
      },
    }),
    storage
  )
  await expect(auth.connect()).rejects.toThrow('popup closed')
  expect(storage.values.size).toBe(0)
})

test('a Google-only surface refuses a named wallet and ignores a wallet session another surface remembered', async () => {
  const events: string[] = []
  const storage = memory_storage({ last_wallet: 'Slush' })
  const auth = create_remembered_auth(
    provider(
      {
        restore: async (name) => session_named(name, events, 'wallet'),
        wallets: () => [{ name: 'Slush', connect: async () => session_named('Slush', events, 'wallet') }],
      },
      events
    ),
    storage
  )
  // The allocation page may have remembered an installed wallet; it is not this surface's identity.
  expect(await auth.restore()).toBeNull()
  expect(events).toEqual(['dispose'])
  // The wallet stays remembered for the surface that rules it in.
  expect(storage.values.get('last_wallet')).toBe('Slush')
  await expect(auth.connect('Slush')).rejects.toThrow('no_wallet_app')
})
