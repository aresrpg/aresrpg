// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, expect, test } from 'bun:test'

import { ROUTES } from './routes.js'
import { bucket_sales_over_time, handle_sales_over_time, sales_over_time_days } from './views.js'

const receipt = (ts, price_mist, amount) =>
  JSON.stringify({ sale: '0xsale', item: `0xitem-${ts}-${price_mist}`, price_mist, amount, ts })

describe('sales-over-time', () => {
  test('wires the public /v1 route', () => {
    expect(ROUTES['/v1/sales-over-time']).toBe(handle_sales_over_time)
  })

  test('defaults to 30 days and caps the accepted window', () => {
    expect(sales_over_time_days(null)).toBe(30)
    expect(sales_over_time_days('not-a-number')).toBe(30)
    expect(sales_over_time_days('-4')).toBe(1)
    expect(sales_over_time_days('999')).toBe(365)
  })

  test('zero-fills UTC days and sums exact unit count + string-MIST volume', () => {
    const now = Date.UTC(2026, 6, 23, 12)
    const prior_day = Date.UTC(2026, 6, 22, 8)
    const today = Date.UTC(2026, 6, 23, 9)
    const rows = bucket_sales_over_time(
      [
        receipt(prior_day, '100', 2),
        receipt(today, '350', 1),
        receipt(today + 1, '9007199254740993', 2),
        receipt(today + 2, 'not-mist', 4),
        '{malformed',
      ],
      3,
      now
    )

    expect(rows).toEqual([
      { day: '2026-07-21', count: 0, volume: '0' },
      { day: '2026-07-22', count: 2, volume: '200' },
      { day: '2026-07-23', count: 3, volume: '18014398509482336' },
    ])
  })
})
