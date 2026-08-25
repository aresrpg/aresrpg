// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { EngineBackend } from './backend.ts'
import { create_grid_fallback } from './grid_fallback.ts'
import type {
  CameraProjection,
  ChunkRenderOutcome,
  DungeonPortalMarker,
  DungeonStageRender,
  EntityRender,
  EngineFrame,
  Engine,
  EngineIssue,
  EnginePresentation,
  EngineQuality,
  EngineStatus,
  FightBlobRender,
  FightBlobSpec,
  FightBoardRender,
  FightPresentationCue,
  FightSwordMarker,
  ResourceNodeMarker,
  RenderChunkRequest,
  Vec3,
} from './types.ts'
import { parse_world_recipe } from './world_recipe.ts'

const ENGINE_BOOT = Symbol('aresrpg.engine_boot')

const supports_webgpu = (): boolean => typeof navigator !== 'undefined' && 'gpu' in navigator && navigator.gpu != null

export const create_retained_values = <T>() => {
  const values = new Map<string, T>()
  return Object.freeze({
    set: (id: string, value: T | null): void => {
      if (value === null) values.delete(id)
      else values.set(id, value)
    },
    replay: (apply: (id: string, value: T) => void): void => values.forEach((value, id) => apply(id, value)),
    clear: (): void => values.clear(),
  })
}

export const create_engine = ({
  canvas,
  world: world_value,
  quality: initial_quality = 'medium',
  presentation = 'world',
  initial_focus = [0, 0],
}: Readonly<{
  canvas: HTMLCanvasElement
  world: unknown
  quality?: EngineQuality
  presentation?: EnginePresentation
  initial_focus?: readonly [number, number]
}>): Engine => {
  const world = parse_world_recipe(world_value)
  const pending_chunks = new Map<string, RenderChunkRequest>()
  const chunk_waiters = new Map<
    string,
    Readonly<{ chunk: RenderChunkRequest; resolve: (outcome: ChunkRenderOutcome) => void }>
  >()
  const status_listeners = new Set<(status: EngineStatus) => void>()
  let backend: EngineBackend | null = null
  let status: EngineStatus = Object.freeze({ state: 'initializing', backend: 'none' })
  let quality = initial_quality
  let render_distance: number | null = null
  let camera: Readonly<{ position: Vec3; target: Vec3; projection: CameraProjection }> = {
    position: [initial_focus[0] + 36, 34, initial_focus[1] + 36],
    target: [initial_focus[0], 0, initial_focus[1]],
    projection: {},
  }
  let time_of_day = 0.31
  let flat_amount = 0
  let fight_board: FightBoardRender | null = null
  let entities: readonly EntityRender[] = Object.freeze([])
  let resource_nodes: readonly ResourceNodeMarker[] = Object.freeze([])
  let dungeon_portals: readonly DungeonPortalMarker[] = Object.freeze([])
  let dungeon_stage: DungeonStageRender | null = null
  let fight_swords: Readonly<{
    url: string
    impact_sound_url: string
    markers: readonly FightSwordMarker[]
  }> | null = null
  const entity_labels = create_retained_values<HTMLElement>()
  const world_labels = create_retained_values<Readonly<{ element: HTMLElement; position: Vec3 }>>()
  const resource_labels = create_retained_values<HTMLElement>()
  const fight_sword_labels = create_retained_values<HTMLElement>()
  const portal_labels = create_retained_values<HTMLElement>()
  let character_anchor: Vec3 | null = null
  const pending_fight_cues: Array<Readonly<{ cue: FightPresentationCue; resolve: (played: boolean) => void }>> = []
  const fight_blobs = new Map<string, FightBlobRender>()
  let fight_blob_serial = 0
  let started = false
  let animation_frame: number | null = null
  let previous_frame = performance.now()
  let update: (frame: EngineFrame) => void = () => {}
  let disposed = false

  const draw = (now: number): void => {
    const delta_seconds = Math.min(0.1, Math.max(0, now - previous_frame) / 1000)
    previous_frame = now
    fight_blobs.forEach((blob, id) => {
      if (blob.duration_ms === undefined || now - blob.created_at < blob.duration_ms) return
      fight_blobs.delete(id)
      backend?.remove_fight_blob(id)
    })
    update(Object.freeze({ now, delta_seconds }))
    backend?.render(now)
    if (started) animation_frame = requestAnimationFrame(draw)
  }

  const publish_status = (next: EngineStatus): void => {
    status = Object.freeze(next)
    status_listeners.forEach((listener) => listener(status))
  }

  const submit_chunk = (chunk: RenderChunkRequest): void => {
    if (!backend) return
    void backend.render_chunk(chunk).then(
      (outcome) => {
        const waiter = chunk_waiters.get(chunk.key)
        if (waiter?.chunk !== chunk) return
        chunk_waiters.delete(chunk.key)
        waiter.resolve(outcome)
      },
      () => {
        const waiter = chunk_waiters.get(chunk.key)
        if (waiter?.chunk !== chunk) return
        chunk_waiters.delete(chunk.key)
        waiter.resolve('failed')
      }
    )
  }

  const attach = (next: EngineBackend, issue?: EngineIssue): void => {
    if (disposed) {
      next.dispose()
      return
    }
    backend = next
    next.set_quality(quality, render_distance)
    next.set_camera(camera.position, camera.target, camera.projection)
    next.set_character_anchor(character_anchor)
    next.set_time_of_day(time_of_day)
    next.set_flatten_amount(flat_amount)
    next.set_fight_board(fight_board)
    next.set_entities(entities)
    next.set_resource_nodes(resource_nodes)
    next.set_dungeon_portals(dungeon_portals)
    next.set_dungeon_stage(dungeon_stage)
    if (fight_swords) next.set_fight_swords(fight_swords.url, fight_swords.impact_sound_url, fight_swords.markers)
    entity_labels.replay(next.set_entity_label)
    world_labels.replay((id, label) => next.set_world_label(id, label.element, label.position))
    resource_labels.replay(next.set_resource_node_label)
    fight_sword_labels.replay(next.set_fight_sword_label)
    portal_labels.replay((_, element) => next.set_portal_label(element))
    pending_fight_cues.splice(0).forEach(({ cue, resolve }) => void next.play_fight_cue(cue).then(resolve))
    fight_blobs.forEach(next.upsert_fight_blob)
    pending_chunks.forEach(submit_chunk)
    publish_status({ state: issue ? 'degraded' : 'ready', backend: next.kind, ...(issue ? { issue } : {}) })
  }

  const attach_grid = (issue: EngineIssue): void => {
    try {
      attach(create_grid_fallback(canvas, quality, presentation), issue)
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      console.error('No supported graphics context is available.', error)
      publish_status({ state: 'failed', backend: 'none', issue: { code: 'graphics_unavailable', detail } })
    }
  }

  const boot = async (): Promise<void> => {
    if (supports_webgpu()) {
      try {
        const { create_webgpu_backend } = await import('./webgpu_backend.ts')
        let sky_issue: EngineIssue | undefined
        const report_issue = (issue?: EngineIssue): void => {
          sky_issue = issue
          if (backend?.kind === 'webgpu')
            publish_status(
              issue ? { state: 'degraded', backend: 'webgpu', issue } : { state: 'ready', backend: 'webgpu' }
            )
        }
        attach(
          await create_webgpu_backend(canvas, quality, world, report_issue, presentation, initial_focus),
          sky_issue
        )
        return
      } catch (error) {
        console.error('WebGPU initialization failed; using the grid fallback.', error)
        attach_grid({
          code: 'webgpu_initialization_failed',
          detail: error instanceof Error ? error.message : String(error),
        })
        return
      }
    }
    attach_grid({ code: 'webgpu_unavailable' })
  }
  const previous_boot = Reflect.get(canvas, ENGINE_BOOT) as Promise<void> | undefined
  const boot_task = (previous_boot ?? Promise.resolve())
    .catch((error: unknown) => console.error('A previous engine boot failed before cleanup.', error))
    .then(boot)
  Reflect.set(canvas, ENGINE_BOOT, boot_task)
  void boot_task

  return Object.freeze({
    start: (next_update = () => {}) => {
      update = next_update
      if (started) return
      started = true
      previous_frame = performance.now()
      animation_frame = requestAnimationFrame(draw)
    },
    stop: () => {
      started = false
      if (animation_frame !== null) cancelAnimationFrame(animation_frame)
      animation_frame = null
    },
    set_camera: (position: Vec3, target: Vec3, projection: CameraProjection = {}) => {
      camera = { position, target, projection }
      backend?.set_camera(position, target, projection)
    },
    set_character_anchor: (position: Vec3 | null) => {
      character_anchor = position
      backend?.set_character_anchor(position)
    },
    set_quality: (next: EngineQuality, next_render_distance: number | null = null) => {
      quality = next
      render_distance = next_render_distance
      backend?.set_quality(next, next_render_distance)
    },
    set_time_of_day: (time: number) => {
      time_of_day = ((time % 1) + 1) % 1
      backend?.set_time_of_day(time_of_day)
    },
    set_flatten_amount: (next: number) => {
      flat_amount = Math.min(1, Math.max(0, next))
      backend?.set_flatten_amount(flat_amount)
    },
    set_fight_board: (next: FightBoardRender | null) => {
      fight_blobs.clear()
      fight_board = next
      backend?.set_fight_board(next)
    },
    set_entities: (next: readonly EntityRender[]) => {
      entities = Object.freeze([...next])
      backend?.set_entities(entities)
    },
    set_fight_swords: (url, impact_sound_url, markers) => {
      fight_swords = Object.freeze({ url, impact_sound_url, markers: Object.freeze([...markers]) })
      backend?.set_fight_swords(url, impact_sound_url, fight_swords.markers)
    },
    set_fight_sword_label: (id, element) => {
      fight_sword_labels.set(id, element)
      backend?.set_fight_sword_label(id, element)
    },
    set_resource_nodes: (markers) => {
      resource_nodes = Object.freeze([...markers])
      backend?.set_resource_nodes(resource_nodes)
    },
    set_resource_node_label: (id, element) => {
      resource_labels.set(id, element)
      backend?.set_resource_node_label(id, element)
    },
    set_dungeon_portals: (markers) => {
      dungeon_portals = Object.freeze([...markers])
      backend?.set_dungeon_portals(dungeon_portals)
    },
    set_dungeon_stage: (stage) => {
      dungeon_stage = stage ? Object.freeze({ ...stage }) : null
      backend?.set_dungeon_stage(dungeon_stage)
    },
    set_portal_label: (element) => {
      portal_labels.set('portal', element)
      backend?.set_portal_label(element)
    },
    animate_entity: (motion) => backend?.animate_entity(motion) ?? Promise.resolve(false),
    play_fight_cue: (cue) =>
      backend
        ? backend.play_fight_cue(cue)
        : new Promise<boolean>((resolve) => pending_fight_cues.push(Object.freeze({ cue, resolve }))),
    play_jump_puff: (position) => backend?.play_jump_puff(position),
    project_entity: (id) => backend?.project_entity(id) ?? null,
    set_entity_label: (id, element) => {
      entity_labels.set(id, element)
      backend?.set_entity_label(id, element)
    },
    set_world_label: (id, element, position) => {
      const label =
        element && position ? Object.freeze({ element, position: Object.freeze([...position]) as Vec3 }) : null
      world_labels.set(id, label)
      backend?.set_world_label(id, element, position)
    },
    entity_height: (id) => backend?.entity_height(id) ?? null,
    create_fight_blob: (blob: FightBlobSpec) => {
      fight_blob_serial += 1
      const id = `fight_blob_${fight_blob_serial}`
      const rendered = Object.freeze({ ...blob, id, created_at: performance.now() })
      fight_blobs.set(id, rendered)
      backend?.upsert_fight_blob(rendered)
      return id
    },
    update_fight_blob: (id: string, blob: FightBlobSpec) => {
      if (!fight_blobs.has(id)) return false
      const rendered = Object.freeze({ ...blob, id, created_at: performance.now() })
      fight_blobs.set(id, rendered)
      backend?.upsert_fight_blob(rendered)
      return true
    },
    remove_fight_blob: (id: string) => {
      fight_blobs.delete(id)
      backend?.remove_fight_blob(id)
    },
    pick_fight_cell: (client_x: number, client_y: number) => backend?.pick_fight_cell(client_x, client_y) ?? null,
    render_chunk: (chunk: RenderChunkRequest) => {
      pending_chunks.set(chunk.key, chunk)
      const previous = chunk_waiters.get(chunk.key)
      previous?.resolve('removed')
      return new Promise<ChunkRenderOutcome>((resolve) => {
        chunk_waiters.set(chunk.key, Object.freeze({ chunk, resolve }))
        submit_chunk(chunk)
      })
    },
    remove_chunk: (key: string) => {
      pending_chunks.delete(key)
      const waiter = chunk_waiters.get(key)
      if (waiter) {
        chunk_waiters.delete(key)
        waiter.resolve('removed')
      }
      backend?.remove_chunk(key)
    },
    chunk_count: () => backend?.chunk_count() ?? 0,
    render_state: () =>
      backend?.render_state() ?? {
        settled: false,
        mesh_queued: 0,
        mesh_active: 0,
        uploads_pending: 0,
        uploads_blocked: 0,
        retries_pending: 0,
        failed_chunks: 0,
        far_ready: false,
        sky_ready: false,
      },
    quality: () => quality,
    flattened: () => flat_amount >= 1,
    backend: () => backend?.kind ?? 'initializing',
    status: () => status,
    subscribe_status: (listener: (next: EngineStatus) => void) => {
      status_listeners.add(listener)
      listener(status)
      return () => status_listeners.delete(listener)
    },
    dispose: () => {
      disposed = true
      started = false
      if (animation_frame !== null) cancelAnimationFrame(animation_frame)
      animation_frame = null
      pending_chunks.clear()
      fight_blobs.clear()
      entities = Object.freeze([])
      resource_nodes = Object.freeze([])
      dungeon_portals = Object.freeze([])
      dungeon_stage = null
      fight_swords = null
      entity_labels.clear()
      world_labels.clear()
      resource_labels.clear()
      fight_sword_labels.clear()
      portal_labels.clear()
      pending_fight_cues.splice(0).forEach(({ resolve }) => resolve(false))
      chunk_waiters.forEach(({ resolve }) => resolve('removed'))
      chunk_waiters.clear()
      backend?.dispose()
      backend = null
      status_listeners.clear()
    },
  })
}
