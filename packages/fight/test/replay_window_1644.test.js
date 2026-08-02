// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #1644 — "killed a mob, turned invisible, then could not move — tackled — despite invisibility; the NEXT turn
// the tackle was gone. Same turn start, the timer showed 6s where the expected minimum is 3s."
//
// ADJUDICATION of the tackle half (the row asks for it before any fix): the client's movement gate CANNOT be
// reading a corpse as a locker. `tackle_lockers` (project.js) scans `presented_state`, and the board's own
// rendered liveness is DERIVED from that same fold — `engine_view`'s `dead` is `!death_hold.has(id) && !f.alive`
// (project_views.js), where `f` IS the presented fighter. The death-presenting hold only ever makes a corpse
// render ALIVE for longer than the fold says; it can never make the board show a body dead while the gate still
// counts it. So "board dead + still tackled" is UNREACHABLE through this seam, and the kill→invis→move sequence
// below pins that as a permanent invariant (roll-controlled: the survivor arm and the kill arm share one seed
// and one cast slot, so the ONLY difference between them is the mob's death).
//
// That leaves the felt bug where the row's second half already points: the turn timer. `actions::assert_min_turn`
// gates on the CHAIN's turn start, and `resolve_from` stamps `deadline = start + turn_ms + 3s×N` for the N mobs
// replayed into the turn — one killed mob makes the floor 3s + 3s = the observed 6s. Correct by chain semantics,
// and completely mute: the player reads a rule they know (3s) being broken. `min_turn_widened_ms` is the fact the
// HUD needs to say so, derived from the two clocks `min_turn_ready_at` already reconciles.

import { describe, expect, test } from 'bun:test'

import { encode } from '../src/los.js'
import * as project from '../src/project.js'
import { local_intent_beats, synthetic_cast_events } from '../src/present.js'
import { create_fight_store, presented_state, PLAYER_TURN_FLOOR_MS } from '../src/store.js'

const FIGHT = '0xf1644'
const CHAR = '0xc1644'
const GRID_W = 20
const ME_CELL = encode(5, 2)
const ADJ_CELL = encode(6, 2)
const FAR_CELL = encode(10, 10)
// ws=1 / sid=7 BITES at cast slot 1 (agility 40 vs 40 ⇒ num/den 6/12, mp 3, ap 6) — the seed both arms share.
const BITING_SEED = { world_seed: 1, spawn_id: 7 }

const fight_object = ({ world_seed, spawn_id }) => ({
  id: FIGHT,
  status: 1,
  width: GRID_W,
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
      stats: { agility: 40 },
    },
  ],
  mobs: [
    { template: '0xabc', hp: 8, max_hp: 30, cell: ADJ_CELL, ap: 4, mp: 3, level: 1, stats: { agility: 40 } },
    { template: '0xabc', hp: 30, max_hp: 30, cell: FAR_CELL, ap: 4, mp: 3, level: 1, stats: { agility: 40 } },
  ],
  queue: [
    { is_mob: false, idx: 0 },
    { is_mob: true, idx: 0 },
    { is_mob: true, idx: 1 },
  ],
  turn_ptr: 0,
  turn_deadline_ms: 90_000,
  turn_entropy: 90_000,
  turn_ordinal: 1,
})

const boot = (over = BITING_SEED) => {
  const store = create_fight_store()
  store.getState().input({ type: 'init', fight_id: FIGHT, my_key: 'p0', ctx: { my_entity_id: CHAR } }, 1_000)
  store.getState().input({ type: 'snapshot', fight: fight_object(over), version: 5 }, 1_000)
  return store
}

/** MY damaging cast on the adjacent mob — beats (the eye) + the Hit action (the fold), exactly as the board
 *  dispatches an optimistic cast. `remaining_hp` 0 kills it; anything else leaves the locker standing. */
const cast_at_locker = (store, remaining_hp) => {
  const beats = local_intent_beats(
    synthetic_cast_events({
      fight_id: FIGHT,
      caster_idx: 0,
      target_cell: ADJ_CELL,
      victims: [{ is_mob: true, idx: 0, amount: 8, remaining_hp }],
    }),
    {
      fight_id: FIGHT,
      resolve_fighter_id: ({ is_mob, idx, character }) =>
        character != null ? String(character) : is_mob ? `mob-${Number(idx)}` : CHAR,
      resolve_cast: () => ({ spell_id: 'ember_strike' }),
    }
  )
  store
    .getState()
    .input({ type: 'intent', intent: { kind: 'cast', target_cell: ADJ_CELL, damaging: true }, beats }, 2_000)
  store
    .getState()
    .input({ type: 'intent', intent: { kind: 'Hit', victim_is_mob: true, victim_idx: 0, remaining_hp } }, 2_000)
}

/** VANISH on myself — the invisibility the report was cast under. Statuses ride the fold's per-fighter rows. */
const turn_invisible = (store) =>
  store.getState().input(
    {
      type: 'intent',
      intent: {
        kind: 'StatusAdded',
        target_is_mob: false,
        target_idx: 0,
        status: { kind: 27, remaining_turns: 1, element: 255, value: 0, stat: 0, chance: 100 },
      },
    },
    2_500
  )

describe('#1644 · the tackle half — a body the board shows DEAD never locks the runner', () => {
  test('SURVIVOR arm (the control): the locker lives, so the seed’s bite stands — this is a real tackle', () => {
    const store = boot()
    cast_at_locker(store, 20)
    expect(project.next_move_tackle(store.getState())).toEqual({ ap_lost: 3, mp_lost: 2 })
  })

  test('KILL arm: same seed, same cast slot — the corpse releases the tackle in the SAME frame', () => {
    const store = boot()
    cast_at_locker(store, 0)
    // the ONLY difference from the control above is `remaining_hp`, so the released bite IS the death
    expect(project.next_move_tackle(store.getState())).toBeNull()
  })

  test('the killer’s own board and the movement gate read ONE liveness — they cannot disagree', () => {
    const store = boot()
    cast_at_locker(store, 0)
    const state = store.getState()
    // the fold the gate scans
    expect(presented_state(state).fighters.m0.alive).toBe(false)
    // …and the fold the renderer scans, through engine_view. `dead` may still be held false while the death
    // beat plays (the visual hold) — never the reverse, which is what would strand a tackle on a corpse.
    const rendered = project.engine_view(state).fighters.get('mob-0')
    expect(rendered.health).toBe(0)
    expect(rendered.dead || presented_state(state).fighters.m0.alive === false).toBe(true)
  })

  test('kill → INVISIBLE → move: the reported sequence walks free (invisibility changes nothing on its own)', () => {
    const store = boot()
    cast_at_locker(store, 0)
    turn_invisible(store)
    const state = store.getState()
    expect(project.engine_view(state).fighters.get(CHAR).invisible).toBe(true)
    expect(project.next_move_tackle(state)).toBeNull()
  })

  test('INVISIBILITY alone never exempts a runner — the chain rule (tackle.move), pinned', () => {
    const store = boot()
    cast_at_locker(store, 20) // the locker survives…
    turn_invisible(store) // …and I vanish: bodies stay physical, the contest still runs
    expect(project.next_move_tackle(store.getState())).toEqual({ ap_lost: 3, mp_lost: 2 })
  })
})

describe('#1644 · the timer half — SUPERSEDED by #1808: the widened window is waited out, not narrated', () => {
  const CHAIN_TURN_START = 1_000_000
  const TURN_MS = 45_000
  const MOB_REPLAY_MS = 3_000 // actions.move: `deadline = start + turn_ms + 3s × resolved_mobs`

  const timed_store = ({ mobs_replayed, local_edge = CHAIN_TURN_START }) => {
    const store = create_fight_store()
    store.getState().input({ type: 'init', fight_id: FIGHT, my_key: 'p0', ctx: { my_entity_id: CHAR } })
    store.getState().input(
      {
        type: 'snapshot',
        fight: {
          ...fight_object(BITING_SEED),
          turn_ms: TURN_MS,
          turn_deadline_ms: CHAIN_TURN_START + TURN_MS + mobs_replayed * MOB_REPLAY_MS,
          last_action_ms: CHAIN_TURN_START,
        },
        version: 5,
      },
      local_edge
    )
    return store
  }
  const timed = (opts) => timed_store(opts).getState()

  // #1644 shipped a HUD line explaining the widened floor ("Turn minimum 6s — the mobs that just played are
  // still resolving on chain"). #1808 is the same defect read one level down: a turn that has to be explained
  // was never handed over honestly. The line is deleted; the client now waits the chain's window out, so the
  // floor the player ever sees is the ordinary 3s and there is nothing left to narrate.

  test('ONE replayed mob: the turn is NOT yet mine — the 6s the report saw is chain resolution, not my turn', () => {
    const state = timed({ mobs_replayed: 1, local_edge: CHAIN_TURN_START })
    expect(project.turn_playable(state), 'the chain is still resolving the mob that just played').toBe(false)
    expect(state.turn_started_at, 'no turn anchor before the handover').toBe(null)
  })

  test('TWO replayed mobs widen twice — one tick short of the chain’s dial is still not my turn', () => {
    const store = timed_store({ mobs_replayed: 2 })
    store.getState().input({ type: 'tick' }, CHAIN_TURN_START + 2 * MOB_REPLAY_MS - 1)
    expect(project.turn_playable(store.getState())).toBe(false)
  })

  test('the handover lands on the chain’s own instant, and the floor from there is the plain 3s', () => {
    const store = timed_store({ mobs_replayed: 2 })
    const handover = CHAIN_TURN_START + 2 * MOB_REPLAY_MS
    store.getState().input({ type: 'tick' }, handover)
    const state = store.getState()
    expect(project.turn_playable(state)).toBe(true)
    expect(state.turn_started_at).toBe(handover)
    // The rule the player knows — 3s — is now the ONLY floor they can observe.
    expect(project.min_turn_left(state, handover)).toBe(PLAYER_TURN_FLOOR_MS)
  })

  test('no replay ⇒ the turn is playable at once, on the ordinary 3s floor', () => {
    const state = timed({ mobs_replayed: 0, local_edge: CHAIN_TURN_START })
    expect(project.turn_playable(state)).toBe(true)
    expect(project.min_turn_left(state, CHAIN_TURN_START)).toBe(PLAYER_TURN_FLOOR_MS)
  })

  test('a LATE local anchor already past the chain window hands over immediately', () => {
    const local_edge = CHAIN_TURN_START + 6 * MOB_REPLAY_MS
    const state = timed({ mobs_replayed: 2, local_edge })
    expect(project.turn_playable(state)).toBe(true)
    expect(project.min_turn_left(state, local_edge)).toBe(PLAYER_TURN_FLOOR_MS)
  })
})
