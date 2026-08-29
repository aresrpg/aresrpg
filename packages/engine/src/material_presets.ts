// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

export const MATERIAL_PRESETS = Object.freeze([
  'stone',
  'earth',
  'grass',
  'frozen_grass',
  'wood',
  'foliage',
  'sand',
  'snow',
  'ice',
  'water',
] as const)
export const MAX_COMPILED_MATERIALS = 64

export type MaterialPreset = (typeof MATERIAL_PRESETS)[number]

type MaterialPresetDefinition = Readonly<{
  roughness: number
  roughness_detail: number
  climate_tint: boolean
  pattern: MaterialPattern
}>

type MaterialPattern = (x: number, y: number, size: number) => number

const hash = (x: number, y: number, seed: number): number => {
  let value = Math.imul(x + 0x9e37, 0x85ebca6b) ^ Math.imul(y + 0x7f4a, 0xc2b2ae35) ^ seed
  value = Math.imul(value ^ (value >>> 16), 0x7feb352d)
  value = Math.imul(value ^ (value >>> 15), 0x846ca68b)
  return ((value ^ (value >>> 16)) >>> 0) / 0x1_0000_0000
}

const smooth = (value: number): number => value * value * (3 - 2 * value)
const wrap = (value: number, period: number): number => ((value % period) + period) % period
const seamless =
  (sample: MaterialPattern): MaterialPattern =>
  (x, y, size) => {
    const wrapped_x = wrap(x, size)
    const wrapped_y = wrap(y, size)
    const amount_x = wrapped_x / size
    const amount_y = wrapped_y / size
    const top_left = sample(wrapped_x, wrapped_y, size)
    const top_right = sample(wrapped_x - size, wrapped_y, size)
    const bottom_left = sample(wrapped_x, wrapped_y - size, size)
    const bottom_right = sample(wrapped_x - size, wrapped_y - size, size)
    const top = top_left + (top_right - top_left) * amount_x
    const bottom = bottom_left + (bottom_right - bottom_left) * amount_x
    return top + (bottom - top) * amount_y
  }

const tile_noise = (x: number, y: number, size: number, frequency: number, seed: number): number => {
  const sample_x = (x * frequency) / size
  const sample_y = (y * frequency) / size
  const cell_x = Math.floor(sample_x)
  const cell_y = Math.floor(sample_y)
  const fraction_x = smooth(sample_x - cell_x)
  const fraction_y = smooth(sample_y - cell_y)
  const at = (offset_x: number, offset_y: number): number =>
    hash(wrap(cell_x + offset_x, frequency), wrap(cell_y + offset_y, frequency), seed)
  const top = at(0, 0) + (at(1, 0) - at(0, 0)) * fraction_x
  const bottom = at(0, 1) + (at(1, 1) - at(0, 1)) * fraction_x
  return top + (bottom - top) * fraction_y
}

const tile_fbm = (x: number, y: number, size: number, frequency: number, octaves: number, seed: number): number => {
  let value = 0
  let weight = 1
  let weight_sum = 0
  for (let octave = 0; octave < octaves; octave += 1) {
    value += tile_noise(x, y, size, frequency * 2 ** octave, seed + octave * 101) * weight
    weight_sum += weight
    weight *= 0.5
  }
  return value / weight_sum
}

const worley_gap = (x: number, y: number, size: number, frequency: number, seed: number): number => {
  const sample_x = (x * frequency) / size
  const sample_y = (y * frequency) / size
  const origin_x = Math.floor(sample_x)
  const origin_y = Math.floor(sample_y)
  let nearest = Number.POSITIVE_INFINITY
  let second = Number.POSITIVE_INFINITY
  for (let offset_y = -1; offset_y <= 1; offset_y += 1) {
    for (let offset_x = -1; offset_x <= 1; offset_x += 1) {
      const cell_x = origin_x + offset_x
      const cell_y = origin_y + offset_y
      const wrapped_x = wrap(cell_x, frequency)
      const wrapped_y = wrap(cell_y, frequency)
      const point_x = cell_x + hash(wrapped_x, wrapped_y, seed)
      const point_y = cell_y + hash(wrapped_x, wrapped_y, seed + 47)
      const distance = (sample_x - point_x) ** 2 + (sample_y - point_y) ** 2
      if (distance < nearest) {
        second = nearest
        nearest = distance
      } else if (distance < second) second = distance
    }
  }
  return Math.sqrt(second) - Math.sqrt(nearest)
}

const noise_pattern = ({
  contrast,
  flecks,
  streak,
}: Readonly<{ contrast: number; flecks: number; streak: number }>): MaterialPattern =>
  seamless((x: number, y: number): number => {
    const pixel_x = Math.floor(x / 4)
    const pixel_y = Math.floor(y / 4)
    const coarse = hash(Math.floor(pixel_x / 2), Math.floor(pixel_y / 2), 17) - 0.5
    const fine = hash(pixel_x, pixel_y, 43) - 0.5
    const line = hash(Math.floor(pixel_x / 2), pixel_y + Math.floor(pixel_x / 3), 71) - 0.5
    const fleck = hash(pixel_x, pixel_y, 97) < flecks ? (fine < 0 ? -0.5 : 0.5) : 0
    return (coarse * 0.55 + fine * 0.3 + line * streak * 0.15 + fleck) * contrast
  })

/** The useful part of the deprecated stone recipe: broad weathered facets, two fracture scales,
 * crevice shade, and fine tooth. All values remain relative to the
 * authored color, so the preset restores the old rock structure without restoring duplicate palettes. */
const stone_pattern: MaterialPattern = (x, y, size) => {
  const seed = 113
  const macro = (tile_fbm(x, y, size, 2, 2, seed) - 0.5) * 0.28
  const mottle = (tile_fbm(x, y, size, 3, 3, seed + 211) - 0.5) * 0.2
  const broad_crack = Math.max(0, 1 - worley_gap(x, y, size, 4, seed + 307) / 0.11) * -0.18
  const hairline = Math.max(0, 1 - worley_gap(x, y, size, 9, seed + 401) / 0.07) * -0.1
  const crevice = Math.max(0, 0.48 - tile_fbm(x, y, size, 6, 3, seed + 509)) * -0.2
  const tooth = (tile_noise(x, y, size, 11, seed + 601) - 0.5) * 0.12
  return Math.max(-0.34, Math.min(0.2, macro + mottle + broad_crack + hairline + crevice + tooth))
}

/** Overlapping short blades with independently varied height and lean. Brighter tips and darker
 * gaps make the same authored color read as dense, irregular growth instead of striped noise. */
const grass_pattern = seamless((x: number, y: number): number => {
  const cell_size = 5
  const origin_x = Math.floor(x / cell_size)
  const origin_y = Math.floor(y / cell_size)
  let blade = 0
  let tip = 0
  for (let offset_y = -1; offset_y <= 1; offset_y += 1) {
    for (let offset_x = -1; offset_x <= 1; offset_x += 1) {
      const cell_x = origin_x + offset_x
      const cell_y = origin_y + offset_y
      for (let strand = 0; strand < 2; strand += 1) {
        const seed = strand * 197
        const base_x = cell_x * cell_size + hash(cell_x, cell_y, seed + 41) * cell_size
        const base_y = (cell_y + 1) * cell_size
        const height = 2.8 + hash(cell_x, cell_y, seed + 83) * 3
        const rise = base_y - y
        const lean = (hash(cell_x, cell_y, seed + 127) - 0.5) * 0.75
        const distance = Math.abs(x - (base_x + lean * rise))
        if (rise < 0 || rise > height || distance >= 0.78) continue
        const strength = 1 - distance / 0.78
        blade = Math.max(blade, strength)
        if (rise > height - 1.1) tip = Math.max(tip, strength)
      }
    }
  }
  const patch = (hash(Math.floor(x / 7), Math.floor(y / 7), 101) - 0.5) * 0.1
  const grain = (hash(Math.floor(x), Math.floor(y / 2), 157) - 0.5) * 0.045
  return patch + grain - 0.055 + blade * 0.18 + tip * 0.12
})

const wood_pattern: MaterialPattern = seamless((x, y, size) => {
  const grain = (tile_noise(x, y, size, 12, 811) - 0.5) * 0.12
  const long_grain = (tile_noise(x * 0.3, y, size, 5, 977) - 0.5) * 0.16
  const ring = Math.sin((x / size) * Math.PI * 8 + tile_noise(x, y, size, 3, 1231) * 2) * 0.035
  return grain + long_grain + ring
})

const foliage_pattern = noise_pattern({ contrast: 0.22, flecks: 0.12, streak: 0.45 })

export const MATERIAL_PRESET_DEFINITIONS = Object.freeze({
  stone: Object.freeze({
    roughness: 0.95,
    roughness_detail: -0.25,
    climate_tint: false,
    pattern: stone_pattern,
  }),
  earth: Object.freeze({
    roughness: 0.9,
    roughness_detail: 0.18,
    climate_tint: false,
    pattern: noise_pattern({ contrast: 0.16, flecks: 0.08, streak: 0.35 }),
  }),
  grass: Object.freeze({
    roughness: 0.84,
    roughness_detail: 0.22,
    climate_tint: true,
    pattern: grass_pattern,
  }),
  frozen_grass: Object.freeze({
    roughness: 0.78,
    roughness_detail: 0.16,
    climate_tint: false,
    pattern: grass_pattern,
  }),
  wood: Object.freeze({
    roughness: 0.82,
    roughness_detail: 0.18,
    climate_tint: false,
    pattern: wood_pattern,
  }),
  foliage: Object.freeze({
    roughness: 0.88,
    roughness_detail: 0.2,
    climate_tint: true,
    pattern: foliage_pattern,
  }),
  sand: Object.freeze({
    roughness: 0.86,
    roughness_detail: 0.16,
    climate_tint: false,
    pattern: noise_pattern({ contrast: 0.14, flecks: 0.16, streak: 0.2 }),
  }),
  snow: Object.freeze({
    roughness: 0.72,
    roughness_detail: 0.12,
    climate_tint: false,
    pattern: noise_pattern({ contrast: 0.1, flecks: 0.08, streak: 0.15 }),
  }),
  ice: Object.freeze({
    roughness: 0.24,
    roughness_detail: -0.12,
    climate_tint: false,
    pattern: noise_pattern({ contrast: 0.08, flecks: 0.04, streak: 0.35 }),
  }),
  water: Object.freeze({
    roughness: 0.16,
    roughness_detail: -0.08,
    climate_tint: false,
    pattern: noise_pattern({ contrast: 0.05, flecks: 0, streak: 0.8 }),
  }),
} satisfies Readonly<Record<MaterialPreset, MaterialPresetDefinition>>)

export const is_material_preset = (value: unknown): value is MaterialPreset =>
  typeof value === 'string' && MATERIAL_PRESETS.includes(value as MaterialPreset)

/** A small deterministic, engine-owned texture recipe. The seed chooses a semantic preset;
 * it never authors shader knobs or texture assets. */
export const material_pattern = (preset: MaterialPreset, x: number, y: number, size = 32): number => {
  return MATERIAL_PRESET_DEFINITIONS[preset].pattern(x, y, size)
}

export const material_micro_roughness = (preset: MaterialPreset, pattern: number): number =>
  Math.max(-0.1, Math.min(0.1, pattern * MATERIAL_PRESET_DEFINITIONS[preset].roughness_detail))
