// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

export { ATMOSPHERE_CONTROLS, resolve_atmosphere_tuning, type AtmosphereTuning } from './atmosphere_tuning.ts'
export { create_engine } from './renderer.ts'
export { create_character_preview } from './character_preview.ts'
export { fight_path_gait, mob_entity_scale } from './entities.ts'
export { fight_placement_blobs } from './fight_blobs.ts'
export { fight_blob_preset } from './fight_blob_presets.ts'
export type { FightBlobPreset } from './fight_blob_presets.ts'
export { sample_biome_cell, sample_biome_grid } from './biome_grid.ts'
export {
  effective_render_distance,
  get_quality_profile,
  QUALITY_OPTIONS,
  QUALITY_PROFILES,
  quality_pixel_ratio,
} from './quality.ts'
export { CHUNK_EDGE } from './voxel_data.ts'
export { apply_voxel_operation } from './voxel_operation.ts'
export { CELESTIAL_CYCLE_MS, DAY_FRAC, MIDDAY_TIME_OF_DAY } from './sky/celestial_motion.ts'
export { MATERIAL_PRESETS, material_pattern } from './material_presets.ts'
export { create_world_preview } from './world_preview.ts'
export {
  city_at_position,
  client_world_position,
  world_city_areas,
  world_terrain,
  worlds_source,
  type WorldCityArea,
} from './world_catalog.ts'
export { DUNGEON_GATE } from './portal_shape.ts'
export { preload_mob_model } from './mob_model.ts'
export { create_terrain_planner } from './terrain_planner.ts'
export { city_map_overlays, structure_voxels } from './structure_placement.ts'
export {
  generated_city_intersects,
  load_generated_city_artifacts,
  load_generated_city_artifacts_for,
} from './cities/generated_city.ts'
export type { CityMapOverlay } from './structure_placement.ts'
export { STRUCTURE_PACKS, STRUCTURE_TYPES } from './structures.ts'
export { city_blocks } from './cities/city_structure.ts'
export type { FixedStructure } from './fixed_structures.ts'
export type { GeneratedCityTerrain as TerrainHeightGrid } from './cities/types.ts'
// the engine's deterministic-placement PRNG, shared upward: the world's chain-driven spawns seed
// their own scatter and wander from it, so a mob stands where it stood last reload and never
// grows a second copy of this algorithm
export { mulberry } from './nature/sprite_kit.ts'
export { create_fbm_sampler } from './world_noise.ts'
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
} from './world_recipe.ts'
export type { WorldMaterial } from './world_materials.ts'
export type { MaterialPreset } from './material_presets.ts'
export type { BiomeGrid } from './biome_grid.ts'
export type { BiomeSlot, CompiledWorld, WorldRecipe } from './world_recipe.ts'
export type { WorldPreview } from './world_preview.ts'
export type { TerrainColumnCoordinate, TerrainColumnPlan, TerrainPlanner } from './terrain_planner.ts'
export type { CharacterPreview } from './character_preview.ts'
export type {
  ChunkCoordinate,
  ChunkLod,
  ChunkRenderOutcome,
  DungeonPortalMarker,
  DungeonStageRender,
  CharacterAppearanceRender,
  CharacterAura,
  CharacterAnimationName,
  CharacterAnimationRender,
  CharacterEntityRender,
  Engine,
  EngineFrame,
  EngineIssue,
  EngineIssueCode,
  EnginePresentation,
  EngineQuality,
  EngineRenderState,
  EngineStatus,
  FightBlobRender,
  FightBlobDecoration,
  FightBlobShape,
  FightBlobSpec,
  FightCastStyle,
  FightPresentationCue,
  FightBoardRender,
  FightBoardRenderCell,
  EntityAnchor,
  EntityFacing,
  EntityPathMotion,
  EntityScreenAnchor,
  EntityRender,
  EntityVisualEffect,
  FightSide,
  FightSwordMarker,
  MobEntityRender,
  QualityProfile,
  ResourceNodeMarker,
  RenderChunkRequest,
  Vec3,
  WornModelRender,
  WorldPanel,
} from './types.ts'

export { CAPTION_STYLE, type WorldCaption, type CaptionLine, type CaptionTarget } from './caption_types.ts'

export { wrap_caption, create_caption_raster } from './caption_raster.ts'
