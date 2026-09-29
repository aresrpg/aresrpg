// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { DataTexture, LinearFilter, LinearMipmapLinearFilter, RepeatWrapping } from 'three'

import { mushroom_surface } from './mushroom_texture.ts'
import type { RecipeVertex } from './sprite_kit.ts'

export type NatureSurface = 'plain' | 'plant' | 'mineral' | 'mushroom'
const TILE = 128
const SURFACES: readonly NatureSurface[] = ['plain', 'plant', 'mineral', 'mushroom']
const noise = (x: number, y: number): number => {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453
  return n - Math.floor(n)
}
const plant_surface = (u: number, v: number): number => {
  const midrib = Math.exp(-Math.abs(u - 0.5) * 65) * 0.2
  const veins = Math.exp(-Math.abs(Math.sin((v * 9 - Math.abs(u - 0.5) * 2.5) * Math.PI)) * 14) * 0.16
  const edge = Math.abs(u - 0.5) * 0.18
  return 0.82 + midrib + veins - edge + noise(Math.floor(u * 96), Math.floor(v * 96)) * 0.08
}
const mineral_surface = (u: number, v: number): number => {
  if (v < 0.26) return 0.64 + noise(Math.floor(u * 32), Math.floor(v * 128)) * 0.3
  const fibres = Math.sin(u * Math.PI * 22 + Math.sin(v * 19) * 0.25)
  const fractures = Math.exp(-Math.abs(Math.sin(v * 41 + u * 3)) * 28) * 0.22
  return 0.72 + fibres * 0.1 + fractures + Math.sin(u * 91) * 0.04
}
const SURFACE_SAMPLERS: Readonly<Record<NatureSurface, (u: number, v: number) => number>> = Object.freeze({
  plain: () => 1,
  plant: plant_surface,
  mineral: mineral_surface,
  mushroom: mushroom_surface,
})
export const nature_surface = (kind: NatureSurface, u: number, v: number): number =>
  Math.max(0, Math.min(1, SURFACE_SAMPLERS[kind](u, v)))
export const nature_uv = (kind: NatureSurface, vertex: RecipeVertex): readonly [number, number] => {
  const surface = vertex.length === 7 ? kind : 'plain'
  return [
    vertex[5] ?? 0.5,
    (SURFACES.indexOf(surface) * TILE + 2 + (vertex[6] ?? 0.5) * (TILE - 4)) / (TILE * SURFACES.length),
  ]
}
/** One neutral four-tile atlas for every nature consumer. Author palettes continue to own all color. */
export const create_nature_texture = (): DataTexture => {
  const pixels = new Uint8Array(TILE * TILE * SURFACES.length * 4)
  SURFACES.forEach((kind, tile) => {
    for (let y = 0; y < TILE; y++)
      for (let x = 0; x < TILE; x++) {
        const shade = Math.round(nature_surface(kind, x / TILE, Math.max(0, Math.min(1, (y - 2) / (TILE - 4)))) * 255)
        pixels.set([shade, shade, shade, 255], ((tile * TILE + y) * TILE + x) * 4)
      }
  })
  const texture = new DataTexture(pixels, TILE, TILE * SURFACES.length)
  texture.name = 'Nature surfaces'
  texture.wrapS = RepeatWrapping
  texture.magFilter = LinearFilter
  texture.minFilter = LinearMipmapLinearFilter
  texture.generateMipmaps = true
  texture.needsUpdate = true
  return texture
}
