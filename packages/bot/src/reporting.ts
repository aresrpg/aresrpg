// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { init, type ErrorEvent } from '@sentry/bun'

import { PLANNING_FAULT } from './planning_failure.ts'

// Telemetry drain only; it never extends a gameplay lease or transaction admission.
const REPORT_FLUSH_MS = 2000
/** Only a planning fault carries an operation, and every value in it is ours. */
const operation_of = (error: unknown): Readonly<Record<string, string | number>> =>
  error instanceof Error && error.message === PLANNING_FAULT && 'operation' in error
    ? (error.operation as Readonly<Record<string, string | number>>)
    : {}
const safe_stack = (error: unknown) => {
  if (!(error instanceof Error)) return []
  return (error.stack ?? '')
    .split('\n')
    .slice(1)
    .flatMap((line) => {
      const frame = /\/(?:packages\/bot\/src\/|app\/)([a-z_]+\.(?:ts|js)):(\d+):(\d+)/.exec(line)
      return frame ? [{ filename: `bot/${frame[1]}`, lineno: Number(frame[2]), colno: Number(frame[3]) }] : []
    })
    .toReversed()
}
const safe_failure_event = (error: unknown): ErrorEvent => {
  const context = operation_of(error)
  const code = Object.keys(context).length ? PLANNING_FAULT : 'hosted_operation_internal_error'
  return {
    type: undefined,
    level: 'error',
    message: code,
    exception: { values: [{ type: 'HostedOperationError', value: code, stacktrace: { frames: safe_stack(error) } }] },
    contexts: { operation: context },
    tags: { service: 'hosted-bot' },
  }
}
/** Only our explicit event fields leave the trusted wallet service; SDK ambient context is discarded. */
const outbound_event = (event: ErrorEvent): ErrorEvent => ({
  type: undefined,
  event_id: event.event_id,
  timestamp: event.timestamp,
  level: 'error',
  message: event.message,
  exception: event.exception,
  contexts: { operation: event.contexts?.operation ?? {} },
  tags: { service: 'hosted-bot' },
  environment: event.environment,
  release: event.release,
})
export const create_reporting = (
  env: Readonly<Record<string, string | undefined>>,
  transport?: NonNullable<Parameters<typeof init>[0]>['transport'],
  log: (message: string) => void = console.error
) => {
  const client = env.BOT_SENTRY_DSN
    ? init({
        dsn: env.BOT_SENTRY_DSN,
        environment: env.BOT_DEPLOY_ENV,
        release: env.BOT_RELEASE,
        defaultIntegrations: false,
        integrations: [],
        enableOpenTelemetrySetup: false,
        dataCollection: {
          userInfo: false,
          cookies: false,
          httpHeaders: false,
          httpBodies: [],
          urlQueryParams: false,
          graphQL: { document: false, variables: false },
          genAI: { inputs: false, outputs: false },
          mcp: { inputs: false, outputs: false },
          databaseQueryData: false,
          queues: false,
          stackFrameVariables: false,
        },
        beforeSendLog: () => null,
        beforeSendMetric: () => null,
        traceLifecycle: 'static',
        beforeSendTransaction: () => null,
        maxBreadcrumbs: 0,
        sendClientReports: false,
        beforeSend: outbound_event,
        ...(transport ? { transport } : {}),
      })
    : undefined
  const reported = new WeakSet<object>()
  const report_failure = (error: unknown) => {
    if (error instanceof Error && reported.has(error)) return
    if (error instanceof Error) reported.add(error)
    const event = safe_failure_event(error)
    log(JSON.stringify({ code: event.message, context: event.contexts?.operation }))
    client?.captureEvent(event)
  }
  return {
    report_failure,
    flush: async () => {
      if (client && !(await client.flush(REPORT_FLUSH_MS))) log('hosted_reporting_flush_incomplete')
    },
  }
}
