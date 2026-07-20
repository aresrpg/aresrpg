// S-12 §17.27 CLIENT AP BUDGET (repeated weapon-attack casts within a single turn, bounded by AP).
// The chain repeats weapon strikes / spells ONLY while AP lasts (each costs its own ap_cost; every seeded spell is
// casts_per_turn 255 = unlimited today, so AP is the sole live limiter). The client mirrors it: a turn drafts a
// QUEUE of strikes into use_dungeon_turn.cast_path, and DungeonBoard gates each on a client-side remaining-AP =
// me.ap − Σ(queued costs). This suite locks the pure, headless contract the board's castable gate + flush ride on:
//   (1) the store queue (append/pop/derive/clear — REAL store code),
//   (2) the AP-budget predicate (mirror of DungeonBoard: exactly 2 strikes at 6 AP / 3 cost, the 3rd unaffordable),
//   (3) the stacked commit batch (each queued strike → one act_weapon / act_cast, in cast_first order).
// The optimistic beat is fired 1:1 with a QUEUED (= affordable) action, so an unaffordable action drafts NOTHING
// and plays NO beat — the fix for "mobs regain health" (excess phantom beats that never committed, folding back).

import { beforeEach, describe, expect, it } from 'bun:test'

import { use_dungeon_turn } from './dungeon-turn.js'

const WEAPON = '__weapon_attack' // WEAPON_ATTACK_ID sentinel (fight.js) — kept literal to keep this test dep-free

// ── mirrors of DungeonBoard's pure accounting (the component wiring is proven in the browser harness) ──
/** The AP a single queued action costs, by its pinned spell_key (weapon → weapon.ap_cost, spell → its level ap). */
const cost_of = (spell_key, weapon_ap, spell_ap) => (spell_key === WEAPON ? weapon_ap : spell_ap)
/** remaining_ap = me.ap − Σ(queued costs), floored at 0 — what DungeonBoard's castable gate subtracts against. */
const remaining_ap = (my_ap, queue, weapon_ap, spell_ap) =>
  Math.max(0, my_ap - queue.reduce((s, e) => s + cost_of(e.spell_key, weapon_ap, spell_ap), 0))
/** castable-affordability: another strike is draftable iff the remaining AP can pay for it (+ the cpt cap for a
 *  spell; 255/0 = unlimited). This is the exact predicate that greys the socket and empties the board wash. */
const can_stack = (my_ap, queue, spell_key, weapon_ap, spell_ap) =>
  remaining_ap(my_ap, queue, weapon_ap, spell_ap) >= cost_of(spell_key, weapon_ap, spell_ap)

/** The commit batch DungeonBoard.flush_commit assembles from (move_path, cast_path): one act_weapon (kind 2) /
 *  act_cast (kind 1) per queued strike, in cast_first order (D99). Pure mirror of the action-array construction. */
const build_batch = (move_path, cast_path, cast_first) => {
  const move_actions = move_path.map((step) => ({ kind: 0, target: step }))
  const cast_actions = cast_path.map((e) =>
    e.spell_key === WEAPON ? { kind: 2, target: e.cell } : { kind: 1, target: e.cell }
  )
  return cast_first ? [...cast_actions, ...move_actions] : [...move_actions, ...cast_actions]
}

beforeEach(() => use_dungeon_turn.getState().clear_picks())

describe('§17.27 — the cast_path QUEUE (stacked strikes) store contract', () => {
  it('append_cast_step stacks entries + derives cast_target to the last cell (fight-stream / readback mirror)', () => {
    const s = use_dungeon_turn.getState()
    s.append_cast_step({ cell: 40, spell_key: WEAPON })
    s.append_cast_step({ cell: 40, spell_key: WEAPON })
    const st = use_dungeon_turn.getState()
    expect(st.cast_path).toEqual([
      { cell: 40, spell_key: WEAPON },
      { cell: 40, spell_key: WEAPON },
    ])
    expect(st.cast_target).toBe(40) // DERIVED = last(cast_path).cell
    expect(st.cast_first).toBe(true) // no move drafted first → casts ship first (D99)
  })

  it('pop_cast_step undoes the last strike + re-derives cast_target; empties reset cast_first', () => {
    const s = use_dungeon_turn.getState()
    s.append_cast_step({ cell: 40, spell_key: WEAPON })
    s.append_cast_step({ cell: 55, spell_key: 'ember' })
    s.pop_cast_step()
    let st = use_dungeon_turn.getState()
    expect(st.cast_path).toEqual([{ cell: 40, spell_key: WEAPON }])
    expect(st.cast_target).toBe(40)
    s.pop_cast_step()
    st = use_dungeon_turn.getState()
    expect(st.cast_path).toEqual([])
    expect(st.cast_target).toBeNull()
    expect(st.cast_first).toBe(false)
  })

  it('set_cast_target (compat: fight-stream + the D36 store test) still mirrors into the queue', () => {
    const s = use_dungeon_turn.getState()
    s.set_cast_target(99)
    expect(use_dungeon_turn.getState().cast_path).toEqual([{ cell: 99, spell_key: null }])
    expect(use_dungeon_turn.getState().cast_target).toBe(99)
    s.set_cast_target(null)
    expect(use_dungeon_turn.getState().cast_path).toEqual([])
    expect(use_dungeon_turn.getState().cast_target).toBeNull()
  })

  it('clear_picks wipes the cast queue (no stale strike leaks into the next turn)', () => {
    const s = use_dungeon_turn.getState()
    s.append_move_step(1)
    s.append_cast_step({ cell: 40, spell_key: WEAPON })
    s.clear_picks()
    const st = use_dungeon_turn.getState()
    expect(st.cast_path).toEqual([])
    expect(st.cast_target).toBeNull()
    expect(st.move_path).toEqual([])
  })
})

describe('§17.27 — the AP budget: exactly what the chain will accept, nothing more', () => {
  it('6 AP + a 3-cost weapon → EXACTLY 2 strikes armable, the 3rd is greyed (unaffordable → no draft, no beat)', () => {
    const MY_AP = 6
    const W_AP = 3
    const s = use_dungeon_turn.getState()
    // draft strikes ONLY while affordable — the exact loop on_cell_click runs (castable non-empty → append).
    let armed_count = 0
    for (let i = 0; i < 5; i += 1) {
      const queue = use_dungeon_turn.getState().cast_path
      if (!can_stack(MY_AP, queue, WEAPON, W_AP, 0)) break // greyed — the optimistic beat NEVER fires here
      s.append_cast_step({ cell: 40, spell_key: WEAPON })
      armed_count += 1
    }
    expect(armed_count).toBe(2) // 3 + 3 = 6 spent; the 3rd (would be 9) is refused
    expect(use_dungeon_turn.getState().cast_path.length).toBe(2)
    // the remaining AP is exhausted → a 3rd strike is unaffordable (greyed socket, empty board wash)
    expect(remaining_ap(MY_AP, use_dungeon_turn.getState().cast_path, W_AP, 0)).toBe(0)
    expect(can_stack(MY_AP, use_dungeon_turn.getState().cast_path, WEAPON, W_AP, 0)).toBe(false)
  })

  it('an unaffordable action drafts NOTHING (no queue entry ⇒ no optimistic beat ⇒ no phantom mob-heal)', () => {
    const s = use_dungeon_turn.getState()
    s.append_cast_step({ cell: 40, spell_key: WEAPON }) // 3 of 4 AP spent
    expect(can_stack(4, use_dungeon_turn.getState().cast_path, WEAPON, 3, 0)).toBe(false) // 1 left < 3 → no 2nd
  })

  it('a 4-cost spell at 6 AP → only ONE cast affordable (mixed budgets price per action)', () => {
    expect(can_stack(6, [], 'ember', 3, 4)).toBe(true)
    expect(can_stack(6, [{ cell: 7, spell_key: 'ember' }], 'ember', 3, 4)).toBe(false) // 6−4=2 < 4
  })
})

describe('§17.27 — the stacked commit batch (one act per queued strike, cast_first order)', () => {
  it('2 stacked weapon strikes ship as TWO {kind:2} actions', () => {
    const s = use_dungeon_turn.getState()
    s.append_cast_step({ cell: 40, spell_key: WEAPON })
    s.append_cast_step({ cell: 40, spell_key: WEAPON })
    const { move_path, cast_path, cast_first } = use_dungeon_turn.getState()
    expect(build_batch(move_path, cast_path, cast_first)).toEqual([
      { kind: 2, target: 40 },
      { kind: 2, target: 40 },
    ])
  })

  it('MOVE then two strikes → [move, strike, strike] (moves first, casts validate from the post-move cell)', () => {
    const s = use_dungeon_turn.getState()
    s.append_move_step(10)
    s.append_cast_step({ cell: 40, spell_key: WEAPON })
    s.append_cast_step({ cell: 41, spell_key: WEAPON })
    const { move_path, cast_path, cast_first } = use_dungeon_turn.getState()
    expect(cast_first).toBe(false)
    expect(build_batch(move_path, cast_path, cast_first)).toEqual([
      { kind: 0, target: 10 },
      { kind: 2, target: 40 },
      { kind: 2, target: 41 },
    ])
  })

  it('strike then MOVE → [strike, move] (D99: the cast validated from the pre-move cell ships first)', () => {
    const s = use_dungeon_turn.getState()
    s.append_cast_step({ cell: 40, spell_key: WEAPON })
    s.append_move_step(10)
    const { move_path, cast_path, cast_first } = use_dungeon_turn.getState()
    expect(cast_first).toBe(true)
    expect(build_batch(move_path, cast_path, cast_first)).toEqual([
      { kind: 2, target: 40 },
      { kind: 0, target: 10 },
    ])
  })
})
