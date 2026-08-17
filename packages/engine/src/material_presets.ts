// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

export const MATERIAL_PRESETS = Object.freeze(['stone', 'earth', 'grass', 'sand', 'snow', 'ice', 'water'] as const)
export const MATERIAL_TEXTURE_VARIANTS = 4
export const MAX_COMPILED_MATERIALS = 64

export type MaterialPreset = (typeof MATERIAL_PRESETS)[number]

type MaterialPresetDefinition = Readonly<{
  roughness: number
  contrast: number
  flecks: number
  streak: number
  climate_tint: boolean
}>

export const MATERIAL_PRESET_DEFINITIONS = Object.freeze({
  stone: Object.freeze({ roughness: 0.78, contrast: 0.18, flecks: 0.12, streak: 0.15, climate_tint: false }),
  earth: Object.freeze({ roughness: 0.9, contrast: 0.16, flecks: 0.08, streak: 0.35, climate_tint: false }),
  grass: Object.freeze({ roughness: 0.82, contrast: 0.2, flecks: 0.06, streak: 0.7, climate_tint: true }),
  sand: Object.freeze({ roughness: 0.86, contrast: 0.14, flecks: 0.16, streak: 0.2, climate_tint: false }),
  snow: Object.freeze({ roughness: 0.72, contrast: 0.1, flecks: 0.08, streak: 0.15, climate_tint: false }),
  ice: Object.freeze({ roughness: 0.24, contrast: 0.08, flecks: 0.04, streak: 0.35, climate_tint: false }),
  water: Object.freeze({ roughness: 0.16, contrast: 0.05, flecks: 0, streak: 0.8, climate_tint: false }),
} satisfies Readonly<Record<MaterialPreset, MaterialPresetDefinition>>)

export const is_material_preset = (value: unknown): value is MaterialPreset =>
  typeof value === 'string' && MATERIAL_PRESETS.includes(value as MaterialPreset)

const hash = (x: number, y: number, seed: number): number => {
  let value = Math.imul(x + 0x9e37, 0x85ebca6b) ^ Math.imul(y + 0x7f4a, 0xc2b2ae35) ^ seed
  value = Math.imul(value ^ (value >>> 16), 0x7feb352d)
  value = Math.imul(value ^ (value >>> 15), 0x846ca68b)
  return ((value ^ (value >>> 16)) >>> 0) / 0x1_0000_0000
}

/** A small deterministic, engine-owned texture recipe. The seed chooses a semantic preset;
 * it never authors shader knobs or texture assets. */
export const material_pattern = (preset: MaterialPreset, x: number, y: number, variant: number): number => {
  const definition = MATERIAL_PRESET_DEFINITIONS[preset]
  const pixel_x = Math.floor(x / 4)
  const pixel_y = Math.floor(y / 4)
  const coarse = hash(Math.floor(pixel_x / 2), Math.floor(pixel_y / 2), variant * 101 + 17) - 0.5
  const fine = hash(pixel_x, pixel_y, variant * 211 + 43) - 0.5
  const streak = hash(Math.floor(pixel_x / 2), pixel_y + Math.floor(pixel_x / 3), variant * 307 + 71) - 0.5
  const fleck = hash(pixel_x, pixel_y, variant * 401 + 97) < definition.flecks ? (fine < 0 ? -0.5 : 0.5) : 0
  return (coarse * 0.55 + fine * 0.3 + streak * definition.streak * 0.15 + fleck) * definition.contrast
}
