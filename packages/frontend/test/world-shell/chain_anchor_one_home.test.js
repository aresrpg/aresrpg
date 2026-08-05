// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// RED-FIRST (#1368 P2) — the chain-anchor bag had THREE normalizers with divergent guards.
//
// ONE `checkpoint_resolved` dispatch is normalized TWICE: the world core's checkpoint fold builds the atom's
// anchor, and the frontend edge's `normalize_chain_anchor` builds the persistence anchor. Their clock guards
// disagreed — the core admitted any truthy `Number(time_ms)` while the edge required a finite positive one —
// so a non-finite chain clock produced two different bags from one input and the two doors answered the
// #2231 agreement question in opposite directions: the boot arbiter YANKED the body to the checkpoint while
// the restore guard called the same anchor unjudgeable and KEPT the pose.
//
// The ruled behaviour is not in question here and is not touched: an anchor without a usable clock or budget
// is UNJUDGEABLE and keeps the local pose (checkpoint.js). This suite pins that BOTH doors reach it from one
// normalizer, so the answer cannot depend on which door asked.

import { beforeEach, describe, expect, test } from 'bun:test'
import { pose_agrees } from '@aresrpg/world/checkpoint'
import { boot_spawn } from '@aresrpg/world/spawns_zones'

import { publish_world_binding, reset_world_binding } from '../../src/world-shell/session_gate.js'
import {
  read_world_chain_anchor,
  spawns_input,
  spawns_store,
  _reset_position_persistence_for_test,
} from '../../src/world-shell/spawns_adapter.js'

const CHARACTER = '0xANCHOR_CHARACTER'
const WORLD = '0xANCHOR_WORLD'
const NOW = 1_800_000_000_000
const OFFSET = 1_000
// The live worlds' dial (11.5 blocks/s ×100 — move/scripts/apply_speed_budget.mjs).
const SPEED_BUDGET = 1150
const CHECKPOINT = { x: 20, z: 40 }
// Far past any honest budget: whether the body keeps this pose is decided purely by the anchor's judgeability.
const SESSION = { x: 4_000, z: 4_000 }
const WORLD_SPAWN = /** @type {[number, number, number]} */ ([0, 138, 0])

/** Bind the session, hand the core its frame, then dispatch ONE resolved checkpoint carrying `dials`. */
const dispatch_anchor = (dials) => {
  reset_world_binding()
  spawns_input({ type: 'world_bound', world_id: null })
  publish_world_binding(CHARACTER, WORLD)
  spawns_input({ type: 'world_doc', doc: { bounds_x: OFFSET * 2, bounds_z: OFFSET * 2, zone_size: 512 } })
  spawns_input({
    type: 'checkpoint_resolved',
    character_id: CHARACTER,
    world_id: WORLD,
    x: OFFSET + CHECKPOINT.x,
    z: OFFSET + CHECKPOINT.z,
    world_position: { ...CHECKPOINT, ...dials },
    source: 'read',
  })
}

const core_anchor = () => spawns_store.getState().checkpoint
const edge_anchor = () => read_world_chain_anchor(CHARACTER, WORLD)

beforeEach(() => {
  _reset_position_persistence_for_test()
  reset_world_binding()
  spawns_input({ type: 'world_bound', world_id: null })
})

describe('the chain-anchor bag has ONE normalizer (#1368 P2)', () => {
  test('a healthy anchor already agreed — the shared normalizer must not move it', () => {
    dispatch_anchor({ time_ms: NOW - 60_000, speed_budget: SPEED_BUDGET, pet_equipped: true })
    expect(core_anchor()).toEqual({
      x: CHECKPOINT.x,
      z: CHECKPOINT.z,
      time_ms: NOW - 60_000,
      speed_budget: SPEED_BUDGET,
      pet_equipped: true,
    })
    expect(edge_anchor()).toEqual(core_anchor())
  })

  test('a non-finite chain clock normalizes identically at both doors', () => {
    dispatch_anchor({ time_ms: Number.POSITIVE_INFINITY, speed_budget: SPEED_BUDGET })
    expect(core_anchor()).toEqual(edge_anchor())
    expect(core_anchor().time_ms).toBeNull()
  })

  test('a negative chain clock and a negative world dial normalize identically at both doors', () => {
    dispatch_anchor({ time_ms: -1, speed_budget: -1 })
    expect(core_anchor()).toEqual(edge_anchor())
    expect(core_anchor()).toEqual({
      x: CHECKPOINT.x,
      z: CHECKPOINT.z,
      time_ms: null,
      speed_budget: null,
      pet_equipped: false,
    })
  })

  // THE SHARP ONE: divergent guards made the boot arbiter and the restore guard disagree about the SAME
  // dispatch. `unjudgeable keeps the pose` is the ruled #2231 answer — both doors must give it.
  test('an unjudgeable clock keeps the pose at the boot arbiter AND at the restore guard', () => {
    dispatch_anchor({ time_ms: Number.POSITIVE_INFINITY, speed_budget: SPEED_BUDGET })
    const arbiter = boot_spawn(
      spawns_store.getState(),
      { session: SESSION, fallback: WORLD_SPAWN, y_seed: WORLD_SPAWN[1] },
      NOW
    )
    expect([arbiter.source, pose_agrees(SESSION, edge_anchor(), NOW)]).toEqual(['session', true])
  })
})
