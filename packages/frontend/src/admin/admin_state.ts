// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { SeedAdminConfig, SeedAdminSnapshot } from '@aresrpg/sdk/seed-admin'
import type { ContractArtifact } from '@aresrpg/sdk/deployment-admin'

import type { AuthSession } from '../auth.ts'

export type AdminStatus = 'idle' | 'loading' | 'ready' | 'executing' | 'failed'
export type AdminProgress = Readonly<{
  phase: 'inspection' | 'publishing' | 'cleanup'
  current: number
  total: number
  label: string | null
}>
export type AdminView = 'overview' | 'publish'
export type AdminLogEntry = Readonly<{
  id: number
  tone: 'info' | 'success' | 'error'
  message: string
}>
export type AdminOverviewState = Readonly<{
  status: 'idle' | 'loading' | 'ready' | 'failed'
  request_id: number | null
  counts: Readonly<Record<string, number>>
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
export type DeploymentPins = Readonly<{
  package: string | null
  package_original?: string | null
  kiosk_package?: string | null
  math_package: string | null
  math_package_original?: string | null
  upgrade_cap: string | null
  math_upgrade_cap: string | null
  admin_cap: string | null
  publisher: string | null
  item_publisher?: string | null
  character_publisher?: string | null
  version: Readonly<{ id: string | null; shared_version: string | null }>
  template_registry: Readonly<{ id: string | null; shared_version: string | null }>
  loot_registry: Readonly<{ id: string | null; shared_version: string | null }>
  item_policy?: Readonly<{ id: string | null; shared_version: string | null }>
  character_policy?: Readonly<{ id: string | null; shared_version: string | null }>
  item_protected_policy?: Readonly<{ id: string | null; shared_version: string | null }>
  character_protected_policy?: Readonly<{ id: string | null; shared_version: string | null }>
  worlds: Readonly<Record<string, Readonly<{ id: string; shared_version: string }>>>
}>
export type AdminDeploymentState = Readonly<{
  status:
    | 'idle'
    | 'loading'
    | 'ready'
    | 'compiling'
    | 'publishing'
    | 'upgrading'
    | 'resetting'
    | 'operating'
    | 'failed'
    | 'unavailable'
  network: 'testnet' | 'mainnet' | null
  token: string
  revision: string
  pins: DeploymentPins | null
  artifact: ContractArtifact | null
  paused: boolean | null
  operation: 'compile' | 'publish' | 'upgrade' | 'republish' | 'pause' | 'resume' | null
  republish_armed: boolean
  error: string | null
}>
export type AdminState = Readonly<{
  view: AdminView
  overview: AdminOverviewState
  wallet: AdminWalletState
  deployment: AdminDeploymentState
  config: SeedAdminConfig
  snapshot: SeedAdminSnapshot | null
  status: AdminStatus
  operation: Readonly<
    { type: 'batch'; batch: string } | { type: 'all' } | { type: 'release' } | { type: 'seal' }
  > | null
  progress: AdminProgress | null
  cleanup: 'unknown' | 'needed' | 'closed'
  log: readonly AdminLogEntry[]
  seal_armed: boolean
  error: string | null
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
  | Readonly<{ type: 'admin/view_changed'; view: AdminView }>
  | Readonly<{ type: 'admin/overview_refresh' }>
  | Readonly<{ type: 'admin/overview_requested'; request_id: number }>
  | Readonly<{ type: 'admin/overview_failed'; error: string; request_id?: number }>
  | Readonly<{ type: 'admin/deployment_load' }>
  | Readonly<{
      type: 'admin/deployment_loaded'
      network: 'testnet' | 'mainnet'
      token: string
      revision: string
      pins: DeploymentPins
    }>
  | Readonly<{ type: 'admin/deployment_unavailable' }>
  | Readonly<{ type: 'admin/contracts_compile' }>
  | Readonly<{ type: 'admin/contracts_compiled'; artifact: ContractArtifact }>
  | Readonly<{ type: 'admin/contracts_publish' }>
  | Readonly<{ type: 'admin/contracts_published'; revision: string; pins: DeploymentPins }>
  | Readonly<{ type: 'admin/contracts_upgrade' }>
  | Readonly<{ type: 'admin/contracts_upgraded'; revision: string; pins: DeploymentPins }>
  | Readonly<{ type: 'admin/republish_armed'; armed: boolean }>
  | Readonly<{ type: 'admin/contracts_republish' }>
  | Readonly<{ type: 'admin/contracts_republished'; revision: string; pins: DeploymentPins }>
  | Readonly<{ type: 'admin/game_pause'; paused: boolean }>
  | Readonly<{ type: 'admin/game_pause_discovered'; paused: boolean }>
  | Readonly<{ type: 'admin/game_pause_changed'; paused: boolean }>
  | Readonly<{ type: 'admin/deployment_failed'; error: string }>
  | Readonly<{ type: 'admin/log'; tone?: AdminLogEntry['tone']; message: string }>
  | Readonly<{ type: 'admin/progress'; progress: AdminProgress }>
  | Readonly<{ type: 'admin/refresh' }>
  | Readonly<{ type: 'admin/refreshed'; snapshot: SeedAdminSnapshot }>
  | Readonly<{ type: 'admin/execute'; batch: string }>
  | Readonly<{ type: 'admin/publish_all' }>
  | Readonly<{ type: 'admin/publish_all_succeeded'; snapshot: SeedAdminSnapshot }>
  | Readonly<{ type: 'admin/release' }>
  | Readonly<{ type: 'admin/released' }>
  | Readonly<{ type: 'admin/batch_succeeded'; batch: string; snapshot: SeedAdminSnapshot }>
  | Readonly<{ type: 'admin/seal_armed'; armed: boolean }>
  | Readonly<{ type: 'admin/seal' }>
  | Readonly<{ type: 'admin/sealed'; snapshot: SeedAdminSnapshot }>
  | Readonly<{ type: 'admin/failed'; error: string }>

export const initial_admin_state = (): AdminState =>
  Object.freeze({
    view: 'overview',
    overview: Object.freeze({ status: 'idle', request_id: null, counts: Object.freeze({}), error: null }),
    wallet: Object.freeze({
      status: 'loading',
      wallets: Object.freeze([]),
      requested_wallet: null,
      accounts: Object.freeze([]),
      requested_address: null,
      session: null,
      error: null,
    }),
    deployment: Object.freeze({
      status: 'idle',
      network: null,
      token: '',
      revision: '',
      pins: null,
      artifact: null,
      paused: null,
      operation: null,
      republish_armed: false,
      error: null,
    }),
    config: Object.freeze({ admin_cap: '', worlds: Object.freeze({}) }),
    snapshot: null,
    status: 'idle',
    operation: null,
    progress: null,
    cleanup: 'unknown',
    log: Object.freeze([]),
    seal_armed: false,
    error: null,
  })
