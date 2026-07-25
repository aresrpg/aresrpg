// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// simulator/BoardPane.tsx — the board region of /simulator (spec §7 + §9 flows 4–6).
//
// A drop-in with no props: it reads the ONE page store, derives the board from (seed, reroll nonce), and
// hands the pure fold's scene to the viewport. Clicks come back as raw cells and go straight through
// `cell_intent_of` into the reducer door — this component holds no board truth of its own, which is why a
// reload, a reroll and a deleted character all reconcile with no special case here.
//
// THE BOARD IS THE DOOR (#883). Every seat is edited where it stands: an empty start cell opens its picker
// AT the cell (characters get the roster popover, mobs the seat modal), an occupied one empties it. The
// panels beside the board are a roster and a read-out, never a second placement surface — so this pane owns
// no roster list of its own either; the mob line-up it used to print underneath is the right panel's job.
//
// Split in two on purpose: `BoardPaneView` is presentation over explicit props (provable with
// react-dom/server, no jsdom), and `SimulatorBoardPane` is the store + engine wiring around it.
//
// The engine is loaded LAZILY (dynamic import in the mount effect): it is by far the heaviest module in the
// app, and a page that has never opened this pane should not pay for it — nor should a bun test that renders
// the page shell (the tactical facade pulls a GLB the public repo does not ship).

import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import { Dices } from 'lucide-react'
import { encode } from '@aresrpg/fight/los'

import { board_of, type SimBoard } from './board'
import { cell_intent_of, setup_scene_of } from './board_paint'
import { CharacterPicker } from './CharacterPicker'
import { MobModal } from './MobModal'
import { use_mob_index } from './MobPicker'
import { use_simulator } from './store'

const GOLD = '#c8963c'
const HAIRLINE = '1px solid rgba(255,255,255,0.06)'
const micro = 'text-[9px] tracking-[0.22em] uppercase'

type ViewportHandle = {
  show: (board: unknown, scene: unknown) => Promise<void>
  /** the board reports a MISS as `null` (contract v1.2) — a click into the void is an event, not silence */
  on_cell_click: (cb: (cell: { x: number; y: number } | null) => void) => () => void
  destroy: () => void
}

export function BoardPaneView({
  board,
  canvas_ref,
  on_reroll,
}: Readonly<{
  board: SimBoard
  canvas_ref?: RefObject<HTMLCanvasElement | null>
  on_reroll: () => void
}>) {
  const { t } = useTranslation()
  return (
    <div className="flex-1 min-h-0 flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <span className={`${micro} text-muted`}>
          {t('simulator.board_size', { width: board.width, height: board.height })}
        </span>
        <span className={`${micro} text-muted`}>
          {t('simulator.anchor')} {board.anchor.x},{board.anchor.z}
        </span>
        <button
          type="button"
          className={`${micro} flex items-center gap-1 px-2 py-1 cursor-pointer`}
          style={{ border: `1px solid ${GOLD}`, color: GOLD }}
          onClick={on_reroll}
        >
          <Dices size={12} />
          {t('simulator.reroll_board')}
        </button>
      </div>

      <div className="relative flex-1 min-h-[220px]" style={{ border: HAIRLINE, background: '#0c0c14' }}>
        <canvas ref={canvas_ref} className="absolute inset-0 w-full h-full block" />
      </div>

      <p className={`${micro} text-muted`}>{t('simulator.board_hint')}</p>
    </div>
  )
}

export function SimulatorBoardPane() {
  const canvas_ref = useRef<HTMLCanvasElement | null>(null)
  // The viewport is STATE, not a ref, on purpose: the engine module is imported lazily, so it lands one or
  // more renders AFTER the first board+scene exist. A ref would leave that first show() falling into a null
  // viewport and the board would only appear on the next change (measured: nothing until a reroll). As a
  // dependency of the show effect below, the very existence of the viewport re-triggers the paint.
  const [viewport, set_viewport] = useState<ViewportHandle | null>(null)
  const [mob_cell, set_mob_cell] = useState<number | null>(null)
  /** the ally cell being seated, with the pointer position its picker opens at */
  const [ally_pick, set_ally_pick] = useState<{ cell: number; x: number; y: number } | null>(null)
  // WHERE the click happened. The board reports a CELL, not a pixel (it is a renderer-neutral contract), so
  // the pointer position the popover anchors to is read off the canvas' own pointer event — the same gesture,
  // one frame earlier.
  const pointer = useRef({ x: 0, y: 0 })

  const { seed, anchor_nonce, roster, placements, mob_picks, phase, input } = use_simulator()
  const board = useMemo(() => board_of(seed, anchor_nonce), [seed, anchor_nonce])

  // The corpus is a boot-time blob: an empty index simply means it has not landed (or is unpublished).
  const mob_of = use_mob_index()
  const scene = useMemo(
    () =>
      setup_scene_of(board, {
        roster,
        placements,
        mob_picks,
        mob_name_of: (template_id) => mob_of.get(template_id)?.name ?? template_id,
      }),
    [board, roster, placements, mob_picks, mob_of]
  )

  // The LIVE state the click handler must read — a handler captured at mount would seat a stale board.
  const click_state = useRef({ board, placements, phase })
  click_state.current = { board, placements, phase }

  // ONE mount per page visit; the engine is disposed on unmount (never the world session's singleton).
  useEffect(() => {
    let live = true
    let handle: ViewportHandle | null = null
    let unsubscribe: (() => void) | null = null
    const canvas = canvas_ref.current
    if (!canvas) return undefined
    const track = (event: PointerEvent) => {
      pointer.current = { x: event.clientX, y: event.clientY }
    }
    canvas.addEventListener('pointerdown', track)
    void import('./mount.js').then(({ create_board_viewport }) => {
      if (!live) return
      handle = create_board_viewport({ canvas }) as ViewportHandle
      unsubscribe = handle.on_cell_click((cell) => {
        // A click that hit no cell (the void around the board) — the engine reports the miss so a dapp can
        // deselect on it; this page has nothing to deselect, so it is simply not an interaction.
        if (!cell) return
        const { x, y } = cell
        const { current } = click_state
        // SETUP ONLY. Once a fight is live the production surface owns every board input; a setup gesture
        // reaching this handler would edit a line-up the sim has already snapshotted.
        if (current.phase !== 'setup') return
        const intent = cell_intent_of(current.board, current, encode(x, y))
        if (!intent) return
        if (intent.type === 'mob_cell') set_mob_cell(intent.cell)
        else if (intent.type === 'ally_cell') set_ally_pick({ cell: intent.cell, ...pointer.current })
        else input({ type: 'character_unplaced', cell: intent.cell })
      })
      set_viewport(handle)
    })
    return () => {
      live = false
      canvas.removeEventListener('pointerdown', track)
      unsubscribe?.()
      handle?.destroy()
      set_viewport(null)
    }
  }, [input])

  // Every board/scene change re-shows — and so does the viewport's own arrival. The mount re-bakes the
  // geometry only when the BOARD itself changed; anything else is a repaint.
  useEffect(() => {
    void viewport?.show(board, scene)
  }, [viewport, board, scene])

  return (
    <>
      <BoardPaneView board={board} canvas_ref={canvas_ref} on_reroll={() => input({ type: 'board_rerolled' })} />
      {ally_pick && (
        <CharacterPicker
          roster={roster}
          placements={placements}
          at={ally_pick}
          on_close={() => set_ally_pick(null)}
          on_pick={(id) => {
            input({ type: 'character_placed', cell: ally_pick.cell, id })
            set_ally_pick(null)
          }}
        />
      )}
      {/* The mob seat's own editor — which mob, at what level. It opens its picker itself when the seat is
          still empty, so a red cell is one click from a line-up whether or not it already holds one. */}
      {mob_cell !== null && (
        <MobModal
          key={mob_cell}
          cell={mob_cell}
          pick={mob_picks[mob_cell] ?? null}
          on_close={() => set_mob_cell(null)}
        />
      )}
    </>
  )
}
