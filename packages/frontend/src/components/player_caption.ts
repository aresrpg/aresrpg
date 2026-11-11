// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { WorldCaption } from '@aresrpg/engine'

import { is_admin_address } from '../admin_access.ts'
import { title_item } from '../content/items.ts'
import { nameplate_artwork_url } from '../content/assets.ts'

export const player_caption = (
  {
    name,
    title,
    owner,
    admin_label,
    title_names,
    speech,
  }: Readonly<{
    name: string
    title: string | null
    owner: string | null
    admin_label: string
    title_names: Readonly<Record<string, string>>
    speech?: string
  }>,
  resolve_artwork = nameplate_artwork_url
): WorldCaption => {
  const admin = is_admin_address(owner)
  const item = title_item(title) ?? { name: undefined, title_nameplate: undefined }
  const rank = admin
    ? { name: admin_label, artwork: 'admin_dragon_plate', color: '#ffb8b9' }
    : {
        name: title_names[title ?? ''] ?? item.name,
        artwork: item.title_nameplate,
        color: title === 'title_veteran' ? '#a9f5cb' : undefined,
      }

  return {
    name,
    variant: 'nameplate',
    artwork_url: resolve_artwork(rank.artwork),
    lines: rank.name ? [{ text: rank.name, color: rank.color }] : [],
    speech,
  }
}
