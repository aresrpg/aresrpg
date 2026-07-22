// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// ─────────────────────────────────────────────────────────────────────────────
//  report.js — the server-side error-reporting choke (mirrors
//  packages/frontend/src/core/report.js / docs/ERRORS.md's convention, ported
//  server-side): hard no-op without SENTRY_DSN, ONE report_error(err, context) choke
//  for explicit capture at this service's catch seams.
// ─────────────────────────────────────────────────────────────────────────────
//  @sentry/node — not @sentry/bun (still beta as of this writing, depends on
//  @sentry/node internally plus extra bundler/server-utils packages, and defaults to
//  auto-instrumenting Bun.serve with tracing/transactions we don't want). @sentry/node
//  is stable, lighter, and — for api/sponsor.mjs specifically — the only choice
//  correct in BOTH its runtimes (the Vercel Node serverless function AND the
//  standalone Bun container). See the PR description for the fuller comparison.
//
//  UNCAUGHT/UNHANDLED: unlike the frontend (which drops Sentry's GlobalHandlers to
//  wire window.onerror/unhandledrejection itself, for the breadcrumb pairing), this
//  module keeps @sentry/node's DEFAULT onUncaughtException/onUnhandledRejection
//  integrations as-is. They already capture the event AND preserve this process's
//  existing crash semantics (an uncaught exception still fatal-exits after an
//  attempted flush, matching today's no-Sentry default; an unhandled rejection still
//  just warns, never exits) — there is nothing to add on top, so a second hand-rolled
//  process.on() choke here would only double-report the same event.
//
//  ERRORS-ONLY by construction: tracesSampleRate 0, no profiling integration.
//  Init is a hard NO-OP without a DSN, so a bare boot never phones home.

import * as Sentry from '@sentry/node'

const RELEASE = process.env.RELEASE_SHA ?? 'dev'

let live = false

/** Is Sentry initialised? (report_error is a hard no-op until then.) */
export function is_reporting_live() {
  return live
}

/**
 * Initialise Sentry — a hard no-op without a DSN (SENTRY_DSN env; absent by default,
 * so a bare boot never phones home). Tests pass an explicit config (dsn + an injected
 * capturing transport) so nothing hits a real DSN.
 * @param {{ dsn?: string, environment?: string, release?: string, transport?: any }} [config]
 */
export function init_reporting(config = {}) {
  const dsn = config.dsn ?? process.env.SENTRY_DSN ?? ''
  if (!dsn) return false // no DSN ⇒ never init — nothing phones home
  Sentry.init({
    dsn,
    environment: config.environment ?? process.env.NETWORK ?? 'testnet',
    release: config.release ?? RELEASE,
    tracesSampleRate: 0, // ERRORS-ONLY (docs/ERRORS.md) — never tracing, never profiling
    ...(config.transport ? { transport: config.transport } : {}),
  })
  live = true
  return true
}

/**
 * THE single place an explicit server-side catch becomes a Sentry event. No-op until
 * Sentry is live.
 * @param {unknown} err the raw machine error
 * @param {{ area?: string, action?: string, fingerprint?: string[], [k: string]: unknown }} [context]
 *   structured tags/context — `area` + `action` are promoted to Sentry tags;
 *   `fingerprint` controls grouping; the rest rides as the `service` context blob.
 */
export function report_error(err, context = {}) {
  if (!live) return
  const { area, action, fingerprint, ...rest } = context
  Sentry.withScope((scope) => {
    scope.setContext('service', { ...(area ? { area } : {}), ...(action ? { action } : {}), ...rest })
    if (area) scope.setTag('area', area)
    if (action) scope.setTag('action', action)
    if (fingerprint) scope.setFingerprint(fingerprint)
    Sentry.captureException(err)
  })
}
