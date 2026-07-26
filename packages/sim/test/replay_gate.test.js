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

      // 3. DETERMINISM — an independent second replay produces the identical trace.
      expect(replay_capsule(capsule).trace_digest).toBe(replay.trace_digest)
    })
  }
})
