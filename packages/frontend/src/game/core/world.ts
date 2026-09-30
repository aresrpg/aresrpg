// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/* eslint-disable functional/immutable-data, functional/prefer-immutable-types, functional/prefer-tacit, max-lines, no-param-reassign -- the world runtime is the explicit mutable engine and browser-device boundary. */

import {
  compile_runtime_world_recipe,
  create_engine,
  create_terrain_planner,
  parse_world_recipe,
  type EngineRenderState,
  type EngineQuality,
  type EngineStatus,
  type EntityRender,
  type FightBoardRender,
  type FightSwordMarker,
  type ResourceNodeMarker,
  type MaterialPreset,
  type CharacterAppearanceRender,
  type MobEntityRender,
  type Vec3,
} from '@aresrpg/engine'

import { create_spawn_hologram, hologram_city } from './spawn_hologram.ts'
import { world_daylight } from './daylight.ts'
import { world_character_entity, type LoadedCharacterRender } from '../character_entities.ts'
import { preload_audio } from '../audio/audio_registry.ts'
import { create_footsteps, footstep_preset } from '../audio/footsteps.ts'
import {
  camera_mode_after,
  create_camera_director,
  create_fight_addon,
  create_follow_addon,
  create_spectate_addon,
  time_of_day_for_camera_mode,
  type CameraAnchor,
  type CameraFrame,
  type FightBoardFrame,
} from './cameras.ts'
import { create_character_controller, type CharacterTransform } from './character.ts'
import { MOUNT_SPEED_SCALE } from './controller.ts'
import { create_chunk_manager } from './chunks.ts'
import { world_keyboard_eligible, WORLD_MOVE_KEYS } from './world_input.ts'
import { CHARACTER_HEIGHT, following_pet_ground_height } from './collision.ts'
import { empty_pet_motion, step_pet_follow, type PetMotion } from './pet_follow.ts'
import { publish_mount_prompt } from './mount_prompt_feed.ts'
import { publish_portal_prompt } from './portal_prompt_feed.ts'
import { fight_prompt_targets, publish_fight_prompt } from './fight_prompt_feed.ts'
import { create_dungeon_guides, DUNGEON_GUIDE_LABEL_HEIGHT } from '../dungeon_guides.ts'
import {
  clear_dungeon_portal_prompt,
  dungeon_portal_targets,
  publish_dungeon_portal_prompt,
} from './dungeon_portal_feed.ts'
import { publish_pose, type WorldPose } from './pose_feed.ts'
import { pet_seat_height, pet_vertical_offset, type PetLocomotion } from './pet_locomotion.ts'
import { run_to_mount, type RunTarget } from './run_to.ts'
import { create_world_collision } from './world_collision.ts'
import { walking_edge, type WalkPoint } from './walkable.ts'
import { begin_walking, step_walking } from './walking.ts'
import { create_world_ticker } from './world_ticker.ts'
import type { DungeonPortalMarker } from '../../modules/world.ts'

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

export const compose_world_entities = (
  controlled: EntityRender | null,
  external: readonly EntityRender[]
): readonly EntityRender[] =>
  Object.freeze(controlled ? [controlled, ...external.filter(({ id }) => id !== controlled.id)] : [...external])

/** X mounts only inside this radius — the nametag shows exactly while it would work */
const MOUNT_RANGE = 4
/** T travels only this close to the star gate (client 0;0 — the chain's own portal law) */
const PORTAL_RANGE = 10
/** the gate stands at the world origin — eligibility is just the body's horizontal offset */
export const portal_near = (x: number, z: number): boolean => Math.hypot(x, z) <= PORTAL_RANGE
export const create_world = ({
  canvas,
  world,
  quality,
  render_distance,
  on_travel,
  on_run_stopped,
  initial_focus = [0, 0],
  initial_yaw,
  initial_pitch,
  initial_spectate,
}: Readonly<{
  canvas: HTMLCanvasElement
  world: unknown
  quality: EngineQuality
  render_distance?: number | null
  /** fired when T is pressed beside the star gate — the app owns what travel means */
  on_travel?: () => void
  on_run_stopped?: (reason: 'arrived' | 'manual' | 'blocked' | 'inactive') => void
  initial_focus?: readonly [number, number]
  initial_yaw?: number
  initial_pitch?: number
  initial_spectate?: Readonly<{
    y: number
    zoom: number
    yaw: number
    pitch: number
    min_zoom: number
    max_zoom: number
  }>
}>) => {
  const compiled = compile_runtime_world_recipe(world)
  const engine = create_engine({ canvas, quality, world: compiled, initial_focus, render_distance })
  const terrain_planner = create_terrain_planner(compiled.recipe)
  const chunks = create_chunk_manager({
    engine,
    initial_quality: quality,
    initial_render_distance: render_distance,
    plan_layers: terrain_planner.plan,
    on_failure: (error) => engine.fail({ code: 'terrain_failed', detail: error.message }),
  })

  const collision = create_world_collision(compiled, (error) =>
    engine.fail({ code: 'terrain_failed', detail: String(error) })
  )
  const {
    solid_at,
    liquid_at,
    ready: city_artifacts_ready,
    surface_y,
    column_at,
    structure_material_at,
    ground_height: mob_ground_height,
  } = collision
  const pet_ground_height = (x: number, z: number, owner_y: number): number =>
    following_pet_ground_height(solid_at, x, z, owner_y, surface_y(x, z))
  const holograms = compiled.structures.cities
    .filter(({ id }) => id === hologram_city)
    .map(() => create_spawn_hologram(engine, surface_y(0, 0)))
  const character = create_character_controller({ solid_at, liquid_at, position: [0, surface_y(0, 0), 0] })
  const footsteps = create_footsteps()
  preload_audio(['water_enter'])
  const liquid_preset: MaterialPreset =
    compiled.recipe.liquid === undefined
      ? 'water'
      : (compiled.materials.entries[compiled.materials.id_for(compiled.recipe.liquid)]?.preset ?? 'water')
  const ground_preset = (transform: CharacterTransform): MaterialPreset => {
    const [x, y, z] = transform.position
    const surface = compiled.materials.entries[column_at(x, z).surface_id]?.preset ?? 'earth'
    const structure_id = structure_material_at(x, y - 0.01, z)
    const structure =
      structure_id === undefined || structure_id === 0 ? undefined : compiled.materials.entries[structure_id]?.preset
    return footstep_preset({ surface, structure, liquid: liquid_preset, in_water: transform.feet_in_water })
  }
  let character_render: LoadedCharacterRender | null = null
  let controlled_entity: EntityRender | null = null
  let pet: Readonly<{ id: string; model_url: string; locomotion: PetLocomotion }> | null = null
  let pet_entity: MobEntityRender | null = null
  let pet_motion: PetMotion = empty_pet_motion()
  let pet_elapsed_seconds = 0
  let riding = false
  let dungeon_guide_entities: readonly EntityRender[] = []
  let external_entities: readonly EntityRender[] = Object.freeze([])
  let nearby_entities: readonly EntityRender[] = Object.freeze([])
  let rendered_transform: Readonly<{
    id: string
    x: number
    y: number
    z: number
    yaw: number
    anim: CharacterTransform['anim'] | 'SIT'
    gait_scale: number
    visible: boolean
  }> | null = null
  const pressed = { forward: new Set<string>(), strafe: new Set<string>() }
  const held = { forward: 0, strafe: 0 }
  const spectate = { x: initial_focus[0], z: initial_focus[1] }
  const overview = {
    y: surface_y(spectate.x, spectate.z),
    zoom: 180,
    yaw: Math.PI * 0.25,
    pitch: 0.55,
    min_zoom: 60,
    max_zoom: 1_600,
    ...initial_spectate,
  }
  let { y: spectate_y, zoom: spectate_zoom, yaw: spectate_yaw, pitch: spectate_pitch } = overview
  let mode: 'spectate' | 'follow' | 'fight' = 'spectate'
  let fight_board: FightBoardFrame = { origin: { x: 0, y: 0, z: 0 }, grid_w: 1, grid_h: 1, cell_size: 1 }
  let active = false
  let enabled = false
  let action_lock: Readonly<{ character_id: string; animation: 'gather' | null }> | null = null
  let run_target: RunTarget | null = null
  let walking: ReturnType<typeof begin_walking> | null = null
  let run_route: WorldPose['route'] = null
  const walking_world = { solid_at, liquid_at, ready: city_artifacts_ready, ground_height: mob_ground_height }
  let action_animation_timer: ReturnType<typeof setInterval> | null = null
  let dragging: 'pan' | 'orbit' | null = null
  let pointer = [0, 0] as [number, number]
  // Dev affordance: `?time=0.3` pins the day cycle (verification needs deterministic light).
  const time_param = new URLSearchParams(globalThis.location?.search ?? '').get('time')
  const parsed_time = time_param === null ? null : Number(time_param)
  let day_night_cycle_enabled = true
  let pinned_time: number | null = parsed_time !== null && Number.isFinite(parsed_time) ? parsed_time : null

  const spectate_addon = create_spectate_addon({
    focus: () => [spectate.x, spectate.z] as const,
    zoom: () => spectate_zoom,
    ground_y: () => spectate_y,
    yaw: () => spectate_yaw,
    pitch: () => spectate_pitch,
  })
  const follow_addon = create_follow_addon(solid_at, { yaw: initial_yaw, pitch: initial_pitch })
  const fight_addon = create_fight_addon({
    board: () => fight_board,
    viewport: () => [canvas.clientWidth, canvas.clientHeight],
  })
  const director = create_camera_director(spectate_addon, canvas)
  let last_view: CameraFrame | null = null

  const addon_for = (next: typeof mode) =>
    next === 'spectate' ? spectate_addon : next === 'follow' ? follow_addon : fight_addon

  const clear_movement = (): void => {
    pressed.forward.clear()
    pressed.strafe.clear()
    held.forward = 0
    held.strafe = 0
    mouse_forward = false
    touch_axes = { forward: 0, strafe: 0 }
    character.set_input({ forward: 0, strafe: 0, jump: false, glide: false, walk: false, phase_target: null })
  }
  const stop_run = (reason: 'arrived' | 'manual' | 'blocked' | 'inactive' = 'manual', notify = true): void => {
    if (!run_target) return
    run_target = null
    walking = null
    run_route = null
    clear_movement()
    if (notify) on_run_stopped?.(reason)
  }
  const stop_run_for_manual_input = (event: KeyboardEvent, down: boolean): void => {
    if (down && (WORLD_MOVE_KEYS[event.code] !== undefined || event.code === 'Space')) stop_run()
  }
  const stop_run_for_action_lock = (next: typeof action_lock): void => {
    if (next) stop_run('blocked')
  }
  const apply_run_input = (position: Readonly<Vec3>, delta_seconds: number): void => {
    if (!run_target || !walking) return character.set_input({ yaw: director.active().get_yaw() })
    const mounting = run_to_mount({
      requested: run_target.ride_pet === true,
      available: pet !== null,
      riding,
      nearby: pet_mountable(),
    })
    if (mounting === 'mount') set_riding(true)
    if (mounting === 'wait') return character.set_input({ forward: 0, strafe: 0, phase_target: null })
    const step = step_walking(walking_world, walking, position, run_target, delta_seconds)
    walking = step.state
    run_route = { x: run_target.x, z: run_target.z, remaining: step.remaining }
    if (step.status === 'arrived') return stop_run(step.status)
    footsteps.unlock()
    character.set_input({ yaw: step.yaw, forward: step.forward, strafe: 0, phase_target: step.phase_target })
  }

  const submitted_entities = (): readonly EntityRender[] =>
    // AN IMMERSIVE BOARD SHOWS ITS FIGHTERS AND NOBODY ELSE (owner 2026-08-21). Your overworld
    // avatar and your pet are not among them — your FIGHTER is — so the composition that
    // normally leads with the controlled character steps aside while a fight holds the scene.
    mode === 'fight'
      ? external_entities
      : compose_world_entities(controlled_entity, [
          ...(pet_entity ? [pet_entity] : []),
          ...external_entities,
          ...nearby_entities,
          ...dungeon_guide_entities,
        ])

  const submit_entities = (): void => engine.set_entities(submitted_entities())
  const dungeon_guides = create_dungeon_guides({
    submit: (entities) => {
      dungeon_guide_entities = entities
      submit_entities()
    },
    caption: engine.set_entity_caption,
    ground_height: mob_ground_height,
  })

  const set_mode = (next: typeof mode): void => {
    if (next === mode) return
    if (next !== 'follow') stop_run('inactive')
    if (next !== 'follow') {
      publish_pose(null)
      engine.set_character_anchor(null)
      label_portal(false)
    }
    if (next === 'spectate') {
      const { position } = character.get_transform()
      spectate.x = position[0]
      spectate.z = position[2]
      spectate_y = position[1]
    }
    clear_movement()
    footsteps.reset()
    mode = next
    director.use(addon_for(next))
    rendered_transform = null
    if (render_character()) submit_entities()
  }

  // ── both-mouse-buttons run (the classic MMO gesture): chorded buttons never fire a second
  // pointerdown — the state is the `buttons` bitmask, read on every pointer event ──
  let touch_axes = { forward: 0, strafe: 0 }
  let mouse_forward = false
  const update_mouse_forward = (buttons: number): void => {
    const next = enabled && !action_lock && mode === 'follow' && (buttons & 3) === 3
    if (next === mouse_forward) return
    mouse_forward = next
    if (next) footsteps.unlock()
    apply_axes()
  }

  // ── spectate drag-pan (the pre-login overview keeps its own gesture) ──
  const on_pointer_down = (event: PointerEvent): void => {
    update_mouse_forward(event.buttons)
    if (!enabled || (event.button !== 0 && event.button !== 2)) return
    if (mode !== 'spectate') return
    dragging = event.button === 2 ? 'orbit' : 'pan'
    pointer = [event.clientX, event.clientY]
    canvas.setPointerCapture(event.pointerId)
  }
  const on_pointer_move = (event: PointerEvent): void => {
    update_mouse_forward(event.buttons)
    if (!enabled || !dragging || mode !== 'spectate') return
    const dx = event.clientX - pointer[0]
    const dy = event.clientY - pointer[1]
    if (dragging === 'orbit') {
      spectate_yaw -= dx * 0.005
      spectate_pitch = Math.min(1.25, Math.max(0.15, spectate_pitch + dy * 0.004))
    } else {
      const scale = spectate_zoom * 0.0018 * Math.SQRT2
      spectate.x -= (Math.cos(spectate_yaw) * dx + Math.sin(spectate_yaw) * dy) * scale
      spectate.z += (Math.sin(spectate_yaw) * dx - Math.cos(spectate_yaw) * dy) * scale
    }
    pointer = [event.clientX, event.clientY]
  }
  // Window-level release also clears a held run when the cursor leaves the canvas.
  const on_pointer_up = (event: PointerEvent): void => {
    update_mouse_forward(event.buttons)
    dragging = null
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId)
  }
  const on_context_menu = (event: MouseEvent): void => {
    // follow mode owns the right button (camera + the both-buttons run) — no browser menu
    if (enabled && (mode === 'spectate' || mode === 'follow')) event.preventDefault()
  }
  const on_wheel = (event: WheelEvent): void => {
    if (!enabled || mode !== 'spectate') return
    event.preventDefault()
    spectate_zoom = Math.min(
      overview.max_zoom,
      Math.max(overview.min_zoom, spectate_zoom * Math.exp(event.deltaY * 0.0015))
    )
  }

  // ── movement keys (camera-relative axes; the addons own their own mouse gestures) ──
  const apply_axes = (): void => {
    // both mouse buttons override the keys — holding S while double-gripping still runs forward
    held.forward = mouse_forward ? 1 : pressed.forward.size ? Number([...pressed.forward].at(-1)) : touch_axes.forward
    held.strafe = pressed.strafe.size ? Number([...pressed.strafe].at(-1)) : touch_axes.strafe
    character.set_input({ forward: held.forward, strafe: held.strafe })
  }
  const set_jump = (down: boolean): void => {
    if (!enabled || mode !== 'follow' || action_lock) return
    if (down) stop_run('manual')
    character.set_input({ jump: down, glide: down && riding && pet?.locomotion === 'fly' })
  }
  const on_key = (event: KeyboardEvent, down: boolean): void => {
    const move = WORLD_MOVE_KEYS[event.code]
    stop_run_for_manual_input(event, down)
    if (move !== undefined) {
      const bucket = pressed[move.axis]
      if (down) bucket.add(String(move.sign))
      else bucket.delete(String(move.sign))
      apply_axes()
      return
    }
    if (event.code === 'Space') set_jump(down)
    if (event.code === 'ShiftLeft' || event.code === 'ShiftRight') character.set_input({ walk: down })
    if (event.code === 'KeyX' && down) {
      if (riding) set_riding(false)
      else if (pet_mountable()) set_riding(true)
    }
    if (event.code === 'KeyT' && down && portal_labeled) on_travel?.()
  }

  /** X mounts only while the companion is beside you — the nametag's own rule. */
  const pet_mountable = (): boolean => {
    if (!pet || riding || !character_render) return false
    const [owner_x, , owner_z] = character.get_transform().position
    return Math.hypot(pet_motion.x - owner_x, pet_motion.z - owner_z) <= MOUNT_RANGE
  }

  // ── fight swords: the world mirrors what it renders so F-key focus stays pure geometry ──
  let fight_markers: readonly FightSwordMarker[] = []
  const fight_labels = new Map<string, HTMLElement>()
  let focused_fight_id: string | null = null

  /** Sword cards advertise at mob-nametag range; F focuses only the nearest close sword. */
  const sync_fight_labels = (): void => {
    const [px, , pz] = character.get_transform().position
    const targets =
      mode === 'follow'
        ? fight_prompt_targets(fight_markers, px, pz)
        : Object.freeze({ visible_ids: Object.freeze([]), focused_id: null })
    const visible = new Set(targets.visible_ids)
    let changed = targets.focused_id !== focused_fight_id
    for (const [id] of fight_labels) {
      if (visible.has(id)) continue
      engine.set_fight_sword_label(id, null)
      fight_labels.delete(id)
      changed = true
    }
    for (const id of targets.visible_ids) {
      if (fight_labels.has(id) || typeof document === 'undefined') continue
      const element = document.createElement('div')
      fight_labels.set(id, element)
      engine.set_fight_sword_label(id, element)
      changed = true
    }
    focused_fight_id = targets.focused_id
    if (changed) {
      publish_fight_prompt({
        roots: Object.freeze(Object.fromEntries(fight_labels)),
        focused_id: focused_fight_id,
      })
    }
  }

  const clear_fight_labels = (): void => {
    for (const id of fight_labels.keys()) engine.set_fight_sword_label(id, null)
    fight_labels.clear()
    focused_fight_id = null
    publish_fight_prompt({ roots: Object.freeze({}), focused_id: null })
  }

  let dungeon_portal_markers: readonly DungeonPortalMarker[] = Object.freeze([])
  const dungeon_portal_labels = new Map<string, HTMLElement>()
  let focused_dungeon_portal_id: string | null = null

  const sync_dungeon_portal_labels = (): void => {
    const [px, , pz] = character.get_transform().position
    const targets =
      mode === 'follow' && !action_lock
        ? dungeon_portal_targets(dungeon_portal_markers, px, pz)
        : Object.freeze({ visible_ids: Object.freeze([]), focused_id: null })
    const visible = new Set(targets.visible_ids)
    let changed = targets.focused_id !== focused_dungeon_portal_id
    for (const [id] of dungeon_portal_labels) {
      if (visible.has(id)) continue
      engine.set_world_label(id, null, null)
      dungeon_portal_labels.delete(id)
      changed = true
    }
    for (const id of targets.visible_ids) {
      const portal = dungeon_portal_markers.find((marker) => marker.id === id)
      if (!portal) continue
      const existing = dungeon_portal_labels.get(id)
      if (existing) {
        engine.set_world_label(id, existing, [
          portal.x,
          mob_ground_height(portal.x, portal.z) + DUNGEON_GUIDE_LABEL_HEIGHT,
          portal.z,
        ])
        continue
      }
      if (typeof document === 'undefined') continue
      const element = document.createElement('div')
      dungeon_portal_labels.set(id, element)
      engine.set_world_label(id, element, [
        portal.x,
        mob_ground_height(portal.x, portal.z) + DUNGEON_GUIDE_LABEL_HEIGHT,
        portal.z,
      ])
      changed = true
    }
    focused_dungeon_portal_id = targets.focused_id
    if (changed)
      publish_dungeon_portal_prompt({
        roots: Object.freeze(Object.fromEntries(dungeon_portal_labels)),
        portals: Object.freeze(Object.fromEntries(dungeon_portal_markers.map((portal) => [portal.id, portal]))),
        focused_id: focused_dungeon_portal_id,
        speak: dungeon_guides.speak,
      })
  }

  const clear_dungeon_portal_labels = (): void => {
    for (const id of dungeon_portal_labels.keys()) engine.set_world_label(id, null, null)
    dungeon_portal_labels.clear()
    focused_dungeon_portal_id = null
    clear_dungeon_portal_prompt()
  }
  const on_key_down = (event: KeyboardEvent): void => {
    if (!enabled || mode !== 'follow' || action_lock || !world_keyboard_eligible(event)) return
    if (mode === 'follow' && (WORLD_MOVE_KEYS[event.code] !== undefined || event.code === 'Space')) footsteps.unlock()
    on_key(event, true)
  }
  const on_key_up = (event: KeyboardEvent): void => on_key(event, false)
  const on_blur = (): void => clear_movement()
  const on_focus_in = (event: FocusEvent): void => {
    if (!world_keyboard_eligible(event)) clear_movement()
  }

  const render_character = (transform = character.get_transform()): boolean => {
    if (!character_render) return false
    const [x, visual_y, z] = transform.visual_position
    const y = visual_y + (riding && pet ? pet_seat_height(engine.entity_height(pet.id)) : 0)
    const animation = riding ? ('SIT' as const) : transform.anim
    const visible = mode !== 'follow' || !follow_addon.is_first_person()
    if (
      rendered_transform?.id === character_render.id &&
      rendered_transform.x === x &&
      rendered_transform.y === y &&
      rendered_transform.z === z &&
      rendered_transform.yaw === transform.facing_yaw &&
      rendered_transform.anim === animation &&
      rendered_transform.gait_scale === transform.gait_scale &&
      rendered_transform.visible === visible
    )
      return false
    rendered_transform = Object.freeze({
      id: character_render.id,
      x,
      y,
      z,
      yaw: transform.facing_yaw,
      anim: animation,
      gait_scale: transform.gait_scale,
      visible,
    })
    controlled_entity = world_character_entity(
      character_render,
      Object.freeze({
        position: Object.freeze([x, y, z] as const),
        facing_yaw: transform.facing_yaw,
        anim: animation,
        gait_scale: transform.gait_scale,
        visible,
      })
    )
    return true
  }

  // the mount nametag is an ENGINE label (a three CSS2D object over the pet's rendered crown —
  // positioned by the frame's own camera pass, never a lagging overlay); React portals the chip
  // content into this element through the mount-prompt feed
  const mount_label = typeof document === 'undefined' ? null : document.createElement('div')
  let labeled_pet_id: string | null = null
  const label_pet = (pet_id: string | null): void => {
    if (pet_id === labeled_pet_id) return
    if (labeled_pet_id) engine.set_entity_label(labeled_pet_id, null)
    if (pet_id && mount_label) engine.set_entity_label(pet_id, mount_label)
    labeled_pet_id = pet_id && mount_label ? pet_id : null
    publish_mount_prompt(labeled_pet_id ? mount_label : null)
  }

  // the star-gate prompt rides the SAME engine label pass — one element floated over the portal
  // while the body stands close enough for T to mean travel
  const portal_label = typeof document === 'undefined' ? null : document.createElement('div')
  let portal_labeled = false
  const label_portal = (near: boolean): void => {
    const attach = near && !!portal_label
    if (attach === portal_labeled) return
    engine.set_portal_label(attach && portal_label ? portal_label : null)
    portal_labeled = attach
    publish_portal_prompt(attach && portal_label ? portal_label : null)
  }
  /** eligibility delegates to the exported origin law — one distance rule everywhere */
  const portal_eligible = (): boolean => {
    if (mode !== 'follow' || !character_render) return false
    const [x, , z] = character.get_transform().position
    return portal_near(x, z)
  }

  const render_pet = (transform = character.get_transform(), delta_seconds = 0): boolean => {
    if (!pet || !character_render) {
      const changed = pet_entity !== null
      pet_entity = null
      label_pet(null)
      return changed
    }
    const [owner_x, owner_y, owner_z] = transform.visual_position
    pet_elapsed_seconds += delta_seconds
    if (!riding) pet_motion = step_pet_follow(pet_motion, { x: owner_x, z: owner_z }, delta_seconds)
    const x = riding ? owner_x : pet_motion.x
    const z = riding ? owner_z : pet_motion.z
    const y = riding
      ? transform.visual_position[1]
      : pet_ground_height(x, z, owner_y) + pet_vertical_offset(pet.locomotion, pet_elapsed_seconds)
    // a FOLLOWING pet animates from ITS OWN motion — the owner's pose drives it only when ridden
    // (a follower jumping in sync with the player was the bug, owner 2026-08-21)
    const animation =
      pet.locomotion === 'swim'
        ? ('SWIM' as const)
        : riding
          ? !transform.on_ground
            ? transform.anim
            : transform.speed > 0.5
              ? ('RUN' as const)
              : ('IDLE' as const)
          : pet_motion.moving
            ? ('RUN' as const)
            : ('IDLE' as const)
    pet_entity = Object.freeze({
      id: pet.id,
      kind: 'mob',
      model_url: pet.model_url,
      anchor: Object.freeze({ kind: 'world', position: Object.freeze([x, y, z] as const) }),
      facing: Object.freeze({ kind: 'yaw', yaw: riding ? transform.facing_yaw : pet_motion.yaw }),
      // the companion covers ground at 1.5× the player's run — its gait plays at the same
      // scale so the feet match the floor (2026-08-21: the run looked like slow motion)
      animation: Object.freeze({ name: animation, time_scale: animation === 'RUN' ? 1.5 : 1 }),
    })
    label_pet(pet_mountable() ? pet.id : null)
    return true
  }

  const tick = (now: number, delta_seconds: number): void => {
    const world_time_of_day = world_daylight(now, pinned_time, day_night_cycle_enabled)
    let anchor: CameraAnchor
    if (mode === 'spectate') {
      anchor = {
        x: spectate.x,
        y: spectate_y,
        z: spectate.z,
        eye_height: 0,
        speed: 0,
        on_ground: true,
      }
    } else if (mode === 'follow') {
      const before = character.get_transform().position
      const ready = city_artifacts_ready({
        min_x: before[0] - 3,
        max_x: before[0] + 3,
        min_z: before[2] - 3,
        max_z: before[2] + 3,
      })
      const physics_seconds = delta_seconds * Number(ready)
      apply_run_input(before, physics_seconds)
      character.tick(physics_seconds)
      const transform = character.get_transform()
      const character_changed = render_character(transform)
      const pet_changed = render_pet(transform, delta_seconds)
      dungeon_guides.face_player(transform.position)
      if (character_changed || pet_changed) submit_entities()
      label_portal(portal_eligible())
      sync_fight_labels()
      sync_dungeon_portal_labels()
      footsteps.tick({
        position: transform.position,
        on_ground: transform.on_ground,
        preset: ground_preset(transform),
        speed: transform.speed,
        water_entered: transform.water_entered,
      })
      if (transform.air_jumped) engine.play_jump_puff(transform.visual_position)
      anchor = {
        x: transform.visual_position[0],
        y: transform.visual_position[1],
        z: transform.visual_position[2],
        eye_height: CHARACTER_HEIGHT * 0.9,
        speed: transform.speed,
        on_ground: transform.on_ground,
      }
      publish_pose({
        character_id: character_render?.id ?? '',
        x: transform.position[0],
        y: transform.visual_y,
        z: transform.position[2],
        yaw: director.active().get_yaw(),
        riding,
        time_of_day: world_time_of_day,
        route: run_route,
      })
      // the night lantern (and any character-anchored presentation) follows the FEET, never
      // the camera target — the follow camera leads ahead of the body
      engine.set_character_anchor([anchor.x, anchor.y, anchor.z])
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
    if (mode === 'follow' && render_character()) submit_entities()
    last_view = view
    holograms.forEach((hologram) => hologram.update(view, mode !== 'fight'))
    engine.set_camera(view.position, view.target, {
      fov: view.fov,
      ortho_blend: view.ortho_blend,
      ortho_height: view.ortho_height,
    })
    const focus = mode === 'follow' ? ([anchor.x, anchor.z] as const) : ([view.target[0], view.target[2]] as const)
    chunks.set_focus(focus[0], focus[1])
    chunks.tick()
    engine.set_time_of_day(time_of_day_for_camera_mode(mode, world_time_of_day))
  }

  canvas.addEventListener('pointerdown', on_pointer_down)
  canvas.addEventListener('pointermove', on_pointer_move)
  globalThis.addEventListener('pointerup', on_pointer_up)
  globalThis.addEventListener('pointercancel', on_pointer_up)
  canvas.addEventListener('contextmenu', on_context_menu)
  canvas.addEventListener('wheel', on_wheel, { passive: false })
  globalThis.addEventListener('keydown', on_key_down)
  globalThis.addEventListener('keyup', on_key_up)
  globalThis.addEventListener('blur', on_blur)
  globalThis.addEventListener('focusin', on_focus_in)
  const set_riding = (next: boolean): void => {
    riding = Boolean(next && pet && character_render)
    character.set_input({ speed_scale: riding ? MOUNT_SPEED_SCALE : 1, glide: false })
    rendered_transform = null
    render_character()
    render_pet()
    submit_entities()
  }

  const ticker = create_world_ticker({ tick })

  return Object.freeze({
    canvas,
    set_quality: (quality: 'low' | 'medium' | 'high', render_distance: number | null) => {
      // one radius for both terrains: voxel chunks AND the far shell's hole track the override
      chunks.set_quality(quality, render_distance)
    },
    set_audio_volume: engine.set_audio_volume,
    set_footsteps_enabled: footsteps.set_enabled,
    set_day_night_cycle_enabled: (enabled: boolean) => {
      day_night_cycle_enabled = enabled
    },
    backend: engine.backend,
    subscribe_status: engine.subscribe_status,
    set_time_of_day: (time: number | null) => {
      pinned_time = time
      if (time !== null) engine.set_time_of_day(time)
    },
    atmosphere_preset: compiled.recipe.atmosphere,
    set_atmosphere: engine.set_atmosphere,
    set_clouds_visible: engine.set_clouds_visible,
    set_view: ({ focus }: Pick<WorldView, 'focus'>) => {
      spectate.x = focus[0]
      spectate.z = focus[1]
    },
    set_character: (next: LoadedCharacterRender | null) => {
      character_render = next ? Object.freeze(next) : null
      controlled_entity = null
      rendered_transform = null
      if (character_render) render_character()
      else {
        riding = false
        character.set_input({ speed_scale: 1, glide: false })
        pet_entity = null
      }
      render_pet()
      submit_entities()
    },
    set_nearby_entities: (next: readonly EntityRender[]) => {
      nearby_entities = next
      submit_entities()
    },
    set_entities: (next: readonly EntityRender[]) => {
      external_entities = Object.freeze([...next])
      submit_entities()
    },
    /** mirror + forward: the world keeps the marker list for F-key focus geometry, the engine
     *  layer renders them (the join-window clock made physical) */
    set_fight_swords: (url: string, impact_sound_url: string, markers: readonly FightSwordMarker[]) => {
      fight_markers = markers
      engine.set_fight_swords(url, impact_sound_url, markers)
      sync_fight_labels()
    },
    set_resource_nodes: (markers: readonly ResourceNodeMarker[], height_at = surface_y) =>
      engine.set_resource_nodes(markers.map((marker) => ({ ...marker, y: height_at(marker.x, marker.z) }))),
    set_dungeon_portals: (markers: readonly DungeonPortalMarker[]) => {
      dungeon_portal_markers = Object.freeze([...markers])
      engine.set_dungeon_portals(markers)
      dungeon_guides.set_markers(markers)
      sync_dungeon_portal_labels()
    },
    set_dungeon_stage: engine.set_dungeon_stage,
    set_resource_node_label: (id: string, element: HTMLElement | null) => engine.set_resource_node_label(id, element),
    entity_height: engine.entity_height,
    set_pet: (next: Readonly<{ id: string; model_url: string; locomotion: PetLocomotion }> | null) => {
      pet = next ? Object.freeze(next) : null
      pet_motion = empty_pet_motion()
      pet_elapsed_seconds = 0
      if (!pet && riding) {
        riding = false
        character.set_input({ speed_scale: 1, glide: false })
        rendered_transform = null
      }
      render_character()
      render_pet()
      submit_entities()
    },
    set_riding,
    riding: () => riding,
    ground_height: (x: number, z: number) => surface_y(x, z),
    mob_ground_height,
    walking_world,
    walk_step: (from: WalkPoint, x: number, z: number) => walking_edge(walking_world, from, x, z),
    pet_ground_height,
    /// Where the camera currently looks — its ground focus. The natural spawn when handing
    /// control to a character mid-session.
    camera_focus: () => Object.freeze({ x: spectate.x, z: spectate.z }),
    /// Point the system at a character: the camera and terrain travel to its position.
    /// Cross-world pointing waits on more worlds having terrain recipes.
    point_at: (position: Readonly<{ x: number; y?: number; z: number }>, reconcile = false) => {
      footsteps.reset()
      character.teleport([position.x, position.y ?? surface_y(position.x, position.z), position.z], {
        smooth: reconcile && mode === 'follow',
      })
      set_mode(camera_mode_after(mode, { mode: 'follow', from: 'character' }))
    },
    release: () => set_mode(camera_mode_after(mode, { mode: 'spectate', from: 'character' })),
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
      if (board?.ambient) return
      if (board === null) {
        if (mode === 'fight') set_mode('follow')
      } else {
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
    update_fight_blob: engine.update_fight_blob,
    remove_fight_blob: engine.remove_fight_blob,
    pick_fight_cell: engine.pick_fight_cell,
    // the rest of the fight presentation, forwarded beside the board doors above — the surface
    // that mounts a board here drives its cues and its models through the same handle
    play_fight_cue: engine.play_fight_cue,
    animate_entity: engine.animate_entity,
    project_entity: engine.project_entity,
    hit_entity_caption: engine.hit_entity_caption,
    mode: () => mode,
    /// The follow rig's knobs (cinematic toggle, programmatic dolly) for the app layer.
    follow_camera: () => follow_addon,
    /// The last rendered camera frame — the screen-space pick (player right-click) reads it.
    camera_frame: (): CameraFrame | null => last_view,
    set_entity_caption: engine.set_entity_caption,
    set_entity_label: (id: string, element: HTMLElement | null) => engine.set_entity_label(id, element),
    set_world_label: (id: string, element: HTMLElement | null, position: Vec3 | null) =>
      engine.set_world_label(id, element, position),
    state: (): WorldState =>
      Object.freeze({
        engine: engine.status(),
        render: engine.render_state(),
        chunks: chunks.stats(),
        displayed_chunks: engine.chunk_count(),
      }),
    set_jump,
    set_movement_area: character.set_movement_area,
    set_movement: (axes: Readonly<{ forward: number; strafe: number }>) => {
      if (!enabled || mode !== 'follow' || action_lock) return
      const magnitude = Math.hypot(axes.forward, axes.strafe)
      if (magnitude > 0) stop_run('manual')
      const length = Math.max(1, magnitude)
      touch_axes = { forward: axes.forward / length, strafe: axes.strafe / length }
      footsteps.unlock()
      apply_axes()
    },
    set_run_target: (next: RunTarget | null) => {
      stop_run('manual', false)
      if (!next) return
      clear_movement()
      run_target = Object.freeze(next)
      walking = begin_walking(character.get_transform().position, run_target)
    },
    set_active: (next: boolean, background = false) => {
      ticker.set_active(next, background)
      if (next) engine.start(({ now }) => ticker.advance(now), background)
      if (next === active) return
      active = next
      director.set_enabled(next)
      if (!next) {
        stop_run('inactive')
        clear_movement()
        footsteps.reset()
        dragging = null
        engine.stop()
        publish_pose(null)
      }
    },
    set_interactive: (next: boolean) => {
      if (enabled === next) return
      enabled = next
      if (!next) {
        clear_movement()
      }
      canvas.style.cursor = next ? 'grab' : 'default'
    },
    set_action_lock: (next: Readonly<{ character_id: string; animation: 'gather' | null }> | null) => {
      const next_key = next ? `${next.character_id}:${next.animation ?? ''}` : null
      const current_key = action_lock ? `${action_lock.character_id}:${action_lock.animation ?? ''}` : null
      if (next_key === current_key) return
      if (action_animation_timer) clearInterval(action_animation_timer)
      action_animation_timer = null
      action_lock = next
      stop_run_for_action_lock(next)
      clear_movement()
      if (next?.animation !== 'gather') return
      const play = (): void => {
        // Reuse the character model's authored self-buff clip. World space has no fight cell,
        // so the VFX half declines cleanly while the entity beat still plays.
        void engine.play_fight_cue({
          id: `gather:${next.character_id}:${Date.now()}`,
          type: 'cast',
          caster_id: next.character_id,
          self_cast: true,
          spell: 'gather',
          cast_level: 0,
          target_cell: 0,
          element: 'neutral',
          style: 'buff',
          critical: false,
          amount: 0,
          target_max_hp: null,
          affected_cells: Object.freeze([]),
          killed: false,
        })
      }
      play()
      action_animation_timer = setInterval(play, 2_200)
    },
    dispose: () => {
      ticker.dispose()
      holograms.forEach((hologram) => hologram.dispose())
      if (action_animation_timer) clearInterval(action_animation_timer)
      publish_pose(null)
      clear_fight_labels()
      clear_dungeon_portal_labels()
      dungeon_guides.dispose()
      canvas.removeEventListener('pointerdown', on_pointer_down)
      canvas.removeEventListener('pointermove', on_pointer_move)
      globalThis.removeEventListener('pointerup', on_pointer_up)
      globalThis.removeEventListener('pointercancel', on_pointer_up)
      canvas.removeEventListener('contextmenu', on_context_menu)
      canvas.removeEventListener('wheel', on_wheel)
      globalThis.removeEventListener('keydown', on_key_down)
      globalThis.removeEventListener('keyup', on_key_up)
      globalThis.removeEventListener('blur', on_blur)
      globalThis.removeEventListener('focusin', on_focus_in)
      director.set_enabled(false)
      character.dispose()
      footsteps.dispose()
      chunks.dispose()
      terrain_planner.dispose()
      engine.dispose()
    },
  })
}
