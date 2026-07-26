// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #1049 — THE STATUS DOOR MATRIX. Five distinct buffs/debuffs were reported cast to complete silence (a +20
// Strength buff, an AP debuff, a flat reflect, a +110% damage buff, an MP debuff). They were not five missing
// render arms: every one of them RENDERS the moment a row reaches the status home. They were three DOORS into
// that home, each with its own hand-rolled kind list, and a kind missing from a list vanished at that door:
//
//   · PREDICTION (predict_cast) — knew exactly three rows: range · ap/mp GRANT · invisibility. A +20 Strength
//     buff, a +110% damage buff and every point DEBUFF painted NOTHING at cast time.
//   · RECEIPT (inputs.js ActionEffect) — knew three KINDS. A self-cast `Reflects 3% · 3 turns` folded nothing.
//   · SNAPSHOT (fight_status_snapshot) — generic over every kind, but it is the slow object poll.
//
// The rows below are the LIVE authored corpus, captured 2026-07-26 from the published
// `spell_corpus.json` blob (assets.aresrpg.world/data/spell_corpus.json) — the exact spells the reports name.
// `value` is the AUTHORED signed magnitude; the chain mint centres the signed kinds at 32768, so the receipt
// leg re-encodes through `encode_status_value` to ride the real wire form.

import { describe, expect, test } from 'bun:test'
import { create_fight_state } from '@aresrpg/sim/reduce'
import { normalize_spell_templates } from '@aresrpg/sim/spell_templates'

import { encode_status_value } from '../src/fight_status_snapshot.js'
import { predict_sim_cast } from '../src/predict_cast.js'
import { engine_view } from '../src/project.js'
import { create_fight_store } from '../src/store.js'

const FIGHT = '0xf1'
const CHAR = '0xc1'
const PKG = '0xpkg::fight_events::'
const SELF_CELL = 105 // (5,5) on the 20-wide grid
const MOB_CELL = 106 // (6,5)

const arena = {
  width: 20,
  height: 19,
  radius: 9,
  center: { x: 10, y: 9 },
  cells: new Uint8Array(380),
  spawns_a: [],
  spawns_b: [],
}

/** One live corpus effect row, verbatim (kind · element · value · shape · filter · chance · turns · stat · flags). */
const fx = (over) => ({
  element: 255,
  value: 0,
  value_max: 0,
  area_shape: 0,
  area_size: 0,
  chance: 100,
  turns: 0,
  stat: 0,
  flags: 0,
  phase: 0,
  ...over,
})

// The reported casts, as the published corpus authors them.
const CASES = [
  {
    name: "alter-stat STR — Killer's Calm +20 Strength · 5 turns",
    spell: 'yajin_killers_calm',
    effects: [fx({ kind: 9, value: 20, value_max: 20, target_filter: 4, turns: 5, stat: 0 })],
    on_self: true,
    kind: 9,
    value: 20,
    predicts: true,
  },
  {
    name: 'damage-amp — Full Draw +110% Damage · 2 turns',
    spell: 'yogen_full_draw',
    effects: [fx({ kind: 9, value: 110, value_max: 110, target_filter: 4, turns: 2, stat: 8 })],
    on_self: true,
    kind: 9,
    value: 110,
    predicts: true,
  },
  {
    name: 'give-points / invisibility — Vanish (invisible · +1 MP) · 3 turns',
    spell: 'yajin_shadowfold',
    effects: [
      fx({ kind: 27, value: 1, value_max: 1, target_filter: 32, turns: 3 }),
      fx({ kind: 6, value: 1, value_max: 1, target_filter: 32, turns: 3, stat: 1 }),
    ],
    on_self: true,
    kind: 27,
    predicts: true,
  },
  {
    name: 'reflect — Backtick Reflects 3 · 3 turns',
    spell: 'tokei_backtick',
    // The +1 AP rider is a 10%-CHANCE roll, so the prediction cannot know it — the unconditional reflect can.
    effects: [
      fx({ kind: 25, value: 3, value_max: 3, target_filter: 4, turns: 3 }),
      fx({ kind: 6, value: 1, value_max: 1, target_filter: 32, chance: 10, turns: 0 }),
    ],
    on_self: true,
    kind: 25,
    // REFLECT_DAMAGE rides the B7 CHAIN_PENDING exclusion (predict_cast) — its chain CONSUMPTION arm is unshipped,
    // so predicting the mechanic would diverge. The row still has to paint: that is the receipt door's job.
    predicts: false,
  },
  {
    name: 'point-debuff on target — Reverse −1 AP · 1 turn',
    spell: 'asobi_reverse',
    effects: [fx({ kind: 7, value: 1, value_max: 1, target_filter: 1, turns: 1, stat: 0, flags: 1 })],
    on_self: false,
    kind: 7,
    predicts: true,
  },
  {
    name: 'point-debuff on target — Razor Shaft −2 MP · 1 turn (+ earth damage)',
    spell: 'yogen_razor_shaft',
    effects: [
      fx({ kind: 7, value: 2, value_max: 2, target_filter: 1, turns: 1, stat: 1, flags: 1 }),
      fx({ kind: 0, element: 2, value: 6, value_max: 7, target_filter: 1 }),
    ],
    on_self: false,
    kind: 7,
    predicts: true,
  },
]

// The sim's normalizer is a WIRE door: it reads the chain's dialect, where a signed kind rides CENTERED at
// 32768. The published corpus states the AUTHORED signed magnitude, so the client's corpus door mints it on the
// way in (fight-spells-core.js `minted_spell`) — mirrored here so this matrix drives the real live shape.
const template_of = (row) =>
  normalize_spell_templates([
    {
      id: row.spell,
      levels: [
        {
          min_char_level: 1,
          ap_cost: 0,
          range_min: 0,
          range_max: 8,
          modifiable_range: false,
          line_launch: false,
          line_of_sight: false,
          free_cell: false,
          casts_per_turn: 255,
          casts_per_target: 255,
          cooldown_turns: 0,
          crit_rate: 0,
          effects: row.effects.map((e) => ({ ...e, value: encode_status_value(e.kind, e.value) })),
          crit_effects: [],
        },
      ],
    },
  ]).get(row.spell)

const sim_fighter = (id, cell, is_player, stats) => ({
  id,
  name: id,
  cell,
  health: 100,
  health_max: 100,
  ap: 10,
  ap_max: 10,
  mp: 6,
  mp_max: 6,
  ap_used: 0,
  mp_used: 0,
  is_player,
  template_id: 't',
  level: 1,
  stats,
  effects: [],
  spell_levels: {},
  ap_reserve: 0,
})

/** DOOR A — the optimistic cast. `wisdom` wins the chain's own dodge contest for the point drains, so a drained
 *  row is a fact rather than a coin flip (a lost contest is an honest empty, not a missing arm). */
const predicted_statuses = (row) => {
  const caster = sim_fighter('p0', { x: 5, y: 5 }, true, { range: 3, wisdom: 200 })
  const enemy = sim_fighter('m0', { x: 6, y: 5 }, false, { range: 3, agility: 0 })
  const state = {
    ...create_fight_state({ fight_id: 'f', arena_seed: 1, arena_radius: 9, arena, team0: [caster], team1: [enemy] }),
    started: true,
    turn_order: ['p0', 'm0'],
    turn_number: 1,
    current_turn_idx: 0,
    last_total_hp: 200,
  }
  const out = predict_sim_cast({
    state,
    caster_id: 'p0',
    spell: template_of(row),
    spell_level: 1,
    target: row.on_self ? { x: 5, y: 5 } : { x: 6, y: 5 },
    arena,
    critical: false,
    resolve_ref: (id) => (id === 'p0' ? { is_mob: false, idx: 0 } : { is_mob: true, idx: 0 }),
  })
  expect(out.result.success).toBe(true)
  return out.actions.filter((a) => a.kind === 'StatusAdded').map((a) => a.status)
}

const fight_object = (statuses) => ({
  id: FIGHT,
  status: 1,
  width: 20,
  height: 19,
  participants: [
    {
      owner: '0xaaa',
      character: CHAR,
      class: 'yajin',
      team: 0,
      hp: 50,
      max_hp: 50,
      ap: 6,
      mp: 3,
      base_ap: 6,
      base_mp: 3,
      cell: SELF_CELL,
      ready: true,
    },
  ],
  mobs: [{ template: 'm', level: 1, hp: 40, max_hp: 40, cell: MOB_CELL, ap: 6, mp: 3 }],
  queue: [
    { is_mob: false, idx: 0 },
    { is_mob: true, idx: 0 },
  ],
  turn_ptr: 0,
  turn_deadline_ms: 90_000,
  invisibility_statuses: statuses,
})

const booted = (statuses = []) => {
  const store = create_fight_store()
  store
    .getState()
    .input({ type: 'init', fight_id: FIGHT, my_key: 'p0', ctx: { my_entity_id: CHAR, beat_ctx: { grid_width: 20 } } })
  store.getState().input({ type: 'snapshot', fight: fight_object(statuses), version: 1, journal_head: '0' }, 1_000)
  return store
}

const side_effects = (store, on_self) => {
  const view = engine_view(store.getState())
  return view.fighters.get(on_self ? CHAR : 'mob-0')?.effects ?? []
}

/** DOOR B — the receipt's action envelope, byte-shaped like the chain's (signed kinds ride CENTERED). */
const receipt_statuses = (row) => {
  const target_cell = row.on_self ? SELF_CELL : MOB_CELL
  const events = [
    {
      kind: 'ActionStarted',
      data: {
        fight: FIGHT,
        caster_is_mob: false,
        caster_idx: 0,
        turn_ordinal: '1',
        action_ordinal: '0',
        action_kind: 0,
        target_cell,
        ap_cost: 2,
        effect_count: row.effects.length,
      },
    },
    ...row.effects.map((effect, effect_ordinal) => ({
      kind: 'ActionEffect',
      data: {
        fight: FIGHT,
        caster_is_mob: false,
        caster_idx: 0,
        turn_ordinal: '1',
        action_ordinal: '0',
        effect_ordinal,
        effect: { ...effect, value: encode_status_value(effect.kind, effect.value) },
      },
    })),
    { kind: 'Cast', data: { fight: FIGHT, caster_is_mob: false, caster_idx: 0, target_cell } },
  ]
  const store = booted()
  store.getState().input(
    {
      type: 'receipt',
      fight_id: FIGHT,
      version: 2,
      receipt: { events: events.map((e) => ({ type: PKG + e.kind, parsedJson: e.data })) },
    },
    1_100
  )
  return side_effects(store, row.on_self)
}

/** DOOR C — the authoritative object read's `Fight.fx.statuses`, entity-mapped. */
const snapshot_statuses = (row) => {
  const effect = row.effects.find((e) => e.kind === row.kind)
  const store = booted([
    {
      fighter: row.on_self ? 0 : 1000,
      kind: effect.kind,
      remaining_turns: effect.turns,
      element: null,
      value: effect.value,
      stat: effect.stat,
      chance: effect.chance,
      source: 0,
    },
  ])
  return side_effects(store, row.on_self)
}

describe('#1049 every reported buff/debuff reaches the ONE status projection', () => {
  for (const row of CASES) {
    test(`${row.name} — folds at cast time`, () => {
      const predicted = predicted_statuses(row)
      if (!row.predicts) {
        expect(predicted.some((s) => s.kind === row.kind)).toBe(false)
        return
      }
      const hit = predicted.find((s) => s.kind === row.kind)
      expect(hit).toBeDefined()
      expect(hit.remaining_turns).toBeGreaterThan(0)
      // Attribution is stated, never re-guessed downstream: seat 0 is the caster's own board fid.
      expect(hit.source).toBe(0)
      if (row.value != null) expect(hit.value).toBe(row.value)
    })

    test(`${row.name} — folds from the receipt envelope`, () => {
      const rows = receipt_statuses(row)
      // A CONTESTED point drain (cast.move::resolve_drain is dodge-rolled) is the one shape the envelope cannot
      // prove: its row exists only when `removed > 0`, a number only the Drain event / the object read carry.
      const contested = row.kind === 7
      expect(rows.some((r) => r.kind === row.kind)).toBe(!contested)
    })

    test(`${row.name} — folds from the object snapshot`, () => {
      const hit = snapshot_statuses(row).find((r) => r.kind === row.kind)
      expect(hit).toBeDefined()
      expect(hit.remaining_turns).toBeGreaterThan(0)
      expect(hit.source).toBe(0)
    })
  }

  test('a signed-kind DEBUFF keeps its sign through the prediction door', () => {
    const debuff = {
      spell: 'probe_range_debuff',
      // A negative alter_stat on an enemy: authored −7 range, minted CENTERED at 32768 − 7.
      effects: [fx({ kind: 9, value: -7, value_max: -7, target_filter: 1, turns: 2, stat: 6, flags: 8 })],
      on_self: false,
      kind: 9,
    }
    const hit = predicted_statuses(debuff).find((s) => s.kind === 9)
    expect(hit).toBeDefined()
    expect(hit.value).toBe(-7)
  })
})
