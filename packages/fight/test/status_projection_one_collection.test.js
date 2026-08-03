// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #1993 WP6 — ONE ACTIVE-STATUS COLLECTION, EVERY CONSEQUENCE DERIVED FROM IT.
//
// The audit's active-effects family (#1872) named nine reads of one fact. The ROWS were already a single fold
// home; the CONSEQUENCES were not — the turn card read the rows, the board folded its own effective range out of
// them, the rig veil read a boolean beside them, and the hover card forwarded a third copy. Four surfaces
// re-answering one collection is how an effect paints in one place and not another.
//
// `fight_visible_view.entities[id].statuses` is now that collection AND its consequences:
//   · `rows`        — the fold's per-fighter status home, verbatim (the badge array)
//   · `range_bonus` — the live range stat those rows move (`statuses.range_bonus_of`, folded exactly once)
//   · `invisible`   — the fold's own re-derivation from the surviving rows
//   · `stance_only` — the veil lit with NO row behind it: named, not absorbed (the last second-representation)
//
// THE TWO-TRANSPORT ARM. A fight's status truth arrives two ways — the journal (receipt/SSE rows, folded as
// actions) and the chain object snapshot (`Fight.fx.statuses`, folded as the base the actions replay onto). At
// the END-TURN boundary they are allowed to disagree: the snapshot is a poll, and a poll can land either side of
// the chain's own decrement. What must NEVER happen is the surfaces disagreeing — which is exactly what the
// audit row at `FightTimeline.jsx:192` describes. One collection means one answer, whichever transport spoke
// last, for the badge, the range and the veil at once.
//
// Refs #1993 (WP6), #1872 (the family), #2000/D42 (the lifetime cadence these ride on).

import { describe, expect, test } from 'bun:test'

import * as SE from '../../sim/src/spell_effect.js'
import { encode } from '../src/los.js'
import { create_fight_store } from '../src/store.js'
import { fight_visible_view } from '../src/project_views.js'
import { range_bonus_of } from '../src/statuses.js'

const FIGHT = '0xf1993wp6'
const CHAR = '0xc1993wp6'
const CASTER = encode(5, 5)
const MOB = encode(9, 9)
const PKG = '0xpkg::fight_events::'
const BASE_RANGE = 2

/** A minted chain `Effect`: a POINT self-cast `+3 Range`, CENTERED on the wire (#983 — signed kinds ride +32768). */
const range_buff = (turns) => ({
  area_shape: SE.SHAPE_POINT,
  area_size: '0',
  chance: 100,
  element: 255,
  flags: 0,
  kind: SE.K_ALTER_STAT,
  phase: SE.PHASE_ON_ENTER,
  stat: SE.STAT_RANGE,
  target_filter: SE.TF_ONLY_CASTER,
  turns,
  value: String(32_768 + 3),
})

/** The action envelope bracketing one self-cast, exactly as `action_envelope` emits it. */
const cast_events = (row) => [
  [
    'ActionStarted',
    {
      action_kind: 0,
      action_ordinal: '0',
      ap_cost: '3',
      caster_idx: '0',
      caster_is_mob: false,
      effect_count: '1',
      target_cell: String(CASTER),
      turn_ordinal: '1',
    },
  ],
  [
    'ActionEffect',
    {
      action_ordinal: '0',
      caster_idx: '0',
      caster_is_mob: false,
      effect: row,
      effect_ordinal: '0',
      turn_ordinal: '1',
    },
  ],
  ['Cast', { caster_is_mob: false, caster_idx: 0, target_cell: CASTER }],
]

const fight_object = (over = {}) => ({
  id: FIGHT,
  status: 1,
  width: 20,
  height: 19,
  participants: [
    {
      owner: '0xaaa',
      character: CHAR,
      class: 'senshi',
      team: 0,
      hp: 50,
      max_hp: 50,
      ap: 6,
      mp: 3,
      base_ap: 6,
      base_mp: 3,
      cell: CASTER,
      base_stats: { range: BASE_RANGE },
      range: BASE_RANGE,
    },
  ],
  mobs: [{ template: '0xabc', hp: 30, max_hp: 30, cell: MOB, ap: 4, mp: 3, level: 1 }],
  queue: [
    { is_mob: false, idx: 0 },
    { is_mob: true, idx: 0 },
  ],
  turn_ptr: 0,
  turn_deadline_ms: 90_000,
  turn_entropy: 90_000,
  turn_ordinal: 1,
  invisibility_statuses: [],
  ...over,
})

/** ONE `Fight.fx.statuses` row as the SNAPSHOT transport carries it (seat fid 0, value already wire-decoded by
 *  `read_fighter_statuses` upstream — this is the door `sync_dungeon_fight` attaches). */
const snapshot_status = (over = {}) => ({
  fighter: 0,
  kind: SE.K_ALTER_STAT,
  remaining_turns: 2,
  element: null,
  value: 3,
  stat: SE.STAT_RANGE,
  chance: 100,
  source: 0,
  ...over,
})

const ev = ([kind, fields]) => ({ type: PKG + kind, parsedJson: { fight: FIGHT, ...fields } })

const boot = (fight = fight_object()) => {
  const store = create_fight_store()
  store
    .getState()
    .input({ type: 'init', fight_id: FIGHT, my_key: 'p0', ctx: { my_entity_id: CHAR, beat_ctx: { grid_width: 20 } } })
  store.getState().input({ type: 'snapshot', fight, version: 1, journal_head: '0' }, 1_000)
  return store
}

const feed = (store, version, events, now) =>
  store.getState().input({ type: 'receipt', fight_id: FIGHT, version, receipt: { events } }, now)

/** THE ONE COLLECTION, as every surface now reads it. */
const statuses = (store) => fight_visible_view(store.getState()).entities[CHAR].statuses

describe('#1993 WP6 — the active-status projection answers every consequence', () => {
  test('the record IS the collection: rows, the range they move, and the veil, from one fold', () => {
    const store = boot()
    const before = statuses(store)
    expect(before.rows).toEqual([])
    expect(before.range_bonus, 'no rows ⇒ the immutable fight-start base alone').toBe(BASE_RANGE)
    expect(before.invisible).toBe(false)
    expect(before.stance_only).toBe(false)

    feed(store, 2, cast_events(range_buff(2)).map(ev), 1_100)
    const after = statuses(store)
    // ONE row, and the range consequence moved WITH it — not beside it, not a turn later.
    expect(after.rows).toHaveLength(1)
    expect(after.rows[0]).toMatchObject({ kind: SE.K_ALTER_STAT, stat: SE.STAT_RANGE, value: 3, remaining_turns: 2 })
    expect(after.range_bonus, 'base + the active signed range row, folded exactly once').toBe(BASE_RANGE + 3)
  })

  test('the range consequence is the rows’ own answer — never a second fold of them', () => {
    const store = boot()
    feed(store, 2, cast_events(range_buff(2)).map(ev), 1_100)
    // The projection's `range_bonus` and the one home every other caller used are the SAME derivation over the
    // SAME rows. If these ever part, a second fold has been introduced somewhere between them.
    const view = fight_visible_view(store.getState())
    expect(view.entities[CHAR].statuses.range_bonus).toBe(
      range_bonus_of({ base_range: BASE_RANGE, effects: view.entities[CHAR].statuses.rows })
    )
  })

  test('an unbacked veil is NAMED, never silently absorbed into the row collection', () => {
    const store = boot()
    // A bare chain `StanceChanged` carries no duration, so it can set the flag with no row to justify it. The
    // projection states the flag AND the fact that nothing backs it — the measurement that lets the next train
    // delete the boolean instead of merely suspecting it.
    feed(store, 2, [ev(['StanceChanged', { fighter_is_mob: false, fighter_idx: 0, stance: 27, active: true }])], 1_100)
    // the stance rides a presentation beat — the view shows it once the eye has caught up
    store.getState().input({ type: 'presented', seq: store.getState().wave[0].seq }, 1_150)
    const veiled = statuses(store)
    expect(veiled.invisible, 'the veil is lit — the fold said so').toBe(true)
    expect(
      veiled.rows.some((row) => Number(row.kind) === 27),
      'and no row backs it'
    ).toBe(false)
    expect(veiled.stance_only).toBe(true)

    // A row-backed invisibility is NOT a stance-only veil: the collection justifies it.
    const backed = boot(
      fight_object({ invisibility_statuses: [snapshot_status({ kind: 27, stat: null, value: null })] })
    )
    const row_veil = statuses(backed)
    expect(row_veil.invisible).toBe(true)
    expect(row_veil.stance_only).toBe(false)
    expect(row_veil.rows.some((row) => Number(row.kind) === 27)).toBe(true)
  })
})

describe('#1993 WP6 — the two transports cannot make the surfaces disagree (#1872, FightTimeline:192)', () => {
  test('a snapshot landing AFTER the caster’s turn end reconciles the one collection, whole', () => {
    const store = boot()
    feed(store, 2, cast_events(range_buff(2)).map(ev), 1_100)
    feed(store, 3, [ev(['TurnEnded', { is_mob: false, idx: 0 }])], 1_200)
    // The turn END ages nothing of the ending fighter's own rows (#2000, D42) — the row and its range stand.
    const journal_only = statuses(store)
    expect(journal_only.rows).toHaveLength(1)
    expect(journal_only.range_bonus).toBe(BASE_RANGE + 3)

    // Now the OTHER transport speaks at the same boundary, carrying its own count for the same row.
    store.getState().input(
      {
        type: 'snapshot',
        version: 4,
        journal_head: '0',
        fight: fight_object({ turn_ptr: 1, invisibility_statuses: [snapshot_status({ remaining_turns: 1 })] }),
      },
      1_300
    )
    const reconciled = statuses(store)
    // ONE answer — not the journal's row beside the snapshot's row. Whatever the count, the badge array, the
    // range and the veil are three reads of THAT collection, so they cannot disagree with each other.
    expect(reconciled.rows.filter((row) => Number(row.stat) === SE.STAT_RANGE)).toHaveLength(1)
    expect(reconciled.range_bonus).toBe(
      range_bonus_of({ base_range: BASE_RANGE, effects: reconciled.rows }),
      'the range surface and the badge surface read the same rows'
    )
    expect(reconciled.invisible).toBe(false)
    expect(reconciled.stance_only).toBe(false)
  })

  test('a snapshot that DROPS the row retires every consequence together, not one surface at a time', () => {
    const store = boot()
    feed(store, 2, cast_events(range_buff(2)).map(ev), 1_100)
    expect(statuses(store).range_bonus).toBe(BASE_RANGE + 3)
    store
      .getState()
      .input(
        { type: 'snapshot', version: 4, journal_head: '9', fight: fight_object({ invisibility_statuses: [] }) },
        1_400
      )
    const cleared = statuses(store)
    expect(cleared.rows.some((row) => Number(row.stat) === SE.STAT_RANGE)).toBe(false)
    expect(cleared.range_bonus, 'the badge and the reach retire in the same breath').toBe(BASE_RANGE)
  })
})
