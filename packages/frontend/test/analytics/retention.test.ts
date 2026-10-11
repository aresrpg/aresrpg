// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import { analytics_event, analytics_properties } from '../../src/analytics.ts'
import { analytics_identity } from '../../src/analytics/context.ts'
import {
  engagement_activity,
  manually_moved,
  movement_sample,
  type MovementSample,
} from '../../src/analytics/activity.ts'
import { error_analytics, correlate_error } from '../../src/analytics/errors.ts'
import {
  create_replay_observer,
  replay_eligible,
  replay_properties,
  replay_sampled,
  REPLAY_CONFIG,
} from '../../src/analytics/replay.ts'
import { analytics_events } from '../../src/modules/analytics.ts'
import { create_app, reduce_app_state } from '../../src/store.ts'
import type { AuthSession } from '../../src/auth.ts'
import type { AppCopy } from '../../src/i18n/copy.ts'
import { character } from '../modules/automation_fixture.ts'

const wallet = { address: '0xabc' } as AuthSession
const connected = () => {
  const app = create_app()
  app.dispatch({ type: 'auth/connecting' })
  app.dispatch({ type: 'auth/connected', session: wallet })
  return app
}
const sample: MovementSample = { character: 'hero', world: 'nauvis', x: 0, z: 0, at_ms: 1_000, manual: true }

test('retention excludes idle, automatic movement, teleports, character switches and stale pose gaps', () => {
  const next = { ...sample, x: 5, at_ms: 2_000 }
  expect(manually_moved(sample, next)).toBe(true)
  for (const rejected of [
    { ...next, manual: false },
    { ...next, x: 0 },
    { ...next, x: 100 },
    { ...next, character: 'other' },
    { ...next, world: 'elsewhere' },
    { ...next, at_ms: 10_000 },
    { ...next, at_ms: 0 },
  ])
    expect(manually_moved(sample, rejected)).toBe(false)
  expect(manually_moved(null, next)).toBe(false)
  expect(manually_moved({ ...sample, manual: false }, next)).toBe(false)
  for (const name of [
    'transaction_executed',
    'site_visited',
    'login_completed',
    'job_level_gained',
    'equipment_changed',
  ])
    expect(engagement_activity(name)).toBeNull()
  expect(engagement_activity('gather_completed', { control: 'automatic' })).toBeNull()
  expect(engagement_activity('gather_completed', { control: 'manual' })).toBe('gathering')
})

test('movement and engagement are bounded independently, and activity from a previous account is ignored', () => {
  const app = connected()
  app.dispatch({ type: 'analytics/movement_sample', wallet, sample })
  const before = app.store.getState()
  app.dispatch({ type: 'analytics/movement_sample', wallet, sample: { ...sample, x: 5, at_ms: 2_000 } })
  expect(analytics_events(app.store.getState(), before)).toEqual([
    { name: 'movement_active', properties: { control: 'manual' } },
  ])
  const moved = app.store.getState()
  app.dispatch({ type: 'analytics/movement_sample', wallet, sample: { ...sample, x: 10, at_ms: 3_000 } })
  expect(analytics_events(app.store.getState(), moved)).toEqual([])
  app.dispatch({ type: 'analytics/activity_observed', wallet, activity: 'movement', at_ms: 2_000 })
  const active = app.store.getState()
  expect(analytics_events(active, moved)).toEqual([
    { name: 'gameplay_active', properties: { activity: 'movement', control: 'manual' } },
  ])
  app.dispatch({ type: 'analytics/activity_observed', wallet, activity: 'combat', at_ms: 3_000 })
  expect(app.store.getState()).toBe(active)
  app.dispatch({ type: 'auth/disconnected' })
  const logged_out = app.store.getState()
  app.dispatch({ type: 'analytics/identity_resolved', wallet, identity: 'late' })
  app.dispatch({ type: 'analytics/activity_observed', wallet, activity: 'combat', at_ms: 62_000 })
  expect(app.store.getState()).toBe(logged_out)
})

test('world readiness gates movement and only reports initial loading, failure and recovery once', () => {
  const app = connected()
  const hero = character()
  const baseline = app.store.getState()
  const ready = {
    ...baseline,
    session: { ...baseline.session, characters: [hero], selected_character_id: hero.id, link_status: 'ready' as const },
  }
  const pose = { character_id: hero.id, x: 0, y: 0, z: 0, yaw: 0, riding: false, time_of_day: 0, manual_movement: true }
  expect(movement_sample(ready, pose, 1_000, true)).toBeNull()
  const started = reduce_app_state(ready, {
    type: 'analytics/world_loading',
    wallet,
    world: hero.world!,
    stage: 'assets',
    at_ms: 1_000,
  })
  const failed = reduce_app_state(started, {
    type: 'analytics/world_loading',
    wallet,
    world: hero.world!,
    stage: 'failed',
    at_ms: 2_000,
  })
  expect(analytics_events(failed, started)).toEqual([{ name: 'world_load_failed', properties: { duration_ms: 1_000 } }])
  const playable = reduce_app_state(failed, {
    type: 'analytics/world_loading',
    wallet,
    world: hero.world!,
    stage: 'ready',
    at_ms: 4_000,
  })
  expect(analytics_events(playable, failed)).toEqual([{ name: 'world_playable', properties: { duration_ms: 3_000 } }])
  expect(movement_sample(playable, pose, 5_000, true)?.manual).toBe(true)
  expect(movement_sample(playable, pose, 5_000, false)).toBeNull()
  expect(movement_sample(playable, { ...pose, character_id: 'someone-else' }, 5_000, true)).toBeNull()
  expect(
    reduce_app_state(playable, {
      type: 'analytics/world_loading',
      wallet,
      world: hero.world!,
      stage: 'graphics',
      at_ms: 5_000,
    })
  ).toBe(playable)
})

test('account pseudonyms are stable across devices and case, and isolated by network', async () => {
  const first = await analytics_identity('mainnet', '0xAbC')
  expect(first).toMatch(/^player_[a-f0-9]{64}$/)
  expect(await analytics_identity('mainnet', '0xabc')).toBe(first)
  expect(await analytics_identity('testnet', '0xabc')).not.toBe(first)
  expect(await analytics_identity('mainnet', '0xdef')).not.toBe(first)
  expect(
    analytics_properties({
      $anon_distinct_id: 'anonymous',
      $user_id: first,
      $set: { $internal_or_test_user: true, name: 'private', address: 'private' },
      $set_once: { $initial_current_url: 'https://example.com/#private' },
    })
  ).toEqual({
    $anon_distinct_id: 'anonymous',
    $user_id: first,
    $set: { $internal_or_test_user: true },
  })
})

test('error correlation keeps the capture-time session without sending raw exceptions to analytics', () => {
  const event = correlate_error(
    {
      type: undefined,
      message: 'Failed to fetch https://example.com/#private',
      event_id: 'error-id',
      contexts: {
        telemetry: {
          posthog_distinct_id: 'original-player',
          posthog_session_id: 'original-session',
          onboarding_step: 'demo_equip',
        },
      },
    },
    { posthog_distinct_id: 'new-player', posthog_session_id: 'new-session' }
  )
  expect(event.tags?.posthog_session_id).toBe('original-session')
  expect(error_analytics(event, {})).toEqual({
    name: 'application_error',
    properties: {
      distinct_id: 'original-player',
      $session_id: 'original-session',
      onboarding_step: 'demo_equip',
      error_kind: 'network_failed',
      sentry_event_id: 'error-id',
    },
  })
  expect(error_analytics({ type: undefined, message: 'User rejected', event_id: 'not-sent-to-sentry' }, {})).toEqual({
    name: 'action_cancelled',
    properties: { error_kind: 'cancelled' },
  })
  expect(
    error_analytics({ type: undefined }, { originalException: new DOMException('cancelled', 'AbortError') })
  ).toBeNull()
})

test('replay never starts after an account transition while its code is loading', async () => {
  const calls: string[] = []
  let resolve!: () => void
  const loading = new Promise<void>((done) => {
    resolve = done
  })
  const observe = create_replay_observer(
    () => loading,
    () => calls.push('start'),
    () => calls.push('stop'),
    () => true
  )
  observe(true)
  observe(false)
  resolve()
  await loading
  expect(calls).toEqual(['stop'])
  expect(replay_eligible(connected().store.getState(), '/play-demo')).toBe(false)
  expect(REPLAY_CONFIG.maskCapturedNetworkRequestFn()).toBeNull()
  expect(REPLAY_CONFIG.maskAttributeFn('href', '/claim#private')).toBe('')
  expect(REPLAY_CONFIG.captureCanvas.recordCanvas).toBe(false)
  expect(replay_sampled('00000000-0000-0000-0000-000000000000')).toBe(true)
  expect(replay_sampled('ffffffff-ffff-ffff-ffff-ffffffffffff')).toBe(false)
  expect(
    replay_properties({
      $snapshot_data: [{ masked: true }],
      $session_id: 'session',
      $current_url: 'private',
      name: 'private',
    })
  ).toEqual({ $snapshot_data: [{ masked: true }], $session_id: 'session' })
})

test('feedback belongs to the stalled stage and can be answered only once', () => {
  const app = create_app()
  app.dispatch({ type: 'adventure/entered' })
  const base = { ...app.store.getState(), copy: {} as AppCopy }
  const available = reduce_app_state(base, { type: 'analytics/feedback_loaded', seen: false })
  expect(reduce_app_state(available, { type: 'analytics/feedback_offered', stage: 'funding' })).toBe(available)
  const offered = reduce_app_state(available, { type: 'analytics/feedback_offered', stage: 'demo_goblins' })
  expect(analytics_events(offered, available)).toContainEqual({
    name: 'onboarding_feedback_shown',
    properties: { onboarding_step: 'demo_goblins' },
  })
  const answered = reduce_app_state(offered, { type: 'analytics/feedback_answered', answer: 'controls' })
  expect(analytics_events(answered, offered)).toEqual([
    { name: 'onboarding_feedback', properties: { onboarding_step: 'demo_goblins', answer: 'controls' } },
  ])
  expect(reduce_app_state(answered, { type: 'analytics/feedback_answered', answer: 'funding' })).toBe(answered)
})

test('identity envelope updates retain only the internal marker at the root and nested levels', () => {
  const event = analytics_event({
    uuid: 'event',
    event: '$identify',
    properties: {
      distinct_id: 'player',
      $anon_distinct_id: 'anonymous',
      $set_once: { $initial_current_url: 'https://example.org/#bearer' },
    },
    $set: { $internal_or_test_user: true, name: 'private-name' },
    $set_once: { $initial_current_url: 'https://example.org/#bearer' },
  })
  expect(event).toEqual({
    uuid: 'event',
    event: '$identify',
    properties: {
      distinct_id: 'player',
      $anon_distinct_id: 'anonymous',
    },
    $set: { $internal_or_test_user: true },
  })
})

test('canonical fight completion is monotonic and missing timing is not reported as zero duration', async () => {
  const { observe_fight } = await import('../../src/analytics/fights.ts')
  const app = connected()
  const checkpoint = {
    contract: {
      id: 'fight',
      round: 0n,
      turn_ptr: 0n,
      turn_started_ms: 100n,
      queue: [0n],
      ended: false,
      started_ms: null,
      ended_ms: null,
      winner: null,
      fighters: [{ team: 0n, kind: { type: 'player', owner: wallet.address, character: 'hero' } }],
    },
  } as unknown as import('@aresrpg/fight').HydratedFightCheckpoint
  app.dispatch({ type: 'fight/checkpoint_confirmed', checkpoint })
  const combat = { ...checkpoint, contract: { ...checkpoint.contract, round: 1n, started_ms: 100n } }
  app.dispatch({ type: 'fight/checkpoint_confirmed', checkpoint: combat })
  const before = app.store.getState()
  const ended = { ...combat, contract: { ...combat.contract, ended: true, winner: 0n, ended_ms: 500n } }
  app.dispatch({ type: 'fight/checkpoint_confirmed', checkpoint: ended })
  const complete = app.store.getState()
  expect(analytics_events(complete, before)).toEqual([
    {
      name: 'fight_completed',
      properties: {
        control: 'manual',
        fight_kind: 'world',
        party_size: 1,
        outcome: 'victory',
        rounds: 1,
        duration_ms: 400,
      },
    },
  ])
  app.dispatch({ type: 'fight/checkpoint_confirmed', checkpoint: combat })
  expect(app.store.getState()).toBe(complete)
  const unknown = observe_fight(complete, { ...ended, contract: { ...ended.contract, ended_ms: null } })!
  expect(unknown.duration_ms).toBeNull()
  expect(analytics_properties(unknown)).not.toHaveProperty('duration_ms')
})

test('manual crafting remains meaningful while a different character gathers automatically', async () => {
  const { analytics_context } = await import('../../src/analytics/context.ts')
  const base = connected().store.getState()
  const before = {
    ...base,
    automation: {
      ...base.automation,
      run: {
        id: 'run',
        character_id: 'gatherer',
        world: 'nauvis',
        item_type: 'wheat',
        scope: { type: 'world' as const },
        visited: {},
        step: { type: 'planning' as const },
      },
    },
  }
  const after = {
    ...before,
    session: {
      ...before.session,
      craft_result: {
        digest: 'craft',
        job: 'HANDYMAN',
        output_type: 'old_hoe',
        attempts: 1,
        successes: 1,
      },
    },
  }
  const event = analytics_events(after, before).find(({ name }) => name === 'craft_completed')!
  expect(event.properties).toMatchObject({ job: 'HANDYMAN', control: 'manual' })
  expect(engagement_activity(event.name, event.properties)).toBe('crafting')
  expect(analytics_context(after).automation_active).toBe(true)
  expect(analytics_context(after)).not.toHaveProperty('control')
})
