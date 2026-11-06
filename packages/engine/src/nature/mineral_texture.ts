// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { Color, DataTexture, NearestFilter, SRGBColorSpace } from 'three'

import type { MineralVisual } from './mineral_outcrop.ts'

/** Small identity atlas: original seed pixels, sharp filtering, no mip bleed between patterns. */
export const create_mineral_texture = (visual: MineralVisual): DataTexture => {
  const patterns = Object.values(visual.patterns)
  const width = patterns[0]![0]!.length
  const height = patterns[0]!.length
  const stride = width + 2
  const tile_height = height + 2
  const pixels = new Uint8Array(stride * tile_height * patterns.length * 4)
  const palette = visual.palette.map((hex) => new Color(hex).convertLinearToSRGB())
  patterns.forEach((pattern, tile) => {
    for (let y = 0; y < tile_height; y++) {
      for (let x = 0; x < stride; x++) {
        const row = pattern[Math.max(0, Math.min(height - 1, height - y))]!
        const band = row[Math.max(0, Math.min(width - 1, x - 1))]!
        const color = palette[Number(band)]!
        const offset = ((tile * tile_height + y) * stride + x) * 4
        pixels.set([Math.round(color.r * 255), Math.round(color.g * 255), Math.round(color.b * 255), 255], offset)
      }
    }
  })
  const texture = new DataTexture(pixels, stride, tile_height * patterns.length)
  texture.colorSpace = SRGBColorSpace
  texture.magFilter = NearestFilter
  texture.minFilter = NearestFilter
  texture.generateMipmaps = false
  texture.needsUpdate = true
  return texture
}
