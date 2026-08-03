// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #2124 drop point B — ADOPTION MAY NOT CONSUME UNDELIVERED PRESENTATION.
//
// Live two-client drive (2026-08-03): an observing seat folded every mob beat and kept its turn timer right, but a
// partner's whole turn produced ZERO presentation — no combat-log line, no vfx. The rows replayed here are the REAL
// journal frames that fight served (`fixtures/capsules/observer_2124_peer_turns.journal.json`, with its provenance),
// so this suite decodes captured wire content rather than a model of it.
//
// THE MECHANISM. The inbox admits journal rows only ABOVE the adopted snapshot's version, and adoption purges rows
// at or below it. That is CORRECT for state — a snapshot at V already contains every row ≤ V, and re-folding would
// double-apply it — and it stays the law. But BEATS are built from the rows themselves: a snapshot carries the
// resulting board and none of the beats that explain it. So when the 4s object poll won the race to a commit's own
// version, the rows for that version arrived to a fold cursor already standing at V, died at the admission door,
// and the peer's turn played to nobody. State right, screen silent.
//
// THE RULING (issue #2124, 2026-08-03): the inbox carries TWO independent cursors — `base_version` (the fold floor,
// snapshot-truth) and `presented_version` (the presentation floor, journal-truth). A row below the fold floor still
// OWES its beats while it is above the presentation floor; it is routed to presentation-only intake, never into the
// log, so the fold can never double-apply it. The race stops being winnable rather than merely narrower. The turn it
// mints is marked `fold_inert`: it PLAYS and holds nothing — no mask, no death hold, no turn gate — because every
// row it explains is already on the board.
//
// THE ANCHOR, stated because it bounds what the last test claims: beats owed AFTER an adoption are paced against
// the adopted board — a wave can never mask below its own base (`fold.js wave_masked_fold`, "an early reveal over a
// rollback, never a regression"), so a body the snapshot has already moved is already standing there when its move
// beat plays. Every beat of this capsule is nonetheless byte-identical to the un-raced ordering, walks included:
// a chain `Moved`/`MobMoved` carries only its landing cell and the rebuilt route drops its own start
// (`fight_render_prims.reconstructed_path`), so a one-step walk reads the same from either end. A MULTI-step walk
// raced this way would collapse to its destination instead of pacing the intervening cells — the correct trade,
// since the state it explains has already landed.

import { describe, expect, test } from 'bun:test'
import { hash_state } from '@aresrpg/sim/evolve'

import { journal_to_actions } from '../src/core_inbox.js'
import { paced_wave_turns } from '../src/fold.js'
import { presenting } from '../src/project_state.js'
import { create_fight_store } from '../src/store.js'
import { committed_truth } from '../src/store_state.js'

import capture from './fixtures/capsules/observer_2124_peer_turns.journal.json' with { type: 'json' }

const { fight: FIGHT, observer: OBSERVER, peer: PEER } = capture
const BEFORE = 964090809 // the board the observing eye holds: the mob turn at seq 73-79 has landed
const RACED = 964091521 // the peer's cast commit (seq 80-84) — the version the object read races the journal to
const T0 = 2_000_000

const rows_of = (version) => capture.events.filter((row) => Number(row.version) === version)

/** One journal page, byte-shaped exactly as the walker and the SSE adapter both hand it to the door. */
const journal_input = (version) => {
  const rows = rows_of(version)
  return {
    type: 'journal',
    fight_id: FIGHT,
    page: {
      fight: FIGHT,
      events: rows.map((row) => ({
        seq: String(row.seq),
        kind: row.kind,
        data: row.data,
        digest: row.digest,
        version: String(row.version),
      })),
      journal_head: String(rows.at(-1).seq),
    },
  }
}

const participant = (owner, character, cell, hp) => ({
  owner,
  character,
  class: 'warrior',
  team: 0,
  hp,
  max_hp: 50,
  ap: 12,
  mp: 3,
  base_ap: 12,
  base_mp: 3,
  cell,
  ready: true,
  casts_this_turn: 0,
  weapon: null,
})

const mob = (cell) => ({ template: '0xmob_t', level: 3, hp: 60, max_hp: 60, cell, ap: 6, mp: 3 })

/**
 * The fight OBJECT as the poll's checkpoint lane reads it, at the two versions this race straddles. The mob cells
 * are the capsule's OWN truth: `MobMoved idx 0 → 46` and `idx 1 → 66` ride the raced version, and the mob turn
 * before it put mob 0 on 26 (seq 76) — so the bodies genuinely move across V, which is what makes the anchor test
 * at the bottom of this file measure something. The peer neither moves nor is hit at V (it casts), so its row is
 * identical on both sides: the reported symptom is exactly a cast that never rendered.
 */
const fight_object = (version) => ({
  id: FIGHT,
  status: 1,
  width: 20,
  height: 19,
  participants: [participant('0xa11ce', OBSERVER, 5, 0), participant('0xb0b', PEER, 27, 28)],
  group_template: '0xmob_t',
  group_base_ap: 6,
  group_base_mp: 3,
  mobs: version < RACED ? [mob(26), mob(65)] : [mob(46), mob(66)],
  obstacles: [],
  holes: [],
  shape_mask: [],
  start_cells_a: [5, 27],
  start_cells_b: [],
  turn_ptr: 1,
  queue: [],
  turn_deadline_ms: T0 + (version < RACED ? 30_000 : 60_000),
  turn_entropy: T0 + (version < RACED ? 30_000 : 60_000),
  turn_ordinal: version < RACED ? 16 : 17,
  placement_deadline_ms: 0,
  world_seed: null,
  spawn_id: null,
  last_action_ms: 0,
  version,
})

const snapshot_input = (version) => ({ type: 'snapshot', fight: fight_object(version), version })

/** The OBSERVING seat's client, bootstrapped on the object read that precedes the raced commit. */
const observer_store = () => {
  const store = create_fight_store()
  store.getState().input(
    {
      type: 'init',
      fight_id: FIGHT,
      ctx: { my_entity_id: OBSERVER, address: '0xa11ce', beat_ctx: { grid_width: 20 } },
    },
    T0
  )
  store.getState().input(snapshot_input(BEFORE), T0 + 50)
  return store
}

/** THE JOURNAL-FIRST ordering — the un-raced world, and this suite's positive control. */
const journal_first = () => {
  const store = observer_store()
  store.getState().input(journal_input(RACED), T0 + 1_000)
  return store
}

/** THE READ-FIRST ordering — the object poll wins the race to the commit's own version, then the rows land. */
const read_first = () => {
  const store = observer_store()
  store.getState().input(snapshot_input(RACED), T0 + 1_000)
  store.getState().input(journal_input(RACED), T0 + 2_000)
  return store
}

const shape_of = (wave) =>
  wave.map((turn) => ({
    source_id: turn.source_id,
    version: turn.version,
    seq: turn.seq,
    is_local: turn.is_local,
    from_idx: turn.from_idx,
    until_idx: turn.until_idx,
    beats: turn.beats.map((beat) => beat.kind),
  }))

const turn_of = (wave, source_id) => wave.find((turn) => String(turn.source_id) === String(source_id))

/** A turn stripped of the ONE field the two orderings are allowed to differ on: `fold_inert`, the mark that says
 *  "the adopted base already contains my rows, so I play and hold nothing". Beat CONTENT is what must match. */
const beat_content = ({ fold_inert, ...turn }) => turn

describe('#2124 — an object read that wins the race must not eat the beats it raced', () => {
  test('the journal-first ordering presents the peer cast and both mob turns (the positive control)', () => {
    const { wave } = journal_first().getState()
    expect(shape_of(wave)).toEqual([
      { source_id: PEER, version: RACED, seq: 1, is_local: false, from_idx: 0, until_idx: 1, beats: ['cast', 'turn_end'] }, // prettier-ignore
      { source_id: 'mob-1', version: RACED, seq: 2, is_local: false, from_idx: 2, until_idx: 2, beats: ['move', 'arrival'] }, // prettier-ignore
      { source_id: 'mob-0', version: RACED, seq: 3, is_local: false, from_idx: 3, until_idx: 3, beats: ['move', 'arrival'] }, // prettier-ignore
    ])
  })

  test('the read-first race presents the same turns — and admits nothing to the fold to do it', () => {
    const store = read_first()
    const state = store.getState()
    // The fold cursor DID win the race — this is the condition the defect needs, not a scenario that dodged it.
    expect(state.core.inbox.base_version, 'the object read must actually adopt at the raced version').toBe(RACED)
    expect(
      Object.values(state.core.inbox.log).filter((row) => Number(row.version) === RACED),
      'a presentation-owed row is never admitted to the log — the fold reads the snapshot alone'
    ).toEqual([])
    // BEFORE the fix this wave was EMPTY: "READ FIRST -> []", the peer's whole turn lost in silence.
    expect(shape_of(state.wave)).toEqual(shape_of(journal_first().getState().wave))
  })

  test("the peer's cast turn is byte-equal across the two orderings", () => {
    // The reported symptom, exactly: an observing client saw no cast animation, no vfx and no combat-log line for
    // its partner's action. The cast/turn_end beats carry no anchor-dependent field, so they are byte-identical.
    expect(beat_content(turn_of(read_first().getState().wave, PEER))).toEqual(
      turn_of(journal_first().getState().wave, PEER)
    )
  })

  test('an owed turn plays and holds nothing — it never gates the board on state already shown', () => {
    // The cost of getting this wrong is measured, not theoretical: the #512 capsule replays a client whose own
    // mob-cast beat was eaten by exactly this race, and paying it back as a HOLDING turn disarmed that player's
    // next spell — seconds of their turn clock spent re-announcing a board they were already looking at. A turn
    // that cannot mask the fold (its rows are below the base) must not gate the player either: `holds_the_fold`.
    const store = read_first()
    expect(store.getState().wave.every((turn) => turn.fold_inert === true)).toBe(true)
    expect(presenting(store.getState()), 'a presentation-owed turn is not a hold').toBe(false)
  })

  test('a re-delivered page owes its beats exactly once', () => {
    const store = read_first()
    const once = store.getState().wave
    store.getState().input(journal_input(RACED), T0 + 3_000)
    // The presentation cursor rose past the version the first delivery paid for; an SSE replay or a walker
    // re-drive of the same page is at or below it and mints nothing. Double beats are the failure mode this
    // whole seam exists to avoid, and it is the same idempotence the log gives the fold.
    expect(store.getState().wave).toEqual(once)
    expect(store.getState().core.inbox.presented_version).toBe(RACED)
  })

  test('an owed row never alters folded state — a snapshot adoption is the same board with or without it', () => {
    // THE DOUBLE-APPLICATION GUARD. This is what keeps the 2026-08-02 admission law intact: the snapshot at V
    // already contains every row ≤ V, so routing those rows to presentation must be provably fold-inert.
    const pure = observer_store()
    pure.getState().input(snapshot_input(RACED), T0 + 1_000)
    const owed = read_first()

    const pure_truth = committed_truth(pure.getState())
    const owed_truth = committed_truth(owed.getState())
    expect(hash_state(owed_truth.fighters)).toBe(hash_state(pure_truth.fighters))
    expect(owed_truth.active).toBe(pure_truth.active)
    // Vitals spelled out, so a hash that silently starts digesting nothing cannot pass this.
    expect(Object.entries(owed_truth.fighters).map(([key, f]) => [key, f.hp, f.cell, f.ap, f.mp, f.alive])).toEqual([
      ['p0', 0, 5, 12, 3, false],
      ['p1', 28, 27, 12, 3, true],
      ['m0', 60, 46, 6, 3, true],
      ['m1', 60, 66, 6, 3, true],
    ])
    // …and the owed rows presented, so the equality above is not the trivial "nothing happened at all".
    expect(owed.getState().wave.length).toBe(3)
  })

  test('every beat of the raced ordering is byte-equal to the un-raced one', () => {
    // The whole wave, beat for beat, payload for payload — including the mob walks, which the header explains are
    // anchor-free here. Whatever the transport race did to the ARRIVAL order, the eye is handed the same frames.
    const raced = read_first().getState().wave
    expect(raced.map(beat_content)).toEqual(journal_first().getState().wave)
    // The one honest asymmetry, pinned so it cannot drift: the raced board is already at the destination cells
    // the walks explain, and the beats say so anyway.
    expect(turn_of(raced, 'mob-0').beats[0].payload.path).toEqual([{ x: 6, y: 2 }])
  })
})

describe('#2144 — observer casts retain the journal action identity', () => {
  const identities = [
    { caster_idx: 0, observer_idx: 1, spell_id: `0x${'a'.repeat(64)}` },
    { caster_idx: 1, observer_idx: 0, spell_id: `0x${'b'.repeat(64)}` },
  ]

  for (const { caster_idx, observer_idx, spell_id } of identities)
    test(`seat ${observer_idx} observing seat ${caster_idx} receives the resolved spell id`, () => {
      const version = 2
      const caster = `peer-${caster_idx}`
      const observer = `peer-${observer_idx}`
      const event = (seq, kind, data) => ({
        seq: String(seq),
        kind,
        data: { fight: FIGHT, caster_is_mob: false, caster_idx: String(caster_idx), ...data },
        digest: 'captured-cast',
        version: String(version),
      })
      // Captured journal order: the action envelope opens, its effects resolve, the legacy Cast anchors the
      // presentation, and ActionResolved closes it with the SpellTemplate object id the Cast itself omits.
      const actions = journal_to_actions({
        events: [
          event(40, 'ActionStarted', { turn_ordinal: '1', action_ordinal: '0', target_cell: '45' }),
          event(41, 'ActionEffect', { turn_ordinal: '1', action_ordinal: '0', effect_ordinal: '0', effect: {} }),
          event(42, 'Hit', { victim_is_mob: true, victim_idx: '0', amount: '8', remaining_hp: '12' }),
          event(43, 'Cast', { target_cell: '45' }),
          event(44, 'ActionResolved', {
            turn_ordinal: '1',
            action_ordinal: '0',
            target_cell: '45',
            action_kind: 0,
            spell: spell_id,
          }),
        ],
      })
      const draft = {
        fight_id: FIGHT,
        ctx: { my_entity_id: observer, beat_ctx: { grid_width: 20 } },
        view: { escrow: [{ character: 'peer-0' }, { character: 'peer-1' }] },
        my_key: `p${observer_idx}`,
        fighters: {
          p0: { cell: 21, hp: 50, alive: true },
          p1: { cell: 22, hp: 50, alive: true },
          m0: { cell: 45, hp: 20, alive: true },
        },
        wave: [],
        wave_seq: 0,
      }

      expect(actions.find((row) => row.kind === 'ActionResolved')?.spell).toBe(spell_id)
      const turn = paced_wave_turns(draft, actions, { fighter_health: () => 20 }).find(
        (candidate) => candidate.source_id === caster
      )
      expect(turn?.is_local).toBe(false)
      expect(turn?.beats.find((beat) => beat.kind === 'cast')?.payload.spell_id).toBe(spell_id)
    })
})
