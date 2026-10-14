// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

// Plain engine data and terrain queries for callers that do not mount a renderer.
export {
  effective_render_distance,
  get_quality_profile,
  QUALITY_OPTIONS,
  QUALITY_PROFILES,
  quality_pixel_ratio,
} from './quality.ts'
export type { EngineQuality } from './types.ts'
export { CHUNK_EDGE } from './voxel_data.ts'
export { apply_voxel_operation } from './voxel_operation.ts'
export {
  city_at_position,
  client_world_position,
  world_city_areas,
  world_terrain,
  worlds_source,
  type WorldCityArea,
} from './world_catalog.ts'
export { city_map_overlays, structure_voxels, type CityMapOverlay } from './structure_placement.ts'
export {
  generated_city_intersects,
  load_generated_city_artifacts,
  load_generated_city_artifacts_for,
} from './cities/generated_city.ts'
export { mulberry } from './nature/sprite_kit.ts'
export {
  BIOME_SLOTS,
  compile_runtime_world_recipe,
  compile_world_recipe,
  landscape_height,
  MAX_SURFACE_Y,
  parse_world_recipe,
  sample_world_column,
  surface_layer_for_slope,
  terrain_layer,
  terrain_material_id,
  terrain_slope,
  validate_world_recipe,
  WORLD_HEIGHT,
  type BiomeSlot,
  type CompiledWorld,
  type WorldRecipe,
} from './world_recipe.ts'
export { sample_biome_cell, sample_biome_grid, type BiomeGrid } from './biome_grid.ts'

export { SPELL_EFFECT_CLASSES, spell_effect_timing } from './spell_effect_recipe.ts'
export { create_source as create_authored_spell_source } from './generated/claude_spell_source.js'
export type { ClaudeSpell, ClaudeSoundEvent } from './generated/claude_spell_source.js'
export type { SpellEffectClass, SpellEffectRecipe } from './spell_effect_recipe.ts'
