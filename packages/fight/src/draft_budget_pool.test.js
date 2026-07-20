// RED-FIRST regression for the DRAFT-BUDGET DOUBLE-SUBTRACTION (P1 release blocker, driven-gate evidence
// multiturn_v29_gate9: exactly ONE cast per turn landed with 12 AP shown — 2 Ghost Talons must be affordable).
//
// THE MECHANISM (proven by elimination — Ghost Talon is cpt 255 / cpta 255 / cd 0, so ONLY the AP term can
// refuse a second cast): the drafted-cast byte-truth lives in TWO ledgers at once —
//   1. the ONE fold: each cast click dispatches an `ap_cost` intent (DungeonBoard.optimistic_cast) and
//      apply_action debits the projected budget (the AP-paint flagship — the DISPLAY truth);
//   2. the board's own draft queue: `cast_path`, whose costs DungeonBoard subtracts AGAIN —
//      `remaining_ap = my_ap − drafted_ap` (DungeonBoard.jsx) where `my_ap` was read from the PRESENTED
//      board_view row (`use_dungeon.dungeon` = project.board_view, dungeon_run_store.js:1328) — already debited.
//   After ONE 5-AP cast on a 12-AP pool: presented 7, board remaining 7−5 = 2 < 5 → `castable` empties → the
//   second click no-ops → one cast per turn, every turn → the 120-HP multi_turn fixture is unwinnable.
//   NOTE the receipt fold was NOT the seam (the lead's initial hypothesis): the receipt purges the intents and
//   the TurnStarted refill re-arms the pool correctly — locked green below so it stays that way.
//
// THE LAW (ONE-PIPELINE): the draft ledger must be counted ONCE. The board's draft math anchors on the
// COMMITTED pool (chain refill truth, my intents excluded) exposed per escrow row as `committed:{ap,mp,cell}`;
// the PRESENTED row.ap/mp stay the display truth (fold-debited). `committed.cell` is the same anchor for the
// move-draft geometry: the whole-path recharge and the full-undo walk-back both measure from the CHAIN cell,
// never the already-folded drafted cell (the undo-never-restores-MP twin below).
//
// RED (pre-fix, raw): `committed.ap: the board's pool read must be the chain pool — expected 12, received 7`
//   (and the derived gate: 7−5 = 2 refuses the second cast the chain accepts).
// GREEN: committed.ap = 12 → remaining 12−5 = 7 ≥ 5 — the second Ghost Talon drafts.

import { describe, expect, test } from 'bun:test'

import { create_fight_store } from './store.js'
import { board_view } from './project.js'

const FIGHT = '0xf1'
const CHAR = '0xc1'
const GHOST_TALON_AP = 5 // seed/mainnet/spells/tomoda.json tomoda_ghost_talon L1 (cpt 255, cpta 255, cd 0)

// The gate's live shape: a 12 AP / 6 MP seat (gate9 frame), one 120-HP mob (multi_turn Wolfling class).
const FIGHT_OBJECT = {
  id: FIGHT,
  status: 1,
  width: 20,
  height: 19,
  participants: [
    {
      owner: '0xaaa',
      character: CHAR,
      class: 'tomoda',
      team: 0,
      ap: 12,
      mp: 6,
      base_ap: 12,
      base_mp: 6,
      hp: 300,
      max_hp: 300,
      cell: 100,
    },
  ],
  mobs: [{ template: '0xabc', hp: 120, max_hp: 120, cell: 105, ap: 4, mp: 3, level: 15 }],
  queue: [
    { is_mob: false, idx: 0 },
    { is_mob: true, idx: 0 },
  ],
  turn_ptr: 0,
  turn_deadline_ms: 90_000,
}

const boot = () => {
  const store = create_fight_store()
  store.getState().input({
    type: 'init',
    fight_id: FIGHT,
    my_key: 'p0',
    ctx: { my_entity_id: CHAR, beat_ctx: { grid_width: 20 } },
  })
  store.getState().input({ type: 'snapshot', fight: FIGHT_OBJECT, version: 5 }, 1_000)
  return store
}

// MY drafted cast, exactly as DungeonBoard.optimistic_cast dispatches it (one queue append = one intent).
const draft_cast = (store, at) =>
  store
    .getState()
    .input({ type: 'intent', intent: { kind: 'cast', target_cell: 105, damaging: true, ap_cost: GHOST_TALON_AP } }, at)

describe('draft-budget pool — the board subtracts the cast_path ledger from the CHAIN pool, never twice', () => {
  test('one queued 5-AP cast on a 12-AP pool leaves a second cast affordable (the gate9 one-cast-per-turn P1)', () => {
    const store = boot()
    draft_cast(store, 2_000)
    const [row] = board_view(store.getState()).escrow
    // display truth (the AP-paint flagship) must KEEP folding the spend — the fix may not resurrect .28's frozen AP:
    expect(row.ap, 'presented AP paints the spend').toBe(12 - GHOST_TALON_AP)
    // THE P1: the board's gate = pool − cast_path ledger. Pre-fix the pool read falls back to the already-debited
    // presented row (7), so 7−5 = 2 < 5 refuses the second cast the chain accepts (12−5 = 7 ≥ 5).
    const drafted_ap = GHOST_TALON_AP // the cast_path ledger: one Ghost Talon queued
    expect(
      (row.committed?.ap ?? row.ap) - drafted_ap,
      'remaining after ONE queued Ghost Talon must afford a second (12−5=7 ≥ 5), not the double-subtracted 12−2×5=2'
    ).toBeGreaterThanOrEqual(GHOST_TALON_AP)
    // the pool the board's draft math subtracts `drafted_ap` from — the CHAIN pool, not the debited projection:
    expect(row.committed?.ap, "committed.ap: the board's pool read must be the chain pool").toBe(12)
  })

  test('the receipt fold re-arms the pool (arm → cast → receipt): refill truth, no re-applied spend', () => {
    const store = boot()
    draft_cast(store, 2_000)
    draft_cast(store, 2_100)
    // the turn's single-PTB receipt: my two casts + my end → mob turn → MY next TurnStarted (refill).
    store.getState().input(
      {
        type: 'receipt',
        version: 6,
        events: [
          { type: '0x0::fight_events::Cast', parsedJson: { fight: FIGHT, caster_is_mob: false, caster_idx: 0 } },
          { type: '0x0::fight_events::Cast', parsedJson: { fight: FIGHT, caster_is_mob: false, caster_idx: 0 } },
          { type: '0x0::fight_events::TurnEnded', parsedJson: { fight: FIGHT, is_mob: false, idx: 0 } },
          { type: '0x0::fight_events::TurnStarted', parsedJson: { fight: FIGHT, is_mob: true, idx: 0 } },
          { type: '0x0::fight_events::TurnEnded', parsedJson: { fight: FIGHT, is_mob: true, idx: 0 } },
          {
            type: '0x0::fight_events::TurnStarted',
            parsedJson: { fight: FIGHT, is_mob: false, idx: 0, deadline_ms: 180_000 },
          },
        ],
      },
      3_000
    )
    const [row] = board_view(store.getState()).escrow
    expect(row.committed?.ap, 'next turn opens on the full chain pool').toBe(12)
    expect(row.ap, 'presented AP re-arms with the refill — the spend is never applied twice').toBe(12)
  })

  test('the move twin: committed.mp/.cell anchor the whole-draft recharge and the full-undo walk-back', () => {
    const store = boot()
    // the board's optimistic_walk intent: ABSOLUTE mp_left after the whole draft (here: one 2-cost segment).
    store
      .getState()
      .input({ type: 'intent', intent: { kind: 'move', character: CHAR, to_cell: 102, mp_left: 4 } }, 2_000)
    const [row] = board_view(store.getState()).escrow
    expect(row.mp, 'presented MP paints the drafted spend').toBe(4)
    expect(row.cell, 'presented cell walks the draft').toBe(102)
    // the recharge/undo anchors: pool MP and the CHAIN cell — a re-computed mp_left must charge the whole path
    // from here (never the folded drafted cell), and an emptied draft must walk back + restore to exactly this.
    expect(row.committed?.mp, "committed.mp: the board's MP pool read must be the chain pool").toBe(6)
    expect(row.committed?.cell, 'committed.cell: the draft-geometry anchor is the chain cell').toBe(100)
  })
})
