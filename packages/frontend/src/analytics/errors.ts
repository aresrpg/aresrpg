// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { ErrorEvent, EventHint } from '@sentry/react'

import type { AnalyticsEvent } from '../analytics.ts'

import type { AnalyticsProperties } from './context.ts'

/** Raw exception text stays in Sentry. Product analytics gets a finite failure taxonomy. */
const ERROR_KINDS = [
  [/user rejected|user denied|user cancel(?:l)?ed/i, 'cancelled'],
  [/webgpu_unavailable|Unable to create WebGPU adapter/i, 'graphics_unsupported'],
  [/webgpu|device.lost|GPUDevice/i, 'graphics_failed'],
  [/terrain_failed/i, 'terrain_failed'],
  [
    /gas coin|no valid gas|insufficientgas|gasbalancetoolow|gas selection.*insufficient sui balance/i,
    'insufficient_funds',
  ],
  [/outcome unknown|previous transaction.*not yet visible/i, 'transaction_uncertain'],
  [/failed on-chain/i, 'transaction_failed'],
  [/NOT submitted|MoveAbort|abort code:/i, 'transaction_rejected'],
  [/Failed to fetch|Load failed|NetworkError|network request/i, 'network_failed'],
] as const
export const error_kind = (message: string, name = ''): string =>
  ERROR_KINDS.find(([pattern]) => pattern.test(message))?.[1] ??
  (name === 'LocalizedError' ? 'expected_refusal' : 'application_failed')

export const exception_message = (event: Readonly<ErrorEvent>): string =>
  [event.message, ...(event.exception?.values ?? []).map(({ value }) => value)].join('\n')

const event_identity = (context: AnalyticsProperties): AnalyticsProperties =>
  Object.fromEntries(
    [
      ['distinct_id', context.posthog_distinct_id],
      ['$session_id', context.posthog_session_id],
    ].filter((entry): entry is [string, string] => typeof entry[1] === 'string')
  )

export const error_analytics = (event: Readonly<ErrorEvent>, hint: Readonly<EventHint>): AnalyticsEvent | null => {
  const name = hint.originalException instanceof Error ? hint.originalException.name : ''
  if (name === 'AbortError') return null
  const message = exception_message(event)
  if (/ResizeObserver loop/i.test(message)) return null
  const kind = error_kind(message, name)
  const context = (event.contexts?.telemetry ?? {}) as AnalyticsProperties
  const { posthog_distinct_id, posthog_session_id, ...properties } = context
  return {
    name: kind === 'cancelled' ? 'action_cancelled' : 'application_error',
    properties: {
      ...properties,
      ...event_identity({ posthog_distinct_id, posthog_session_id }),
      error_kind: kind,
      ...(kind !== 'cancelled' && event.event_id ? { sentry_event_id: event.event_id } : {}),
    },
  }
}

export const correlate_error = (event: Readonly<ErrorEvent>, context: AnalyticsProperties): ErrorEvent => {
  const telemetry = event.contexts?.telemetry ?? context
  const identity = telemetry.posthog_distinct_id
  return {
    ...event,
    ...(typeof identity === 'string' ? { user: { id: identity } } : {}),
    contexts: { ...event.contexts, telemetry },
    tags: {
      ...event.tags,
      ...Object.fromEntries(
        Object.entries(telemetry).flatMap(([key, value]) =>
          [
            'posthog_distinct_id',
            'posthog_session_id',
            'onboarding_step',
            'journey_step',
            'surface',
            'analytics_version',
          ].includes(key) &&
          (typeof value === 'string' || typeof value === 'number')
            ? [[key, value]]
            : []
        )
      ),
    },
  }
}
