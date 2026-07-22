// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// report.js unit + headless boot proof. NO network ever: init uses a FAKE DSN + an
// injected capturing transport (the Sentry client hands every outbound envelope to
// it — asserting on those IS asserting the send was attempted).
import { describe, expect, it } from 'bun:test'

import { init_reporting, report_error, is_reporting_live } from './report.js'

describe('init + the headless envelope proof (fake DSN, captured transport — never the real DSN)', () => {
  /** @type {any[]} every envelope the armed client attempts to send */
  const sent = []
  const transport = () => ({
    send: async (envelope) => {
      sent.push(envelope)
      return {}
    },
    flush: async () => true,
  })
  const sent_events = () =>
    sent
      .flatMap(([, items]) => items)
      .filter(([h]) => h.type === 'event')
      .map(([, p]) => p)

  it('init without a DSN is a hard no-op', () => {
    expect(is_reporting_live()).toBe(false)
    expect(init_reporting({ dsn: '' })).toBe(false)
    expect(is_reporting_live()).toBe(false)
    expect(() => report_error(new Error('before init — must no-op'))).not.toThrow()
    expect(sent_events().length).toBe(0)
  })

  it('a forced error attempts an outbound envelope carrying area/action tags + context', async () => {
    expect(
      init_reporting({
        dsn: 'https://public@fake.ingest.example/1',
        environment: 'test',
        release: 'test-sha',
        transport,
      })
    ).toBe(true)
    expect(is_reporting_live()).toBe(true)

    const boom = new Error('forced test error')
    report_error(boom, {
      area: 'suins',
      action: 'forward_resolve',
      fingerprint: ['rpc-api', 'suins-forward'],
      name: 'alice.sui',
    })

    const Sentry = await import('@sentry/node')
    await Sentry.flush(2000)

    const events = sent_events()
    expect(events.length).toBe(1)
    const [event] = events
    expect(event.exception.values[0].value).toBe('forced test error')
    expect(event.environment).toBe('test')
    expect(event.release).toBe('test-sha')
    expect(event.tags.area).toBe('suins')
    expect(event.tags.action).toBe('forward_resolve')
    expect(event.fingerprint).toEqual(['rpc-api', 'suins-forward'])
    expect(event.contexts.service.name).toBe('alice.sui')
  })

  it('tracesSampleRate is 0 — errors-only, no tracing', async () => {
    // The client that just captured above must have been configured errors-only.
    const Sentry = await import('@sentry/node')
    const client = Sentry.getClient()
    expect(client?.getOptions()?.tracesSampleRate).toBe(0)
  })
})
