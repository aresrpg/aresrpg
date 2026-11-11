// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/** Lazy, lifecycle-scoped image loads; the raster revision invalidates already-uploaded atlas tiles. */
export const create_nameplate_artwork = (changed: () => void) => {
  const images = new Map<string, HTMLImageElement>()
  let revision = 0
  const load = (url: string): HTMLImageElement | null => {
    const existing = images.get(url)
    if (existing) return existing.complete && existing.naturalWidth > 0 ? existing : null
    const image = new Image()
    images.set(url, image)
    image.onload = () => {
      revision++
      changed()
    }
    image.onerror = () => console.warn(`Nameplate artwork failed to load: ${url}`)
    image.src = url
    return null
  }
  return {
    revision: () => revision,
    get: (url: string | undefined): HTMLImageElement | null => (url ? load(url) : null),
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
