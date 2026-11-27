// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The site's modules: the account, its link and the public reads. The site loads no game code; a game
// module never appears here, and the boundary test walks this file's imports to prove it.
import type { AppCopy } from './i18n/copy.ts'
import type { Locale } from './i18n/locale.ts'
import admin, { type AdminInput, type AdminState } from './modules/admin.ts'
import analytics, { type AnalyticsInput, type AnalyticsState } from './modules/analytics.ts'
import claims, { type ClaimsInput } from './modules/claims.ts'
import chain_clock, { type ChainClock, type ChainClockInput } from './modules/chain_clock.ts'
import distribution, { type DistributionInput, type DistributionState } from './modules/distribution.ts'
import external_wallet, { type ExternalWalletInput, type ExternalWalletState } from './modules/external_wallet.ts'
import funding, { type FundingInput, type FundingState } from './modules/funding.ts'
import hosted_agent from './modules/hosted_agent.ts'
import leaderboards, { type LeaderboardsInput, type LeaderboardsState } from './modules/leaderboards.ts'
import locale, { type LocaleInput } from './modules/locale.ts'
import location, { type LocationInput, type LocationState } from './modules/location.ts'
import marketplace, { type MarketplaceInput, type MarketplaceState } from './modules/marketplace.ts'
import mastery, { type MasteryInput, type MasteryState } from './modules/mastery.ts'
import session, { type SessionInput, type SessionState } from './modules/session.ts'
import suins, { type SuinsInput, type SuinsState } from './modules/suins.ts'
import trade, { type TradeInput, type TradeState } from './modules/trade.ts'
import wallet_import, { type WalletImportInput, type WalletImportState } from './modules/wallet_import.ts'
import type { SiteModule } from './store.ts'

export type SiteState = Readonly<{
  session: SessionState
  location: LocationState
  locale: Locale
  copy: AppCopy | null
  analytics: AnalyticsState
  suins: SuinsState
  chain_clock: ChainClock
  external_wallet: ExternalWalletState
  funding: FundingState
  marketplace: MarketplaceState
  leaderboards: LeaderboardsState
  trade: TradeState
  mastery: MasteryState
  distribution: DistributionState
  wallet_import: WalletImportState
  claim_failures: readonly string[]
  admin: AdminState
}>

export type SiteInput =
  | SessionInput
  | LocationInput
  | LocaleInput
  | AnalyticsInput
  | SuinsInput
  | ChainClockInput
  | ExternalWalletInput
  | FundingInput
  | MarketplaceInput
  | LeaderboardsInput
  | TradeInput
  | MasteryInput
  | DistributionInput
  | WalletImportInput
  | ClaimsInput
  | AdminInput

/** Reducers fold in this order: the session first, so every other module reads the account it ends on. */
export const SITE_MODULES: readonly SiteModule[] = Object.freeze([
  session,
  location,
  hosted_agent,
  // Hosted-bot consent names the agent wallet through SuiNS.
  suins,
  chain_clock,
  external_wallet,
  analytics,
  locale,
  funding,
  marketplace,
  leaderboards,
  // What locks an item is part of the account's bag: the site folds the trades the server sends with it.
  trade,
  // The staking page sells the Mastery shop and collects giftcards: chain writes, no world.
  mastery,
  // A crate bought in the shop opens on the page: the same collector settles its roll.
  claims,
  distribution,
  // The portfolio offers the one import window too: the account's chain writes, no world.
  wallet_import,
  // The admin page: dashboard reads over the same socket, answered for the admin address alone.
  admin,
])
