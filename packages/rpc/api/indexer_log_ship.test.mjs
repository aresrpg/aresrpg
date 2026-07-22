// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, expect, it } from 'bun:test'

import { forward_indexer_lines, parse_indexer_log_line } from './indexer_log_ship.mjs'

const marked_record = JSON.stringify({
  timestamp: '2026-07-22T03:00:00.000Z',
  level: 'ERROR',
  target: 'aresrpg_rpc_indexer',
  fields: {
    message: 'indexer stopped with error',
    sentry_event: true,
    error_type: 'indexer_error',
    culprit: 'joining indexer service',
    error_chain: 'joining indexer service: Redis connection refused',
    sentry_fingerprint: 'indexer:joining_indexer_service',
  },
})

describe('indexer structured error decoding', () => {
  it('turns a marked terminal record into explicit Sentry data', () => {
    expect(parse_indexer_log_line(marked_record)).toEqual({
      ok: true,
      event: {
        message: 'joining indexer service: Redis connection refused',
        error_type: 'indexer_error',
        culprit: 'joining indexer service',
        fingerprint: ['indexer', 'indexer:joining_indexer_service'],
        context: {
          log_timestamp: '2026-07-22T03:00:00.000Z',
          target: 'aresrpg_rpc_indexer',
        },
      },
    })
  })

  it('ignores unmarked framework errors so a propagated failure reports once', () => {
    const framework_record = JSON.stringify({
      level: 'ERROR',
      target: 'sui_indexer_alt_framework::pipeline::processor',
      fields: { message: 'Error processing checkpoint' },
    })
    expect(parse_indexer_log_line(framework_record)).toEqual({ ok: true, event: null })
  })

  it('returns malformed log input as data instead of throwing', () => {
    expect(parse_indexer_log_line('{broken')).toEqual({ ok: false, error: 'invalid_json' })
  })
})

describe('indexer error forwarding', () => {
  it('passes the explicit fingerprint to the reporting choke and flushes once', async () => {
    const captured = []
    const invalid = []
    let flush_count = 0
    const result = await forward_indexer_lines([marked_record, '{broken'], {
      report_error: (error, context) => captured.push({ error, context }),
      on_invalid: (reason) => invalid.push(reason),
      flush: async () => {
        flush_count += 1
        return true
      },
      reporting_live: () => true,
    })

    expect(result).toEqual({ forwarded_count: 1, invalid_count: 1 })
    expect(invalid).toEqual(['invalid_json'])
    expect(flush_count).toBe(1)
    expect(captured).toHaveLength(1)
    expect(captured[0].error.name).toBe('indexer_error')
    expect(captured[0].error.message).toBe('joining indexer service: Redis connection refused')
    expect(captured[0].context).toEqual({
      area: 'indexer',
      action: 'joining indexer service',
      fingerprint: ['indexer', 'indexer:joining_indexer_service'],
      log_timestamp: '2026-07-22T03:00:00.000Z',
      target: 'aresrpg_rpc_indexer',
    })
  })

  it('advances past records without flushing when Sentry has no DSN', async () => {
    let flush_count = 0
    const result = await forward_indexer_lines([marked_record], {
      report_error: () => undefined,
      reporting_live: () => false,
      flush: async () => {
        flush_count += 1
        return false
      },
    })

    expect(result).toEqual({ forwarded_count: 1, invalid_count: 0 })
    expect(flush_count).toBe(0)
  })
})
