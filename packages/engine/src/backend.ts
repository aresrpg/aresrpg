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
  RenderChunkRequest,
  Vec3,
} from './types.ts'

export type EngineBackend = Readonly<{
  kind: 'webgpu' | 'grid'
  render: (now: number) => void
  set_camera: (position: Vec3, target: Vec3, projection?: CameraProjection) => void
  set_quality: (quality: EngineQuality) => void
  set_time_of_day: (time: number) => void
  set_flatten_amount: (amount: number) => void
  set_fight_board: (board: FightBoardRender | null) => void
  set_entities: (entities: readonly EntityRender[]) => void
  animate_entity: (motion: EntityPathMotion) => Promise<boolean>
  play_fight_cue: (cue: FightPresentationCue) => Promise<boolean>
  project_entity: (id: string) => EntityScreenAnchor | null
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
