// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import {
  chart_hover_index,
  chart_point_values,
  chart_tick_values,
  format_chart_timestamp,
} from '../../src/admin/MetricChart.tsx'

test('chart hover resolves the nearest point and preserves every exact series value', () => {
  expect(chart_hover_index(10, 10, 100, 5)).toBe(0)
  expect(chart_hover_index(60, 10, 100, 5)).toBe(2)
  expect(chart_hover_index(110, 10, 100, 5)).toBe(4)
  expect(
    chart_point_values(
      [
        { label: 'Marketplace', color: '#gold', values: [1, 2] },
        { label: 'Royalty', color: '#violet', values: [3, 4] },
      ],
      1
    )
  ).toEqual([
    { label: 'Marketplace', color: '#gold', value: 2 },
    { label: 'Royalty', color: '#violet', value: 4 },
  ])
})

test('discrete charts use integral ticks and hover timestamps include the date and time', () => {
  expect(chart_tick_values(3, 'count')).toEqual([3, 2, 1, 0])
  expect(chart_tick_values(7, 'count')).toEqual([8, 6, 4, 2, 0])
  const timestamp = format_chart_timestamp(0, 'en-US', 'UTC')
  expect(timestamp).toContain('Jan 1, 1970')
  expect(timestamp).toContain('12:00 AM')
})
