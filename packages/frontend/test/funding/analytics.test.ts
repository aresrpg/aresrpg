// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import { create_funding_observer, create_bridge_observer } from '../../src/funding/analytics.ts'
import { FUNDING_SUI_CHAIN, FUNDING_SUI_TOKEN } from '../../src/funding/chains.ts'
import type { AnalyticsEvent } from '../../src/analytics.ts'

const route = {
  id: 'route-a',
  toChainId: FUNDING_SUI_CHAIN,
  toToken: { address: FUNDING_SUI_TOKEN },
  toAddress: '0xreceiver',
} as Parameters<ReturnType<typeof create_bridge_observer>>[0]

test('funding opens once; the default deposit view is not a completed payment', () => {
  const events: AnalyticsEvent[] = []
  const observe = create_funding_observer((name, properties) => events.push({ name, properties }))
  observe('direct')
  observe('direct')
  observe('bridge')
  observe('bridge')
  observe('direct')
  expect(events.map(({ name, properties }) => [name, properties?.method])).toEqual([
    ['funding_opened', undefined],
    ['funding_method_viewed', 'direct'],
    ['funding_method_viewed', 'bridge'],
    ['funding_method_viewed', 'direct'],
  ])
})

test('bridge status observations deduplicate retries and refuse foreign destinations', () => {
  const events: AnalyticsEvent[] = []
  const observe = create_bridge_observer('0xreceiver', (name, properties) => events.push({ name, properties }))
  observe({ ...route, toAddress: '0xother' }, 'started')
  observe({ ...route, toChainId: 1 }, 'completed')
  observe(route, 'started')
  observe(route, 'started')
  observe(route, 'failed')
  observe(route, 'failed')
  observe(route, 'started')
  observe(route, 'completed')
  observe(route, 'completed')
  observe(route, 'started')
  expect(events.map(({ name }) => name)).toEqual([
    'funding_bridge_started',
    'funding_bridge_failed',
    'funding_bridge_started',
    'funding_bridge_completed',
  ])
  expect(events.every(({ properties }) => JSON.stringify(properties) === '{"method":"bridge"}')).toBe(true)
})
