// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { EngineBackend } from './backend.ts'
import { get_quality_profile } from './quality.ts'
import type {
  ChunkRenderOutcome,
  Engine,
  EngineFrame,
  EngineIssue,
  EngineQuality,
  EngineStatus,
  FightBlobRender,
  FightPresentationCue,
  RenderChunkRequest,
} from './types.ts'
import type { CompiledWorld } from './world_recipe.ts'

const ENGINE_BOOT = Symbol('aresrpg.engine_boot')
// These backend faults end the world lifetime; any other reported issue only degrades it.
const TERMINAL_ISSUES: ReadonlySet<EngineIssue['code']> = new Set([
  'webgpu_device_lost',
  'graphics_unavailable',
  'asset_missing',
])

const supports_webgpu = (): boolean => typeof navigator !== 'undefined' && 'gpu' in navigator && navigator.gpu != null

type Lifecycle =
  | Readonly<{ state: 'booting'; issue?: EngineIssue }>
  | Readonly<{ state: 'live'; backend: EngineBackend; issue?: EngineIssue }>
  | Readonly<{ state: 'failed'; backend: EngineStatus['backend']; issue: EngineIssue }>
  | Readonly<{ state: 'disposed'; status: EngineStatus }>

type LifecycleInput =
  | Readonly<{ type: 'attach'; backend: EngineBackend }>
  | Readonly<{ type: 'issue'; issue?: EngineIssue }>
  | Readonly<{ type: 'fail'; issue: EngineIssue }>
  | Readonly<{ type: 'dispose' }>

const engine_status = (life: Lifecycle): EngineStatus => {
  switch (life.state) {
    case 'booting':
      return Object.freeze({ state: 'initializing', backend: 'none' })
    case 'live':
      return Object.freeze(
        life.issue ? { state: 'degraded', backend: 'webgpu', issue: life.issue } : { state: 'ready', backend: 'webgpu' }
      )
    case 'failed':
      return Object.freeze({ state: 'failed', backend: life.backend, issue: life.issue })
    case 'disposed':
      return life.status
  }
}

const backend_of = (life: Lifecycle): EngineBackend | null => (life.state === 'live' ? life.backend : null)
const is_ended = (life: Lifecycle): boolean => life.state === 'failed' || life.state === 'disposed'
const issue_input = (issue?: EngineIssue): LifecycleInput =>
  issue && TERMINAL_ISSUES.has(issue.code) ? { type: 'fail', issue } : { type: 'issue', issue }

// `failed` and `disposed` are terminal: late backend callbacks cannot revive the engine.
const next_lifecycle = (life: Lifecycle, input: LifecycleInput): Lifecycle => {
  if (life.state === 'disposed') return life
  if (input.type === 'dispose') return { state: 'disposed', status: engine_status(life) }
  if (life.state === 'failed') return life
  switch (input.type) {
    case 'attach':
      return { state: 'live', backend: input.backend, issue: life.issue }
    case 'issue':
      return { ...life, issue: input.issue }
    case 'fail':
      return { state: 'failed', backend: life.state === 'live' ? 'webgpu' : 'none', issue: input.issue }
  }
}

export const create_engine = ({
  canvas,
  world,
  quality: initial_quality = 'medium',
  initial_focus = [0, 0],
  render_distance: initial_render_distance = null,
}: Readonly<{
  canvas: HTMLCanvasElement
  world: CompiledWorld
  quality?: EngineQuality
  initial_focus?: readonly [number, number]
  render_distance?: number | null
}>): Engine => {
  let life: Lifecycle = { state: 'booting' }
  const status_listeners = new Set<(status: EngineStatus) => void>()
  // Every setter retains its latest call by key so a backend that attaches later replays them in order.
  const retained = new Map<string, (backend: EngineBackend) => void>()
  const chunk_waiters = new Map<
    string,
    Readonly<{ chunk: RenderChunkRequest; resolve: (outcome: ChunkRenderOutcome) => void }>
  >()
  const pending_fight_cues: Array<Readonly<{ cue: FightPresentationCue; resolve: (played: boolean) => void }>> = []
  const fight_blobs = new Map<string, FightBlobRender>()
  let fight_blob_serial = 0
  let quality = initial_quality
  let started = false
  let animation_frame: number | null = null
  let background_timer: ReturnType<typeof setTimeout> | null = null
  let background = false
  let previous_frame = performance.now()
  let next_frame_at = previous_frame
  let update: (frame: EngineFrame) => void = () => {}
  let rendered_frames = 0

  const live_backend = (): EngineBackend | null => backend_of(life)
  const ended = (): boolean => is_ended(life)

  const retain = (key: string, apply: (backend: EngineBackend) => void, keep = true): void => {
    if (ended()) return
    if (keep) retained.set(key, apply)
    else retained.delete(key)
    const backend = live_backend()
    if (backend) apply(backend)
  }

  const cancel_frame = (): void => {
    if (animation_frame !== null) cancelAnimationFrame(animation_frame)
    if (background_timer !== null) clearTimeout(background_timer)
    animation_frame = null
    background_timer = null
  }
  const schedule_frame = (): void => {
    cancel_frame()
    if (!started) return
    if (globalThis.document?.visibilityState === 'hidden') {
      if (background) background_timer = setTimeout(() => draw(performance.now()), 100)
      return
    }
    animation_frame = requestAnimationFrame((now) => {
      // Allow sub-millisecond rAF jitter without dropping a whole display refresh.
      if (now + 0.5 < next_frame_at) return schedule_frame()
      const interval = 1000 / get_quality_profile(quality).render.fps
      // Retain the cadence's phase, but never replay frames missed during a stall.
      next_frame_at = now + interval - (Math.max(0, now - next_frame_at) % interval)
      draw(now)
    })
  }
  const visibility_changed = (): void => {
    next_frame_at = performance.now()
    schedule_frame()
  }
  globalThis.document?.addEventListener('visibilitychange', visibility_changed)

  const release = (ended_as: Lifecycle['state'], backend: EngineBackend | null): void => {
    const outcome: ChunkRenderOutcome = ended_as === 'failed' ? 'failed' : 'removed'
    started = false
    cancel_frame()
    globalThis.document?.removeEventListener('visibilitychange', visibility_changed)
    retained.clear()
    fight_blobs.clear()
    pending_fight_cues.splice(0).forEach(({ resolve }) => resolve(false))
    chunk_waiters.forEach(({ resolve }) => resolve(outcome))
    chunk_waiters.clear()
    try {
      backend?.dispose()
    } catch (error) {
      console.error('Engine resource cleanup failed.', error)
    }
  }

  const submit_chunk = (chunk: RenderChunkRequest): void => {
    const settle = (outcome: ChunkRenderOutcome): void => {
      const waiter = chunk_waiters.get(chunk.key)
      if (waiter?.chunk !== chunk) return
      chunk_waiters.delete(chunk.key)
      waiter.resolve(outcome)
    }
    void live_backend()
      ?.render_chunk(chunk)
      .then(settle, () => settle('failed'))
  }

  const replay = (backend: EngineBackend): void => {
    retained.forEach((apply) => apply(backend))
    pending_fight_cues.splice(0).forEach(({ cue, resolve }) => void backend.play_fight_cue(cue).then(resolve))
    fight_blobs.forEach(backend.upsert_fight_blob)
    chunk_waiters.forEach(({ chunk }) => submit_chunk(chunk))
  }

  const transition = (input: LifecycleInput): void => {
    const previous = life
    life = next_lifecycle(previous, input)
    if (life === previous) return
    if (is_ended(life) && !is_ended(previous)) release(life.state, backend_of(previous))
    const backend = backend_of(life)
    if (backend && previous.state === 'booting') replay(backend)
    const status = engine_status(life)
    if (status.state !== 'initializing' && life.state !== 'disposed')
      status_listeners.forEach((listener) => listener(status))
  }
  const report_failure = (issue: EngineIssue): void => transition({ type: 'fail', issue })

  const draw = (now: number): void => {
    if (!started) return
    const hidden = globalThis.document?.visibilityState === 'hidden'
    const delta_seconds = Math.min(0.1, Math.max(0, now - previous_frame) / 1000)
    previous_frame = now
    fight_blobs.forEach((blob, id) => {
      if (blob.duration_ms === undefined || now - blob.created_at < blob.duration_ms) return
      fight_blobs.delete(id)
      live_backend()?.remove_fight_blob(id)
    })
    try {
      update(Object.freeze({ now, delta_seconds }))
      const backend = live_backend()
      backend?.tick(now)
      if (!hidden && backend) {
        backend.render(now)
        rendered_frames += 1
      }
    } catch (error) {
      console.error('World rendering failed.', error)
      report_failure({
        code: 'graphics_unavailable',
        detail: String(error),
        stack: error instanceof Error ? error.stack : undefined,
      })
    }
    schedule_frame()
  }

  const boot = async (): Promise<void> => {
    if (ended()) return
    if (!supports_webgpu()) return report_failure({ code: 'webgpu_unavailable' })
    let failure_code: EngineIssue['code'] = 'renderer_load_failed'
    try {
      const { create_webgpu_backend } = await import('./webgpu_backend.ts')
      failure_code = 'webgpu_initialization_failed'
      const backend = await create_webgpu_backend(
        canvas,
        quality,
        world,
        (issue) => transition(issue_input(issue)),
        initial_focus
      )
      if (ended()) backend.dispose()
      else transition({ type: 'attach', backend })
    } catch (error) {
      report_failure({
        code: failure_code,
        detail: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      })
    }
  }
  const previous_boot = Reflect.get(canvas, ENGINE_BOOT) as Promise<void> | undefined
  const boot_task = (previous_boot ?? Promise.resolve())
    .catch((error: unknown) => console.error('A previous engine boot failed before cleanup.', error))
    .then(boot)
  Reflect.set(canvas, ENGINE_BOOT, boot_task)
  void boot_task

  // Backend defaults, in replay order.
  retain('quality', (backend) => backend.set_quality(initial_quality, initial_render_distance))
  retain('audio', (backend) => backend.set_audio_volume(1))
  retain('camera', (backend) =>
    backend.set_camera([initial_focus[0] + 36, 34, initial_focus[1] + 36], [initial_focus[0], 0, initial_focus[1]], {})
  )
  retain('anchor', (backend) => backend.set_character_anchor(null))
  retain('time_of_day', (backend) => backend.set_time_of_day(0.31))
  retain('atmosphere', (backend) => backend.set_atmosphere(null))
  retain('clouds', (backend) => backend.set_clouds_visible(true))
  retain('fight_board', (backend) => backend.set_fight_board(null))
  retain('entities', (backend) => backend.set_entities([]))
  retain('resource_nodes', (backend) => backend.set_resource_nodes([]))
  retain('dungeon_portals', (backend) => backend.set_dungeon_portals([]))
  retain('dungeon_stage', (backend) => backend.set_dungeon_stage(null))

  return Object.freeze({
    start: (next_update = () => {}, run_in_background = false) => {
      if (ended()) return
      update = next_update
      const changed = background !== run_in_background
      background = run_in_background
      if (started && changed) schedule_frame()
      if (started) return
      started = true
      previous_frame = performance.now()
      next_frame_at = previous_frame
      schedule_frame()
    },
    stop: () => {
      started = false
      cancel_frame()
    },
    set_camera: (position, target, projection = {}) =>
      retain('camera', (backend) => backend.set_camera(position, target, projection)),
    set_character_anchor: (position) => retain('anchor', (backend) => backend.set_character_anchor(position)),
    set_quality: (next, render_distance = null) => {
      quality = next
      retain('quality', (backend) => backend.set_quality(next, render_distance))
    },
    set_audio_volume: (volume) => {
      const clamped = Math.min(1, Math.max(0, volume))
      retain('audio', (backend) => backend.set_audio_volume(clamped))
    },
    set_time_of_day: (time) => {
      const wrapped = ((time % 1) + 1) % 1
      retain('time_of_day', (backend) => backend.set_time_of_day(wrapped))
    },
    set_atmosphere: (overrides) => {
      const frozen = overrides === null ? null : Object.freeze({ ...overrides })
      retain('atmosphere', (backend) => backend.set_atmosphere(frozen))
    },
    set_clouds_visible: (visible) => retain('clouds', (backend) => backend.set_clouds_visible(visible)),
    set_fight_board: (board) => {
      fight_blobs.clear()
      retain('fight_board', (backend) => backend.set_fight_board(board))
    },
    set_entities: (entities) => {
      const frozen = Object.freeze([...entities])
      retain('entities', (backend) => backend.set_entities(frozen))
    },
    set_fight_swords: (url, impact_sound_url, markers) => {
      const frozen = Object.freeze([...markers])
      retain('fight_swords', (backend) => backend.set_fight_swords(url, impact_sound_url, frozen))
    },
    set_resource_nodes: (markers) => {
      const frozen = Object.freeze([...markers])
      retain('resource_nodes', (backend) => backend.set_resource_nodes(frozen))
    },
    set_dungeon_portals: (markers) => {
      const frozen = Object.freeze([...markers])
      retain('dungeon_portals', (backend) => backend.set_dungeon_portals(frozen))
    },
    set_dungeon_stage: (stage) => {
      const frozen = stage ? Object.freeze({ ...stage }) : null
      retain('dungeon_stage', (backend) => backend.set_dungeon_stage(frozen))
    },
    set_entity_caption: (id, caption) =>
      retain(`caption:${id}`, (backend) => backend.set_entity_caption(id, caption), caption !== null),
    set_world_panel: (id, panel) =>
      retain(`panel:${id}`, (backend) => backend.set_world_panel(id, panel), panel !== null),
    set_label: (id, label) => retain(`label:${id}`, (backend) => backend.set_label(id, label), label !== null),
    animate_entity: (motion) => live_backend()?.animate_entity(motion) ?? Promise.resolve(false),
    prepare_scene: async () => {
      await boot_task
      return live_backend()?.prepare_scene() ?? false
    },
    prepare_fight_effects: async (urls) => {
      await boot_task
      await live_backend()?.prepare_fight_effects(urls)
    },
    prepare_fight_cue: async (cue) => {
      await boot_task
      return live_backend()?.prepare_fight_cue(cue) ?? cue
    },
    play_fight_cue: (cue) => {
      switch (life.state) {
        case 'failed':
        case 'disposed':
          return Promise.resolve(false)
        case 'live':
          return life.backend.play_fight_cue(cue)
        case 'booting':
          return new Promise<boolean>((resolve) => pending_fight_cues.push(Object.freeze({ cue, resolve })))
      }
    },
    play_jump_puff: (position) => live_backend()?.play_jump_puff(position),
    project_entity: (id) => live_backend()?.project_entity(id) ?? null,
    hit_entity_caption: (id, x, y) => live_backend()?.hit_entity_caption(id, x, y) ?? false,
    entity_height: (id) => live_backend()?.entity_height(id) ?? null,
    entity_position: (id, height) => live_backend()?.entity_position(id, height) ?? null,
    create_fight_blob: (blob) => {
      fight_blob_serial += 1
      const id = `fight_blob_${fight_blob_serial}`
      const rendered = Object.freeze({ ...blob, id, created_at: performance.now() })
      fight_blobs.set(id, rendered)
      live_backend()?.upsert_fight_blob(rendered)
      return id
    },
    update_fight_blob: (id, blob) => {
      if (!fight_blobs.has(id)) return false
      const rendered = Object.freeze({ ...blob, id, created_at: performance.now() })
      fight_blobs.set(id, rendered)
      live_backend()?.upsert_fight_blob(rendered)
      return true
    },
    remove_fight_blob: (id) => {
      fight_blobs.delete(id)
      live_backend()?.remove_fight_blob(id)
    },
    pick_fight_cell: (client_x, client_y) => live_backend()?.pick_fight_cell(client_x, client_y) ?? null,
    render_chunk: (chunk) => {
      if (life.state === 'disposed') return Promise.resolve<ChunkRenderOutcome>('removed')
      if (life.state === 'failed') return Promise.resolve<ChunkRenderOutcome>('failed')
      chunk_waiters.get(chunk.key)?.resolve('removed')
      return new Promise<ChunkRenderOutcome>((resolve) => {
        chunk_waiters.set(chunk.key, Object.freeze({ chunk, resolve }))
        submit_chunk(chunk)
      })
    },
    remove_chunk: (key) => {
      chunk_waiters.get(key)?.resolve('removed')
      chunk_waiters.delete(key)
      live_backend()?.remove_chunk(key)
    },
    chunk_count: () => live_backend()?.chunk_count() ?? 0,
    frame_count: () => rendered_frames,
    render_state: () =>
      live_backend()?.render_state() ?? {
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
    backend: () => (life.state === 'live' ? 'webgpu' : 'initializing'),
    fail: report_failure,
    status: () => engine_status(life),
    subscribe_status: (listener) => {
      status_listeners.add(listener)
      listener(engine_status(life))
      return () => status_listeners.delete(listener)
    },
    dispose: () => {
      transition({ type: 'dispose' })
      status_listeners.clear()
    },
  })
}
