// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Authored-board contact sheet and dev-only 2D editor. Rendering stays plain HTML/SVG; edits
// enter the shared seed reducer and its validated autosave door.

import { ArrowLeft, Plus, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import boards_source from '../../../../seed/content/fight_boards.json'
import {
  BOARD_GRID_HEIGHT,
  BOARD_GRID_WIDTH,
  board_draft_from,
  board_from_draft,
  board_cell_kind,
  board_catalog_errors,
  create_empty_board,
  paint_board_cell,
  type AuthoredBoard,
  type BoardCellKind,
} from '../editor/board_editor.ts'
import type { JsonValue } from '../editor/seed_editor.ts'
import type { AppCopy } from '../i18n/copy.ts'
import { dispatch_app, useAppStore } from '../store.ts'

type BoardCatalog = Readonly<{ version: number; boards: readonly AuthoredBoard[] }>

const PREVIEW_CELL = 10
const fallback_catalog = boards_source as BoardCatalog
const CELL_KINDS = Object.freeze([
  'void',
  'floor',
  'obstacle',
  'start_a',
  'start_b',
] as const satisfies readonly BoardCellKind[])
const cell_styles: Readonly<Record<BoardCellKind, string>> = Object.freeze({
  void: 'border-dashed border-white/8 bg-bg',
  floor: 'border-white/12 bg-[#171b22]',
  obstacle: 'border-[#9f7a4e]/45 bg-[#5d4830]',
  hole: 'border-[#56606e]/45 bg-black shadow-[inset_0_0_8px_#000]',
  start_a: 'border-[#5fb9ff]/55 bg-[#2b8fdb]',
  start_b: 'border-[#ff7696]/55 bg-[#b13f5d]',
})
const preview_fill: Readonly<Record<Exclude<BoardCellKind, 'void'>, string>> = Object.freeze({
  floor: '#171b22',
  obstacle: '#5d4830',
  hole: '#030407',
  start_a: '#2b8fdb',
  start_b: '#b13f5d',
})

const MAX_EDITOR_CELL_SIZE = 38
export const fitted_board_cell_size = (width: number, height: number): number =>
  Math.max(1, Math.floor(Math.min(width / BOARD_GRID_WIDTH, height / BOARD_GRID_HEIGHT, MAX_EDITOR_CELL_SIZE)))

const cell_label = (text: AppCopy['demo_page'], kind: BoardCellKind): string =>
  text[`board_cell_${kind}`] ?? kind.replace('_', ' ')

const BoardPreview = ({ board }: Readonly<{ board: AuthoredBoard }>) => (
  <svg
    aria-hidden
    className="block aspect-square w-full bg-bg"
    viewBox={`0 0 ${board.width * PREVIEW_CELL} ${board.height * PREVIEW_CELL}`}
  >
    {Array.from({ length: board.height * BOARD_GRID_WIDTH }, (_, cell) => {
      if (cell % BOARD_GRID_WIDTH >= board.width) return null
      const kind = board_cell_kind(board, cell)
      return kind === 'void' ? null : (
        <rect
          fill={preview_fill[kind]}
          height={PREVIEW_CELL - 1}
          key={cell}
          stroke="#59616d"
          strokeOpacity="0.28"
          width={PREVIEW_CELL - 1}
          x={(cell % BOARD_GRID_WIDTH) * PREVIEW_CELL + 0.5}
          y={Math.floor(cell / BOARD_GRID_WIDTH) * PREVIEW_CELL + 0.5}
        />
      )
    })}
  </svg>
)

const status_label = (
  text: AppCopy['demo_page'],
  status: 'idle' | 'loading' | 'ready' | 'saving' | 'unavailable' | 'failed',
  dirty: boolean
): string => {
  if (status === 'loading' || status === 'idle') return text.board_loading
  if (status === 'saving') return text.board_saving
  if (status === 'unavailable' || status === 'failed') return text.board_read_only
  if (dirty) return text.board_unsaved
  return text.board_saved
}

export const BoardEditor = ({
  board,
  board_number,
  can_edit,
  can_delete,
  error,
  save_status,
  text,
  on_back,
  on_change,
  on_delete,
}: Readonly<{
  board: AuthoredBoard
  board_number: number
  can_edit: boolean
  can_delete: boolean
  error: string | null
  save_status: string
  text: AppCopy['demo_page']
  on_back: () => void
  on_change: (board: AuthoredBoard) => void
  on_delete: () => void
}>) => {
  const [tool, set_tool] = useState<BoardCellKind>('floor')
  const [draft, set_draft] = useState<AuthoredBoard>(() => board_draft_from(board))
  const draft_ref = useRef(draft)
  const [drawing, set_drawing] = useState(false)
  const [board_view, set_board_view] = useState<HTMLDivElement | null>(null)
  const [cell_size, set_cell_size] = useState(18)

  useEffect(() => {
    const stop_drawing = (): void => set_drawing(false)
    globalThis.addEventListener('pointerup', stop_drawing)
    globalThis.addEventListener('pointercancel', stop_drawing)
    return () => {
      globalThis.removeEventListener('pointerup', stop_drawing)
      globalThis.removeEventListener('pointercancel', stop_drawing)
    }
  }, [])

  useEffect(() => {
    if (!board_view) return undefined
    const fit = (): void => set_cell_size(fitted_board_cell_size(board_view.clientWidth, board_view.clientHeight))
    fit()
    const observer = new ResizeObserver(fit)
    observer.observe(board_view)
    return () => observer.disconnect()
  }, [board_view])

  const paint = (cell: number): void => {
    if (!can_edit) return
    const next = paint_board_cell(draft_ref.current, cell, tool)
    // eslint-disable-next-line functional/immutable-data -- a React ref retains the latest draft across batched pointer events.
    draft_ref.current = next
    set_draft(next)
    on_change(board_from_draft(next))
  }

  return (
    <div className="mx-auto flex min-h-full max-w-7xl flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-3 border border-white/10 bg-surface-low p-3">
        <div className="flex items-center gap-2">
          <button
            className="flex h-9 cursor-pointer items-center gap-2 border border-white/10 px-3 text-[8px] tracking-[0.14em] text-[#9096a0] uppercase hover:border-white/25 hover:text-[#e8e4dc] disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:border-white/10 disabled:hover:text-[#9096a0]"
            disabled={error !== null}
            onClick={on_back}
            type="button"
          >
            <ArrowLeft size={12} />
            {text.board_back}
          </button>
          <button
            className="flex h-9 cursor-pointer items-center gap-2 border border-[#ff5a8b]/25 bg-[#ff5a8b]/5 px-3 text-[8px] tracking-[0.14em] text-[#ff7da3] uppercase hover:border-[#ff5a8b]/55 hover:bg-[#ff5a8b]/10 disabled:cursor-not-allowed disabled:opacity-25"
            disabled={!can_delete}
            onClick={on_delete}
            type="button"
          >
            <Trash2 size={12} />
            {text.board_delete}
          </button>
        </div>
        <div className="text-center">
          <p className="text-[10px] tracking-[0.15em] text-[#d7b660] uppercase">
            {text.fight_board} #{board_number}
          </p>
          <p className="mt-1 text-[8px] text-[#68717e]">
            {text.board_draw_hint} · <span className="text-[#8b929d]">{save_status}</span>
          </p>
        </div>
        <div className="flex items-center gap-4 text-right text-[7px] tracking-[0.12em] uppercase">
          <span className="text-[#747b86]">
            {text.board_canvas}
            <strong className="ml-2 text-[9px] font-normal text-[#b8bec7]">
              {BOARD_GRID_WIDTH}×{BOARD_GRID_HEIGHT}
            </strong>
          </span>
          <span className="text-[#747b86]">
            {text.board_output}
            <strong className="ml-2 text-[9px] font-normal text-[#b8bec7]">
              {board.shape_mask.some((word) => BigInt(word) !== 0n) ? `${board.width}×${board.height}` : '—'}
            </strong>
          </span>
        </div>
      </header>
      <div
        aria-live="polite"
        className={`h-[68px] shrink-0 overflow-y-auto whitespace-pre-wrap border p-3 text-[9px] leading-5 ${
          error ? 'border-[#ff5a8b]/30 bg-[#ff5a8b]/6 text-[#ff8caa]' : 'invisible border-transparent text-transparent'
        }`}
      >
        {error ?? '\u00a0'}
      </div>

      <div className="grid flex-1 gap-4 lg:grid-cols-[180px_minmax(0,1fr)]">
        <aside className="h-fit border border-white/10 bg-surface-low p-3">
          <p className="mb-2 text-[7px] tracking-[0.16em] text-[#626975] uppercase">{text.board_cell_type}</p>
          <div className="grid gap-1.5">
            {CELL_KINDS.map((kind) => (
              <button
                aria-pressed={tool === kind}
                className={`flex h-9 cursor-pointer items-center gap-3 border px-2 text-left text-[8px] tracking-[0.1em] uppercase ${
                  tool === kind
                    ? 'border-[#d7b660]/55 bg-[#d7b660]/8 text-[#e8c878]'
                    : 'border-white/8 text-[#858c97] hover:border-white/20 hover:text-[#d5d2cb]'
                }`}
                key={kind}
                onClick={() => set_tool(kind)}
                type="button"
              >
                <span className={`size-4 shrink-0 border ${cell_styles[kind]}`} />
                {cell_label(text, kind)}
              </button>
            ))}
          </div>
        </aside>

        <div className="h-[calc(100vh-300px)] min-h-[240px] overflow-hidden border border-white/10 bg-bg p-4 sm:p-8">
          <div className="grid size-full place-items-center" ref={set_board_view}>
            <div
              className="grid touch-none select-none bg-white/5"
              onPointerLeave={() => set_drawing(false)}
              style={{
                gridAutoRows: `${cell_size}px`,
                gridTemplateColumns: `repeat(${BOARD_GRID_WIDTH}, ${cell_size}px)`,
              }}
            >
              {Array.from({ length: BOARD_GRID_WIDTH * BOARD_GRID_HEIGHT }, (_, index) => {
                const x = index % BOARD_GRID_WIDTH
                const y = Math.floor(index / BOARD_GRID_WIDTH)
                const cell = y * BOARD_GRID_WIDTH + x
                const kind = board_cell_kind(draft, cell)
                return (
                  <button
                    aria-label={`${x}, ${y}: ${cell_label(text, kind)}`}
                    className={`border ${cell_styles[kind]} ${
                      can_edit ? 'cursor-crosshair hover:brightness-125' : 'cursor-default'
                    }`}
                    key={cell}
                    onDragStart={(event) => event.preventDefault()}
                    onPointerDown={(event) => {
                      if (event.button !== 0) return
                      event.preventDefault()
                      set_drawing(true)
                      paint(cell)
                    }}
                    onPointerEnter={() => {
                      if (drawing) paint(cell)
                    }}
                    title={`${x}, ${y} · ${cell_label(text, kind)}`}
                    type="button"
                  />
                )
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export const BoardGallery = ({ text }: Readonly<{ text: AppCopy['demo_page'] }>) => {
  const editor = useAppStore((state) => state.editor)
  const [selected_index, set_selected_index] = useState<number | null>(null)
  const file = editor.files.fight_boards
  const catalog = (file?.value as unknown as BoardCatalog | undefined) ?? fallback_catalog
  const { boards } = catalog
  const selected_board = selected_index === null ? null : boards[selected_index]
  const local_error = board_catalog_errors(boards).join('\n') || null
  const visible_error = local_error ?? editor.error
  const can_edit = import.meta.env.DEV && !!file && ['ready', 'saving'].includes(editor.status)

  const replace_boards = (next: readonly AuthoredBoard[]): void => {
    if (!can_edit) return
    dispatch_app({
      type: 'editor/value_changed',
      domain: 'fight_boards',
      path: Object.freeze(['boards']),
      value: Object.freeze(next) as unknown as JsonValue,
    })
  }
  const update_board = (index: number, board: AuthoredBoard): void =>
    replace_boards(
      Object.freeze(boards.map((candidate, candidate_index) => (candidate_index === index ? board : candidate)))
    )
  const add_board = (): void => {
    const index = boards.length
    replace_boards(Object.freeze([...boards, create_empty_board()]))
    set_selected_index(index)
  }
  const delete_board = (index: number): void => {
    if (!can_edit || boards.length <= 1) return
    replace_boards(Object.freeze(boards.filter((_, candidate_index) => candidate_index !== index)))
    set_selected_index(null)
  }

  return (
    <section className="absolute inset-0 overflow-y-auto bg-bg px-6 pt-20 pb-10">
      {selected_board && selected_index !== null ? (
        <BoardEditor
          board={selected_board}
          board_number={selected_index + 1}
          can_delete={can_edit && boards.length > 1}
          can_edit={can_edit}
          error={visible_error}
          on_back={() => set_selected_index(null)}
          on_change={(board) => update_board(selected_index, board)}
          on_delete={() => delete_board(selected_index)}
          save_status={status_label(text, editor.status, file?.dirty ?? false)}
          text={text}
          key={selected_index}
        />
      ) : (
        <div className="mx-auto max-w-7xl">
          <header className="mb-4 flex items-center justify-between gap-3 border-b border-white/8 pb-3">
            <div>
              <p className="text-[10px] tracking-[0.16em] text-[#d7b660] uppercase">{text.fight_board}</p>
              {import.meta.env.DEV && (
                <p className="mt-1 text-[8px] text-[#626975]">
                  {status_label(text, editor.status, file?.dirty ?? false)}
                </p>
              )}
            </div>
            {import.meta.env.DEV && (
              <button
                className="flex h-9 cursor-pointer items-center gap-2 border border-[#4a9eff]/35 bg-[#4a9eff]/7 px-3 text-[8px] tracking-[0.14em] text-[#67adff] uppercase hover:border-[#4a9eff]/65 disabled:cursor-not-allowed disabled:opacity-35"
                disabled={!can_edit}
                onClick={add_board}
                type="button"
              >
                <Plus size={12} />
                {text.board_new}
              </button>
            )}
          </header>
          {visible_error && (
            <div className="mb-4 whitespace-pre-wrap border border-[#ff5a8b]/30 bg-[#ff5a8b]/6 p-3 text-[9px] leading-5 text-[#ff8caa]">
              {visible_error}
            </div>
          )}
          <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-4">
            {boards.map((board, index) => (
              <article className="border border-white/10 bg-surface-low p-2" key={index}>
                <button
                  className="block w-full cursor-pointer text-left hover:brightness-125"
                  onClick={() => set_selected_index(index)}
                  type="button"
                >
                  <BoardPreview board={board} />
                  <span className="mt-2 flex items-center justify-between text-[8px] tracking-[0.12em] uppercase">
                    <span className="text-[#d7b660]">
                      {text.fight_board} #{index + 1}
                    </span>
                    <span className="text-[#68717e]">
                      {board.width}×{board.height}
                    </span>
                  </span>
                </button>
              </article>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}
