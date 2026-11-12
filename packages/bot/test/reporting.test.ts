// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import { close, getClient as get_client } from '@sentry/bun'

import { create_reporting, safe_failure_event } from '../src/reporting.ts'
import { shutdown_service } from '../src/service_runtime.ts'

test('reporting defaults to local safe codes and never borrows frontend configuration', async () => {
  const logs: string[] = []
  let sends = 0
  const reporter = create_reporting(
    { VITE_SENTRY_DSN: 'https://public@example.com/1' },
    () => ({
      send: async () => {
        sends++
        return {}
      },
      flush: async () => true,
    }),
    (message) => logs.push(message)
  )
  const error = new Error('Bearer secret private wallet material')
  reporter.report_failure(error)
  reporter.report_failure(error)
  await reporter.flush()
  expect(sends).toBe(0)
  expect(logs).toEqual(['{"code":"hosted_operation_internal_error","context":{}}'])
})
test('explicit SDK transport receives only safe allowlisted diagnostics once', async () => {
  const envelopes: unknown[] = []
  const logs: string[] = []
  const reporter = create_reporting(
    { BOT_SENTRY_DSN: 'https://public@example.com/1', BOT_DEPLOY_ENV: 'test', BOT_RELEASE: 'fixture' },
    () => ({
      send: async (envelope) => {
        envelopes.push(envelope)
        return {}
      },
      flush: async () => true,
    }),
    (message) => logs.push(message)
  )
  const client = get_client()!
  expect(client.getOptions().integrations).toEqual([])
  const error = new Error(
    'run_planning_internal_error ' +
      JSON.stringify({
        kind: 'behavior',
        run_id: 'run-1',
        revision: 2,
        type: 'TypeError',
        secret: 'DO_NOT_SEND',
      })
  )
  reporter.report_failure(error)
  reporter.report_failure(error)
  await reporter.flush()
  expect(envelopes).toHaveLength(1)
  const payload = JSON.stringify(envelopes)
  expect(payload).toContain('run_planning_internal_error')
  expect(payload).toContain('run-1')
  expect(payload).not.toContain('DO_NOT_SEND')
  expect(payload).not.toContain('server_name')
  expect(payload).not.toContain('breadcrumbs')
  expect(logs).toHaveLength(1)
  await close(2000)
})
test('malformed and non-primitive diagnostic context cannot escape the allowlist', () => {
  expect(safe_failure_event(new Error('run_planning_internal_error bad json')).message).toBe(
    'hosted_operation_internal_error'
  )
  const event = safe_failure_event(
    new Error(
      'run_planning_internal_error ' +
        JSON.stringify({
          kind: ['behavior'],
          type: ['Error'],
          run_id: 'Bearer secret',
          revision: -1,
          headers: { authorization: 'secret' },
        })
    )
  )
  expect(event.contexts?.operation).toEqual({})
  expect(JSON.stringify(event)).not.toContain('secret')
})
test('safe frames preserve bot source coordinates without original paths or messages', () => {
  const error = new Error('DO_NOT_SEND')
  error.stack =
    'Error: DO_NOT_SEND\n at worker (/private/owner/packages/bot/src/actor.ts:12:4)\n at other (/private/owner/secret.ts:1:2)'
  const event = safe_failure_event(error)
  expect(event.exception?.values?.[0]?.stacktrace?.frames).toEqual([{ filename: 'bot/actor.ts', lineno: 12, colno: 4 }])
  expect(JSON.stringify(event)).not.toContain('/private/owner')
  expect(JSON.stringify(event)).not.toContain('DO_NOT_SEND')
})
test('existing shutdown reports failures then drains telemetry before returning', async () => {
  const order: string[] = []
  await shutdown_service({
    server: {
      stop: async () => {
        throw new Error('fixture')
      },
    },
    stop: async () => {},
    redis: {
      close: () => {
        order.push('redis')
      },
    },
    report_failure: () => {
      order.push('reported')
    },
    flush_reporting: async () => {
      order.push('flushed')
    },
  })
  expect(order).toEqual(['redis', 'reported', 'flushed'])
})
