// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// INSTRUMENT + PROOF for reported mob-walk bugs:
//   (1) BACKTRACK — a mob "goes, falls back, and goes again" inside a single move.
//   (2) ALLY-CROSSING — a mob walks THROUGH an ally mid-move.
//
// ── The instrument (deterministic; no browser) ─────────────────────────────────────────────────────────────
// The chain event carries only the mob's FINAL cell (fight_bridge.emit_fight_deltas); the CLIENT reconstructs the
// walk via `legal_move_path` (a 4-connected BFS around `dungeon_blocked_cells` = walls ∪ EVERY OTHER living
// fighter — allies included). A shortest-path BFS is monotonic and ally-free, so NEITHER bug can be in the path
// shape. This test replays the ACTUAL playback pipeline the adapter runs for a mob turn and logs the cell
// sequence the engine would tween through, modelling `board_entities.move`'s documented construction:
//     move(id, waypoints): path = [ e.cell, ...waypoints ];  e.cell := last waypoint   (start = the rig's CURRENT cell)
//
// The named divergence: the D19 paced replay walks the mob (engine e.cell := after) but the adapter's `placed_cell`
// mirror is NOT stamped (play_move never touches it, and sync_entities SKIPPED the mob while replay_owned). The
// next reconcile therefore sees placed(before) ≠ chain-cell(after) — a FALSE drift — and `entity_fold_action`
// fires a SECOND, redundant fold-walk. That walk starts at e.cell = after but its first waypoint is adjacent to
// `before`, so the engine tweens a single STRAIGHT lerp after → wp1: the visible "fall back". This one stale-mirror
// bug produces BOTH symptoms — the bounce, AND (because that lerp is a straight non-cell-stepped segment) the
// ally-crossing.
//
// FIX (voxel_fight_adapter flush_mob_buffer): after the paced move plays, stamp placed_cell := the move's
// destination BEFORE ceding replay ownership — mirroring the sync_entities fold-walk branch, which already claims
// placed_cell before playing. With placed == chain-cell, the reconcile sees NO drift → no redundant walk.

import { describe, expect, it } from 'bun:test'
import { GRID_W, GRID_H, encode, decode } from '@aresrpg/fight/los'
import { manhattan } from '@aresrpg/sim/combat_grid'

import { legal_move_path } from '../game/screens/dungeon-grid.js'
import { create_pace_queue } from '../fight-engine/overlay_intents.js'

import { append_mob_turn_beat, entity_fold_action, mob_turn_steps, split_move_at_traps } from './voxel_fight_folds.js'

// ── a minimal, empty 20×19 board view for legal_move_path (full mask ⇒ no walls; fighters are the only blockers).
let _id = 0
const make_view = ({ mobs = [], players = [] } = {}) => {
  const shape_mask = new Set()
  for (let y = 0; y < GRID_H; y++) for (let x = 0; x < GRID_W; x++) shape_mask.add(encode(x, y))
  return {
    id: `move-playback-${_id++}`, // unique ⇒ never a stale dungeon_grid_of cache hit
    room_index: 0,
    grid_width: GRID_W,
    grid_height: GRID_H,
    shape_mask,
    obstacles: [],
    holes: [],
    // dungeon_blocked_cells reads escrow[].{alive,addr,cell} and mobs[i].{alive,cell}; index i ⇒ id `mob-${i}`.
    escrow: players.map((p) => ({ alive: true, addr: p.addr, cell: encode(p.cell.x, p.cell.y) })),
    mobs: mobs.map((m) => ({ alive: true, cell: encode(m.cell.x, m.cell.y) })),
  }
}

const path_cells = (view, id, from, to) =>
  legal_move_path(view, id, encode(from.x, from.y), encode(to.x, to.y)).map(decode)

// board_entities.move(id, waypoints): tween = [ e.cell, ...waypoints ]; e.cell snaps to the last waypoint.
// Returns this walk's SEGMENT (start-inclusive) and mutates the rig's logical cell.
const play_move_segment = (rig, waypoints) => {
  const segment = [{ ...rig.cell }, ...waypoints]
  if (waypoints.length) rig.cell = { ...waypoints[waypoints.length - 1] }
  return segment
}

// A cell C lies within the RECTANGLE the straight world-space lerp a→b sweeps — the region board_entities slides a
// body across for a non-adjacent start→wp1 jump (a cell-stepped BFS walk sweeps only adjacent cells and never this).
const sweep_contains = (a, b, c) =>
  c.x >= Math.min(a.x, b.x) && c.x <= Math.max(a.x, b.x) && c.y >= Math.min(a.y, b.y) && c.y <= Math.max(a.y, b.y)

/**
 * Replay ONE mob turn's movement playback + the trailing reconcile, exactly as the adapter sequences it.
 * `fix` toggles the placed_cell stamp the flush_mob_buffer slot performs after the paced move.
 * Returns the concatenated animated cell sequence + whether a SECOND (redundant) fold-walk fired.
 */
const replay_mob_move = (view, id, before, after, { fix }) => {
  const rig = { cell: { ...before } } // the engine's live e.cell (board_entities)
  let placed_cell = { ...before } // the adapter's placed_cell mirror (last committed rig cell)

  // 1) D19 PACED REPLAY — the chain-reconstructed legal path, played by play_move. (replay_owned ⇒ sync skips the
  //    mob, so placed_cell is NOT refreshed by a reconcile during the walk.)
  const paced = play_move_segment(rig, path_cells(view, id, before, after))
  if (fix) placed_cell = { ...after } // ← THE FIX: stamp the destination before the slot cedes replay ownership.

  // 2) THE TRAILING RECONCILE — the fold decides what to do with the mob now that replay ownership is released.
  const action = entity_fold_action(
    { id, is_player: false, cell: { ...after } },
    { winner: -1, has_entity: true, is_dying: false, walking: false, replay_owned: false, placed: placed_cell }
  )

  let refire = null
  if (action.kind === 'walk') {
    // the redundant fold-walk: reconstructs placed→chain-cell and plays from the rig's CURRENT cell (= after).
    refire = play_move_segment(rig, path_cells(view, id, placed_cell, action.to))
  }
  const animated = refire ? [...paced, ...refire] : paced
  return { animated, paced, refire, second_walk: action.kind === 'walk' }
}

// the largest single jump between consecutive animated cells; 1 for a clean cell-by-cell walk, >1 for a teleport.
const max_step = (seq) => {
  let m = 0
  for (let i = 1; i < seq.length; i++) m = Math.max(m, manhattan(seq[i - 1], seq[i]))
  return m
}

describe('mob move playback — backtrack (goes, falls back, and goes again)', () => {
  // mob-0 moves right along an empty row; no other fighter ⇒ the paced path is a clean straight walk.
  const before = { x: 2, y: 5 }
  const after = { x: 8, y: 5 }
  const view = () => make_view({ mobs: [{ cell: before }] })

  it('BEFORE fix: stale placed_cell ⇒ a redundant fold-walk bounces the mob back to the start', () => {
    const { animated, paced, second_walk } = replay_mob_move(view(), 'mob-0', before, after, { fix: false })
    // the paced replay ALONE is monotonic and correct...
    expect(max_step(paced)).toBe(1)
    // ...but the reconcile fires a SECOND walk (the divergence)...
    expect(second_walk).toBe(true)
    // ...whose start teleports the rig from `after` back toward `before` — a non-adjacent jump in the visible path.
    expect(max_step(animated)).toBeGreaterThan(1)
    // concrete evidence: the rig reaches x=8 then snaps back to x=3 (adjacent to the start x=2) and re-walks.
    const xs = animated.map((c) => c.x)
    expect(Math.max(...xs)).toBe(8) // it arrived
    const arrived_at = xs.indexOf(8)
    expect(Math.min(...xs.slice(arrived_at + 1))).toBeLessThanOrEqual(3) // then fell back
  })

  it('AFTER fix: placed_cell stamped to the destination ⇒ ONE monotonic walk, no bounce', () => {
    const { animated, second_walk } = replay_mob_move(view(), 'mob-0', before, after, { fix: true })
    expect(second_walk).toBe(false) // no redundant fold-walk
    expect(max_step(animated)).toBe(1) // every step adjacent — a clean cell-by-cell walk
    // strictly monotonic in x (2→8, never decreasing) — it never falls back.
    const xs = animated.map((c) => c.x)
    for (let i = 1; i < xs.length; i++) expect(xs[i]).toBeGreaterThanOrEqual(xs[i - 1])
    expect(xs[xs.length - 1]).toBe(8)
  })
})

describe('mob move playback — ally-crossing (mobs walk through their allies)', () => {
  // mob-0 moves DOWN a column; ally mob-1 sits ON that column between start and end.
  const before = { x: 2, y: 2 }
  const after = { x: 2, y: 8 }
  const ally = { x: 2, y: 5 } // mob-1
  const view = () => make_view({ mobs: [{ cell: before }, { cell: ally }] })

  it('the paced replay path ALWAYS routes around the ally (legal_move_path blocks living fighters)', () => {
    const paced = path_cells(view(), 'mob-0', before, after)
    expect(paced.some((c) => c.x === ally.x && c.y === ally.y)).toBe(false)
    // and it is a real cell-by-cell walk (adjacent steps) to the true destination.
    expect(max_step([before, ...paced])).toBe(1)
    expect(paced[paced.length - 1]).toEqual(after)
  })

  it('BEFORE fix: the redundant fold-walk teleport-jumps after→wp1, sliding a body across the ally region', () => {
    const { refire, second_walk } = replay_mob_move(view(), 'mob-0', before, after, { fix: false })
    expect(second_walk).toBe(true)
    // the re-fired walk starts at `after` (2,8) and jumps to wp1 (adjacent to `before`), which the BFS routed to the
    // far side of the ally. board_entities tweens start→wp1 as ONE straight lerp (no waypoint between), so the body
    // slides across the whole region — including the ally's cell — instead of stepping cell-by-cell around it.
    const [start, wp1] = refire
    expect(manhattan(start, wp1)).toBeGreaterThan(1) // a non-adjacent teleport-jump (never a real cell-step)
    expect(sweep_contains(start, wp1, ally)).toBe(true) // whose swept rectangle contains the ally it slides over
  })

  it('AFTER fix: no redundant walk ⇒ ONLY the cell-by-cell paced path plays, never entering the ally cell', () => {
    const { animated, second_walk } = replay_mob_move(view(), 'mob-0', before, after, { fix: true })
    expect(second_walk).toBe(false)
    expect(animated.some((c) => c.x === ally.x && c.y === ally.y)).toBe(false) // ally cell never a waypoint
    expect(max_step(animated)).toBe(1) // every step adjacent — no teleport-jump slides over anything
  })
})

// ── SEPARATE FINDING (not fixed by this movement/tween lane) ─────────────────────────────────────────────────
// A second, cell-EXACT ally-crossing exists upstream of the tween: `emit_fight_deltas` (packages/frontend/src/
// world-shell/fight_bridge.js:645) reconstructs EVERY acted mob's path against the poll's FINAL snapshot, but the
// D19 pacer plays the mob slots SERIALLY (~3s each). So an earlier-moving mob's path — computed as if the later
// movers had already vacated their start cells — steps straight onto a cell where a later mob STILL visibly stands.
// The chain is innocent (combat_grid.move:32,87 blocks occupied cells); the fix is client-side, in fight_bridge:
// reconstruct each acted mob's path against the board state AT ITS TURN (turn-ordered occupancy), not the final
// snapshot. This test CHARACTERIZES the finding so it isn't lost; it will flip when fight_bridge is corrected.
// ── SERIAL QUEUE LAW: "a single queue per turn, NOTHING in parallel ever" ───────────────────────────────────────────
// The D19 pacer (create_pace_queue) is a strictly serial runner, and the flush_mob_buffer slot drains a turn as
//   if (move) await play_move(move);  if (cast) await play_cast(cast)
// so the move tween FULLY settles before the cast VFX is even called, and no two mobs' slots overlap. This test
// drives the REAL pace queue with that exact drain pattern and captures the ordered event log this proof needs.
describe('mob turn playback is one serial queue (move completes before the cast VFX starts)', () => {
  const tick = () => new Promise((r) => setTimeout(r, 1)) // a real async gap so a missing `await` would interleave

  it('within a mob turn: move:start → move:end → cast:start → cast:end (never overlapping)', async () => {
    const log = []
    const play_move = async () => {
      log.push('move:start')
      await tick()
      log.push('move:end')
    }
    const play_cast = async () => {
      log.push('cast:start')
      await tick()
      log.push('cast:end')
    }
    // the exact flush_mob_buffer slot body (move awaited, THEN cast).
    const q = create_pace_queue({ min_ms: 0 })
    // await the queue's OWN drained signal (run's promise settles after the slot + its floor) — never a
    // wall-clock window, which samples the log mid-drain under load (#769).
    await q.run(async () => {
      await play_move()
      await play_cast()
    })
    expect(log).toEqual(['move:start', 'move:end', 'cast:start', 'cast:end'])
    // the load-bearing guarantee: the cast VFX is not even CALLED until the move has fully ended.
    expect(log.indexOf('cast:start')).toBeGreaterThan(log.indexOf('move:end'))
  })

  it('across a mob cascade: each mob’s turn drains fully before the next begins (no parallel turns)', async () => {
    const log = []
    const slot = (mob) => async () => {
      log.push(`${mob}:move:start`)
      await tick()
      log.push(`${mob}:move:end`)
      log.push(`${mob}:cast:start`)
      await tick()
      log.push(`${mob}:cast:end`)
    }
    const q = create_pace_queue({ min_ms: 0 })
    void q.run(slot('mob-0'))
    // buffered behind mob-0; the serial queue never overlaps them, so mob-1's drained signal is the cascade's.
    await q.run(slot('mob-1'))
    // mob-0's whole turn precedes any of mob-1's beats.
    expect(log).toEqual([
      'mob-0:move:start',
      'mob-0:move:end',
      'mob-0:cast:start',
      'mob-0:cast:end',
      'mob-1:move:start',
      'mob-1:move:end',
      'mob-1:cast:start',
      'mob-1:cast:end',
    ])
  })

  it('drains the actor’s full duplicate-preserving cast list before any mob action', async () => {
    const log = []
    const player = create_pace_queue({ min_ms: 0 })
    const mobs = create_pace_queue({ min_ms: 0 })
    const cast = (label) => async () => {
      log.push(`${label}:start`)
      await tick()
      log.push(`${label}:end`)
    }
    void player.run(cast('player:same-spell:1'))
    void player.run(cast('player:same-spell:2'))
    const player_list_done = player.run(() => {}) // adapter's captured barrier

    let turn = append_mob_turn_beat(null, 'move', { kind: 'move', label: 'mob:move' })
    turn = append_mob_turn_beat(turn, 'cast', { kind: 'cast', label: 'mob:same-spell:1' })
    turn = append_mob_turn_beat(turn, 'cast', { kind: 'cast', label: 'mob:same-spell:2' })
    // the mob slot gates on the player's barrier, so its drained signal is the whole chain's (#769).
    await mobs.run(async () => {
      await player_list_done
      for (const step of mob_turn_steps(turn)) await cast(step.label)()
    })

    expect(log).toEqual([
      'player:same-spell:1:start',
      'player:same-spell:1:end',
      'player:same-spell:2:start',
      'player:same-spell:2:end',
      'mob:move:start',
      'mob:move:end',
      'mob:same-spell:1:start',
      'mob:same-spell:1:end',
      'mob:same-spell:2:start',
      'mob:same-spell:2:end',
    ])
  })
})

describe('mob move playback — cascade-timing ally-crossing (FINDING: fight_bridge path reconstruction)', () => {
  it('an earlier mob, pathed vs FINAL positions, steps onto a later mob’s not-yet-vacated cell', () => {
    const b1 = { x: 4, y: 5 } // mob-1 stands here during mob-0's slot (it moves later, to (4,1))
    // the FRESH view the reconstruction sees = FINAL positions: mob-0 at its dest, mob-1 already at (4,1).
    const final_view = make_view({ mobs: [{ cell: { x: 8, y: 5 } }, { cell: { x: 4, y: 1 } }] })
    const mob0_path = path_cells(final_view, 'mob-0', { x: 1, y: 5 }, { x: 8, y: 5 })
    // reconstructed straight across row 5 — because (4,5) reads FREE in the final snapshot — so it walks THROUGH the
    // cell mob-1 still occupies while mob-0's slot plays. (After the fight_bridge fix this expectation flips to false.)
    expect(mob0_path.some((c) => c.x === b1.x && c.y === b1.y)).toBe(true)
  })
})

// ── [trap-on-mob] the PAUSE→trigger→RESUME sequencing proof (walking into a trap
//    marks a pause client-side so it displays the hit animation, then resumes the move right after).
//    This drives the REAL split_move_at_traps through the EXACT loop voxel_fight_adapter.play_move runs — mock
//    board tween + mock trap trigger (mirroring play_trap_trigger's observable beats) — through the REAL serial
//    pace queue, and captures a high-res timestamped recorder proving pause < vfx < resume. Same modelling law
//    as the move-playback tests above: the pure sequencing is provable headless; the pixels ride the live
//    Playwright rig (__ARES_DEV_SYNTH_TRAP). ──
describe('mob trap crossing — walk PAUSES at the trap cell, triggers, then RESUMES', () => {
  const tick = () => new Promise((r) => setTimeout(r, 5)) // a real async gap (a missing await would reorder)
  const path = [
    { x: 8, y: 6 },
    { x: 7, y: 6 }, // the trap cell (index 1) — mid-path, so a RESUME leg follows
    { x: 6, y: 6 },
  ]
  const trap_hits = [{ index: 1, cell: { x: 7, y: 6 }, damage: 15 }]

  // drive play_move's EXACT trap loop with recording mocks through the REAL serial pace queue.
  const drive = async () => {
    const events = /** @type {{ ev: string; t: number; cell?: any; damage?: number }[]} */ ([])
    const t0 = performance.now()
    const stamp = (ev, extra = {}) => events.push({ ev, t: performance.now() - t0, ...extra })
    // mock board.entity_move: the tween to a segment's end (records the arrival cell), resolves after a real gap.
    const entity_move = async (seg) => {
      stamp('walk', { cell: seg[seg.length - 1] })
      await tick()
    }
    // mock play_trap_trigger: PAUSE at the cell → burst VFX + damage floater → (flinch beat) → RESUME — the exact
    // observable order voxel_fight_adapter.play_trap_trigger emits (game_log PAUSE / trap VFX+floater / RESUME).
    const play_trap_trigger = async (hit) => {
      stamp('pause', { cell: hit.cell })
      stamp('vfx', { cell: hit.cell }) // burst_vfx('earth') at the trap cell
      stamp('floater', { damage: hit.damage }) // entity_beat hit + { text: '-15' }
      await tick() // the flinch beat plays out
      stamp('resume')
    }
    const q = create_pace_queue({ min_ms: 0 })
    await q.run(async () => {
      // THE play_move loop, verbatim in shape (real split_move_at_traps).
      for (const step of split_move_at_traps(path, trap_hits)) {
        if (step.walk.length) await entity_move(step.walk)
        if (step.trap) await play_trap_trigger(step.trap)
      }
    })
    return events
  }

  it('emits walk→pause→vfx→floater→resume→walk IN ORDER, arriving at the trap cell before pausing', async () => {
    const events = await drive()
    expect(events.map((e) => e.ev)).toEqual(['walk', 'pause', 'vfx', 'floater', 'resume', 'walk'])
    // the mob ARRIVED at the trap cell before the trigger (the pause is AT the crossing, never before/after it).
    expect(events[0].cell).toEqual({ x: 7, y: 6 })
    expect(events[1].cell).toEqual({ x: 7, y: 6 })
    // the floater carries the real chain damage the crab "took but never showed".
    expect(events[3].damage).toBe(15)
    // the RESUME leg walks past the trap to the true destination (the move continues — not truncated).
    expect(events[5].cell).toEqual({ x: 6, y: 6 })
  })

  it('timestamps prove PAUSE < VFX < RESUME (the contract ordering, high-res)', async () => {
    const events = await drive()
    const t = (ev) => events.find((e) => e.ev === ev).t
    expect(t('pause')).toBeLessThan(t('vfx'))
    expect(t('vfx')).toBeLessThan(t('resume'))
    // and the resume WALK lands strictly after the resume signal (the move genuinely continues afterwards).
    const resume_t = t('resume')
    const last_walk = events.filter((e) => e.ev === 'walk').at(-1)
    expect(last_walk.t).toBeGreaterThan(resume_t)
  })
})
