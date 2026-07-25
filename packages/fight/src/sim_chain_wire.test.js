// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// sim_chain_wire.test.js — THE CODEC ORACLE for the local mock chain: `packages/fight/test/fixtures/capsules`.
//
// docs/CODE_LAW.md: "Decode tests assert captured wire bytes — a codec test that encodes with the same model it
// decodes with proves nothing; pin at least one real captured payload with provenance." The twin-observable gate
// next door (sim_chain.test.js) proves the encoder says the right THINGS; it cannot prove it says them in the
// chain's own dialect, because `decode_fight_event` coerces the difference away before the fold ever sees it.
//
// So this file pins every emitted row against REAL events captured from live testnet sessions (the trace_format-2
// envelopes in the fixture corpus, `0x599bda…::fight_events::*`): the KEY SET and the per-key JSON SCALAR TYPE.
// It is what caught this encoder emitting `u64` as JSON numbers — Sui rides u64 as a decimal STRING and only
// u8/bool as native scalars (`{"cell":"7","idx":"0","kind":12,"is_mob":false}`).
//
// Fixture provenance: captured client sessions, app_version 1.12.50 and earlier, committed under
// `packages/fight/test/fixtures/capsules` by the trace lane; each row carries its own deployed package id.

import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, test, expect } from 'bun:test'
import { decode_fight_event } from '@aresrpg/sdk/fight'

import { board_state_from_fight } from './board_state.js'
import { base_budget, base_from_view } from './fold.js'
import { apply_action, normalize_events, seat_resolver } from './inputs.js'
import {
  arena_from_board,
  create_sim_chain,
  derive_board,
  encode_sim_step,
  fold_projection,
  snapshot_from_sim,
} from './sim_chain.js'

const SEED = 0xc81f3a92
const FIGHT_ID = 'sim:wire:1'

const fighter = (id, cell, is_player) => ({
  id,
  name: id,
  cell,
  health: 60,
  health_max: 60,
  ap: 6,
  ap_max: 6,
  mp: 3,
  mp_max: 3,
  ap_used: 0,
  mp_used: 0,
  is_player,
  template_id: is_player ? 'senshi' : '0xmob_template',
  level: 10,
  stats: {},
  effects: [],
  deck: [],
  hand: [],
  discard: [],
  spell_levels: {},
  ap_reserve: 0,
})

/** A minimal started fight — this file drives `encode_sim_step` with hand-written sim events, so no spell kit
 *  is needed; only the (side, idx) identities the rows key off. */
const chain = (() => {
  const arena = arena_from_board(derive_board(SEED).board)
  return create_sim_chain({
    seed: SEED,
    fight_id: FIGHT_ID,
    team0: [fighter('sim_c1', arena.spawns_a[0], true)],
    team1: [fighter('mob_0', arena.spawns_b[0], false)],
    spell_templates: new Map(),
    group_template: '0xgroup',
  })
})()

const CAPSULE_DIR = fileURLToPath(new URL('../test/fixtures/capsules', import.meta.url))

/** Every REAL chain fight event captured from a live session, one exemplar per struct name. */
const CAPTURED = (() => {
  const rows = new Map()
  for (const file of readdirSync(CAPSULE_DIR).filter((f) => f.endsWith('.json'))) {
    const envelope = JSON.parse(readFileSync(`${CAPSULE_DIR}/${file}`, 'utf8'))
    for (const capsule of envelope.capsules ?? [])
      for (const event of capsule.payload?.rows?.events ?? [])
        if (typeof event.type === 'string' && event.parsedJson) rows.set(event.type.split('::').pop(), event)
  }
  return rows
})()

/** Every row kind this encoder can emit, paired with the sim step that produces exactly it. */
const EMITTED = (() => {
  const state = chain.sim_state
  const [me] = state.team0
  const [mob] = state.team1
  const step = (events) => encode_sim_step({ pre_state: state, post_state: state, events, fight_id: FIGHT_ID }).rows
  const by_kind = new Map()
  const collect = (rows) => rows.forEach((r) => by_kind.set(r.type.split('::').pop(), r))
  collect(step([{ type: 'fight_placed', entity_id: me.id, cell: me.cell }]))
  collect(step([{ type: 'fight_ready', entity_id: me.id }]))
  collect(step([{ type: 'fight_turn_start', entity_id: me.id }]))
  collect(step([{ type: 'fight_turn_end', entity_id: me.id }]))
  collect(step([{ type: 'fight_moved', entity_id: me.id, path: [me.cell], tackled: false }]))
  collect(step([{ type: 'fight_moved', entity_id: mob.id, path: [mob.cell], tackled: false }]))
  collect(step([{ type: 'fight_moved', entity_id: me.id, path: [me.cell], tackled: true }]))
  collect(
    step([
      {
        type: 'fight_cast',
        entity_id: me.id,
        target: mob.cell,
        effects: [
          { target_id: mob.id, damage: 9, new_health: 0, killed: true },
          { target_id: mob.id, cell: mob.cell, has_cell: true },
          { target_id: me.id, status: 'CRITICAL_FAILURE_FUMBLE' },
          { target_id: me.id, status: 'INVISIBILITY' },
          { target_id: me.id, status: 'REVEAL' },
        ],
      },
    ])
  )
  collect(step([{ type: 'ap_reserve_used', entity_id: me.id, ap_added: 2, new_ap: 8 }]))
  collect(step([{ type: 'fight_ended', winner: 0 }]))
  collect(step([{ type: 'fight_ended', winner: 1 }]))
  return by_kind
})()

/** JSON scalar shape of a payload: key → 'string' | 'number' | 'boolean'. The codec's actual contract. */
const shape_of = (payload) =>
  Object.fromEntries(
    Object.entries(payload)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => [key, typeof value])
  )

const view = board_state_from_fight({ fight: snapshot_from_sim(chain, { now_ms: 0 }), version: 1 })
const fold_one = (row) =>
  normalize_events(
    { events: [row] },
    {
      version: 2,
      fight_id: view.id,
      resolve_seat: seat_resolver(view),
      base_of: base_budget(view),
    }
  ).reduce(apply_action, base_from_view(view, FIGHT_ID))

describe('captured wire bytes — the encoder speaks the chain dialect, not a second one', () => {
  test('the fixture corpus really is captured chain truth (live package ids, not a mock)', () => {
    expect(CAPTURED.size).toBeGreaterThan(6)
    for (const event of CAPTURED.values()) expect(event.type).toMatch(/^0x[0-9a-f]{64}::fight_events::/)
  })

  for (const [kind, captured] of CAPTURED)
    if (EMITTED.has(kind))
      test(`${kind} — key set + JSON scalar types match the captured row`, () => {
        expect(shape_of(EMITTED.get(kind).parsedJson)).toEqual(shape_of(captured.parsedJson))
      })

  test('every emitted kind is pinned by the captured corpus, or explicitly justified', () => {
    // `Granted` can never appear in a captured stream: `give_points` emits NO chain event (inputs.js's own
    // note on the arm), so it exists only as the fold's grant kind — the spec still mandates it for
    // `ap_reserve_used`. `StanceChanged`/`Revealed`/`CriticalFailure` are real structs (fight_events.move) that
    // this corpus's sessions simply never produced, and `Victory`/`Defeat` need a fight that actually ENDED —
    // none of the captured sessions did. All six are pinned against their Move structs below instead.
    expect([...EMITTED.keys()].filter((k) => !CAPTURED.has(k)).sort()).toEqual(Object.keys(MOVE_STRUCT_SHAPES).sort())
  })

  // The corpus is silent on these, so pin them against `packages/move/engine/sources/fight_events.move`
  // directly — the same u64-as-string / u8-as-number law the captured rows above prove empirically.
  const MOVE_STRUCT_SHAPES = {
    Victory: { aged_bp: 'string', fight: 'string' },
    Defeat: { fight: 'string' },
    CriticalFailure: { caster_idx: 'string', caster_is_mob: 'boolean', fight: 'string' },
    Revealed: { fight: 'string', idx: 'string', is_mob: 'boolean' },
    StanceChanged: {
      active: 'boolean',
      fight: 'string',
      fighter_idx: 'string',
      fighter_is_mob: 'boolean',
      stance: 'string',
    },
    Granted: {
      fight: 'string',
      granted: 'string',
      point_kind: 'number',
      target_idx: 'string',
      target_is_mob: 'boolean',
    },
  }

  for (const [kind, shape] of Object.entries(MOVE_STRUCT_SHAPES))
    test(`${kind} — key set + JSON scalar types match its Move struct`, () => {
      expect(shape_of(EMITTED.get(kind).parsedJson)).toEqual(shape)
    })

  test('a captured row and its sim_chain twin fold to the SAME committed state', () => {
    for (const [kind, captured] of CAPTURED) {
      if (!EMITTED.has(kind)) continue
      const mine = EMITTED.get(kind)
      // Re-address the captured payload onto THIS fight's identities while keeping its OWN scalar encoding
      // verbatim — so the only thing under test is the encoding, not the values.
      const adopted = {
        type: captured.type,
        parsedJson: Object.fromEntries(
          Object.entries(captured.parsedJson).map(([key, value]) => [
            key,
            key === 'fight' ? FIGHT_ID : (mine.parsedJson[key] ?? value),
          ])
        ),
      }
      expect(decode_fight_event(adopted).kind).toBe(kind)
      expect({ kind, ...fold_projection(fold_one(adopted)) }).toEqual({
        kind,
        ...fold_projection(fold_one({ ...mine, type: captured.type })),
      })
    }
  })

  test('the emitted package prefix is namespaced and can never collide with a deployed package', () => {
    for (const row of EMITTED.values()) expect(row.type).toStartWith('0xsim::fight_events::')
  })
})
