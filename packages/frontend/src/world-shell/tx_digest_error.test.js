import { describe, expect, test } from 'bun:test'

import { attach_executed_digest, error_executed_digest } from './tx_digest_error.js'

describe('post-submit digest preservation', () => {
  test('stamps the original wait error without losing its cause', () => {
    const cause = new Error('socket closed')
    const error = new Error('network timeout', { cause })
    const stamped = attach_executed_digest(error, '0xdigest')

    expect(stamped).toBe(error)
    expect(error.cause).toBe(cause)
    expect(error_executed_digest(error)).toBe('0xdigest')
  })

  test('wraps a frozen error and finds a digest through a cause chain', () => {
    const error = Object.freeze(new Error('timed out'))
    const stamped = attach_executed_digest(error, '0xburned')

    expect(stamped).not.toBe(error)
    expect(stamped.cause).toBe(error)
    expect(error_executed_digest(stamped)).toBe('0xburned')
  })
})
