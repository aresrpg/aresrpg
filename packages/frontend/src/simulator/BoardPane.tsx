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
// the page shell (the tactical facade pulls a GLB the public repo does not ship). The mount AND the handle it
// returns go through `mount_board_viewport`, so nothing this pane asks of the renderer can reject: /simulator
// is a public route, and a visitor with no usable WebGL context gets the degraded board instead of a page
// error and a dead rectangle (#2205).

import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import { Dices, MonitorOff } from 'lucide-react'
import { encode } from '@aresrpg/fight/los'

import { report_error } from '../core/report.js'

import { board_of, type SimBoard } from './board'
import { cell_intent_of, setup_scene_of } from './board_paint'
import { CharacterPicker } from './CharacterPicker'
import { MobModal } from './MobModal'
import { useMobIndex } from './MobPicker'
import { use_simulator } from './store'

const GOLD = '#c8963c'
const HAIRLINE = '1px solid rgba(255,255,255,0.06)'
const micro = 'text-[9px] tracking-[0.22em] uppercase'

type ViewportHandle = {
  show: (board: unknown, scene: unknown) => Promise<void>
  /** the board reports a MISS as `null` (contract v1.2) — a click into the void is an event, not silence */
  on_cell_click: (cb: (cell: { x: number; y: number } | null) => void) => () => void
  /** hand the board to the world's fight adapter for the fight phase, and take it back after */
  arm_fight: () => Promise<void>
  disarm_fight: () => void
  destroy: () => void
}

/**
 * The board region. `setup` is the EDITING phase and owns every verb on this pane — the reroll, the hint, the
 * two start bands. In `fight` the same viewport shows the fight's own seats and nothing else: a surface that
 * still offers a reroll and still says "click a blue cell" is telling the player they are editing a line-up
 * the sim has already snapshotted (#883 ②⑤).
 */
export function BoardPaneView({
  board,
  setup,
  canvas_ref,
  gl_degraded = false,
  on_reroll,
}: Readonly<{
  board: SimBoard
  setup: boolean
  canvas_ref?: RefObject<HTMLCanvasElement | null>
  /** #2205 — this device has no usable WebGL context, so the 3D board never came up */
  gl_degraded?: boolean
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
        {setup && (
          <button
            type="button"
            className={`${micro} flex items-center gap-1 px-2 py-1 cursor-pointer`}
            style={{ border: `1px solid ${GOLD}`, color: GOLD }}
            onClick={on_reroll}
          >
            <Dices size={12} />
            {t('simulator.reroll_board')}
          </button>
        )}
      </div>

      <div className="relative flex-1 min-h-[220px]" style={{ border: HAIRLINE, background: '#0c0c14' }}>
        <canvas
          ref={canvas_ref}
          className="absolute inset-0 w-full h-full block"
          style={{ visibility: gl_degraded ? 'hidden' : 'visible' }}
        />
        {/* #2205 — the honest face of a dead GL context. Never a blank hole: the region says WHAT failed and
            WHY the board is gone, while the read-out above it and every panel beside it keep working. */}
        {gl_degraded && (
          <div
            data-board-unavailable
            className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-6 text-center"
          >
            <MonitorOff size={18} style={{ color: GOLD }} />
            <span className={micro} style={{ color: GOLD }}>
              {t('simulator.board_unavailable')}
            </span>
            <p className="text-[11px] leading-relaxed text-muted max-w-[42ch]">
              {t('simulator.board_unavailable_hint')}
            </p>
          </div>
        )}
      </div>

      {/* The gesture hint is a LIE with no board under it — the same reason the creator hides "drag to
          rotate" on a degraded pedestal (#2198). The notice above already says what this device can do. */}
      {!gl_degraded && (
        <p className={`${micro} text-muted`}>{t(setup ? 'simulator.board_hint' : 'simulator.board_hint_fight')}</p>
      )}
    </div>
  )
}

type MountedViewport = { handle: ViewportHandle; unsubscribe: () => void }

/**
 * THE PANE'S WHOLE RELATIONSHIP WITH THE RENDERER (#2205) — wrapped so that nothing the pane does with it
 * can reject. Every one of those calls is a bare `void promise` in an effect, so an unguarded failure is an
 * unhandled rejection and a permanently dead pane on the public /simulator route.
 *
 * They are ONE failure, not three, which is why they share one guard: the device has no usable WebGL
 * context (`getContext` answers null — acceleration off, a blocklisted driver). Measured in a real browser
 * with the context nulled: the engine SURVIVES construction (it reports its own boot failure and hands back
 * a renderer-less shell), so the first throw actually lands in `show()` → `board.build()` →
 * `engine.add_to_scene`, one paint later. Guarding only the constructor would have caught nothing.
 *
 * `on_dead` fires AT MOST ONCE, whichever call failed first: the caller runs flat from then on, and the
 * mechanical cause is reported once — a GPU-less visitor losing the board must never cost them the page.
 */
export async function mount_board_viewport({
  canvas,
  on_cell,
  on_dead,
  load = () => import('./mount.js'),
}: {
  canvas: HTMLCanvasElement
  on_cell: (cell: { x: number; y: number } | null) => void
  on_dead: () => void
  load?: () => Promise<{ create_board_viewport: (args: { canvas: HTMLCanvasElement }) => unknown }>
}): Promise<MountedViewport | null> {
  let dead = false
  const die = (error: unknown) => {
    if (dead) return
    dead = true
    report_error(error, { area: 'simulator', action: 'board_viewport' })
    on_dead()
  }
  try {
    const raw = (await load()).create_board_viewport({ canvas }) as ViewportHandle
    return {
      unsubscribe: raw.on_cell_click(on_cell),
      // The same handle with its two async verbs made unrejectable — the caller keeps calling them exactly
      // as before, and a renderer that dies mid-paint degrades the pane instead of the page.
      handle: {
        ...raw,
        show: (board, scene) => raw.show(board, scene).catch(die),
        arm_fight: () => raw.arm_fight().catch(die),
      },
    }
  } catch (error) {
    die(error)
    return null
  }
}

export function SimulatorBoardPane() {
  const canvas_ref = useRef<HTMLCanvasElement | null>(null)
  // The viewport is STATE, not a ref, on purpose: the engine module is imported lazily, so it lands one or
  // more renders AFTER the first board+scene exist. A ref would leave that first show() falling into a null
  // viewport and the board would only appear on the next change (measured: nothing until a reroll). As a
  // dependency of the show effect below, the very existence of the viewport re-triggers the paint.
  const [viewport, set_viewport] = useState<ViewportHandle | null>(null)
  /** #2205 — the renderer died (at mount, or at any paint since): show the honest board, keep the page */
  const [gl_degraded, set_gl_degraded] = useState(false)
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
  const mob_of = useMobIndex()
  // The SETUP scene, unconditionally — it is only ever shown in setup. The fight phase does not get a
  // thinner version of it (#927): a half-erased setup pass is still a second writer on the fight's board, so
  // the painter erases itself WHOLE at the handoff (mount.js `unpaint`) and this memo has one job again.
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
    let mounted: MountedViewport | null = null
    const canvas = canvas_ref.current
    if (!canvas) return undefined
    const track = (event: PointerEvent) => {
      pointer.current = { x: event.clientX, y: event.clientY }
    }
    canvas.addEventListener('pointerdown', track)
    void mount_board_viewport({
      canvas,
      on_cell: (cell) => {
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
      },
      // The pane degrades DELIBERATELY the first time the renderer fails, whenever that is: the board
      // region says so and everything else on the page keeps working. Never a silent black rectangle.
      on_dead: () => set_gl_degraded(true),
    }).then((result) => {
      if (!live) {
        result?.unsubscribe()
        result?.handle.destroy()
        return
      }
      mounted = result
      if (result) set_viewport(result.handle)
    })
    return () => {
      live = false
      canvas.removeEventListener('pointerdown', track)
      mounted?.unsubscribe()
      mounted?.handle.destroy()
      set_viewport(null)
      set_gl_degraded(false)
    }
  }, [input])

  // Every board/scene change re-shows — and so does the viewport's own arrival. The mount re-bakes the
  // geometry only when the BOARD itself changed; anything else is a repaint. In the FIGHT phase the world's
  // adapter owns this same board handle, so the setup painter stands down entirely (one writer, always).
  // A dead renderer STANDS DOWN (#2205): once the pane has degraded there is nothing to paint on, and every
  // further reroll would only re-throw against the same broken engine.
  useEffect(() => {
    if (phase !== 'setup' || gl_degraded) return
    void viewport?.show(board, scene)
  }, [viewport, board, scene, phase, gl_degraded])

  // THE CUTOVER. The fight phase is rendered by the world's own `voxel_fight_adapter` over this very engine
  // and board — the same builder, rigs, washes, walk/cast beats and click relay a live dungeon fight uses.
  // Nothing about combat is re-implemented here; the page only says WHEN the fight owns the board.
  useEffect(() => {
    if (!viewport || gl_degraded) return undefined
    if (phase !== 'fight') return undefined
    void viewport.arm_fight()
    return () => viewport.disarm_fight()
  }, [viewport, phase, gl_degraded])

  return (
    <>
      <BoardPaneView
        board={board}
        setup={phase === 'setup'}
        canvas_ref={canvas_ref}
        gl_degraded={gl_degraded}
        on_reroll={() => input({ type: 'board_rerolled' })}
      />
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
