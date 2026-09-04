// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

export type Vec3 = readonly [number, number, number]
export type EngineQuality = 'low' | 'medium' | 'high'
export type EnginePresentation = 'world' | 'fight'
export type FightBoardRenderCell = Readonly<{
  cell: number
  x: number
  y: number
  kind: 'floor' | 'obstacle' | 'hole' | 'start_a' | 'start_b'
}>
export type FightBoardRender = Readonly<{
  width: number
  height: number
  cell_size: number
  origin: Readonly<{ x: number; y: number; z: number }>
  show_start_cells?: boolean
  cells: readonly FightBoardRenderCell[]
}>
export type EntityAnchor = Readonly<{ kind: 'fight_cell'; cell: number }> | Readonly<{ kind: 'world'; position: Vec3 }>
export type FightSide = 'a' | 'b'
/** A planted fight sword — the join-window clock made physical. `y` is the anchor's ground
 *  level; every height the layer animates measures from there. */
export type FightSwordMarker = Readonly<{
  id: string
  x: number
  y: number
  z: number
  /** the chain's placement birth wall-clock (ms epoch) */
  placement_ms: number
}>
/** One visual gather block. Resource identity selects its recognizable procedural silhouette;
 * job+tier supplies the family fallback. `id` is the patch+ordinal interaction key. */
export type ResourceNodeMarker = Readonly<{
  id: string
  x: number
  y: number
  z: number
  item_type: string
  job: string
  tier: number
}>
export type DungeonPortalMarker = Readonly<{ id: string; x: number; z: number }>
export type DungeonStageRender = Readonly<{ x: number; y: number; z: number }>
export type EntityFacing =
  Readonly<{ kind: 'yaw'; yaw: number }> | Readonly<{ kind: 'fight_opponents'; side: FightSide }>
export type EntityVisualEffect = Readonly<{ kind: 'invisibility' }>
export type WornModelRender = Readonly<{ url: string; variant: string | null }>
export type CharacterAppearanceRender = Readonly<{
  body_url: string | null
  hair_url: string | null
  colors: readonly [string, string, string]
  worn: Readonly<{ head: WornModelRender | null; back: WornModelRender | null }>
}>
export type CharacterAnimationName = 'IDLE' | 'WALK' | 'RUN' | 'JUMP' | 'JUMP_RUN' | 'FALL' | 'SWIM' | 'SIT' | 'DANCE'
export type CharacterAnimationRender = Readonly<{ name: CharacterAnimationName; time_scale: number }>
export type MobEntityRender = Readonly<{
  id: string
  kind: 'mob'
  model_url: string
  variant?: string | null
  level_scalar?: number
  anchor: EntityAnchor
  facing: EntityFacing
  animation?: CharacterAnimationRender
  visual_effect?: EntityVisualEffect
  visible?: boolean
}>
export type CharacterEntityRender = Readonly<{
  id: string
  kind: 'character'
  /** World crowds batch compatible appearances; controlled and tactical actors stay individual. */
  presentation?: 'individual' | 'crowd'
  appearance: CharacterAppearanceRender
  anchor: EntityAnchor
  facing: EntityFacing
  animation?: CharacterAnimationRender
  visual_effect?: EntityVisualEffect
  visible?: boolean
}>
export type EntityRender = MobEntityRender | CharacterEntityRender
// 'slide' is forced displacement (push/pull): faster travel, no locomotion clip, and the
// entity keeps its facing — being shoved is not walking.
export type EntityPathMotion = Readonly<{
  id: string
  cells: readonly number[]
  gait: 'walk' | 'run' | 'slide'
}>
export type EntityScreenAnchor = Readonly<{ x: number; y: number }>
export type FightBlobShape = 'single' | 'per_cell'
export type FightBlobDecoration = 'trap'
export type FightBlobSpec = Readonly<{
  cells: readonly number[]
  shape: FightBlobShape
  color: number
  priority?: number
  origin_cell?: number
  opacity?: number
  reveal_step_ms?: number
  animate?: boolean
  animate_updates?: boolean
  duration_ms?: number
  decoration?: FightBlobDecoration
  // 'border' paints only a glowing edge band instead of the filled shape
  style?: 'fill' | 'border'
  // slow breathing on opacity — the active-fighter emphasis
  pulse?: boolean
}>
export type FightBlobRender = FightBlobSpec &
  Readonly<{
    id: string
    created_at: number
  }>
export type ChunkLod = 'near' | 'mid' | 'far'
export type ChunkCoordinate = Readonly<{ x: number; y: number; z: number }>
export type RenderChunkRequest = Readonly<{
  key: string
  coordinate: ChunkCoordinate
  lod: ChunkLod
}>
export type ChunkRenderOutcome = 'rendered' | 'failed' | 'removed'
export type EngineIssueCode =
  | 'webgpu_unavailable'
  | 'webgpu_initialization_failed'
  | 'advanced_sky_failed'
  | 'graphics_unavailable'
  | 'world_unavailable'
export type EngineIssue = Readonly<{ code: EngineIssueCode; detail?: string }>
export type EngineStatus = Readonly<{
  state: 'initializing' | 'ready' | 'degraded' | 'failed'
  backend: 'none' | 'webgpu' | 'grid'
  issue?: EngineIssue
}>

export type EngineRenderState = Readonly<{
  settled: boolean
  mesh_queued: number
  mesh_active: number
  uploads_pending: number
  uploads_blocked: number
  retries_pending: number
  failed_chunks: number
  far_ready: boolean
  sky_ready: boolean
}>
export type EngineFrame = Readonly<{ now: number; delta_seconds: number }>

export type QualityProfile = Readonly<{
  name: EngineQuality
  render: Readonly<{ scale: number; scene_scale: number; sharpness: number | null; dpr_max: number; pixel_max: number }>
  chunks: Readonly<{
    near_radius: number
    mid_radius: number
    far_radius: number
    evict_per_frame: number
    request_per_frame: number
    max_in_flight: number
    upload_bytes_per_frame: number
    upload_time_ms: number
    horizon_radius: number
    horizon_step: number
  }>
  sky: EngineQuality
  terrain: Readonly<{ kind: 'flat' | 'lit' | 'pbr'; texture_size: 16 | 32 }>
  fog: Readonly<{ near: number; far: number }>
  shadows: Readonly<{ kind: 'none' | 'basic' | 'soft'; map_size: number }>
  effects: Readonly<{
    bloom: Readonly<{ strength: number; radius: number; threshold: number }> | null
    sun_shafts: Readonly<{
      samples: number
      resolution: number
      density: number
      decay: number
      strength: number
      threshold: number
    }> | null
  }>
}>

export type ChunkRenderData = Readonly<{
  key: string
  coordinate: ChunkCoordinate
  origin: Vec3
  lod: ChunkLod
  resolution: number
  cell_size: number
  // Stable material id per local voxel. This worker-only array is folded into
  // word B by the mesher and never uploaded as a separate GPU buffer.
  material_ids: Uint16Array
  // Three views of the same opaque voxels. Each contains 32×32 rows of 32 bits,
  // with the bit axis respectively X, Y, and Z.
  occupancy: readonly [Uint32Array, Uint32Array, Uint32Array]
  // A one-voxel shell around the chunk, packed as a 34³ bitset. It prevents seams
  // and remains sufficient for diagonal ambient-occlusion probes later.
  halo_occupancy: Uint32Array
}>

export type RenderedChunk = Readonly<
  Pick<ChunkRenderData, 'key' | 'coordinate' | 'origin' | 'lod' | 'resolution' | 'cell_size'>
>

export type CameraProjection = Readonly<{
  fov?: number
  ortho_blend?: number
  /** Visible world-space height when fully orthographic. Omit to match the perspective framing. */
  ortho_height?: number
}>

export type FightCastStyle =
  'damage' | 'dot' | 'heal' | 'trap' | 'glyph' | 'push' | 'pull' | 'teleport' | 'buff' | 'debuff' | 'state' | 'weapon'

export type FightPresentationCue =
  | Readonly<{
      id: string
      type: 'cast'
      caster_id: string
      /** the caster aimed its own cell — plays the buff pose instead of the attack swing */
      self_cast: boolean
      spell: string
      cast_level: number
      target_cell: number
      element: string
      style: FightCastStyle
      critical: boolean
      amount: number
      target_max_hp: number | null
      affected_cells: readonly number[]
      killed: boolean
    }>
  | Readonly<{
      id: string
      type: 'movement'
      entity_id: string
      cells: readonly number[]
      mode: string
      source_id: string
      mp_spent: number
      gait: EntityPathMotion['gait']
    }>
  | Readonly<{
      id: string
      type: 'damage'
      source_id: string
      target_id: string
      amount: number
      hp_before: number
      hp_after: number
      element: string
      cause: string
      critical: boolean
    }>
  | Readonly<{
      id: string
      type: 'absorb'
      source_id: string
      target_id: string
      prevented: number
      remaining: number
    }>
  | Readonly<{
      id: string
      type: 'heal'
      source_id: string
      target_id: string
      amount: number
      hp_before: number
      hp_after: number
      cause: string
    }>
  | Readonly<{
      id: string
      type: 'death'
      entity_id: string
      source_id: string
      cell: number
      cause: string
    }>
  | Readonly<{
      id: string
      type: 'zone'
      action: 'trap_triggered' | 'glyph_triggered'
      zone_id: string
      owner_id: string
      target_id: string
      affected_ids?: readonly string[]
      cell: number
      element: string
    }>
  | Readonly<{
      id: string
      type: 'zone_placed'
      action: 'trap_placed' | 'glyph_placed'
      zone_id: string
      owner_id: string
      cell: number
    }>
  | Readonly<{
      id: string
      type: 'zone_removed'
      zone_id: string
    }>
  | Readonly<{
      id: string
      type: 'visibility'
      entity_id: string
      invisible: boolean
    }>
  | Readonly<{
      id: string
      type: 'status'
      entity_id: string
      effects: readonly Readonly<{
        kind: bigint
        element: string
        value: bigint
        turns_left: bigint
        source: bigint
        stat: bigint
      }>[]
    }>
  | Readonly<{
      id: string
      type: 'turn'
      entity_id: string
      /** Logical fight turn identity; stable across receipt prediction and indexed replay. */
      turn_key: string
      // minimum on-screen duration of THIS turn before the next turn cue may play
      // (the chain's per-mob turn floor, projected by the game side)
      min_ms?: number
    }>
  | Readonly<{
      id: string
      type: 'tackle'
      entity_id: string
      source_id: string
      ap_lost: number
      mp_lost: number
    }>
  | Readonly<{
      id: string
      type: 'pool'
      entity_id: string
      // signed deltas: a loss is negative, a gain positive
      ap: number
      mp: number
    }>

export type Engine = Readonly<{
  start: (update?: (frame: EngineFrame) => void) => void
  stop: () => void
  // projection.fov drives the perspective lens; projection.ortho_blend (0 = perspective,
  // 1 = orthographic) lets game-side camera addons travel between views seamlessly.
  set_camera: (position: Vec3, target: Vec3, projection?: CameraProjection) => void
  /** The followed character's FEET (null when nobody is followed) — feeds character-anchored
   * presentation like the night lantern. */
  set_character_anchor: (position: Vec3 | null) => void
  set_quality: (quality: EngineQuality, render_distance?: number | null) => void
  set_audio_volume: (volume: number) => void
  set_time_of_day: (time: number) => void
  set_clouds_visible: (visible: boolean) => void
  set_flatten_amount: (amount: number) => void
  set_fight_board: (board: FightBoardRender | null) => void
  set_entities: (entities: readonly EntityRender[]) => void
  /** planted fight swords — the join-window clock made physical (whole-set replace) */
  set_fight_swords: (url: string, impact_sound_url: string, markers: readonly FightSwordMarker[]) => void
  set_fight_sword_label: (id: string, element: HTMLElement | null) => void
  set_resource_nodes: (markers: readonly ResourceNodeMarker[]) => void
  set_resource_node_label: (id: string, element: HTMLElement | null) => void
  /** float the approach tooltip at the star gate (a fixed world-origin anchor); null detaches */
  set_portal_label: (element: HTMLElement | null) => void
  set_dungeon_portals: (markers: readonly DungeonPortalMarker[]) => void
  set_dungeon_stage: (stage: DungeonStageRender | null) => void
  animate_entity: (motion: EntityPathMotion) => Promise<boolean>
  play_fight_cue: (cue: FightPresentationCue) => Promise<boolean>
  play_jump_puff: (position: Vec3) => void
  project_entity: (id: string) => EntityScreenAnchor | null
  /** float a DOM element over an entity's rendered crown, positioned by the frame's own camera
   *  pass (three CSS2D labels — never lags the render); null detaches */
  set_entity_label: (id: string, element: HTMLElement | null) => void
  set_world_label: (id: string, element: HTMLElement | null, position: Vec3 | null) => void
  entity_height: (id: string) => number | null
  create_fight_blob: (blob: FightBlobSpec) => string
  update_fight_blob: (id: string, blob: FightBlobSpec) => boolean
  remove_fight_blob: (id: string) => void
  pick_fight_cell: (client_x: number, client_y: number) => number | null
  render_chunk: (chunk: RenderChunkRequest) => Promise<ChunkRenderOutcome>
  remove_chunk: (key: string) => void
  chunk_count: () => number
  render_state: () => EngineRenderState
  quality: () => EngineQuality
  flattened: () => boolean
  backend: () => 'initializing' | 'webgpu' | 'grid'
  status: () => EngineStatus
  subscribe_status: (listener: (status: EngineStatus) => void) => () => void
  dispose: () => void
}>
