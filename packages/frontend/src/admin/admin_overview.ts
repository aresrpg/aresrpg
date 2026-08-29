// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Overview cache and request reconciliation. One section changes without invalidating its siblings.

import type {
  AdminOverviewResult,
  AdminOverviewSection,
  AdminOverviewSectionResult,
  AdminRangeDays,
} from '@aresrpg/protocol'

import type { AppInput } from '../store.ts'

import type { AdminOverviewState, AdminState } from './admin_state.ts'

const cache_key = (section: AdminOverviewSection, days: AdminRangeDays): string => `${section}:${days}`
const section_rows = (result: Readonly<AdminOverviewResult>): readonly AdminOverviewSectionResult[] =>
  Object.freeze([
    Object.freeze({ section: 'revenue', data: result.revenue }),
    Object.freeze({ section: 'players', data: result.players }),
    Object.freeze({ section: 'transactions', data: result.transactions }),
    Object.freeze({ section: 'online', data: result.online }),
    Object.freeze({ section: 'addresses', data: result.addresses }),
    Object.freeze({ section: 'characters', data: result.characters }),
  ])

const with_section = (
  result: Readonly<AdminOverviewResult>,
  section: Readonly<AdminOverviewSectionResult>
): AdminOverviewResult => {
  if (section.section === 'revenue') return Object.freeze({ ...result, revenue: section.data })
  if (section.section === 'players') return Object.freeze({ ...result, players: section.data })
  if (section.section === 'transactions') return Object.freeze({ ...result, transactions: section.data })
  if (section.section === 'online') return Object.freeze({ ...result, online: section.data })
  if (section.section === 'addresses') return Object.freeze({ ...result, addresses: section.data })
  return Object.freeze({ ...result, characters: section.data })
}

const with_current_summary = (
  current: Readonly<AdminOverviewResult>,
  cached: Readonly<AdminOverviewSectionResult>
): AdminOverviewSectionResult => {
  if (cached.section === 'revenue')
    return Object.freeze({
      section: cached.section,
      data: Object.freeze({
        ...cached.data,
        last_30d_revenue_mist: current.revenue.last_30d_revenue_mist,
        month_to_date_revenue_mist: current.revenue.month_to_date_revenue_mist,
      }),
    })
  if (cached.section === 'players')
    return Object.freeze({
      section: cached.section,
      data: Object.freeze({ ...cached.data, dau: current.players.dau, rolling_30d: current.players.rolling_30d }),
    })
  if (cached.section === 'transactions') return cached
  if (cached.section === 'online')
    return Object.freeze({
      section: cached.section,
      data: Object.freeze({ ...cached.data, online_now: current.online.online_now }),
    })
  if (cached.section === 'addresses')
    return Object.freeze({
      section: cached.section,
      data: Object.freeze({ ...cached.data, total: current.addresses.total }),
    })
  return Object.freeze({
    section: cached.section,
    data: Object.freeze({ ...cached.data, total: current.characters.total }),
  })
}

const without_pending = (overview: AdminOverviewState, section: AdminOverviewSection) =>
  Object.freeze(Object.fromEntries(Object.entries(overview.pending).filter(([key]) => key !== section)))
const replace = (admin: AdminState, overview: AdminOverviewState): AdminState => Object.freeze({ ...admin, overview })

const change_range = (
  admin: AdminState,
  input: Extract<AppInput, { type: 'admin/overview_range_changed' }>
): AdminState => {
  const cached = admin.overview.cache[cache_key(input.section, input.days)]
  const ranges = Object.freeze({ ...admin.overview.ranges, [input.section]: input.days })
  if (cached && admin.overview.result)
    return replace(
      admin,
      Object.freeze({
        ...admin.overview,
        ranges,
        result: with_section(admin.overview.result, with_current_summary(admin.overview.result, cached)),
        pending: without_pending(admin.overview, input.section),
        error: null,
      })
    )
  return replace(
    admin,
    Object.freeze({
      ...admin.overview,
      ranges,
      pending: Object.freeze({
        ...admin.overview.pending,
        [input.section]: Object.freeze({ days: input.days, request_id: null }),
      }),
      error: null,
    })
  )
}

const mark_section_requested = (
  admin: AdminState,
  input: Extract<AppInput, { type: 'admin/overview_section_requested' }>
): AdminState | null => {
  const pending = admin.overview.pending[input.section]
  if (pending?.request_id !== null) return null
  return replace(
    admin,
    Object.freeze({
      ...admin.overview,
      pending: Object.freeze({
        ...admin.overview.pending,
        [input.section]: Object.freeze({ ...pending, request_id: input.request_id }),
      }),
    })
  )
}

const command = (admin: AdminState, input: AppInput): AdminState | null => {
  if (input.type === 'admin/overview_range_changed')
    return input.days === admin.overview.ranges[input.section] ? null : change_range(admin, input)
  if (input.type === 'admin/overview_refresh' && admin.overview.status !== 'loading')
    return replace(admin, Object.freeze({ ...admin.overview, status: 'loading', request_id: null, error: null }))
  if (input.type === 'admin/overview_requested' && admin.overview.status === 'loading')
    return replace(admin, Object.freeze({ ...admin.overview, request_id: input.request_id }))
  if (input.type === 'admin/overview_section_requested') return mark_section_requested(admin, input)
  return null
}

const full_response = (admin: AdminState, input: Extract<AppInput, { type: 'server/packet' }>): AdminState | null => {
  const { packet } = input
  if (packet.type !== 'packet/admin_response' || packet.kind !== 'overview' || packet.id !== admin.overview.request_id)
    return null
  const rows = section_rows(packet.result)
  const base = Object.freeze({
    ...(admin.overview.result ?? packet.result),
    as_of_checkpoint: packet.result.as_of_checkpoint,
    as_of_ms: packet.result.as_of_ms,
  })
  const result = rows.reduce(
    (current, row) => (row.data.days === admin.overview.ranges[row.section] ? with_section(current, row) : current),
    base
  )
  const cache = Object.freeze({
    ...admin.overview.cache,
    ...Object.fromEntries(rows.map((row) => [cache_key(row.section, row.data.days), row])),
  })
  return replace(
    admin,
    Object.freeze({
      ...admin.overview,
      status: 'ready',
      request_id: null,
      result,
      cache,
      error: null,
    })
  )
}

const section_response = (
  admin: AdminState,
  input: Extract<AppInput, { type: 'server/packet' }>
): AdminState | null => {
  const { packet } = input
  if (packet.type !== 'packet/admin_response' || packet.kind !== 'overview_section') return null
  const row = packet.result
  if (admin.overview.pending[row.section]?.request_id !== packet.id || !admin.overview.result) return null
  return replace(
    admin,
    Object.freeze({
      ...admin.overview,
      result: with_section(admin.overview.result, row),
      cache: Object.freeze({ ...admin.overview.cache, [cache_key(row.section, row.data.days)]: row }),
      pending: without_pending(admin.overview, row.section),
      error: null,
    })
  )
}

const packet_error = (
  admin: AdminState,
  packet: Extract<Extract<AppInput, { type: 'server/packet' }>['packet'], { type: 'packet/error' }>
): AdminState | null => {
  if (packet.id === admin.overview.request_id)
    return replace(
      admin,
      Object.freeze({ ...admin.overview, status: 'failed', request_id: null, error: packet.reason })
    )
  const request_id = packet.id
  const failed = Object.entries(admin.overview.pending).find(
    ([, pending]) => pending?.request_id === request_id
  )?.[0] as AdminOverviewSection | undefined
  return failed
    ? replace(
        admin,
        Object.freeze({
          ...admin.overview,
          pending: without_pending(admin.overview, failed),
          error: packet.reason,
        })
      )
    : null
}

const error_response = (admin: AdminState, input: AppInput): AdminState | null => {
  if (input.type === 'admin/overview_section_failed')
    return replace(
      admin,
      Object.freeze({ ...admin.overview, pending: without_pending(admin.overview, input.section), error: input.error })
    )
  if (input.type === 'admin/overview_failed' && admin.overview.status === 'loading')
    return replace(admin, Object.freeze({ ...admin.overview, status: 'failed', request_id: null, error: input.error }))
  return input.type === 'server/packet' && input.packet.type === 'packet/error'
    ? packet_error(admin, input.packet)
    : null
}

export const reduce_admin_overview = (admin: AdminState, input: AppInput): AdminState | null => {
  const reduced = command(admin, input)
  if (reduced) return reduced
  if (input.type === 'server/packet')
    return full_response(admin, input) ?? section_response(admin, input) ?? error_response(admin, input)
  return error_response(admin, input)
}
