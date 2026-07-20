// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, expect, it } from 'bun:test'

import { gather_gate } from './gather_gate.js'

// The read-model keys the equipped gathering tool under the collapsed `pickaxe` slot (jobs.js
// GATHER_TOOL_SLOTS); job_from_tool recovers the true job (farmer/herbalist/miner) from the tool. A node
// carries `job` u8 (0 FARMER / 1 HERBALIST / 2 MINER) + `tier` u8. tier→level: T1=1, T2=10, T3=20…
const hoe = { pickaxe: { name: 'Old Hoe' } } // → farmer
const pickaxe = { pickaxe: { name: 'Pickaxe' } } // → miner
const farmer_node = (tier = 1) => ({ job: 0, tier })

describe('gather_gate — the local [G] pre-check: never fire a doomed gather tx', () => {
  it('no gathering tool equipped → tool requirement (named by the node job)', () => {
    expect(gather_gate({}, farmer_node())).toEqual({ ok: false, reason: 'tool', tool: 'Hoe', job: 'Farmer', level: 0 })
    expect(gather_gate(null, farmer_node())).toMatchObject({ ok: false, reason: 'tool', tool: 'Hoe' })
  })

  it('WRONG tool for the node job → tool requirement (pickaxe on a farmer node)', () => {
    expect(gather_gate(pickaxe, farmer_node())).toMatchObject({ ok: false, reason: 'tool', tool: 'Hoe' })
  })

  it('right tool, tier unlocked at the current job level → OK (no requirement, [G] arms)', () => {
    // level 1 (no xp) meets a T1 node (req level 1).
    expect(gather_gate(hoe, farmer_node(1))).toEqual({ ok: true })
    expect(gather_gate({ ...hoe, jobs: { farmer: 0 } }, farmer_node(1))).toEqual({ ok: true })
  })

  it('right tool but job level below the tier → tier requirement (the REQUIRED level)', () => {
    // T2 requires farmer level 10; a level-1 (0 xp) farmer is locked out.
    expect(gather_gate({ ...hoe, jobs: { farmer: 0 } }, farmer_node(2))).toEqual({
      ok: false,
      reason: 'tier',
      tool: 'Hoe',
      job: 'Farmer',
      level: 10,
    })
  })

  it('right tool AND enough job level for the tier → OK', () => {
    // Farmer at a high xp clears T2 (req 10). 50_946 xp ≈ level 46 in the SDK curve — comfortably past 10.
    expect(gather_gate({ ...hoe, jobs: { farmer: 50_946 } }, farmer_node(2))).toEqual({ ok: true })
  })
})
