// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The one fight viewport. Every mode supplies canonical fight state; this component owns shared pixels,
// picking, and the production fight camera without knowing whether the fight is remote or local.
/* eslint-disable functional/immutable-data, functional/prefer-immutable-types -- React refs and DOM events are mutable lifecycle boundaries. */

import type {
  EngineQuality,
  EntityRender,
  EntityScreenAnchor,
  FightBlobSpec,
  FightBoardRender,
  FightPresentationCue,
} from '@aresrpg/engine'
import { fight_placement_blobs } from '@aresrpg/engine'
import { project_board_cells, type FightBoard } from '@aresrpg/fight'
import { useEffect, useMemo, useRef } from 'react'

import { create_fight_view } from './fight_view.ts'
import { create_fight_presenter } from './fight_presenter.ts'
import type { FightCuePhase } from './fight_presenter.ts'

const CELL_SIZE = 1.33
const BOARD_Y = 0
const EMPTY_ENTITIES: readonly EntityRender[] = Object.freeze([])

export type FightBlobOverlay = Readonly<{ id: string; blob: FightBlobSpec }>

export const fight_board_render = (board: Readonly<FightBoard>): FightBoardRender => {
  const width = Number(board.width)
  const height = Number(board.height)
  return Object.freeze({
    width,
    height,
    cell_size: CELL_SIZE,
    origin: Object.freeze({ x: -(width * CELL_SIZE) / 2, y: BOARD_Y, z: -(height * CELL_SIZE) / 2 }),
    show_start_cells: false,
    cells: Object.freeze(
      project_board_cells(board).map(({ cell, ...projected }) => Object.freeze({ ...projected, cell: Number(cell) }))
    ),
  })
}

export const fight_placement_overlays = fight_placement_blobs

export const FightViewport = ({
  board,
  board_key,
  quality,
  label,
  on_cell_click,
  on_cell_hover,
  on_entity_anchors,
  tracked_entity_ids = Object.freeze([]),
  blob_request,
  blob_overlays = Object.freeze([]),
  presentation_request,
  on_presentation_cue,
  show_start_cells = true,
  entities = EMPTY_ENTITIES,
}: Readonly<{
  board: FightBoard
  board_key: string
  quality: EngineQuality
  label: string
  on_cell_click?: (cell: bigint, pointer: Readonly<{ x: number; y: number }>) => void
  on_cell_hover?: (cell: bigint | null) => void
  on_entity_anchors?: (anchors: Readonly<Record<string, EntityScreenAnchor>>) => void
  tracked_entity_ids?: readonly string[]
  blob_request?: Readonly<{ sequence: number; blob: FightBlobSpec }> | null
  blob_overlays?: readonly FightBlobOverlay[]
  on_presentation_cue?: (cue: FightPresentationCue, phase: FightCuePhase) => void
  presentation_request?: Readonly<{
    batch: number
    cues: readonly FightPresentationCue[]
    presented: () => void
  }> | null
  show_start_cells?: boolean
  entities?: readonly EntityRender[]
}>) => {
  const canvas_ref = useRef<HTMLCanvasElement | null>(null)
  const view_ref = useRef<ReturnType<typeof create_fight_view> | null>(null)
  const presenter_ref = useRef<ReturnType<typeof create_fight_presenter> | null>(null)
  const initial_quality_ref = useRef(quality)
  const click_ref = useRef(on_cell_click)
  const hover_ref = useRef(on_cell_hover)
  const pointer_ref = useRef<Readonly<{ x: number; y: number }> | null>(null)
  const hovered_cell_ref = useRef<number | null>(null)
  const cue_observer_ref = useRef(on_presentation_cue)
  const presentation_request_ref = useRef(presentation_request)
  const anchors_ref = useRef(on_entity_anchors)
  // A fight board is immutable under its contract ID. Checkpoint reducers clone it, so depending
  // on object identity would rebuild GPU geometry after every command.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- board_key is the board's domain identity.
  const render_board = useMemo(() => fight_board_render(board), [board_key])
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
  anchors_ref.current = on_entity_anchors
  const tracked_ids = tracked_entity_ids.join('\u0000')

  useEffect(() => {
    const canvas = canvas_ref.current
    if (!canvas) return undefined
    const view = create_fight_view(canvas, initial_quality_ref.current)
    view_ref.current = view
    const publish_hover = (cell: number | null): void => {
      if (cell === hovered_cell_ref.current) return
      hovered_cell_ref.current = cell
      hover_ref.current?.(cell === null ? null : BigInt(cell))
    }
    presenter_ref.current = create_fight_presenter({
      play: view.play_fight_cue,
      observe: (cue, phase) => cue_observer_ref.current?.(cue, phase),
    })
    const click = (event: MouseEvent): void => {
      if (event.button !== 0) return
      const cell = view.pick_cell(event.clientX, event.clientY)
      if (cell !== null) click_ref.current?.(BigInt(cell), { x: event.clientX, y: event.clientY })
    }
    const move = (event: MouseEvent): void => {
      pointer_ref.current = Object.freeze({ x: event.clientX, y: event.clientY })
      publish_hover(view.pick_cell(event.clientX, event.clientY))
    }
    const leave = (): void => {
      pointer_ref.current = null
      publish_hover(null)
    }
    canvas.addEventListener('click', click)
    canvas.addEventListener('mousemove', move)
    canvas.addEventListener('mouseleave', leave)
    return () => {
      canvas.removeEventListener('click', click)
      canvas.removeEventListener('mousemove', move)
      canvas.removeEventListener('mouseleave', leave)
      pointer_ref.current = null
      hovered_cell_ref.current = null
      view_ref.current = null
      presenter_ref.current?.dispose()
      presenter_ref.current = null
      view.dispose()
    }
  }, [])

  useEffect(() => {
    view_ref.current?.set_quality(quality)
  }, [quality])

  useEffect(() => {
    view_ref.current?.set_board(render_board)
  }, [render_board])

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
  }, [render_board, rendered_overlays])

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
  }, [entities])

  useEffect(() => {
    const presenter = presenter_ref.current
    const request = presentation_request_ref.current
    if (!presenter || !request) return
    presenter.present(request.cues)
    request.presented()
  }, [presentation_request?.batch])

  useEffect(() => {
    const ids = tracked_ids ? tracked_ids.split('\u0000') : []
    let frame = 0
    let previous = ''
    const project = (): void => {
      const view = view_ref.current
      const pointer = pointer_ref.current
      const hovered = pointer && view ? view.pick_cell(pointer.x, pointer.y) : null
      if (hovered !== hovered_cell_ref.current) {
        hovered_cell_ref.current = hovered
        hover_ref.current?.(hovered === null ? null : BigInt(hovered))
      }
      if (ids.length > 0) {
        const anchors = Object.freeze(
          Object.fromEntries(
            ids.flatMap((id) => {
              const anchor = view?.project_entity(id)
              return anchor ? [[id, anchor] as const] : []
            })
          )
        )
        const signature = JSON.stringify(anchors)
        if (signature !== previous) {
          previous = signature
          anchors_ref.current?.(anchors)
        }
      }
      frame = requestAnimationFrame(project)
    }
    if (ids.length === 0) anchors_ref.current?.(Object.freeze({}))
    frame = requestAnimationFrame(project)
    return () => cancelAnimationFrame(frame)
  }, [tracked_ids])

  useEffect(() => {
    if (blob_request) view_ref.current?.create_blob(blob_request.blob)
  }, [blob_request])

  return (
    <canvas
      aria-label={label}
      className="absolute inset-0 size-full touch-none"
      data-fight-viewport=""
      ref={canvas_ref}
    />
  )
}
