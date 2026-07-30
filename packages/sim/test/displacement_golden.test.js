// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, expect, test } from 'bun:test'

import {
  get_direction,
  handle_displacement,
  zone_edge_distance,
} from '../src/fight_displacement.js'
import { process_spell_cast } from '../src/fight_spells.js'
import { find_entity } from '../src/fight_state.js'
import { check_traps } from '../src/fight_traps.js'
import { create_fight_state, reduce } from '../src/reduce.js'
import { get_aoe_cells } from '../src/spell_targeting.js'
import {
  K_GEOMETRIC_PUSH,
  K_PUSH,
  SHAPE_POINT,
  TF_NOT_TEAM,
} from '../src/spell_effect.js'
import { normalize_spell_templates } from '../src/spell_templates.js'

import core_golden from './vectors/displacement_golden.json' with { type: 'json' }
import collision_golden from './vectors/displacement_collision_golden.json' with { type: 'json' }
import trap_golden from './vectors/displacement_traps_golden.json' with { type: 'json' }
import trap_owner_golden from './vectors/displacement_trap_owners_golden.json' with { type: 'json' }
import geometric_golden from './vectors/geometric_push_golden.json' with { type: 'json' }
import geometric_shapes_golden from './vectors/geometric_push_shapes_golden.json' with { type: 'json' }
import movement_golden from './vectors/ordinary_movement_golden.json' with { type: 'json' }

const golden = {
  ...core_golden,
  cases: [
    ...core_golden.cases,
    ...collision_golden.cases,
    ...trap_golden.cases,
    ...trap_owner_golden.cases,
  ],
  movement_cases: movement_golden.cases,
  geometric_cases: [
    ...geometric_golden.cases,
    ...geometric_shapes_golden.cases,
  ],
}

const cell_of = encoded => ({
  x: encoded % golden.grid.stride,
  y: Math.floor(encoded / golden.grid.stride),
})

const encode = cell => cell.y * golden.grid.stride + cell.x
const fighter_id = (is_mob, idx) => `${is_mob ? 'm' : 'p'}${idx}`
const spell_source = (source, target) => ({
  is_mob: source.caster_is_mob ?? source.target_is_mob ?? !target.target_is_mob,
  idx: source.caster_idx ?? source.idx ?? 0,
})

const entity_of = (spec, source, target) => {
  const spell_caster = spell_source(source, target)
  const is_source =
    source.type === 'spell' &&
    spec.target_is_mob === spell_caster.is_mob &&
    spec.idx === spell_caster.idx
  const is_owner =
    source.type === 'trap' &&
    source.owner_recorded &&
    !spec.target_is_mob &&
    spec.idx === (source.owner_seat ?? 0)
  const level =
    spec.level ??
    (is_source ? source.level : undefined) ??
    (is_owner ? source.owner_level : undefined) ??
    1
  return {
    id: fighter_id(spec.target_is_mob, spec.idx),
    name: fighter_id(spec.target_is_mob, spec.idx),
    cell: cell_of(spec.cell),
    health: spec.hp,
    health_max: 100,
    ap: spec.ap ?? (is_source ? (source.ap ?? 10) : 10),
    ap_max: spec.ap_max ?? 10,
    mp: spec.mp ?? 5,
    mp_max: spec.mp_max ?? spec.mp ?? 5,
    ap_used: 0,
    mp_used: 0,
    is_player: !spec.target_is_mob,
    template_id: 'golden',
    level,
    stats: {},
    effects: [],
    spell_levels: {},
    ap_reserve: 0,
  }
}

const zone_cells = (anchor, shape, size) => {
  const cells = []
  for (let dy = -size; dy <= size; dy += 1) {
    for (let dx = -size; dx <= size; dx += 1) {
      const in_zone =
        shape === 'point'
          ? dx === 0 && dy === 0
          : shape === 'cross'
            ? (dx === 0 || dy === 0) && Math.abs(dx) + Math.abs(dy) <= size
            : Math.abs(dx) + Math.abs(dy) <= size
      if (in_zone) cells.push({ x: anchor.x + dx, y: anchor.y + dy })
    }
  }
  return cells
}

const normalized_effects = raw_effects => {
  const templates = normalize_spell_templates([
    {
      id: 'payload',
      levels: [
        {
          ap_cost: 0,
          range_min: 0,
          range_max: 0,
          crit_rate: 0,
          effects: raw_effects,
          crit_effects: [],
        },
      ],
    },
  ])
  return templates.get('payload').levels[0].base_effects
}

const trap_of = (trap, source, index) => {
  const anchor = cell_of(trap.anchor_cell)
  const owner_recorded = trap.owner_recorded ?? source.owner_recorded
  const owner_seat = trap.owner_seat ?? source.owner_seat ?? 0
  return {
    id: index + 1,
    source_id: owner_recorded
      ? fighter_id(trap.owner_is_mob ?? false, owner_seat)
      : `preupgrade-${index}`,
    anchor,
    cells: zone_cells(anchor, trap.zone_shape, trap.zone_size),
    payload: normalized_effects(trap.payload),
  }
}

const state_of = vector => {
  const { input } = vector
  const source = input.source ?? { type: 'movement' }
  const target = input.target ?? input.mover
  const board = golden.boards[input.board]
  const arena = {
    width: golden.grid.width,
    height: golden.grid.height,
    radius: 0,
    center: { x: 0, y: 0 },
    cells: new Uint8Array(golden.grid.width * golden.grid.height),
    spawns_a: [],
    spawns_b: [],
  }
  const entities = input.fighters.map(spec => entity_of(spec, source, target))
  const state = create_fight_state({
    fight_id: input.fight,
    arena_seed: 1,
    arena_radius: 0,
    arena,
    team0: entities.filter(entity => entity.is_player),
    team1: entities.filter(entity => !entity.is_player),
  })
  return {
    ...state,
    started: true,
    traps: input.traps.map((trap, index) => trap_of(trap, source, index)),
    board,
  }
}

const terrain_of = board => cell => {
  if (
    cell.x < 0 ||
    cell.y < 0 ||
    cell.x >= golden.grid.width ||
    cell.y >= golden.grid.height
  )
    return false
  const encoded = encode(cell)
  const word = BigInt(board.shape_mask[Math.floor(encoded / 64)] ?? '0')
  const on_shape = (word & (1n << BigInt(encoded % 64))) !== 0n
  return (
    on_shape &&
    !board.obstacles.includes(encoded) &&
    !board.holes.includes(encoded)
  )
}

const spell_of = vector => {
  const { source } = vector.input
  return normalize_spell_templates([
    {
      id: 'vector_displacement',
      levels: [
        {
          ap_cost: source.ap_cost ?? 0,
          range_min: 0,
          range_max: 255,
          modifiable_range: false,
          line_launch: false,
          line_of_sight: false,
          free_cell: false,
          casts_per_turn: 255,
          casts_per_target: 255,
          cooldown_turns: 0,
          crit_rate: 0,
          effects: [
            {
              kind: vector.input.effect.kind,
              value: vector.input.effect.requested ?? 0,
              target_filter: vector.input.effect.target_filter ?? TF_NOT_TEAM,
              chance: 100,
              area_shape: vector.input.effect.area_shape ?? SHAPE_POINT,
              area_size: vector.input.effect.area_size ?? 0,
            },
          ],
          crit_effects: [],
        },
      ],
    },
  ]).get('vector_displacement')
}

const run_vector = vector => {
  const { input } = vector
  const initial = state_of(vector)
  const terrain_walkable = terrain_of(initial.board)
  const target_id = fighter_id(input.target.target_is_mob, input.target.idx)
  if (input.source.type === 'trap') {
    const target = find_entity(initial, target_id)
    return check_traps(initial, target.cell, target_id, terrain_walkable)
  }
  const source = spell_source(input.source, input.target)
  const source_id = fighter_id(source.is_mob, source.idx)
  const spell_target =
    input.target_cell === undefined
      ? find_entity(initial, target_id).cell
      : cell_of(input.target_cell)
  return process_spell_cast(
    initial,
    source_id,
    spell_of(vector),
    1,
    spell_target,
    { blocks_los: () => false, is_occupied: () => false },
    terrain_walkable,
  )
}

const fighter_result = (state, spec) => {
  const entity = find_entity(state, fighter_id(spec.target_is_mob, spec.idx))
  const result = {
    target_is_mob: spec.target_is_mob,
    idx: spec.idx,
    cell: encode(entity.cell),
    hp: entity.health,
  }
  if ('level' in spec) result.level = entity.level
  return result
}

const target_meta = target_id => ({
  target_is_mob: target_id.startsWith('m'),
  target_idx: Number(target_id.slice(1)),
})

const event_results = (vector, result) => {
  const { input } = vector
  const positions = result.effects.filter(effect => effect.has_cell)
  const hits = result.effects.filter(effect => effect.damage !== undefined)
  const displaced = positions.map(effect => {
    const meta = target_meta(effect.target_id)
    const before = input.fighters.find(
      fighter =>
        fighter.target_is_mob === meta.target_is_mob &&
        fighter.idx === meta.target_idx,
    )
    const from = cell_of(before.cell)
    const moved =
      Math.abs(effect.cell.x - from.x) + Math.abs(effect.cell.y - from.y)
    const geometric = input.effect.kind === K_GEOMETRIC_PUSH
    const origin = cell_of(
      geometric
        ? input.target_cell
        : input.source.type === 'trap'
          ? input.source.anchor_cell
          : input.source.origin_cell,
    )
    const requested = geometric
      ? zone_edge_distance(
          get_aoe_cells(
            {
              area_shape: input.effect.area_shape,
              area_size: input.effect.area_size,
            },
            origin,
            cell_of(input.source.origin_cell),
          ),
          origin,
          from,
        )
      : input.effect.requested
    const direction =
      input.effect.kind === K_PUSH || geometric
        ? get_direction(origin, from)
        : get_direction(from, origin)
    const zero_direction = direction.dx === 0 && direction.dy === 0
    const crossed_trap =
      input.source.type === 'spell' &&
      input.traps.length > result.state.traps.length
    const blocked =
      !zero_direction && !crossed_trap && moved < requested
        ? requested - moved
        : 0
    return {
      fight: input.fight,
      ...meta,
      kind: input.effect.kind,
      from_cell: before.cell,
      to_cell: encode(effect.cell),
      requested,
      blocked,
    }
  })
  return {
    displaced,
    hits: hits.map(effect => {
      const meta = target_meta(effect.target_id)
      return {
        fight: input.fight,
        victim_is_mob: meta.target_is_mob,
        victim_idx: meta.target_idx,
        amount: effect.damage,
        remaining_hp: effect.new_health,
      }
    }),
  }
}

const arena_of = board => {
  const cells = new Uint8Array(golden.grid.width * golden.grid.height)
  const walkable = terrain_of(board)
  for (let encoded = 0; encoded < cells.length; encoded += 1)
    if (!walkable(cell_of(encoded))) cells[encoded] = 1
  return {
    width: golden.grid.width,
    height: golden.grid.height,
    radius: 0,
    center: { x: 0, y: 0 },
    cells,
    spawns_a: [],
    spawns_b: [],
  }
}

const run_movement_vector = vector => {
  const initial = state_of(vector)
  const { mover } = vector.input
  const mover_id = fighter_id(mover.target_is_mob, mover.idx)
  const state = {
    ...initial,
    turn_order: [mover_id],
    current_turn_idx: 0,
  }
  return reduce(
    state,
    {
      type: 'move',
      entity_id: mover_id,
      path: vector.input.path.map(cell_of),
    },
    {
      arena: arena_of(initial.board),
      spell_templates: new Map(),
    },
  )
}

const movement_event_results = result => {
  const moved = result.events.find(event => event.type === 'fight_moved')
  const triggered = result.events.find(
    event => event.type === 'fight_trap_triggered',
  )
  return {
    moved: {
      entity_id: moved.entity_id,
      path: moved.path.map(encode),
      mp_remaining: moved.mp_remaining,
    },
    trap_triggered: {
      entity_id: triggered.entity_id,
      cell: encode(triggered.cell),
      hits: triggered.effects
        .filter(effect => effect.damage !== undefined)
        .map(effect => ({
          target_id: effect.target_id,
          amount: effect.damage,
          remaining_hp: effect.new_health,
        })),
    },
  }
}

describe('Move displacement golden vectors', () => {
  test('declares the canonical parity rule set', () => {
    expect(golden.schema_version).toBe(1)
    expect(golden.rules).toEqual({
      direction: 'dominant_cardinal_axis_x_wins_ties',
      hard_stops: [
        'rectangle_edge',
        'off_shape',
        'hole',
        'obstacle',
        'living_body',
      ],
      trap_stop: 'enter_trigger_stop_without_collision',
      collision: 'max(12*collision_level/50,1)*blocked_cells_target_only',
      pull_collision: 'same_as_push',
      preupgrade_trap_collision_level: 1,
      ordinary_movement:
        'validate_full_path_then_interleave_enter_trigger_resume_spend_full_path_owner_blind_stop_only_on_death_or_displace',
      geometric_push:
        'all_fighters_away_from_target_cell_until_effect_zone_edge',
    })
    expect(golden.cases.length).toBeGreaterThanOrEqual(12)
    expect(golden.movement_cases).toHaveLength(2)
    expect(golden.geometric_cases).toHaveLength(9)
  })

  for (const vector of golden.cases) {
    test(vector.id, () => {
      const result = run_vector(vector)
      expect(result.success ?? result.triggered).toBe(true)
      expect(
        vector.expected.fighters.map(spec =>
          fighter_result(result.state, spec),
        ),
      ).toEqual(vector.expected.fighters)
      expect(result.state.traps).toHaveLength(vector.expected.traps.length)

      if (vector.expected.effective_collision_level !== undefined) {
        const collision_level = vector.input.source.owner_recorded
          ? find_entity(
              result.state,
              fighter_id(false, vector.input.source.owner_seat ?? 0),
            ).level
          : 1
        expect(collision_level).toBe(vector.expected.effective_collision_level)
      }

      if (vector.expected.source_ap !== undefined) {
        const source_ref = spell_source(
          vector.input.source,
          vector.input.target,
        )
        const source = find_entity(
          result.state,
          fighter_id(source_ref.is_mob, source_ref.idx),
        )
        expect(source.ap).toBe(vector.expected.source_ap)
      }

      const expected_positions = vector.expected.events.displaced.map(
        event => ({
          target_id: fighter_id(event.target_is_mob, event.target_idx),
          cell: cell_of(event.to_cell),
          has_cell: true,
        }),
      )
      const expected_hits = vector.expected.events.hits.map(event => ({
        target_id: fighter_id(event.victim_is_mob, event.victim_idx),
        damage: event.amount,
        new_health: event.remaining_hp,
        killed: event.remaining_hp === 0,
      }))
      expect(result.effects.filter(effect => effect.has_cell)).toEqual(
        expected_positions,
      )
      expect(
        result.effects.filter(effect => effect.damage !== undefined),
      ).toEqual(expected_hits)
      expect(result.effects).toHaveLength(
        expected_positions.length + expected_hits.length,
      )
      expect(event_results(vector, result)).toEqual(vector.expected.events)
    })
  }

  for (const vector of golden.movement_cases) {
    test(vector.id, () => {
      const result = run_movement_vector(vector)
      expect(
        vector.expected.fighters.map(spec =>
          fighter_result(result.state, spec),
        ),
      ).toEqual(vector.expected.fighters)
      expect(result.state.traps).toHaveLength(vector.expected.traps.length)
      expect(movement_event_results(result)).toEqual(vector.expected.events)
    })
  }

  for (const vector of golden.geometric_cases) {
    test(vector.id, () => {
      const result = run_vector(vector)
      expect(result.success).toBe(true)
      expect(
        vector.expected.fighters.map(spec =>
          fighter_result(result.state, spec),
        ),
      ).toEqual(vector.expected.fighters)
      expect(result.state.traps).toHaveLength(vector.expected.traps.length)

      const expected_positions = vector.expected.events.displaced.map(
        event => ({
          target_id: fighter_id(event.target_is_mob, event.target_idx),
          cell: cell_of(event.to_cell),
          has_cell: true,
        }),
      )
      const expected_hits = vector.expected.events.hits.map(event => ({
        target_id: fighter_id(event.victim_is_mob, event.victim_idx),
        damage: event.amount,
        new_health: event.remaining_hp,
        killed: event.remaining_hp === 0,
      }))
      expect(result.effects.filter(effect => effect.has_cell)).toEqual(
        expected_positions,
      )
      expect(
        result.effects.filter(effect => effect.damage !== undefined),
      ).toEqual(expected_hits)
      expect(result.effects).toHaveLength(
        expected_positions.length + expected_hits.length,
      )
      expect(event_results(vector, result)).toEqual(vector.expected.events)
    })
  }

  test('a same-team fighter crossing a displacement trap triggers and stops', () => {
    const vector = golden.cases.find(
      candidate => candidate.id === 'player_spell_mob_push_2_noop_regression',
    )
    const state = state_of(vector)
    const ally = {
      ...state.team0[0],
      id: 'p1',
      name: 'p1',
      cell: cell_of(165),
    }
    const trapped = {
      ...state,
      team0: [...state.team0, ally],
      traps: [
        {
          id: 1,
          source_id: 'p0',
          anchor: cell_of(167),
          cells: [cell_of(167)],
          payload: normalized_effects([{ kind: 0, element: 2, value: 7 }]),
        },
      ],
    }
    const terrain_walkable = terrain_of(state.board)
    const displaced = handle_displacement(
      trapped,
      'p1',
      get_direction(cell_of(164), cell_of(165)),
      3,
      50,
      terrain_walkable,
      (next_state, cell, target_id) =>
        check_traps(next_state, cell, target_id, terrain_walkable),
    )

    expect(find_entity(displaced.state, 'p1')).toMatchObject({
      cell: cell_of(167),
      health: 93,
    })
    expect(displaced.state.traps).toEqual([])
    expect(displaced.effects.at(-1)).toEqual({
      target_id: 'p1',
      cell: cell_of(167),
      has_cell: true,
    })
  })

  test('an ALLY walking over the trap owner’s trap triggers it and resumes the walk (#320 owner/ally-blind, #325)', () => {
    // p0 OWNS the trap at cell 166; p1 (same team) walks 164→165→166→167 across it. check_traps has no team gate,
    // so the trap fires on the ally, and the ordinary walk RESUMES to 167 with its full MP spent.
    const [vector] = golden.movement_cases
    const initial = state_of(vector)
    const owner = { ...find_entity(initial, 'p0'), cell: cell_of(100) } // stand the subject clear of the route
    const ally = {
      ...owner,
      id: 'p1',
      name: 'p1',
      cell: cell_of(164),
      health: 100,
      mp: 3,
    }
    const state = {
      ...initial,
      team0: [owner, ally],
      turn_order: ['p1'],
      current_turn_idx: 0,
    }
    const result = reduce(
      state,
      { type: 'move', entity_id: 'p1', path: [165, 166, 167].map(cell_of) },
      { arena: arena_of(initial.board), spell_templates: new Map() },
    )
    expect(find_entity(result.state, 'p1')).toMatchObject({
      cell: cell_of(167),
      health: 93,
    })
    expect(result.state.traps).toHaveLength(0)
    const triggered = result.events.find(
      event => event.type === 'fight_trap_triggered',
    )
    expect(triggered.cell).toEqual(cell_of(166))
    const moved = result.events.find(event => event.type === 'fight_moved')
    expect(moved.path.map(encode)).toEqual([165, 166, 167])
    expect(moved.mp_remaining).toBe(0)
  })

  test('a walk crossing TWO traps fires each in path order and still resumes (#325 multi-trap)', () => {
    const initial = state_of(golden.movement_cases[0])
    const mover = {
      ...find_entity(initial, 'p0'),
      cell: cell_of(164),
      health: 100,
      mp: 4,
    }
    const payload = normalized_effects([{ kind: 0, element: 2, value: 7 }])
    const state = {
      ...initial,
      team0: [mover], // team1 keeps the bystander mob (m0 @200) so no premature victory
      turn_order: ['p0'],
      current_turn_idx: 0,
      traps: [
        {
          id: 1,
          source_id: 'p0',
          anchor: cell_of(166),
          cells: [cell_of(166)],
          payload,
        },
        {
          id: 2,
          source_id: 'p0',
          anchor: cell_of(168),
          cells: [cell_of(168)],
          payload,
        },
      ],
    }
    const result = reduce(
      state,
      {
        type: 'move',
        entity_id: 'p0',
        path: [165, 166, 167, 168].map(cell_of),
      },
      { arena: arena_of(initial.board), spell_templates: new Map() },
    )
    // Both 7-damage traps land (100 → 93 → 86); the mover finishes the full 4-cell path.
    expect(find_entity(result.state, 'p0')).toMatchObject({
      cell: cell_of(168),
      health: 86,
    })
    expect(result.state.traps).toHaveLength(0)
    const triggers = result.events.filter(
      event => event.type === 'fight_trap_triggered',
    )
    expect(triggers.map(event => encode(event.cell))).toEqual([166, 168])
    const moved = result.events.find(event => event.type === 'fight_moved')
    expect(moved.path.map(encode)).toEqual([165, 166, 167, 168])
    expect(moved.mp_remaining).toBe(0)
  })

  test('a trap that KILLS mid-walk stops the mover on the trap cell (ends by death, not by trigger)', () => {
    const initial = state_of(golden.movement_cases[0])
    const mover = {
      ...find_entity(initial, 'p0'),
      cell: cell_of(164),
      health: 5,
      mp: 3,
    }
    const payload = normalized_effects([{ kind: 0, element: 2, value: 50 }]) // lethal
    const state = {
      ...initial,
      team0: [mover],
      turn_order: ['p0'],
      current_turn_idx: 0,
      traps: [
        {
          id: 1,
          source_id: 'm0',
          anchor: cell_of(166),
          cells: [cell_of(166)],
          payload,
        },
      ],
    }
    const result = reduce(
      state,
      { type: 'move', entity_id: 'p0', path: [165, 166, 167].map(cell_of) },
      { arena: arena_of(initial.board), spell_templates: new Map() },
    )
    const dead = find_entity(result.state, 'p0')
    expect(dead.health).toBe(0)
    expect(dead.cell).toEqual(cell_of(166)) // stopped AT the trap — never continued to 167
    const moved = result.events.find(event => event.type === 'fight_moved')
    expect(moved.path.map(encode)).toEqual([165, 166])
  })
})
