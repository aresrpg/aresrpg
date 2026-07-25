// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// M3 RENDER RUNG — the MOVE-WASH decision lives in the CORE (D768/D769 clause 3: the renderer computes
// nothing). These rows pin the tackle-paint rules exactly:
//   · still respects max range and drops the mouse-hover preview — shows the reachable cells in green and
//     the cells that would've been reachable without the tackle in light red, independent of mouse position
//   · only paints while actually being tackled, scoped to the MP that can't be spent or would be lost by
//     trying — not simply "the MP is already spent from moving" (that read as tackled when it wasn't)
// The contest math is the chain's own (sim fight_tackle twins spell_formula.move — golden-pinned): equal
// agility ⇒ num/den = 1/2; dodge ≥ 2·lock ⇒ certain escape ⇒ NO restriction, no red.

import { describe, expect, test } from 'bun:test'

import { move_wash, placement_click, turn_input_armed } from '../src/project.js'
import { create_fight_store } from '../src/store.js'
import { local_intent_beats, local_move_beats, synthetic_cast_events } from '../src/present.js'

const FIGHT = '0xf1'
const CHAR = '0xc1'
const CHAR2 = '0xc2'

// GRID_W = 20. me p0 at (5,2)=45; mob m0 ADJACENT at (6,2)=46; mob m1 far at (10,10)=210.
const ME_CELL = 45
const ADJ_CELL = 46
const FAR_CELL = 210

const fight_object = ({ my_agility = 40, mob_agility = 40, mob_hp = 30, mob_cell = ADJ_CELL, status = 1 } = {}) => ({
  id: FIGHT,
  status,
  width: 20,
  height: 19,
  participants: [
    {
      owner: '0xaaa',
      character: CHAR,
      class: 'senshi',
      team: 0,
      ap: 6,
      mp: 3,
      base_ap: 6,
      base_mp: 3,
      hp: 50,
      max_hp: 50,
      cell: ME_CELL,
      stats: { agility: my_agility },
    },
  ],
  mobs: [
    {
      template: '0xabc',
      hp: mob_hp,
      max_hp: 30,
      cell: mob_cell,
      ap: 4,
      mp: 3,
      level: 1,
      stats: { agility: mob_agility },
    },
    { template: '0xabc', hp: 30, max_hp: 30, cell: FAR_CELL, ap: 4, mp: 3, level: 1, stats: { agility: mob_agility } },
  ],
  queue: [
    { is_mob: false, idx: 0 },
    { is_mob: true, idx: 0 },
    { is_mob: true, idx: 1 },
  ],
  turn_ptr: 0,
  turn_deadline_ms: 90_000,
})

const boot = (overrides = {}) => {
  const store = create_fight_store()
  store.getState().input({ type: 'init', fight_id: FIGHT, ctx: { my_entity_id: CHAR } }, 1000)
  store.getState().input({ type: 'snapshot', fight: fight_object(overrides), version: 5 }, 1000)
  return store
}

describe('move_wash — the core which-cells decision (P2c idle default + P2d tackle law)', () => {
  test('idle default: my turn, nothing armed — the MP reach paints, no tackle band (no adjacent enemy)', () => {
    const store = boot({ mob_cell: FAR_CELL - 1 }) // both mobs far — no tackle zone
    const wash = move_wash(store.getState(), { busy: false, targeting: false })
    expect(wash.armed).toBe(true)
    expect(wash.reach.length).toBeGreaterThan(0)
    expect(wash.tackled).toBe(false)
    expect(wash.tackle_lost).toEqual([])
  })

  test('OWNER 1195 — plain MP spending NEVER paints the red band (spent 2 of 3 MP walking, no adjacency)', () => {
    const store = boot({ mob_cell: FAR_CELL - 1 })
    // draft a 2-step walk: absolute remaining MP = 1 (the board's own draft math shape)
    store.getState().input({ type: 'intent', intent: { kind: 'move', character: CHAR, to_cell: 43, mp_left: 1 } }, 1100)
    const wash = move_wash(store.getState(), {})
    expect(wash.reach.length).toBeGreaterThan(0) // the 1-MP reach still paints green
    expect(wash.tackled).toBe(false)
    expect(wash.tackle_lost).toEqual([]) // NEVER a red band from spending — the 1195 law
  })

  test('OWNER 638 — actually tackled (adjacent living enemy, equal agility): green = certain keep, light red = the at-risk remainder, all within max range', () => {
    const store = boot() // mob m0 adjacent at 46, agility 40 == mine → num/den = 1/2 → mp_lost = ceil(3/2) = 2
    const wash = move_wash(store.getState(), {})
    expect(wash.tackled).toBe(true)
    expect(wash.reach.length).toBeGreaterThan(0) // reach(mp − mp_lost) = reach(1)
    expect(wash.tackle_lost.length).toBeGreaterThan(0) // reach(3) \ reach(1)
    // green ∩ red = ∅ and green ∪ red = the FULL live-MP reach — the band respects my max range (638)
    const green = new Set(wash.reach)
    for (const c of wash.tackle_lost) expect(green.has(c)).toBe(false)
    const store_free = boot({ mob_cell: FAR_CELL - 1 })
    const full = new Set(move_wash(store_free.getState(), {}).reach)
    // the adjacent mob's own body blocks one cell of the free-reach set; every washed cell is inside max range
    for (const c of [...wash.reach, ...wash.tackle_lost]) expect(full.has(c)).toBe(true)
  })

  test('certain escape (dodge ≥ 2·lock) — no restriction, no red band', () => {
    const store = boot({ my_agility: 100, mob_agility: 10 }) // bucket 12 vs den 6 → num == den
    const wash = move_wash(store.getState(), {})
    expect(wash.tackled).toBe(false)
    expect(wash.tackle_lost).toEqual([])
    expect(wash.reach.length).toBeGreaterThan(0)
  })

  test('a DEAD adjacent enemy never tackles', () => {
    const store = boot({ mob_hp: 0 })
    const wash = move_wash(store.getState(), {})
    expect(wash.tackled).toBe(false)
    expect(wash.tackle_lost).toEqual([])
  })

  test('gates: targeting mode empties the wash; busy disarms; a mob turn disarms', () => {
    const store = boot()
    expect(move_wash(store.getState(), { targeting: true }).reach).toEqual([])
    expect(move_wash(store.getState(), { targeting: true }).tackle_lost).toEqual([])
    expect(move_wash(store.getState(), { busy: true }).armed).toBe(false)
    // advance to the mob's turn — not my turn ⇒ disarmed
    store.getState().input(
      {
        type: 'receipt',
        version: 6,
        receipt: [
          { type: '0x0::fight_events::TurnEnded', parsedJson: { fight: FIGHT, is_mob: false, idx: 0 } },
          {
            type: '0x0::fight_events::TurnStarted',
            parsedJson: { fight: FIGHT, is_mob: true, idx: 0, deadline_ms: 0 },
          },
        ],
      },
      2000
    )
    expect(move_wash(store.getState(), {}).armed).toBe(false)
  })

  test('RULING 2026-07-19 — MY OWN cast/weapon VFX presenting disarms the wash (misclick-to-move guard)', () => {
    const store = boot({ mob_cell: FAR_CELL - 1 }) // no adjacency — isolate the cast-presenting gate alone
    expect(move_wash(store.getState(), {}).armed).toBe(true) // sanity: armed before the cast dispatches
    // mirrors DungeonBoard's optimistic_cast dispatch shape (a 'predicted' input carrying beats) — a real 'cast'
    // beat lands in a LOCAL wave turn exactly as the production path builds it (present.js pipeline, no 2nd vocabulary).
    store.getState().input(
      {
        type: 'predicted',
        intent_id: 'test-cast-1',
        basis_version: store.getState().applied_version + 1,
        actions: [],
        beats: local_intent_beats(
          synthetic_cast_events({ fight_id: FIGHT, caster_is_mob: false, caster_idx: 0, target_cell: ADJ_CELL }),
          { fight_id: FIGHT }
        ),
      },
      1100
    )
    const wash = move_wash(store.getState(), {})
    expect(wash.armed).toBe(false) // the MP zone disarms — no reach, no tackle band, no click-to-move
    expect(wash.reach).toEqual([])
    expect(wash.tackle_lost).toEqual([])
  })

  test('a pure WALK sequence (no cast beat) does NOT disarm the wash — D254 cumulative-move chaining stays fluid', () => {
    const store = boot({ mob_cell: FAR_CELL - 1 })
    store.getState().input(
      {
        type: 'intent',
        intent: { kind: 'move', character: CHAR, to_cell: 44, mp_left: 2 },
        beats: local_move_beats({ fight_id: FIGHT, character: CHAR, to_cell: 44, path: [{ x: 4, y: 2 }] }),
      },
      1100
    )
    expect(move_wash(store.getState(), {}).armed).toBe(true) // my own walk beat never disarms the wash
  })

  test('the arming predicate itself (moved law): my_turn ∧ ¬busy ∧ ¬presenting', () => {
    expect(turn_input_armed(true, false, false)).toBe(true)
    expect(turn_input_armed(true, true, false)).toBe(false)
    expect(turn_input_armed(true, false, true)).toBe(false)
    expect(turn_input_armed(false, false, false)).toBe(false)
  })
})

describe('placement_click — the placement-legality decision (core, adapter only relays)', () => {
  const placement_object = () => ({
    ...fight_object({ status: 0 }),
    start_cells_a: [45, 46, 47],
    participants: [
      { ...fight_object().participants[0], cell: 45, ready: false },
      {
        owner: '0xbbb',
        character: CHAR2,
        class: 'senshi',
        team: 0,
        ap: 6,
        mp: 3,
        base_ap: 6,
        base_mp: 3,
        hp: 50,
        max_hp: 50,
        cell: 46,
        stats: { agility: 40 },
      },
    ],
  })
  const boot_placement = () => {
    const store = create_fight_store()
    store.getState().input({ type: 'init', fight_id: FIGHT, ctx: { my_entity_id: CHAR } }, 1000)
    store.getState().input({ type: 'snapshot', fight: placement_object(), version: 5 }, 1000)
    return store
  }

  test('a FREE start cell of my team is a pick', () => {
    expect(placement_click(boot_placement().getState(), { x: 7, y: 2 })).toBe('pick') // 47 free
  })
  test('a start cell TAKEN by another living fighter is a deny', () => {
    expect(placement_click(boot_placement().getState(), { x: 6, y: 2 })).toBe('deny') // 46 = CHAR2
  })
  test('my OWN current cell re-picks (self never occupies against itself)', () => {
    expect(placement_click(boot_placement().getState(), { x: 5, y: 2 })).toBe('pick') // 45 = me
  })
  test('off the start zone is a deny', () => {
    expect(placement_click(boot_placement().getState(), { x: 10, y: 10 })).toBe('deny')
  })
  test('a non-placement fight yields null (the relay does nothing)', () => {
    expect(placement_click(boot().getState(), { x: 7, y: 2 })).toBe(null)
  })
})
