// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, spyOn, test } from 'bun:test'

import { observe_journey } from '../../src/modules/journey.ts'
import {
  create_app,
  initial_app_state,
  reduce_app_state,
  type AppContext,
  type AppInput,
  type AppState,
} from '../../src/store.ts'
import type { JourneyStorage } from '../../src/journey/persistence.ts'

const harness = (storage: JourneyStorage) => {
  const base = initial_app_state({ quality: 'medium', flat_mode: false, music_enabled: true, render_distance: null })
  let state: AppState = reduce_app_state(reduce_app_state(base, { type: 'auth/connecting' }), {
    type: 'auth/connected',
    session: { address: 'owner' } as never,
  })
  const listeners: ((current: AppState, previous: AppState) => void)[] = []
  const controller = new AbortController()
  const dispatch = (input: AppInput): void => {
    const previous = state
    state = reduce_app_state(state, input)
    if (state !== previous) listeners.forEach((listener) => listener(state, previous))
  }
  const context: AppContext = {
    get_state: () => state,
    dispatch,
    signal: controller.signal,
    events: {
      on: (name, listener) => {
        if (name === 'STATE_UPDATED') listeners.push(listener as (current: AppState, previous: AppState) => void)
      },
    },
  }
  observe_journey(context, storage)
  return { dispatch, read: () => state, stop: () => controller.abort() }
}
const flush = async (): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

test('queued writes cannot restore completion after reset; IndexedDB receives only completed IDs', async () => {
  const captured: string[][] = []
  const first_write = Promise.withResolvers<void>()
  const app = harness({
    load: async () => ['welcome'],
    save: async (_identity, completed) => {
      captured.push([...completed])
      if (captured.length === 1) await first_write.promise
    },
  })
  await flush()
  expect(app.read().journey.completed).toEqual(['welcome'])
  expect(captured).toEqual([])
  app.dispatch({ type: 'journey/completed', ids: ['hoe'] })
  await flush()
  expect(app.read().journey.saving).toBe(true)
  app.dispatch({ type: 'journey/reset' })
  first_write.resolve()
  await flush()
  expect(captured).toEqual([['welcome', 'hoe'], []])
  expect(app.read().journey.saving).toBe(false)
  expect(app.read().journey.completed).toEqual([])
  app.stop()
})

test('a failed load never overwrites unknown saved completion with an empty set or session progress', async () => {
  const reported = spyOn(console, 'error').mockImplementation(() => {})
  const saved: string[][] = []
  try {
    const app = harness({
      load: async () => {
        throw new Error('Temporary storage read failure')
      },
      save: async (_identity, completed) => {
        saved.push([...completed])
      },
    })
    await flush()
    expect(app.read().journey.storage_failed).toBe(true)
    app.dispatch({ type: 'journey/start' })
    app.dispatch({ type: 'journey/completed', ids: ['hoe'] })
    await flush()
    expect(app.read().journey.completed).toEqual(['welcome', 'hoe'])
    expect(saved).toEqual([])
    expect(reported).toHaveBeenCalled()
    app.stop()
  } finally {
    reported.mockRestore()
  }
})

test('switching accounts loads existing completion without writing the empty loading state', async () => {
  const writes: string[][] = []
  const app = harness({
    load: async () => ['welcome', 'hoe'],
    save: async (_identity, completed) => {
      writes.push([...completed])
    },
  })
  await flush()
  app.dispatch({ type: 'auth/disconnected' })
  app.dispatch({ type: 'auth/connecting' })
  app.dispatch({ type: 'auth/connected', session: { address: 'second-owner' } as never })
  await flush()
  expect(app.read().journey.completed).toEqual(['welcome', 'hoe'])
  expect(app.read().journey.identity).toEndWith(':second-owner')
  expect(writes).toEqual([])
  app.stop()
})

test('session updates cannot invalidate the account’s in-flight storage load', async () => {
  const pending = Promise.withResolvers<readonly string[]>()
  const app = harness({ load: () => pending.promise, save: async () => {} })
  const before = app.read().journey
  app.dispatch({ type: 'link/connecting' })
  app.dispatch({ type: 'wallet/refreshed', balance_mist: 0n, kares_balance: null, gas_spent_mist: 0n })
  pending.resolve(['welcome', 'hoe'])
  await flush()
  expect(app.read().journey.ready).toBe(true)
  expect(app.read().journey.generation).toBe(before.generation)
  expect(app.read().journey.completed).toEqual(['welcome', 'hoe'])
  const ready = app.read().journey
  app.dispatch({ type: 'link/connecting' })
  expect(app.read().journey).toBe(ready)
  app.stop()
})

test('the real dispatch queue derives journey scope from login before queued connection work', async () => {
  const reported = spyOn(console, 'error').mockImplementation(() => {})
  const app = create_app()
  const unsubscribe = app.store.subscribe((state, previous) => {
    if (state.session.wallet !== previous.session.wallet && state.session.wallet)
      app.dispatch({ type: 'link/connecting' })
  })
  const stop = app.observe(['journey'])
  try {
    app.dispatch({ type: 'auth/connecting' })
    app.dispatch({ type: 'auth/connected', session: { address: 'queued-login' } as never })
    expect(app.store.getState().journey.generation).toBe(1)
    await flush()
    // Bun has no IndexedDB: the failed load still completes browser-local initialization.
    expect(app.store.getState().journey.ready).toBe(true)
    expect(app.store.getState().journey.storage_failed).toBe(true)
  } finally {
    stop()
    unsubscribe()
    reported.mockRestore()
  }
})
