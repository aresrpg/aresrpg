// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

export { ATMOSPHERE_CONTROLS, resolve_atmosphere_tuning, type AtmosphereTuning } from './atmosphere_tuning.ts'
export { create_engine } from './renderer.ts'
export { create_character_preview } from './character_preview.ts'
export type { PetWingStyle } from './pet_wing_style.ts'
export { fight_placement_blobs } from './fight_blobs.ts'
export { fight_blob_preset } from './fight_blob_presets.ts'
export * from './data.ts'
export { CELESTIAL_CYCLE_MS, DAY_FRAC, MIDDAY_TIME_OF_DAY } from './sky/celestial_motion.ts'
export { MATERIAL_PRESETS } from './material_presets.ts'
export { preload_mob_model } from './mob_model.ts'
export { create_terrain_planner } from './terrain_planner.ts'
export { STRUCTURE_PACKS, STRUCTURE_TYPES } from './structures.ts'
export { city_blocks } from './cities/city_structure.ts'
export type { WorldMaterial } from './world_materials.ts'
export type { MaterialPreset } from './material_presets.ts'
export type { TerrainColumnCoordinate, TerrainColumnPlan } from './terrain_planner.ts'
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
export type { WorldCaption, CaptionTarget } from './caption_types.ts'
export { wrap_caption, create_caption_raster } from './caption_raster.ts'

export { terrain_failure } from './asset_error.ts'
