// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { client_to_chain_coordinate } from '@aresrpg/immutable'
import { zone_of } from '@aresrpg/protocol'

import { item_icon } from '../../content/assets.ts'
import type { SpawnMarker } from '../../modules/world_spawns.ts'

/** Both map lenses share decoded item images; each paint owns its load listeners and current zone. */
export const create_map_resource_icons = () => {
  const images = new Map<string, HTMLImageElement>()
  return (pose: Readonly<{ x: number; z: number }>, paint: () => void) => {
    const zone = zone_of(client_to_chain_coordinate(pose.x), client_to_chain_coordinate(pose.z))
    const pending = new Set<HTMLImageElement>()
    let active = true
    let frame: number | null = null
    const repaint = (): void => {
      if (!active || frame !== null) return
      frame = requestAnimationFrame(() => {
        frame = null
        paint()
      })
    }
    return {
      image: (marker: Pick<SpawnMarker, 'zx' | 'zz' | 'item_type'>): HTMLImageElement | null => {
        if (marker.zx !== zone.zx || marker.zz !== zone.zz) return null
        const url = item_icon(marker.item_type ?? '')
        if (!url) return null
        let image = images.get(url)
        if (!image) {
          image = new Image()
          images.set(url, image)
          image.addEventListener('error', () => console.warn('Could not load map resource icon.', url), { once: true })
          image.src = url
        }
        if (!image.complete) {
          image.addEventListener('load', repaint, { once: true })
          pending.add(image)
          return null
        }
        return image.naturalWidth > 0 ? image : null
      },
      dispose: (): void => {
        active = false
        if (frame !== null) cancelAnimationFrame(frame)
        pending.forEach((image) => image.removeEventListener('load', repaint))
      },
    }
  }
}
export type MapResourceIcons = ReturnType<typeof create_map_resource_icons>
