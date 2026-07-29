// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// report.js unit + headless boot proof. NO network ever: init uses a FAKE DSN + an injected capturing
// transport (the Sentry client hands every outbound envelope to it — asserting on those IS asserting the
// send was attempted), and the pure before_send/should_drop/fingerprint functions are tested directly.
import { describe, expect, it } from 'bun:test'

import {
  should_drop,
  move_abort_fingerprint,
  before_send,
  init_reporting,
  report_error,
  is_reporting_live,
} from './report.js'
import { game_log, _reset_log_for_test } from './log.js'

const abort_event = (module, code, pkg) => ({
  $kind: 'MoveAbort',
  MoveAbort: { abortCode: code, location: { module, package: pkg } },
})

describe('before_send drop list', () => {
  it('drops benign AbortErrors', () => {
    const e = new Error('The user aborted a request.')
    e.name = 'AbortError'
    expect(should_drop(e)).toBe(true)
  })

  it('drops user-rejected wallet signatures', () => {
    expect(should_drop(new Error('User rejected the request'))).toBe(true)
    expect(should_drop(new Error('user denied transaction signature'))).toBe(true)
    expect(should_drop('USER_REJECT')).toBe(true)
  })

  it('drops browser noise (ResizeObserver / cross-origin Script error.)', () => {
    expect(should_drop(new Error('ResizeObserver loop completed with undelivered notifications.'))).toBe(true)
    expect(should_drop('Script error.')).toBe(true)
  })

  it('drops events whose stack lives in a browser extension', () => {
    const event = {
      exception: {
        values: [{ stacktrace: { frames: [{ filename: 'chrome-extension://abcdef/content.js' }] } }],
      },
    }
    expect(should_drop(new Error('anything'), event)).toBe(true)
  })

  it('keeps real errors', () => {
    expect(should_drop(new Error('kiosk resolve failed'))).toBe(false)
    expect(
      before_send(
        { exception: { values: [{ type: 'Error', value: 'real' }] } },
        { originalException: new Error('real') }
      )
    ).not.toBeNull()
  })

  // A version/102 abort (the dark-ship pause any package can throw) is expected/actionable via the
  // CONTRACTS PAUSED modal, never a page-us error. EWrongVersion (101, a stale-client cache) is a real bug and
  // must still report — only the exact module+code pair is dropped.
  it('drops the maintenance dark-ship pause (version/102) but keeps EWrongVersion (version/101)', () => {
    expect(should_drop(abort_event('version', 102, '0xabc'))).toBe(true)
    expect(should_drop(abort_event('version', 101, '0xabc'))).toBe(false)
  })

  it('before_send returns null for a dropped class', () => {
    expect(before_send({}, { originalException: new Error('User rejected the request') })).toBeNull()
  })
})

describe('MoveAbort fingerprinting', () => {
  it('groups by package::module::abort_code', () => {
    expect(move_abort_fingerprint(abort_event('kolizeum', 103, '0xabc'))).toEqual(['0xabc::kolizeum::103'])
  })

  it('falls back to the aresrpg namespace without a package location', () => {
    const legacy = new Error('MoveAbort(MoveLocation { module: Identifier("character") }, 109) in command 0')
    expect(move_abort_fingerprint(legacy)).toEqual(['aresrpg::character::109'])
  })

  it('reads the abort off an Error carrying it on .cause (the tx_error shape)', () => {
    const err = new Error('player copy')
    err.cause = abort_event('fight', 111, '0xdef')
    expect(move_abort_fingerprint(err)).toEqual(['0xdef::fight::111'])
  })

  it('non-abort errors get no fingerprint override', () => {
    expect(move_abort_fingerprint(new Error('network down'))).toBeNull()
  })

  it('before_send stamps the fingerprint onto the event', () => {
    const event = {}
    before_send(event, { originalException: abort_event('shop', 105, '0x9') })
    expect(event.fingerprint).toEqual(['0x9::shop::105'])
  })
})

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

  it('init without a DSN leaves remote reporting unarmed and local reporting safe', () => {
    const original = console.error
    console.error = () => {}
    expect(is_reporting_live()).toBe(false)
    expect(init_reporting({ dsn: '' })).toBe(false)
    expect(is_reporting_live()).toBe(false)
    try {
      expect(() => report_error(new Error('before init — must not throw'))).not.toThrow()
    } finally {
      console.error = original
    }
  })

  it('a reported error always prints its full cause locally even when Sentry is not armed', () => {
    const original = console.error
    const calls = []
    console.error = (...args) => calls.push(args)
    try {
      const reason = new Error('full kiosk census failure reason')
      report_error(new Error('join failed', { cause: reason }), { area: 'join', action: 'auto_join_world' })
    } finally {
      console.error = original
    }
    expect(calls).toHaveLength(1)
    expect(calls[0]).toContainEqual(expect.objectContaining({ message: 'full kiosk census failure reason' }))
  })

  it('a forced error attempts an outbound envelope carrying the game_log breadcrumbs', async () => {
    _reset_log_for_test()
    expect(
      init_reporting({
        dsn: 'https://public@fake.ingest.example/1',
        environment: 'test',
        release: 'test-sha',
        transport,
      })
    ).toBe(true)
    expect(is_reporting_live()).toBe(true)

    game_log('join', 'player joined world 42') // the bracket keeper → breadcrumb pairing
    const boom = new Error('forced test error')
    const original = console.error
    console.error = () => {}
    try {
      report_error(boom, { area: 'test', action: 'headless_proof', digest: '0xproof' })
      report_error(boom, { area: 'test' }) // same object again — the dedup stamp must swallow it
    } finally {
      console.error = original
    }

    const Sentry = await import('@sentry/react')
    await Sentry.flush(2000)

    // envelope = [headers, items]; items = [[{type}, payload], …] — find the error event
    const events = sent_events()
    expect(events.length).toBe(1) // sent once, dedup held
    const [event] = events
    expect(event.exception.values[0].value).toBe('forced test error')
    expect(event.environment).toBe('test')
    expect(event.release).toBe('test-sha')
    expect(event.contexts.game.digest).toBe('0xproof')
    expect(event.tags.area).toBe('test')
    // the pairing: the bracket event rides along as a breadcrumb
    const crumbs = event.breadcrumbs ?? []
    expect(crumbs.some((b) => b.category === 'join' && /player joined world 42/.test(b.message))).toBe(true)
  })

  it('a user-rejected signature never leaves the browser (beforeSend drop, end to end)', async () => {
    const before = sent_events().length
    report_error(new Error('User rejected the request'), { area: 'wallet' })
    const Sentry = await import('@sentry/react')
    await Sentry.flush(2000)
    expect(sent_events().length).toBe(before) // the armed client dropped it in beforeSend — no new envelope
  })
})
