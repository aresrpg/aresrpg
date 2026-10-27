// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import { create_funding_observer, create_transfer_observer } from '../../src/funding/analytics.ts'
import type { AnalyticsEvent } from '../../src/analytics.ts'

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

test('transfer state changes emit once and never expose addresses or amounts', () => {
  const events: AnalyticsEvent[] = []
  const observe = create_transfer_observer((name, properties) => events.push({ name, properties }))
  for (const stage of ['idle', 'signing', 'signing', 'pending', 'success', 'success'] as const) observe(stage, 'bridge')
  expect(events.map(({ name }) => name)).toEqual(['funding_bridge_started', 'funding_bridge_completed'])
  expect(events.every(({ properties }) => JSON.stringify(properties) === '{"method":"bridge"}')).toBe(true)
})
