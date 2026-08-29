// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Admin dashboard effects cross the authenticated server link here; results still re-enter the
// owning admin reducer as ordinary inputs.

import type { AdminOverviewSection } from '@aresrpg/protocol'

import type { ServerLink } from '../server_link.ts'
import type { AppInput, AppState } from '../store.ts'

type DashboardRequestWires = Readonly<{
  state: AppState
  previous: AppState
  link: ServerLink | null
  dispatch: (input: AppInput) => void
  next_id: () => number
}>

const send_overview_request = ({ state, previous, link, dispatch, next_id }: DashboardRequestWires): void => {
  const started = previous.admin.overview.status !== 'loading'
  if (state.admin.overview.status !== 'loading' || !started) return
  const id = next_id()
  dispatch({ type: 'admin/overview_requested', request_id: id })
  if (
    !link?.send({
      type: 'packet/admin_request',
      id,
      kind: 'overview',
      revenue_days: state.admin.overview.ranges.revenue,
      players_days: state.admin.overview.ranges.players,
      transactions_days: state.admin.overview.ranges.transactions,
      online_days: state.admin.overview.ranges.online,
      addresses_days: state.admin.overview.ranges.addresses,
      characters_days: state.admin.overview.ranges.characters,
    })
  )
    dispatch({ type: 'admin/overview_failed', request_id: id, error: 'The game server is unavailable' })
}

const send_overview_sections = ({ state, link, dispatch, next_id }: DashboardRequestWires): void => {
  Object.entries(state.admin.overview.pending).forEach(([section, pending]) => {
    if (!pending || pending.request_id !== null) return
    const id = next_id()
    const typed_section = section as AdminOverviewSection
    dispatch({ type: 'admin/overview_section_requested', section: typed_section, request_id: id })
    if (
      !link?.send({
        type: 'packet/admin_request',
        id,
        kind: 'overview_section',
        section: typed_section,
        days: pending.days,
      })
    )
      dispatch({
        type: 'admin/overview_section_failed',
        section: typed_section,
        error: 'The game server is unavailable',
      })
  })
}

const send_sales_request = ({ state, previous, link, dispatch, next_id }: DashboardRequestWires): void => {
  const started = previous.admin.sales.status !== 'loading'
  const range_changed = state.admin.sales.range_days !== previous.admin.sales.range_days
  if (state.admin.sales.status !== 'loading' || (!started && !range_changed)) return
  const id = next_id()
  dispatch({ type: 'admin/sales_requested', request_id: id })
  if (
    !link?.send({
      type: 'packet/admin_request',
      id,
      kind: 'shop_sales',
      days: state.admin.sales.range_days,
      cursor: state.admin.sales.next_cursor,
    })
  )
    dispatch({ type: 'admin/sales_failed', request_id: id, error: 'The game server is unavailable' })
}

export const send_admin_dashboard_requests = (wires: DashboardRequestWires): void => {
  send_overview_request(wires)
  send_overview_sections(wires)
  send_sales_request(wires)
}
