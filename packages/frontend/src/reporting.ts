// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { captureException as capture_exception, init, type ErrorEvent, type EventHint } from '@sentry/react'
import type { ErrorInfo } from 'react'

import { reporting_config } from './reporting_config.ts'

export type ReportContext = Readonly<Record<string, string | number | boolean | null | undefined>>

const PRIVATE_FIELDS =
  /^(?:authorization|cookie|cookies|headers|password|signature|private_key|secret_key|access_token|id_token|refresh_token)$/i

const redact_text = (text: string): string =>
  text
    .replace(/\beyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}(?:\.[A-Za-z0-9_-]*)?/g, '[jwt]')
    .replace(/\bsuiprivkey1[a-z0-9]+/gi, '[private-key]')
    .replace(/\bBearer\s+[^\s"']+/gi, 'Bearer [redacted]')
    .replace(/((?:https?:\/\/|\/)[^\s"'<>?#]*)[?#][^\s"'<>]*/g, '$1')

/** Scrub the entire outbound payload, including linked causes and automatic breadcrumbs. */
export const scrub_report = (value: unknown): unknown => {
  if (typeof value === 'string') return redact_text(value)
  if (Array.isArray(value)) return value.map(scrub_report)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !PRIVATE_FIELDS.test(key))
      .map(([key, entry]) => [key, scrub_report(entry)])
  )
}

export const before_send = (event: Readonly<ErrorEvent>, hint: Readonly<EventHint>): ErrorEvent | null => {
  const original = hint.originalException
  if (original instanceof Error && original.name === 'AbortError') return null
  const messages = [event.message, ...(event.exception?.values ?? []).map(({ value }) => value)].join('\n')
  if (/user rejected|user denied|user cancel(?:l)?ed|ResizeObserver loop/i.test(messages)) return null
  const abort = /abort code:\s*(\d+),\s*in\s*['"](0x[a-f0-9]+)::([a-z0-9_]+)::([a-z0-9_]+)/i.exec(messages)
  const clean = scrub_report(event) as ErrorEvent
  return abort ? { ...clean, fingerprint: ['move-abort', abort[2]!, abort[3]!, abort[4]!, abort[1]!] } : clean
}

export const init_reporting = (
  source: Readonly<Record<string, string | undefined>> = import.meta.env ?? {},
  transport?: Parameters<typeof init>[0]['transport']
): void => {
  const config = reporting_config(source)
  if (!config.enabled) {
    if (source.MODE === 'production' && !config.dsn)
      console.warn('Error reporting is disabled: VITE_SENTRY_DSN is missing.')
    return
  }
  init({
    ...config,
    sendDefaultPii: false,
    beforeSend: before_send,
    // No session analytics or console breadcrumbs containing wallet/session objects.
    integrations: (defaults) => defaults.filter(({ name }) => !['Breadcrumbs', 'BrowserSession'].includes(name)),
    ...(transport ? { transport } : {}),
  })
}

export const report_error = (error: unknown, context: ReportContext = {}): void => {
  console.error('Application error.', error, context)
  capture_exception(error instanceof Error ? error : new Error(String(error)), {
    contexts: { application: context },
  })
}

const report_react_error = (error: unknown, info: Readonly<ErrorInfo>): void =>
  report_error(error, { area: 'react', component_stack: info.componentStack ?? '' })

export const react_error_handlers = Object.freeze({
  onCaughtError: report_react_error,
  onUncaughtError: report_react_error,
  onRecoverableError: report_react_error,
})
