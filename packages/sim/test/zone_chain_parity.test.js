// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// CHAIN-TRUTH PARITY — the composition-at-discovery contract, asserted against BYTES CAPTURED FROM THE LIVE
// CHAIN rather than against a second copy of our own model (decode-test law: a twin that checks itself proves
// nothing). The fixture holds zone 487:487 of the live testnet world exactly as the deployed package reports it
// through `zones_view` — the same derivation `zones::claim_mob_group*` walks before it aborts
// `ESpawnNotFound(108)`. If this test is red, every client-derived spawn_id is fiction and no open-world fight
// can be claimed: the chain scans ITS list for the id we name, finds nothing, and aborts.
import { describe, test, expect } from 'bun:test'

import { derive_zone } from '../src/zone_derive.js'

import truth from './fixtures/zone_487_chain_truth.json'

const world = {
  zone_size: truth.world.zone_size,
  bounds_x: truth.world.bounds_x,
  bounds_z: truth.world.bounds_z,
  min_groups: truth.world.min_groups,
  max_groups: truth.world.max_groups,
  spawn_zone_x: truth.world.spawn_zone_x,
  spawn_zone_z: truth.world.spawn_zone_z,
  // the live world's mob table, as the World doc serves it (levels drive the §4 eligibility filter)
  mobs: [
    { template_id: '0x61aec16edb7974f6e9f11634aa1527a66e4e4512d8928152e2ccf4fb6226cc6b', level: 5, rate_bp: 7200, min_group: 2, max_group: 3 },
    { template_id: '0x4a00a579a3ae4592310219ec550fba0c97ea0171a2bcdf38caa41b7aecdcbe97', level: 3, rate_bp: 8000, min_group: 2, max_group: 3 },
    { template_id: '0x8a56ee40cf3f369c7f2686d9f7189f7dda3b2b6e9d7fbf6c7114de17a1b210cd', level: 4, rate_bp: 8000, min_group: 2, max_group: 3 },
    { template_id: '0x8f7f74b5e1bfdc74f647528ad7272e9c3eae655ae5c071602d7d2e5b3b96a3cd', level: 9, rate_bp: 7600, min_group: 2, max_group: 3 },
    { template_id: '0xf2a845e2c8a8f5197966a993a741a4fd1d21511d9b66d7798c22dc11c9c46b49', level: 5, rate_bp: 8000, min_group: 2, max_group: 3 },
    { template_id: '0xe64d34d922cba01a39c0c8262677e1dd13d3d99b8989f2f7f283df8af447b4e0', level: 7, rate_bp: 6600, min_group: 2, max_group: 3 },
    { template_id: '0x23684d32475ba06982f863427bc845a676e60f4fcb3af98d2b4e88d0db5f9012', level: 7, rate_bp: 8000, min_group: 2, max_group: 3 },
    { template_id: '0xb80ade532904c3651160c7658f603e0cd73501746694c8becbd8a4366425d444', level: 10, rate_bp: 8000, min_group: 2, max_group: 3 },
    { template_id: '0x4a5dbc1b9f6d822075345141bf6c82e255570390b00845a49ac66dc43963f7f7', level: 10, rate_bp: 8000, min_group: 2, max_group: 3 },
    { template_id: '0x4f1a97000000000000000000000000000000000000000000000000000000000f', level: 12, rate_bp: 8000, min_group: 2, max_group: 3 },
    { template_id: '0x74dc73000000000000000000000000000000000000000000000000000000000f', level: 10, rate_bp: 8000, min_group: 2, max_group: 3 },
    { template_id: '0xdd4dc6000000000000000000000000000000000000000000000000000000000f', level: 7, rate_bp: 40, min_group: 2, max_group: 3 },
    { template_id: '0x58c84c000000000000000000000000000000000000000000000000000000000f', level: 12, rate_bp: 40, min_group: 2, max_group: 3 },
  ],
  resources: [],
}

const derived = () =>
  derive_zone({
    zone: truth.zone,
    zx: truth.zone.zx,
    zy: truth.zone.zy,
    world,
    team_bound: truth.team_bound,
  }).filter(row => row.kind === 'mob')

describe('zone_derive ↔ LIVE chain parity (zone 487:487, testnet)', () => {
  test('the derived group COUNT matches the chain', () => {
    expect(derived()).toHaveLength(truth.chain_group_count)
  })

  test('every derived spawn_id matches the chain, in stream order', () => {
    // Stream order IS the mob-bitmap bit index and the claim door's scan order — an id at the wrong index is
    // as fatal as a missing one.
    expect(derived().map(row => row.spawn_id)).toEqual(truth.chain_spawn_ids)
  })

  test('group 0 lands where the chain says it lands', () => {
    const [first] = derived()
    expect({ x: first.x, z: first.z }).toEqual({
      x: truth.chain_first_group.x,
      z: truth.chain_first_group.z,
    })
  })

  test('a claimable spawn_id is one the CHAIN derives (the ESpawnNotFound(108) contract)', () => {
    // The three ids the driven-fight gate tried to claim; each aborted zones::ESpawnNotFound(108).
    const attempted = [
      '9055932198808986744',
      '4905803926414984189',
      '16490778516248849437',
    ]
    const chain = new Set(truth.chain_spawn_ids)
    for (const id of attempted) expect(chain.has(id)).toBe(true)
  })
})
