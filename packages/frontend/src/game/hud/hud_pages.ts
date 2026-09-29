// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { CarvedSymbol } from '@aresrpg/ui'
import type { AppCopy } from '../../i18n/copy.ts'
import type { Page } from '../../modules/navigation.ts'

type Label = { [K in keyof AppCopy]: AppCopy[K] extends string ? K : never }[keyof AppCopy]
export const HUD_PAGE_META: Readonly<Record<Page, Readonly<{ label: Label; icon: CarvedSymbol; class_name: string }>>> =
  {
    world: { label: 'world', icon: 'map', class_name: '' },
    characters: { label: 'characters', icon: 'characters', class_name: 'aui-characters-port' },
    leaderboard: { label: 'leaderboard', icon: 'leaderboard', class_name: 'aui-rankings-port' },
    mastery: { label: 'mastery', icon: 'mastery', class_name: 'aui-mastery-port' },
    kares: { label: 'kares', icon: 'kares', class_name: 'aui-staking-port' },
    encyclopedia: { label: 'encyclopedia', icon: 'encyclopedia', class_name: 'aui-codex-port' },
    marketplace: { label: 'marketplace', icon: 'marketplace', class_name: 'aui-market-port' },
    airdrop: { label: 'airdrop', icon: 'airdrop', class_name: 'aui-airdrop-port' },
    kolizeum: { label: 'kolizeum', icon: 'kolizeum', class_name: 'aui-arena-port' },
    settings: { label: 'settings', icon: 'settings', class_name: 'aui-settings-port' },
    admin: { label: 'admin', icon: 'admin', class_name: 'aui-admin-port' },
  }
