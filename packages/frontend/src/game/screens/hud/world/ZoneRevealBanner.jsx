// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// ZONE-REVEAL BANNER (SEARCH-ZONE JUICE) — the center-screen cinematic reward when an [F] search resolves
// — sound, a popup effect, and plenty of feedback on a successful search. Pure presentation: the SEAM (discovery_actions.js) fires the discovery chime + the walk-cam
// FOV pulse + reveal_zone() on tx success; this just renders the current reveal slot with the findings
// count ("3 MOB GROUPS · 2 RESOURCE NODES") from the on-chain ZoneSearched event. A snappy flash (the ONE
// house moment that breaks slow-atmospheric, by design) that unmounts when the store self-clears (2.5s).
// Reduced-motion is handled in CSS (a pure crossfade, no scale/slide) — the banner still shows.

import { useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'

import { zone_reveal_store } from '../../../core/toast.js'

/** @returns {import('react').ReactElement | null} */
export function ZoneRevealBanner() {
  const { t } = useTranslation()
  const reveal = useSyncExternalStore(zone_reveal_store.subscribe, zone_reveal_store.get)
  if (!reveal) return null

  const parts = []
  if (reveal.mob_groups > 0) parts.push(t('discovery.reveal_mobs', { count: reveal.mob_groups }))
  if (reveal.resource_nodes > 0) parts.push(t('discovery.reveal_nodes', { count: reveal.resource_nodes }))
  const findings = parts.length ? parts.join(' · ') : t('discovery.reveal_empty')

  return (
    // key={id} remounts per reveal so the flash animation replays on back-to-back searches.
    <div key={reveal.id} className="gw-reveal" role="status" aria-live="assertive">
      <div className="gw-reveal__title">{t('discovery.zone_revealed')}</div>
      <div className="gw-reveal__coords">{t('discovery.zone_coords', { zx: reveal.zx, zy: reveal.zy })}</div>
      <div className="gw-reveal__findings">{findings}</div>
    </div>
  )
}
