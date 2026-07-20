// THE ADOPTION HOLD-NOT-DEGRADE LAW (the 07-18 adaptive-run mechanism, lane ADOPTION_SEAM). On fight adoption
// the exact object read can return a TORN record: the json's `board: BoardGeom` missing, which decode_fight
// maps to `width: 0, height: 0` + empty vectors (fight_read.js:81-90 `Number(board.width ?? 0)`). Adopting
// that record presents the GRID_W×GRID_H (20×19) FALLBACK frame with ZERO start cells — the exact recorded
// composite: board mounted, no placement highlight glowing, placement clicks aimed at a frame the real fight
// never had. The board build downstream is one-shot per fight (build_key), so a frame built inside that
// window poisons the whole fight even after the +250ms retry heals the read.
//
// THE LAW under test (one-pipeline: reconcile INSIDE the reducer):
//   1. a torn record is NEVER presentable — the snapshot door refuses the fold (hold, not degrade);
//   2. a torn re-read mid-fight holds AT THE LAST GOOD view (never regress, never blank);
//   3. the hold CONVERGES — when nothing has presented yet, a COMPLETE read at-or-below the entry floor
//      still seeds the base (refusing it wedged the board at null until the next tx bumped the version).

import { describe, expect, test } from 'bun:test'

import { create_fight_store } from './store.js'
import * as project from './project.js'

const FIGHT = '0xf1'
const ME = '0xc1'
const OWNER = '0xowner'

const participant = (cell = 5) => ({
  owner: OWNER,
  character: ME,
  class: 'senshi',
  team: 0,
  hp: 50,
  max_hp: 50,
  ap: 6,
  mp: 3,
  base_ap: 6,
  base_mp: 3,
  cell,
  ready: false,
  casts_this_turn: 0,
  weapon: null,
})

/** The REAL arena — 13×12, deliberately ≠ the 20×19 GRID fallback so a fallback present is distinguishable. */
const real_fight = ({ cell = 5 } = {}) => ({
  id: FIGHT,
  status: 0, // engine PLACEMENT
  width: 13,
  height: 12,
  participants: [participant(cell)],
  mobs: [{ template: '0xmob', hp: 40, max_hp: 40, cell: 100, ap: 4, mp: 3, level: 3 }],
  queue: [],
  turn_ptr: 0,
  turn_deadline_ms: 0,
  placement_deadline_ms: 90_000,
  last_action_ms: 0,
  obstacles: [],
  holes: [],
  start_cells_a: [5, 6, 7],
  start_cells_b: [230, 231],
  shape_mask: [],
})

/** The TORN record, exactly as decode_fight yields it for a json with `board` absent/empty: numeric ZERO dims
 *  + empty geometry vectors (fight_read.js:81-90). The 0 is the decode's own torn-read signature — a plain
 *  synthetic fixture that simply omits width/height is NOT this shape. */
const degraded_fight = () => ({
  ...real_fight(),
  width: 0,
  height: 0,
  obstacles: [],
  holes: [],
  start_cells_a: [],
  start_cells_b: [],
  shape_mask: [],
})

const boot = () => {
  const store = create_fight_store()
  store
    .getState()
    .input({
      type: 'init',
      fight_id: FIGHT,
      ctx: { my_entity_id: ME, address: OWNER, creator: OWNER, beat_ctx: { grid_width: 20 } },
    })
  return store
}

describe('adoption hold-not-degrade (the exact-read torn-record window)', () => {
  test('a torn first read NEVER presents; the healed read presents the REAL frame', () => {
    const store = boot()

    store.getState().input({ type: 'snapshot', fight: degraded_fight(), version: 4 })

    // THE DEGRADED WINDOW LAW: nothing presentable may exist off a torn record. The red of record: this
    // returned a view with grid_width 20 / grid_height 19 (the fallback frame) and start_cells_a [] —
    // the board the adaptive run built, with zero glowing placement cells.
    expect(project.board_view(store.getState())).toBeNull()
    expect(project.engine_view(store.getState())).toBeNull()

    // the +250ms retry heals the read — the REAL frame presents, dimensions the fight's own
    store.getState().input({ type: 'snapshot', fight: real_fight(), version: 5 })
    const view = project.board_view(store.getState())
    expect(view).toMatchObject({ grid_width: 13, grid_height: 12 })
    expect(view.start_cells_a).toEqual([5, 6, 7])
  })

  test('a torn re-read mid-fight holds AT THE LAST GOOD frame, then adopts the healed same-version read', () => {
    const store = boot()
    store.getState().input({ type: 'snapshot', fight: real_fight(), version: 5 })

    store.getState().input({ type: 'snapshot', fight: degraded_fight(), version: 6 })
    const held = project.board_view(store.getState())
    expect(held).toMatchObject({ grid_width: 13, grid_height: 12 }) // never the fallback frame
    expect(store.getState().view_version).toBe(5) // the torn read raised no floor

    store.getState().input({ type: 'snapshot', fight: real_fight({ cell: 6 }), version: 6 })
    expect(store.getState().view_version).toBe(6)
    expect(project.board_view(store.getState()).escrow[0].cell).toBe(6)
  })

  test('the hold CONVERGES: a complete read at the entry floor still seeds a null view', () => {
    const store = boot()

    // a receipt folds BEFORE any object read landed (every earlier read missed) — entries exist, no view
    store.getState().input({
      type: 'receipt',
      receipt: {
        events: [{ type: '0xpkg::fight_events::Placed', parsedJson: { fight: FIGHT, character: ME, cell: 7 } }],
      },
      version: 9,
      fight_id: FIGHT,
    })
    expect(project.board_view(store.getState())).toBeNull() // nothing presents off bare entries

    // the read that CONFIRMS that same version arrives — same object version as the receipt's floor.
    // The red of record: refused as at-floor, view stuck null forever (no later tx ⇒ no version bump).
    store.getState().input({ type: 'snapshot', fight: real_fight({ cell: 7 }), version: 9 })
    const view = project.board_view(store.getState())
    expect(view).not.toBeNull()
    expect(view).toMatchObject({ grid_width: 13, grid_height: 12 })
    expect(view.escrow[0].cell).toBe(7) // the object at v9 is the whole statement of v9 — placement visible
    expect(store.getState().view_version).toBe(9)
  })
})
