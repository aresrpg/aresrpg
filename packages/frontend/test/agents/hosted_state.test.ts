// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import { empty_hosted, reduce_hosted, request_inherited } from '../../src/agents/hosted_state.ts'
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

// Regression: arriving with an assistant's request started the setup by itself, so one link click by a
// signed-in player signed an owner proof and created a custody wallet for a request they never read.
test('an assistant request waits for the player: nothing is signed or created before their click', () => {
  const wallet = {}
  const arrived = reduce_hosted(empty_hosted(), { type: 'reset', session: wallet, account: '0xa', requested: true })
  expect(arrived.phase).toBe('idle')
  const pending = reduce_hosted(arrived, { type: 'start', phase: 'authenticating' })
  expect(pending.phase).toBe('authenticating')
  const replacement = reduce_hosted(pending, { type: 'reset', session: {}, account: '0xb', requested: true })
  expect(replacement).toMatchObject({ phase: 'failed', failure: 'restart' })
  const disconnected = reduce_hosted(pending, { type: 'reset', session: null })
  expect(reduce_hosted(disconnected, { type: 'reset', session: {}, account: '0xb', requested: true })).toMatchObject({
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
  expect(reduce_hosted(empty_hosted(), { type: 'reset', session: null, requested: true }).phase).toBe('idle')
})

// Regression (production, 2026-11-20): the dapp mounts this dialog before the Google session is
// restored, so the reducer saw "no session" and then the player's own session, took that for a
// replaced wallet and told every player to "start the connection again in your assistant".
test('a session that arrives after the page is the same player, not a replaced wallet', () => {
  const waiting = reduce_hosted(empty_hosted(), { type: 'reset', session: null, account: null, requested: false })
  const restored = reduce_hosted(waiting, { type: 'reset', session: {}, account: '0xa', requested: true })
  expect(restored).toMatchObject({ phase: 'idle', failure: null })
  // the store may hand the same account a new session object: still the same player
  const refreshed = reduce_hosted(restored, { type: 'reset', session: {}, account: '0xa', requested: true })
  expect(refreshed).toMatchObject({ phase: 'idle', failure: null })
  const other = reduce_hosted(refreshed, { type: 'reset', session: {}, account: '0xb', requested: true })
  expect(other).toMatchObject({ phase: 'failed', failure: 'restart' })
})

test('invalid bound authorization requires provider restart; unknown errors permit explicit retry', async () => {
  const { hosted_failure } = await import('../../src/agents/hosted_state.ts')
  for (const cause of ['invalid_session', 'invalid_challenge', 'invalid_grant', 'invalid_client']) {
    expect(hosted_failure(new Error('Request failed', { cause }), 'request')).toBe('restart')
    expect(hosted_failure(new Error('Request failed', { cause }), null)).toBe('retry')
  }
  expect(hosted_failure(new Error('Request failed', { cause: 'storage_unavailable' }), 'request')).toBe('retry')
})

// 2026-11-20, production: the dapp consent page loaded before the sign-in was restored, cancelled the
// request named in its address when the account arrived, and the bot then refused the owner proof.
test('a request survives the arrival of the first account and dies on an account change', () => {
  const [alice, bob] = [{ address: '0xa' }, { address: '0xb' }]
  expect(request_inherited(null, alice)).toBe(true)
  expect(request_inherited(alice, alice)).toBe(true)
  expect(request_inherited(null, null)).toBe(true)
  expect(request_inherited(alice, bob)).toBe(false)
  expect(request_inherited(alice, null)).toBe(false)
})

// Each wait of a connection has one name, so the page never shows a generic "Connecting…" for all of them.
test('a pending phase names the step in progress, and a phase that waits for nothing names none', () => {
  const proving = reduce_hosted(empty_hosted<string>(), { type: 'start', phase: 'authenticating' })
  expect(empty_hosted<string>().step).toBeNull()
  expect(proving.step).toBe('proving')
  const report = (state: typeof proving, step: 'creating' | 'checking' | 'naming') =>
    reduce_hosted(state, { type: 'result', generation: state.generation, values: { step } })
  const creating = report(proving, 'creating')
  // A step is a result of the operation in flight: the phase and its generation stay, so nothing restarts.
  expect(creating).toMatchObject({ step: 'creating', phase: 'authenticating', generation: proving.generation })
  expect(report(report(creating, 'checking'), 'naming').step).toBe('naming')
  const ready = reduce_hosted(creating, { type: 'result', generation: creating.generation, values: { phase: 'ready' } })
  expect(ready.step).toBeNull()
  const approving = reduce_hosted(ready, { type: 'start', phase: 'authorizing' })
  expect(approving.step).toBe('approving')
  const complete = reduce_hosted(approving, {
    type: 'result',
    generation: approving.generation,
    values: { phase: 'complete' },
  })
  expect(complete.step).toBe('returning')
  const failed = reduce_hosted(approving, {
    type: 'result',
    generation: approving.generation,
    values: { phase: 'failed', failure: 'retry' },
  })
  expect(failed.step).toBeNull()
  // A step reported by an operation that was retired never names the next one.
  const retired = reduce_hosted(proving, { type: 'reset', session: null })
  expect(reduce_hosted(retired, { type: 'result', generation: proving.generation, values: { step: 'checking' } })).toBe(
    retired
  )
})
