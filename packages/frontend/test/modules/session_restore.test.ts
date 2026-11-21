// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The sign-in restore of the session observer: what a page may show while the remembered session is
// looked up. The sign-in code and the game socket are the observer's effects, so each test passes its own.
import { expect, spyOn, test } from 'bun:test'

import type { AuthSession } from '../../src/auth.ts'
import { play_stage } from '../../src/dapp/DappPlay.tsx'
import { observe_session, type SessionEffects } from '../../src/modules/session.ts'
import { create_remembered_auth, type AuthProvider } from '../../src/remembered_auth.ts'
import { initial_app_state, reduce_app_state, type AppContext, type AppInput, type AppState } from '../../src/store.ts'

const BOT = 'https://bot.example.test'
const REMEMBERED = 'Sign in with Google'
const wallet = {
  address: `0x${'d'.repeat(64)}`,
  identity: 'zklogin',
  wallet_name: REMEMBERED,
  read_sui_balance: async () => 0n,
  read_kares_balance: async () => null,
  gas_spent_24h: () => 0n,
  disconnect: async () => undefined,
} as unknown as AuthSession

const device = (remembered: string | null) => {
  const values = new Map(remembered ? [['last_wallet', remembered]] : [])
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
  }
}
type Provider = AuthProvider<AuthSession>
const provider = (restore: Provider['restore']): Provider => ({
  connect_google: async () => wallet,
  restore,
  dispose: () => undefined,
})

/** The store's queued dispatch with named events and STATE_UPDATED, arming the session observer alone. */
const session_harness = (remembered: string | null, source: () => Promise<Provider>) => {
  let state = initial_app_state({} as AppState['settings'])
  let queue: readonly AppInput[] = []
  let reducing = false
  const listeners = new Map<string, readonly ((...values: readonly unknown[]) => void)[]>()
  const emit = (name: string, ...values: readonly unknown[]) =>
    (listeners.get(name) ?? []).forEach((listener) => listener(...values))
  // Every state a page could render, from the first render on.
  let rendered: readonly AppState[] = []
  const dispatch = (input: AppInput) => {
    queue = [...queue, input]
    if (reducing) return
    reducing = true
    while (queue.length) {
      const [next, ...rest] = queue
      queue = rest
      const previous = state
      state = reduce_app_state(previous, next!)
      emit(next!.type, next)
      if (state === previous) continue
      rendered = [...rendered, state]
      emit('STATE_UPDATED', state, previous)
    }
    reducing = false
  }
  const controller = new AbortController()
  const storage = device(remembered)
  let links: readonly AuthSession[] = []
  const effects: SessionEffects = {
    account: create_remembered_auth(source, storage),
    connect: ({ session }) => {
      links = [...links, session]
      return { send: () => false, dispose: () => undefined }
    },
  }
  const context: AppContext = {
    events: {
      on: ((name: string, listener: (...values: readonly unknown[]) => void) =>
        void listeners.set(name, [...(listeners.get(name) ?? []), listener])) as AppContext['events']['on'],
    },
    signal: controller.signal,
    get_state: () => state,
    dispatch,
  }
  observe_session(context, effects)
  // The surface renders right after its observers are armed: this is the state of the first render.
  rendered = [state]
  return {
    state: () => state,
    stages: () => rendered.map((each) => play_stage(each, BOT)),
    links: () => links,
    storage,
    stop: () => controller.abort(),
  }
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 10))

test('a remembered wallet is signing in from the first render and never passes through the sign-in card', async () => {
  // The sign-in code has not loaded yet: the first render happens before it.
  const code = Promise.withResolvers<Provider>()
  let restored: readonly string[] = []
  const page = session_harness(REMEMBERED, () => code.promise)
  try {
    expect(page.state().session).toMatchObject({
      auth_status: 'connecting',
      auth_request: 'restore',
      auth_ready: false,
      wallet: null,
    })
    expect(page.stages()).toEqual(['signing_in'])

    code.resolve(
      provider(async (name) => {
        restored = [...restored, name]
        return wallet
      })
    )
    await settle()

    expect(restored).toEqual([REMEMBERED])
    expect(page.state().session).toMatchObject({ auth_status: 'authenticated', auth_ready: true, auth_error: null })
    expect(page.state().session.wallet).toBe(wallet)
    expect(page.links()).toEqual([wallet])
    // No state between the first render and the restored session offered the sign-in card.
    expect(page.stages()).not.toContain('sign_in')
    expect(page.stages()[0]).toBe('signing_in')
    expect(page.storage.values.get('last_wallet')).toBe(REMEMBERED)
  } finally {
    page.stop()
  }
})

test('a first-time visitor is asked to sign in, and nothing is restored', async () => {
  let restores = 0
  const page = session_harness(null, async () =>
    provider(async () => {
      restores += 1
      return wallet
    })
  )
  try {
    expect(page.state().session).toMatchObject({ auth_status: 'idle', auth_request: null, auth_ready: false })
    expect(page.stages()).toEqual(['sign_in'])
    await settle()
    // The sign-in code has loaded: the card stays, and its button is ready.
    expect(page.state().session).toMatchObject({ auth_status: 'idle', auth_ready: true, wallet: null })
    expect(page.stages().at(-1)).toBe('sign_in')
    expect(page.stages()).not.toContain('signing_in')
    expect(restores).toBe(0)
    expect(page.links()).toEqual([])
  } finally {
    page.stop()
  }
})

const FAILED_RESTORES: readonly (readonly [string, () => Promise<Provider>])[] = [
  ['the remembered session is gone', async () => provider(async () => null)],
  [
    'the restore fails',
    async () =>
      provider(async () => {
        throw new Error('session expired')
      }),
  ],
  [
    'the sign-in code does not load',
    async () => {
      throw new Error('chunk failed')
    },
  ],
]
test.each(FAILED_RESTORES)('a failed restore falls back to the sign-in card: %s', async (_reason, source) => {
  const logged = spyOn(console, 'error').mockImplementation(() => undefined)
  const page = session_harness(REMEMBERED, source)
  try {
    expect(page.stages()).toEqual(['signing_in'])
    await settle()
    const { session } = page.state()
    expect(session).toMatchObject({ auth_status: 'idle', auth_request: null, auth_ready: true, wallet: null })
    // The failure is kept for the card to explain; the page never claims a session.
    expect(session.auth_error).toBeTruthy()
    expect(page.stages().at(-1)).toBe('sign_in')
    expect(page.links()).toEqual([])
    // A wallet that no longer restores is forgotten: the next visit is asked to sign in at once.
    expect(page.storage.values.has('last_wallet')).toBe(false)
  } finally {
    page.stop()
    // Releasing a sign-in that never loaded reports it once more; the log stays quiet until then.
    await settle()
    logged.mockRestore()
  }
})
