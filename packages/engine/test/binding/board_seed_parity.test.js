// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #1680 — THE BOARD-SEED FOLD HAS ONE HOME, AND THE ONE SANCTIONED COPY IS HELD TO IT LIVE.
//
// `board_seed_from_anchor` folds (world_seed, anchor_x, anchor_z) into the u32 board seed every fight board is
// generated from. One digit of drift between two implementations silently desyncs every generated board from
// the chain — the client would render a board the chain never produced, and nothing would throw.
//
// The fold's home is `@aresrpg/sim/board_gen` (the fixture-pinned Move twin). The frontend's second copy was
// deleted in #1680; the engine keeps a vendored one because it ships NO @aresrpg/sim dependency by design
// (packages/engine/src/binding/prng.js: "a dependency is a marriage; 40 vendored lines beat coupling the render
// engine to the combat sim"). A vendored twin is only safe with a MECHANICAL tooth, so this test imports both
// and sweeps them against each other. @aresrpg/sim is a devDependency exactly for this: the coupling is
// test-time, the shipped engine graph is unchanged.
//
// The other half of the class gate is static: scripts/arch/sim_protocol_constants.yml's
// `sim-protocol-board-seed-fold` rule reds any THIRD declaration of the fold or its anchor primes in a consumer
// package (`bun run lint`). This file is the dynamic half — it reds a copy that drifts in VALUE.

import { test, expect, describe } from 'bun:test'
import { board_seed_from_anchor as sim_fold } from '@aresrpg/sim/board_gen'

import { board_seed_from_anchor as engine_fold } from '../../src/binding/board_anchor.js'

// The sweep: 4 world seeds × 256 anchors = 1024, plus the edges that actually break a fold — anchors near u32
// max (anchor·PRIME overflows 2^53 before the mask, the reason the fold is BigInt), negative anchors (reduced
// mod 2^32 by the mask, matching the chain's u32 params) and the zero/max world seeds.
const WORLD_SEEDS = [0, 777, 3735928559, 0xffffffff]
const SWEEP = WORLD_SEEDS.flatMap((ws) =>
  Array.from({ length: 256 }, (_, i) => [ws, ((i * 613) % 4000000000) - 1000, ((i * 379) % 3000000000) - 1000])
)
const EDGES = [
  [0, 0, 0],
  [0xffffffff, 0xffffffff, 0xffffffff],
  [12345, 4000000000, 3000000000], // the CROSS_TWIN vector proven bit-identical to Move
  [1, -1, -1], // negative anchors: two's-complement reduction through the BigInt mask
  [1, -2147483648, 2147483647],
  [Number.MAX_SAFE_INTEGER, 999999999, 1],
]
const ANCHORS = [...SWEEP, ...EDGES]

describe('#1680 — engine binding/board_anchor fold ≡ @aresrpg/sim/board_gen fold', () => {
  test(`identical output for ${ANCHORS.length} anchors (the vendored twin has not drifted)`, () => {
    expect(ANCHORS.length).toBeGreaterThanOrEqual(1000)
    const drifted = ANCHORS.filter(([ws, x, z]) => engine_fold(ws, x, z) !== sim_fold(ws, x, z)).map(([ws, x, z]) => ({
      world_seed: ws,
      anchor_x: x,
      anchor_z: z,
      engine: engine_fold(ws, x, z),
      sim: sim_fold(ws, x, z),
    }))
    expect(drifted).toEqual([])
  })

  test('the sweep is a real instrument — a one-digit drift is DETECTED, not passed over', () => {
    // POSITIVE CONTROL. A green parity sweep proves nothing unless it can fail: this re-runs the exact
    // comparison against a fold whose PRIME_X differs in ONE digit (0x85ebca77 → 0x85ebca78) and asserts the
    // sweep catches it. Without this, a comparison accidentally reduced to `x === x` would sit green forever.
    const drifted_fold = (/** @type {number} */ ws, /** @type {number} */ x, /** @type {number} */ z) => {
      const M = 0xffffffffn
      return Number(((BigInt(ws) & M) ^ ((BigInt(x) * 0x85ebca78n) & M) ^ ((BigInt(z) * 0xc2b2ae3dn) & M)) & M)
    }
    const caught = ANCHORS.filter(([ws, x, z]) => drifted_fold(ws, x, z) !== sim_fold(ws, x, z))
    expect(caught.length).toBeGreaterThan(0)
  })

  test('the fold is a uint32 over the whole sweep, and the anchor actually moves it', () => {
    for (const [ws, x, z] of ANCHORS) {
      const seed = sim_fold(ws, x, z)
      expect(Number.isInteger(seed) && seed >= 0 && seed <= 0xffffffff).toBe(true)
    }
    // a 1-block anchor shift must change the board — the property the whole "board IS the world" seam rests on
    expect(engine_fold(0x1234abcd, 512, 768)).not.toBe(engine_fold(0x1234abcd, 513, 768))
  })
})
