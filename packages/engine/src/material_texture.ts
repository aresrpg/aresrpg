// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { DataArrayTexture, LinearMipmapLinearFilter, NearestFilter, RepeatWrapping, SRGBColorSpace } from 'three'

import { MATERIAL_TEXTURE_VARIANTS, material_pattern } from './material_presets.ts'
import type { CompiledMaterials } from './world_materials.ts'

export const MATERIAL_TEXTURE_SIZE = 32
const srgb_channel = (linear: number): number =>
  linear <= 0.0031308 ? linear * 12.92 : 1.055 * linear ** (1 / 2.4) - 0.055

const byte = (value: number): number => Math.round(Math.min(1, Math.max(0, value)) * 255)

export const create_material_texture_data = (
  materials: CompiledMaterials,
  size = MATERIAL_TEXTURE_SIZE,
  variants = MATERIAL_TEXTURE_VARIANTS
): Uint8Array => {
  const data = new Uint8Array(materials.entries.length * variants * size * size * 4)
  materials.entries.forEach((material, material_id) => {
    for (let variant = 0; variant < variants; variant += 1) {
      for (let y = 0; y < size; y += 1) {
        for (let x = 0; x < size; x += 1) {
          const offset = (((material_id * variants + variant) * size + y) * size + x) * 4
          const modulation = 1 + material_pattern(material.preset, x, y, variant)
          data[offset] = byte(srgb_channel(material.color[0]) * modulation)
          data[offset + 1] = byte(srgb_channel(material.color[1]) * modulation)
          data[offset + 2] = byte(srgb_channel(material.color[2]) * modulation)
          data[offset + 3] = material_id === 0 ? 0 : 255
        }
      }
    }
  })
  return data
}

export const create_material_texture = (materials: CompiledMaterials): DataArrayTexture => {
  const texture = new DataArrayTexture(
    create_material_texture_data(materials),
    MATERIAL_TEXTURE_SIZE,
    MATERIAL_TEXTURE_SIZE,
    materials.entries.length * MATERIAL_TEXTURE_VARIANTS
  )
  texture.magFilter = NearestFilter
  texture.minFilter = LinearMipmapLinearFilter
  texture.generateMipmaps = true
  texture.wrapS = RepeatWrapping
  texture.wrapT = RepeatWrapping
  texture.colorSpace = SRGBColorSpace
  texture.needsUpdate = true
  return texture
}
