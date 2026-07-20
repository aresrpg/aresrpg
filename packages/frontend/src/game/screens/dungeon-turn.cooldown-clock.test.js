// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// FIX 4 cooldown clock — the store half is now ONLY last_cast_turn (spell name_key → the turn it cast). The
// seat-turn counter `my_turn_no` moved to the fight CORE (fold-derived, DEADLINE-INDEPENDENT — register #34 —
// so lag/starvation can no longer freeze it and pin every cd>0 spell on-cooldown forever). This suite locks the
// store's last-cast record headlessly (zustand, no React), then proves it feeds draft-budget.js's on_cooldown/
// cooldown_left the EXACT way DungeonBoard/DeckCluster do — with `current_turn` supplied by the core's my_turn_no
// (a plain counter here; its own advancing-under-starvation proof lives in packages/fight/cooldown_clock_turn).

import { beforeEach, describe, expect, it } from 'bun:test'

import { use_dungeon_turn } from './dungeon-turn.js'
import { on_cooldown, cooldown_left } from '@aresrpg/fight'

beforeEach(() => {
  use_dungeon_turn.getState().reset_cast_clock()
})

describe('use_dungeon_turn — FIX 4 last-cast record (last_cast_turn)', () => {
  it('starts empty', () => {
    expect(use_dungeon_turn.getState().last_cast_turn).toEqual({})
  })

  it('record_cast_turns MERGES spell_key → turn pairs, never clobbering an unrelated spell', () => {
    const s = use_dungeon_turn.getState()
    s.record_cast_turns({ ember_strike: 1 })
    s.record_cast_turns({ warcleave: 1 })
    expect(use_dungeon_turn.getState().last_cast_turn).toEqual({ ember_strike: 1, warcleave: 1 })
    // a LATER cast of the SAME spell overwrites only its own key.
    s.record_cast_turns({ ember_strike: 3 })
    expect(use_dungeon_turn.getState().last_cast_turn).toEqual({ ember_strike: 3, warcleave: 1 })
  })

  it('reset_cast_clock (DungeonBoard on a fresh fight_id) wipes the record, no residue from a prior room', () => {
    const s = use_dungeon_turn.getState()
    s.record_cast_turns({ ember_strike: 2 })
    s.reset_cast_clock()
    expect(use_dungeon_turn.getState().last_cast_turn).toEqual({})
  })
})

// Integration proof: the store's last-cast record feeds draft-budget's cast.move-mirroring formula the exact way
// DungeonBoard's armed-spell gate does — with `current_turn` sourced from the fight core's my_turn_no (the
// deadline-independent seat-turn counter). The store change moved WHERE my_turn_no lives, never the math.
describe('last_cast_turn + draft-budget on_cooldown/cooldown_left — the DeckCluster.cast_gate formula', () => {
  it('a cooldown-2 spell cast on my turn 1 is still locked on my turns 2/3, free again on turn 4', () => {
    const s = use_dungeon_turn.getState()
    const cooldown = 2
    s.record_cast_turns({ sp: 1 }) // I cast `sp` on my turn 1 (core my_turn_no === 1 at commit)

    const { last_cast_turn } = use_dungeon_turn.getState()
    expect(on_cooldown(last_cast_turn.sp, 2, cooldown)).toBe(true)
    expect(cooldown_left(last_cast_turn.sp, 2, cooldown)).toBe(2)

    expect(on_cooldown(last_cast_turn.sp, 3, cooldown)).toBe(true)
    expect(cooldown_left(last_cast_turn.sp, 3, cooldown)).toBe(1)

    expect(on_cooldown(last_cast_turn.sp, 4, cooldown)).toBe(false)
    expect(cooldown_left(last_cast_turn.sp, 4, cooldown)).toBe(0)
  })

  it('a spell never cast (no last_cast_turn entry) is never on cooldown', () => {
    const { last_cast_turn } = use_dungeon_turn.getState()
    expect(on_cooldown(last_cast_turn.never_cast, 5, 3)).toBe(false)
  })
})
