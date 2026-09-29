// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

export const MATERIAL_PRESETS = Object.freeze([
  'stone',
  'plaster',
  'slate',
  'copper',
  'brick',
  'earth',
  'grass',
  'frozen_grass',
  'wood',
  'bark',
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

/** Crisp periodic planks and stepped fibres, baked into the existing nearest-sampled atlas. */
const wood_pattern: MaterialPattern = (x, y, size) => {
  const across = (wrap(x + size * 0.25, size) / size) * 5
  const plank = Math.floor(across)
  const u = across - plank
  const along = (wrap(y + size * 0.3125, size) / size) * 2 + (plank % 2) * 0.5
  const v = along - Math.floor(along)
  const border = Math.min(u, 1 - u) < 1.5 / size
  const joint = Math.min(v, 1 - v) < 0.75 / size
  const fibre = Math.floor(u * 14 + Math.sin(v * Math.PI * 2) * 0.8)
  const grain = (hash(plank, fibre, 811) - 0.5) * 0.16
  const board = (hash(plank, Math.floor(along) % 2, 977) - 0.5) * 0.14
  return border || joint ? -0.26 : board + grain + 0.035
}

/** Continuous vertical fissures and irregular plates; trunks have no sawn-board joints. */
const bark_pattern: MaterialPattern = (x, y, size) => {
  const u = wrap(x, size) / size
  const v = wrap(y, size) / size
  const bend = Math.sin(v * Math.PI * 2) * 0.28 + Math.sin(v * Math.PI * 6) * 0.1
  const fibre = u * 12 + bend
  const ridge = Math.abs(Math.sin(fibre * Math.PI))
  const plate = hash(Math.floor(fibre), Math.floor(v * 8), 389) - 0.5
  const grain = hash(Math.floor(u * 48), Math.floor(v * 64), 521) - 0.5
  return ridge < 0.18 ? -0.28 : (ridge - 0.5) * 0.14 + plate * 0.16 + grain * 0.07
}

/** Baked overlapping leaves: rotated pointed silhouettes, a folded midrib, and shaded gaps.
 * Periodic cell identity keeps the atlas seamless; no leaf geometry or shader work is added. */
const foliage_leaf = (x: number, y: number, cell_x: number, cell_y: number): number => {
  const identity_x = wrap(cell_x, 7)
  const identity_y = wrap(cell_y, 7)
  const angle = hash(identity_x, identity_y, 301) * Math.PI * 2
  const dx = x - cell_x - 0.2 - hash(identity_x, identity_y, 307) * 0.6
  const dy = y - cell_y - 0.2 - hash(identity_x, identity_y, 311) * 0.6
  const along = (dx * Math.cos(angle) + dy * Math.sin(angle)) / 0.8
  const across = (-dx * Math.sin(angle) + dy * Math.cos(angle)) / 0.45
  const silhouette = 1 - along * along - Math.abs(across)
  const fold = across > 0 ? 0.1 : -0.035
  const vein = Math.max(0, 1 - Math.abs(across) * 12) * 0.055
  return Math.max(0, Math.min(1, silhouette * 5)) * (0.27 + fold + vein)
}

const foliage_pattern: MaterialPattern = (x, y, size) => {
  const sample_x = (x / size) * 7
  const sample_y = (y / size) * 7
  let leaf = 0
  for (let dy = -1; dy <= 1; dy += 1)
    for (let dx = -1; dx <= 1; dx += 1)
      leaf = Math.max(leaf, foliage_leaf(sample_x, sample_y, Math.floor(sample_x) + dx, Math.floor(sample_y) + dy))
  return -0.17 + leaf + (tile_noise(x, y, size, 3, 331) - 0.5) * 0.1
}

/** Seamless frost fractures and tiny trapped bubbles, baked into the existing atlas. */
const ice_pattern: MaterialPattern = (x, y, size) => {
  const u = (x / size) * Math.PI * 2 + 0.37
  const v = (y / size) * Math.PI * 2 + 0.73
  const fractures = Math.abs(Math.sin(u * 2 + Math.sin(v)) * Math.sin(v * 3 + Math.sin(u)))
  const crack = Math.max(0, 1 - fractures * 14)
  const bubbles = Math.max(0, tile_noise(x, y, size, 13, 947) - 0.72) * 0.25
  return -0.09 + crack * 0.32 + bubbles + (tile_noise(x, y, size, 4, 941) - 0.5) * 0.07
}

// Place the atlas seam through a representative interior section, away from aligned mortar rows.
const phased_pattern =
  (phase_x: number, phase_y: number, pattern: MaterialPattern): MaterialPattern =>
  (x, y, size) =>
    pattern(wrap(x + phase_x * size, size), wrap(y + phase_y * size, size), size)

export const MATERIAL_PRESET_DEFINITIONS = Object.freeze({
  brick: Object.freeze({
    roughness: 0.9,
    roughness_detail: 0.14,
    climate_tint: false,
    pattern: (x, y, size) => {
      // Integer texel courses keep mortar continuous even in the small atlas.
      const px = Math.floor((wrap(x, size) / size) * 32)
      const py = Math.floor((wrap(y + size * 0.0625, size) / size) * 32)
      const row = Math.floor(py / 4)
      const shifted = wrap(px + (row % 2) * 4, 32)
      const column = Math.floor(shifted / 8)
      const u = shifted % 8,
        v = py % 4
      const shade = (hash(column, row, 919) - 0.5) * 0.18
      const grit = (hash(px, py, 923) - 0.5) * 0.055
      const mortar = u === 0 || v === 0
      const edge = u === 1 || v === 1
      return mortar ? -0.17 + grit : shade + grit + (edge ? 0.065 : 0.015)
    },
  }),
  plaster: Object.freeze({
    roughness: 0.9,
    roughness_detail: 0.08,
    climate_tint: false,
    pattern: noise_pattern({ contrast: 0.035, flecks: 0.02, streak: 0.05 }),
  }),
  slate: Object.freeze({
    roughness: 0.65,
    roughness_detail: 0.14,
    climate_tint: false,
    pattern: phased_pattern(0.1875, 0.75, (x, y, size) => {
      const row = Math.floor((y / size) * 8 + 0.37)
      const edge = Math.min(((x / size) * 6 + (row % 2) * 0.5 + 0.27) % 1, ((y / size) * 8 + 0.37) % 1)
      return (edge < 0.15 ? -0.2 : 0.04) + (tile_noise(x, y, size, 7, 881) - 0.5) * 0.08
    }),
  }),
  copper: Object.freeze({
    roughness: 0.4,
    roughness_detail: 0.14,
    climate_tint: false,
    pattern: phased_pattern(
      0.65625,
      0.5625,
      (x, y, size) => (tile_noise(x, y, size, 3, 887) - 0.5) * 0.15 + (((x / size) * 4 + 0.32) % 1 < 0.12 ? -0.14 : 0)
    ),
  }),

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
  bark: Object.freeze({
    roughness: 0.94,
    roughness_detail: 0.22,
    climate_tint: false,
    pattern: bark_pattern,
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
    roughness: 0.13,
    roughness_detail: 0.08,
    climate_tint: false,
    pattern: ice_pattern,
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
