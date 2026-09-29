// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The one fight viewport. Every mode supplies canonical fight state; this component owns shared pixels,
// picking, and the production fight camera without knowing whether the fight is remote or local.
/* eslint-disable functional/immutable-data, functional/prefer-immutable-types -- React refs and DOM events are mutable lifecycle boundaries. */

import type {
  EngineQuality,
  EntityRender,
  FightBlobSpec,
  FightBoardRender,
  FightPresentationCue,
} from '@aresrpg/engine'
import { fight_placement_blobs } from '@aresrpg/engine'
import { project_board_cells, type FightBoard } from '@aresrpg/fight'
import { useEffect, useMemo, useRef } from 'react'

import { claim_scene_entities, type SceneHandle } from '../core/scene_feed.ts'
import { create_fight_presenter } from './fight_presenter.ts'
import type { FightBlobOverlay } from './fight_overlays.ts'
import type { FightCuePhase } from './fight_presenter.ts'

import { board_pointer_taps, move_board_pointer, type BoardPointer } from './board_pointer.ts'

const CELL_SIZE = 1.33
const BOARD_Y = 0
// One block of clearance above the ground it is laid on: the arena reads as a built platform
// standing ON the world rather than tiles painted into the dirt, and the terrain it covers
// passes cleanly underneath instead of fighting the slab for the same depth.
const BOARD_LIFT = 1
const EMPTY_ENTITIES: readonly EntityRender[] = Object.freeze([])

/** `anchor` is where the fight STANDS in the world — the chain's own coordinates, grounded on
 *  the terrain there. The board is laid centred on it, so the arena appears exactly where the
 *  challenge was thrown. Absent (the simulator's synthetic board), it falls back to the origin. */
export const fight_board_render = (
  board: Readonly<FightBoard>,
  anchor: Readonly<{ x: number; y: number; z: number }> = { x: 0, y: BOARD_Y, z: 0 }
): FightBoardRender => {
  const width = Number(board.width)
  const height = Number(board.height)
  return Object.freeze({
    width,
    height,
    cell_size: CELL_SIZE,
    origin: Object.freeze({
      x: anchor.x - (width * CELL_SIZE) / 2,
      y: anchor.y,
      z: anchor.z - (height * CELL_SIZE) / 2,
    }),
    show_start_cells: false,
    cells: Object.freeze(
      project_board_cells(board).map(({ cell, ...projected }) => Object.freeze({ ...projected, cell: Number(cell) }))
    ),
  })
}

export const grounded_fight_board = (
  board: Readonly<FightBoard>,
  ground: (x: number, z: number) => number,
  anchor: Readonly<{ x: number; y?: number; z: number }> | null
): FightBoardRender => {
  const point = anchor ?? { x: 0, z: 0 }
  return fight_board_render(board, { ...point, y: (point.y ?? ground(point.x, point.z)) + BOARD_LIFT })
}

export const fight_placement_overlays = fight_placement_blobs

/** Immersive fights claim the scene; nearby boards append fighters to its world inhabitants.
 * Disposing releases only the entities and board owned by this surface. */
export const scene_fight_view = (scene: SceneHandle, ambient = false) => {
  if (!ambient) claim_scene_entities('fight')
  return Object.freeze({
    set_board: (board: FightBoardRender) => scene.show_fight_board({ ...board, ambient }),
    // entities draw into the scene THIS viewport was handed — the claim above only silences the
    // game world's other source. A stage world (the demo lab) is not the published scene, so a
    // feed-routed write would land in the void while the board mounts here.
    set_entities: (entities: readonly EntityRender[]) =>
      ambient ? scene.set_nearby_entities(entities) : scene.set_entities(entities),
    animate_entity: scene.animate_entity,
    play_fight_cue: scene.play_fight_cue,
    project_entity: scene.project_entity,
    create_blob: scene.create_fight_blob,
    update_blob: scene.update_fight_blob,
    remove_blob: scene.remove_fight_blob,
    pick_cell: scene.pick_fight_cell,
    dispose: (): void => {
      scene.show_fight_board(null)
      if (ambient) scene.set_nearby_entities(Object.freeze([]))
      else {
        scene.set_entities(Object.freeze([]))
        claim_scene_entities('world')
      }
    },
  })
}

export const FightViewport = ({
  ambient,
  board,
  board_key,
  quality,
  label,
  on_cell_click,
  on_cell_hover,
  blob_request,
  blob_overlays = Object.freeze([]),
  presentation_request,
  on_presentation_cue,
  on_presentation_active,
  show_start_cells = true,
  entities = EMPTY_ENTITIES,
  world_anchor = null,
  scene,
}: Readonly<{
  ambient?: boolean
  board: FightBoard
  board_key: string
  quality: EngineQuality
  label: string
  on_cell_click?: (cell: bigint | null, pointer: Readonly<{ x: number; y: number; pointer_type?: string }>) => void
  on_cell_hover?: (cell: bigint | null) => void
  blob_request?: Readonly<{ sequence: number; blob: FightBlobSpec }> | null
  blob_overlays?: readonly FightBlobOverlay[]
  on_presentation_cue?: (cue: FightPresentationCue, phase: FightCuePhase) => void
  on_presentation_active?: (active: boolean) => void
  presentation_request?: Readonly<{
    fight: string
    batch: number
    cues: readonly FightPresentationCue[]
    presented: () => void
  }> | null
  show_start_cells?: boolean
  entities?: readonly EntityRender[]
  /** the fight's world position in CLIENT coordinates — null keeps the board at the origin */
  world_anchor?: Readonly<{ x: number; y?: number; z: number }> | null
  /** THE WORLD THIS BOARD IS MOUNTED IN, handed over by its owner. Not looked up: a surface that
   *  could find "the live scene" on its own will eventually draw into somebody else's. */
  scene: SceneHandle
}>) => {
  const view_ref = useRef<ReturnType<typeof scene_fight_view> | null>(null)
  const presenter_ref = useRef<ReturnType<typeof create_fight_presenter> | null>(null)
  const initial_quality_ref = useRef(quality)
  const click_ref = useRef(on_cell_click)
  const hover_ref = useRef(on_cell_hover)
  const hovered_cell_ref = useRef<number | null>(null)
  const cue_observer_ref = useRef(on_presentation_cue)
  const presentation_request_ref = useRef(presentation_request)
  const presentation_active_ref = useRef(on_presentation_active)
  // A fight board is immutable under its contract ID. Checkpoint reducers clone it, so depending
  // on object identity would rebuild GPU geometry after every command.
  const anchor_key = world_anchor ? `${world_anchor.x}:${world_anchor.y}:${world_anchor.z}` : ''
  const render_board = useMemo(
    () => grounded_fight_board(board, scene.ground_height, world_anchor),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- board_key + the anchor are the board's domain identity.
    [board_key, anchor_key, scene]
  )
  const rendered_overlays = useMemo(
    () => Object.freeze([...fight_placement_overlays(render_board, show_start_cells), ...blob_overlays]),
    [blob_overlays, render_board, show_start_cells]
  )
  const overlay_ids_ref = useRef(new Map<string, Readonly<{ engine_id: string; signature: string }>>())
  const overlay_board_ref = useRef(render_board)
  click_ref.current = on_cell_click
  hover_ref.current = on_cell_hover
  cue_observer_ref.current = on_presentation_cue
  presentation_request_ref.current = presentation_request
  presentation_active_ref.current = on_presentation_active

  useEffect(() => {
    // Both board presentations share the live world's renderer and entity lifecycle.
    const view = scene_fight_view(scene, ambient)
    view_ref.current = view
    // a freshly mounted scene holds none of our GPU blobs — the bookkeeping starts empty or the
    // overlay pass would try to update ids that no longer exist
    overlay_ids_ref.current = new Map()
    const publish_hover = (cell: number | null): void => {
      if (cell === hovered_cell_ref.current) return
      hovered_cell_ref.current = cell
      hover_ref.current?.(cell === null ? null : BigInt(cell))
    }
    presenter_ref.current = create_fight_presenter({
      play: view.play_fight_cue,
      observe: (cue, phase) => cue_observer_ref.current?.(cue, phase),
    })
    const dispose = (): void => {
      hovered_cell_ref.current = null
      view_ref.current = null
      presenter_ref.current?.dispose()
      presenter_ref.current = null
      view.dispose()
    }
    if (ambient) return dispose
    // the board draws on the WORLD's canvas, which this surface does not own — so pointer work
    // rides the document and answers only for events that landed on that canvas. Anything over
    // the HUD is the HUD's, and the world's own controls are inert outside follow mode.
    const on_board = (event: MouseEvent): boolean => event.target === scene.canvas
    const click = (event: MouseEvent): void => {
      if ((event as PointerEvent).pointerType === 'touch' || event.button !== 0 || !on_board(event)) return
      const cell = view.pick_cell(event.clientX, event.clientY)
      click_ref.current?.(cell === null ? null : BigInt(cell), {
        x: event.clientX,
        y: event.clientY,
        pointer_type: 'mouse',
      })
    }
    const move = (event: MouseEvent): void => {
      publish_hover(on_board(event) ? view.pick_cell(event.clientX, event.clientY) : null)
    }
    let touch: BoardPointer | null = null
    const touch_down = (event: PointerEvent): void => {
      if (event.pointerType !== 'touch' || !on_board(event)) return
      touch = touch
        ? { ...touch, dragged: true }
        : { id: event.pointerId, x: event.clientX, y: event.clientY, dragged: false }
    }
    const touch_move = (event: PointerEvent): void => {
      if (touch) touch = move_board_pointer(touch, event.pointerId, event.clientX, event.clientY)
    }
    const touch_up = (event: PointerEvent): void => {
      if (!touch || touch.id !== event.pointerId) return
      const taps = board_pointer_taps(touch, event.pointerId, event.clientX, event.clientY)
      touch = null
      if (!taps || !on_board(event)) return
      const cell = view.pick_cell(event.clientX, event.clientY)
      click_ref.current?.(cell === null ? null : BigInt(cell), {
        x: event.clientX,
        y: event.clientY,
        pointer_type: 'touch',
      })
    }
    const touch_cancel = (): void => {
      touch = null
    }
    globalThis.addEventListener('pointerdown', touch_down)
    globalThis.addEventListener('pointermove', touch_move)
    globalThis.addEventListener('pointerup', touch_up)
    globalThis.addEventListener('pointercancel', touch_cancel)
    globalThis.addEventListener('blur', touch_cancel)
    globalThis.addEventListener('click', click)
    globalThis.addEventListener('mousemove', move)
    return () => {
      globalThis.removeEventListener('pointerdown', touch_down)
      globalThis.removeEventListener('pointermove', touch_move)
      globalThis.removeEventListener('pointerup', touch_up)
      globalThis.removeEventListener('pointercancel', touch_cancel)
      globalThis.removeEventListener('blur', touch_cancel)
      globalThis.removeEventListener('click', click)
      globalThis.removeEventListener('mousemove', move)
      dispose()
    }
  }, [scene, ambient])

  useEffect(() => {
    view_ref.current?.set_board(render_board)
    // `scene` is a dependency on purpose: its owner may hand over a different world,
    // so without it this effect never fires again and no board is ever mounted
  }, [render_board, scene])

  useEffect(() => {
    const view = view_ref.current
    if (!view) return
    if (overlay_board_ref.current !== render_board) {
      overlay_ids_ref.current.forEach(({ engine_id }) => view.remove_blob(engine_id))
      overlay_ids_ref.current = new Map()
      overlay_board_ref.current = render_board
    }
    const next = new Map<string, Readonly<{ engine_id: string; signature: string }>>()
    rendered_overlays.forEach(({ id, blob }) => {
      const signature = JSON.stringify(blob)
      const current = overlay_ids_ref.current.get(id)
      if (!current) {
        next.set(id, Object.freeze({ engine_id: view.create_blob(blob), signature }))
        return
      }
      const engine_id =
        current.signature !== signature && !view.update_blob(current.engine_id, blob)
          ? view.create_blob(blob)
          : current.engine_id
      next.set(id, Object.freeze({ engine_id, signature }))
    })
    overlay_ids_ref.current.forEach(({ engine_id }, id) => {
      if (!next.has(id)) view.remove_blob(engine_id)
    })
    overlay_ids_ref.current = next
  }, [render_board, rendered_overlays, scene])

  useEffect(
    () => () => {
      const view = view_ref.current
      if (view) overlay_ids_ref.current.forEach(({ engine_id }) => view.remove_blob(engine_id))
      overlay_ids_ref.current = new Map()
    },
    []
  )

  useEffect(() => {
    view_ref.current?.set_entities(entities)
  }, [entities, scene])

  useEffect(() => {
    const presenter = presenter_ref.current
    const request = presentation_request_ref.current
    if (!presenter || !request) return
    let current = true
    presentation_active_ref.current?.(true)
    void presenter.present(request.cues).then(() => {
      if (!current) return
      presentation_active_ref.current?.(false)
      request.presented()
    })
    return () => {
      current = false
    }
  }, [presentation_request?.fight, presentation_request?.batch])

  useEffect(() => {
    if (blob_request) view_ref.current?.create_blob(blob_request.blob)
  }, [blob_request])

  // no canvas of its own: the board lives on the world's, so this surface renders only the
  // accessible name for the board it mounted there
  return <span aria-label={label} className="sr-only" data-fight-viewport="" role="img" />
}
