// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'
import type { HydratedFightCheckpoint } from '@aresrpg/fight'
import type { CharacterRow } from '@aresrpg/protocol'
import type { TransactionExecution } from '@aresrpg/sdk'

import { analytics_enabled, analytics_properties } from '../src/analytics.ts'
import { analytics_events } from '../src/modules/analytics.ts'
import { initial_analytics_state } from '../src/analytics/state.ts'
import { create_app, reduce_app_state } from '../src/store.ts'
import type { AuthSession } from '../src/auth.ts'

const wallet = { address: 'test-account' } as AuthSession
const connected_app = () => {
  const app = create_app()
  app.dispatch({ type: 'auth/connecting' })
  app.dispatch({ type: 'auth/connected', session: wallet })
  return app
}

test('transaction observation follows the game wallet and stops on observer teardown', () => {
  const app = create_app()
  const listeners = new Set<(execution: TransactionExecution) => void>()
  const session = {
    ...wallet,
    on_transaction: (listener: (execution: TransactionExecution) => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  } as AuthSession
  const stop = app.observe(['analytics'])
  app.dispatch({ type: 'auth/connecting' })
  app.dispatch({ type: 'auth/connected', session })
  expect(listeners.size).toBe(1)
  listeners.forEach((listener) => listener({ digest: 'confirmed', outcome: 'success' }))
  expect(app.store.getState().analytics.execution).toEqual({ digest: 'confirmed', outcome: 'success' })
  app.dispatch({ type: 'auth/disconnected' })
  expect(listeners.size).toBe(0)
  expect(app.store.getState().analytics).toEqual(initial_analytics_state())
  app.dispatch({ type: 'auth/connecting' })
  app.dispatch({ type: 'auth/connected', session })
  expect(listeners.size).toBe(1)
  stop()
  expect(listeners.size).toBe(0)
})

test('certified transaction deltas count once, exclude stale wallets, and omit identifiers', () => {
  const app = connected_app()
  const before = app.store.getState()
  const input = {
    type: 'analytics/transaction_executed' as const,
    wallet,
    execution: { digest: 'private-digest', outcome: 'success' as const },
  }
  app.dispatch(input)
  const executed = app.store.getState()
  expect(analytics_events(executed, before)).toEqual([
    { name: 'transaction_executed', properties: { outcome: 'success' } },
  ])
  app.dispatch(input)
  expect(app.store.getState()).toBe(executed)
  app.dispatch({ ...input, execution: { digest: 'failed', outcome: 'failure' } })
  expect(analytics_events(app.store.getState(), executed)).toEqual([
    { name: 'transaction_executed', properties: { outcome: 'failure' } },
  ])
  app.dispatch({ type: 'auth/disconnected' })
  const disconnected = app.store.getState()
  app.dispatch(input)
  expect(app.store.getState()).toBe(disconnected)
})

test('real fights count once per fight, excluding spectators, demo and restored combat', () => {
  const base = connected_app().store.getState()
  // State projection fixture; no wire decoding occurs here.
  const checkpoint = {
    contract: {
      id: 'fight',
      round: 0n,
      turn_ptr: 0n,
      turn_started_ms: 0n,
      queue: [0n, 1n],
      started_ms: null,
      ended_ms: null,
      fighters: ['hero', 'companion'].map((character) => ({
        kind: { type: 'player', character, owner: wallet.address },
        settled: false,
      })),
    },
  } as HydratedFightCheckpoint
  const roster = {
    ...base,
    session: { ...base.session, characters: [{ id: 'hero' }, { id: 'companion' }] as CharacterRow[] },
    fight: { ...base.fight, mode: 'remote' as const, cached: { fight: checkpoint } },
  }
  const before = reduce_app_state(roster, { type: 'fight/checkpoint_confirmed', checkpoint })
  const combat = { ...checkpoint, contract: { ...checkpoint.contract, round: 1n } }
  const after = {
    ...before,
    fight: { ...before.fight, cached: { fight: combat } },
  }
  expect(analytics_events(after, before)).toEqual([]) // Speculative presentation is not execution.
  const confirmed = reduce_app_state(after, { type: 'fight/checkpoint_confirmed', checkpoint: combat })
  expect(analytics_events(confirmed, after)).toEqual([
    { name: 'fight_started', properties: { control: 'manual', fight_kind: 'world', party_size: 2 } },
  ])
  expect(reduce_app_state(confirmed, { type: 'fight/checkpoint_confirmed', checkpoint: combat })).toBe(confirmed)
  expect(analytics_events(after, after)).toEqual([])
  expect(analytics_events(after, { ...before, fight: { ...before.fight, cached: {} } })).toEqual([])
  expect(analytics_events({ ...after, session: { ...after.session, characters: [] } }, before)).toEqual([])
  expect(analytics_events({ ...after, fight: { ...after.fight, mode: 'local' } }, before)).toEqual([])
  const restored = reduce_app_state(roster, { type: 'fight/checkpoint_confirmed', checkpoint: combat })
  expect(analytics_events(restored, roster)).toEqual([])
})

test('remote analytics is absent from development, tests, editor and OAuth callbacks', () => {
  for (const mode of ['development', 'test']) expect(analytics_enabled(mode, '/', 'public')).toBe(false)
  for (const path of ['/enoki', '/enoki/', '/demo']) expect(analytics_enabled('production', path, 'public')).toBe(false)
  expect(analytics_enabled('production', '/', '')).toBe(false)
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

test('loading saved journey progress never replays quest completion analytics', () => {
  const app = connected_app()
  const before = app.store.getState()
  app.dispatch({
    type: 'journey/loaded',
    identity: before.journey.identity!,
    generation: before.journey.generation,
    completed: ['welcome'],
  })
  const loaded = app.store.getState()
  expect(analytics_events(loaded, before)).toEqual([])
  app.dispatch({ type: 'journey/completed', ids: ['hoe'] })
  const completed = app.store.getState()
  expect(analytics_events(completed, loaded)).toEqual([{ name: 'quest_completed', properties: { quest_id: 'hoe' } }])
  expect(analytics_events(completed, completed)).toEqual([])
})

test('the funded onboarding screen and the actual creation form are different milestones', () => {
  const app = connected_app()
  const before = app.store.getState()
  app.dispatch({ type: 'dialog/open', dialog: 'welcome' })
  const welcome = app.store.getState()
  expect(analytics_events(welcome, before)).toContainEqual({ name: 'character_creation_welcome_opened' })
  app.dispatch({ type: 'dialog/open', dialog: 'character_create' })
  expect(analytics_events(app.store.getState(), welcome)).toContainEqual({ name: 'character_creation_opened' })
})

test('the new property allowlist retains only bounded onboarding measurements', () => {
  expect(
    analytics_properties({
      duration_ms: 2000,
      stage: 'graphics',
      quest_id: 'equip',
      method: 'bridge',
      error: 'private error',
      toAddress: 'wallet',
      transactionHash: 'digest',
    })
  ).toEqual({ duration_ms: 2000, stage: 'graphics', quest_id: 'equip', method: 'bridge' })
})

test('a hidden or unavailable creation form never counts as an open', async () => {
  const { character_creation_surface } = await import('../src/modules/character_creation.ts')
  const { MAX_TRACKED_CHARACTERS } = await import('@aresrpg/protocol')
  const app = connected_app()
  const { session, navigation } = app.store.getState()
  const form = { ...navigation, page: 'world' as const, dialog: 'character_create' as const }
  expect(character_creation_surface(session, form)).toBe('character_create')
  expect(character_creation_surface({ ...session, wallet: null }, form)).toBeNull()
  expect(character_creation_surface(session, { ...form, page: 'encyclopedia' })).toBeNull()
  expect(
    character_creation_surface(
      { ...session, characters: Array.from({ length: MAX_TRACKED_CHARACTERS }, () => ({}) as never) },
      form
    )
  ).toBeNull()
})
