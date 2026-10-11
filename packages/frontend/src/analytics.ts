// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import posthog, { type CaptureResult } from 'posthog-js'

import { env } from './env.ts'
import type { AnalyticsProperties } from './analytics/context.ts'
import { REPLAY_CONFIG, replay_properties } from './analytics/replay.ts'

export const DEMO_VERSION = 3
export const ANALYTICS_VERSION = 2
export type AnalyticsEvent = Readonly<{ name: string; properties?: AnalyticsProperties }>
export type AnalyticsCapture = (event: string, properties?: AnalyticsProperties) => void

// A lifecycle-bound reader, not a synchronized copy of app state.
const context_source: { read: () => AnalyticsProperties } = { read: () => ({}) }
export const bind_analytics_context = (read: () => AnalyticsProperties): (() => void) => {
  // eslint-disable-next-line functional/immutable-data -- Explicit installation of the telemetry lifecycle reader.
  context_source.read = read
  return () => {
    // eslint-disable-next-line functional/immutable-data -- Dispose only this observer's binding.
    if (context_source.read === read) context_source.read = () => ({})
  }
}

// Deliberately allowlist fields: SDK URL/referrer/person defaults must never leak claim bearers.
const SAFE_PROPERTIES = new Set([
  'distinct_id',
  '$device_id',
  '$session_id',
  '$window_id',
  '$lib',
  '$lib_version',
  '$browser',
  '$browser_version',
  '$os',
  '$os_version',
  '$device_type',
  '$screen_height',
  '$screen_width',
  '$viewport_height',
  '$viewport_width',
  '$insert_id',
  '$process_person_profile',
  '$is_identified',
  '$anon_distinct_id',
  '$user_id',
  '$time',
  'token',
  'network',
  'locale',
  'encounter',
  'outcome',
  'method',
  'surface',
  'demo_version',
  'duration_ms',
  'stage',
  'onboarding_step',
  'quest_id',
  'journey_step',
  'attempts',
  'successes',
  'output_type',
  'gas_mist',
  'analytics_version',
  'release',
  'deployment',
  'authenticated',
  'is_internal',
  'control',
  'automation_active',
  'quality',
  'activity',
  'job',
  'level_before',
  'level_after',
  'quantity',
  'fight_kind',
  'rounds',
  'party_size',
  'reason',
  'error_kind',
  'sentry_event_id',
  'answer',
])

export const analytics_properties = (properties: Readonly<Record<string, unknown>>): Record<string, unknown> =>
  Object.fromEntries([
    ...Object.entries(properties).filter(
      ([key, value]) => SAFE_PROPERTIES.has(key) && ['string', 'number', 'boolean'].includes(typeof value)
    ),
    ...(['$set', '$set_once'] as const).flatMap((key) => {
      const value = properties[key]
      const internal = value && typeof value === 'object' ? Reflect.get(value, '$internal_or_test_user') : undefined
      return typeof internal === 'boolean' ? [[key, { $internal_or_test_user: internal }]] : []
    }),
  ])

/** Identify events carry person updates at the envelope root, outside ordinary properties. */
export const analytics_event = (capture: Readonly<CaptureResult> | null): CaptureResult | null => {
  if (!capture) return null
  const { uuid, event, properties, timestamp, $set, $set_once } = capture
  return {
    uuid,
    event,
    ...(timestamp ? { timestamp } : {}),
    ...analytics_properties({ $set, $set_once }),
    properties: event === '$snapshot' ? replay_properties(properties) : analytics_properties(properties),
  }
}

export const analytics_enabled = (mode: string, pathname: string, token: string): boolean =>
  mode === 'production' && token.length > 0 && !['/enoki', '/demo'].includes(pathname.replace(/\/+$/, ''))

export const analytics_available = (): boolean =>
  analytics_enabled(import.meta.env?.MODE ?? 'test', globalThis.location?.pathname ?? '/', env.posthog_project_token)

const shared_properties = (): AnalyticsProperties => ({
  surface: globalThis.location?.pathname === '/play-demo' ? 'demo' : 'game',
  onboarding_step: 'boot',
  authenticated: false,
  ...context_source.read(),
  network: env.network,
  demo_version: DEMO_VERSION,
  analytics_version: ANALYTICS_VERSION,
  release: import.meta.env?.VITE_RELEASE ?? 'local',
  deployment: import.meta.env?.VITE_DEPLOY_ENV ?? 'local',
})

export const reporting_analytics_context = (): AnalyticsProperties => {
  if (!analytics_available()) return {}
  try {
    return {
      ...shared_properties(),
      posthog_distinct_id: posthog.get_distinct_id(),
      posthog_session_id: posthog.get_session_id(),
    }
  } catch (error) {
    console.error('Analytics context is unavailable.', error)
    return {}
  }
}

const run_analytics = (effect: () => void): void => {
  if (!analytics_available()) return
  try {
    effect()
  } catch (error) {
    // Reporting failures cannot recursively generate analytics failures.
    console.error('Analytics operation failed.', error)
  }
}

export const identify_analytics = (identity: string, internal: boolean): void =>
  run_analytics(() => posthog.identify(identity, { $internal_or_test_user: internal }))

export const reset_analytics_identity = (): void => run_analytics(() => posthog.reset())

export const capture_analytics: AnalyticsCapture = (event, properties = {}) =>
  run_analytics(() => {
    posthog.capture(event, { ...shared_properties(), ...properties })
  })

export const init_analytics = (): void => {
  if (!analytics_available()) return
  posthog.init(env.posthog_project_token, {
    api_host: '/ingest',
    ui_host: 'https://us.posthog.com',
    persistence: 'localStorage',
    person_profiles: 'identified_only',
    autocapture: false,
    rageclick: false,
    capture_pageview: false,
    capture_pageleave: false,
    capture_dead_clicks: false,
    capture_performance: false,
    enable_recording_console_log: false,
    capture_exceptions: false,
    disable_session_recording: true,
    session_recording: REPLAY_CONFIG,
    disable_surveys: true,
    disable_external_dependency_loading: true,
    advanced_disable_feature_flags: true,
    advanced_disable_feature_flags_on_first_load: true,
    disable_conversations: true,
    disable_product_tours: true,
    save_referrer: false,
    save_campaign_params: false,
    disable_capture_url_hashes: true,
    store_google: false,
    before_send: analytics_event,
  })
  // A restored login will identify again. Pre-login events must not inherit a previous account.
  if (posthog.get_property('$user_id')) posthog.reset()
  const demo = globalThis.location.pathname.replace(/\/+$/, '') === '/play-demo'
  capture_analytics('site_visited', { surface: demo ? 'demo' : 'game' })
  if (demo) capture_analytics('demo_requested')
}

/** Boot failures occur before the adventure observer can mount; never send raw exception text. */
export const capture_demo_boot_failure = (stage: 'entry' | 'boot'): void => {
  if (globalThis.location?.pathname.replace(/\/+$/, '') !== '/play-demo') return
  capture_analytics('demo_load_failed', {
    stage,
    duration_ms: Math.round(performance.now()),
  })
}
