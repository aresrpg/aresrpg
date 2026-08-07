// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #1993 WP2b items 1 + 4 — THE BOARD ARMS ON THE HANDOVER FACT, NOT ON A SECOND COPY OF IT.
//
// `DungeonBoardState`'s `my_turn` was a THIRD home of "is the turn mine to play": chain seat ⋀ `!presenting`.
// That is the pre-#1808 boundary — it hands the turn over on the CLIENT's paced replay draining, while the
// chain may still be spending the mob-resolution budget the same turn's deadline was widened by. The fold
// already owns the honest fact (`turn_playable`), and `input_armed` is its one arming door
// (`turn_playable ⋀ !is_over`) — so the board reads THAT and stops deriving its own.
//
// Masked, not harmless: `emit_click` has exactly one production caller (voxel_fight_adapter) and that caller
// already gates on `project.turn_playable`. So the stale copy never leaked into the CLICK path — it leaked into
// everything else `my_turn` gates: the reachable/castable affordance sets and the board chrome. This drives the
// REAL hook through the REAL fight store over the four windows the gate must answer.

import { describe, expect, test, beforeEach } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

// The board pulls the browser-flavoured world-shell stores at module load — the same narrow host surface the
// sibling HUD suites keep alive for the Bun worker.
const w = /** @type {any} */ (globalThis.window ??= /** @type {any} */ ({}))
w.addEventListener ??= () => {}
w.removeEventListener ??= () => {}
w.matchMedia ??= () => ({ matches: false })
w.location ??= { origin: 'http://localhost:5173', href: 'http://localhost:5173/' }
w.location.href ??= 'http://localhost:5173/'
w.dispatchEvent ??= () => true
globalThis.localStorage ??= /** @type {any} */ ({ getItem: () => null, setItem() {}, removeItem() {} })
globalThis.requestAnimationFrame ??= () => 0
globalThis.cancelAnimationFrame ??= () => {}

const { useDungeonBoardState } = await import('../../../../../src/game/screens/hud/world/DungeonBoardState.jsx')
const { seed_fight_core, reset_fight_core } = await import('../../../../../src/test_helpers/fight_core_harness.js')
const { fight_store } = await import('@aresrpg/fight/store')

const ME = '0xme'
const FIGHT = '0xf1'
const TURN_MS = 45_000
const MOB_RESOLVE_MS = 3_000 // actions.move: `deadline = start + turn_ms + 3s × resolved mobs`

/** The mob cascade the chain hands back in ONE receipt: mob-0 plays, then MY turn starts. */
const CASCADE = [
  { type: '0x0::fight_events::TurnEnded', parsedJson: { fight: FIGHT, is_mob: false, idx: 0 } },
  { type: '0x0::fight_events::TurnStarted', parsedJson: { fight: FIGHT, is_mob: true, idx: 0, deadline_ms: 0 } },
  { type: '0x0::fight_events::MobMoved', parsedJson: { fight: FIGHT, idx: 0, to_cell: 107 } },
  { type: '0x0::fight_events::TurnEnded', parsedJson: { fight: FIGHT, is_mob: true, idx: 0 } },
]

/** Render the REAL board hook against the live core and hand back its derived state. */
const drive_board = () => {
  let seen = /** @type {any} */ (null)
  const Probe = () => {
    seen = useDungeonBoardState()
    return null
  }
  renderToStaticMarkup(createElement(Probe))
  return seen
}

beforeEach(reset_fight_core)

describe('#1993 — the board arms on the ONE handover fact', () => {
  test('A · an ordinary turn (nothing replayed) arms the board', () => {
    const now = Date.now()
    seed_fight_core({ my: ME, active: ME, turn_ms: TURN_MS, turn_deadline_ms: now + TURN_MS })
    expect(fight_store.getState().turn_playable, 'the fold hands an unwidened turn over at once').toBe(true)
    expect(drive_board().my_turn).toBe(true)
  })

  test('B · a STARVED read (no chain deadline) still arms — the gate fails OPEN', () => {
    // No deadline ⇒ `turn_handover_at` refuses to fabricate a boundary rather than lock a player out of a turn
    // the chain already granted. The board must inherit that refusal, not re-decide it.
    seed_fight_core({ my: ME, active: ME, turn_ms: TURN_MS, turn_deadline_ms: 0 })
    expect(fight_store.getState().turn_playable).toBe(true)
    expect(drive_board().my_turn).toBe(true)
  })

  test('C · MID-PRESENTATION (a mob wave still draining locally) refuses the board', () => {
    const now = Date.now()
    seed_fight_core({ my: ME, active: ME, turn_ms: 0, turn_deadline_ms: now + TURN_MS })
    fight_store.getState().input({ type: 'receipt', receipt: { events: CASCADE }, version: 6 }, now)
    expect(
      fight_store.getState().wave.some((t) => !t.is_local),
      'a non-local wave is draining'
    ).toBe(true)
    expect(fight_store.getState().turn_playable).toBe(false)
    expect(drive_board().my_turn).toBe(false)
  })

  test('D · the POST-HANDOVER WINDOW — chain seat mine, replay drained, mob budget UNSPENT — refuses', () => {
    // THE DEFECT: `!presenting` is true here (nothing is replaying locally) and the chain seat is mine, so the
    // old derivation armed the whole affordance while the chain was still resolving the four mobs its own
    // deadline was widened by. The fold says no; the board must say no.
    const now = Date.now()
    seed_fight_core({
      my: ME,
      active: ME,
      turn_ms: TURN_MS,
      turn_deadline_ms: now + TURN_MS + 4 * MOB_RESOLVE_MS,
    })
    expect(fight_store.getState().wave.length, 'nothing is replaying — only the chain budget is outstanding').toBe(0)
    expect(fight_store.getState().turn_playable).toBe(false)
    expect(drive_board().my_turn, 'the board must not arm before the chain hands the turn over').toBe(false)

    // …and it arms on the store's own clock, at the honest instant — one tick, one handover.
    fight_store.getState().input({ type: 'tick' }, now + 4 * MOB_RESOLVE_MS + 1)
    expect(fight_store.getState().turn_playable).toBe(true)
    expect(drive_board().my_turn).toBe(true)
  })

  test('the board reads the projected arming door — no second derivation of it survives', async () => {
    const source = await Bun.file(
      new URL('../../../../../src/game/screens/hud/world/DungeonBoardState.jsx', import.meta.url)
    ).text()
    expect(source, 'the pre-#1808 boundary is gone from the board').not.toContain('!fight.presenting')
    expect(source).toContain('my_turn: fight?.input_armed === true')
  })
})
