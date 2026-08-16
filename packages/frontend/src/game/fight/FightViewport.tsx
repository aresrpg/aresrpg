// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The one fight viewport. Every mode supplies canonical fight state; this component owns shared pixels,
// picking, and the production fight camera without knowing whether the fight is remote or local.
/* eslint-disable functional/immutable-data, functional/prefer-immutable-types -- React refs and DOM events are mutable lifecycle boundaries. */

import type { EngineQuality, EntityRender, FightBlobSpec, FightBoardRender } from '@aresrpg/engine'
import { project_board_cells, type FightBoard } from '@aresrpg/fight'
import { useEffect, useMemo, useRef } from 'react'

import { create_fight_view } from './fight_view.ts'

const CELL_SIZE = 1.33
const BOARD_Y = 0
const EMPTY_ENTITIES: readonly EntityRender[] = Object.freeze([])

export const fight_board_render = (board: Readonly<FightBoard>): FightBoardRender => {
  const width = Number(board.width)
  const height = Number(board.height)
  return Object.freeze({
    width,
    height,
    cell_size: CELL_SIZE,
    origin: Object.freeze({ x: -(width * CELL_SIZE) / 2, y: BOARD_Y, z: -(height * CELL_SIZE) / 2 }),
    cells: Object.freeze(
      project_board_cells(board).map(({ cell, ...projected }) => Object.freeze({ ...projected, cell: Number(cell) }))
    ),
  })
}

export const FightViewport = ({
  board,
  quality,
  label,
  on_cell_click,
  blob_request,
  entities = EMPTY_ENTITIES,
}: Readonly<{
  board: FightBoard
  quality: EngineQuality
  label: string
  on_cell_click?: (cell: bigint, pointer: Readonly<{ x: number; y: number }>) => void
  blob_request?: Readonly<{ sequence: number; blob: FightBlobSpec }> | null
  entities?: readonly EntityRender[]
}>) => {
  const canvas_ref = useRef<HTMLCanvasElement | null>(null)
  const view_ref = useRef<ReturnType<typeof create_fight_view> | null>(null)
  const initial_quality_ref = useRef(quality)
  const click_ref = useRef(on_cell_click)
  click_ref.current = on_cell_click
  const render_board = useMemo(() => fight_board_render(board), [board])

  useEffect(() => {
    const canvas = canvas_ref.current
    if (!canvas) return undefined
    const view = create_fight_view(canvas, initial_quality_ref.current)
    view_ref.current = view
    const click = (event: MouseEvent): void => {
      if (event.button !== 0) return
      const cell = view.pick_cell(event.clientX, event.clientY)
      if (cell !== null) click_ref.current?.(BigInt(cell), { x: event.clientX, y: event.clientY })
    }
    canvas.addEventListener('click', click)
    return () => {
      canvas.removeEventListener('click', click)
      view_ref.current = null
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
    view_ref.current?.set_entities(entities)
  }, [entities])

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
