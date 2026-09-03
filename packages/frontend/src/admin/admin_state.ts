// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type {
  AdminOverviewResult,
  AdminOverviewSection,
  AdminOverviewSectionResult,
  AdminRangeDays,
} from '@aresrpg/protocol'

import type { AuthSession } from '../auth.ts'

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
export type AdminWalletState = Readonly<{
  status: 'loading' | 'ready' | 'connecting' | 'selecting' | 'connected'
  wallets: readonly string[]
  requested_wallet: string | null
  accounts: readonly string[]
  requested_address: string | null
  session: AuthSession | null
  error: string | null
}>
export type AdminState = Readonly<{
  overview: AdminOverviewState
  wallet: AdminWalletState
}>

export type AdminInput =
  | Readonly<{ type: 'admin/wallets_loaded'; wallets: readonly string[] }>
  | Readonly<{ type: 'admin/wallet_connect'; wallet_name: string }>
  | Readonly<{ type: 'admin/wallet_accounts_loaded'; accounts: readonly string[] }>
  | Readonly<{ type: 'admin/wallet_account_select'; address: string }>
  | Readonly<{ type: 'admin/wallet_picker_cancel' }>
  | Readonly<{ type: 'admin/wallet_connected'; session: AuthSession }>
  | Readonly<{ type: 'admin/wallet_disconnect' }>
  | Readonly<{ type: 'admin/wallet_disconnected' }>
  | Readonly<{ type: 'admin/wallet_failed'; error: string }>
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
    wallet: Object.freeze({
      status: 'loading',
      wallets: Object.freeze([]),
      requested_wallet: null,
      accounts: Object.freeze([]),
      requested_address: null,
      session: null,
      error: null,
    }),
  })
