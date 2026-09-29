// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

export const hud_key_action = ({
  code,
  panel,
  blocked,
  fighting,
}: Readonly<{
  code: string
  panel: boolean
  blocked: boolean
  fighting: boolean
}>): 'fullscreen' | 'close' | 'inventory' | 'leave' | null => {
  switch (code) {
    case 'KeyO':
      return 'fullscreen'
    case 'KeyE':
      return panel ? 'close' : blocked || fighting ? null : 'inventory'
    case 'Escape':
      return blocked ? null : 'leave'
    default:
      return null
  }
}
