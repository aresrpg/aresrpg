// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, test, expect } from 'bun:test'

// TEST-ONLY cross-package oracle (the pattern packages/rpc/api/group_witness.unit.test.js established and
// fight_witness.test.js reuses): the runtime SDK ships NO @aresrpg/sim dependency — production callers inject
// `derive_zone`; this suite injects the real one so the pin exercises the true pipeline.
import { derive_zone } from '../../sim/src/zone_derive.js'
// CAPTURED WIRE DATA (docs/CODE_LAW.md decode-test law): zone 487:487 of the live testnet world, its
// `ZoneGroupCommitment.root` verbatim — the 33-byte `0x02 ‖ digest` the chain dispatches on. Registered with the
// chain-id gate by #816, whose parity suite pins all 224 fact values of the same stream against the deployed
// package. Re-read live at 2026-07-25 through `get_zone_group_commitment` (root + count identical).
import truth from '../../sim/test/fixtures/zone_487_chain_truth.json' with { type: 'json' }
import {
  compose_mob_group_proof,
  mob_group_set_bytes,
  mob_group_witness,
} from '../src/fight_proof.js'

const hex = bytes => Buffer.from(Uint8Array.from(bytes)).toString('hex')

// GROUND TRUTH for the format-2 commitment, read off the DEPLOYED foundation bytecode — the testnet
// `foundation.latest` package of src/deployment/release.json, module `zone_gen`, function
// `mob_group_commitment` (disassembled 2026-07-25) — and confirmed by read-only SimulateTransaction of that
// function over this exact stream, which returned these 33 bytes:
//   commitment = 0x02 ‖ blake2b256("aresrpg.zone-group.commitment" ‖ 0x02 ‖ bcs(MobGroupSet))
// There is NO Merkle tree in format 2; `zones::resolve_mob_group` re-derives the stream on-chain and compares the
// whole-set hash, which is why its claim door aborts 110 unless the supplied proof vector is EMPTY.
const COMMITMENT_HEX =
  '023a1b46c7193310c14872557986a477364fe5dc1257acfab3f9395fd3aa3c805e'

const { zone, world, team_bound, _provenance } = truth
const world_id = _provenance.world

const rows = () =>
  derive_zone({
    zone: { ...zone, mob_bitmap: [], res_bitmap: [] },
    zx: zone.zx,
    zy: zone.zy,
    world,
    team_bound,
  }).filter(row => row.kind === 'mob')

describe('the lattice (format-2) commitment — the live zone the client engages on', () => {
  test('the captured 33-byte root composes a witness through the producer', () => {
    const witness = mob_group_witness({
      world_id,
      zx: zone.zx,
      zy: zone.zy,
      // the /v1 single-zone STATE doc shape, carrying the root verbatim
      zone: {
        seed: zone.seed,
        discovered_at_ms: zone.discovered_at_ms,
        mob_bitmap: [],
        group_root: zone.group_root,
        group_count: truth.chain_group_count,
      },
      world,
      team_bound,
      derive_zone,
      index: 0,
    })
    expect(witness).not.toBeNull()
    // The chain's own row 0 (zones_view::mob_spawn_id / mob_group_pos / mob_group_template, #816 capture).
    expect(witness.facts.spawn_id).toBe(truth.chain_mob_groups[0].spawn_id)
    expect(witness.facts.x).toBe(truth.chain_mob_groups[0].x)
    expect(witness.facts.z).toBe(truth.chain_mob_groups[0].z)
    // EMPTY by law on a lattice zone — a sibling path here is an abort-110 transaction.
    expect(witness.proof).toEqual([])
  })

  test('the composed set commitment reproduces the on-chain bytes', () => {
    const groups = rows()
    const preimage = mob_group_set_bytes({
      world_id,
      zx: zone.zx,
      zy: zone.zy,
      zone_seed: zone.seed,
      discovered_at_ms: zone.discovered_at_ms,
      groups,
    })
    expect(preimage.length).toBeGreaterThan(0)
    expect(hex(zone.group_root)).toBe(COMMITMENT_HEX)
    // The composer only hands out a witness when its rebuilt digest IS the stored commitment, so a green
    // compose over the captured bytes is that equality.
    expect(
      compose_mob_group_proof({
        world_id,
        zx: zone.zx,
        zy: zone.zy,
        zone_seed: zone.seed,
        discovered_at_ms: zone.discovered_at_ms,
        group_root: zone.group_root,
        group_count: groups.length,
        groups,
        index: 3,
      }),
    ).not.toBeNull()
  })

  test('fails shut on a tampered stream — one moved group loses the whole set', () => {
    const groups = rows().map((row, position) =>
      position === 7 ? { ...row, x: row.x + 1 } : row,
    )
    expect(
      compose_mob_group_proof({
        world_id,
        zx: zone.zx,
        zy: zone.zy,
        zone_seed: zone.seed,
        discovered_at_ms: zone.discovered_at_ms,
        group_root: zone.group_root,
        group_count: groups.length,
        groups,
        index: 0,
      }),
    ).toBeNull()
  })

  test('an unknown commitment shape is a typed failure, never a guessed witness', () => {
    const groups = rows()
    for (const group_root of [
      [3, ...Array.from({ length: 32 }, () => 0)], // an unknown format tag
      Array.from({ length: 31 }, () => 0), // a truncated digest
    ])
      expect(
        compose_mob_group_proof({
          world_id,
          zx: zone.zx,
          zy: zone.zy,
          zone_seed: zone.seed,
          discovered_at_ms: zone.discovered_at_ms,
          group_root,
          group_count: groups.length,
          groups,
          index: 0,
        }),
      ).toBeNull()
  })
})
