// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// One entity lifecycle for terrain and fight boards. Callers provide identity, appearance, and an anchor;
// the engine alone owns model loading, animation, placement, and disposal.
import { AnimationMixer, LoopRepeat, type Scene } from 'three'

import { create_entity_model, type EntityModel } from './entity_model.ts'
import { BOARD_FLOOR_THICKNESS } from './fight_board_surface.ts'
import type { EntityRender, FightBoardRender, FightBoardRenderCell } from './types.ts'

type MountedEntity = Readonly<{
  spec: EntityRender
  appearance_key: string
  generation: number
  model: EntityModel | null
  mixer: AnimationMixer | null
}>

export type EntityModelLoader = (spec: EntityRender) => Promise<EntityModel>

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
}: Readonly<{ scene: Scene; load_model?: EntityModelLoader }>) => {
  const entities = new Map<string, MountedEntity>()
  let board: FightBoardRender | null = null
  let serial = 0
  let previous_tick = performance.now()

  const place = (entity: MountedEntity): void => {
    const root = entity.model?.root
    if (!root || !entity.model) return
    const { anchor } = entity.spec
    if (anchor.kind === 'world') {
      const [x, y, z] = anchor.position
      root.visible = true
      root.position.set(x, y - entity.model.min_y, z)
      root.rotation.y = facing_yaw(entity.spec, null, null)
      return
    }
    const cell = board?.cells.find(({ cell: candidate }) => candidate === anchor.cell)
    root.visible = Boolean(board && cell)
    if (!board || !cell) return
    root.position.set(
      board.origin.x + (cell.x + 0.5) * board.cell_size,
      board.origin.y + BOARD_FLOOR_THICKNESS - entity.model.min_y,
      board.origin.z + (cell.y + 0.5) * board.cell_size
    )
    root.rotation.y = facing_yaw(entity.spec, board, cell)
  }

  const remove = (id: string): void => {
    const entity = entities.get(id)
    if (!entity) return
    entities.delete(id)
    if (!entity.model) return
    scene.remove(entity.model.root)
    entity.mixer?.stopAllAction()
    entity.mixer?.uncacheRoot(entity.model.root)
    entity.model.dispose()
  }

  const mount = (spec: EntityRender): void => {
    const appearance_key = appearance_key_of(spec)
    const current = entities.get(spec.id)
    if (current?.appearance_key === appearance_key) {
      const next = Object.freeze({ ...current, spec })
      entities.set(spec.id, next)
      place(next)
      return
    }
    remove(spec.id)
    serial += 1
    const generation = serial
    entities.set(spec.id, Object.freeze({ spec, appearance_key, generation, model: null, mixer: null }))
    void load_model(spec).then(
      (model) => {
        const pending = entities.get(spec.id)
        if (!pending || pending.generation !== generation) {
          model.dispose()
          return
        }
        model.root.name = `entity:${spec.id}`
        const mixer = model.clips.length > 0 ? new AnimationMixer(model.root) : null
        const idle = model.clips.find(({ name }) => name.toUpperCase().includes('IDLE')) ?? model.clips[0]
        if (mixer && idle) mixer.clipAction(idle).setLoop(LoopRepeat, Infinity).play()
        const mounted = Object.freeze({ ...pending, model, mixer })
        entities.set(spec.id, mounted)
        scene.add(model.root)
        place(mounted)
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
      board = next
      entities.forEach(place)
    },
    set: (next: readonly EntityRender[]): void => {
      const wanted = new Set(next.map(({ id }) => id))
      entities.forEach((_, id) => {
        if (!wanted.has(id)) remove(id)
      })
      next.forEach(mount)
    },
    tick: (now: number): void => {
      const delta = Math.min(0.1, Math.max(0, now - previous_tick) / 1000)
      previous_tick = now
      entities.forEach(({ mixer }) => mixer?.update(delta))
    },
    dispose: (): void => {
      const ids = [...entities.keys()]
      ids.forEach(remove)
      board = null
    },
  })
}
