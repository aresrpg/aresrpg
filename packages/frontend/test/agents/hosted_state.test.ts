// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import { empty_hosted, reduce_hosted } from '../../src/agents/hosted_state.ts'
import { resolve_bot_service_url } from '../../src/env.ts'

test('close, back and account replacement retire all late hosted completions', () => {
  const pending = reduce_hosted(empty_hosted<string>(), { type: 'start', phase: 'authenticating' })
  const retired = reduce_hosted(pending, { type: 'reset', session: null })
  expect(
    reduce_hosted(retired, {
      type: 'result',
      generation: pending.generation,
      values: { phase: 'ready', authorization_id: 'old', bots: ['old'], consent: null },
    })
  ).toBe(retired)
  expect(reduce_hosted(retired, { type: 'result', generation: pending.generation, values: { phase: 'failed' } })).toBe(
    retired
  )
  expect(retired.authorization_id).toBeNull()
  expect(retired.bots).toEqual([])
})
test.each(['authenticating', 'authorizing'] as const)('double activation cannot restart pending %s', (phase) => {
  const pending = reduce_hosted(empty_hosted(), { type: 'start', phase })
  expect(reduce_hosted(pending, { type: 'start', phase })).toBe(pending)
  const complete = reduce_hosted(pending, {
    type: 'result',
    generation: pending.generation,
    values: { phase: 'complete' },
  })
  expect(reduce_hosted(complete, { type: 'result', generation: pending.generation, values: { phase: 'failed' } })).toBe(
    complete
  )
})
test('a failed operation permits explicit retry and rejects the former response', () => {
  const pending = reduce_hosted(empty_hosted(), { type: 'start', phase: 'authenticating' })
  const failed = reduce_hosted(pending, { type: 'result', generation: pending.generation, values: { phase: 'failed' } })
  const retry = reduce_hosted(failed, { type: 'start', phase: 'authenticating' })
  expect(retry.generation).toBeGreaterThan(pending.generation)
  expect(
    reduce_hosted(retry, {
      type: 'result',
      generation: pending.generation,
      values: { phase: 'ready', authorization_id: 'old', bots: [], consent: null },
    })
  ).toBe(retry)
})
test('hosted service has no implicit endpoint and rejects insecure or credential-bearing destinations', () => {
  expect(resolve_bot_service_url()).toBe('')
  expect(resolve_bot_service_url('https://bot.example/')).toBe('https://bot.example')
  for (const url of [
    'http://bot.example',
    'https://user:secret@bot.example',
    'https://bot.example/path',
    'https://bot.example/?key=secret',
  ])
    expect(() => resolve_bot_service_url(url)).toThrow()
})

test('provider entry resumes setup once but never grants consent automatically', () => {
  const wallet = {}
  const pending = reduce_hosted(empty_hosted(), { type: 'reset', session: wallet, resume_authorization: true })
  expect(pending.phase).toBe('authenticating')
  const replacement = reduce_hosted(pending, { type: 'reset', session: {}, resume_authorization: true })
  expect(replacement).toMatchObject({ phase: 'failed', failure: 'restart' })
  const disconnected = reduce_hosted(pending, { type: 'reset', session: null })
  expect(reduce_hosted(disconnected, { type: 'reset', session: {}, resume_authorization: true })).toMatchObject({
    phase: 'failed',
    failure: 'restart',
  })
  expect(
    reduce_hosted(replacement, { type: 'result', generation: pending.generation, values: { phase: 'ready' } })
  ).toBe(replacement)
  expect(reduce_hosted(pending, { type: 'start', phase: 'authenticating' })).toBe(pending)
  const ready = reduce_hosted(pending, { type: 'result', generation: pending.generation, values: { phase: 'ready' } })
  expect(ready.phase).toBe('ready')
  const failed = reduce_hosted(pending, { type: 'result', generation: pending.generation, values: { phase: 'failed' } })
  expect(failed.phase).toBe('failed')
  expect(reduce_hosted(failed, { type: 'start', phase: 'authenticating' }).generation).toBeGreaterThan(
    failed.generation
  )
  const closed = reduce_hosted(pending, { type: 'reset', session: null })
  expect(reduce_hosted(closed, { type: 'result', generation: pending.generation, values: { phase: 'ready' } })).toBe(
    closed
  )
  expect(reduce_hosted(empty_hosted(), { type: 'reset', session: wallet }).phase).toBe('idle')
  expect(reduce_hosted(empty_hosted(), { type: 'reset', session: null, resume_authorization: true }).phase).toBe('idle')
})

test('invalid bound authorization requires provider restart; unknown errors permit explicit retry', async () => {
  const { hosted_failure } = await import('../../src/agents/hosted_state.ts')
  for (const cause of ['invalid_session', 'invalid_challenge', 'invalid_grant', 'invalid_client']) {
    expect(hosted_failure(new Error('Request failed', { cause }), 'request')).toBe('restart')
    expect(hosted_failure(new Error('Request failed', { cause }), null)).toBe('retry')
  }
  expect(hosted_failure(new Error('Request failed', { cause: 'storage_unavailable' }), 'request')).toBe('retry')
})
