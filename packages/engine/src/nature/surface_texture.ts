// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { DataTexture, LinearFilter, LinearMipmapLinearFilter, RepeatWrapping } from 'three'

import { nature_surface, NATURE_TILE, NATURE_SURFACES } from './surface.ts'

/** One neutral four-tile atlas for every nature consumer. Author palettes continue to own all color. */
export const create_nature_texture = (): DataTexture => {
  const pixels = new Uint8Array(NATURE_TILE * NATURE_TILE * NATURE_SURFACES.length * 4)
  NATURE_SURFACES.forEach((kind, tile) => {
    for (let y = 0; y < NATURE_TILE; y++)
      for (let x = 0; x < NATURE_TILE; x++) {
        const shade = Math.round(
          nature_surface(kind, x / NATURE_TILE, Math.max(0, Math.min(1, (y - 2) / (NATURE_TILE - 4)))) * 255
        )
        pixels.set([shade, shade, shade, 255], ((tile * NATURE_TILE + y) * NATURE_TILE + x) * 4)
      }
  })
  const texture = new DataTexture(pixels, NATURE_TILE, NATURE_TILE * NATURE_SURFACES.length)
  texture.name = 'Nature surfaces'
  texture.wrapS = RepeatWrapping
  texture.magFilter = LinearFilter
  texture.minFilter = LinearMipmapLinearFilter
  texture.generateMipmaps = true
  texture.needsUpdate = true
  return texture
}
