// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { copy_text, type AppCopy } from '../../i18n/copy.ts'

import { AirdropExample, MasteryExample } from './EconomyExamples.tsx'
import { JobsExample, RuneforgeExample } from './ProfessionExamples.tsx'
import { TitlesExample } from './TitlesExample.tsx'
import { PlayerProfileExample } from './PlayerProfileExample.tsx'
import { LeaderboardExample } from './DiscoveryExamples.tsx'
import { EncyclopediaExample } from './EncyclopediaExample.tsx'
import { AdminExample } from './AdminExample.tsx'
import { KolizeumExample } from './KolizeumExample.tsx'
import { TradeExample } from './TradeExample.tsx'
import { StakingExample } from './StakingExample.tsx'
import { MarketplaceExample } from './MarketplaceExample.tsx'
import { MinimapExample, WorldMapExample } from './MapExamples.tsx'
import {
  SettingsExample,
  WalletExample,
  LanguageExample,
  AccountToolsExample,
  CharacterSwitcherExample,
} from './AccountExamples.tsx'

export const SERVICE_PANELS = {
  titles: TitlesExample,
  minimap: MinimapExample,
  world_map: WorldMapExample,
  trade: TradeExample,
  mastery: MasteryExample,
  staking: StakingExample,
  marketplace: MarketplaceExample,
  airdrop: AirdropExample,
  professions: JobsExample,
  runeforge: RuneforgeExample,
  leaderboards: LeaderboardExample,
  player_profile: PlayerProfileExample,
  encyclopedia: EncyclopediaExample,
  kolizeum: KolizeumExample,
  admin: AdminExample,
  settings: SettingsExample,
  wallet: WalletExample,
  language: LanguageExample,
  account_tools: AccountToolsExample,
  character_switcher: CharacterSwitcherExample,
}
export type ServiceView = keyof typeof SERVICE_PANELS
export const service_options = (copy: AppCopy): readonly Readonly<{ value: ServiceView; label: string }>[] => [
  { value: 'titles', label: copy.ui.design_titles },
  { value: 'minimap', label: copy.ui.design_minimap },
  { value: 'world_map', label: copy.world_hud.world_map },
  { value: 'trade', label: copy.world_hud.menu_trade },
  { value: 'mastery', label: copy_text(copy.mastery_page)('title') },
  { value: 'staking', label: copy.kares_page.staking_title },
  { value: 'marketplace', label: copy_text(copy.marketplace_page)('title') },
  { value: 'airdrop', label: String(copy.airdrop_page.title) },
  { value: 'professions', label: copy_text(copy.characters_page)('tab_jobs') },
  { value: 'runeforge', label: copy_text(copy.characters_page)('tab_runeforge') },
  { value: 'leaderboards', label: copy.leaderboard },
  { value: 'player_profile', label: copy_text(copy.leaderboard_page)('profile_title') },
  { value: 'encyclopedia', label: copy.encyclopedia },
  { value: 'kolizeum', label: copy.kolizeum },
  { value: 'admin', label: copy.admin },
  { value: 'settings', label: copy.settings },
  { value: 'wallet', label: copy.account },
  { value: 'language', label: copy_text(copy.kares_page)('language') },
  { value: 'account_tools', label: copy.server_connected },
  { value: 'character_switcher', label: copy.characters },
]
