// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// oracle/generator.js — the L1 rung of the test-oracle ladder (issue #930): a seeded generator of
// random command streams over the fight reducer, plus the fold that plays one back.
//
// L1 needs NO oracle and NO blessed output: it does not ask "is this the right damage number", it
// asks "does this fight obey the laws every correct fight obeys" (laws.js). So a stream is allowed
// — encouraged — to be full of nonsense: dead actors acting, casts at empty ground, moves into
// walls, spells not in hand. A refusal is data; a mutation is a bug.
//
// PURE + TOTAL: one u32 seed roots every draw (prng.js is the only randomness in @aresrpg/sim), so
// a stream is a VALUE — reproducible, shrinkable, and quotable verbatim in a bug report. Vendored
// on purpose: a property runner is a hundred lines here, and a dependency is a marriage.

import { rng_int, rng_seed } from '../../src/prng.js'
import { create_fight_state, reduce } from '../../src/reduce.js'
import { normalize_spell_templates } from '../../src/spell_templates.js'
import {
  create_recorder,
  observe_reduce_checked,
  open_recording,
} from '../../src/recorder.js'
import * as SE from '../../src/spell_effect.js'

import { check_laws } from './laws.js'

/** A small square arena — big enough for range, LoS and pathing to matter, small enough that a
 *  random cell draw lands on something interesting most of the time. */
export const ARENA_WIDTH = 9

/** Three pillars down the middle: they block LoS, force path detours, and stop pushes. */
const OBSTACLES = [
  { x: 4, y: 2 },
  { x: 4, y: 4 },
  { x: 4, y: 6 },
]

/** The arena the streams play on. Flat terrain except the pillars; two spawn cells per side. */
export const build_arena = () => ({
  width: ARENA_WIDTH,
  height: ARENA_WIDTH,
  radius: ARENA_WIDTH >> 1,
  center: { x: ARENA_WIDTH >> 1, y: ARENA_WIDTH >> 1 },
  cells: Uint8Array.from({ length: ARENA_WIDTH * ARENA_WIDTH }, (_unused, i) =>
    OBSTACLES.some(cell => cell.y * ARENA_WIDTH + cell.x === i) ? 1 : 0,
  ),
  spawns_a: [
    { x: 1, y: 3 },
    { x: 1, y: 5 },
  ],
  spawns_b: [
    { x: 7, y: 3 },
    { x: 7, y: 5 },
  ],
})

// ── The kit — authored SpellTemplate rows, normalized through the ONE production ingress ────────
// Authored shape, never the published wire blob: L1 tests LAWS, not corpus numbers (the corpus is
// L2's oracle, issue #930). One template per mechanic class so every arm of the reducer is reached.

const level = (
  effects,
  { ap_cost = 3, range_max = 8, free_cell = false } = {},
) => ({
  ap_cost,
  range_min: 0,
  range_max,
  modifiable_range: false,
  line_launch: false,
  line_of_sight: false,
  free_cell,
  casts_per_turn: 255,
  casts_per_target: 255,
  cooldown_turns: 0,
  crit_rate: 0,
  effects: effects.map(effect => ({ chance: 100, ...effect })),
  crit_effects: [],
})

const PLAYER_KIT = [
  {
    id: 's_bolt',
    levels: [
      level([
        {
          kind: SE.K_DAMAGE,
          element: 0,
          value: 14,
          target_filter: SE.TF_NOT_TEAM,
        },
      ]),
    ],
  },
  {
    id: 's_burst',
    levels: [
      level([
        {
          kind: SE.K_DAMAGE,
          element: 0,
          value: 8,
          target_filter: SE.TF_NOT_TEAM,
          area_shape: SE.SHAPE_CIRCLE,
          area_size: 1,
        },
      ]),
    ],
  },
  {
    id: 's_mend',
    levels: [
      level(
        [
          {
            kind: SE.K_HEAL,
            element: 0,
            value: 10,
            target_filter: SE.TF_NOT_ENEMY,
          },
        ],
        { ap_cost: 2, range_max: 4 },
      ),
    ],
  },
  {
    id: 's_rot',
    levels: [
      level([
        {
          kind: SE.K_APPLY_DOT,
          element: 0,
          value: 5,
          turns: 3,
          target_filter: SE.TF_NOT_TEAM,
        },
      ]),
    ],
  },
  {
    id: 's_shove',
    levels: [
      level([{ kind: SE.K_PUSH, value: 2, target_filter: SE.TF_NOT_TEAM }], {
        ap_cost: 2,
      }),
    ],
  },
]

const MOB_KIT = [
  {
    id: 'm_claw',
    levels: [
      level(
        [
          {
            kind: SE.K_DAMAGE,
            element: 0,
            value: 9,
            target_filter: SE.TF_NOT_TEAM,
          },
        ],
        { range_max: 6 },
      ),
    ],
  },
]

/** The whole castable corpus, RAW — what the recorder header stores and the normalizer ingests. */
export const TEMPLATES_RAW = [...PLAYER_KIT, ...MOB_KIT]

const PLAYER_DECK = PLAYER_KIT.map(spell => spell.id)
const MOB_DECK = MOB_KIT.map(spell => spell.id)

/** A spell id no fighter owns — the illegal-cast arm of every stream. */
const UNKNOWN_SPELL = 's_unknown'

/**
 * One fight entity in the sim's own shape. The deck is EXACTLY the hand size the opening deal
 * draws, so the whole kit sits in hand every turn and the stream's spell picks are meaningful.
 * @param {string} id
 * @param {{x:number,y:number}} cell
 * @param {boolean} is_player
 * @param {{ health:number, ap:number, mp:number, deck:string[] }} params
 */
export const fighter = (id, cell, is_player, { health, ap, mp, deck }) => ({
  id,
  name: id,
  cell,
  health,
  health_max: health,
  ap,
  ap_max: ap,
  mp,
  mp_max: mp,
  ap_used: 0,
  mp_used: 0,
  is_player,
  template_id: is_player ? 'senshi' : '0xmob_template',
  level: is_player ? 20 : 12,
  stats: {},
  effects: [],
  deck: [...deck],
  hand: is_player ? [] : [...deck],
  discard: [],
  spell_levels: Object.fromEntries(deck.map(spell => [spell, 1])),
  ap_reserve: 0,
})

/** The roster, on the arena's own spawn cells — 2v2 by default (small enough to decide, big enough
 *  for allies, AoE and friendly fire to exist). Shared by both packages' L1 runners. */
export const build_roster = (arena, size = 2) => ({
  team0: arena.spawns_a.slice(0, size).map((cell, i) =>
    fighter(`p${i}`, cell, true, {
      health: 60,
      ap: 6,
      mp: 3,
      deck: PLAYER_DECK,
    }),
  ),
  team1: arena.spawns_b.slice(0, size).map((cell, i) =>
    fighter(`m${i}`, cell, false, {
      health: 40,
      ap: 4,
      mp: 3,
      deck: MOB_DECK,
    }),
  ),
})

/** The fight id a stream records under — seed-derived, so a capsule names its own stream. */
export const fight_id_of = seed => `oracle:${(seed >>> 0).toString(16)}`

/** A fresh placement-phase fight plus its reducer context. Pure function of the seed. */
export const build_fight = seed => {
  const arena = build_arena()
  const { team0, team1 } = build_roster(arena)
  return {
    arena,
    ctx: {
      spell_templates: normalize_spell_templates(TEMPLATES_RAW),
      arena,
    },
    state: create_fight_state({
      fight_id: fight_id_of(seed),
      arena_seed: seed >>> 0,
      arena_radius: arena.radius,
      arena,
      team0,
      team1,
    }),
  }
}

/** The placement + ready prefix every stream opens with — the last ready force-starts combat. */
export const opening_commands = state => [
  ...[...state.team0, ...state.team1].map(entity => ({
    type: 'place',
    entity_id: entity.id,
    cell: entity.cell,
  })),
  ...state.team0.map(entity => ({ type: 'ready', entity_id: entity.id })),
]

// ── The draw ────────────────────────────────────────────────────────────────────────────────────

/**
 * Draw a tuple of bounded integers, threading the rng once. Pure.
 * @param {number} rng
 * @param {number[]} bounds
 * @returns {{ rng: number, values: number[] }}
 */
const draws = (rng, bounds) =>
  bounds.reduce(
    (acc, n) => {
      const next = rng_int(acc.rng, n)
      return { rng: next.state, values: [...acc.values, next.value] }
    },
    { rng, values: /** @type {number[]} */ ([]) },
  )

/** One 4-connected step from `from` toward `to`, on the axis with the larger gap. */
const step_toward = (from, to) =>
  Math.abs(to.x - from.x) >= Math.abs(to.y - from.y)
    ? { x: from.x + Math.sign(to.x - from.x), y: from.y }
    : { x: from.x, y: from.y + Math.sign(to.y - from.y) }

/**
 * Draw ONE command against the live state: usually the seat whose turn it is, one in six a random
 * fighter (frequently dead or off-turn). The kind bands mix legal and illegal deliberately —
 * placement after the start, casts at bare ground, moves into pillars, spells nobody holds.
 * @param {object} state
 * @param {number} rng
 * @param {number} [width]  the board's width — random cell draws span it (the fight package's
 *   L1 runner plays on the chain-derived board, which is wider than this arena)
 * @returns {{ rng: number, command: object }}
 */
export const next_command = (state, rng, width = ARENA_WIDTH) => {
  const all = [...state.team0, ...state.team1]
  const drawn = draws(rng, [6, 100, width, width, 8, 4])
  const [rogue, kind, cx, cy, spell_pick, foe_pick] = drawn.values
  const current = state.turn_order[state.current_turn_idx] ?? all[0].id
  const entity_id = rogue === 0 ? all[cx % all.length].id : current
  const actor = all.find(entity => entity.id === entity_id) ?? all[0]
  const mine = state.team0.some(entity => entity.id === entity_id)
  const foes = mine ? state.team1 : state.team0
  const foe = foes[foe_pick % foes.length]
  const pool = [...Object.keys(actor.spell_levels), UNKNOWN_SPELL]
  const spell_id = pool[spell_pick % pool.length]
  const cell = { x: cx, y: cy }
  const pass = mine
    ? { type: 'end_turn', entity_id }
    : { type: 'ai_turn', entity_id }
  const bands = [
    [5, { type: 'place', entity_id, cell }],
    [8, { type: 'ready', entity_id }],
    [38, { type: 'cast', entity_id, spell_id, target: foe.cell }],
    [48, { type: 'cast', entity_id, spell_id, target: cell }],
    [68, { type: 'move', entity_id, path: [cell] }],
    [
      73,
      { type: 'move', entity_id, path: [step_toward(actor.cell, foe.cell)] },
    ],
    [96, pass],
    [100, { type: 'abandon', entity_id }],
  ]
  return {
    rng: drawn.rng,
    command: bands.find(([edge]) => kind < edge)[1],
  }
}

/**
 * A whole stream: the placement prefix plus `length` drawn commands. The draw reads the live state
 * (a stream that never reaches the current actor never plays a fight), but the RESULT is a plain
 * command list — replayable, shrinkable, and independent of the generator that made it.
 * @param {{ seed:number, length?:number }} params
 * @returns {object[]}
 */
export const generate_stream = ({ seed, length = 150 }) => {
  const { state: initial, ctx } = build_fight(seed)
  const opening = opening_commands(initial)
  const started = opening.reduce(
    (state, command) => reduce(state, command, ctx).state,
    initial,
  )
  const body = Array.from({ length }).reduce(
    acc => {
      const drawn = next_command(acc.state, acc.rng)
      return {
        rng: drawn.rng,
        state: reduce(acc.state, drawn.command, ctx).state,
        commands: [...acc.commands, drawn.command],
      }
    },
    {
      rng: rng_seed(seed ^ 0x5f3759df),
      state: started,
      commands: /** @type {object[]} */ ([]),
    },
  )
  return [...opening, ...body.commands]
}

/**
 * Fold a stream through the reducer with the recorder tapping the door: every step carries its
 * pre/post state, its events, and the LAW hits for that transition (the existing physics tripwires
 * plus laws.js's additions — one merged violation list, one shape).
 * @param {{ seed:number, commands:object[] }} params
 */
export const fold_stream = ({ seed, commands }) => {
  const { state: initial, ctx, arena } = build_fight(seed)
  const fight_id = fight_id_of(seed)
  const opened = open_recording(create_recorder(commands.length + 8), {
    fight_id,
    arena: {
      width: arena.width,
      height: arena.height,
      cells: [...arena.cells],
      spawns_a: arena.spawns_a,
      spawns_b: arena.spawns_b,
    },
    templates_raw: TEMPLATES_RAW,
    initial: {
      fight_id,
      arena_seed: initial.arena_seed,
      team0: initial.team0,
      team1: initial.team1,
    },
    meta: { class: 'oracle-l1' },
  })
  return commands.reduce(
    (acc, command, index) => {
      const { state, events } = reduce(acc.state, command, ctx)
      const tapped = observe_reduce_checked(acc.recorder, {
        fight_id,
        command,
        pre_state: acc.state,
        post_state: state,
        events,
      })
      const hits = [
        ...tapped.violations,
        ...check_laws(acc.state, state, command, events),
      ].map(hit => ({ ...hit, index }))
      return {
        state,
        recorder: tapped.rec,
        violations: [...acc.violations, ...hits],
        events: [...acc.events, ...events],
      }
    },
    {
      state: initial,
      recorder: opened,
      violations: /** @type {object[]} */ ([]),
      events: /** @type {object[]} */ ([]),
    },
  )
}
