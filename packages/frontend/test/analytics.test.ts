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

test('tutorial quests complete only after all rewards are confirmed', async () => {
  const { create_fight_state } = await import('@aresrpg/fight')
  const { adventure_fight_setup } = await import('../src/adventure/fight_setup.ts')
  const { natural_slot_for, stage_equip } = await import('../src/characters/equipment_stage.ts')
  const { ADVENTURE_INVENTORY } = await import('../src/adventure/projection.ts')
  const app = create_app()
  app.dispatch({ type: 'adventure/entered' })
  app.dispatch({ type: 'adventure/challenge' })
  const fighting = app.store.getState()
  const checkpoint = create_fight_state(adventure_fight_setup(fighting.adventure.character!, 0))
  app.dispatch({
    type: 'adventure/settled',
    checkpoint: { ...checkpoint, contract: { ...checkpoint.contract, ended: true, winner: 0n, ended_ms: 10_000n } },
  })
  const rewarded = app.store.getState()
  expect(analytics_events(rewarded, fighting)).toContainEqual({
    name: 'demo_fight_completed',
    properties: { encounter: 1, outcome: 'victory' },
  })
  expect(analytics_events(rewarded, fighting)).toContainEqual({
    name: 'demo_quest_completed',
    properties: { quest_id: 'goblins' },
  })
  const hat = ADVENTURE_INVENTORY.find(({ category }) => category === 'hat')!
  app.dispatch({ type: 'adventure/equipment_changed', equipment: stage_equip({}, hat, 'hat') })
  const equipped = app.store.getState()
  expect(analytics_events(equipped, rewarded)).toEqual([])
  const equipment = ADVENTURE_INVENTORY.reduce(
    (equipment, item) => stage_equip(equipment, item, natural_slot_for(item, equipment)!),
    {}
  )
  app.dispatch({ type: 'adventure/equipment_changed', equipment })
  const confirmed = app.store.getState()
  expect(analytics_events(confirmed, equipped)).toEqual([
    { name: 'demo_quest_completed', properties: { quest_id: 'equip' } },
  ])
  app.dispatch({ type: 'adventure/equipment_changed', equipment })
  expect(analytics_events(app.store.getState(), confirmed)).toEqual([])
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

test('each of the three tutorial fights keeps its encounter number on start and completion', () => {
  const app = create_app()
  app.dispatch({ type: 'adventure/entered' })
  const base = app.store.getState()
  for (const encounter of [0, 1, 2]) {
    const before = { ...base, adventure: { ...base.adventure, encounter } }
    const started = { ...before, adventure: { ...before.adventure, phase: 'fighting' as const } }
    const completed = { ...started, adventure: { ...started.adventure, phase: 'reward' as const } }
    expect(analytics_events(started, before).filter(({ name }) => name === 'demo_fight_started')).toEqual([
      { name: 'demo_fight_started', properties: { encounter: encounter + 1 } },
    ])
    expect(analytics_events(completed, started).filter(({ name }) => name === 'demo_fight_completed')).toEqual([
      { name: 'demo_fight_completed', properties: { encounter: encounter + 1, outcome: 'defeat' } },
    ])
  }
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
