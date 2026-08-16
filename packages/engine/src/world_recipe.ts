// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import {
  compile_materials,
  validate_materials,
  type CompiledMaterials,
  type MaterialUse,
  type WorldMaterial,
} from './world_materials.ts'
import { create_fbm_sampler, derive_sub_seed, type NoiseField } from './world_noise.ts'

export type SplineKnot = readonly [x: number, y: number]
export type Climate = Readonly<{
  temperature: number
  humidity: number
  continentalness: number
  erosion: number
  pv: number
}>
export type BiomeLand = Readonly<{ surface: string; subsurface: string; filler: string }>
export type WorldBiome = Readonly<{
  name: string
  climate: Climate
  weight: number
  land: BiomeLand
}>
export type WorldRecipe = Readonly<{
  seed: string
  sea_level: number
  liquid?: string
  vertical_chunks: readonly number[]
  materials: Readonly<Record<string, WorldMaterial>>
  noise: Readonly<Record<'temperature' | 'humidity' | 'continentalness' | 'erosion' | 'weirdness', NoiseField>>
  splines: Readonly<{
    continentalness_to_base: readonly SplineKnot[]
    erosion_to_amplitude: readonly SplineKnot[]
    pv_to_relief: readonly SplineKnot[]
  }>
  biome_selection: Readonly<{
    axis_weights: Climate
    blend_k: number
    transition_softness: number
  }>
  biomes: readonly WorldBiome[]
}>

type SampledClimate = Climate & Readonly<{ weirdness: number }>
type CompiledBiome = WorldBiome

export type CompiledWorld = Readonly<{
  recipe: WorldRecipe
  decoration_seed: number
  materials: CompiledMaterials
  sample_climate: (x: number, z: number) => SampledClimate
  biomes: readonly CompiledBiome[]
}>

export type WorldColumn = Readonly<{
  surface_y: number
  climate: SampledClimate
  biome: CompiledBiome
  surface_id: number
  subsurface_id: number
  filler_id: number
}>

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const has_material = (materials: unknown, name: unknown): name is string =>
  typeof name === 'string' && materials !== null && typeof materials === 'object' && name in materials

const validate_liquid = (liquid: unknown, materials: unknown): readonly string[] =>
  liquid === undefined || has_material(materials, liquid)
    ? []
    : [`liquid references unknown material "${typeof liquid === 'string' ? liquid : ''}"`]

const climate_keys = ['temperature', 'humidity', 'continentalness', 'erosion', 'pv'] as const

const validate_noise = (noise: Partial<WorldRecipe>['noise']): readonly string[] =>
  (['temperature', 'humidity', 'continentalness', 'erosion', 'weirdness'] as const).flatMap((name) => {
    const errors: string[] = []
    const field = noise?.[name]
    if (!finite(field?.period) || field.period <= 0) errors.push(`noise.${name}.period must be greater than zero`)
    if (!Number.isInteger(field?.octaves) || (field?.octaves ?? 0) < 1 || (field?.octaves ?? 0) > 16)
      errors.push(`noise.${name}.octaves must be an integer from 1 to 16`)
    if (field?.spread !== undefined && (!finite(field.spread) || field.spread <= 0))
      errors.push(`noise.${name}.spread must be greater than zero`)
    if (field?.gain !== undefined && (!finite(field.gain) || field.gain <= 0))
      errors.push(`noise.${name}.gain must be greater than zero`)
    return errors
  })

const validate_splines = (splines: Partial<WorldRecipe>['splines']): readonly string[] =>
  (['continentalness_to_base', 'erosion_to_amplitude', 'pv_to_relief'] as const).flatMap((name) => {
    const knots = splines?.[name]
    if (!Array.isArray(knots) || knots.length < 2) return [`splines.${name} must contain at least two points`]
    let previous = -Infinity
    return knots.flatMap((knot, index) => {
      if (!Array.isArray(knot) || knot.length !== 2 || !finite(knot[0]) || !finite(knot[1]))
        return [`splines.${name}[${index}] must be a finite [x, y] point`]
      const [x] = knot
      const errors = x <= previous ? [`splines.${name}[${index}][0] must be strictly greater than the previous x`] : []
      previous = x
      return errors
    })
  })

const validate_biome_selection = (
  selection: Partial<WorldRecipe>['biome_selection'],
  biome_count: number
): readonly string[] => {
  const errors: string[] = []
  if (!Number.isInteger(selection?.blend_k) || (selection?.blend_k ?? 0) < 1 || (selection?.blend_k ?? 0) > biome_count)
    errors.push('biome_selection.blend_k must be an integer from 1 to the biome count')
  if (!finite(selection?.transition_softness) || selection.transition_softness < 0)
    errors.push('biome_selection.transition_softness must be a finite non-negative number')
  climate_keys.forEach((key) => {
    const value = selection?.axis_weights?.[key]
    if (!finite(value) || value < 0)
      errors.push(`biome_selection.axis_weights.${key} must be a finite non-negative number`)
  })
  return errors
}

const validate_biomes = (biomes: Partial<WorldRecipe>['biomes'], materials: unknown): readonly string[] => {
  if (!Array.isArray(biomes) || biomes.length === 0) return ['biomes must not be empty']
  return biomes.flatMap((biome, biome_index) => {
    if (biome === null || typeof biome !== 'object') return [`biomes[${biome_index}] must be an object`]
    const errors: string[] = []
    if (typeof biome.name !== 'string' || biome.name.length === 0)
      errors.push(`biomes[${biome_index}].name must be a non-empty string`)
    if (!finite(biome.weight) || biome.weight <= 0)
      errors.push(`biomes[${biome_index}].weight must be greater than zero`)
    climate_keys.forEach((key) => {
      if (!finite(biome.climate?.[key])) errors.push(`biomes[${biome_index}].climate.${key} must be a finite number`)
    })
    for (const layer of ['surface', 'subsurface', 'filler'] as const) {
      const material = biome.land?.[layer]
      if (!has_material(materials, material))
        errors.push(`biomes[${biome_index}].land.${layer} references unknown material "${material ?? ''}"`)
    }
    return errors
  })
}

export const validate_world_recipe = (recipe: unknown): Readonly<{ ok: boolean; errors: readonly string[] }> => {
  const errors: string[] = []
  if (recipe === null || typeof recipe !== 'object') return { ok: false, errors: ['recipe must be an object'] }
  const candidate = recipe as Partial<WorldRecipe>
  if (typeof candidate.seed !== 'string' || candidate.seed.length === 0) errors.push('seed must be a non-empty string')
  if (!finite(candidate.sea_level)) errors.push('sea_level must be a finite number')
  errors.push(...validate_materials(candidate.materials))
  errors.push(...validate_liquid(candidate.liquid, candidate.materials))
  if (
    !Array.isArray(candidate.vertical_chunks) ||
    candidate.vertical_chunks.length === 0 ||
    candidate.vertical_chunks.some((value) => !Number.isInteger(value))
  )
    errors.push('vertical_chunks must contain at least one integer')

  errors.push(...validate_noise(candidate.noise))
  errors.push(...validate_splines(candidate.splines))
  const biome_count = Array.isArray(candidate.biomes) ? candidate.biomes.length : 0
  errors.push(...validate_biome_selection(candidate.biome_selection, biome_count))
  errors.push(...validate_biomes(candidate.biomes, candidate.materials))
  return { ok: errors.length === 0, errors }
}

export const catmull_rom = (points: readonly SplineKnot[], input: number): number => {
  if (input <= points[0][0]) return points[0][1]
  if (input >= points[points.length - 1][0]) return points[points.length - 1][1]
  let index = 0
  while (index < points.length - 1 && input > points[index + 1][0]) index += 1
  const p1 = points[index]
  const p2 = points[index + 1]
  const p0 = points[index - 1] ?? p1
  const p3 = points[index + 2] ?? p2
  const span = p2[0] - p1[0]
  const t = span > 0 ? (input - p1[0]) / span : 0
  const t2 = t * t
  const t3 = t2 * t
  return (
    0.5 *
    (2 * p1[1] +
      (-p0[1] + p2[1]) * t +
      (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 +
      (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3)
  )
}

const derive_pv = (weirdness: number): number =>
  Math.max(0, Math.min(1, 1 - Math.abs(3 * Math.abs(weirdness * 2 - 1) - 2)))

const climate_distance = (left: Climate, right: Climate, weights: Climate): number =>
  (Object.keys(weights) as (keyof Climate)[]).reduce((distance, key) => {
    const delta = (left[key] - right[key]) * weights[key]
    return distance + delta * delta
  }, 0)

const smoothstep = (edge_0: number, edge_1: number, value: number): number => {
  const amount = Math.max(0, Math.min(1, (value - edge_0) / (edge_1 - edge_0)))
  return amount * amount * (3 - 2 * amount)
}

export const biome_influences = (
  world: CompiledWorld,
  climate: SampledClimate
): readonly Readonly<{ biome: CompiledBiome; weight: number }>[] => {
  const ranked = world.biomes
    .map((biome) => ({
      biome,
      distance: Math.sqrt(climate_distance(climate, biome.climate, world.recipe.biome_selection.axis_weights)),
    }))
    .sort((left, right) => left.distance - right.distance)
  const count = Math.min(world.recipe.biome_selection.blend_k, ranked.length)
  const far = ranked[Math.max(0, count - 1)].distance + 1e-6
  const weighted = ranked.slice(0, count).map(({ biome, distance }) => ({
    biome,
    weight: smoothstep(far * (1 + world.recipe.biome_selection.transition_softness), 0, distance) * biome.weight,
  }))
  const total = weighted.reduce((sum, influence) => sum + influence.weight, 0)
  return weighted
    .map((influence) => ({ ...influence, weight: total > 0 ? influence.weight / total : 1 / count }))
    .sort((left, right) => right.weight - left.weight)
}

export const compile_world_recipe = (recipe: WorldRecipe): CompiledWorld => {
  const validation = validate_world_recipe(recipe)
  if (!validation.ok) throw new TypeError(validation.errors.join('\n'))
  const material_uses: MaterialUse[] = recipe.biomes.flatMap(({ land }) => [
    { name: land.surface, role: 'surface', paired_material: land.subsurface },
    { name: land.subsurface, role: 'subsurface' },
    { name: land.filler, role: 'filler' },
  ])
  if (recipe.liquid !== undefined) material_uses.push({ name: recipe.liquid, role: 'liquid' })
  const materials = compile_materials(recipe.materials, material_uses)
  const field = (name: keyof WorldRecipe['noise']) =>
    create_fbm_sampler(derive_sub_seed(recipe.seed, name), recipe.noise[name])
  const temperature = field('temperature')
  const humidity = field('humidity')
  const continentalness = field('continentalness')
  const erosion = field('erosion')
  const weirdness = field('weirdness')
  const { biomes } = recipe
  return Object.freeze({
    recipe,
    decoration_seed: derive_sub_seed(recipe.seed, 'decoration'),
    materials,
    biomes,
    sample_climate: (x, z) => {
      const weirdness_value = weirdness(x, z)
      return {
        temperature: temperature(x, z),
        humidity: humidity(x, z),
        continentalness: continentalness(x, z),
        erosion: erosion(x, z),
        weirdness: weirdness_value,
        pv: derive_pv(weirdness_value),
      }
    },
  })
}

export const parse_world_recipe = (value: unknown): WorldRecipe => {
  const validation = validate_world_recipe(value)
  if (!validation.ok) throw new TypeError(validation.errors.join('\n'))
  return value as WorldRecipe
}

export const sample_world_column = (world: CompiledWorld, x: number, z: number): WorldColumn => {
  const climate = world.sample_climate(x, z)
  const base = catmull_rom(world.recipe.splines.continentalness_to_base, climate.continentalness)
  const amplitude = catmull_rom(world.recipe.splines.erosion_to_amplitude, climate.erosion)
  const relief = catmull_rom(world.recipe.splines.pv_to_relief, climate.pv)
  const [{ biome }] = biome_influences(world, climate)
  return {
    // Renderer space places the authored sea level on y=0. The chain has no height,
    // so this keeps gameplay coordinates stable while each world keeps its own profile.
    surface_y: Math.floor(base + amplitude * relief - world.recipe.sea_level),
    climate,
    biome,
    surface_id: world.materials.id_for(biome.land.surface, 'surface', biome.land.subsurface),
    subsurface_id: world.materials.id_for(biome.land.subsurface, 'subsurface'),
    filler_id: world.materials.id_for(biome.land.filler, 'filler'),
  }
}

export const far_shell_y = (world: CompiledWorld, x: number, z: number): number =>
  sample_world_column(world, x, z).surface_y - 0.5
