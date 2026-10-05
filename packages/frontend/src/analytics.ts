// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import posthog from 'posthog-js'

import { env } from './env.ts'
import { report_error } from './reporting.ts'

export const DEMO_VERSION = 3
export type AnalyticsEvent = Readonly<{ name: string; properties?: Readonly<Record<string, string | number>> }>
export type AnalyticsCapture = (event: string, properties?: Readonly<Record<string, string | number>>) => void

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
  'quest_id',
  'journey_step',
  'attempts',
  'successes',
  'output_type',
  'gas_mist',
])

export const analytics_properties = (properties: Readonly<Record<string, unknown>>): Record<string, unknown> =>
  Object.fromEntries(Object.entries(properties).filter(([key]) => SAFE_PROPERTIES.has(key)))

export const analytics_enabled = (mode: string, pathname: string, token: string): boolean =>
  mode === 'production' && token.length > 0 && !['/enoki', '/demo'].includes(pathname.replace(/\/+$/, ''))

const enabled = (): boolean =>
  analytics_enabled(import.meta.env?.MODE ?? 'test', globalThis.location?.pathname ?? '/', env.posthog_project_token)

export const capture_analytics = (event: string, properties: Readonly<Record<string, string | number>> = {}): void => {
  if (!enabled()) return
  try {
    posthog.capture(event, { ...properties, network: env.network, demo_version: DEMO_VERSION })
  } catch (error) {
    report_error(error, { area: 'analytics' })
  }
}

export const init_analytics = (): void => {
  if (!enabled()) return
  posthog.init(env.posthog_project_token, {
    api_host: '/ingest',
    ui_host: 'https://us.posthog.com',
    persistence: 'localStorage',
    person_profiles: 'never',
    autocapture: false,
    rageclick: false,
    capture_pageview: false,
    capture_pageleave: false,
    capture_dead_clicks: false,
    capture_performance: false,
    capture_exceptions: false,
    disable_session_recording: true,
    disable_surveys: true,
    disable_external_dependency_loading: true,
    advanced_disable_flags: true,
    save_referrer: false,
    save_campaign_params: false,
    disable_capture_url_hashes: true,
    store_google: false,
    before_send: (event) => (event ? { ...event, properties: analytics_properties(event.properties) } : null),
  })
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
