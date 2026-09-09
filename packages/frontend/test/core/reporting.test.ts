// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'
import { close, flush, type ErrorEvent } from '@sentry/react'

import { on_error_translate, toast } from '../../src/toast.ts'
import { before_send, init_reporting, react_error_handlers, scrub_report } from '../../src/reporting.ts'
import { reporting_config, require_reporting_dsn } from '../../src/reporting_config.ts'

test('a caught pre-submission MoveAbort reaches Sentry before toast translation', async () => {
  const events: ErrorEvent[] = []
  init_reporting(
    {
      MODE: 'production',
      VITE_SENTRY_DSN: 'https://public@example.com/1',
      VITE_NETWORK: 'testnet',
      VITE_RELEASE: 'test-release',
    },
    () => ({
      send: async ([, items]) => {
        for (const [header, payload] of items) if (header.type === 'event') events.push(payload as ErrorEvent)
        return { statusCode: 200 }
      },
      flush: async () => true,
    })
  )
  const failure = new Error(
    "[sdk] transaction resolution failed — NOT submitted: Transaction resolution failed: MoveAbort in 2nd command, abort code: 1723, in '0x6a3c71cd9bd381574e5b3877aa8b0c525a47d497bbdaf70215ad9afa4ef5a039::combat::start' (instruction 28)"
  )
  on_error_translate(() => 'Please wait for the fight.')
  try {
    toast.add(failure, 'error', { area: 'fight', action: 'start', fight: '0xf' })
    toast.loading('Starting').error(failure)
    await flush(2_000)
    expect(events).toHaveLength(1)
    expect(JSON.stringify(events)).toContain('abort code: 1723')
    expect(JSON.stringify(events)).not.toContain('Please wait for the fight.')
    expect(events[0]?.fingerprint).toEqual([
      'move-abort',
      '0x6a3c71cd9bd381574e5b3877aa8b0c525a47d497bbdaf70215ad9afa4ef5a039',
      'combat',
      'start',
      '1723',
    ])
    expect(events[0]?.contexts?.application).toMatchObject({ area: 'fight', action: 'start', fight: '0xf' })
    expect(events[0]?.environment).toBe('testnet-local')
    expect(events[0]?.release).toBe('test-release')
    react_error_handlers.onUncaughtError(new Error('render crashed'), { componentStack: 'FightHud' })
    await flush(2_000)
    expect(events).toHaveLength(2)
    expect(events[1]?.contexts?.application).toEqual({ area: 'react', component_stack: 'FightHud' })
  } finally {
    on_error_translate(null)
    await close()
  }
})

test('events redact bearer links and credentials in causes, requests, and breadcrumbs', () => {
  const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJzZWNyZXQifQ.signature'
  const original = {
    message: `Failed https://aresrpg.world/claim#bearer-secret ${jwt}`,
    request: { url: 'https://aresrpg.world/?token=secret', headers: { Authorization: 'secret' } },
    exception: { values: [{ value: `cause ${jwt} suiprivkey1secret` }] },
    breadcrumbs: [{ data: { to: '/gift#another-secret', id_token: jwt } }],
  }
  const serialized = JSON.stringify(scrub_report(original))
  expect(serialized).not.toContain('secret')
  expect(serialized).not.toContain(jwt)
  expect(serialized).toContain('https://aresrpg.world/claim')
  expect(original.message).toContain(jwt)
})

test('wallet cancellations are filtered, but simulated MoveAborts remain reportable', () => {
  expect(before_send({ type: undefined, message: 'User rejected the request' }, {})).toBeNull()
  expect(
    before_send({ type: undefined }, { originalException: new DOMException('cancelled', 'AbortError') })
  ).toBeNull()
  expect(before_send({ type: undefined, message: 'NOT submitted: abort code: 1723' }, {})).not.toBeNull()
})

test('development never reports and deployed builds require their own public DSN', () => {
  const source = {
    MODE: 'development',
    VITE_SENTRY_DSN: 'https://public@example.com/1',
    VITE_NETWORK: 'mainnet',
    VITE_DEPLOY_ENV: 'preview',
  }
  expect(reporting_config(source)).toMatchObject({ enabled: false, environment: 'mainnet-preview' })
  expect(reporting_config({ ...source, MODE: 'production' }).enabled).toBeTrue()
  expect(() => require_reporting_dsn({ VERCEL_ENV: 'production' })).toThrow('VITE_SENTRY_DSN')
  expect(() => require_reporting_dsn({ VERCEL_ENV: 'preview' })).toThrow('VITE_SENTRY_DSN')
  expect(() => require_reporting_dsn({})).not.toThrow()
  expect(() =>
    require_reporting_dsn({ VERCEL_ENV: 'production', VITE_SENTRY_DSN: source.VITE_SENTRY_DSN })
  ).not.toThrow()
})
