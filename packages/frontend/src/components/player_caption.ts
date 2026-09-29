// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { WorldCaption } from '@aresrpg/engine'

import { is_admin_address } from '../admin_access.ts'
import { content_catalog } from '../content/catalog.ts'

export const player_caption = ({
  name,
  title,
  owner,
  admin_label,
  veteran_label,
  speech,
}: Readonly<{
  name: string
  title: string | null
  owner: string | null
  admin_label: string
  veteran_label: string
  speech?: string
}>): WorldCaption => {
  const admin = is_admin_address(owner)
  const title_name = title ? content_catalog.item(title)?.item.name : null
  const subtitle = admin ? admin_label : title === 'title_veteran' ? veteran_label : title_name
  return {
    name,
    variant: 'nameplate',
    tone: admin ? 'red' : title === 'title_veteran' ? 'green' : 'neutral',
    lines: subtitle ? [{ text: subtitle }] : [],
    speech,
  }
}
