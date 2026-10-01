// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import { analytics_enabled, analytics_properties } from '../src/analytics.ts'
import { analytics_events } from '../src/modules/analytics.ts'
import { create_app } from '../src/store.ts'
import type { AuthSession } from '../src/auth.ts'

const wallet = { address: 'test-account' } as AuthSession
const connected_app = () => {
  const app = create_app()
  app.dispatch({ type: 'auth/connecting' })
  app.dispatch({ type: 'auth/connected', session: wallet })
  return app
}

test('remote analytics is absent from development, tests, editor and OAuth callbacks', () => {
  for (const mode of ['development', 'test']) expect(analytics_enabled(mode, '/', 'public')).toBe(false)
  for (const path of ['/enoki', '/enoki/', '/demo']) expect(analytics_enabled('production', path, 'public')).toBe(false)
  expect(analytics_enabled('production', '/', '')).toBe(false)
  expect(analytics_enabled('production', '/play-demo', 'public')).toBe(true)
})

test('outbound allowlist removes bearer URLs, nested person data, names and wallet addresses', () => {
  expect(
    analytics_properties({
      distinct_id: 'anonymous-id',
      $session_id: 'session',
      encounter: 1,
      $current_url: 'https://aresrpg.world/claim#secret',
      $referrer: 'https://example.org/?token=secret',
      $set_once: { $initial_current_url: 'secret' },
      address: 'wallet',
      name: 'player',
      error: 'secret error',
      $pathname: '/unknown-sensitive-path',
    })
  ).toEqual({ distinct_id: 'anonymous-id', $session_id: 'session', encounter: 1 })
})

test('activation requires submitted creation and its receipt, never a roster update', () => {
  const app = connected_app()
  const initial = app.store.getState()
  app.dispatch({ type: 'character/creation_confirmed', wallet, digest: 'unsubmitted' })
  expect(analytics_events(app.store.getState(), initial)).toEqual([])
  app.dispatch({ type: 'character/creation_started', wallet })
  const pending = app.store.getState()
  expect(analytics_events(pending, initial)).toEqual([{ name: 'character_creation_submitted' }])
  app.dispatch({ type: 'character/creation_confirmed', wallet, digest: 'certified' })
  const confirmed = app.store.getState()
  expect(analytics_events(confirmed, pending)).toEqual([{ name: 'character_creation_confirmed' }])
  app.dispatch({ type: 'character/creation_confirmed', wallet, digest: 'certified' })
  expect(app.store.getState()).toBe(confirmed)
  expect(analytics_events(confirmed, confirmed)).toEqual([])
})

test('failed creation and stale account completions cannot become activation', () => {
  const app = connected_app()
  app.dispatch({ type: 'character/creation_started', wallet })
  const pending = app.store.getState()
  app.dispatch({ type: 'character/creation_failed', wallet })
  expect(analytics_events(app.store.getState(), pending)).toEqual([{ name: 'character_creation_failed' }])
  app.dispatch({ type: 'auth/disconnected' })
  const disconnected = app.store.getState()
  app.dispatch({ type: 'character/creation_confirmed', wallet, digest: 'late' })
  expect(app.store.getState()).toBe(disconnected)
})

test('demo fights and duplicate state updates produce only real milestone changes', () => {
  const app = create_app()
  const initial = app.store.getState()
  app.dispatch({ type: 'adventure/entered' })
  const entered = app.store.getState()
  expect(analytics_events(entered, initial)).toEqual([{ name: 'demo_started' }])
  app.dispatch({ type: 'adventure/entered' })
  expect(analytics_events(app.store.getState(), entered)).toEqual([])
  app.dispatch({ type: 'adventure/challenge' })
  expect(analytics_events(app.store.getState(), entered)).toEqual([
    { name: 'demo_fight_started', properties: { encounter: 1 } },
  ])
})

test('restored authentication completes login without inventing an interactive start', () => {
  const app = create_app()
  const initial = app.store.getState()
  app.dispatch({ type: 'auth/connecting' })
  expect(analytics_events(app.store.getState(), initial)).toEqual([])
  const restoring = app.store.getState()
  app.dispatch({ type: 'auth/connected', session: wallet })
  expect(analytics_events(app.store.getState(), restoring)).toEqual([{ name: 'login_completed' }])
})

test('analytics proxy routes precede the app fallback and keep SDK assets on the asset host', async () => {
  const { rewrites, headers } = await Bun.file(new URL('../vercel.json', import.meta.url)).json()
  const fallback = rewrites.findIndex(({ destination }: { destination: string }) => destination === '/index.html')
  for (const [prefix, host] of [
    ['static/', 'us-assets.i.posthog.com'],
    ['array/', 'us-assets.i.posthog.com'],
    ['', 'us.i.posthog.com'],
  ]) {
    const index = rewrites.findIndex(({ source }: { source: string }) => source === `/ingest/${prefix}:path(.*)`)
    expect(index).toBeGreaterThanOrEqual(0)
    expect(index).toBeLessThan(fallback)
    expect(rewrites[index].destination).toBe(`https://${host}/${prefix}:path`)
  }
  const page = new RegExp(`^${rewrites[fallback].source}$`)
  for (const path of ['/ingest', '/ingest/e/', '/ingest/array/project/config.js']) expect(page.test(path)).toBe(false)
  expect(page.test('/characters')).toBe(true)
  const referrer = headers
    .flatMap(({ headers }: { headers: { key: string; value: string }[] }) => headers)
    .find(({ key }: { key: string }) => key === 'Referrer-Policy')
  expect(referrer.value).toBe('strict-origin')
})
