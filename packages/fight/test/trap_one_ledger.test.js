// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// trap_one_ledger.test.js — THE ONE TRAP LEDGER (#1858 · #2033).
//
// A trap used to have TWO visibility homes with different lifecycles, and JOIN HISTORY decided which one a
// client rode:
//   · the local `my_traps` ledger — event-consumed, so its marker died inside the walk-on trigger beat;
//   · the raw `ctx.chain_traps` list — read straight off the public Fight.fx board, consumed only when the next
//     checkpoint object read stopped listing it: removal WAS the adoption, no boom, and the beat producer
//     (whose trap rows are ledger rows) never emitted a `trap_trigger` at all.
// A trap the local ledger never saw — an ally's, or your own after a rejoin — therefore RENDERED but was
// invisible to prediction and cast-legality, which read the ledger alone. That is #2033's twin divergence: the
// chain detonated a trap the client's own sim door did not know existed, so the damage arrived as a silent
// post-hoc correction. (The sim's `check_traps` never carried a self/team filter — it triggers for anyone, the
// chain's `cast::trigger_on_enter` rule. The blind spot was the CORPUS, not the trigger.)
//
// The fold: the public board is ADOPTED INTO the one ledger, so render, prediction, legality and the beat
// producer all read one list and the boom is the only thing that retires a marker.

import { describe, expect, test } from 'bun:test'

import { create_fight_store } from '../src/store.js'
import { committed_truth, engine_view } from '../src/project.js'
import { evolve_draft_health } from '../src/predict_cast.js'

const FIGHT = '0xf1'
const CHAR = '0xc1'
const W = 20
const enc = (x, y) => y * W + x
const ME = enc(5, 5)
const MOB = enc(11, 5)
const TRAP = enc(9, 5) // on the mob's approach lane — a MID-PATH crossing, never its landing cell
const PAST_TRAP = enc(7, 5)
const SELF_TRAP = enc(6, 5) // inside MY OWN 3-MP walk — the own-detonation case (#2033)

const ev = (kind, fields) => ({ type: `0x0::fight_events::${kind}`, parsedJson: { fight: FIGHT, ...fields } })

const FIGHT_OBJECT = {
  id: FIGHT,
  status: 1,
  width: W,
  height: 19,
  participants: [
    {
      owner: '0xaaa',
      character: CHAR,
      class: 'senshi',
      team: 0,
      ap: 9,
      mp: 3,
      base_ap: 9,
      base_mp: 3,
      hp: 50,
      max_hp: 50,
      cell: ME,
    },
  ],
  mobs: [{ template: '0xabc', hp: 200, max_hp: 200, cell: MOB, ap: 4, mp: 4, level: 1 }],
  queue: [{ is_mob: false, idx: 0 }],
  turn_ptr: 0,
  turn_deadline_ms: 90_000,
  turn_entropy: 90_000,
  turn_ordinal: 1,
}

const chain_row = (owner_team) => ({ anchor: TRAP, owner_team, cells: [TRAP] })

/** A client that NEVER cast this trap: no `predicted` input, no local ledger row — only the public board read. */
const rejoined = (owner_team = 0, version = 5) => {
  const store = create_fight_store()
  store
    .getState()
    .input({ type: 'init', fight_id: FIGHT, my_key: 'p0', ctx: { my_entity_id: CHAR, beat_ctx: { grid_width: W } } })
  store.getState().input(
    {
      type: 'snapshot',
      fight: FIGHT_OBJECT,
      version,
      ctx: { chain_traps: [chain_row(owner_team)], chain_traps_version: version },
    },
    1_000
  )
  return store
}

const trigger_beats = (store) =>
  store.getState().wave.flatMap((turn) => turn.beats.filter((beat) => beat.kind === 'trap_trigger'))

const walk_over = (store, version) => {
  store
    .getState()
    .input({ type: 'receipt', version, receipt: { events: [ev('MobMoved', { idx: 0, to_cell: PAST_TRAP })] } }, 1_200)
  const beats = trigger_beats(store)
  for (const turn of store.getState().wave) {
    for (const [index, beat] of turn.beats.entries())
      if (beat.kind === 'trap_trigger')
        store.getState().input({
          type: 'trap_triggered',
          anchor: beat.payload.trap_anchor,
          cell: beat.payload.trap_cell,
          trigger_id: `wave:${turn.seq}:${index}`,
        })
    store.getState().input({ type: 'presented', seq: turn.seq }, 1_300)
  }
  return beats
}

describe('#1858/#2033 — the public trap board folds INTO the one ledger', () => {
  test('a trap this client never cast is PREDICTABLE, not just paintable', () => {
    const view = engine_view(rejoined().getState())
    // The render corpus and the prediction/legality corpus are ONE list. Two homes is the bug itself.
    expect(view.trap_prims).toEqual([TRAP])
    expect(view.my_traps).toEqual([TRAP])
  })

  test('its walk-on emits a trigger BEAT and the marker dies inside it', () => {
    const store = rejoined()
    const beats = walk_over(store, 7)
    // The beat producer reads ledger rows: with no adoption it saw none and paced [move, arrival] — no boom.
    expect(beats.map((beat) => Number(beat.payload.trap_cell))).toEqual([TRAP])
    // Adoption widens what I can SEE, never what I OWN: a row off the public board names no local owner, so the
    // hit renders through the neutral fallback instead of crediting me with an ally's trap.
    expect(beats.map((beat) => beat.payload.trap_owner_id)).toEqual([null])
    expect(engine_view(store.getState()).my_traps).toEqual([])
    expect(engine_view(store.getState()).trap_prims).toEqual([])
  })

  test('a STALE read still listing the consumed trap never resurrects it (the ghost)', () => {
    const store = rejoined()
    walk_over(store, 7)
    // The checkpoint object read is coarser than the event tail: the very read that detonated the trap can still
    // name it. Re-adoption of an already-consumed anchor is exactly the ghost marker the field session saw.
    store.getState().input({ type: 'ctx', ctx: { chain_traps: [chain_row(0)], chain_traps_version: 7 } })
    expect(engine_view(store.getState()).trap_prims).toEqual([])
    expect(engine_view(store.getState()).my_traps).toEqual([])
  })

  test("an ENEMY team's trap enters NEITHER home — epistemics survive the fold", () => {
    const view = engine_view(rejoined(1).getState())
    expect(view.trap_prims).toEqual([])
    expect(view.my_traps).toEqual([])
  })

  // #2033's client half. The sim door has never exempted a trap's owner (packages/sim — `check_traps` fires for
  // whoever enters, the chain's `trigger_on_enter` rule), so walking onto MY OWN trap must cost me HP in the
  // preview exactly as the chain will charge it. What used to make the chain look like the only twin that
  // triggered was the CORPUS: the door rebuilds its traps from `view.my_traps`, which the fold now fills.
  test('walking onto MY OWN trap is predicted, damage and all', () => {
    const store = create_fight_store()
    store
      .getState()
      .input({ type: 'init', fight_id: FIGHT, my_key: 'p0', ctx: { my_entity_id: CHAR, beat_ctx: { grid_width: W } } })
    store.getState().input({ type: 'snapshot', fight: FIGHT_OBJECT, version: 5 }, 1_000)
    store.getState().input(
      {
        type: 'predicted',
        basis_version: 5,
        intent_id: 'trap1',
        actions: [{ kind: 'Cast', caster_is_mob: false, caster_idx: 0, target_cell: SELF_TRAP, ap_cost: 2 }],
        beats: [{ kind: 'cast', at: 0, duration: 100, payload: {} }],
        place_traps: [{ cell: SELF_TRAP, payload: [{ type: 'DAMAGE', element: 'fire', min: 12, max: 12 }] }],
      },
      1_100
    )
    const health = evolve_draft_health({
      view: engine_view(store.getState()),
      committed: committed_truth(store.getState()),
      caster_id: CHAR,
      // 3 MP: (5,5) → SELF_TRAP → (7,5) → (8,5). The trap sits mid-path, never on the landing cell.
      actions: [{ kind: 'move', target: enc(8, 5) }],
    })
    expect(health.get(CHAR)).toBe(38) // 50 hp − the trap's own 12, on the caster
  })

  test('a genuine RE-ARM on a consumed anchor is adopted again', () => {
    const store = rejoined()
    walk_over(store, 7)
    // A LATER read (version above the consumption) that names the anchor is a new trap, not the dead one.
    store.getState().input({ type: 'ctx', ctx: { chain_traps: [chain_row(0)], chain_traps_version: 9 } })
    expect(engine_view(store.getState()).my_traps).toEqual([TRAP])
  })
})
