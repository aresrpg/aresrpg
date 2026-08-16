// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { SeedAdminConfig, SeedAdminSnapshot } from '@aresrpg/sdk/seed-admin'

import type { AuthSession } from '../auth.ts'

import type { JsonPath, JsonValue, SeedDomain, SeedFileName } from './seed_editor.ts'

export type AdminStatus = 'idle' | 'loading' | 'ready' | 'executing' | 'failed'
export type AdminView = 'overview' | 'content' | 'biomes' | 'publish'
export type SeedEditorStatus = 'idle' | 'loading' | 'ready' | 'saving' | 'unavailable' | 'failed'
export type SeedFileDraft = Readonly<{
  file: SeedFileName
  revision: string
  value: JsonValue
  saved_value: JsonValue
  dirty: boolean
  validation: Readonly<{ reds: readonly string[]; warns: readonly string[] }> | null
}>
export type SeedEditorState = Readonly<{
  status: SeedEditorStatus
  token: string
  files: Readonly<Partial<Record<SeedDomain, SeedFileDraft>>>
  domain: SeedDomain
  entity_id: string | null
  query: string
  saving_domain: SeedDomain | null
  validation: Readonly<{ reds: readonly string[]; warns: readonly string[] }> | null
  error: string | null
}>
export type AdminOverviewState = Readonly<{
  status: 'idle' | 'loading' | 'ready' | 'failed'
  request_id: number | null
  counts: Readonly<Record<string, number>>
  error: string | null
}>
export type AdminWalletState = Readonly<{
  status: 'loading' | 'ready' | 'connecting' | 'connected'
  wallets: readonly string[]
  requested_wallet: string | null
  session: AuthSession | null
  error: string | null
}>
export type AdminState = Readonly<{
  view: AdminView
  editor: SeedEditorState
  overview: AdminOverviewState
  wallet: AdminWalletState
  config: SeedAdminConfig
  snapshot: SeedAdminSnapshot | null
  status: AdminStatus
  operation: Readonly<{ type: 'batch'; batch: string } | { type: 'seal' }> | null
  seal_armed: boolean
  error: string | null
}>

export type AdminInput =
  | Readonly<{ type: 'admin/wallets_loaded'; wallets: readonly string[] }>
  | Readonly<{ type: 'admin/wallet_connect'; wallet_name: string }>
  | Readonly<{ type: 'admin/wallet_connected'; session: AuthSession }>
  | Readonly<{ type: 'admin/wallet_disconnect' }>
  | Readonly<{ type: 'admin/wallet_disconnected' }>
  | Readonly<{ type: 'admin/wallet_failed'; error: string }>
  | Readonly<{ type: 'admin/view_changed'; view: AdminView }>
  | Readonly<{ type: 'admin/editor_load' }>
  | Readonly<{
      type: 'admin/editor_loaded'
      token: string
      files: readonly Readonly<{ file: SeedFileName; revision: string; value: JsonValue }>[]
      validation: Readonly<{ reds: readonly string[]; warns: readonly string[] }>
    }>
  | Readonly<{ type: 'admin/editor_unavailable' }>
  | Readonly<{ type: 'admin/editor_domain_selected'; domain: SeedDomain }>
  | Readonly<{ type: 'admin/editor_entity_selected'; entity_id: string | null }>
  | Readonly<{ type: 'admin/editor_query_changed'; query: string }>
  | Readonly<{ type: 'admin/editor_value_changed'; domain: SeedDomain; path: JsonPath; value: JsonValue }>
  | Readonly<{ type: 'admin/editor_reset'; domain: SeedDomain }>
  | Readonly<{ type: 'admin/editor_save'; domain: SeedDomain }>
  | Readonly<{
      type: 'admin/editor_saved'
      domain: SeedDomain
      revision: string
      value: JsonValue
      validation: Readonly<{ reds: readonly string[]; warns: readonly string[] }>
    }>
  | Readonly<{ type: 'admin/editor_failed'; error: string }>
  | Readonly<{ type: 'admin/overview_refresh' }>
  | Readonly<{ type: 'admin/overview_requested'; request_id: number }>
  | Readonly<{ type: 'admin/overview_failed'; error: string; request_id?: number }>
  | Readonly<{ type: 'admin/storage_loaded'; config: SeedAdminConfig }>
  | Readonly<{ type: 'admin/publisher_changed'; publisher: string }>
  | Readonly<{ type: 'admin/world_changed'; world: string; object_id: string }>
  | Readonly<{ type: 'admin/refresh' }>
  | Readonly<{ type: 'admin/refreshed'; snapshot: SeedAdminSnapshot }>
  | Readonly<{ type: 'admin/execute'; batch: string }>
  | Readonly<{ type: 'admin/batch_succeeded'; batch: string; snapshot: SeedAdminSnapshot }>
  | Readonly<{ type: 'admin/seal_armed'; armed: boolean }>
  | Readonly<{ type: 'admin/seal' }>
  | Readonly<{ type: 'admin/sealed'; snapshot: SeedAdminSnapshot }>
  | Readonly<{ type: 'admin/failed'; error: string }>

const initial_editor_state = (): SeedEditorState =>
  Object.freeze({
    status: 'idle',
    token: '',
    files: Object.freeze({}),
    domain: 'items',
    entity_id: null,
    query: '',
    saving_domain: null,
    validation: null,
    error: null,
  })

export const initial_admin_state = (): AdminState =>
  Object.freeze({
    view: 'overview',
    editor: initial_editor_state(),
    overview: Object.freeze({ status: 'idle', request_id: null, counts: Object.freeze({}), error: null }),
    wallet: Object.freeze({
      status: 'loading',
      wallets: Object.freeze([]),
      requested_wallet: null,
      session: null,
      error: null,
    }),
    config: Object.freeze({ publisher: '', worlds: Object.freeze({}) }),
    snapshot: null,
    status: 'idle',
    operation: null,
    seal_armed: false,
    error: null,
  })
