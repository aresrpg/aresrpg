import { describe, expect, test } from 'bun:test'
import { create_fight_state, find_path_4dir, normalize_spell_templates, reduce } from '@aresrpg/sim'

import {
  CAST_BEAT_MS,
  DAMAGE_BEAT_MS,
  DEATH_BEAT_MS,
  DISPLACEMENT_CELL_MS,
  TRAP_BEAT_MS,
  fight_cast_beat_effects,
  produce_predicted_render_events,
  produce_receipt_render_turns,
} from './fight_render_events.js'

const arena = {
  width: 20,
  height: 19,
  radius: 9,
  center: { x: 10, y: 9 },
  cells: new Uint8Array(20 * 19),
  spawns_a: [],
  spawns_b: [],
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
    trap: {
      name: 'Trap',
      levels: [
        level({
          free_cell: true,
          base_effects: [
            {
              type: 'damage',
              min: 7,
              max: 7,
              target: 'trap',
              element: 'earth',
              chance: 100,
            },
          ],
        }),
      ],
    },
    push: {
      name: 'Push',
      levels: [
        level({
          range: [1, 1],
          base_effects: [{ type: 'push', distance: 3, target: 'enemies', chance: 100 }],
        }),
      ],
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
  deck: is_player ? ['trap', 'push'] : [],
  hand: is_player ? [] : ['trap', 'push'],
  discard: [],
  spell_levels: { trap: 1, push: 1 },
  ap_reserve: 0,
  ...overrides,
})

const started_fight = () => {
  const ctx = { arena, spell_templates }
  const initial = create_fight_state({
    fight_id: 'fight-1',
    arena_seed: 1,
    arena_radius: arena.radius,
    arena,
    team0: [fighter('p0', { x: 4, y: 8 }, true), fighter('p1', { x: 2, y: 2 }, true)],
    team1: [fighter('m0', { x: 5, y: 8 }, false, { health: 5 }), fighter('m1', { x: 10, y: 8 }, false)],
  })
  return { state: reduce(initial, { type: 'start' }, ctx).state, ctx }
}

const timing_shape = (events) => events.map(({ kind, at, duration }) => ({ kind, at, duration }))
const encoded = (x, y) => y * 20 + x

describe('predicted fight render events', () => {
  test('trap behind mob + lethal push expands raw sim effects into cast → slide → trap → damage → death', () => {
    const { state, ctx } = started_fight()
    const placed = produce_predicted_render_events(
      state,
      { type: 'cast', entity_id: 'p0', spell_id: 'trap', target: { x: 7, y: 8 } },
      ctx
    )

    expect(placed.events.map((event) => event.kind)).toEqual(['trap_place', 'cast'])
    expect(placed.events[0]).toMatchObject({
      at: 0,
      duration: 0,
      payload: { entity_id: 'p0', cell: { x: 7, y: 8 } },
    })
    expect(placed.state.traps).toHaveLength(1)

    const pushed = produce_predicted_render_events(
      placed.state,
      { type: 'cast', entity_id: 'p0', spell_id: 'push', target: { x: 5, y: 8 } },
      ctx
    )

    // The frozen sim reports trap damage before its final cell. The producer must not leak that storage order into
    // presentation: the mob visibly slides onto the trap before the boom and its lethal number.
    expect(
      pushed.sim_events
        .find((event) => event.type === 'fight_cast')
        .effects.map((effect) => (effect.damage !== undefined ? 'damage' : 'cell'))
    ).toEqual(['damage', 'cell'])
    expect(timing_shape(pushed.events)).toEqual([
      { kind: 'cast', at: 0, duration: CAST_BEAT_MS },
      { kind: 'displacement', at: CAST_BEAT_MS, duration: 2 * DISPLACEMENT_CELL_MS },
      {
        kind: 'trap_trigger',
        at: CAST_BEAT_MS + 2 * DISPLACEMENT_CELL_MS,
        duration: TRAP_BEAT_MS,
      },
      {
        kind: 'damage',
        at: CAST_BEAT_MS + 2 * DISPLACEMENT_CELL_MS + TRAP_BEAT_MS,
        duration: DAMAGE_BEAT_MS,
      },
      {
        kind: 'death',
        at: CAST_BEAT_MS + 2 * DISPLACEMENT_CELL_MS + TRAP_BEAT_MS + DAMAGE_BEAT_MS,
        duration: DEATH_BEAT_MS,
      },
    ])
    expect(pushed.events[1].payload).toMatchObject({
      target_id: 'm0',
      from: { x: 5, y: 8 },
      to: { x: 7, y: 8 },
      path: [
        { x: 6, y: 8 },
        { x: 7, y: 8 },
      ],
    })
    expect(pushed.events[2].payload).toMatchObject({ target_id: 'm0', cell: { x: 7, y: 8 } })
    expect(pushed.events[3].payload).toMatchObject({ target_id: 'm0', damage: 5, new_health: 0, killed: true })
    expect(fight_cast_beat_effects(pushed.events[0].payload.source_event)).toEqual([])
    expect(pushed.events.every((event) => event.source_turn === 'p0:1')).toBe(true)
    expect(pushed.state.team1[0]).toMatchObject({ health: 0, cell: { x: 7, y: 8 } })
    expect(pushed.state.traps).toEqual([])
  })
})

describe('receipt fight render events', () => {
  // RED-FIRST ingestion assert: move_path is a resolver-or-null. A
  // non-null non-function — a producer handing a raw PATH ARRAY — is the exact v1.12.28 P0 (`move_path?.(…)` on an
  // array throws and takes the whole fight render down). The boundary guard (fight_render_events.js:525) must throw
  // LOUD in dev/test so that class can never silently re-ship; in prod it degrades to path_between.
  test('move_path ingestion assert: a raw-array producer throws at the boundary; a resolver renders clean', () => {
    const raw_events = [
      {
        type: '0xENGINE::fight_events::MobMoved',
        parsedJson: { fight: 'fight-1', idx: '1', to_cell: String(encoded(9, 8)) },
      },
    ]
    const resolve_fighter_id = ({ is_mob, idx, character }) => character ?? `${is_mob ? 'm' : 'p'}${idx}`
    const opts = { fight_id: 'fight-1', resolve_fighter_id, fighter_cells: new Map([['m1', { x: 10, y: 8 }]]) }
    // RED shape: the v1.12.28 crash — a raw path array where a resolver is required.
    expect(() => produce_receipt_render_turns(raw_events, { ...opts, move_path: [{ x: 10, y: 8 }] })).toThrow(
      /move_path must be a resolver function or null, got Array/
    )
    // GREEN: a real resolver renders with no throw (the supplied path flows to the move beat).
    expect(() =>
      produce_receipt_render_turns(raw_events, {
        ...opts,
        move_path: () => [
          { x: 10, y: 8 },
          { x: 9, y: 8 },
        ],
      })
    ).not.toThrow()
  })

  test('real effects-before-Cast order normalizes into the same beats and groups the following mob turn', () => {
    const raw_events = [
      {
        type: '0xENGINE::fight_events::Displaced',
        parsedJson: {
          fight: 'fight-1',
          target_is_mob: true,
          target_idx: '0',
          kind: '12',
          from_cell: String(encoded(5, 8)),
          to_cell: String(encoded(7, 8)),
          requested: '3',
          blocked: '0',
        },
      },
      {
        type: '0xENGINE::fight_events::Hit',
        parsedJson: {
          fight: 'fight-1',
          victim_is_mob: true,
          victim_idx: '0',
          amount: '5',
          remaining_hp: '0',
        },
      },
      {
        type: '0xENGINE::fight_events::Cast',
        parsedJson: {
          fight: 'fight-1',
          caster_is_mob: false,
          caster_idx: '0',
          target_cell: String(encoded(5, 8)),
        },
      },
      {
        type: '0xENGINE::fight_events::MobMoved',
        parsedJson: { fight: 'fight-1', idx: '1', to_cell: String(encoded(9, 8)) },
      },
      {
        type: '0xENGINE::fight_events::Hit',
        parsedJson: {
          fight: 'fight-1',
          victim_is_mob: false,
          victim_idx: '0',
          amount: '10',
          remaining_hp: '90',
        },
      },
      {
        type: '0xENGINE::fight_events::Cast',
        parsedJson: {
          fight: 'fight-1',
          caster_is_mob: true,
          caster_idx: '1',
          target_cell: String(encoded(4, 8)),
        },
      },
    ]
    const resolve_fighter_id = ({ is_mob, idx, character }) => character ?? `${is_mob ? 'm' : 'p'}${idx}`
    const receipt = produce_receipt_render_turns(raw_events, {
      fight_id: 'fight-1',
      trap_cells: new Set([encoded(7, 8)]),
      resolve_fighter_id,
      fighter_cells: new Map([['m1', { x: 10, y: 8 }]]),
    })

    expect(receipt.decoded_events.map((event) => event.kind)).toEqual([
      'Displaced',
      'Hit',
      'Cast',
      'MobMoved',
      'Hit',
      'Cast',
    ])
    expect(receipt.turns.map(({ source_id, source_turn }) => ({ source_id, source_turn }))).toEqual([
      { source_id: 'p0', source_turn: 'p0:0' },
      { source_id: 'm1', source_turn: 'm1:0' },
    ])
    expect(receipt.turns[0].events.map((event) => event.kind)).toEqual([
      'cast',
      'displacement',
      'trap_trigger',
      'damage',
      'death',
    ])
    expect(timing_shape(receipt.turns[0].events)).toEqual([
      { kind: 'cast', at: 0, duration: CAST_BEAT_MS },
      { kind: 'displacement', at: CAST_BEAT_MS, duration: 2 * DISPLACEMENT_CELL_MS },
      {
        kind: 'trap_trigger',
        at: CAST_BEAT_MS + 2 * DISPLACEMENT_CELL_MS,
        duration: TRAP_BEAT_MS,
      },
      {
        kind: 'damage',
        at: CAST_BEAT_MS + 2 * DISPLACEMENT_CELL_MS + TRAP_BEAT_MS,
        duration: DAMAGE_BEAT_MS,
      },
      {
        kind: 'death',
        at: CAST_BEAT_MS + 2 * DISPLACEMENT_CELL_MS + TRAP_BEAT_MS + DAMAGE_BEAT_MS,
        duration: DEATH_BEAT_MS,
      },
    ])
    expect(receipt.turns[1].events.map((event) => event.kind)).toEqual(['move', 'arrival', 'cast', 'damage'])
    expect(receipt.turns[1].events[0].at).toBe(0)
    expect(receipt.events.every((event) => typeof event.at === 'number' && typeof event.duration === 'number')).toBe(
      true
    )
  })
})

// LIVE BUG: a fight-board mob walked THROUGH an obstacle. The chain's MobMoved/Moved
// event carries ONLY the landed cell (fight_events.move: `to_cell`, no path) — the sim's own pathfinder is
// proven clean (sim/test/pathfind.test.js "detours around an obstacle", still green). The gap is HERE: lacking
// the real walked route, receipt playback reconstructed one with `path_between` — a straight x-then-y cardinal
// line with ZERO obstacle awareness — which cuts straight through a blocker the real shortest path (sim
// find_path_4dir + Move movement.move, both BFS-shortest over the SAME obstacles/holes) legally detoured
// around. Discriminator: (this suite) the RENDERED path must never cross a blocker; sim/pathfind.test.js
// already proves the SIM path never does — so a red here (pre-fix) isolates the bug to presentation.
describe('receipt move path — obstacle-aware reconstruction (mob-crossed-obstacle bug)', () => {
  const resolve_fighter_id = ({ is_mob, idx, character }) => character ?? `${is_mob ? 'm' : 'p'}${idx}`
  const mob_moved_to = (x, y) => [
    {
      type: '0xENGINE::fight_events::MobMoved',
      parsedJson: { fight: 'fight-1', idx: '1', to_cell: String(encoded(x, y)) },
    },
  ]
  const move_path_of = (receipt) => receipt.turns[0].events.find((event) => event.kind === 'move').payload.path

  test('a straight line would cross the obstacle at (1,0); the rendered walk must not', () => {
    const receipt = produce_receipt_render_turns(mob_moved_to(2, 0), {
      fight_id: 'fight-1',
      resolve_fighter_id,
      fighter_cells: new Map([['m1', { x: 0, y: 0 }]]),
      obstacles: [encoded(1, 0)],
      board_width: 5,
      board_height: 3,
    })
    const path = move_path_of(receipt)

    // THE DISCRIMINATOR: never render a step onto the obstacle cell.
    expect(path.some((cell) => cell.x === 1 && cell.y === 0)).toBe(false)
    // Still lands on the chain-confirmed destination.
    expect(path.at(-1)).toEqual({ x: 2, y: 0 })
    // A real connected walk, not a teleport-in-disguise: every step is 4-dir adjacent to the last.
    const cells = [{ x: 0, y: 0 }, ...path]
    for (let i = 1; i < cells.length; i++) {
      const dx = Math.abs(cells[i].x - cells[i - 1].x)
      const dy = Math.abs(cells[i].y - cells[i - 1].y)
      expect(dx + dy).toBe(1)
    }
  })

  test("twin-consistent: the rendered walk IS the sim's own find_path_4dir answer over the same board", () => {
    const receipt = produce_receipt_render_turns(mob_moved_to(2, 0), {
      fight_id: 'fight-1',
      resolve_fighter_id,
      fighter_cells: new Map([['m1', { x: 0, y: 0 }]]),
      obstacles: [encoded(1, 0)],
      board_width: 5,
      board_height: 3,
    })
    const rendered_path = move_path_of(receipt)

    const is_walkable = (cell) =>
      cell.x >= 0 && cell.x < 5 && cell.y >= 0 && cell.y < 3 && !(cell.x === 1 && cell.y === 0)
    const sim_path = find_path_4dir({ x: 0, y: 0 }, { x: 2, y: 0 }, 400, is_walkable)
    expect(rendered_path).toEqual(sim_path.slice(1)) // origin-exclusive, matching path_between's own contract
  })

  test('no board facts supplied: falls back to the prior straight-line reconstruction (zero regression)', () => {
    const receipt = produce_receipt_render_turns(mob_moved_to(2, 0), {
      fight_id: 'fight-1',
      resolve_fighter_id,
      fighter_cells: new Map([['m1', { x: 0, y: 0 }]]),
      // no obstacles/board_width/board_height — legacy/synthetic ctx, must render exactly as before
    })
    expect(move_path_of(receipt)).toEqual([
      { x: 1, y: 0 },
      { x: 2, y: 0 },
    ])
  })
})
