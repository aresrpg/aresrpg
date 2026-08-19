// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// One entity lifecycle for terrain and fight boards. Callers provide identity, appearance, and an anchor;
// the engine alone owns model loading, animation, placement, and disposal.
import {
  AnimationMixer,
  Box3,
  Color,
  Group,
  LoopOnce,
  LoopRepeat,
  Vector3,
  type AnimationAction,
  type AnimationClip,
  type Material,
  type Object3D,
  type Scene,
} from 'three'

import { create_entity_model, type EntityModel } from './entity_model.ts'
import { BOARD_FLOOR_THICKNESS } from './fight_board_surface.ts'
import { attach_invisibility, type InvisibilityEffect } from './invisibility.ts'
import type {
  CharacterAnimationName,
  EntityPathMotion,
  EntityRender,
  FightBoardRender,
  FightBoardRenderCell,
} from './types.ts'

type MountedEntity = Readonly<{
  spec: EntityRender
  appearance_key: string
  generation: number
  model: EntityModel | null
  object: Group | null
  // The inner offset group. Beats animate ONLY this node (wobble around identity);
  // root position/rotation belong to place/snap/motion alone — one owner per transform.
  wobble: Group | null
  mixer: AnimationMixer | null
  anchor_offset: Vector3 | null
  rendered_height: number | null
  invisibility: InvisibilityEffect | null
}>

type ActiveMotion = Readonly<{
  entity: MountedEntity
  points: readonly Vector3[]
  started_at: number
  cell_ms: number
  gait: EntityPathMotion['gait']
  resolve: (completed: boolean) => void
}>

type EntityBeatKind = 'attack' | 'hit' | 'heal' | 'death'

type ActiveBeat = Readonly<{
  entity: MountedEntity
  kind: EntityBeatKind
  started_at: number
  duration_ms: number
  resolve: (completed: boolean) => void
}>

type EmissiveMaterial = Material & Readonly<{ emissive: Color }>
type MaterialFlash = Readonly<{ material: EmissiveMaterial; baseline: Color }>
type ActiveFlash = Readonly<{
  started_at: number
  color: Color
  peak: number
  materials: readonly MaterialFlash[]
}>

export type EntityModelLoader = (spec: EntityRender) => Promise<EntityModel>

const RUN_MS_PER_CELL = 170
const WALK_MS_PER_CELL = 480
const SLIDE_MS_PER_CELL = 110
// The pace the locomotion clips read right at: playback scales by reference/actual so the
// stride always matches the real travel speed — feet never slide, whatever the gait pace.
const GAIT_CLIP_REFERENCE_MS = Object.freeze({ walk: WALK_MS_PER_CELL, run: 300 })
const FIGHT_CHARACTER_SCALE = 0.7

export const character_entity_scale = (anchor: EntityRender['anchor']['kind']): number =>
  anchor === 'fight_cell' ? FIGHT_CHARACTER_SCALE : 1

type EntityLocomotion = CharacterAnimationName
type EntityAnimation = EntityLocomotion | 'ATTACK' | 'DEATH'
type ActiveAnimation = Readonly<{ action: AnimationAction; clip: AnimationClip; loop: boolean }>

const LOCOMOTION_PREFERENCES: Readonly<Record<EntityLocomotion, readonly string[]>> = Object.freeze({
  IDLE: Object.freeze(['IDLE']),
  WALK: Object.freeze(['WALK', 'RUN']),
  RUN: Object.freeze(['RUN', 'WALK']),
  JUMP: Object.freeze(['JUMP']),
  JUMP_RUN: Object.freeze(['JUMP_RUN', 'JUMP', 'RUN']),
  FALL: Object.freeze(['FALL', 'JUMP']),
  SWIM: Object.freeze(['SWIM', 'WALK', 'IDLE']),
  SIT: Object.freeze(['SIT', 'IDLE']),
})

const ACTION_PREFERENCES: Readonly<Record<'ATTACK' | 'DEATH', readonly string[]>> = Object.freeze({
  ATTACK: Object.freeze(['ATTACK', 'SPELL', 'CAST']),
  DEATH: Object.freeze(['DEATH', 'DIE', 'KO']),
})

export const resolve_entity_locomotion_clip = (
  clips: readonly AnimationClip[],
  locomotion: EntityLocomotion
): AnimationClip | undefined => {
  const named = clips.map((clip) => Object.freeze({ clip, name: clip.name.toUpperCase() }))
  const preferences = LOCOMOTION_PREFERENCES[locomotion]
  for (const preference of preferences) {
    const exact = named.find(({ name }) => name === preference || name.split(/[|:/\\.-]/).at(-1) === preference)
    if (exact) return exact.clip
  }
  for (const preference of preferences) {
    const partial = named.find(({ name }) => name.includes(preference))
    if (partial) return partial.clip
  }
  return undefined
}

export const resolve_entity_action_clip = (
  clips: readonly AnimationClip[],
  action: 'ATTACK' | 'DEATH'
): AnimationClip | undefined => {
  const named = clips.map((clip) => Object.freeze({ clip, name: clip.name.toUpperCase() }))
  for (const preference of ACTION_PREFERENCES[action]) {
    const exact = named.find(
      ({ name }) => name === preference || name.split(/[|:/\\.-]/).at(-1) === preference || name.includes(preference)
    )
    if (exact) return exact.clip
  }
  return undefined
}

export const fight_reaction_envelope = (progress: number, peak = 0.32): number => {
  if (progress <= 0 || progress >= 1) return 0
  const x = progress <= peak ? progress / peak : (progress - peak) / (1 - peak)
  const smooth = x * x * (3 - 2 * x)
  return progress <= peak ? smooth : 1 - smooth
}

export const fight_flash_envelope = (elapsed_seconds: number): number => {
  const life = 0.4
  const fade_in = 0.15
  if (elapsed_seconds <= 0 || elapsed_seconds >= life) return 0
  const raw = elapsed_seconds < fade_in ? elapsed_seconds / fade_in : 1 - (elapsed_seconds - fade_in) / (life - fade_in)
  return raw * raw * (3 - 2 * raw)
}

export const fight_path_gait = (cell_count: number): EntityPathMotion['gait'] => (cell_count >= 3 ? 'run' : 'walk')

export const fight_gait_cell_ms = (gait: EntityPathMotion['gait']): number =>
  gait === 'run' ? RUN_MS_PER_CELL : gait === 'slide' ? SLIDE_MS_PER_CELL : WALK_MS_PER_CELL

export const cardinal_target_yaw = (from: Readonly<Vector3>, target: Readonly<Vector3>): number => {
  const dx = target.x - from.x
  const dz = target.z - from.z
  if (Math.abs(dx) >= Math.abs(dz)) return dx >= 0 ? Math.PI / 2 : -Math.PI / 2
  return dz >= 0 ? 0 : Math.PI
}

const appearance_key_of = (spec: EntityRender): string =>
  spec.kind === 'mob' ? `mob:${spec.model_url}` : `character:${JSON.stringify(spec.appearance)}`

const facing_yaw = (
  spec: Readonly<EntityRender>,
  board: Readonly<FightBoardRender> | null,
  cell: Readonly<FightBoardRenderCell> | null
): number => {
  if (spec.facing.kind === 'yaw') return spec.facing.yaw
  if (!board || !cell) return spec.facing.side === 'a' ? 0 : Math.PI
  const opposing_kind = spec.facing.side === 'a' ? 'start_b' : 'start_a'
  const opposing_cells = board.cells.filter(({ kind }) => kind === opposing_kind)
  if (opposing_cells.length === 0) return spec.facing.side === 'a' ? 0 : Math.PI
  const centroid = opposing_cells.reduce<Readonly<{ x: number; y: number }>>(
    (sum, opponent) => Object.freeze({ x: sum.x + opponent.x, y: sum.y + opponent.y }),
    Object.freeze({ x: 0, y: 0 })
  )
  return Math.atan2(centroid.x / opposing_cells.length - cell.x, centroid.y / opposing_cells.length - cell.y)
}

export const create_entity_layer = ({
  scene,
  load_model = create_entity_model,
  attach_invisibility: attach_invisibility_effect = attach_invisibility,
}: Readonly<{
  scene: Scene
  load_model?: EntityModelLoader
  attach_invisibility?: (root: Object3D) => InvisibilityEffect
}>) => {
  const entities = new Map<string, MountedEntity>()
  const motions = new Map<string, ActiveMotion>()
  const beats = new Map<string, ActiveBeat>()
  const flashes = new Map<string, ActiveFlash>()
  const active_animations = new Map<string, ActiveAnimation>()
  const dead_entities = new Set<string>()
  const retained_facing = new Map<string, number>()
  let board: FightBoardRender | null = null
  let serial = 0
  let previous_tick = performance.now()

  const place = (entity: MountedEntity): void => {
    const root = entity.object
    if (!root || !entity.model) return
    const { anchor } = entity.spec
    root.scale.setScalar(entity.spec.kind === 'character' ? character_entity_scale(anchor.kind) : 1)
    if (anchor.kind === 'world') {
      const [x, y, z] = anchor.position
      root.visible = entity.spec.visible !== false
      root.position.set(x, y, z)
      root.rotation.y = facing_yaw(entity.spec, null, null)
      return
    }
    const cell = board?.cells.find(({ cell: candidate }) => candidate === anchor.cell)
    root.visible = Boolean(board && cell) && entity.spec.visible !== false
    if (!board || !cell) return
    root.position.set(
      board.origin.x + (cell.x + 0.5) * board.cell_size,
      board.origin.y + BOARD_FLOOR_THICKNESS,
      board.origin.z + (cell.y + 0.5) * board.cell_size
    )
    root.rotation.y = retained_facing.get(entity.spec.id) ?? facing_yaw(entity.spec, board, cell)
  }

  const position_at = (entity: MountedEntity, cell_id: number): Vector3 | null => {
    const cell = board?.cells.find(({ cell }) => cell === cell_id)
    if (!board || !cell || !entity.model) return null
    return new Vector3(
      board.origin.x + (cell.x + 0.5) * board.cell_size,
      board.origin.y + BOARD_FLOOR_THICKNESS,
      board.origin.z + (cell.y + 0.5) * board.cell_size
    )
  }

  const play_clip = (entity: MountedEntity, name: EntityAnimation, requested_time_scale = 1): AnimationClip | null => {
    const { mixer, model } = entity
    if (!mixer || !model) return null
    const clip =
      name === 'ATTACK' || name === 'DEATH'
        ? resolve_entity_action_clip(model.clips, name)
        : resolve_entity_locomotion_clip(model.clips, name)
    const fallback = name === 'IDLE' ? model.clips[0] : null
    const selected = clip ?? fallback
    if (!selected) return null
    const loop = name !== 'ATTACK' && name !== 'DEATH'
    const resolved_name = selected.name
      .toUpperCase()
      .split(/[|:/\\.-]/)
      .at(-1)
    const time_scale = requested_time_scale * (name === 'SWIM' && resolved_name === 'WALK' ? 0.7 : 1)
    const active = active_animations.get(entity.spec.id)
    if (loop && active?.loop && active.clip === selected) {
      active.action.setEffectiveTimeScale(time_scale)
      return selected
    }
    const action = mixer.clipAction(selected).reset()
    action.setEffectiveTimeScale(time_scale)
    if (!loop) {
      action.setLoop(LoopOnce, 1)
      action.clampWhenFinished = true
    } else {
      action.setLoop(LoopRepeat, Infinity)
      action.clampWhenFinished = false
    }
    if (active && active.action !== action) action.crossFadeFrom(active.action, 0.2, false)
    action.play()
    active_animations.set(entity.spec.id, Object.freeze({ action, clip: selected, loop }))
    return selected
  }

  const sync_animation = (entity: MountedEntity): void => {
    const { animation } = entity.spec
    play_clip(entity, animation?.name ?? 'IDLE', animation?.time_scale ?? 1)
  }

  const restore_flash = (id: string): void => {
    const flash = flashes.get(id)
    flash?.materials.forEach(({ material, baseline }) => material.emissive.copy(baseline))
    flashes.delete(id)
  }

  const arm_flash = (id: string, color: number, peak: number): void => {
    const entity = entities.get(id)
    const root = entity?.object
    if (!root) return
    restore_flash(id)
    const seen = new Set<Material>()
    const materials: MaterialFlash[] = []
    root.traverse((node) => {
      const candidate = 'material' in node ? node.material : null
      const rows = Array.isArray(candidate) ? candidate : [candidate]
      rows.forEach((material) => {
        if (!material || seen.has(material) || !('emissive' in material)) return
        seen.add(material)
        const { emissive } = material as EmissiveMaterial
        materials.push(Object.freeze({ material: material as EmissiveMaterial, baseline: emissive.clone() }))
      })
    })
    flashes.set(
      id,
      Object.freeze({ started_at: previous_tick, color: new Color(color), peak, materials: Object.freeze(materials) })
    )
  }

  // Canceling a beat mid-flight must not strand its wobble deform on the entity.
  const cancel_beat = (id: string): void => {
    const beat = beats.get(id)
    if (!beat) return
    beats.delete(id)
    const { wobble } = beat.entity
    if (wobble) {
      wobble.position.x = 0
      wobble.position.z = 0
      wobble.rotation.z = 0
      wobble.scale.set(1, 1, 1)
    }
    beat.resolve(false)
  }

  const remove = (id: string): void => {
    const entity = entities.get(id)
    if (!entity) return
    entities.delete(id)
    motions.get(id)?.resolve(false)
    motions.delete(id)
    cancel_beat(id)
    restore_flash(id)
    active_animations.delete(id)
    dead_entities.delete(id)
    retained_facing.delete(id)
    entity.invisibility?.dispose()
    if (!entity.model) return
    if (entity.object) scene.remove(entity.object)
    entity.mixer?.stopAllAction()
    entity.mixer?.uncacheRoot(entity.model.root)
    entity.model.dispose()
  }

  const mount = (spec: EntityRender): void => {
    const appearance_key = appearance_key_of(spec)
    const current = entities.get(spec.id)
    if (current?.appearance_key === appearance_key) {
      const wants_invisibility = spec.visual_effect?.kind === 'invisibility'
      const has_invisibility = current.invisibility !== null
      if (has_invisibility && !wants_invisibility) current.invisibility?.dispose()
      const invisibility =
        wants_invisibility && !has_invisibility && current.model
          ? attach_invisibility_effect(current.model.root)
          : wants_invisibility
            ? current.invisibility
            : null
      const next = Object.freeze({ ...current, spec, invisibility })
      entities.set(spec.id, next)
      if (!motions.has(spec.id) && !dead_entities.has(spec.id)) place(next)
      if (!motions.has(spec.id) && !beats.has(spec.id) && !dead_entities.has(spec.id)) sync_animation(next)
      return
    }
    remove(spec.id)
    serial += 1
    const generation = serial
    entities.set(
      spec.id,
      Object.freeze({
        spec,
        appearance_key,
        generation,
        model: null,
        object: null,
        wobble: null,
        mixer: null,
        anchor_offset: null,
        rendered_height: null,
        invisibility: null,
      })
    )
    void load_model(spec).then(
      (model) => {
        const pending = entities.get(spec.id)
        if (!pending || pending.generation !== generation) {
          model.dispose()
          return
        }
        const object = new Group()
        const offset = new Group()
        object.name = `entity:${spec.id}`
        offset.position.y = -model.min_y
        offset.add(model.root)
        object.add(offset)
        const mixer = model.clips.length > 0 ? new AnimationMixer(model.root) : null
        const invisibility =
          pending.spec.visual_effect?.kind === 'invisibility' ? attach_invisibility_effect(model.root) : null
        const mounted = Object.freeze({
          ...pending,
          model,
          object,
          wobble: offset,
          mixer,
          anchor_offset: null,
          invisibility,
        })
        entities.set(spec.id, mounted)
        scene.add(object)
        place(mounted)
        sync_animation(mounted)
        mixer?.update(0)
        object.updateWorldMatrix(true, true)
        const bounds = new Box3().setFromObject(object)
        const center = bounds.getCenter(new Vector3())
        const world_anchor = new Vector3(center.x, bounds.max.y, center.z)
        const anchor_offset = [world_anchor.x, world_anchor.y, world_anchor.z].every(Number.isFinite)
          ? object.worldToLocal(world_anchor)
          : new Vector3()
        const rendered_height = bounds.getSize(new Vector3()).y
        entities.set(
          spec.id,
          Object.freeze({
            ...mounted,
            anchor_offset,
            rendered_height: Number.isFinite(rendered_height) ? rendered_height : null,
          })
        )
      },
      (error: unknown) => {
        const pending = entities.get(spec.id)
        if (pending?.generation === generation) entities.delete(spec.id)
        console.error(`Failed to render entity ${spec.id}.`, error)
      }
    )
  }

  return Object.freeze({
    set_board: (next: FightBoardRender | null): void => {
      if (board !== next) retained_facing.clear()
      board = next
      if (!next) dead_entities.clear()
      entities.forEach((entity, id) => {
        if (!motions.has(id) && !dead_entities.has(id)) place(entity)
      })
    },
    set: (next: readonly EntityRender[]): void => {
      const wanted = new Set(next.map(({ id }) => id))
      entities.forEach((_, id) => {
        if (!wanted.has(id)) remove(id)
      })
      next.forEach(mount)
    },
    animate: (motion: EntityPathMotion): Promise<boolean> => {
      const entity = entities.get(motion.id)
      const root = entity?.object
      if (!entity || !root || entity.spec.anchor.kind !== 'fight_cell' || motion.cells.length === 0)
        return Promise.resolve(false)
      const destinations = motion.cells.map((cell) => position_at(entity, cell))
      if (destinations.some((point) => point === null)) return Promise.resolve(false)
      motions.get(motion.id)?.resolve(false)
      if (motion.gait !== 'slide')
        play_clip(
          entity,
          motion.gait === 'run' ? 'RUN' : 'WALK',
          GAIT_CLIP_REFERENCE_MS[motion.gait] / fight_gait_cell_ms(motion.gait)
        )
      return new Promise<boolean>((resolve) => {
        motions.set(
          motion.id,
          Object.freeze({
            entity,
            points: Object.freeze([root.position.clone(), ...(destinations as Vector3[])]),
            started_at: previous_tick,
            cell_ms: fight_gait_cell_ms(motion.gait),
            gait: motion.gait,
            resolve,
          })
        )
      })
    },
    face_cell: (id: string, cell: number): boolean => {
      const entity = entities.get(id)
      const root = entity?.object
      if (!entity || !root) return false
      const target = position_at(entity, cell)
      if (!target) return false
      const yaw = cardinal_target_yaw(root.position, target)
      root.rotation.y = yaw
      retained_facing.set(id, yaw)
      return true
    },
    beat: (id: string, kind: EntityBeatKind, face_id?: string, critical = false): Promise<boolean> => {
      const entity = entities.get(id)
      const root = entity?.object
      if (!entity || !root) return Promise.resolve(false)
      motions.get(id)?.resolve(false)
      motions.delete(id)
      cancel_beat(id)
      const face = face_id ? entities.get(face_id)?.object?.position : null
      if (face) {
        root.rotation.y = Math.atan2(face.x - root.position.x, face.z - root.position.z)
        retained_facing.set(id, root.rotation.y)
      }
      const clip =
        kind === 'attack' ? play_clip(entity, 'ATTACK') : kind === 'death' ? play_clip(entity, 'DEATH') : null
      const duration_ms =
        kind === 'hit'
          ? 300
          : kind === 'heal'
            ? 400
            : kind === 'death'
              ? Math.max(450, (clip?.duration ?? 0) * 1_000)
              : Math.max(500, (clip?.duration ?? 0) * 1_000)
      if (kind === 'hit') arm_flash(id, critical ? 0xffd070 : 0xff4747, critical ? 0.6 : 0.55)
      else if (kind === 'heal') arm_flash(id, 0x4caf50, 0.4)
      else if (kind === 'death') arm_flash(id, 0xff4747, 0.55)
      return new Promise<boolean>((resolve) => {
        beats.set(id, Object.freeze({ entity, kind, started_at: previous_tick, duration_ms, resolve }))
      })
    },
    snap: (id: string, cell?: number): boolean => {
      const entity = entities.get(id)
      const root = entity?.object
      if (!entity || !root || dead_entities.has(id)) return false
      if (cell === undefined) place(entity)
      else {
        const destination = position_at(entity, cell)
        if (!destination) return false
        root.position.copy(destination)
      }
      return true
    },
    world_anchor: (id: string): Vector3 | null => {
      const entity = entities.get(id)
      if (!entity?.anchor_offset) return null
      const root = entity?.object
      if (!root?.visible) return null
      root.updateWorldMatrix(true, true)
      return root.localToWorld(entity.anchor_offset.clone())
    },
    entity_height: (id: string): number | null => entities.get(id)?.rendered_height ?? null,
    cell_anchor: (cell_id: number, height = 1.2): Vector3 | null => {
      const cell = board?.cells.find(({ cell }) => cell === cell_id)
      if (!board || !cell) return null
      return new Vector3(
        board.origin.x + (cell.x + 0.5) * board.cell_size,
        board.origin.y + BOARD_FLOOR_THICKNESS + height,
        board.origin.z + (cell.y + 0.5) * board.cell_size
      )
    },
    tick: (now: number): void => {
      const delta = Math.min(0.1, Math.max(0, now - previous_tick) / 1000)
      previous_tick = now
      entities.forEach(({ mixer }) => mixer?.update(delta))
      entities.forEach(({ invisibility }) => invisibility?.update(delta))
      flashes.forEach((flash, id) => {
        const amount = fight_flash_envelope((now - flash.started_at) / 1_000) * flash.peak
        flash.materials.forEach(({ material, baseline }) =>
          material.emissive.setRGB(
            baseline.r + (flash.color.r - baseline.r) * amount,
            baseline.g + (flash.color.g - baseline.g) * amount,
            baseline.b + (flash.color.b - baseline.b) * amount
          )
        )
        if (now - flash.started_at >= 400) restore_flash(id)
      })
      beats.forEach((beat, id) => {
        const { object: root, wobble } = beat.entity
        if (!root || !wobble) return
        const progress = Math.min(1, Math.max(0, now - beat.started_at) / beat.duration_ms)
        const envelope = fight_reaction_envelope(progress)
        // The wobble node animates around identity in the root's LOCAL frame (+z = facing),
        // so the beat needs no captured rest and never fights place/snap over root.position.
        if (beat.kind === 'hit') {
          const jitter = Math.sin(progress * Math.PI * 6) * envelope * 0.05
          wobble.position.x = -jitter
          wobble.position.z = -envelope * 0.18
          wobble.rotation.z = envelope * 0.14
          wobble.scale.set(1, 1 - envelope * 0.08, 1)
        } else if (beat.kind === 'attack' && !resolve_entity_action_clip(beat.entity.model?.clips ?? [], 'ATTACK')) {
          wobble.position.z = envelope * 0.26
        } else if (beat.kind === 'death' && !resolve_entity_action_clip(beat.entity.model?.clips ?? [], 'DEATH')) {
          wobble.scale.set(1, 1 - progress * 0.72, 1)
          wobble.rotation.z = progress * 0.35
        }
        if (progress < 1) return
        beats.delete(id)
        wobble.position.x = 0
        wobble.position.z = 0
        wobble.rotation.z = 0
        wobble.scale.set(1, 1, 1)
        if (beat.kind === 'death') {
          dead_entities.add(id)
          root.visible = false
        } else {
          const current = entities.get(id)
          if (current) play_clip(current, 'IDLE')
        }
        beat.resolve(true)
      })
      motions.forEach((motion, id) => {
        const root = motion.entity.object
        if (!root) return
        const elapsed = Math.max(0, now - motion.started_at)
        const segment = Math.min(motion.points.length - 2, Math.floor(elapsed / motion.cell_ms))
        const progress = Math.min(1, (elapsed - segment * motion.cell_ms) / motion.cell_ms)
        const from = motion.points[segment]!
        const to = motion.points[segment + 1]!
        root.position.lerpVectors(from, to, progress)
        // A slide is forced displacement: the entity keeps its facing and its current clip.
        if (motion.gait !== 'slide') root.rotation.y = Math.atan2(to.x - from.x, to.z - from.z)
        if (elapsed < (motion.points.length - 1) * motion.cell_ms) return
        motions.delete(id)
        if (motion.gait !== 'slide') {
          retained_facing.set(id, root.rotation.y)
          const current = entities.get(id)
          if (current) play_clip(current, 'IDLE')
        }
        motion.resolve(true)
      })
    },
    dispose: (): void => {
      const ids = [...entities.keys()]
      ids.forEach(remove)
      board = null
    },
  })
}
