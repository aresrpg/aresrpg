// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type {
  AdminOverviewResult,
  AdminOverviewSection,
  AdminOverviewSectionResult,
  AdminRangeDays,
} from '@aresrpg/protocol'

export type AdminOverviewState = Readonly<{
  status: 'idle' | 'loading' | 'ready' | 'failed'
  request_id: number | null
  ranges: Readonly<Record<AdminOverviewSection, AdminRangeDays>>
  result: AdminOverviewResult | null
  cache: Readonly<Record<string, AdminOverviewSectionResult>>
  pending: Readonly<
    Partial<Record<AdminOverviewSection, Readonly<{ days: AdminRangeDays; request_id: number | null }>>>
  >
  error: string | null
}>
export type AdminState = Readonly<{
  overview: AdminOverviewState
}>

export type AdminInput =
  | Readonly<{ type: 'admin/overview_refresh' }>
  | Readonly<{
      type: 'admin/overview_range_changed'
      section: keyof AdminOverviewState['ranges']
      days: AdminRangeDays
    }>
  | Readonly<{ type: 'admin/overview_requested'; request_id: number }>
  | Readonly<{ type: 'admin/overview_section_requested'; section: AdminOverviewSection; request_id: number }>
  | Readonly<{ type: 'admin/overview_section_failed'; section: AdminOverviewSection; error: string }>
  | Readonly<{ type: 'admin/overview_failed'; error: string; request_id?: number }>

export const initial_admin_state = (): AdminState =>
  Object.freeze({
    overview: Object.freeze({
      status: 'idle',
      request_id: null,
      ranges: Object.freeze({
        revenue: 30,
        players: 30,
        transactions: 30,
        online: 1,
        addresses: 30,
        characters: 30,
      }),
      result: null,
      cache: Object.freeze({}),
      pending: Object.freeze({}),
      error: null,
    }),
  })
