// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, mock, test } from 'bun:test'

import {
  failed_asset_url,
  finish_startup_recovery,
  missing_asset_issue,
  observe_startup_recovery,
  recover_missing_asset,
  reload_after_update,
  RELOAD_CHECK,
} from '../src/startup_recovery.ts'

const settled = () => new Promise<void>((resolve) => setImmediate(resolve))
const browser = async (run: (state: ReturnType<typeof fixture>) => Promise<void>) => {
  const state = fixture()
  const overrides = {
    navigator: { serviceWorker: state.workers },
    location: { origin: 'https://game.test', reload: state.reload },
    window: {
      setTimeout: (callback: () => void) => {
        state.timers.push(callback)
        return state.timers.length
      },
    },
    clearTimeout: () => {},
    sessionStorage: {
      getItem: (key: string) => state.storage.get(key) ?? null,
      setItem: (key: string, value: string) => state.storage.set(key, value),
    },
    fetch: state.fetch,
    addEventListener: state.tab.addEventListener.bind(state.tab),
    dispatchEvent: state.tab.dispatchEvent.bind(state.tab),
  }
  const previous = Object.entries(overrides).map(
    ([key]) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const
  )
  try {
    for (const [key, value] of Object.entries(overrides))
      Object.defineProperty(globalThis, key, { configurable: true, value })
    observe_startup_recovery()
    await run(state)
  } finally {
    finish_startup_recovery()
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else Reflect.deleteProperty(globalThis, key)
    }
  }
}
const fixture = () => {
  const tab = new EventTarget()
  const controller = Object.assign(new EventTarget(), { state: 'activated' })
  const update = mock(async () => {})
  const workers = Object.assign(new EventTarget(), {
    controller,
    getRegistration: async () => ({ scope: 'https://game.test/', update }),
  })
  const storage = new Map([['wallet-recovery', 'preserve-me']])
  const fetch = mock(async () => ({ status: 404 }))
  const reload = mock(() => {})
  const timers: (() => void)[] = []
  return { tab, workers, update, storage, fetch, reload, timers }
}
const city_missing = () =>
  recover_missing_asset({
    state: 'failed',
    backend: 'none',
    issue: { code: 'asset_missing', detail: 'missing city artifact' },
  })
const activate = (state: ReturnType<typeof fixture>, status = 'activated') => {
  state.workers.controller = Object.assign(new EventTarget(), { state: status })
  state.workers.dispatchEvent(new Event('controllerchange'))
}

test('only same-origin versioned JS/CSS and explicit missing city artifacts qualify', () => {
  expect(
    failed_asset_url(
      new Error('Failed to fetch dynamically imported module: https://game.test/assets/app-abcd.js?dpl=a'),
      'https://game.test'
    )?.pathname
  ).toBe('/assets/app-abcd.js')
  expect(failed_asset_url(new Error('https://other.test/assets/app.js'), 'https://game.test')).toBeNull()
  expect(failed_asset_url(new Error('https://game.test/api/account'), 'https://game.test')).toBeNull()
  expect(missing_asset_issue({ code: 'terrain_failed', detail: 'Generated city artifact failed to load: 500' })).toBe(
    false
  )
  expect(missing_asset_issue({ code: 'webgpu_initialization_failed', detail: '404' })).toBe(false)
})

test('a missing asset reloads once only after a different worker finishes activation, preserving storage', () =>
  browser(async (state) => {
    state.tab.dispatchEvent(
      Object.assign(new Event('vite:preloadError'), {
        payload: new Error('Unable to preload CSS for https://game.test/assets/entry-abc.css'),
      })
    )
    await settled()
    expect(state.update).toHaveBeenCalledTimes(1)
    activate(state, 'activating')
    expect(state.reload).not.toHaveBeenCalled()
    state.workers.controller.state = 'activated'
    state.workers.controller.dispatchEvent(new Event('statechange'))
    state.workers.controller.dispatchEvent(new Event('statechange'))
    expect(state.reload).toHaveBeenCalledTimes(1)
    expect(state.storage.get('wallet-recovery')).toBe('preserve-me')
    finish_startup_recovery()
    observe_startup_recovery()
    city_missing()
    await settled()
    expect(state.update).toHaveBeenCalledTimes(1)
  }))

test('a failed download without a newer worker does not reload', () =>
  browser(async (state) => {
    city_missing()
    await settled()
    state.workers.dispatchEvent(new Event('controllerchange'))
    expect(state.reload).not.toHaveBeenCalled()
  }))

test('a transaction veto prevents automatic reload and does not consume the retry marker', () =>
  browser(async (state) => {
    state.tab.addEventListener(RELOAD_CHECK, (event) => event.preventDefault())
    city_missing()
    await settled()
    activate(state)
    expect(state.reload).not.toHaveBeenCalled()
    expect(state.storage.size).toBe(1)
  }))

test('a late update cannot bypass the startup deadline through the normal auto-update callback', () =>
  browser(async (state) => {
    city_missing()
    await settled()
    state.timers[0]!()
    activate(state)
    reload_after_update()
    expect(state.reload).not.toHaveBeenCalled()
  }))

test('normal gameplay and generic network errors never start startup recovery', () =>
  browser(async (state) => {
    state.fetch.mockImplementation(async () => ({ status: 503 }))
    state.tab.dispatchEvent(
      Object.assign(new Event('vite:preloadError'), { payload: new Error('https://game.test/assets/app-a.js') })
    )
    await settled()
    expect(state.update).not.toHaveBeenCalled()
    finish_startup_recovery()
    city_missing()
    await settled()
    expect(state.update).not.toHaveBeenCalled()
  }))

test('an update lookup finishing after startup cannot restart gameplay', () =>
  browser(async (state) => {
    const gate = Promise.withResolvers<{ scope: string; update: typeof state.update }>()
    state.workers.getRegistration = () => gate.promise
    city_missing()
    finish_startup_recovery()
    gate.resolve({ scope: 'https://game.test/', update: state.update })
    await settled()
    activate(state)
    expect(state.update).not.toHaveBeenCalled()
    expect(state.reload).not.toHaveBeenCalled()
  }))

test('a normal update arriving during healthy startup is deferred until ready', () =>
  browser(async (state) => {
    reload_after_update()
    expect(state.reload).not.toHaveBeenCalled()
    finish_startup_recovery()
    expect(state.reload).toHaveBeenCalledTimes(1)
  }))
