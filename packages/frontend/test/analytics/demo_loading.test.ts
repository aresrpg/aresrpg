// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import { create_demo_loading_observer } from '../../src/analytics/demo_loading.ts'
import type { AnalyticsEvent } from '../../src/analytics.ts'

const fixture = () => {
  const events: AnalyticsEvent[] = []
  const { observe, playable } = create_demo_loading_observer((name, properties) => events.push({ name, properties }))
  return { events, observe, playable }
}

test('readiness and first movement emit once, never from loading motion or idle samples', () => {
  const { events, observe } = fixture()
  observe({ stage: 'terrain', elapsed_ms: 1000, position: [0, 0] })
  observe({ stage: 'movement', elapsed_ms: 1200, position: [10, 0] })
  expect(events).toEqual([])
  observe({ stage: 'ready', elapsed_ms: 2400, position: [10, 0] })
  observe({ stage: 'ready', elapsed_ms: 2500, position: [10, 0] })
  observe({ stage: 'movement', elapsed_ms: 2600, position: [10.01, 0] })
  expect(events).toEqual([{ name: 'demo_playable', properties: { duration_ms: 2400 } }])
  expect(observe({ stage: 'movement', elapsed_ms: 2900, position: [11, 0] })).toBe(true)
  observe({ stage: 'movement', elapsed_ms: 3100, position: [12, 0] })
  observe({ stage: 'ready', elapsed_ms: 3200, position: [12, 0] })
  expect(events).toHaveLength(2)
  expect(events[1]).toEqual({ name: 'demo_first_movement', properties: { duration_ms: 500 } })
})

test('failed loading emits a bounded stage once and never claims playable afterward', () => {
  const { events, observe } = fixture()
  observe({ stage: 'graphics', elapsed_ms: 1000, position: null })
  expect(observe({ stage: 'failed', elapsed_ms: 1500, position: null })).toBe(true)
  observe({ stage: 'failed', elapsed_ms: 1600, position: null })
  observe({ stage: 'ready', elapsed_ms: 1700, position: [0, 0] })
  expect(events).toEqual([{ name: 'demo_load_failed', properties: { duration_ms: 1500, stage: 'graphics' } }])
})

test('a late first pose establishes a baseline rather than counting the spawn as movement', () => {
  const { events, observe } = fixture()
  observe({ stage: 'ready', elapsed_ms: 1000, position: null })
  observe({ stage: 'movement', elapsed_ms: 1100, position: [100, 200] })
  expect(events).toHaveLength(1)
  observe({ stage: 'movement', elapsed_ms: 1300, position: [101, 200] })
  expect(events[1]?.name).toBe('demo_first_movement')
})

test('startup readiness stays completed during later graphics changes or immersive fights', () => {
  const { observe, playable, events } = fixture()
  expect(playable()).toBe(false)
  observe({ stage: 'ready', elapsed_ms: 1000, position: [0, 0] })
  observe({ stage: 'graphics', elapsed_ms: 2000, position: null })
  expect(playable()).toBe(true)
  observe({ stage: 'ready', elapsed_ms: 3000, position: null })
  expect(events).toHaveLength(1)
})

test('failed loading retains a bounded engine issue code without exception text', () => {
  const { observe, events } = fixture()
  observe({ stage: 'failed', elapsed_ms: 1000, position: null, failure_stage: 'webgpu_unavailable' })
  expect(events).toEqual([{ name: 'demo_load_failed', properties: { duration_ms: 1000, stage: 'webgpu_unavailable' } }])
})
