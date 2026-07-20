// D36 — AUTO-COMMIT AT TIMER EXPIRY + D254 CUMULATIVE MOVE. An UNCOMMITTED move/cast draft must
// AUTO-COMMIT the SAME batch the confirm button fires when the 90s turn deadline hits (never silently discarded);
// an IDLE turn (no draft) does NOTHING — the public post-expiry pass_turn (fight-liquidation) is the bystander
// path. DungeonBoard's `auto_flush` reads the LIVE draft off use_dungeon_turn and, iff a draft exists
// (`move_path.length > 0 || ct != null`), ships it via `flush_commit`.
//
// D254 (1.29 cumulative move): the move draft is a PATH of step cells (`move_path`) — EACH drafted step ships as
// its OWN {kind:0} action, because commit_turn_core's apply_move loop charges bfs_path_cost PER segment from the
// running cell. Shipping ONE direct move to the final cell would UNDER-charge a wandering path (the client showed
// Σ segments spent, the chain would charge only the direct cost → a JS↔chain MP mismatch). The batch ORDER
// honours `cast_first` (D99: a cast drafted BEFORE the first move commits as [cast, …moves], validated from the
// pre-move cell; move-first commits as [...moves, cast]). This suite locks the pure store contract the auto-commit
// rides on — the draft PATH + its per-segment mapping + temporal ordering — headlessly (zustand, no React, no
// chain). The timer/fire-time plumbing is React glue proven correct by inspection.

import { beforeEach, describe, expect, it } from 'bun:test'

import { use_dungeon_turn } from './dungeon-turn.js'

/** The exact batch DungeonBoard.flush_commit assembles from a (move_path, cast) draft — kind 0 = move (ONE action
 *  per drafted step, in click order), kind 1 = cast. Order honours cast_first (D99). Pure mirror of flush_commit's
 *  action-array construction; the cast's on-chain `spell_id` (a class-seed cosmetic, not store state) is asserted
 *  elsewhere, so this focuses the step-mapping + ordering contract without the JSX. */
const build_batch = (move_path, ct, cast_first) => {
  const move_actions = move_path.map(step => ({ kind: 0, target: step }))
  const actions = []
  if (!cast_first) actions.push(...move_actions) // move-first drafts: cast validates from the POST-move (final) cell
  if (ct != null) actions.push({ kind: 1, target: ct })
  if (cast_first) actions.push(...move_actions) // D99: the moves ride AFTER the earlier cast
  return actions
}

/** The auto-commit DECISION: DungeonBoard.auto_flush fires flush_commit iff a draft exists, else nothing (pass_turn
 *  is the bystander). Mirrors `move_path.length > 0 || ct != null`. */
const has_draft = (move_path, ct) => move_path.length > 0 || ct != null

beforeEach(() => {
  use_dungeon_turn.getState().clear_picks()
})

describe('D36/D254 — the draft the deadline auto-commit ships (use_dungeon_turn ordering)', () => {
  it('MOVE then CAST → cast_first=false → batch commits [move, cast] (cast validates from the post-move cell)', () => {
    const s = use_dungeon_turn.getState()
    s.set_move_target(42)
    s.set_cast_target(99)
    const { move_path, cast_target, cast_first } = use_dungeon_turn.getState()
    expect(cast_first).toBe(false)
    expect(build_batch(move_path, cast_target, cast_first)).toEqual([
      { kind: 0, target: 42 },
      { kind: 1, target: 99 },
    ])
  })

  it('CAST then MOVE → cast_first=true → batch commits [cast, move] (D99: the cast validated from the pre-move cell)', () => {
    const s = use_dungeon_turn.getState()
    s.set_cast_target(99) // cast drafted FIRST (no move yet)
    s.set_move_target(42) // then a move
    const { move_path, cast_target, cast_first } = use_dungeon_turn.getState()
    expect(cast_first).toBe(true)
    expect(build_batch(move_path, cast_target, cast_first)).toEqual([
      { kind: 1, target: 99 },
      { kind: 0, target: 42 },
    ])
  })

  it('a MOVE-only draft ships [move]; a CAST-only draft ships [cast]', () => {
    const s = use_dungeon_turn.getState()
    s.set_move_target(7)
    let st = use_dungeon_turn.getState()
    expect(build_batch(st.move_path, st.cast_target, st.cast_first)).toEqual([{ kind: 0, target: 7 }])

    s.clear_picks()
    s.set_cast_target(8)
    st = use_dungeon_turn.getState()
    expect(build_batch(st.move_path, st.cast_target, st.cast_first)).toEqual([{ kind: 1, target: 8 }])
  })

  // D254 CORE: a multi-step move PATH ships ONE {kind:0} per drafted step, in click order — so commit_turn_core's
  // apply_move loop charges bfs_path_cost per SEGMENT (a single direct move to cell 23 would under-charge a bent
  // path). This is the JS↔contract safety contract the "MP never consumed" fix (D254) rests on.
  it('a 3-step MOVE path → ships THREE {kind:0} moves in click order (per-segment 1.29 charge)', () => {
    const s = use_dungeon_turn.getState()
    s.append_move_step(10)
    s.append_move_step(11)
    s.append_move_step(23)
    const { move_path, move_target, cast_target, cast_first } = use_dungeon_turn.getState()
    expect(move_path).toEqual([10, 11, 23])
    expect(move_target).toBe(23) // DERIVED mirror = last(move_path) (cast anchor / pick readback)
    expect(cast_first).toBe(false)
    expect(build_batch(move_path, cast_target, cast_first)).toEqual([
      { kind: 0, target: 10 },
      { kind: 0, target: 11 },
      { kind: 0, target: 23 },
    ])
  })

  it('CAST then a 2-step MOVE path → [cast, move, move] (D99 order holds across many segments)', () => {
    const s = use_dungeon_turn.getState()
    s.set_cast_target(99) // cast drafted before ANY move → cast_first
    s.append_move_step(10)
    s.append_move_step(11)
    const { move_path, cast_target, cast_first } = use_dungeon_turn.getState()
    expect(cast_first).toBe(true)
    expect(build_batch(move_path, cast_target, cast_first)).toEqual([
      { kind: 1, target: 99 },
      { kind: 0, target: 10 },
      { kind: 0, target: 11 },
    ])
  })

  it('undo (pop_move_step) drops the LAST segment from the shipped batch + re-derives move_target', () => {
    const s = use_dungeon_turn.getState()
    s.append_move_step(10)
    s.append_move_step(11)
    s.append_move_step(23)
    s.pop_move_step() // undo the last step
    const { move_path, move_target, cast_target, cast_first } = use_dungeon_turn.getState()
    expect(move_path).toEqual([10, 11])
    expect(move_target).toBe(11) // re-derived to the new last step
    expect(build_batch(move_path, cast_target, cast_first)).toEqual([
      { kind: 0, target: 10 },
      { kind: 0, target: 11 },
    ])
  })

  it('AUTO-COMMIT fires only when a draft exists — an IDLE turn commits NOTHING (pass_turn is the bystander)', () => {
    // fresh turn, no pick → auto_flush must NOT commit (has_draft false).
    const idle = use_dungeon_turn.getState()
    expect(has_draft(idle.move_path, idle.cast_target)).toBe(false)

    // a drafted (uncommitted) move → auto_flush WILL commit it at expiry, shipping the live draft (never discarded).
    use_dungeon_turn.getState().append_move_step(5)
    const drafted = use_dungeon_turn.getState()
    expect(has_draft(drafted.move_path, drafted.cast_target)).toBe(true)
    expect(build_batch(drafted.move_path, drafted.cast_target, drafted.cast_first)).toEqual([{ kind: 0, target: 5 }])
  })

  it('a fully-undone path (pop back to empty) is NOT a draft — auto-commit passes, never an empty {kind:0}', () => {
    const s = use_dungeon_turn.getState()
    s.append_move_step(5)
    s.pop_move_step()
    const st = use_dungeon_turn.getState()
    expect(st.move_path).toEqual([])
    expect(st.move_target).toBeNull() // derived mirror empties with the path
    expect(has_draft(st.move_path, st.cast_target)).toBe(false)
    expect(build_batch(st.move_path, st.cast_target, st.cast_first)).toEqual([])
  })

  it('clearing the cast pick resets cast_first (a re-drafted move-first turn is not mis-ordered as [cast, move])', () => {
    const s = use_dungeon_turn.getState()
    s.set_cast_target(3) // cast-first → cast_first true
    expect(use_dungeon_turn.getState().cast_first).toBe(true)
    s.set_cast_target(null) // un-pick the cast
    expect(use_dungeon_turn.getState().cast_first).toBe(false) // reset — a later move-first draft orders correctly
  })

  it('clear_picks() wipes the whole draft after a commit (no stale pick leaks into the next turn)', () => {
    const s = use_dungeon_turn.getState()
    s.append_move_step(1)
    s.append_move_step(2)
    s.set_cast_target(3)
    s.clear_picks()
    const st = use_dungeon_turn.getState()
    expect(st.move_path).toEqual([])
    expect(st.move_target).toBeNull()
    expect(st.cast_target).toBeNull()
    expect(st.cast_first).toBe(false)
    expect(has_draft(st.move_path, st.cast_target)).toBe(false)
  })
})

// The auto-flush FIRING conditions — two live owner bugs on the same seam (pure mirror of DungeonBoard's
// flush_commit guard `my_turn && !busy && status === STATUS_ACTIVE` + auto_flush's has_draft decision; the React
// timer plumbing is proven by inspection per this suite's contract):
//   #5 — the deadline auto-flush is RE-ENABLED: a moved-but-unended draft COMMITS before the deadline, never
//        dies to the public pass_turn crank with a SILENT optimistic rollback (a real "auto pass rolled back my move" report).
//   #3 — flush_commit REFUSES to fire into a fight that already went terminal (the killing blow settled it) —
//        begin_action would abort ENotActive (101), the scary post-victory toast.
const STATUS_ACTIVE = 1
const STATUS_WON = 3
const STATUS_FAILED = 4
const should_flush = (my_turn, busy, status) => my_turn && !busy && status === STATUS_ACTIVE

describe('#3/#5 — the auto-flush commits an active draft, never fires into a terminal fight', () => {
  it('#5 a drafted move on my ACTIVE turn → the auto-flush COMMITS the batch (never a silent rollback)', () => {
    use_dungeon_turn.getState().append_move_step(5)
    const st = use_dungeon_turn.getState()
    expect(has_draft(st.move_path, st.cast_target)).toBe(true)
    expect(should_flush(true, false, STATUS_ACTIVE)).toBe(true) // fires → the move commits before the deadline
    expect(build_batch(st.move_path, st.cast_target, st.cast_first)).toEqual([{ kind: 0, target: 5 }])
  })

  it('#3 a live draft on a WON/FAILED fight is DROPPED (begin_action 101 never fires)', () => {
    use_dungeon_turn.getState().append_move_step(5) // a draft still sits in the queue at the terminal flip
    expect(should_flush(true, false, STATUS_WON)).toBe(false)
    expect(should_flush(true, false, STATUS_FAILED)).toBe(false)
  })

  it('the guard still drops a busy tx or a not-my-turn (unchanged loud-pipeline conditions)', () => {
    expect(should_flush(false, false, STATUS_ACTIVE)).toBe(false) // not my turn
    expect(should_flush(true, true, STATUS_ACTIVE)).toBe(false) // a tx already in flight
  })
})

// ── ITEM 1 (a moved-but-uncommitted draft near turn end must still auto-commit) ──────
// DungeonBoard.auto_flush reads use_dungeon_turn.getState() AT FIRE — never a value snapshotted when the deadline
// timer was armed. So a move drafted LATE (a second before the deadline) is in the committed payload, and the
// terminal-race guard (flush_commit re-checks ACTIVE + my-turn live at fire) skips a moot commit rather than
// firing begin_action into an already-ended fight. This locks the store half: the live read reflects late edits.
describe('#1 — the deadline auto-commit reads the LIVE draft at fire (late moves are never a stale snapshot)', () => {
  it('a move APPENDED after the timer would arm is in the getState-read payload (read-at-fire, not read-at-arm)', () => {
    const s = use_dungeon_turn.getState()
    s.append_move_step(10) // drafted early — the deadline timer arms here (has_draft flips true)
    const at_arm = use_dungeon_turn.getState().move_path.slice() // what a stale snapshot WOULD have captured
    s.append_move_step(11) // ... a LATE step, "a bit before the end of the turn"
    // auto_flush reads getState() AT FIRE — so the payload is the LIVE draft, not `at_arm`.
    const at_fire = use_dungeon_turn.getState()
    expect(at_arm).toEqual([10]) // a snapshot would have dropped the late move…
    expect(at_fire.move_path).toEqual([10, 11]) // …but the live read keeps it
    expect(build_batch(at_fire.move_path, at_fire.cast_target, at_fire.cast_first)).toEqual([
      { kind: 0, target: 10 },
      { kind: 0, target: 11 },
    ])
  })

  it('a cast QUEUED a beat before the deadline also survives to the fire-time payload', () => {
    const s = use_dungeon_turn.getState()
    s.append_move_step(7)
    s.append_cast_step({ cell: 42, spell_key: 'ember' }) // late cast
    const at_fire = use_dungeon_turn.getState()
    expect(at_fire.cast_path).toEqual([{ cell: 42, spell_key: 'ember' }])
    expect(at_fire.cast_target).toBe(42) // the derived mirror has_draft keys on is live too
  })
})
