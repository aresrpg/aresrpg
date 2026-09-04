// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type {
  CameraProjection,
  ChunkRenderOutcome,
  EntityRender,
  EntityPathMotion,
  EntityScreenAnchor,
  FightPresentationCue,
  EngineQuality,
  EngineRenderState,
  FightBlobRender,
  FightBoardRender,
  FightSwordMarker,
  ResourceNodeMarker,
  DungeonPortalMarker,
  DungeonStageRender,
  RenderChunkRequest,
  Vec3,
} from './types.ts'

export type EngineBackend = Readonly<{
  kind: 'webgpu' | 'grid'
  render: (now: number) => void
  set_camera: (position: Vec3, target: Vec3, projection?: CameraProjection) => void
  /** The followed character's FEET — character-anchored presentation (the night lantern) rides
   * this, never the camera target (which leads the character). Null when nobody is followed. */
  set_character_anchor: (position: Vec3 | null) => void
  set_quality: (quality: EngineQuality, render_distance?: number | null) => void
  set_audio_volume: (volume: number) => void
  set_time_of_day: (time: number) => void
  set_clouds_visible: (visible: boolean) => void
  set_flatten_amount: (amount: number) => void
  set_fight_board: (board: FightBoardRender | null) => void
  set_entities: (entities: readonly EntityRender[]) => void
  set_fight_swords: (url: string, impact_sound_url: string, markers: readonly FightSwordMarker[]) => void
  set_fight_sword_label: (id: string, element: HTMLElement | null) => void
  set_resource_nodes: (markers: readonly ResourceNodeMarker[]) => void
  set_resource_node_label: (id: string, element: HTMLElement | null) => void
  /** the star-gate approach tooltip — anchored at the world origin's fixed dressing point */
  set_portal_label: (element: HTMLElement | null) => void
  set_dungeon_portals: (markers: readonly DungeonPortalMarker[]) => void
  set_dungeon_stage: (stage: DungeonStageRender | null) => void
  animate_entity: (motion: EntityPathMotion) => Promise<boolean>
  play_fight_cue: (cue: FightPresentationCue) => Promise<boolean>
  play_jump_puff: (position: Vec3) => void
  project_entity: (id: string) => EntityScreenAnchor | null
  set_entity_label: (id: string, element: HTMLElement | null) => void
  set_world_label: (id: string, element: HTMLElement | null, position: Vec3 | null) => void
  entity_height: (id: string) => number | null
  upsert_fight_blob: (blob: FightBlobRender) => void
  remove_fight_blob: (id: string) => void
  pick_fight_cell: (client_x: number, client_y: number) => number | null
  render_chunk: (chunk: RenderChunkRequest) => Promise<ChunkRenderOutcome>
  remove_chunk: (key: string) => void
  chunk_count: () => number
  render_state: () => EngineRenderState
  flattened: () => boolean
  dispose: () => void
}>
