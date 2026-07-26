// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// THE KNOCKBACK THAT HEALS (a phantom purple "+4" heal number) — a push-collision on a mob carrying DAMAGE_TO_HEAL used
// to render a HEAL floater on the OPTIMISTIC-PREDICTION lane while the CHAIN (receipt) authored raw collision
// DAMAGE — a twin divergence. Move applies a collision via `hit_mob`/`hit_player` (raw, no reaction pipeline), so
// the sim must too: a knockback is DAMAGE-or-none, NEVER heal. Both render lanes must agree, beat for beat.

import { describe, expect, test } from 'bun:test'
import { create_fight_state, reduce } from '@aresrpg/sim/reduce'
import { normalize_spell_templates } from '@aresrpg/sim/spell_templates'

import { produce_predicted_render_events, produce_receipt_render_turns } from '../src/fight_render_events.js'

const W = 20
const enc = (x, y) => y * W + x

const build_arena = () => {
  const cells = new Uint8Array(W * 19)
  cells[enc(6, 8)] = 1 // a WALL one cell ahead of the mob → the push's first step is blocked → collision damage
  return { width: W, height: 19, radius: 9, center: { x: 10, y: 9 }, cells, spawns_a: [], spawns_b: [] }
}

const level = (overrides) => ({
  cost: 0,
  range: [0, 20],
  critical_chance: 0,
  area: 0,
  area_type: 'circle',
  casts_per_turn: 255,
  casts_per_target: 255,
  cooldown_turns: 0,
  modifiable_range: false,
  line_of_sight: false,
  linear: false,
  free_cell: false,
  base_effects: [],
  critical_effects: [],
  ...overrides,
})

const spell_templates = normalize_spell_templates({
  test: {
    push: {
      name: 'Push',
      levels: [level({ range: [1, 1], base_effects: [{ type: 'push', distance: 3, target: 'enemies', chance: 100 }] })],
    },
  },
})

const fighter = (id, cell, is_player, overrides = {}) => ({
  id,
  name: id,
  cell,
  health: 100,
  health_max: 100,
  ap: 10,
  ap_max: 10,
  mp: 5,
  mp_max: 5,
  ap_used: 0,
  mp_used: 0,
  is_player,
  template_id: 'test',
  level: 1,
  stats: { agility: 0, intelligence: 0, chance: 0, strength: 0, range: 0 },
  effects: [],
  spell_levels: { push: 1 },
  ap_reserve: 0,
  ...overrides,
})

// A live damage-to-heal inversion on the mob: at HEAD it converts the collision impact into a heal (the bug).
const INVERSION = {
  type: 'DAMAGE_TO_HEAL',
  source_id: 'x',
  value: 1,
  heal_multiplier: 1,
  chance: 100,
  turns_remaining: 5,
}

const started = () => {
  const ctx = { arena: build_arena(), spell_templates }
  const initial = create_fight_state({
    fight_id: 'fight-1',
    arena_seed: 1,
    arena_radius: 9,
    arena: ctx.arena,
    team0: [fighter('p0', { x: 4, y: 8 }, true), fighter('p1', { x: 2, y: 2 }, true)],
    team1: [
      fighter('m0', { x: 5, y: 8 }, false, { health: 20, effects: [INVERSION] }),
      fighter('m1', { x: 10, y: 8 }, false),
    ],
  })
  return { state: reduce(initial, { type: 'start' }, ctx).state, ctx }
}

const PUSH_CMD = { type: 'cast', entity_id: 'p0', spell_id: 'push', target: { x: 5, y: 8 } }

// The chain events Move authors for this exact collision: a Displaced (fully blocked, to == from) + a raw Hit
// (20 → 17). Move NEVER emits a heal for a collision — the receipt lane is the honest oracle.
const receipt_event = (suffix, fields) => ({
  type: `0xE::fight_events::${suffix}`,
  parsedJson: { fight: 'fight-1', ...fields },
})
const RECEIPT_EVENTS = [
  receipt_event('Cast', { caster_is_mob: false, caster_idx: '0', target_cell: String(enc(5, 8)) }),
  receipt_event('Displaced', {
    target_is_mob: true,
    target_idx: '0',
    kind: '12',
    from_cell: String(enc(5, 8)),
    to_cell: String(enc(5, 8)),
    requested: '3',
    blocked: '3',
  }),
  receipt_event('Hit', { victim_is_mob: true, victim_idx: '0', amount: '3', remaining_hp: '17' }),
]
const RECEIPT_CTX = {
  fight_id: 'fight-1',
  grid_width: W,
  resolve_fighter_id: ({ is_mob, idx, character }) => character ?? `${is_mob ? 'm' : 'p'}${idx}`,
}

const kinds = (events) => events.map((event) => event.kind)

describe('collision-heal twin — a push collision renders DAMAGE, never heal, on both lanes', () => {
  test('PREDICTION lane: pushing a DAMAGE_TO_HEAL mob into a wall emits ZERO heal beat and a damage beat', () => {
    const { state, ctx } = started()
    const pushed = produce_predicted_render_events(state, PUSH_CMD, ctx)
    expect(kinds(pushed.events)).not.toContain('heal') // RED at HEAD: a 'heal' beat is emitted
    expect(pushed.events.find((event) => event.kind === 'damage').payload).toMatchObject({
      target_id: 'm0',
      damage: 3,
      new_health: 17,
      killed: false,
    })
    // FOLD (state): the mob is DAMAGED 20 → 17, never healed to 23.
    expect(pushed.state.team1[0]).toMatchObject({ id: 'm0', health: 17 })
  })

  test('RECEIPT lane: the chain-authored collision is a damage beat, ZERO heal beat', () => {
    const beats = produce_receipt_render_turns(RECEIPT_EVENTS, RECEIPT_CTX).turns.flatMap((turn) => turn.events)
    expect(kinds(beats)).not.toContain('heal')
    expect(beats.find((event) => event.kind === 'damage').payload).toMatchObject({
      target_id: 'm0',
      damage: 3,
      new_health: 17,
    })
  })

  test('TWIN: the predicted collision beat matches the confirmed receipt beat (kind + amount + landing HP)', () => {
    const { state, ctx } = started()
    const predicted = produce_predicted_render_events(state, PUSH_CMD, ctx).events.find(
      (event) => event.kind === 'damage'
    )
    const confirmed = produce_receipt_render_turns(RECEIPT_EVENTS, RECEIPT_CTX)
      .turns.flatMap((turn) => turn.events)
      .find((event) => event.kind === 'damage')
    expect(predicted.kind).toBe(confirmed.kind)
    expect(predicted.payload.damage).toBe(confirmed.payload.damage)
    expect(predicted.payload.new_health).toBe(confirmed.payload.new_health)
  })
})
