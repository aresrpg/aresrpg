// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'
import type { AdminOverviewResult, AdminShopSaleRow } from '@aresrpg/protocol'

import { initial_app_state, reduce_app_state } from '../../src/store.ts'

const state = () =>
  initial_app_state(Object.freeze({ quality: 'medium', flat_mode: false, music_enabled: true, render_distance: null }))

const overview: AdminOverviewResult = Object.freeze({
  as_of_checkpoint: 42,
  as_of_ms: 1,
  revenue: Object.freeze({
    days: 30,
    bucket: 'day',
    shop_mist: '10',
    shop_orders: '1',
    item_royalty_mist: '2',
    character_royalty_mist: '3',
    character_creation_mist: '0',
    kolizeum_mist: '0',
    last_30d_revenue_mist: '15',
    month_to_date_revenue_mist: '15',
    money: Object.freeze([]),
  }),
  players: Object.freeze({
    days: 30,
    bucket: 'day',
    dau: 2,
    rolling_30d: 7,
    activity: Object.freeze([]),
  }),
  transactions: Object.freeze({
    days: 30,
    bucket: 'day',
    total: 9,
    all_time: 21,
    gas_range_mist: '100000000',
    gas_all_time_mist: '500000000',
    transactions: Object.freeze([]),
  }),
  online: Object.freeze({
    days: 1,
    bucket: '15m',
    online_now: 4,
    online_average: 3,
    online_peak: 5,
    online: Object.freeze([]),
  }),
  addresses: Object.freeze({ days: 30, bucket: 'day', total: 3, addresses: Object.freeze([]) }),
  characters: Object.freeze({ days: 30, bucket: 'day', total: 4, characters: Object.freeze([]) }),
})

const sale: AdminShopSaleRow = Object.freeze({
  id: '1:2:3',
  checkpoint: 1,
  tx_digest: 'digest',
  timestamp_ms: 1,
  sale_id: '0xsale',
  buyer: '0xbuyer',
  item_type: 'potion',
  quantity: 1,
  unit_price_mist: '10',
  total_mist: '10',
  remaining_supply: '9',
})

test('the overview accepts only its correlated typed response and range changes reload it', () => {
  const loading = reduce_app_state(state(), { type: 'admin/overview_refresh' })
  const requested = reduce_app_state(loading, { type: 'admin/overview_requested', request_id: 7 })
  const stale = reduce_app_state(requested, {
    type: 'server/packet',
    packet: { type: 'packet/admin_response', id: 6, kind: 'overview', result: overview },
  })
  expect(stale).toBe(requested)
  const ready = reduce_app_state(requested, {
    type: 'server/packet',
    packet: { type: 'packet/admin_response', id: 7, kind: 'overview', result: overview },
  })
  expect(ready.admin.overview).toMatchObject({ status: 'ready', result: overview, ranges: { revenue: 30 } })
  const ranged = reduce_app_state(ready, { type: 'admin/overview_range_changed', section: 'revenue', days: 7 })
  expect(ranged.admin.overview).toMatchObject({
    status: 'ready',
    ranges: { revenue: 7, players: 30, transactions: 30, online: 1, addresses: 30, characters: 30 },
    result: overview,
    pending: { revenue: { days: 7, request_id: null } },
  })
})

test('a cached overview range switches locally without another pending request', () => {
  const requested = reduce_app_state(reduce_app_state(state(), { type: 'admin/overview_refresh' }), {
    type: 'admin/overview_requested',
    request_id: 1,
  })
  const ready = reduce_app_state(requested, {
    type: 'server/packet',
    packet: { type: 'packet/admin_response', id: 1, kind: 'overview', result: overview },
  })
  const loading = reduce_app_state(ready, { type: 'admin/overview_range_changed', section: 'revenue', days: 7 })
  const section_requested = reduce_app_state(loading, {
    type: 'admin/overview_section_requested',
    section: 'revenue',
    request_id: 2,
  })
  const seven_days = {
    ...overview.revenue,
    days: 7 as const,
    bucket: 'hour' as const,
    last_30d_revenue_mist: '99',
  }
  const loaded = reduce_app_state(section_requested, {
    type: 'server/packet',
    packet: {
      type: 'packet/admin_response',
      id: 2,
      kind: 'overview_section',
      result: { section: 'revenue', data: seven_days },
    },
  })
  const back = reduce_app_state(loaded, { type: 'admin/overview_range_changed', section: 'revenue', days: 30 })
  const cached = reduce_app_state(back, { type: 'admin/overview_range_changed', section: 'revenue', days: 7 })
  expect(cached.admin.overview.result?.revenue).toEqual(seven_days)
  expect(cached.admin.overview.result?.revenue.last_30d_revenue_mist).toBe('99')
  expect(cached.admin.overview.pending).toEqual({})
})

test('a full refresh cannot overwrite a newer section range or discard its cache', () => {
  const loading = reduce_app_state(state(), { type: 'admin/overview_refresh' })
  const requested = reduce_app_state(loading, { type: 'admin/overview_requested', request_id: 1 })
  const ready = reduce_app_state(requested, {
    type: 'server/packet',
    packet: { type: 'packet/admin_response', id: 1, kind: 'overview', result: overview },
  })
  const ranged = reduce_app_state(ready, { type: 'admin/overview_range_changed', section: 'revenue', days: 7 })
  const section_requested = reduce_app_state(ranged, {
    type: 'admin/overview_section_requested',
    section: 'revenue',
    request_id: 2,
  })
  const refreshing = reduce_app_state(section_requested, { type: 'admin/overview_refresh' })
  const refresh_requested = reduce_app_state(refreshing, { type: 'admin/overview_requested', request_id: 3 })
  const seven_days = { ...overview.revenue, days: 7 as const, bucket: 'hour' as const, shop_mist: '70' }
  const section_first = reduce_app_state(refresh_requested, {
    type: 'server/packet',
    packet: {
      type: 'packet/admin_response',
      id: 2,
      kind: 'overview_section',
      result: { section: 'revenue', data: seven_days },
    },
  })
  const full_last = reduce_app_state(section_first, {
    type: 'server/packet',
    packet: { type: 'packet/admin_response', id: 3, kind: 'overview', result: overview },
  })
  expect(full_last.admin.overview.result?.revenue).toEqual(seven_days)
  expect(full_last.admin.overview.cache).toHaveProperty('revenue:7')
  expect(full_last.admin.overview.cache).toHaveProperty('revenue:30')

  const full_first = reduce_app_state(refresh_requested, {
    type: 'server/packet',
    packet: { type: 'packet/admin_response', id: 3, kind: 'overview', result: overview },
  })
  expect(full_first.admin.overview.pending).toHaveProperty('revenue.request_id', 2)
  const section_last = reduce_app_state(full_first, {
    type: 'server/packet',
    packet: {
      type: 'packet/admin_response',
      id: 2,
      kind: 'overview_section',
      result: { section: 'revenue', data: seven_days },
    },
  })
  expect(section_last.admin.overview.result?.revenue).toEqual(seven_days)
})

test('the exact sales ledger appends cursor pages through its own correlated lane', () => {
  const loading = reduce_app_state(state(), { type: 'admin/sales_refresh' })
  const requested = reduce_app_state(loading, { type: 'admin/sales_requested', request_id: 8 })
  const ready = reduce_app_state(requested, {
    type: 'server/packet',
    packet: {
      type: 'packet/admin_response',
      id: 8,
      kind: 'shop_sales',
      result: { as_of_checkpoint: 42, rows: [sale], next_cursor: '1:30' },
    },
  })
  expect(ready.admin.sales).toMatchObject({ status: 'ready', rows: [sale], next_cursor: '1:30' })
  expect(reduce_app_state(ready, { type: 'admin/sales_more' }).admin.sales.status).toBe('loading')
  expect(reduce_app_state(ready, { type: 'admin/sales_refresh' }).admin.sales).toMatchObject({
    status: 'loading',
    rows: [],
    next_cursor: null,
  })
})
