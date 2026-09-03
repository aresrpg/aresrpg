// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import packs_source from '../../../seed/content/structure_packs.json'
import types_source from '../../../seed/structures/types.json'

import { city_material_uses, compile_cities } from './cities/index.ts'
import type { CompiledCity } from './cities/types.ts'
import type { CompiledMaterials, MaterialUse } from './world_materials.ts'

export type StructureTypeSource = Readonly<{
  size: readonly [number, number, number]
  anchor: readonly [number, number, number]
  palette: readonly string[]
  runs: string
}>

export type StructurePackSource = Readonly<{
  category: 'trees' | 'rocks' | 'ruins'
  spacing: number
  density_bp: number
  max_slope: number
  bury: number
  scale?: readonly [number, number]
  types: readonly Readonly<{ type: string; weight: number }>[]
}>

type StructureTypesFile = Readonly<{ version: number; types: Readonly<Record<string, StructureTypeSource>> }>
type StructurePacksFile = Readonly<{ version: number; packs: Readonly<Record<string, StructurePackSource>> }>

export const STRUCTURE_TYPES = (types_source as unknown as StructureTypesFile).types
export const STRUCTURE_PACKS = (packs_source as unknown as StructurePacksFile).packs

export type CompiledStructureType = Readonly<{
  name: string
  size: readonly [number, number, number]
  anchor: readonly [number, number, number]
  packed_voxels: Uint32Array
  y_offsets: Uint32Array
  footprint: number
}>

export type CompiledStructurePack = Readonly<{
  name: string
  category: StructurePackSource['category']
  spacing: number
  density_bp: number
  max_slope: number
  bury: number
  scale_min: number
  scale_max: number
  biomes: readonly string[]
  fixed_areas: readonly StructureAreaSource[]
  types: readonly Readonly<{ type: CompiledStructureType; weight: number }>[]
  weight_sum: number
  max_footprint: number
}>

export type CompiledStructures = Readonly<{
  packs: readonly CompiledStructurePack[]
  cities: readonly CompiledCity[]
}>

type BiomeStructureSource = Readonly<{ name: string; structure_packs?: readonly string[] }>
export type StructureAreaSource = Readonly<{
  id: string
  min_x: number
  max_x: number
  min_z: number
  max_z: number
  anchor_x?: number
  anchor_z?: number
  structure_packs: readonly string[]
}>

const referenced_pack_names = (
  biomes: readonly BiomeStructureSource[],
  fixed_areas: readonly StructureAreaSource[] = []
): readonly string[] =>
  [
    ...biomes.flatMap(({ structure_packs = [] }) => structure_packs),
    ...fixed_areas.flatMap(({ structure_packs }) => structure_packs),
  ].filter((name, index, names) => names.indexOf(name) === index)

const referenced_type_names = (
  biomes: readonly BiomeStructureSource[],
  fixed_areas: readonly StructureAreaSource[] = []
): readonly string[] =>
  referenced_pack_names(biomes, fixed_areas)
    .flatMap((name) => STRUCTURE_PACKS[name]?.types.map(({ type }) => type) ?? [])
    .filter((name, index, names) => names.indexOf(name) === index)

export const validate_biome_structure_packs = (
  structure_packs: unknown,
  materials: unknown,
  prefix: string
): readonly string[] => {
  if (structure_packs === undefined) return []
  if (!Array.isArray(structure_packs)) return [`${prefix} must be an array`]
  const material_record =
    materials !== null && typeof materials === 'object' && !Array.isArray(materials)
      ? (materials as Readonly<Record<string, unknown>>)
      : {}
  return structure_packs.flatMap((candidate, index) => {
    const path = `${prefix}[${index}]`
    if (typeof candidate !== 'string' || !STRUCTURE_PACKS[candidate])
      return [`${path} references unknown pack "${typeof candidate === 'string' ? candidate : ''}"`]
    const missing = STRUCTURE_PACKS[candidate].types.flatMap(({ type }) => {
      const template = STRUCTURE_TYPES[type]
      if (!template) return [`${path} references missing structure type "${type}"`]
      return template.palette.flatMap((material) =>
        material !== 'air' && !(material in material_record)
          ? [`${path} requires missing material "${material}" for type "${type}"`]
          : []
      )
    })
    return missing.filter((error, error_index) => missing.indexOf(error) === error_index)
  })
}

export const structure_material_uses = (
  biomes: readonly BiomeStructureSource[],
  fixed_areas: readonly StructureAreaSource[] = []
): readonly MaterialUse[] => [
  ...referenced_type_names(biomes, fixed_areas)
    .flatMap((name) => STRUCTURE_TYPES[name]?.palette ?? [])
    .filter((name) => name !== 'air')
    .filter((name, index, names) => names.indexOf(name) === index)
    .map((name) => ({ name, role: 'filler' as const })),
  ...city_material_uses(fixed_areas),
]

const compile_type = (name: string, materials: CompiledMaterials): CompiledStructureType => {
  const source = STRUCTURE_TYPES[name]
  if (!source) throw new TypeError(`unknown structure type "${name}"`)
  const material_ids = source.palette.map((material) => (material === 'air' ? 0 : materials.id_for(material)))
  const [width, , length] = source.size
  const run_bytes = Uint8Array.from(atob(source.runs), (character) => character.charCodeAt(0))
  const run_view = new DataView(run_bytes.buffer, run_bytes.byteOffset, run_bytes.byteLength)
  const voxels: number[] = []
  const y_counts = new Uint32Array(source.size[1])
  for (let run = 0; run < run_bytes.length; run += 5) {
    const start = run_view.getUint16(run, true)
    const count = run_view.getUint16(run + 2, true)
    const material_id = material_ids[run_view.getUint8(run + 4)]!
    for (let offset = 0; offset < count; offset += 1) {
      const linear = start + offset
      const x = linear % width
      const z = Math.floor(linear / width) % length
      const y = Math.floor(linear / (width * length))
      voxels.push(((material_id & 0xff) << 24) | ((y & 0xff) << 16) | ((z & 0xff) << 8) | (x & 0xff))
      y_counts[y] += 1
    }
  }
  const y_offsets = new Uint32Array(source.size[1] + 1)
  y_counts.forEach((count, y) => {
    y_offsets[y + 1] = y_offsets[y]! + count
  })
  return Object.freeze({
    name,
    size: source.size,
    anchor: source.anchor,
    packed_voxels: new Uint32Array(voxels),
    y_offsets,
    footprint: Math.max(source.size[0], source.size[2]),
  })
}

export const compile_structures = (
  biomes: readonly BiomeStructureSource[],
  materials: CompiledMaterials,
  fixed_areas: readonly StructureAreaSource[] = []
): CompiledStructures => {
  const compiled_types = new Map<string, CompiledStructureType>()
  const type_for = (name: string): CompiledStructureType => {
    const existing = compiled_types.get(name)
    if (existing) return existing
    const compiled = compile_type(name, materials)
    compiled_types.set(name, compiled)
    return compiled
  }
  const packs = referenced_pack_names(biomes, fixed_areas).map((name) => {
    const source = STRUCTURE_PACKS[name]!
    const types = source.types.map(({ type, weight }) => Object.freeze({ type: type_for(type), weight }))
    const [scale_min, scale_max] = source.scale ?? [1, 1]
    return Object.freeze({
      name,
      category: source.category,
      spacing: source.spacing,
      density_bp: source.density_bp,
      max_slope: source.max_slope,
      bury: source.bury,
      scale_min,
      scale_max,
      biomes: Object.freeze(
        biomes.filter(({ structure_packs = [] }) => structure_packs.includes(name)).map(({ name: biome }) => biome)
      ),
      fixed_areas: Object.freeze(fixed_areas.filter(({ structure_packs }) => structure_packs.includes(name))),
      types: Object.freeze(types),
      weight_sum: types.reduce((sum, { weight }) => sum + weight, 0),
      max_footprint: Math.max(...types.map(({ type }) => type.footprint)) * scale_max,
    })
  })
  const cities = compile_cities(fixed_areas)
  return Object.freeze({
    packs: Object.freeze(packs),
    cities,
  })
}
