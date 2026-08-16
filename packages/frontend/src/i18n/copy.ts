// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { Locale } from './locale.ts'

export type AppCopy = Readonly<{
  title: string
  body: string
  fatal: string
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
  simulator: string
  encyclopedia: string
  marketplace: string
  airdrop: string
  kolizeum: string
  settings: string
  admin: string
  online: string
  account: string
  join_discord: string
  page_pending_title: string
  page_pending_body: string
  welcome_title: string
  welcome_body: string
  create_character: string
  create_title: string
  create_lead: string
  class_label: string
  sex_label: string
  appearance_label: string
  name_label: string
  name_placeholder: string
  male: string
  female: string
  cancel: string
  create_and_play: string
  create_unavailable: string
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
}>

const loaders: Readonly<Record<Locale, () => Promise<{ default: unknown }>>> = Object.freeze({
  de: () => import('./locales/de.yaml'),
  en: () => import('./locales/en.yaml'),
  es: () => import('./locales/es.yaml'),
  fr: () => import('./locales/fr.yaml'),
  ja: () => import('./locales/ja.yaml'),
  uk: () => import('./locales/uk.yaml'),
})

export const load_app_copy = async (locale: Locale): Promise<AppCopy> => (await loaders[locale]()).default as AppCopy
