// D3a — TACKLE PAINT = THE EXACT CHAIN CONTEST — the red band must match the chain's actual contest: a
// player who saw red but tried to move anyway must NOT walk free. A PLAYER move's tackle roll is DETERMINISTIC + CLIENT-
// PREVIEWABLE (actions.move apply_move: `spell_formula::tackle_seed(fight::turn_seed(fight, seat), slot, mp)`
// → `prng::rng_next(seed)` → `draw % den < num`; client mirror golden-pinned by sim test/tackle_golden.test.js).
// So the wash must PREVIEW the outcome, never paint a probability band:
//   · next roll ESCAPES → NOT tackled, no red band, full MP reach (no more
//     "red then walked free" lie);
//   · next roll FAILS   → tackled, and the red band = exactly the MP the folded failure chain WILL eat
//     (each denied attempt strips ceil(mp·lost/den) ≥ 1 MP and reprices the next roll at the lower MP —
//     moves never advance the slot), green = what the first ESCAPING attempt still reaches.
// The tackle-paint law reads exact under determinism: "the MP we can't spend or WILL loose by
// trying" — will, not might. A view without world_seed/spawn_id (legacy read) keeps the risk-band fallback
// (move_wash.test.js pins it — its fixture carries no seeds on purpose).
//
// Vectors below were derived with the golden-pinned mirror itself (turn_seed/tackle_seed/rng_next) at
// deadline 90 000, seat 0, agility 40 vs 40 (num/den = 6/12), mp 3, ap 6:
//   ws=6  sid=7 slot=0 → roll 0 → ESCAPE
//   ws=1  sid=7 slot=0 → roll 7 → FAIL (mp_lost 2) → mp 1 → roll ESCAPES → final_mp 1
//   ws=4  sid=7 slot=0 → roll 9 → FAIL → mp 1 → roll 8 → FAIL (mp_lost 1) → mp 0 (exhausted)
//   ws=1  sid=7 slot=1 → roll 2 → ESCAPE   (the SAME fight escapes once a cast is drafted — slot input)
//   ws=6  sid=7 slot=1 → roll 6 → FAIL     (and the escaping fight starts biting — both directions)

import { describe, expect, test } from 'bun:test'

import { move_wash } from '../src/project.js'
import { create_fight_store } from '../src/store.js'

const FIGHT = '0xf1'
const CHAR = '0xc1'

// GRID_W = 20. me p0 at (5,2)=45; mob m0 ADJACENT at (6,2)=46; mob m1 far at (10,10)=210.
const ME_CELL = 45
const ADJ_CELL = 46
const FAR_CELL = 210
// the 1-MP reach around 45 with the adjacent mob on 46: 44 (x−1), 25 (y−1), 65 (y+1).
const ONE_MP_REACH = [25, 44, 65]

const fight_object = ({ world_seed = null, spawn_id = null, my_agility = 40, mob_agility = 40 } = {}) => ({
  id: FIGHT,
  status: 1,
  width: 20,
  height: 19,
  world_seed,
  spawn_id,
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
      casts_this_turn: 0,
      stats: { agility: my_agility },
    },
  ],
  mobs: [
    {
      template: '0xabc',
      hp: 30,
      max_hp: 30,
      cell: ADJ_CELL,
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

/** The full 3-MP reach on this exact board (same geometry, contest certain-escape via agility 100 vs 10). */
const full_reach = () => new Set(move_wash(boot({ my_agility: 100, mob_agility: 10 }).getState(), {}).reach)

describe('move_wash — deterministic tackle preview (the exact chain contest, D3a)', () => {
  test('preview ESCAPES (ws=6): NOT tackled, no red band, the full MP reach paints', () => {
    const wash = move_wash(boot({ world_seed: 6, spawn_id: 7 }).getState(), {})
    expect(wash.tackled).toBe(false)
    expect(wash.tackle_lost).toEqual([])
    expect(new Set(wash.reach)).toEqual(full_reach())
  })

  test('preview FAILS once then escapes (ws=1): tackled, green = the exact post-bite 1-MP reach, red = the remainder', () => {
    const wash = move_wash(boot({ world_seed: 1, spawn_id: 7 }).getState(), {})
    expect(wash.tackled).toBe(true)
    expect([...wash.reach].sort((a, b) => a - b)).toEqual(ONE_MP_REACH)
    const full = full_reach()
    const red = new Set(wash.tackle_lost)
    for (const c of ONE_MP_REACH) expect(red.has(c)).toBe(false)
    expect(red.size).toBe(full.size - ONE_MP_REACH.length)
    for (const c of red) expect(full.has(c)).toBe(true)
  })

  test('preview exhausts MP (ws=4): tackled, NO green left, the whole reach is the red band', () => {
    const wash = move_wash(boot({ world_seed: 4, spawn_id: 7 }).getState(), {})
    expect(wash.tackled).toBe(true)
    expect(wash.reach).toEqual([])
    expect(new Set(wash.tackle_lost)).toEqual(full_reach())
  })

  test('slot input: a drafted cast intent flips the SAME fight from fail to escape (ws=1, slot 1)', () => {
    const store = boot({ world_seed: 1, spawn_id: 7 })
    store
      .getState()
      .input({ type: 'intent', intent: { kind: 'cast', target_cell: ADJ_CELL, damaging: true, ap_cost: 3 } }, 1100)
    const wash = move_wash(store.getState(), {})
    expect(wash.tackled).toBe(false)
    expect(wash.tackle_lost).toEqual([])
  })

  test('slot input, other direction: the escaping fight starts biting once a cast is drafted (ws=6, slot 1)', () => {
    const store = boot({ world_seed: 6, spawn_id: 7 })
    store
      .getState()
      .input({ type: 'intent', intent: { kind: 'cast', target_cell: ADJ_CELL, damaging: true, ap_cost: 3 } }, 1100)
    const wash = move_wash(store.getState(), {})
    expect(wash.tackled).toBe(true)
    expect(wash.tackle_lost.length).toBeGreaterThan(0)
  })

  test('degraded view (no world_seed/spawn_id): the risk-band fallback still paints (never a silent no-band)', () => {
    const wash = move_wash(boot().getState(), {}) // seeds null — equal agility ⇒ mp_lost 2 > 0 ⇒ band
    expect(wash.tackled).toBe(true)
    expect(wash.tackle_lost.length).toBeGreaterThan(0)
  })
})
