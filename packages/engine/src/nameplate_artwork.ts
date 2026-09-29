// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { WorldCaption } from './caption_types.ts'

/** Lazy, lifecycle-scoped image loads; the raster revision invalidates already-uploaded atlas tiles. */
export const create_nameplate_artwork = (changed: () => void) => {
  const sources = {
    green: new URL('../../../seed/icons/nameplates/veteran_ethereal_plate.png', import.meta.url).href,
    red: new URL('../../../seed/icons/nameplates/admin_dragon_plate.png', import.meta.url).href,
  }
  const images = new Map<string, HTMLImageElement>()
  let revision = 0
  const load = (key: keyof typeof sources): HTMLImageElement | null => {
    const existing = images.get(key)
    if (existing) return existing.complete && existing.naturalWidth > 0 ? existing : null
    const image = new Image()
    images.set(key, image)
    image.onload = () => {
      revision++
      changed()
    }
    image.onerror = () => console.warn(`Nameplate artwork failed to load: ${sources[key]}`)
    image.src = sources[key]
    return null
  }
  return {
    revision: () => revision,
    get: (tone: NonNullable<WorldCaption['tone']>): HTMLImageElement | null => (tone === 'neutral' ? null : load(tone)),
    dispose: () => {
      images.forEach((image) => {
        image.onload = null
        image.onerror = null
        image.src = ''
      })
      images.clear()
    },
  }
}
