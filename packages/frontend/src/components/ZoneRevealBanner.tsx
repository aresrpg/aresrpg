// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Exact retained zone-discovery ceremony from the previous world HUD.

import type { AppCopy } from '../i18n/copy.ts'
import { copy_text } from '../i18n/copy.ts'
import { useAppStore } from '../store.ts'

import './zone_reveal_banner.css'

export const ZoneRevealBanner = ({ copy }: Readonly<{ copy: AppCopy }>) => {
  const reveal = useAppStore(({ world }) => world.zone_reveal)
  if (!reveal) return null
  const text = copy_text(copy.world_hud)
  const findings = [
    text('zone_mobs_found', { count: reveal.mobs }),
    text('zone_resources_found', { count: reveal.resources }),
    ...(reveal.dungeon ? [text('zone_dungeon_spotted')] : []),
  ]
  return (
    <div aria-live="assertive" className="gw-reveal" key={reveal.id} role="status">
      <div className="gw-reveal__title">{text('zone_revealed')}</div>
      <div className="gw-reveal__coords">{text('zone_coordinates', { zx: reveal.zx, zz: reveal.zz })}</div>
      <div className="gw-reveal__findings">{findings.join(' · ')}</div>
    </div>
  )
}
