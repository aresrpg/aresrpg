// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { StatName } from '@aresrpg/immutable'

import type { Locale } from './locale.ts'

export type AppCopy = Readonly<{
  title: string
  body: string
  fatal: string
  world_unavailable_title: string
  world_unavailable: string
  chrome: string
  other: string
  continue: string
  quality: string
  low: string
  medium: string
  high: string
  flat_mode: string
  identity_connected: string
  sign_in_to_play: string
  loading_universe: string
  continue_google: string
  connect_wallet: string
  no_wallet: string
  watch_world: string
  sign_in: string
  drag_hint: string
  navigation: string
  world: string
  characters: string
  leaderboard: string
  shop: string
  encyclopedia: string
  marketplace: string
  airdrop: string
  kolizeum: string
  settings: string
  admin: string
  online: string
  account: string
  join_discord: string
  sui_universe: string
  server_disconnected: string
  server_connecting: string
  server_reconnecting: string
  server_syncing: string
  server_connected: string
  server_violation: string
  latency_unit: string
  indexing_health: string
  online_players: string
  indexing_lag_warning: string
  game_frozen: string
  network_testnet: string
  page_pending_title: string
  page_pending_body: string
  welcome_title: string
  welcome_body: string
  welcome_need_sui: string
  insufficient_sui: string
  create_character: string
  create_title: string
  create_lead: string
  class_label: string
  sex_label: string
  appearance_label: string
  name_label: string
  name_placeholder: string
  name_invalid: string
  male: string
  female: string
  cancel: string
  create_and_play: string
  character_price: string
  creating_character: string
  character_created: string
  address_verification_failed: string
  dismiss: string
  wallet_copy_address: string
  wallet_send: string
  wallet_add_funds: string
  wallet_gas_spent: string
  wallet_disconnect: string
  wallet_fund_body: string
  wallet_send_title: string
  wallet_recipient: string
  wallet_amount: string
  wallet_send_pending: string
  wallet_send_success: string
  wallet_send_failed: string
  wallet_close: string
  wallet_legacy: Readonly<Record<string, unknown>>
  wallet_send_shared: Readonly<Record<string, string>>
  encyclopedia_page: Readonly<Record<string, unknown>>
  simulator_page: Readonly<Record<string, string>>
  fight_hud: Readonly<Record<string, string>>
  admin_page: Readonly<Record<string, string>>
  shop_page: Readonly<Record<string, unknown>>
  airdrop_page: Readonly<Record<string, unknown>>
  settings_page: Readonly<Record<string, string>>
  demo_page: Readonly<Record<string, string>>
  world_hud: Readonly<Record<string, string>>
}>

export type CopyNode = Readonly<Record<string, unknown>>
export type CopyText = (key: string, values?: Readonly<Record<string, string | number>>) => string

export const copy_text =
  (copy: CopyNode): CopyText =>
  (key, values = {}) => {
    const value = key
      .split('.')
      .reduce<unknown>(
        (node, part) => (typeof node === 'object' && node !== null ? (node as CopyNode)[part] : null),
        copy
      )
    if (typeof value !== 'string') return key
    return Object.entries(values).reduce(
      (rendered, [name, replacement]) => rendered.replaceAll(`{{${name}}}`, String(replacement)),
      value
    )
  }

export const stat_name = (copy: AppCopy, stat: StatName): string => copy.simulator_page[`stat_${stat}`] ?? stat

const loaders: Readonly<Record<Locale, () => Promise<{ default: unknown }>>> = Object.freeze({
  de: () => import('./locales/de.yaml'),
  en: () => import('./locales/en.yaml'),
  es: () => import('./locales/es.yaml'),
  fr: () => import('./locales/fr.yaml'),
  ja: () => import('./locales/ja.yaml'),
  uk: () => import('./locales/uk.yaml'),
})

export const load_app_copy = async (locale: Locale): Promise<AppCopy> => (await loaders[locale]()).default as AppCopy
