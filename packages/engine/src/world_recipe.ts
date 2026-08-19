// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import {
  compile_materials,
  validate_materials,
  type CompiledMaterials,
  type MaterialUse,
  type WorldMaterial,
} from './world_materials.ts'
import { create_fbm_sampler, create_ridged_sampler, derive_sub_seed } from './world_noise.ts'
import {
  compile_structures,
  structure_material_uses,
  validate_biome_structure_packs,
  type CompiledStructures,
} from './structures.ts'

export type SplineKnot = readonly [x: number, y: number]
export const WORLD_HEIGHT = 384
export const MAX_SURFACE_Y = WORLD_HEIGHT - 1
export type BiomeLand = Readonly<{ surface: string; subsurface: string; filler: string }>
export type LandscapeKnot = Readonly<{ x: number; y: number; land?: BiomeLand; variance?: number }>
export type ClimateBand = 'low' | 'mid' | 'high'
export type BiomeSlot = `${ClimateBand}_${ClimateBand}`
export const BIOME_SLOTS = Object.freeze([
  'low_low',
  'low_mid',
  'low_high',
  'mid_low',
  'mid_mid',
  'mid_high',
  'high_low',
  'high_mid',
  'high_high',
] as const satisfies readonly BiomeSlot[])

export type WorldBiome = Readonly<{
  name: string
  landscape: readonly LandscapeKnot[]
  structure_packs?: readonly string[]
}>
export type WorldRecipe = Readonly<{
  seed: string
  sea_level: number
  liquid?: string
  materials: Readonly<Record<string, WorldMaterial>>
  biome_slots: Readonly<Record<BiomeSlot, string>>
  biomes: readonly WorldBiome[]
}>

export type SampledClimate = Readonly<{
  temperature: number
  humidity: number
  ground: number
  amplitude: number
  transition: number
}>
type CompiledBiome = WorldBiome & Readonly<{ height_points: readonly SplineKnot[] }>
export type CompiledWorld = Readonly<{
  recipe: WorldRecipe
  decoration_seed: number
  materials: CompiledMaterials
  structures: CompiledStructures
  sample_climate: (x: number, z: number) => SampledClimate
  sample_ridges: (x: number, z: number) => number
  biomes: readonly CompiledBiome[]
  slots: Readonly<Record<BiomeSlot, CompiledBiome>>
}>
export type WorldColumn = Readonly<{
  surface_y: number
  climate: SampledClimate
  biome: CompiledBiome
  land: BiomeLand
  surface_id: number
  subsurface_id: number
  filler_id: number
}>

export type TerrainLayer = keyof BiomeLand

/** Rise per horizontal block from the steepest sampled cardinal neighbour. */
export const terrain_slope = (center_y: number, neighbour_heights: readonly number[], spacing = 1): number =>
  neighbour_heights.reduce((steepest, height) => Math.max(steepest, Math.abs(height - center_y) / spacing), 0)

/** Thin cover survives gentle ground; steep ground exposes the strata authored below it. */
export const terrain_layer = (depth: number, slope: number): TerrainLayer => {
  if (slope >= 4 || depth >= 4) return 'filler'
  if (slope >= 2 || depth >= 1) return 'subsurface'
  return 'surface'
}

export const surface_layer_for_slope = (slope: number): TerrainLayer => terrain_layer(0, slope)

export const terrain_material_id = (column: WorldColumn, depth: number, slope: number): number =>
  column[`${terrain_layer(depth, slope)}_id`]

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const has_material = (materials: unknown, name: unknown): name is string =>
  typeof name === 'string' && materials !== null && typeof materials === 'object' && name in materials
const record = (value: unknown): Readonly<Record<string, unknown>> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : null

const validate_land = (land: BiomeLand | undefined, materials: unknown, prefix: string): readonly string[] => {
  if (!land) return [`${prefix} must define surface, subsurface and filler materials`]
  return (['surface', 'subsurface', 'filler'] as const).flatMap((layer) =>
    has_material(materials, land[layer])
      ? []
      : [`${prefix}.${layer} references unknown material "${land[layer] ?? ''}"`]
  )
}

const validate_landscape = (value: unknown, materials: unknown, prefix: string): readonly string[] => {
  if (!Array.isArray(value) || value.length < 2) return [`${prefix} must contain at least two points`]
  let previous = -Infinity
  return value.flatMap((candidate, index) => {
    const knot = record(candidate)
    const point = `${prefix}[${index}]`
    if (!knot || !finite(knot.x) || !finite(knot.y)) return [`${point} must define finite x and y values`]
    const errors = knot.x <= previous ? [`${point}.x must be strictly greater than the previous x`] : []
    previous = knot.x
    if (knot.y < 0 || knot.y > MAX_SURFACE_Y) errors.push(`${point}.y must be between 0 and ${MAX_SURFACE_Y}`)
    if (knot.variance !== undefined && (!finite(knot.variance) || knot.variance < 0 || knot.variance > 0.25))
      errors.push(`${point}.variance must be between 0 and 0.25`)
    if (index === 0 || knot.land)
      errors.push(...validate_land(knot.land as BiomeLand | undefined, materials, `${point}.land`))
    return errors
  })
}

const validate_biomes = (value: unknown, materials: unknown): readonly string[] => {
  if (!Array.isArray(value) || value.length === 0) return ['biomes must not be empty']
  const names = new Set<string>()
  return value.flatMap((candidate, index) => {
    const biome = record(candidate)
    if (!biome) return [`biomes[${index}] must be an object`]
    const errors: string[] = []
    if (typeof biome.name !== 'string' || biome.name.length === 0)
      errors.push(`biomes[${index}].name must be non-empty`)
    else if (names.has(biome.name)) errors.push(`biomes[${index}].name must be unique`)
    else names.add(biome.name)
    errors.push(...validate_landscape(biome.landscape, materials, `biomes[${index}].landscape`))
    errors.push(...validate_biome_structure_packs(biome.structure_packs, materials, `biomes[${index}].structure_packs`))
    return errors
  })
}

const validate_slots = (value: unknown, biomes: unknown): readonly string[] => {
  const slots = record(value)
  const names = new Set(Array.isArray(biomes) ? biomes.map((biome) => record(biome)?.name) : [])
  if (!slots) return ['biome_slots must define all nine climate slots']
  return BIOME_SLOTS.flatMap((slot) =>
    typeof slots[slot] !== 'string' || !names.has(slots[slot])
      ? [`biome_slots.${slot} must reference an authored biome`]
      : []
  )
}

export const validate_world_recipe = (recipe: unknown): Readonly<{ ok: boolean; errors: readonly string[] }> => {
  const candidate = record(recipe)
  if (!candidate) return { ok: false, errors: ['recipe must be an object'] }
  const errors: string[] = []
  if (typeof candidate.seed !== 'string' || candidate.seed.length === 0) errors.push('seed must be non-empty')
  if (!finite(candidate.sea_level) || candidate.sea_level < 0 || candidate.sea_level >= WORLD_HEIGHT)
    errors.push(`sea_level must be between 0 and ${WORLD_HEIGHT - 1}`)
  errors.push(...validate_materials(candidate.materials))
  if (candidate.liquid !== undefined && !has_material(candidate.materials, candidate.liquid))
    errors.push(`liquid references unknown material "${typeof candidate.liquid === 'string' ? candidate.liquid : ''}"`)
  for (const removed of ['noise', 'biome_selection', 'splines', 'vertical_chunks'] as const)
    if (removed in candidate) errors.push(`${removed} is engine-owned and must not be authored`)
  errors.push(...validate_biomes(candidate.biomes, candidate.materials))
  errors.push(...validate_slots(candidate.biome_slots, candidate.biomes))
  return { ok: errors.length === 0, errors }
}

export const parse_world_recipe = (value: unknown): WorldRecipe => {
  const validation = validate_world_recipe(value)
  if (!validation.ok) throw new TypeError(validation.errors.join('\n'))
  return value as WorldRecipe
}

export const landscape_height = (points: readonly SplineKnot[], input: number): number => {
  if (input <= points[0]![0]) return points[0]![1]
  const upper = points.findIndex(([x]) => x >= input)
  if (upper < 0) return points.at(-1)![1]
  const [x0, y0] = points[upper - 1]!
  const [x1, y1] = points[upper]!
  return y0 + ((input - x0) / (x1 - x0)) * (y1 - y0)
}

export const climate_band_weights = (value: number): Readonly<Record<ClimateBand, number>> => {
  if (value <= 0.3) return { low: 1, mid: 0, high: 0 }
  if (value < 0.4) {
    const progress = (value - 0.3) / 0.1
    const mid = progress * progress * (3 - 2 * progress)
    return { low: 1 - mid, mid, high: 0 }
  }
  if (value <= 0.6) return { low: 0, mid: 1, high: 0 }
  if (value < 0.7) {
    const progress = (value - 0.6) / 0.1
    const high = progress * progress * (3 - 2 * progress)
    return { low: 0, mid: 1 - high, high }
  }
  return { low: 0, mid: 0, high: 1 }
}

export const biome_influences = (
  world: CompiledWorld,
  climate: Pick<SampledClimate, 'temperature' | 'humidity'>
): readonly Readonly<{ biome: CompiledBiome; weight: number }>[] => {
  const temperature = climate_band_weights(climate.temperature)
  const humidity = climate_band_weights(climate.humidity)
  const by_name = BIOME_SLOTS.reduce<Record<string, number>>((weights, slot) => {
    const [temperature_band, humidity_band] = slot.split('_') as [ClimateBand, ClimateBand]
    const weight = temperature[temperature_band] * humidity[humidity_band]
    const { name } = world.slots[slot]
    weights[name] = (weights[name] ?? 0) + weight
    return weights
  }, {})
  const total = Object.values(by_name).reduce((sum, weight) => sum + weight, 0)
  return Object.entries(by_name)
    .filter(([, weight]) => weight > 0)
    .map(([name, weight]) => ({ biome: world.biomes.find((biome) => biome.name === name)!, weight: weight / total }))
    .sort((left, right) => right.weight - left.weight)
}

const material_uses = (biomes: readonly WorldBiome[]): readonly MaterialUse[] =>
  biomes.flatMap(({ landscape }) =>
    landscape.flatMap(({ land }) =>
      land
        ? [
            { name: land.surface, role: 'surface' as const, paired_material: land.subsurface },
            { name: land.subsurface, role: 'subsurface' as const },
            { name: land.filler, role: 'filler' as const },
          ]
        : []
    )
  )

/** Legacy-scale climate fields: large territories, but enough harmonics to keep their borders organic
 * inside one visible horizon instead of reading as straight continental cuts. */
export const CLIMATE_FIELDS = Object.freeze({
  temperature: Object.freeze({ period: 8192, octaves: 6, spread: 2, gain: 0.5 }),
  humidity: Object.freeze({ period: 8192, octaves: 6, spread: 2, gain: 0.5 }),
})
export const balance_climate = (value: number): number => Math.max(0, Math.min(1, (value - 0.5) * 1.5 + 0.5))

export const compile_world_recipe = (
  input: WorldRecipe,
  options: Readonly<{ structures?: boolean }> = {}
): CompiledWorld => {
  const recipe = parse_world_recipe(input)
  const biomes = recipe.biomes.map((biome) => ({
    ...biome,
    height_points: biome.landscape.map(({ x, y }) => [x, y] as const),
  }))
  const by_name = Object.fromEntries(biomes.map((biome) => [biome.name, biome]))
  const slots = BIOME_SLOTS.reduce<Record<BiomeSlot, CompiledBiome>>(
    (result, slot) => ({ ...result, [slot]: by_name[recipe.biome_slots[slot]]! }),
    {} as Record<BiomeSlot, CompiledBiome>
  )
  const temperature = create_fbm_sampler(derive_sub_seed(recipe.seed, 'temperature'), CLIMATE_FIELDS.temperature)
  const humidity = create_fbm_sampler(derive_sub_seed(recipe.seed, 'humidity'), CLIMATE_FIELDS.humidity)
  const ground_noise = create_fbm_sampler(derive_sub_seed(recipe.seed, 'ground'), {
    period: 2048,
    octaves: 6,
    spread: 2,
    gain: 0.52,
  })
  const amplitude = create_fbm_sampler(derive_sub_seed(recipe.seed, 'amplitude'), {
    period: 6144,
    octaves: 4,
    spread: 2,
    gain: 0.5,
  })
  const ridges = create_ridged_sampler(derive_sub_seed(recipe.seed, 'ridges'), {
    period: 3072,
    octaves: 5,
    spread: 2,
    gain: 0.48,
  })
  const transition = create_fbm_sampler(derive_sub_seed(recipe.seed, 'transition'), {
    period: 256,
    octaves: 2,
    spread: 2,
    gain: 0.5,
  })
  const include_structures = options.structures !== false
  const materials = compile_materials(recipe.materials, [
    ...material_uses(recipe.biomes),
    ...(include_structures ? structure_material_uses(recipe.biomes) : []),
  ])
  return Object.freeze({
    recipe,
    decoration_seed: derive_sub_seed(recipe.seed, 'decoration'),
    materials,
    structures: include_structures
      ? compile_structures(recipe.biomes, materials)
      : Object.freeze({ packs: Object.freeze([]), max_footprint: 0 }),
    biomes: Object.freeze(biomes),
    slots: Object.freeze(slots),
    sample_climate: (x, z) => ({
      temperature: balance_climate(temperature(x, z)),
      humidity: balance_climate(humidity(x, z)),
      ground: Math.max(0, Math.min(1, (ground_noise(x, z) - 0.5) * 2 ** 0.42 + 0.5)),
      amplitude: amplitude(x, z),
      transition: transition(x, z),
    }),
    sample_ridges: ridges,
  })
}

const land_at = (biome: CompiledBiome, ground: number, transition: number): BiomeLand =>
  biome.landscape.reduce((selected, knot) => {
    const threshold = knot.x + (transition - 0.5) * (knot.variance ?? 0)
    return threshold <= ground && knot.land ? knot.land : selected
  }, biome.landscape[0]!.land!)

export const sample_world_column = (world: CompiledWorld, x: number, z: number): WorldColumn => {
  const climate = world.sample_climate(x, z)
  const influences = biome_influences(world, climate)
  const [{ biome }] = influences
  const authored_height = influences.reduce(
    (sum, influence) => sum + influence.weight * landscape_height(influence.biome.height_points, climate.ground),
    0
  )
  const mountain = Math.max(0, Math.min(1, (climate.ground - 0.32) / 0.5))
  const detail = (climate.amplitude - 0.5) * 12 * mountain + (world.sample_ridges(x, z) - 0.5) * 48 * mountain
  const land = land_at(biome, climate.ground, climate.transition)
  return {
    surface_y: Math.max(1, Math.min(MAX_SURFACE_Y, Math.floor(authored_height + detail + Number.EPSILON * 64))),
    climate,
    biome,
    land,
    surface_id: world.materials.id_for(land.surface, 'surface', land.subsurface),
    subsurface_id: world.materials.id_for(land.subsurface, 'subsurface'),
    filler_id: world.materials.id_for(land.filler, 'filler'),
  }
}

export const far_shell_y = (world: CompiledWorld, x: number, z: number): number =>
  sample_world_column(world, x, z).surface_y - 0.5
