// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// FIGHT-REPLAY GATE — the deterministic capsule gate (see src/timeline.js for the format).
//
// Each scenario below is authored in code, golden-recorded ONCE into test/fixtures/replay/*.json
// (REGOLD=1 bun test test/replay_gate.test.js), and from then on every run must reproduce the
// committed capsule exactly: physics invariants clean · event stream byte-equal · terminal digest
// equal · two independent replays identical (determinism) · in-code scenario inputs equal the
// committed capsule inputs (no silent drift between source and golden). A red here is either a
// rules change (regold deliberately, with a citation in the commit) or a bug — never noise.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, test, expect } from 'bun:test'

import {
  replay_capsule,
  record_expectation,
  digest,
  terminal_summary,
} from '../src/timeline.js'

const FIXTURES_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  'fixtures',
  'replay',
)
const REGOLD = process.env.REGOLD === '1'

/** JSON round-trip so live values and parsed fixtures digest identically (drops undefined keys). */
const jsonify = value => JSON.parse(JSON.stringify(value))

/**
 * THE CROSS-TWIN TOOTH (#1052). Everything else in this gate is a sim SELF-RECORDING: regolding writes whatever
 * the sim does today, so a sim-vs-Move divergence cannot fail it by construction. A scenario may therefore also
 * carry `pinned_facts` — terminal readings TRANSCRIBED FROM THE MOVE SOURCE, each with the site it was read at.
 * They are asserted against the replay, never regolded, so a rules change that moves one of them has to be
 * re-derived from the chain by hand instead of silently absorbed. Same contract as `pinned_move_path`, general.
 */
const read_path = (root, path) =>
  path
    .split('.')
    .reduce(
      (node, key) =>
        node == null ? undefined : node[/^\d+$/.test(key) ? Number(key) : key],
      root,
    )

// ── Shared scenario atoms (mirrors fight_death.test.js conventions — copy > abstract) ──────────

const flat_arena_json = (width = 21) => ({
  width,
  height: width,
  cells: [...new Uint8Array(width * width)],
  spawns_a: [
    { x: 5, y: 5 },
    { x: 5, y: 6 },
  ],
  spawns_b: [{ x: 7, y: 5 }],
})

// The real yajin trap shape (packages/sdk/src/spells.json lineage), raw — normalized at replay.
const trap_templates_raw = {
  yajin: {
    trap: {
      name: 'Trap',
      description: 'a hidden trap',
      levels: [
        {
          cost: 4,
          range: [1, 4],
          critical_chance: 0,
          area: 1,
          area_type: 'square',
          casts_per_turn: 255,
          casts_per_target: 255,
          cooldown_turns: 0,
          modifiable_range: true,
          line_of_sight: false,
          linear: false,
          free_cell: true,
          base_effects: [
            {
              type: 'damage',
              min: 5,
              max: 9,
              target: 'trap',
              element: 'earth',
              chance: 100,
            },
          ],
          critical_effects: [],
        },
      ],
    },
  },
}

// Trap + a guaranteed push (real raw shape: `distance`, sdk spells.json lineage; chance 100 for a
// deterministic scenario — the corpus wants certain outcomes, content wants dice).
const push_trap_templates_raw = {
  yajin: {
    trap: trap_templates_raw.yajin.trap,
    shove: {
      name: 'Shove',
      description: 'push the target away',
      levels: [
        {
          cost: 3,
          range: [1, 4],
          critical_chance: 0,
          area: 0,
          area_type: 'cell',
          casts_per_turn: 255,
          casts_per_target: 255,
          cooldown_turns: 0,
          modifiable_range: true,
          line_of_sight: true,
          linear: false,
          free_cell: false,
          base_effects: [{ type: 'push', distance: 1, chance: 100 }],
          critical_effects: [],
        },
      ],
    },
  },
}

// A ranged bolt (band [3,5], LOS-required) — the #606 mob-AI parity vehicle: a mob whose target sits inside its
// min-range must STEP OUT to the band and fire. Raw seed shape (lowercase type/element/target) → normalized at replay.
const bolt_templates_raw = {
  yajin: {
    bolt: {
      name: 'Bolt',
      description: 'a ranged bolt',
      levels: [
        {
          cost: 3,
          range: [3, 5],
          critical_chance: 0,
          area: 0,
          area_type: 'cell',
          casts_per_turn: 255,
          casts_per_target: 255,
          cooldown_turns: 0,
          modifiable_range: false,
          line_of_sight: true,
          linear: false,
          free_cell: false,
          base_effects: [
            {
              type: 'damage',
              min: 5,
              max: 9,
              target: 'enemies',
              element: 'earth',
              chance: 100,
            },
          ],
          critical_effects: [],
        },
      ],
    },
  },
}

// #1406's five-spell mob-kit twin. The first four rows are deliberately AP-ineligible and the fifth is the
// only viable cast: the replay can only go green if the sim retains and evaluates the newly sanctioned slot.
const five_spell_mob_templates_raw = {
  yajin: Object.fromEntries(
    Array.from({ length: 5 }, (_, index) => {
      const is_fifth = index === 4
      const id = `boss_spell_${index + 1}`
      return [
        id,
        {
          name: is_fifth ? 'Fifth Spell' : `Sealed Spell ${index + 1}`,
          description: is_fifth
            ? 'the sanctioned fifth kit row'
            : 'AP-ineligible replay guard',
          levels: [
            {
              cost: is_fifth ? 3 : 11,
              range: [1, 4],
              critical_chance: 0,
              area: 0,
              area_type: 'cell',
              casts_per_turn: 255,
              casts_per_target: 255,
              cooldown_turns: 0,
              modifiable_range: false,
              line_of_sight: true,
              linear: false,
              free_cell: false,
              base_effects: [
                {
                  type: 'damage',
                  min: 5,
                  max: 5,
                  target: 'enemies',
                  element: 'earth',
                  chance: 100,
                },
              ],
              critical_effects: [],
            },
          ],
        },
      ]
    }),
  ),
}

// A life-steal drain BOTH sides carry (raw `steal` shape, sdk spells.json lineage; min===max so the damage is
// deterministic and the steal-back is exactly half of a known number).
const drain_templates_raw = {
  yajin: {
    drain: {
      name: 'Drain',
      description: 'steal life from the target',
      levels: [
        {
          cost: 3,
          range: [1, 4],
          critical_chance: 0,
          area: 0,
          area_type: 'cell',
          casts_per_turn: 255,
          casts_per_target: 255,
          cooldown_turns: 0,
          modifiable_range: false,
          line_of_sight: true,
          linear: false,
          free_cell: false,
          base_effects: [
            {
              type: 'steal',
              min: 20,
              max: 20,
              target: 'enemies',
              element: 'earth',
              chance: 100,
            },
          ],
          critical_effects: [],
        },
      ],
    },
  },
}

// Self-cast invisibility (engine-supported `invisibility`/`turns` shape; no shipped spell carries
// it yet — the v35 live-symptom class still deserves its sim-truth pin).
const veil_templates_raw = {
  yajin: {
    veil: {
      name: 'Veil',
      description: 'vanish for 3 turns',
      levels: [
        {
          cost: 2,
          range: [0, 1],
          critical_chance: 0,
          area: 0,
          area_type: 'cell',
          casts_per_turn: 255,
          casts_per_target: 255,
          cooldown_turns: 0,
          modifiable_range: false,
          line_of_sight: false,
          linear: false,
          free_cell: false,
          base_effects: [{ type: 'invisibility', turns: 3, chance: 100 }],
          critical_effects: [],
        },
      ],
    },
  },
}

// The "Cold Deck" shape — two same-element damage lines, each carrying its own authored proc `chance`. Pinned
// at the two DETERMINISTIC ends (100 and 0) so the capsule measures whether the chance is CONSULTED at all,
// without inheriting either twin's rng stream: exactly one of the two lines may ever land.
const chanced_strike_templates_raw = {
  yajin: {
    cold_deck: {
      name: 'Cold Deck',
      description: 'two chanced strikes',
      levels: [
        {
          cost: 3,
          range: [1, 4],
          critical_chance: 0,
          area: 0,
          area_type: 'cell',
          casts_per_turn: 255,
          casts_per_target: 255,
          cooldown_turns: 0,
          modifiable_range: false,
          line_of_sight: true,
          linear: false,
          free_cell: false,
          base_effects: [
            {
              type: 'damage',
              min: 20,
              max: 20,
              target: 'enemies',
              element: 'earth',
              chance: 100,
            },
            {
              type: 'damage',
              min: 20,
              max: 20,
              target: 'enemies',
              element: 'earth',
              chance: 0,
            },
          ],
          critical_effects: [],
        },
      ],
    },
  },
}

// A 2-turn glyph on an empty cell (#1540). Nobody ever stands on it, so its DURATION is the only thing the
// capsule measures — a glyph is never sprung by standing on it (it ticks and persists); it dies by expiry alone.
const glyph_templates_raw = {
  yajin: {
    glyph2: {
      name: 'Glyph',
      description: 'a persistent zone that lives two player turns',
      levels: [
        {
          cost: 2,
          range: [1, 8],
          critical_chance: 0,
          area: 0,
          area_type: 'cell',
          casts_per_turn: 255,
          casts_per_target: 255,
          cooldown_turns: 0,
          modifiable_range: false,
          // LOS off: a placement spell drops its zone on a cell, and an ALLY standing on the line must not be
          // what decides whether this capsule's duration pin runs (p0 sits between p1 and the target).
          line_of_sight: false,
          linear: false,
          free_cell: false,
          base_effects: [
            {
              type: 'glyph',
              min: 5,
              max: 5,
              element: 'fire',
              target: 'cell',
              chance: 100,
              turns: 2,
            },
          ],
          critical_effects: [],
        },
      ],
    },
  },
}

// A vitality BUFF on the caster and a vitality DEBUFF on an enemy (#1628). Stat ids 5/10 have no stat-block
// field on either twin, so these two lines move HP CAPACITY and nothing else; min===max keeps the roll fixed.
const vitality_templates_raw = {
  yajin: {
    fortify: {
      name: 'Fortify',
      description: '+60 vitality for two turns',
      levels: [
        {
          cost: 2,
          range: [0, 6],
          critical_chance: 0,
          area: 0,
          area_type: 'cell',
          casts_per_turn: 255,
          casts_per_target: 255,
          cooldown_turns: 0,
          modifiable_range: false,
          line_of_sight: true,
          linear: false,
          free_cell: false,
          base_effects: [
            {
              type: 'add',
              statistic: 'vitality',
              min: 60,
              max: 60,
              turns: 2,
              target: 'self',
              chance: 100,
            },
          ],
          critical_effects: [],
        },
      ],
    },
    wither: {
      name: 'Wither',
      description: '-30 vitality on an enemy for one turn',
      levels: [
        {
          cost: 2,
          range: [1, 6],
          critical_chance: 0,
          area: 0,
          area_type: 'cell',
          casts_per_turn: 255,
          casts_per_target: 255,
          cooldown_turns: 0,
          modifiable_range: false,
          line_of_sight: true,
          linear: false,
          free_cell: false,
          base_effects: [
            {
              type: 'remove',
              statistic: 'vitality',
              min: 30,
              max: 30,
              turns: 1,
              target: 'enemies',
              chance: 100,
            },
          ],
          critical_effects: [],
        },
      ],
    },
  },
}

const make_entity = (id, cell, is_player, overrides = {}) => ({
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
  template_id: 'yajin',
  level: 1,
  stats: { agility: 0, intelligence: 0, range: 0, strength: 0 },
  effects: [],
  spell_levels: { trap: 1 },
  ap_reserve: 0,
  ...overrides,
})

// ── Scenarios (live-stream symptom classes, sim-level) ─────────────────────────────────────

const scenarios = [
  {
    // #618 deterministic-twin discriminator. The direct (1,3)→(4,3) lane crosses living m1 at (3,3), while
    // upper and lower five-step detours are equal. Hand-tracing movement::walk: right reaches (2,3); right is then
    // occupied, so up wins before down in Move's left/right/up/down order; the remainder is right, right, down.
    // The command deliberately carries the other valid detour: the sim must treat its last cell as Move's
    // destination-only input and reconstruct the pinned upper route, never trust caller intermediates.
    meta: {
      id: 'occupied_cell_equal_detour',
      class: 'movement',
      authored: '2026-07-23',
      source: 'authored',
      notes:
        'Issue #618: m0 routes around live ally m1; equal upper/lower detours pin Move left/right/up/down tie-breaking.',
    },
    arena: {
      ...flat_arena_json(7),
      spawns_a: [{ x: 5, y: 3 }],
      spawns_b: [
        { x: 1, y: 3 },
        { x: 3, y: 3 },
      ],
    },
    templates_raw: {},
    initial: {
      fight_id: 'capsule_occupied_cell_equal_detour',
      arena_seed: 1,
      team0: [
        make_entity('p0', { x: 5, y: 3 }, true, {
          spell_levels: {},
        }),
      ],
      team1: [
        make_entity('m0', { x: 1, y: 3 }, false, {
          spell_levels: {},
        }),
        make_entity('m1', { x: 3, y: 3 }, false, {
          spell_levels: {},
        }),
      ],
    },
    commands: [
      { type: 'start' },
      {
        type: 'move',
        entity_id: 'm0',
        path: [
          { x: 2, y: 3 },
          { x: 2, y: 4 },
          { x: 3, y: 4 },
          { x: 4, y: 4 },
          { x: 4, y: 3 },
        ],
      },
    ],
    pinned_move_path: [
      { x: 2, y: 3 },
      { x: 2, y: 2 },
      { x: 3, y: 2 },
      { x: 4, y: 2 },
      { x: 4, y: 3 },
    ],
  },
  {
    // Continue-through-traps ruling LANDED (#320/#325): a covered trap fires the instant the mover ENTERS
    // its cell and the walk RESUMES — it no longer truncates the route (the earlier chain-by-design first-trap
    // truncation, DECISIONS 2026-07-20 00:31, is repealed here; the twin Move `movement::walk` matches, shipping
    // in this PR for the upgrade train). p0 places a trap on the first cell of its own path then walks THROUGH it:
    // the trap fires (owner-blind), p0 takes the hit, and finishes at the far cell.
    meta: {
      id: 'trap_path_resumes',
      class: 'trap',
      authored: '2026-07-22',
      source: 'authored',
      notes:
        'p0 places a trap on the first cell of its own 2-cell path then walks THROUGH it; the trap fires (owner entry) and p0 resumes to the far cell, surviving.',
    },
    arena: flat_arena_json(),
    templates_raw: trap_templates_raw,
    initial: {
      fight_id: 'capsule_trap_walk',
      arena_seed: 1,
      team0: [make_entity('p0', { x: 5, y: 5 }, true)],
      team1: [make_entity('m0', { x: 7, y: 5 }, false)],
    },
    commands: [
      { type: 'start' },
      {
        type: 'cast',
        entity_id: 'p0',
        spell_id: 'trap',
        target: { x: 6, y: 5 },
      },
      {
        type: 'move',
        entity_id: 'p0',
        path: [
          { x: 6, y: 5 },
          { x: 6, y: 6 },
        ],
      },
      { type: 'end_turn', entity_id: 'p0' },
    ],
  },
  {
    // Kill terminality: a 6hp caster dies on its own trap (fight_death.test.js class); the fight
    // concludes; every post-conclusion command must leave the corpse dead and the winner fixed
    // (dead_stays_dead + winner_terminal do the asserting at every step).
    meta: {
      id: 'lethal_trap_kill_terminal',
      class: 'death',
      authored: '2026-07-20',
      source: 'authored',
      notes:
        'p0 (6hp) dies on own trap; winner set; post-death cast/end_turn/ai_turn probes recorded.',
    },
    arena: flat_arena_json(),
    templates_raw: trap_templates_raw,
    initial: {
      fight_id: 'capsule_kill_terminal',
      arena_seed: 1,
      team0: [make_entity('p0', { x: 5, y: 5 }, true, { health: 6 })],
      team1: [make_entity('m0', { x: 7, y: 5 }, false)],
    },
    commands: [
      { type: 'start' },
      {
        type: 'cast',
        entity_id: 'p0',
        spell_id: 'trap',
        target: { x: 6, y: 5 },
      },
      { type: 'move', entity_id: 'p0', path: [{ x: 6, y: 5 }] },
      // post-conclusion probes — the reducer must hold the terminal state through all of them:
      {
        type: 'cast',
        entity_id: 'p0',
        spell_id: 'trap',
        target: { x: 6, y: 6 },
      },
      { type: 'end_turn', entity_id: 'p0' },
      { type: 'ai_turn', entity_id: 'm0' },
    ],
  },
  {
    // The yajin script, sim-level (P0 red-first class): trap placed behind the mob, mob
    // PUSHED onto it — displacement STOPS at the trap (DECISIONS 2026-07-20 00:17, d0c6d96f
    // threading), the trap fires, the 5hp mob dies (min damage 5 ≥ hp — guaranteed), and the kill
    // STICKS through a post-conclusion probe. dead_stays_dead + winner_terminal sweep every step.
    meta: {
      id: 'push_onto_trap_kill',
      class: 'displacement',
      authored: '2026-07-20',
      source: 'authored',
      notes:
        'trap at (8,5); m0 (5hp) at (7,5) shoved away from caster onto the trap; dies; kill sticks.',
    },
    arena: flat_arena_json(),
    templates_raw: push_trap_templates_raw,
    initial: {
      fight_id: 'capsule_push_trap_kill',
      arena_seed: 1,
      team0: [
        make_entity('p0', { x: 5, y: 5 }, true, {
          spell_levels: { trap: 1, shove: 1 },
        }),
      ],
      team1: [
        make_entity('m0', { x: 7, y: 5 }, false, {
          health: 5,
          spell_levels: {},
        }),
      ],
    },
    commands: [
      { type: 'start' },
      {
        type: 'cast',
        entity_id: 'p0',
        spell_id: 'trap',
        target: { x: 8, y: 5 },
      },
      {
        type: 'cast',
        entity_id: 'p0',
        spell_id: 'shove',
        target: { x: 7, y: 5 },
      },
      // post-conclusion probe — the kill must stick:
      { type: 'end_turn', entity_id: 'p0' },
    ],
  },
  {
    // #606 mob-AI band step + fire (the "moved near me, didn't attack" / "never touch me" class). A ranged [3,5]
    // mob with the player INSIDE its min-range (d2) must STEP OUT to a band cell and CAST — never walk into the
    // point-blank dead zone and whiff. The golden pins the sim's true move+cast+damage arc for this turn; the Move
    // twin (mob_ai_policy_tests::ranged_target_inside_min_range_steps_out_and_fires) produces the identical firing
    // cell, so the deterministic close-and-attack path is locked byte-for-byte on both sides.
    meta: {
      id: 'mob_steps_to_band_and_fires',
      class: 'mob_ai',
      authored: '2026-07-24',
      source: 'authored',
      notes:
        '#606: ranged [3,5] mob at d2 (inside min-range) steps out to a band cell and fires; twin of the Move policy proof.',
    },
    arena: flat_arena_json(),
    templates_raw: bolt_templates_raw,
    initial: {
      fight_id: 'capsule_mob_band_fire',
      arena_seed: 1,
      team0: [
        make_entity('p0', { x: 10, y: 10 }, true, {
          spell_levels: {},
        }),
      ],
      team1: [
        make_entity('m0', { x: 12, y: 10 }, false, {
          spell_levels: { bolt: 1 },
        }),
      ],
    },
    commands: [
      { type: 'start' },
      { type: 'end_turn', entity_id: 'p0' },
      { type: 'ai_turn', entity_id: 'm0' },
    ],
  },
  {
    // #1406 sim↔Move twin: MAX_SPELLS lifts from four to five for three sanctioned boss kits. Four deliberately
    // AP-ineligible rows precede the only viable spell, so the AI must preserve, inspect and cast slot five.
    meta: {
      id: 'five_spell_mob_casts_fifth_slot',
      class: 'mob_ai',
      authored: '2026-07-29',
      source: 'authored',
      notes:
        '#1406: a five-spell mob retains its whole kit and casts the only viable row at slot five; twin of both Move MAX_SPELLS guards.',
    },
    arena: flat_arena_json(),
    templates_raw: five_spell_mob_templates_raw,
    initial: {
      fight_id: 'capsule_five_spell_mob',
      arena_seed: 1,
      team0: [
        make_entity('p0', { x: 5, y: 5 }, true, {
          spell_levels: {},
        }),
      ],
      team1: [
        make_entity('m0', { x: 7, y: 5 }, false, {
          spell_levels: Object.fromEntries(
            Array.from({ length: 5 }, (_, index) => [
              `boss_spell_${index + 1}`,
              1,
            ]),
          ),
        }),
      ],
    },
    commands: [
      { type: 'start' },
      { type: 'end_turn', entity_id: 'p0' },
      { type: 'ai_turn', entity_id: 'm0' },
    ],
  },
  {
    // Invisibility across turns (v35 live symptom: "invis LOST after end-turn").
    // Self-cast veil (3 turns), then two full turn cycles — the golden pins the sim's true
    // apply/tick/expiry arc so any client divergence has an argue-proof reference timeline.
    // #1061 note: this capsule's arena puts the mob's spawn anchor ON the mob's own cell, so the blinded mob's
    // search walk is a legal zero-step hold and the recorded stream is unchanged. The MOVING case is the
    // `all_targets_invisible_mob_searches` capsule below.
    meta: {
      id: 'invisibility_across_turns',
      class: 'status',
      authored: '2026-07-20',
      source: 'authored',
      notes:
        'p0 self-casts 3-turn invisibility; two turn cycles recorded; AI target-skip included.',
    },
    arena: flat_arena_json(),
    templates_raw: veil_templates_raw,
    initial: {
      fight_id: 'capsule_invis_turns',
      arena_seed: 1,
      team0: [
        make_entity('p0', { x: 5, y: 5 }, true, {
          spell_levels: { veil: 1 },
        }),
      ],
      team1: [make_entity('m0', { x: 7, y: 5 }, false)],
    },
    commands: [
      { type: 'start' },
      {
        type: 'cast',
        entity_id: 'p0',
        spell_id: 'veil',
        target: { x: 5, y: 5 },
      },
      { type: 'end_turn', entity_id: 'p0' },
      { type: 'ai_turn', entity_id: 'm0' },
      { type: 'end_turn', entity_id: 'p0' },
      { type: 'ai_turn', entity_id: 'm0' },
    ],
  },
  {
    // #1061 twin parity — THE SEARCH WALK. Every opponent invisible: the mob's visible-target set is empty, and
    // instead of idling it advances toward its own side's spawn anchor (`spawns_b[0]`, here (2,5)), reusing the
    // ordinary monotonic reposition primitive. The walk reads BOARD GEOMETRY ONLY, so the sealed property holds
    // — a hidden player's cell never enters the AI input, and the mob's route is identical whether the hidden
    // p0 stands at (5,7) or anywhere else off the path.
    meta: {
      id: 'all_targets_invisible_mob_searches',
      class: 'twin',
      authored: '2026-07-29',
      source: 'authored',
      notes:
        'Issue #1061: p0 vanishes; the blinded m0 walks (7,5)→(3,5), the closest-by-cost cell adjacent to its spawn anchor (2,5) — never an empty pass.',
    },
    arena: {
      ...flat_arena_json(),
      spawns_a: [{ x: 5, y: 7 }],
      spawns_b: [{ x: 2, y: 5 }],
    },
    templates_raw: veil_templates_raw,
    initial: {
      fight_id: 'capsule_invis_search',
      arena_seed: 1,
      team0: [
        make_entity('p0', { x: 5, y: 7 }, true, {
          spell_levels: { veil: 1 },
        }),
      ],
      team1: [make_entity('m0', { x: 7, y: 5 }, false, { spell_levels: {} })],
    },
    commands: [
      { type: 'start' },
      {
        type: 'cast',
        entity_id: 'p0',
        spell_id: 'veil',
        target: { x: 5, y: 7 },
      },
      { type: 'end_turn', entity_id: 'p0' },
      { type: 'ai_turn', entity_id: 'm0' },
    ],
    // Hand-traced from the chain: `turns.move` feeds the empty-target arm into
    // `combat_grid::bfs_best_toward(cell, search_anchor, move_blocked, mp)`. Budget 5 from (7,5) toward the
    // anchor (2,5) on open ground: the anchor's OWN cell is never a candidate (stop-adjacent), so the best
    // reachable distance is 1, and among the d=1 cells {(3,5) cost 4, (2,4) cost 5, (2,6) cost 5} the cost
    // tie-break takes (3,5) — no cell-index tie-break needed, so the two grids' differing strides cannot
    // diverge here. The straight westward route is the 4-dir path both twins walk.
    pinned_move_path: [
      { x: 6, y: 5 },
      { x: 5, y: 5 },
      { x: 4, y: 5 },
      { x: 3, y: 5 },
    ],
    pinned_facts: [
      {
        cite: 'turns.move resolve_mob_turn — empty visible set ⇒ bfs_best_toward(cell, search_anchor, …, mp) lands the mob one cell short of the anchor at (3,5)',
        path: 'team1.0.cell.x',
        equals: 3,
      },
      {
        cite: 'turns.move resolve_mob_turn — the search walk is a straight monotonic advance; the row never changes',
        path: 'team1.0.cell.y',
        equals: 5,
      },
      {
        cite: 'turns.move living_player_seats_and_cells — hidden positions never enter the AI input, so p0 is untouched by the mob turn',
        path: 'team0.0.health',
        equals: 100,
      },
    ],
  },
  {
    // #755 twin parity — the SAME life-steal cast from both sides of the board, in one capsule. The chain's
    // `heal_caster` (cast.move:1385) gates the steal-back on `caster_side == PLAYER_SIDE`, so p0's drain heals
    // it for half the damage dealt while m0's identical drain heals the mob NOTHING. The golden pins both the
    // hp arc AND the caster-heal effect row the sim used to fold silently (the row is what lets any consumer —
    // the sim_chain encoder, the timeline, any projection — carry the caster's hp change at all).
    meta: {
      id: 'life_steal_player_only_heal',
      class: 'twin',
      authored: '2026-07-25',
      source: 'authored',
      notes:
        'Issue #755: p0 drains m0 (heals half, emits the caster-heal row); m0 drains p0 back and heals nothing — cast.move:1385 heals PLAYER_SIDE only.',
    },
    arena: flat_arena_json(),
    templates_raw: drain_templates_raw,
    initial: {
      fight_id: 'capsule_life_steal_twin',
      arena_seed: 1,
      team0: [
        make_entity('p0', { x: 5, y: 5 }, true, {
          health: 60,
          spell_levels: { drain: 1 },
        }),
      ],
      team1: [
        make_entity('m0', { x: 7, y: 5 }, false, {
          health: 60,
          spell_levels: { drain: 1 },
        }),
      ],
    },
    commands: [
      { type: 'start' },
      {
        type: 'cast',
        entity_id: 'p0',
        spell_id: 'drain',
        target: { x: 7, y: 5 },
      },
      { type: 'end_turn', entity_id: 'p0' },
      {
        type: 'cast',
        entity_id: 'm0',
        spell_id: 'drain',
        target: { x: 5, y: 5 },
      },
      { type: 'end_turn', entity_id: 'm0' },
    ],
  },
  {
    // #1628 twin parity — a vitality line is an HP-CAPACITY line. Stat ids 5 (Vitality) and 10 (MAX_HP) have no
    // field in either twin's stat block (`spell::add_stat` skips both; `effective_stats` excludes max_hp), so
    // the alter's stat fold is a no-op for them and the capacity move IS the effect. Before the fix BOTH twins
    // dropped it on the ordinary cast path: the row landed, the block re-derived identically, and a +60 vitality
    // buff changed nothing — while the EXPIRY inverse (`retro_effects::revert_expired_max_hp`) still ran.
    meta: {
      id: 'vitality_alter_moves_max_hp',
      class: 'twin',
      authored: '2026-07-29',
      source: 'authored',
      notes:
        'Issue #1628: p0 self-buffs +60 vitality (capacity only, no heal) and withers m0 for -30 (capacity down, current HP clamped to it).',
    },
    arena: flat_arena_json(),
    templates_raw: vitality_templates_raw,
    initial: {
      fight_id: 'capsule_vitality_capacity',
      arena_seed: 1,
      team0: [
        make_entity('p0', { x: 5, y: 5 }, true, {
          spell_levels: { fortify: 1, wither: 1 },
        }),
      ],
      team1: [make_entity('m0', { x: 7, y: 5 }, false, { spell_levels: {} })],
    },
    commands: [
      { type: 'start' },
      {
        type: 'cast',
        entity_id: 'p0',
        spell_id: 'fortify',
        target: { x: 5, y: 5 },
      },
      {
        type: 'cast',
        entity_id: 'p0',
        spell_id: 'wither',
        target: { x: 7, y: 5 },
      },
    ],
    pinned_facts: [
      {
        cite: 'retro_effects.move apply_max_hp_alter → participant::add_max_hp_bonus (capacity += 60)',
        path: 'team0.0.health_max',
        equals: 160,
      },
      {
        cite: 'participant.move:311 add_max_hp_bonus — capacity ONLY, current HP never rides the gain',
        path: 'team0.0.health',
        equals: 100,
      },
      {
        cite: 'retro_effects.move apply_max_hp_alter → participant::remove_max_hp_bonus (capacity -= 30)',
        path: 'team1.0.health_max',
        equals: 70,
      },
      {
        cite: 'mob.move:282 remove_max_hp_bonus — current HP is clamped down to the new capacity',
        path: 'team1.0.health',
        equals: 70,
      },
    ],
  },
  {
    // The Cold Deck row's twin parity — an authored `chance` is a die, and the chain has to roll it. Before the
    // fix `cast::apply_effect` walked its zone and applied every admitted line unconditionally: only RETURN_SPELL
    // and CRITICAL_FAILURE ever called `effect_proc`, so a 0%-chance line dealt FULL damage on chain while the
    // sim folded nothing for it. Pinned at the deterministic ends so the capsule can never be satisfied by a
    // lucky stream: the 100% line lands, the 0% line cannot, so m0 loses exactly 20.
    meta: {
      id: 'chanced_lines_roll_their_proc',
      class: 'twin',
      authored: '2026-07-29',
      source: 'authored',
      notes:
        'Cold Deck shape: a chance-100 and a chance-0 damage line in one cast; only the certain one may resolve.',
    },
    arena: flat_arena_json(),
    templates_raw: chanced_strike_templates_raw,
    initial: {
      fight_id: 'capsule_chanced_lines',
      arena_seed: 1,
      team0: [
        make_entity('p0', { x: 5, y: 5 }, true, {
          spell_levels: { cold_deck: 1 },
        }),
      ],
      team1: [make_entity('m0', { x: 7, y: 5 }, false, { spell_levels: {} })],
    },
    commands: [
      { type: 'start' },
      {
        type: 'cast',
        entity_id: 'p0',
        spell_id: 'cold_deck',
        target: { x: 7, y: 5 },
      },
    ],
    pinned_facts: [
      {
        cite: 'cast.move apply_effect — effect_proc gates every admitted target; chance 0 returns false, chance 100 returns true without drawing',
        path: 'team1.0.health',
        equals: 80,
      },
    ],
  },
  // ── #1540, the glyph clock: ONE cadence, invariant to where the caster sits in the order ──────────────
  //
  // The chain's anchor is declared at `cast.move` `tick_turn_end`: its `is_mob` arm only refreshes mob stats,
  // and the NON-mob arm calls `spell_board::decrement_glyphs` — the single home of glyph duration on chain
  // (`grep decrement_glyphs packages/move/engine/sources` → 1 hit). `turns.move:167` routes every player turn
  // end (pass, crank, active-abandon) through it; `turns.move:280,:321` end a mob turn on the `is_mob` arm.
  // So the clock counts PLAYER TURN-ENDS and nothing else — not global turn advances, and not the viewer's own
  // turns. The turn order here is [p0, m0, p1]; the two capsules differ ONLY in which player casts, i.e. whether
  // the caster acts before or after the mob, and both must read the SAME duration after the SAME number of
  // player turn-ends. An intermittent, fight-dependent expiry is exactly what a seat-relative clock produces.
  ...['p0', 'p1'].map(caster => ({
    meta: {
      id: `glyph_clock_player_turn_ends_caster_${caster}`,
      class: 'twin',
      authored: '2026-07-29',
      source: 'authored',
      notes: `Issue #1540: a 2-turn glyph cast by ${caster} (turn order p0, m0, p1) reads 1 after exactly ONE player turn-end — whichever side of the mob its caster sits on.`,
    },
    arena: flat_arena_json(),
    templates_raw: glyph_templates_raw,
    initial: {
      fight_id: `capsule_glyph_clock_${caster}`,
      arena_seed: 1,
      team0: [
        make_entity('p0', { x: 5, y: 5 }, true, {
          spell_levels: { glyph2: 1 },
        }),
        make_entity('p1', { x: 5, y: 6 }, true, {
          spell_levels: { glyph2: 1 },
        }),
      ],
      team1: [make_entity('m0', { x: 7, y: 5 }, false, { spell_levels: {} })],
    },
    commands: [
      { type: 'start' },
      // Walk to the caster's own turn, then place the glyph and spend exactly ONE player turn-end.
      ...(caster === 'p0'
        ? [
            {
              type: 'cast',
              entity_id: 'p0',
              spell_id: 'glyph2',
              target: { x: 3, y: 3 },
            },
            { type: 'end_turn', entity_id: 'p0' },
            // …and a MOB turn-end on top, which the chain's is_mob arm never charges the glyph for.
            { type: 'ai_turn', entity_id: 'm0' },
          ]
        : [
            { type: 'end_turn', entity_id: 'p0' },
            { type: 'ai_turn', entity_id: 'm0' },
            {
              type: 'cast',
              entity_id: 'p1',
              spell_id: 'glyph2',
              target: { x: 3, y: 3 },
            },
            { type: 'end_turn', entity_id: 'p1' },
          ]),
    ],
    pinned_facts: [
      {
        cite: 'cast.move tick_turn_end — the non-mob arm calls spell_board::decrement_glyphs; one player turn-end spends one turn of the budget',
        path: 'glyphs.0.turns_remaining',
        equals: 1,
      },
      {
        cite: 'cast.move tick_turn_end is_mob arm — a mob turn-end never reaches decrement_glyphs, so the glyph is still on the board',
        path: 'glyphs.length',
        equals: 1,
      },
    ],
  })),
]

// ── The gate ───────────────────────────────────────────────────────────────────────────────────

describe('fight-replay gate (capsule goldens)', () => {
  for (const scenario of scenarios) {
    test(scenario.meta.id, () => {
      const fixture_path = join(FIXTURES_DIR, `${scenario.meta.id}.json`)

      if (REGOLD) {
        mkdirSync(FIXTURES_DIR, { recursive: true })
        writeFileSync(
          fixture_path,
          `${JSON.stringify(jsonify(record_expectation(scenario)), null, 2)}\n`,
        )
      }

      expect(
        existsSync(fixture_path),
        `missing golden ${fixture_path} — author it with REGOLD=1`,
      ).toBe(true)
      const capsule = JSON.parse(readFileSync(fixture_path, 'utf8'))

      // 0. The committed capsule's inputs are the in-code scenario's inputs — no silent drift.
      expect(
        digest(
          jsonify({
            arena: scenario.arena,
            templates_raw: scenario.templates_raw,
            initial: scenario.initial,
            commands: scenario.commands,
          }),
        ),
      ).toBe(
        digest({
          arena: capsule.arena,
          templates_raw: capsule.templates_raw,
          initial: capsule.initial,
          commands: capsule.commands,
        }),
      )
      if (scenario.pinned_move_path)
        expect(capsule.pinned_move_path).toEqual(scenario.pinned_move_path)

      const replay = replay_capsule(capsule)

      // 1. PHYSICS — the invariant sweep is clean at every transition.
      expect(replay.violations).toEqual([])

      // 2. PARITY — event stream and terminal state match the golden byte-for-byte.
      expect(jsonify(replay.events)).toEqual(capsule.expected.events)
      expect(jsonify(terminal_summary(replay.terminal))).toEqual(
        capsule.expected.terminal_summary,
      )
      expect(digest(replay.terminal)).toBe(capsule.expected.terminal_digest)
      if (scenario.pinned_move_path) {
        const moved = replay.events.find(event => event.type === 'fight_moved')
        expect(moved?.path).toEqual(scenario.pinned_move_path)
      }

      // 2b. CROSS-TWIN — the hand-transcribed chain readings (never regolded). An ABSENT path reads `null`,
      // never a thrown parse error: "the fact this pin measures is not there any more" is itself the finding.
      for (const fact of scenario.pinned_facts ?? []) {
        const read = read_path(replay.terminal, fact.path)
        expect(
          read === undefined ? null : jsonify(read),
          `${fact.path} — ${fact.cite}`,
        ).toEqual(fact.equals)
      }

      // 3. DETERMINISM — an independent second replay produces the identical trace.
      expect(replay_capsule(capsule).trace_digest).toBe(replay.trace_digest)
    })
  }
})
