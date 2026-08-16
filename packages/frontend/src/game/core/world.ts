// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import {
  CELESTIAL_CYCLE_MS,
  compile_world_recipe,
  create_flat_projection,
  create_engine,
  parse_world_recipe,
  project_height,
  sample_world_column,
  set_flat_projection,
  step_flat_projection,
  type EngineRenderState,
  type EngineStatus,
  type FightBoardRender,
  type Vec3,
} from '@aresrpg/engine'

import { worlds_source } from '../../content/worlds.ts'
import { env } from '../../env.ts'
import {
  create_camera_director,
  create_fight_addon,
  create_follow_addon,
  create_spectate_addon,
  type CameraAnchor,
  type FightBoardFrame,
} from './cameras.ts'
import { create_character_controller } from './character.ts'
import { create_chunk_manager } from './chunks.ts'
import { CHARACTER_HEIGHT } from './collision.ts'

export type WorldView = Readonly<{
  focus: readonly [number, number]
  position: Vec3
  target: Vec3
}>

export type WorldState = Readonly<{
  engine: EngineStatus
  render: EngineRenderState
  chunks: ReturnType<ReturnType<typeof create_chunk_manager>['stats']>
  displayed_chunks: number
}>

const MOVE_KEYS: Readonly<Record<string, Readonly<{ axis: 'forward' | 'strafe'; sign: 1 | -1 }>>> = Object.freeze({
  KeyW: { axis: 'forward', sign: 1 },
  ArrowUp: { axis: 'forward', sign: 1 },
  KeyS: { axis: 'forward', sign: -1 },
  ArrowDown: { axis: 'forward', sign: -1 },
  KeyD: { axis: 'strafe', sign: 1 },
  ArrowRight: { axis: 'strafe', sign: 1 },
  KeyA: { axis: 'strafe', sign: -1 },
  ArrowLeft: { axis: 'strafe', sign: -1 },
})

export const create_world = (canvas: HTMLCanvasElement) => {
  const [first_world] = worlds_source
  if (!first_world?.terrain) throw new Error('The first world has no terrain recipe')
  const compiled = compile_world_recipe(parse_world_recipe(first_world.terrain))
  const engine = create_engine({ canvas, quality: env.engine_quality, world: first_world.terrain })
  const chunks = create_chunk_manager({
    engine,
    initial_quality: env.engine_quality,
    vertical_chunks: first_world.terrain.vertical_chunks,
  })

  // World oracles for the ported physics/camera: columns are analytic (the compiled recipe), so
  // solidity is "below the surface" and liquid fills up to the sea plane (renderer y = 0) — the
  // faithful adaptation until client-side block edits exist (legacy read per-block ids).
  const column_cache = new Map<number, number>()
  const surface_y = (x: number, z: number): number => {
    const key = x * 200_003 + z
    const hit = column_cache.get(key)
    if (hit !== undefined) return hit
    if (column_cache.size > 65_536) column_cache.clear()
    const value = sample_world_column(compiled, x, z).surface_y
    column_cache.set(key, value)
    return value
  }
  // One projection state drives both the renderer and collision. The engine owns the pure
  // projection law; game core owns this one current frame snapshot.
  let flat_projection = create_flat_projection()
  const projected_surface_y = (x: number, z: number): number => project_height(surface_y(x, z), flat_projection.amount)
  const solid_at = (x: number, y: number, z: number): boolean => y < projected_surface_y(x, z)
  const liquid_at = (x: number, y: number, z: number): boolean =>
    flat_projection.amount < 1 && y < 0 && y >= projected_surface_y(x, z)

  const character = create_character_controller({ solid_at, liquid_at, position: [0, 40, 0] })
  const pressed = { forward: new Set<string>(), strafe: new Set<string>() }
  const held = { forward: 0, strafe: 0 }
  const spectate = { x: 0, z: 0 }
  let spectate_zoom = 54
  let mode: 'spectate' | 'follow' | 'fight' = 'spectate'
  let fight_board: FightBoardFrame = { origin: { x: 0, y: 0, z: 0 }, grid_w: 1, grid_h: 1, cell_size: 1 }
  let active = false
  let enabled = false
  let dragging = false
  let pointer = [0, 0] as [number, number]
  // Dev affordance: `?time=0.3` pins the day cycle (verification needs deterministic light).
  const time_param = new URLSearchParams(globalThis.location?.search ?? '').get('time')
  const parsed_time = time_param === null ? null : Number(time_param)
  let pinned_time: number | null = parsed_time !== null && Number.isFinite(parsed_time) ? parsed_time : null

  const spectate_addon = create_spectate_addon({
    focus: () => [spectate.x, spectate.z] as const,
    zoom: () => spectate_zoom,
  })
  const follow_addon = create_follow_addon(solid_at)
  const fight_addon = create_fight_addon({
    board: () => fight_board,
    viewport: () => [canvas.clientWidth, canvas.clientHeight],
  })
  const director = create_camera_director(spectate_addon, canvas)

  const addon_for = (next: typeof mode) =>
    next === 'spectate' ? spectate_addon : next === 'follow' ? follow_addon : fight_addon

  const clear_movement = (): void => {
    pressed.forward.clear()
    pressed.strafe.clear()
    held.forward = 0
    held.strafe = 0
    character.set_input({ forward: 0, strafe: 0, jump: false, walk: false })
  }

  const set_mode = (next: typeof mode): void => {
    if (next === mode) return
    if (next === 'spectate') {
      const { position } = character.get_transform()
      spectate.x = position[0]
      spectate.z = position[2]
    }
    clear_movement()
    mode = next
    director.use(addon_for(next))
  }

  // ── spectate drag-pan (the pre-login overview keeps its own gesture) ──
  const on_pointer_down = (event: PointerEvent): void => {
    if (!enabled || mode !== 'spectate') return
    dragging = true
    pointer = [event.clientX, event.clientY]
    canvas.setPointerCapture(event.pointerId)
  }
  const on_pointer_move = (event: PointerEvent): void => {
    if (!enabled || !dragging || mode !== 'spectate') return
    const scale = spectate_zoom * 0.0018
    const dx = event.clientX - pointer[0]
    const dy = event.clientY - pointer[1]
    spectate.x -= (dx + dy) * scale
    spectate.z -= (dy - dx) * scale
    pointer = [event.clientX, event.clientY]
  }
  const on_pointer_up = (event: PointerEvent): void => {
    dragging = false
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId)
  }
  const on_wheel = (event: WheelEvent): void => {
    if (!enabled || mode !== 'spectate') return
    event.preventDefault()
    spectate_zoom = Math.min(100, Math.max(24, spectate_zoom + event.deltaY * 0.04))
  }

  // ── movement keys (camera-relative axes; the addons own their own mouse gestures) ──
  const apply_axes = (): void => {
    held.forward = pressed.forward.size ? Number([...pressed.forward].at(-1)) : 0
    held.strafe = pressed.strafe.size ? Number([...pressed.strafe].at(-1)) : 0
    character.set_input({ forward: held.forward, strafe: held.strafe })
  }
  const on_key = (event: KeyboardEvent, down: boolean): void => {
    if (!enabled || mode !== 'follow') return
    const move = MOVE_KEYS[event.code]
    if (move !== undefined) {
      const bucket = pressed[move.axis]
      if (down) bucket.add(String(move.sign))
      else bucket.delete(String(move.sign))
      apply_axes()
      return
    }
    if (event.code === 'Space') character.set_input({ jump: down })
    if (event.code === 'ShiftLeft' || event.code === 'ShiftRight') character.set_input({ walk: down })
  }
  const on_key_down = (event: KeyboardEvent): void => on_key(event, true)
  const on_key_up = (event: KeyboardEvent): void => on_key(event, false)
  const on_blur = (): void => clear_movement()

  const tick = (now: number, delta_seconds: number): void => {
    const previous_flat = flat_projection
    flat_projection = step_flat_projection(flat_projection, delta_seconds)
    engine.set_flatten_amount(flat_projection.amount)
    let anchor: CameraAnchor
    if (mode === 'spectate') {
      anchor = { x: spectate.x, y: 0, z: spectate.z, eye_height: 0, speed: 0, on_ground: true }
    } else if (mode === 'follow') {
      const before = character.get_transform().position
      const source_ground = surface_y(before[0], before[2])
      character.reconcile_ground(
        project_height(source_ground, previous_flat.amount),
        project_height(source_ground, flat_projection.amount)
      )
      character.set_input({ yaw: director.active().get_yaw() })
      character.tick(delta_seconds)
      const transform = character.get_transform()
      anchor = {
        x: transform.position[0],
        y: transform.visual_y,
        z: transform.position[2],
        eye_height: CHARACTER_HEIGHT * 0.9,
        speed: transform.speed,
        on_ground: transform.on_ground,
      }
    } else {
      const width = fight_board.grid_w * fight_board.cell_size
      const height = fight_board.grid_h * fight_board.cell_size
      anchor = {
        x: fight_board.origin.x + width / 2,
        y: fight_board.origin.y,
        z: fight_board.origin.z + height / 2,
        eye_height: 0,
        speed: 0,
        on_ground: true,
      }
    }
    const view = director.frame(anchor, delta_seconds)
    engine.set_camera(view.position, view.target, {
      fov: view.fov,
      ortho_blend: view.ortho_blend,
      ortho_height: view.ortho_height,
    })
    const focus = mode === 'follow' ? ([anchor.x, anchor.z] as const) : ([view.target[0], view.target[2]] as const)
    chunks.set_focus(focus[0], focus[1])
    chunks.tick()
    engine.set_time_of_day(pinned_time ?? (performance.now() / CELESTIAL_CYCLE_MS + 0.31) % 1)
  }

  canvas.addEventListener('pointerdown', on_pointer_down)
  canvas.addEventListener('pointermove', on_pointer_move)
  canvas.addEventListener('pointerup', on_pointer_up)
  canvas.addEventListener('pointercancel', on_pointer_up)
  canvas.addEventListener('wheel', on_wheel, { passive: false })
  globalThis.addEventListener('keydown', on_key_down)
  globalThis.addEventListener('keyup', on_key_up)
  globalThis.addEventListener('blur', on_blur)
  return Object.freeze({
    set_quality: (quality: 'low' | 'medium' | 'high') => {
      engine.set_quality(quality)
      chunks.set_quality(quality)
    },
    backend: engine.backend,
    subscribe_status: engine.subscribe_status,
    set_time_of_day: (time: number | null) => {
      pinned_time = time
      if (time !== null) engine.set_time_of_day(time)
    },
    set_view: ({ focus }: WorldView) => {
      spectate.x = focus[0]
      spectate.z = focus[1]
    },
    /// Point the system at a character: the camera and terrain travel to its position.
    /// Cross-world pointing waits on more worlds having terrain recipes.
    point_at: (position: Readonly<{ x: number; z: number }>) => {
      character.teleport([position.x, projected_surface_y(position.x, position.z), position.z])
      set_mode('follow')
    },
    release: () => set_mode('spectate'),
    set_fight: (frame: FightBoardFrame | null) => {
      if (frame === null) set_mode('follow')
      else {
        fight_board = frame
        fight_addon.reset()
        set_mode('fight')
      }
    },
    show_fight_board: (board: FightBoardRender | null) => {
      engine.set_fight_board(board)
      if (board === null) set_mode('follow')
      else {
        fight_board = {
          origin: board.origin,
          grid_w: board.width,
          grid_h: board.height,
          cell_size: board.cell_size,
        }
        fight_addon.reset()
        set_mode('fight')
      }
    },
    create_fight_blob: engine.create_fight_blob,
    remove_fight_blob: engine.remove_fight_blob,
    pick_fight_cell: engine.pick_fight_cell,
    mode: () => mode,
    /// The follow rig's knobs (cinematic toggle, programmatic dolly) for the app layer.
    follow_camera: () => follow_addon,
    state: (): WorldState =>
      Object.freeze({
        engine: engine.status(),
        render: engine.render_state(),
        chunks: chunks.stats(),
        displayed_chunks: engine.chunk_count(),
      }),
    set_flattened: (next: boolean) => {
      flat_projection = set_flat_projection(flat_projection, next)
    },
    set_active: (next: boolean) => {
      if (next === active) return
      active = next
      director.set_enabled(next)
      if (next) engine.start(({ now, delta_seconds }) => tick(now, delta_seconds))
      else {
        clear_movement()
        dragging = false
        engine.stop()
      }
    },
    set_interactive: (next: boolean) => {
      enabled = next
      if (!next) clear_movement()
      canvas.style.cursor = next ? 'grab' : 'default'
    },
    dispose: () => {
      canvas.removeEventListener('pointerdown', on_pointer_down)
      canvas.removeEventListener('pointermove', on_pointer_move)
      canvas.removeEventListener('pointerup', on_pointer_up)
      canvas.removeEventListener('pointercancel', on_pointer_up)
      canvas.removeEventListener('wheel', on_wheel)
      globalThis.removeEventListener('keydown', on_key_down)
      globalThis.removeEventListener('keyup', on_key_up)
      globalThis.removeEventListener('blur', on_blur)
      director.set_enabled(false)
      character.dispose()
      chunks.dispose()
      engine.dispose()
    },
  })
}
