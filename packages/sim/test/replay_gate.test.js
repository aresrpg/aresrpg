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
  deck: is_player ? ['trap'] : [],
  hand: is_player ? [] : ['trap'],
  discard: [],
  spell_levels: { trap: 1 },
  ap_reserve: 0,
  ...overrides,
})

// ── Scenarios (live-stream symptom classes, sim-level) ─────────────────────────────────────

const scenarios = [
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
          deck: ['trap', 'shove'],
          spell_levels: { trap: 1, shove: 1 },
        }),
      ],
      team1: [
        make_entity('m0', { x: 7, y: 5 }, false, {
          health: 5,
          hand: [],
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
    // Invisibility across turns (v35 live symptom: "invis LOST after end-turn").
    // Self-cast veil (3 turns), then two full turn cycles — the golden pins the sim's true
    // apply/tick/expiry arc so any client divergence has an argue-proof reference timeline.
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
          deck: ['veil'],
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
    // TACKLE TOLL — a failed escape TAXES then walks whatever MP survives (ruling #239, github #239), never a
    // wall. Here the tax leaves 1 MP, so the 4-cell request truncates to a 1-cell PREFIX walk. The sim twin of
    // the Move engine's actions.move toll; tackle_tests.move asserts the identical fail→tax→partial-walk shape.
    meta: {
      id: 'tackle_toll_partial_walk',
      class: 'tackle',
      authored: '2026-07-21',
      source: 'authored',
      notes:
        'p0 (agi 0, mp 5) locked west by m0 (agi 30); requests 4 east, fails the escape, taxed to 1 MP, walks a 1-cell prefix to (6,5).',
    },
    arena: flat_arena_json(),
    templates_raw: trap_templates_raw,
    initial: {
      fight_id: 'capsule_tackle_toll_partial',
      arena_seed: 1,
      team0: [
        make_entity('p0', { x: 5, y: 5 }, true, {
          deck: [],
          hand: [],
          spell_levels: {},
          stats: { agility: 0, intelligence: 0, range: 0, strength: 0 },
        }),
      ],
      team1: [
        make_entity('m0', { x: 4, y: 5 }, false, {
          deck: [],
          hand: [],
          spell_levels: {},
          stats: { agility: 30, intelligence: 0, range: 0, strength: 0 },
        }),
      ],
    },
    commands: [
      { type: 'start' },
      {
        type: 'move',
        entity_id: 'p0',
        path: [
          { x: 6, y: 5 },
          { x: 7, y: 5 },
          { x: 8, y: 5 },
          { x: 9, y: 5 },
        ],
      },
      { type: 'end_turn', entity_id: 'p0' },
    ],
  },
  {
    // TACKLE TOLL — the tax can consume EVERYTHING: an overwhelming lock strips all 5 MP, so the toll walks 0
    // cells HONESTLY (the mover holds its cell). This is a legitimate 0-cell outcome, NOT the old hard pin — the
    // difference is that the survivor, not the rule, decided it. Move twin: the tax-eats-all case in tackle_tests.
    meta: {
      id: 'tackle_toll_tax_consumes_all_mp',
      class: 'tackle',
      authored: '2026-07-21',
      source: 'authored',
      notes:
        'p0 (agi 0, mp 5) locked west by m0 (agi 1000); requests 3 east, fails, the tax zeroes MP → walks 0, holds (5,5).',
    },
    arena: flat_arena_json(),
    templates_raw: trap_templates_raw,
    initial: {
      fight_id: 'capsule_tackle_toll_zero',
      arena_seed: 1,
      team0: [
        make_entity('p0', { x: 5, y: 5 }, true, {
          deck: [],
          hand: [],
          spell_levels: {},
          stats: { agility: 0, intelligence: 0, range: 0, strength: 0 },
        }),
      ],
      team1: [
        make_entity('m0', { x: 4, y: 5 }, false, {
          deck: [],
          hand: [],
          spell_levels: {},
          stats: { agility: 1000, intelligence: 0, range: 0, strength: 0 },
        }),
      ],
    },
    commands: [
      { type: 'start' },
      {
        type: 'move',
        entity_id: 'p0',
        path: [
          { x: 6, y: 5 },
          { x: 7, y: 5 },
          { x: 8, y: 5 },
        ],
      },
      { type: 'end_turn', entity_id: 'p0' },
    ],
  },
  {
    // TACKLE — a WON escape is unchanged: dodge ≥ 2·lock (agi 40 vs 0 → num == den) is a certain escape, so the
    // full 3-cell walk completes with pools untouched and no Tackled. The toll only rewrites the FAILED branch.
    meta: {
      id: 'tackle_escape_full_walk',
      class: 'tackle',
      authored: '2026-07-21',
      source: 'authored',
      notes:
        'p0 (agi 40, mp 5) locked west by m0 (agi 0) escapes for certain (num==den); walks the full 3 cells to (8,5), MP 2, no tax.',
    },
    arena: flat_arena_json(),
    templates_raw: trap_templates_raw,
    initial: {
      fight_id: 'capsule_tackle_escape',
      arena_seed: 1,
      team0: [
        make_entity('p0', { x: 5, y: 5 }, true, {
          deck: [],
          hand: [],
          spell_levels: {},
          stats: { agility: 40, intelligence: 0, range: 0, strength: 0 },
        }),
      ],
      team1: [
        make_entity('m0', { x: 4, y: 5 }, false, {
          deck: [],
          hand: [],
          spell_levels: {},
          stats: { agility: 0, intelligence: 0, range: 0, strength: 0 },
        }),
      ],
    },
    commands: [
      { type: 'start' },
      {
        type: 'move',
        entity_id: 'p0',
        path: [
          { x: 6, y: 5 },
          { x: 7, y: 5 },
          { x: 8, y: 5 },
        ],
      },
      { type: 'end_turn', entity_id: 'p0' },
    ],
  },
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

      const replay = replay_capsule(capsule)

      // 1. PHYSICS — the invariant sweep is clean at every transition.
      expect(replay.violations).toEqual([])

      // 2. PARITY — event stream and terminal state match the golden byte-for-byte.
      expect(jsonify(replay.events)).toEqual(capsule.expected.events)
      expect(jsonify(terminal_summary(replay.terminal))).toEqual(
        capsule.expected.terminal_summary,
      )
      expect(digest(replay.terminal)).toBe(capsule.expected.terminal_digest)

      // 3. DETERMINISM — an independent second replay produces the identical trace.
      expect(replay_capsule(capsule).trace_digest).toBe(replay.trace_digest)
    })
  }
})
