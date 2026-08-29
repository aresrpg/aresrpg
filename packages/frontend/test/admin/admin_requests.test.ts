// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import { send_admin_dashboard_requests } from '../../src/admin/admin_requests.ts'
import { admin_overview_ready_to_load, admin_sales_ready_to_load } from '../../src/modules/admin.ts'

const dashboard = (pending: boolean) => ({
  admin: {
    overview: {
      status: 'ready',
      ranges: { revenue: 7, players: 30, transactions: 30, online: 1, addresses: 30, characters: 30 },
      pending: pending ? { revenue: { days: 7, request_id: null } } : {},
    },
    sales: { status: 'idle', range_days: 30, next_cursor: null },
  },
})

test('an uncached range requests only its section instead of reloading the overview', () => {
  const packets: unknown[] = []
  const inputs: unknown[] = []
  send_admin_dashboard_requests({
    state: dashboard(true) as never,
    previous: dashboard(false) as never,
    link: { send: (packet: unknown) => (packets.push(packet), true) } as never,
    dispatch: (input: unknown) => void inputs.push(input),
    next_id: () => 9,
  })
  expect(inputs).toEqual([{ type: 'admin/overview_section_requested', section: 'revenue', request_id: 9 }])
  expect(packets).toEqual([
    {
      type: 'packet/admin_request',
      id: 9,
      kind: 'overview_section',
      section: 'revenue',
      days: 7,
    },
  ])
})

test('a cached range owns no pending section and sends nothing', () => {
  const packets: unknown[] = []
  const inputs: unknown[] = []
  send_admin_dashboard_requests({
    state: dashboard(false) as never,
    previous: dashboard(false) as never,
    link: { send: (packet: unknown) => (packets.push(packet), true) } as never,
    dispatch: (input: unknown) => void inputs.push(input),
    next_id: () => 10,
  })
  expect(packets).toEqual([])
  expect(inputs).toEqual([])
})

test('the admin route waits for the server ready barrier before loading its overview', () => {
  const before = {
    navigation: { page: 'admin' },
    session: { link_status: 'connecting' },
    admin: { view: 'overview', overview: { status: 'idle' } },
  }
  expect(admin_overview_ready_to_load(before as never)).toBe(false)
  expect(
    admin_overview_ready_to_load({
      ...before,
      session: { link_status: 'ready' },
    } as never)
  ).toBe(true)
})

test('the sales tab also waits for the server ready barrier', () => {
  const state = {
    navigation: { page: 'admin' },
    session: { link_status: 'ready' },
    admin: { view: 'sales', sales: { status: 'idle' } },
  }
  expect(admin_sales_ready_to_load(state as never)).toBe(true)
})
