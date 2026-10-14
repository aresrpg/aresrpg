// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { DetailTab } from '../../characters/character_navigation.ts'

export const CHARACTER_SHORTCUTS = Object.freeze([
  { tab: 'equipment', key: 'E', action: 'inventory', closes: (panel: DetailTab | null) => panel !== null },
  { tab: 'jobs', key: 'J', action: 'jobs', closes: (panel: DetailTab | null) => panel === 'jobs' },
] as const)

export const hud_key_action = ({
  code,
  panel,
  blocked,
  fighting,
}: Readonly<{
  code: string
  panel: DetailTab | null
  blocked: boolean
  fighting: boolean
}>): 'fullscreen' | 'close' | 'inventory' | 'jobs' | 'leave' | null => {
  switch (code) {
    case 'KeyO':
      return 'fullscreen'
    case 'Escape':
      return blocked ? null : 'leave'
    default:
      break
  }
  const shortcut = CHARACTER_SHORTCUTS.find(({ key }) => code === `Key${key}`)
  if (!shortcut) return null
  if (shortcut.closes(panel)) return 'close'
  return blocked || fighting ? null : shortcut.action
}
