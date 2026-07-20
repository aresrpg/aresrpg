// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// D153 fight-end machine — proposal smoke coverage (proves the fold + drivers + transition inertia).
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'

import {
  FE,
  fold,
  note_victory,
  note_card_shown,
  note_claimed,
  note_player_advance,
  fight_end_reset,
  fight_end_state,
  is_awaiting_advance,
  is_ending,
  _fe_reset_for_test,
} from './fight_end_machine.js'

const DID = '0xDUNGEON00000000000000000000000000000000000000000000000000000dgn'
const OTHER = '0xOTHER0000000000000000000000000000000000000000000000000000other'

beforeEach(() => _fe_reset_for_test())
afterEach(() => _fe_reset_for_test())

describe('pure fold', () => {
  const idle = { dungeon_id: null, state: FE.IDLE, kind: null, room: null }
  it('observe starts a cycle at VICTORY_RESOLVED', () => {
    const s = fold(idle, { type: 'observe', dungeon_id: DID, room: 0, kind: 'non_terminal' })
    expect(s.state).toBe(FE.VICTORY_RESOLVED)
    expect(s.room).toBe(0)
    expect(s.kind).toBe('non_terminal')
  })
  it('re-observing the SAME room mid-cycle is inert (no re-arm)', () => {
    let s = fold(idle, { type: 'observe', dungeon_id: DID, room: 0, kind: 'non_terminal' })
    s = fold(s, { type: 'card_shown' })
    const same = fold(s, { type: 'observe', dungeon_id: DID, room: 0, kind: 'non_terminal' })
    expect(same).toBe(s) // identity — unchanged
    expect(same.state).toBe(FE.CARD_SHOWN)
  })
  it('a NEW room starts a fresh cycle', () => {
    let s = fold(idle, { type: 'observe', dungeon_id: DID, room: 0, kind: 'non_terminal' })
    s = fold(s, { type: 'observe', dungeon_id: DID, room: 1, kind: 'non_terminal' })
    expect(s.state).toBe(FE.VICTORY_RESOLVED)
    expect(s.room).toBe(1)
  })
  it('card_shown / claimed advance only from the right pre-states', () => {
    expect(fold(idle, { type: 'card_shown' })).toBe(idle) // no-op off IDLE
    expect(fold(idle, { type: 'claimed' })).toBe(idle)
  })
  it('unknown / undefined event is inert', () => {
    expect(fold(idle, { type: 'bogus' })).toBe(idle)
    expect(fold(idle, {})).toBe(idle)
    expect(fold(idle, undefined)).toBe(idle)
  })
})

describe('driver — non-terminal park lifecycle', () => {
  it('victory → card → claimed PARKS at AWAIT_PLAYER_ADVANCE, advance unparks', () => {
    note_victory(DID, 0, 'non_terminal')
    expect(fight_end_state().state).toBe(FE.VICTORY_RESOLVED)
    note_card_shown()
    expect(fight_end_state().state).toBe(FE.CARD_SHOWN)
    note_claimed()
    expect(fight_end_state().state).toBe(FE.AWAIT_PLAYER_ADVANCE)
    expect(is_awaiting_advance(DID)).toBe(true)
    expect(is_awaiting_advance(OTHER)).toBe(false) // never leaks across dungeons
    expect(note_player_advance()).toBe(true)
    expect(fight_end_state().state).toBe(FE.IDLE)
    expect(is_awaiting_advance(DID)).toBe(false)
  })
  it('claim before card (order-independent) still parks', () => {
    note_victory(DID, 0, 'non_terminal')
    note_claimed() // claim lands first
    expect(fight_end_state().state).toBe(FE.AWAIT_PLAYER_ADVANCE)
  })
  it('is_ending is TRUE across the whole window, FALSE at IDLE and for other dungeons', () => {
    expect(is_ending(DID)).toBe(false)
    note_victory(DID, 0, 'non_terminal')
    expect(is_ending(DID)).toBe(true)
    expect(is_ending(OTHER)).toBe(false)
    note_card_shown()
    note_claimed()
    expect(is_ending(DID)).toBe(true) // still ending while parked
    note_player_advance()
    expect(is_ending(DID)).toBe(false)
  })
})

describe('driver — terminal lands at CLAIMED, never parks', () => {
  it('WON/FAILED: victory → claimed = CLAIMED (EXIT teardown follows), not parked', () => {
    note_victory(DID, 2, 'terminal')
    note_claimed()
    expect(fight_end_state().state).toBe(FE.CLAIMED)
    expect(is_awaiting_advance(DID)).toBe(false) // a terminal end is NOT a park
  })
})

describe('TRANSITION INERTIA — roster/sui repaints CANNOT move the machine', () => {
  it('a barrage of non-events after a park leaves the state PARKED', () => {
    note_victory(DID, 0, 'non_terminal')
    note_card_shown()
    note_claimed()
    const parked = fight_end_state()
    // simulate load_roster / sui_data / refresh churn: none of them call the machine's movers.
    for (let i = 0; i < 50; i++) {
      // the ONLY thing a repaint could plausibly re-fire is note_victory with the SAME resolved room —
      // which is edge-guarded to a no-op. Prove it.
      note_victory(DID, 0, 'non_terminal')
    }
    expect(fight_end_state()).toEqual(parked)
    expect(is_awaiting_advance(DID)).toBe(true)
  })
  it('advance is refused when not parked (no rogue unpark from a stray gesture)', () => {
    note_victory(DID, 0, 'non_terminal') // VICTORY_RESOLVED, not yet claimed/parked
    // advance from a non-parked-but-in-cycle CARD_SHOWN is allowed (deliberate late-claim tolerance);
    // from bare VICTORY_RESOLVED it is refused.
    expect(note_player_advance()).toBe(false)
    expect(fight_end_state().state).toBe(FE.VICTORY_RESOLVED)
  })
})

describe('reset (session teardown)', () => {
  it('fight_end_reset clears any state to IDLE', () => {
    note_victory(DID, 0, 'non_terminal')
    note_card_shown()
    note_claimed()
    fight_end_reset()
    expect(fight_end_state().state).toBe(FE.IDLE)
    expect(fight_end_state().dungeon_id).toBe(null)
  })
})

// ── STORE-DRIVER SEQUENCE CONTRACT ──────────────────────────────────────────────────────────────────────────
// dungeon_store.js CANNOT be imported in a unit test (it transitively pulls env.ts + the whole game/three stack),
// so the store's ORCHESTRATION of this machine has no direct coverage. This block encodes each store path's EXACT
// machine-call order (verbatim from dungeon_store.js at the cited lines) and asserts the resulting state — locking
// the driver contract so a future reorder of note_victory/note_claimed/fight_end_reset is caught here. If any of
// these line refs move, this is the checklist to re-verify against.
describe('store-driver sequences (contract with dungeon_store.js — the driver has no direct test)', () => {
  const ROOM = 0
  it('refresh() ROOM_CLEARED + background _claim_cleared_room → PARKED (D37b/#33 non-terminal)', () => {
    // dungeon_store.refresh() L463: note_victory(non_terminal); then _claim_cleared_room L604: note_claimed().
    // (RewardRecap mount fires note_card_shown independently — proven order-independent above; omit or include,
    //  both must land PARKED.)
    note_victory(DID, ROOM, 'non_terminal')
    expect(fight_end_state().state).toBe(FE.VICTORY_RESOLVED)
    note_card_shown() // RewardRecap.jsx L21 — may or may not have fired yet; include to prove the common order
    note_claimed() // _claim_cleared_room L604
    expect(fight_end_state().state).toBe(FE.AWAIT_PLAYER_ADVANCE)
    expect(is_awaiting_advance(DID)).toBe(true)
  })
  it('a re-poll of the SAME cleared room (refresh fires note_victory every 4s) never re-arms a parked cycle', () => {
    note_victory(DID, ROOM, 'non_terminal')
    note_claimed() // parked
    const parked = fight_end_state()
    note_victory(DID, ROOM, 'non_terminal') // the next 4s poll re-observes the SAME ROOM_CLEARED — must be inert
    expect(fight_end_state()).toEqual(parked)
  })
  it('start_next_room({user:true}) gate: parked ⇒ note_player_advance()===true ⇒ proceeds → IDLE', () => {
    note_victory(DID, ROOM, 'non_terminal')
    note_claimed() // parked
    // dungeon_store.start_next_room L552: `if (is_ending(id) && !note_player_advance()) refuse`.
    expect(is_ending(DID)).toBe(true)
    expect(note_player_advance()).toBe(true) // parked → advance allowed
    expect(fight_end_state().state).toBe(FE.IDLE) // unparked; the next room's board may now mount
  })
  it('start_next_room gate: PRE-claim (claim still in flight) ⇒ note_player_advance()===false ⇒ refuse', () => {
    note_victory(DID, ROOM, 'non_terminal') // VICTORY_RESOLVED — the background claim has NOT landed yet
    expect(is_ending(DID)).toBe(true)
    expect(note_player_advance()).toBe(false) // refuse — the gesture retries; the claim is seconds away
    expect(fight_end_state().state).toBe(FE.VICTORY_RESOLVED) // unchanged (no rogue unpark)
  })
  it('claim() terminal: note_victory(terminal) → fight_end_reset() (SYNC) → background note_claimed() is a no-op → IDLE', () => {
    // dungeon_store.claim() L905 note_victory(terminal), L914 fight_end_reset() (synchronous, D116 exit-first),
    // then the BACKGROUND tx L931 note_claimed(). Prove the reset wins and the late claim is inert.
    note_victory(DID, 2, 'terminal')
    expect(fight_end_state().state).toBe(FE.VICTORY_RESOLVED)
    fight_end_reset() // L914 — session ends synchronously with the optimistic scene exit
    expect(fight_end_state().state).toBe(FE.IDLE)
    note_claimed() // L931 background — machine already IDLE ⇒ no-op (never re-enters a cycle post-exit)
    expect(fight_end_state().state).toBe(FE.IDLE)
    expect(is_ending(DID)).toBe(false) // a terminal end is never a park / never force-holds ROAM
  })
  it('boot-resume INTO a cleared room seeds PARKED (note_victory+note_claimed) so boot can NEVER auto-advance', () => {
    // dungeon_store L404-406 (start): note_victory(non_terminal); note_claimed().
    note_victory(DID, ROOM, 'non_terminal')
    note_claimed()
    expect(is_awaiting_advance(DID)).toBe(true) // parked on boot — only the explicit gesture unparks
  })
  it('teardown paths (abandon / burn / reset_local / boot-rescue) fight_end_reset() → IDLE from ANY state', () => {
    note_victory(DID, ROOM, 'non_terminal')
    note_card_shown() // mid-cycle, card up, not yet claimed
    fight_end_reset()
    expect(fight_end_state().state).toBe(FE.IDLE)
    expect(is_ending(DID)).toBe(false)
  })
})
