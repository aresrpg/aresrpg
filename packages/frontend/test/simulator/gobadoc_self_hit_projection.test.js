// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #1809, THE PRESENTATION HALF — "test gobadoc in the simulator". Resolution was already proven clean on both
// twins (packages/sim/test/aoe_splash_target_filter.test.js · packages/move/engine/tests/aoe_target_filter_tests.move).
// A player screenshots a self-hit from the DISPLAY, so this drives the real Gobadoc kit row through the sim
// reducer with the caster standing inside its own zone and then runs every surface that renders that cast:
//
//   ① the reducer's own `fight_cast` packet (the simulator's cast-result event, effects verbatim)
//   ② `beats_from_packet` — the floater/flinch beat sequence the voxel adapter plays
//   ③ `encode_sim_step` → `produce_receipt_render_turns` — the CHAIN-shaped receipt render path
//   ④ `emit_cast_log` — the combat-log composer
//
// The kill/confirm question: does any of them attribute damage to the CASTER (or to every body standing in the
// zone cells) while resolution correctly skipped it? All four must name the enemy and nobody else.

import { describe, expect, test } from 'bun:test'
import { produce_receipt_render_turns } from '@aresrpg/fight/fight_render_events'
import { encode_sim_step } from '@aresrpg/fight/sim_chain'
import { create_fight_state, reduce } from '@aresrpg/sim/reduce'
import { normalize_spell_templates } from '@aresrpg/sim/spell_templates'

import { emit_cast_log } from '../../src/game/core/modules/fight.js'
import { beats_from_packet } from '../../src/world-shell/voxel_fight_folds.js'
import FIXTURE from '../../../sim/test/fixtures/aoe_splash_target_filter.json' with { type: 'json' }

const GRID_W = 20
const decode = (cell) => ({ x: cell % GRID_W, y: Math.floor(cell / GRID_W) })
const CASTER = 'gobadoc'
const ALLY = 'gobling'
const ENEMY = 'player'
const SPELL = 'devastating_slam'
const FIGHT_ID = '0xgobadoc'

// The 21×21 flat arena the sim's own reducer walks; every fixture cell sits well inside it.
const ARENA = {
  width: 21,
  height: 21,
  radius: 10,
  center: { x: 10, y: 10 },
  cells: new Uint8Array(21 * 21),
  spawns_a: [],
  spawns_b: [],
}

const fighter = (id, cell, is_player) => ({
  id,
  name: id,
  cell: decode(cell),
  health: 400,
  health_max: 400,
  ap: 12,
  ap_max: 12,
  mp: 4,
  mp_max: 4,
  ap_used: 0,
  mp_used: 0,
  is_player,
  template_id: is_player ? 'senshi' : 'gobadoc',
  level: 30,
  stats: {},
  effects: [],
  spell_levels: { [SPELL]: 1 },
  ap_reserve: 0,
})

// Gobadoc the Gourmand's Devastating Slam, verbatim from the chain read pinned in the fixture:
// {kind:0, element:0, area_shape:1 (circle), area_size:2, target_filter:1 (enemies), chance:100}.
const TEMPLATES = normalize_spell_templates([
  {
    id: SPELL,
    levels: [
      {
        ap_cost: 4,
        range_min: 1,
        range_max: 2,
        modifiable_range: false,
        line_launch: false,
        line_of_sight: false,
        free_cell: false,
        casts_per_turn: 255,
        casts_per_target: 255,
        cooldown_turns: 2,
        crit_rate: 0,
        effects: [
          {
            kind: FIXTURE.effect.kind,
            element: 'FIRE',
            value: FIXTURE.effect.value,
            value_max: FIXTURE.effect.value_max,
            area_shape: FIXTURE.effect.area_shape,
            area_size: FIXTURE.effect.area_size,
            target_filter: FIXTURE.effect.target_filter,
            chance: 100,
          },
        ],
        crit_effects: [],
      },
    ],
  },
])

/** The board: the boss on its own zone's centre-adjacent cell, its mob ally beside it, the player aimed at. */
const gobadoc_board = () => ({
  ...create_fight_state({
    fight_id: FIGHT_ID,
    arena_seed: 1,
    arena_radius: 10,
    arena: ARENA,
    team0: [fighter(ENEMY, FIXTURE.enemy_cell, true)],
    team1: [fighter(CASTER, FIXTURE.caster_cell, false), fighter(ALLY, FIXTURE.ally_cell, false)],
  }),
  started: true,
  turn_order: [CASTER, ALLY, ENEMY],
  turn_number: 1,
})

/** Drive the real reducer's cast door — the simulator's own path (fight_shim → sim_chain → reduce). */
const cast = () => {
  const pre_state = gobadoc_board()
  const { state: post_state, events } = reduce(
    pre_state,
    { type: 'cast', entity_id: CASTER, spell_id: SPELL, target: decode(FIXTURE.target_cell) },
    { arena: ARENA, spell_templates: TEMPLATES }
  )
  const packet = events.find((event) => event.type === 'fight_cast')
  return { pre_state, post_state, events, packet }
}

describe('#1809 presentation — Gobadoc casts Devastating Slam standing in its own zone', () => {
  test('the reducer resolves the cast and the packet exists (the drive is real)', () => {
    const { packet, post_state } = cast()
    expect(packet).toBeDefined()
    // Sanity: the caster IS inside the zone it just drew (FIXTURE.zone_cells contains its cell), so every
    // surface below had the chance to mis-attribute.
    expect(FIXTURE.zone_cells).toContain(FIXTURE.caster_cell)
    expect(FIXTURE.zone_cells).toContain(FIXTURE.ally_cell)
    const hp = (id) => [...post_state.team0, ...post_state.team1].find((e) => e.id === id).health
    expect(hp(ENEMY)).toBeLessThan(400)
    expect(hp(CASTER)).toBe(400)
    expect(hp(ALLY)).toBe(400)
  })

  test('① the cast packet names ONLY the enemy — no caster row, no ally row', () => {
    const { packet } = cast()
    expect(packet.effects.map((effect) => effect.target_id)).toEqual([ENEMY])
  })

  test('② the floater beats put the number on the enemy; the caster only swings', () => {
    const { packet } = cast()
    const beats = beats_from_packet({
      entity_id: packet.entity_id,
      effects: packet.effects,
      is_critical: packet.is_critical,
    })
    // The caster's beat is the attack swing and carries NO float — a self-hit would show up as a float here.
    expect(beats[0]).toMatchObject({ id: CASTER, anim: 'attack', float: null })
    const floated = beats.filter((beat) => beat.float != null)
    expect(floated.map((beat) => beat.id)).toEqual([ENEMY])
    expect(floated[0].float.kind).toBe('damage')
  })

  test('③ the chain-shaped receipt render path damages the enemy and nobody else', () => {
    const { pre_state, post_state, events } = cast()
    const { rows } = encode_sim_step({
      pre_state,
      post_state,
      events,
      fight_id: FIGHT_ID,
      spell_templates: TEMPLATES,
    })
    const { turns } = produce_receipt_render_turns(rows, {
      fight_id: FIGHT_ID,
      // mob idx 0 is the caster, idx 1 its ally, seat 0 the player — the simulator's own identity map.
      resolve_fighter_id: ({ is_mob, idx }) => (is_mob ? [CASTER, ALLY][Number(idx)] : ENEMY),
    })
    const damage_beats = turns.flatMap((turn) => turn.events).filter((beat) => beat.kind === 'damage')
    expect(damage_beats.length).toBeGreaterThan(0)
    expect([...new Set(damage_beats.map((beat) => beat.payload.target_id))]).toEqual([ENEMY])
    // The caster's only beat in this turn is its cast — it is never the target of a damage beat.
    expect(turns.flatMap((turn) => turn.events).some((beat) => beat.kind === 'cast')).toBe(true)
  })

  test('④ the combat log names the enemy as the only target', () => {
    const { packet } = cast()
    const lines = []
    const fighters = new Map([
      [CASTER, { name: 'Gobadoc the Gourmand', dead: false }],
      [ALLY, { name: 'Gobling', dead: false }],
      [ENEMY, { name: 'Player', dead: false }],
    ])
    emit_cast_log(
      () => ({ fight: { fighters } }),
      (_type, payload) => lines.push(payload),
      { entity_id: CASTER, spell_id: SPELL, effects: packet.effects, is_critical: packet.is_critical }
    )
    // TARGET attribution is the `clog-target` segment's ref (the `clog-name` segment is the ACTOR — the caster
    // legitimately names itself there). No result line may point a TARGET segment at the caster or its ally.
    const targets = lines.flatMap((line) =>
      (line.segments ?? []).filter((segment) => segment.cls === 'clog-target').map((segment) => segment.ref)
    )
    expect(targets).toEqual([ENEMY])
  })

  // POSITIVE CONTROL — the instrument must be able to FAIL. This is the bug's exact shape: a packet whose
  // effect rows were built from the ZONE CELL SET instead of the resolved victims. Every surface above then
  // does name the caster, which proves the four assertions are discriminating rather than vacuous.
  test('a zone-keyed packet WOULD show the self-hit — the fixture discriminates', () => {
    const { packet } = cast()
    const zone_effects = [CASTER, ALLY, ENEMY].map((target_id) => ({
      target_id,
      damage: FIXTURE.effect.value,
      new_health: 400 - FIXTURE.effect.value,
      has_health: true,
    }))
    const beats = beats_from_packet({ entity_id: CASTER, effects: zone_effects, is_critical: false })
    expect(beats.filter((beat) => beat.float != null).map((beat) => beat.id)).toEqual([CASTER, ALLY, ENEMY])
    const lines = []
    const fighters = new Map([CASTER, ALLY, ENEMY].map((id) => [id, { name: id, dead: false }]))
    emit_cast_log(
      () => ({ fight: { fighters } }),
      (_type, payload) => lines.push(payload),
      { entity_id: CASTER, spell_id: SPELL, effects: zone_effects, is_critical: false }
    )
    const targets = lines.flatMap((line) =>
      (line.segments ?? []).filter((segment) => segment.cls === 'clog-target').map((segment) => segment.ref)
    )
    expect(targets).toEqual([CASTER, ALLY, ENEMY])
    expect(packet.effects.map((effect) => effect.target_id)).not.toEqual(zone_effects.map((e) => e.target_id))
  })
})
