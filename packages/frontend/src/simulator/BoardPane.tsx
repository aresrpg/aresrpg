// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// simulator/BoardPane.tsx — the board region of /simulator (spec §7 + §9 flows 4–6).
//
// A drop-in with no props: it reads the ONE page store, derives the board from (seed, reroll nonce), and
// hands the pure fold's scene to the viewport. Clicks come back as raw cells and go straight through
// `cell_intent_of` into the reducer door — this component holds no board truth of its own, which is why a
// reload, a reroll and a deleted character all reconcile with no special case here.
//
// Split in two on purpose: `BoardPaneView` is presentation over explicit props (provable with
// react-dom/server, no jsdom), and `SimulatorBoardPane` is the store + engine wiring around it.
//
// The engine is loaded LAZILY (dynamic import in the mount effect): it is by far the heaviest module in the
// app, and a page that has never opened this pane should not pay for it — nor should a bun test that renders
// the page shell (the tactical facade pulls a GLB the public repo does not ship).

import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import { Dices, X } from 'lucide-react'
import { encode } from '@aresrpg/fight/los'

import type { CorpusMob } from '../pages/encyclopedia/world_corpus'

import { board_of, type SimBoard } from './board'
import { cell_intent_of, setup_scene_of } from './board_paint'
import { build_mob } from './content.js'
import { MobPicker, use_mob_index } from './MobPicker'
import { MAX_MOBS, type SimMobPick } from './reducer'
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

/** One seated mob as the pane renders it: its cell, the pick, and the corpus row it resolved to (or none). */
export type PickedRow = { cell: number; pick: SimMobPick; row: CorpusMob | null }

export function BoardPaneView({
  board,
  picked,
  focused,
  canvas_ref,
  on_reroll,
  on_level,
  on_remove,
}: Readonly<{
  board: SimBoard
  picked: readonly PickedRow[]
  focused: boolean
  canvas_ref?: RefObject<HTMLCanvasElement | null>
  on_reroll: () => void
  on_level: (row: PickedRow, level: number) => void
  on_remove: (row: PickedRow) => void
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

      <p className={`${micro} text-muted`}>{t(focused ? 'simulator.board_hint' : 'simulator.board_hint_no_focus')}</p>

      <div className="flex flex-col gap-1">
        <span className={`${micro} font-semibold text-muted`}>
          {t('simulator.mobs')} {picked.length}/{MAX_MOBS}
        </span>
        {picked.length === 0 ? (
          <span className={`${micro} text-muted`} style={{ opacity: 0.5 }}>
            {t('simulator.no_mobs')}
          </span>
        ) : (
          picked.map((row) => {
            // S2 — a mob whose combat block was never published is BADGED, never silently completed.
            const built = row.row ? build_mob(row.row, row.pick.level) : null
            return (
              <div key={row.cell} className="flex items-center gap-2 px-2 py-1" style={{ border: HAIRLINE }}>
                <span className="text-[11px] flex-1 truncate" style={{ color: '#e8e4dc' }}>
                  {row.row?.name ?? row.pick.template_id}
                </span>
                {built && !built.combat_block_published && (
                  <span className={micro} style={{ color: GOLD }} title={t('simulator.combat_block_hint')}>
                    {t('simulator.combat_block_unpublished')}
                  </span>
                )}
                <input
                  type="number"
                  className="w-14 px-1 py-0.5 text-[11px] bg-transparent"
                  style={{ border: HAIRLINE, color: '#e8e4dc' }}
                  value={row.pick.level}
                  min={row.row?.minLevel ?? 1}
                  max={row.row?.maxLevel ?? 200}
                  aria-label={t('simulator.level')}
                  onChange={(event) => on_level(row, Number(event.target.value))}
                />
                <button
                  type="button"
                  className="cursor-pointer text-muted hover:text-white"
                  title={t('simulator.remove_mob')}
                  onClick={() => on_remove(row)}
                >
                  <X size={12} />
                </button>
              </div>
            )
          })
        )}
      </div>
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
  const [picker_cell, set_picker_cell] = useState<number | null>(null)

  const { seed, anchor_nonce, roster, placements, mob_picks, focus_id, input } = use_simulator()
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

  // The LIVE state the click handler must read — a handler captured at mount would seat a stale focus.
  const click_state = useRef({ board, placements, focus_id })
  click_state.current = { board, placements, focus_id }

  // ONE mount per page visit; the engine is disposed on unmount (never the world session's singleton).
  useEffect(() => {
    let live = true
    let handle: ViewportHandle | null = null
    let unsubscribe: (() => void) | null = null
    const canvas = canvas_ref.current
    if (!canvas) return undefined
    void import('./mount.js').then(({ create_board_viewport }) => {
      if (!live) return
      handle = create_board_viewport({ canvas }) as ViewportHandle
      unsubscribe = handle.on_cell_click((cell) => {
        // A click that hit no cell (the void around the board) — the engine reports the miss so a dapp can
        // deselect on it; this page has nothing to deselect, so it is simply not an interaction.
        if (!cell) return
        const { x, y } = cell
        const { current } = click_state
        const intent = cell_intent_of(current.board, current, encode(x, y))
        if (!intent) return
        if (intent.type === 'mob_cell') set_picker_cell(intent.cell)
        else if (intent.type === 'place') input({ type: 'character_placed', cell: intent.cell, id: intent.id })
        else input({ type: 'character_unplaced', cell: intent.cell })
      })
      set_viewport(handle)
    })
    return () => {
      live = false
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

  const picked: PickedRow[] = useMemo(
    () =>
      Object.entries(mob_picks)
        .map(([cell, pick]) => ({ cell: Number(cell), pick, row: mob_of.get(pick.template_id) ?? null }))
        .sort((left, right) => left.cell - right.cell),
    [mob_picks, mob_of]
  )

  return (
    <>
      <BoardPaneView
        board={board}
        picked={picked}
        focused={focus_id !== null}
        canvas_ref={canvas_ref}
        on_reroll={() => input({ type: 'board_rerolled' })}
        on_level={(row, level) =>
          input({
            type: 'mob_level_set',
            cell: row.cell,
            level,
            min_level: row.row?.minLevel ?? 1,
            max_level: row.row?.maxLevel ?? MAX_LEVEL_FALLBACK,
          })
        }
        on_remove={(row) => input({ type: 'mob_unpicked', cell: row.cell })}
      />
      {picker_cell !== null && (
        <MobPicker
          value={mob_picks[picker_cell]?.template_id}
          on_close={() => set_picker_cell(null)}
          on_pick={(mob) => {
            input({
              type: 'mob_picked',
              cell: picker_cell,
              template_id: mob.id,
              level: mob.minLevel,
              min_level: mob.minLevel,
              max_level: mob.maxLevel,
            })
            set_picker_cell(null)
          }}
        />
      )}
    </>
  )
}

/** A row with no resolved corpus mob has no band to clamp into — the reducer's own ceiling stands in. */
const MAX_LEVEL_FALLBACK = 200
