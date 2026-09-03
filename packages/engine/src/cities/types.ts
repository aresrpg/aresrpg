// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { CompiledStructureType, StructureAreaSource } from '../structures.ts'

export type CityArea = StructureAreaSource & Readonly<{ anchor_x: number; anchor_z: number }>
export type CityNatureKind = 'cobweb' | 'dry_reed' | 'city_shrub' | 'field_crop'
export type CityNatureRule = Readonly<{
  kind: CityNatureKind | 'flower' | 'mushroom' | 'twig' | 'pebble' | 'tuft'
  chance_bp: number
}>
export type CompiledCity = Readonly<{
  id: string
  area: CityArea
  nature_at: (land_use: string | null) => readonly CityNatureRule[]
  preserves_structure: (category: 'trees' | 'rocks' | 'ruins', land_use: string | null) => boolean
  clear_radius: number
}>
export type CityPlacementDraft = Readonly<{
  id: string
  type: CompiledStructureType
  x: number
  y?: number
  z: number
  rotation: 0 | 1 | 2 | 3
}>
export type CityMapStructure = Readonly<{
  id: string
  type: string
  min_x: number
  max_x: number
  min_z: number
  max_z: number
}>

export type GeneratedCityTerrain = Readonly<{
  cell_size: number
  width: number
  depth: number
  min_x: number
  min_z: number
  target_heights: readonly number[]
  cut_cells: readonly number[]
}>

export type GeneratedCityChunk = Readonly<{
  x: number
  y: number
  z: number
  palette: readonly string[]
  runs: string
  voxels: number
}>

export type GeneratedCityArtifact = Readonly<{
  version: number
  id: string
  source_hash: string
  area: CityArea
  chunks: readonly GeneratedCityChunk[]
}>

export type GeneratedCityMapArtifact = Readonly<{
  version: number
  id: string
  source_hash: string
  area: CityArea
  map: readonly CityMapStructure[]
  terrain: GeneratedCityTerrain
}>

export type CityRuntimeDefinition = Readonly<{
  id: string
  material_names: readonly string[]
  compile: (area: CityArea) => CompiledCity
  artifact_url: URL
  map: GeneratedCityMapArtifact
  land_uses: Readonly<Record<string, string>>
}>
