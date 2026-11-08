// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import { create_app } from '../../src/store.ts'

const session = { address: '0xfixture', wallet_name: 'Fixture' } as never
const roster = { type: 'server/packet' as const, packet: { type: 'packet/characters' as const, characters: [] } }

/** Exercise the real queued reducer and navigation observer without auth/network/render observers. */
const with_navigation = async (
  path: string,
  check: (
    app: ReturnType<typeof create_app>,
    browser: Readonly<{ url: () => URL; replaced: string[]; pushed: string[]; pop: (path: string) => void }>
  ) => Promise<void>
) => {
  const descriptors = {
    location: Object.getOwnPropertyDescriptor(globalThis, 'location'),
    history: Object.getOwnPropertyDescriptor(globalThis, 'history'),
  }
  let url = new URL(path, 'https://game.example')
  const replaced: string[] = []
  const pushed: string[] = []
  const history_state = { entry: 'retained' }
  Object.defineProperty(globalThis, 'location', { configurable: true, get: () => url })
  Object.defineProperty(globalThis, 'history', {
    configurable: true,
    value: {
      state: history_state,
      replaceState: (state: unknown, _title: string, path: string) => {
        expect(state).toBe(history_state)
        replaced.push(path)
        url = new URL(path, url)
      },
      pushState: (_state: unknown, _title: string, path: string) => {
        pushed.push(path)
        url = new URL(path, url)
      },
    },
  })
  const app = create_app()
  const stop = app.observe(['navigation'])
  try {
    await check(app, {
      url: () => url,
      replaced,
      pushed,
      pop: (path) => {
        url = new URL(path, url)
        globalThis.dispatchEvent(new Event('popstate'))
      },
    })
  } finally {
    stop()
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else Reflect.deleteProperty(globalThis, key)
    }
  }
}

for (const path of ['/world?intent=connect-agent', '/connect-agent', '/connect-agent/?intent=connect-agent'])
  test(`pending ${path} survives cancelled login and opens only the existing dialog`, async () => {
    await with_navigation(`${path}${path.includes('?') ? '&' : '?'}keep=one&keep=two#anchor`, async (app, browser) => {
      app.dispatch({ type: 'auth/ready', wallets: [] })
      await Promise.resolve()
      expect(app.store.getState().navigation.dialog).toBeNull()
      app.dispatch({ type: 'auth/connecting' })
      app.dispatch({ type: 'auth/failed', error: 'Cancelled' })
      expect(browser.replaced).toEqual([])
      expect(browser.pushed).toEqual([])
      app.dispatch({ type: 'auth/connecting' })
      app.dispatch({ type: 'auth/connected', session })
      await Promise.resolve()
      expect(browser.replaced).toEqual(['/world?keep=one&keep=two#anchor'])
      expect(browser.pushed).toEqual([])
      expect(app.store.getState().navigation).toMatchObject({
        page: 'world',
        pathname: '/world',
        dialog: 'agent_setup',
      })
      app.dispatch(roster)
      app.dispatch(roster)
      expect(app.store.getState().navigation.dialog).toBe('agent_setup')
      app.dispatch({ type: 'dialog/open', dialog: null })
      app.dispatch(roster)
      expect(app.store.getState().navigation.dialog).toBe('welcome')
      expect(browser.replaced).toHaveLength(1)
      app.dispatch({ type: 'auth/disconnected' })
      expect(app.store.getState().navigation).toMatchObject({ page: 'world', pathname: '/', dialog: null })
    })
  })

test('restored login consumes intent before repeated updates and Back/Forward cannot replay it', async () => {
  await with_navigation('/world?intent=connect-agent', async (app, browser) => {
    app.dispatch({ type: 'auth/connecting' })
    app.dispatch({ type: 'auth/connected', session })
    app.dispatch({ type: 'auth/ready', wallets: [] })
    await Promise.resolve()
    expect(app.store.getState().navigation.dialog).toBe('agent_setup')
    const consumed_url = browser.url().href
    browser.pop('/world')
    expect(app.store.getState().navigation.dialog).toBeNull()
    browser.pop(consumed_url)
    app.dispatch(roster)
    expect(app.store.getState().navigation.dialog).not.toBe('agent_setup')
    expect(browser.replaced).toEqual(['/world'])
  })
})

for (const path of ['/world', '/world?intent=other'])
  test(`ordinary ${path} never opens agent setup`, async () => {
    await with_navigation(path, async (app, browser) => {
      app.dispatch({ type: 'auth/ready', wallets: [] })
      app.dispatch({ type: 'auth/connected', session })
      await Promise.resolve()
      expect(app.store.getState().navigation.dialog).toBeNull()
      expect(browser.replaced).toEqual([])
      expect(browser.pushed).toEqual([])
      expect(browser.url().pathname + browser.url().search).toBe(path)
    })
  })
