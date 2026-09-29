// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

export const DETAIL_TABS = ['equipment', 'stats', 'spells', 'jobs', 'runeforge'] as const
export type DetailTab = (typeof DETAIL_TABS)[number]

export const character_detail_tab = (pathname: string): DetailTab => {
  const tab = pathname.split('?')[0]?.split('#')[0]?.split('/').filter(Boolean)[1]
  return DETAIL_TABS.find((candidate) => candidate === tab) ?? 'equipment'
}

export const character_detail_path = (tab: DetailTab): string => `/characters/${tab}`
