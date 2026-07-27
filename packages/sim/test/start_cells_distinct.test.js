// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// THE FIGHT-START OCCUPANCY TOOTH (#1218) — living fighters hold PAIRWISE DISTINCT cells at placement.
//
// The physics set already owns this law (`occupancy_exclusive`, timeline.js) but only ever ran it over a
// TRANSITION (prev → next), so the one state nobody ever swept was the INITIAL one: a fight handed a duplicate
// start cell replayed clean until something happened to move somebody. That is exactly the reported shape —
// a fight that BEGINS with two mobs on one cell — so the gap was in the sweep's coverage, not in the law.
//
// The fix makes the special case fall out of the general one: `replay_capsule` sweeps the whole invariant set
// over the initial state as a SELF-transition (prev === next, command `{type:'start'}`) before folding a single
// command. No new invariant, no second definition of "distinct cells" — one law, one home, now covering step
// zero.
//
// Red-first, twice over: both duplicate capsules below carry ZERO commands, so on the pre-fix build the fold
// never ran a check at all and `violations` came back empty. They fail for the reported reason (a duplicate
// start cell) and for no other.

import { describe, test, expect } from 'bun:test'

import { replay_capsule } from '../src/timeline.js'

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
  spell_levels: {},
  ap_reserve: 0,
  ...overrides,
})

/** A zero-command capsule: the placement snapshot and nothing else, so the ONLY thing under test is the start. */
const placement_capsule = (fight_id, team0, team1) => ({
  name: fight_id,
  arena: flat_arena_json(),
  templates_raw: {},
  initial: { fight_id, arena_seed: 1, team0, team1 },
  commands: [],
})

const occupancy_violations = capsule =>
  replay_capsule(capsule).violations.filter(line =>
    line.startsWith('[occupancy_exclusive]'),
  )

describe('fight start — living fighters hold pairwise-distinct cells', () => {
  test('two mobs seated on ONE cell is a violation at the start, before any command', () => {
    // The chain-side shape this reproduces: `fight.move` seats each group member through
    // `mob_ai::seeded_spawn_cell`, whose exclusion set is obstacles ∪ holes ∪ start cells and NEVER the cells
    // its siblings already took — so two members can draw the same open cell (mob_placement.js's header).
    const hits = occupancy_violations(
      placement_capsule(
        'capsule_start_stacked_mobs',
        [make_entity('p0', { x: 5, y: 5 }, true)],
        [
          make_entity('m0', { x: 9, y: 9 }, false),
          make_entity('m1', { x: 9, y: 9 }, false),
        ],
      ),
    )
    expect(hits).toHaveLength(1)
    expect(hits[0]).toContain('start')
    expect(hits[0]).toContain('9,9')
    expect(hits[0]).toContain('m0')
    expect(hits[0]).toContain('m1')
  })

  test('a player seated on a mob’s cell is the same violation — the law is side-blind', () => {
    const hits = occupancy_violations(
      placement_capsule(
        'capsule_start_stacked_across_teams',
        [make_entity('p0', { x: 4, y: 2 }, true)],
        [make_entity('m0', { x: 4, y: 2 }, false)],
      ),
    )
    expect(hits).toHaveLength(1)
    expect(hits[0]).toContain('4,2')
  })

  test('a CORPSE may share a cell — only LIVING fighters are pairwise distinct (the #1214 ruling)', () => {
    // Mid-fight corpse stacking is legal and proven legal; a tooth that failed on it would be a tooth nobody
    // could keep. The dead mob sits exactly where the living one stands and the start still sweeps clean.
    expect(
      occupancy_violations(
        placement_capsule(
          'capsule_start_corpse_stack',
          [make_entity('p0', { x: 5, y: 5 }, true)],
          [
            make_entity('m0', { x: 9, y: 9 }, false),
            make_entity('m1', { x: 9, y: 9 }, false, { health: 0 }),
          ],
        ),
      ),
    ).toEqual([])
  })

  test('a legally-placed roster sweeps clean', () => {
    expect(
      replay_capsule(
        placement_capsule(
          'capsule_start_distinct',
          [make_entity('p0', { x: 5, y: 5 }, true)],
          [
            make_entity('m0', { x: 9, y: 9 }, false),
            make_entity('m1', { x: 9, y: 10 }, false),
            make_entity('m2', { x: 10, y: 9 }, false),
          ],
        ),
      ).violations,
    ).toEqual([])
  })
})
