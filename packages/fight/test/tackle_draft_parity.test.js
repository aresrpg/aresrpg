// DRAFTED-SEQUENCE TACKLE PARITY (#24, bug reports ⑥ + ⑭) — the client's move legality MUST obey the D99
// COMMIT order, not the draft-fold order. THE CHAIN IS THE ORACLE:
//
//  · A turn is ONE PTB shipped in cast_first COMMIT order (sdk/fight.js commit_turn_ptb:628-654; the flag
//    dungeon-turn.js:53 — TRUE iff the FIRST cast was drafted BEFORE the first move):
//        cast_first=TRUE  ⇒ [...casts, ...moves]   cast_first=FALSE ⇒ [...moves, ...casts]
//  · Each act_ entry reads LIVE state. act_move prices its tackle at the runner's CURRENT cell against the
//    enemies adjacent RIGHT THEN, with slot = participant::casts_this_turn AT execution (actions.move:40-59;
//    tackle.move:17-49 scans the runner's live neighbours; seed = spell_formula::tackle_seed(turn_seed, slot, mp)).
//  · Therefore under cast_first=FALSE a move executes BEFORE any drafted cast: it sees (a) casts_this_turn = 0
//    (no cast ran yet — SLOT 0), and (b) every enemy at its PRE-cast cell (no drafted push has displaced it yet).
//
// HEAD BUG: project.js next_move_tackle reads presented_state (draft-order fold of ALL intents) and
// my_next_move_slot counts EVERY drafted Cast — so a move drafted BEFORE a cast is still priced with that cast's
// slot bump AND its displacement. Result: the client shows the move FREE while the chain tackles it.

import { describe, expect, test } from 'bun:test'
import { tackle_contest, tackle_losses, tackle_seed, turn_seed, rng_next, rng_seed } from '@aresrpg/sim'

import { next_move_tackle } from '../src/project.js'
import { create_fight_store } from '../src/store.js'

const FIGHT = '0xf1'
const CHAR = '0xc1'
const DEADLINE = 90_000

// me starts at 45; mob0 sits at 46 (adjacent to 45); mob1 sits at 26 (adjacent to 25 — the cell me lands on
// after a one-row-up move). width 20, agility 40 vs 40 (the golden tackle_preview vector).
const fight_object = ({ world_seed, spawn_id, mob0 = 46, mob1 = 26 }) => ({
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
      cell: 45,
      casts_this_turn: 0,
      stats: { agility: 40 },
    },
  ],
  mobs: [
    { template: '0xabc', hp: 30, max_hp: 30, cell: mob0, ap: 4, mp: 3, level: 1, stats: { agility: 40 } },
    { template: '0xabc', hp: 30, max_hp: 30, cell: mob1, ap: 4, mp: 3, level: 1, stats: { agility: 40 } },
  ],
  queue: [
    { is_mob: false, idx: 0 },
    { is_mob: true, idx: 0 },
    { is_mob: true, idx: 1 },
  ],
  turn_ptr: 0,
  turn_deadline_ms: DEADLINE,
})

const boot = (o) => {
  const s = create_fight_store()
  s.getState().input({ type: 'init', fight_id: FIGHT, ctx: { my_entity_id: CHAR } }, 1000)
  s.getState().input({ type: 'snapshot', fight: fight_object(o), version: 5 }, 1000)
  return s
}

// draft MY move (windowed Moved intent) — relocates me; presented me.cell/mp update THIS fold.
const draft_move = (s, { to_cell, mp_left }, now) =>
  s.getState().input({ type: 'intent', intent: { kind: 'move', character: CHAR, to_cell, mp_left } }, now)

// draft MY cast — a Cast (slot bump) plus optional Displaced (a push) folded as ONE 'predicted' composite, the
// exact shape optimistic_cast ships (basis_version = applied_version+1, ABOVE the view so recompute keeps it).
const draft_cast = (s, { displace = null } = {}, now) => {
  const actions = [{ kind: 'cast', target_cell: 26, damaging: false }]
  if (displace)
    actions.push({ kind: 'Displaced', target_is_mob: true, target_idx: displace.idx, to_cell: displace.to_cell })
  s.getState().input({ type: 'predicted', intent_id: `cast:${FIGHT}:1`, basis_version: 6, actions }, now)
}

// THE CHAIN ORACLE for one move's tackle: escape iff draw%den<num, else the exact tackle_losses forfeit — the
// byte twin of actions.move:52-58 / tackle.move:57-67, evaluated at the given commit-order slot.
const chain_tackle = ({ world_seed, spawn_id, seat = 0, mp, ap, agility = 40, lockers = [40], slot }) => {
  const tseed = turn_seed({ world_seed, spawn_id, turn_deadline_ms: DEADLINE, seat })
  const { num, den } = tackle_contest(agility, lockers)
  const draw = rng_next(rng_seed(tackle_seed(tseed, slot, mp))).value
  return draw % den < num ? null : tackle_losses(ap, mp, num, den)
}

describe('#24 drafted-sequence tackle parity — legality obeys the D99 commit order', () => {
  // ── cast_first = FALSE (move drafted before cast): the chain commits [...moves, ...casts] ─────────────────
  // ws=2 at mp=2: the chain's slot-0 roll FAILS (a tackle); the drafted cast's slot-1 roll ESCAPES. HEAD prices
  // the move at slot 1 → shows it FREE → "frontend legal, chain fails".
  test('SLOT — move→cast→move: move2 is priced at chain slot 0, NOT the drafted cast’s slot 1', () => {
    const s = boot({ world_seed: 2, spawn_id: 7 })
    draft_move(s, { to_cell: 25, mp_left: 2 }, 1500) // me 45→25 (1 MP); mob1@26 still locks me
    draft_cast(s, {}, 1600) // a plain cast — commits AFTER move2 under cast_first=FALSE, so it must NOT bump the slot
    const oracle = chain_tackle({ world_seed: 2, spawn_id: 7, mp: 2, ap: 6, slot: 0 })
    expect(oracle).not.toBeNull() // guard: this vector really is a chain tackle
    expect(next_move_tackle(s.getState())).toEqual(oracle)
  })

  // A drafted PUSH commits AFTER the move (cast_first=FALSE), so move2 sees the mob at its PRE-push cell.
  test('DISPLACEMENT — move→push→move: move2 sees the mob at its PRE-push cell (push commits after the move)', () => {
    const s = boot({ world_seed: 2, spawn_id: 7 })
    draft_move(s, { to_cell: 25, mp_left: 2 }, 1500)
    draft_cast(s, { displace: { idx: 1, to_cell: 210 } }, 1600) // push mob1 26→210 (far) — but it commits AFTER move2
    const oracle = chain_tackle({ world_seed: 2, spawn_id: 7, mp: 2, ap: 6, slot: 0 }) // mob1 STILL at 26 for move2
    expect(oracle).not.toBeNull()
    expect(next_move_tackle(s.getState())).toEqual(oracle)
  })

  // ── cast_first = TRUE (cast drafted before move): the chain commits [...casts, ...moves] — UNCHANGED ──────
  test('REGRESSION cast-first push→move: the move sees the pushed mob gone — no tackle', () => {
    const s = boot({ world_seed: 1, spawn_id: 7 })
    draft_cast(s, { displace: { idx: 0, to_cell: 209 } }, 1500) // push mob0 46→209 BEFORE any move → cast_first=TRUE
    expect(next_move_tackle(s.getState())).toBeNull() // mob0 gone, mob1@26 not adjacent to me@45 → free
  })

  test('REGRESSION cast-first cast→move (mob stays adjacent): move is priced at slot 1 (the cast committed first)', () => {
    const s = boot({ world_seed: 1, spawn_id: 7 }) // ws=1 @ mp3: slot0 tackles, slot1 escapes
    draft_cast(s, {}, 1500) // a slot-bumping cast BEFORE any move → cast_first=TRUE → the move sees casts_this_turn=1
    const oracle = chain_tackle({ world_seed: 1, spawn_id: 7, mp: 3, ap: 6, slot: 1 })
    expect(oracle).toBeNull() // slot 1 escapes here — proves the cast IS counted (not wrongly dropped)
    expect(next_move_tackle(s.getState())).toEqual(oracle)
  })
})
