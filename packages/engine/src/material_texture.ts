// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { DataArrayTexture, LinearMipmapLinearFilter, NearestFilter, RepeatWrapping, SRGBColorSpace } from 'three'

import { material_micro_roughness, material_pattern, type MaterialPreset } from './material_presets.ts'
import type { CompiledMaterials } from './world_materials.ts'

const srgb_channel = (linear: number): number =>
  linear <= 0.0031308 ? linear * 12.92 : 1.055 * linear ** (1 / 2.4) - 0.055

const byte = (value: number): number => Math.round(Math.min(1, Math.max(0, value)) * 255)

export const create_material_texture_data = (materials: CompiledMaterials, size: number): Uint8Array => {
  const data = new Uint8Array(materials.entries.length * size * size * 4)
  const pattern_cache = new Map<MaterialPreset, Float32Array>()
  const patterns_for = (preset: MaterialPreset): Float32Array => {
    const cached = pattern_cache.get(preset)
    if (cached) return cached
    const patterns = new Float32Array(size * size)
    for (let y = 0; y < size; y += 1)
      for (let x = 0; x < size; x += 1) patterns[y * size + x] = material_pattern(preset, x, y, size)
    pattern_cache.set(preset, patterns)
    return patterns
  }
  materials.entries.forEach((material, material_id) => {
    const patterns = patterns_for(material.preset)
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const offset = ((material_id * size + y) * size + x) * 4
        const pattern = patterns[y * size + x]!
        const modulation = 1 + pattern
        data[offset] = byte(srgb_channel(material.color[0]) * modulation)
        data[offset + 1] = byte(srgb_channel(material.color[1]) * modulation)
        data[offset + 2] = byte(srgb_channel(material.color[2]) * modulation)
        // Alpha is free on opaque terrain, so the existing lookup also carries signed local
        // roughness around 0.5. Mipmaps naturally average this micro-detail at distance.
        data[offset + 3] = material_id === 0 ? 128 : byte(0.5 + material_micro_roughness(material.preset, pattern))
      }
    }
  })
  return data
}

export const create_material_texture = (materials: CompiledMaterials, size: number): DataArrayTexture => {
  const texture = new DataArrayTexture(
    create_material_texture_data(materials, size),
    size,
    size,
    materials.entries.length
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
