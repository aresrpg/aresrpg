// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #2177 — A PLACED TRAP'S ZONE IS THE BOARD'S, NOT THE CAST'S.
//
// THE CHAIN NEVER MATERIALIZES A TRAP ZONE. `cast::place_effects` stores the ANCHOR plus the raw
// `(area_shape, area_size)` on the board (cast.move:1769 → spell_board.move `place_trap`), and coverage is
// re-asked at TRIGGER time by `spell_board::trap_index_covering` → `combat_grid::in_zone`
// (combat_grid.move:707-718). `in_zone` has no caster, so it CANNOT honour a cast direction: LINE / TBAR /
// PODIUM / CONE all fall through its last line to the filled lozenge `d <= size`.
//
// The sim materialized the CAST zone instead (`get_aoe_cells(effect, target, caster.cell)` — caster-relative),
// so a directional trap covered a STRIP the chain never stored. Walking into the chain's lozenge outside that
// strip detonates on chain and predicts NOTHING locally — #2145's family: a prediction input the twin does not
// share. The owner's own trap is the only trap a client can see, so the owner is who this bites.
//
// The sim comes UP to chain truth: a PLACED zone drops the direction, exactly as `in_zone` does.

import { describe, expect, test } from 'bun:test'

import { find_entity } from '../src/fight_state.js'
import { create_fight_state, reduce } from '../src/reduce.js'
import { SHAPE_CIRCLE, SHAPE_LINE } from '../src/spell_effect.js'
import { normalize_spell_templates } from '../src/spell_templates.js'
import { get_aoe_cells } from '../src/spell_targeting.js'

const OWNER = { x: 0, y: 2 }
const ANCHOR = { x: 6, y: 2 }
// manhattan 2 from ANCHOR, and the first such cell the walk enters — inside the chain's stored lozenge, outside
// every direction the cast could have produced.
const LOZENGE_STEP = { x: 4, y: 2 }
const DESTINATION = { x: 5, y: 2 }

const arena = {
  width: 14,
  height: 5,
  radius: 0,
  center: { x: 7, y: 2 },
  cells: new Uint8Array(14 * 5),
  spawns_a: [],
  spawns_b: [],
}

const fighter = (id, cell, is_player) => ({
  id,
  name: id,
  cell,
  health: 200,
  health_max: 200,
  ap: 10,
  ap_max: 10,
  mp: 6,
  mp_max: 6,
  ap_used: 0,
  mp_used: 0,
  is_player,
  template_id: 'trap-board-zone',
  level: 1,
  stats: {},
  effects: [],
  spell_levels: {},
  ap_reserve: 0,
})

const trap_spell = area_shape =>
  normalize_spell_templates([
    {
      id: 'board_zone_trap',
      levels: [
        {
          ap_cost: 0,
          range_min: 0,
          range_max: 9,
          modifiable_range: false,
          line_launch: false,
          line_of_sight: false,
          free_cell: true,
          casts_per_turn: 255,
          casts_per_target: 255,
          cooldown_turns: 0,
          crit_rate: 0,
          effects: [
            {
              kind: 19, // K_PLACE_TRAP
              element: 255,
              target_filter: 0,
              area_shape,
              area_size: 2,
              value: 0,
            },
            { kind: 0, element: 0, target_filter: 0, value: 30, value_max: 30 }, // the sibling payload line
          ],
          crit_effects: [],
        },
      ],
    },
  ]).get('board_zone_trap')

const staged = () => ({
  ...create_fight_state({
    fight_id: 'trap-board-zone',
    arena_seed: 3,
    arena_radius: 0,
    arena,
    team0: [fighter('owner', OWNER, true)],
    team1: [fighter('mob', { x: 13, y: 2 }, false)],
  }),
  started: true,
  turn_order: ['owner'],
  turn_number: 1,
})

/** Cast the trap at ANCHOR, then walk the owner across the chain's lozenge. */
const place_then_walk = area_shape => {
  const spell = trap_spell(area_shape)
  const ctx = { arena, spell_templates: new Map([[spell.id, spell]]) }
  const cast = reduce(
    staged(),
    {
      type: 'cast',
      entity_id: 'owner',
      spell_id: spell.id,
      target: ANCHOR,
    },
    ctx,
  )
  expect(cast.state.traps).toHaveLength(1)
  return {
    placed: cast.state.traps[0],
    walked: reduce(
      cast.state,
      { type: 'move', entity_id: 'owner', path: [DESTINATION] },
      ctx,
    ),
  }
}

const covers = (trap, cell) =>
  trap.cells.some(c => c.x === cell.x && c.y === cell.y)

describe('#2177 — a placed trap covers the chain’s stored zone, not the cast’s', () => {
  test('the cast-time zone of a LINE effect is still directional (the input this is NOT)', () => {
    const spell = trap_spell(SHAPE_LINE)
    const cells = get_aoe_cells(spell.levels[0].base_effects[0], ANCHOR, OWNER)

    // anchor + 2 more cells away from the caster: a strip, and LOZENGE_STEP sits behind the anchor.
    expect(cells).toEqual([
      { x: 6, y: 2 },
      { x: 7, y: 2 },
      { x: 8, y: 2 },
    ])
    expect(cells).not.toContainEqual(LOZENGE_STEP)
  })

  test('a LINE trap on the board is the lozenge the chain’s in_zone falls back to', () => {
    const { placed } = place_then_walk(SHAPE_LINE)

    expect(placed.anchor).toEqual(ANCHOR)
    expect(covers(placed, LOZENGE_STEP)).toBe(true)
    // in_zone(circle-fallback, 2): every cell within manhattan 2, and nothing beyond it.
    expect(covers(placed, { x: 6, y: 4 })).toBe(true)
    expect(covers(placed, { x: 3, y: 2 })).toBe(false)
  })

  test('the placer detonates it by walking into that lozenge', () => {
    const { walked } = place_then_walk(SHAPE_LINE)
    const triggers = walked.events.filter(
      event => event.type === 'fight_trap_triggered',
    )

    expect(triggers.map(event => event.cell)).toEqual([LOZENGE_STEP])
    expect(triggers[0].entity_id).toBe('owner')
    expect(find_entity(walked.state, 'owner').health).toBe(170)
    expect(walked.state.traps).toEqual([])
    // the walk RESUMES past a survived trap (movement.move:57-64)
    expect(find_entity(walked.state, 'owner').cell).toEqual(DESTINATION)
  })

  // THE POSITIVE CONTROL on the claim above: the board keeps ONE zone rule, so a CIRCLE trap of the same size
  // at the same anchor is byte-identical — and an isotropic shape must be untouched by the direction drop.
  test('a CIRCLE trap of the same size is the same board zone', () => {
    const line = place_then_walk(SHAPE_LINE)
    const circle = place_then_walk(SHAPE_CIRCLE)

    expect(line.placed.cells).toEqual(circle.placed.cells)
    expect(
      circle.walked.events.filter(
        event => event.type === 'fight_trap_triggered',
      ),
    ).toHaveLength(1)
  })
})
