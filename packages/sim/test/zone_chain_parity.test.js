// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// CHAIN-TRUTH PARITY — the composition-at-discovery contract, asserted against BYTES CAPTURED FROM THE LIVE
// CHAIN rather than against a second copy of our own model (decode-test law: a twin that checks itself proves
// nothing). The fixture holds zone 487:487 of the live testnet world exactly as the deployed package reports
// it through `zones_view` — the same derivation `zones::claim_mob_group*` walks before it aborts
// `ESpawnNotFound(108)`, and the same one `gathering` walks for resource cells. If this test is red, every
// client-derived spawn_id is fiction and no open-world fight can be claimed: the chain scans ITS list for the
// id we name, finds nothing, and aborts.
//
// Zone 487:487 is the ONLY searched zone on the live world, so parity is widened to every row of both streams
// (56 groups × id/x/z/template + 36 cells × x/z/template/job) instead of a second zone — 368 independent
// chain values, which no coincidence survives.
import { describe, test, expect } from 'bun:test'

import { derive_zone, commitment_format } from '../src/zone_derive.js'
import release from '../../sdk/src/deployment/release.json'

import truth from './fixtures/zone_487_chain_truth.json'

/** The release pins for the network this fixture was captured on, and the staleness predicate over them. */
const pin = release.networks[truth._provenance.network].packages.aresrpg
const is_current = package_id => pin.latest === package_id

const derived = () =>
  derive_zone({
    zone: truth.zone,
    zx: truth.zone.zx,
    zy: truth.zone.zy,
    world: truth.world,
    team_bound: truth.team_bound,
  })

const mob_rows = () => derived().filter(row => row.kind === 'mob')
const res_rows = () => derived().filter(row => row.kind === 'resource')

describe('zone_derive ↔ LIVE chain parity (zone 487:487, testnet)', () => {
  // STALENESS BINDING (#1189). This fixture records its `_provenance` but nothing ever read it, so a republish or
  // an upgrade would leave every row below green against bytes a package we no longer call produced. `latest` is
  // the CALL TARGET every SDK moveCall resolves through (packages/move/scripts/check_release_pins.mjs, gated
  // against the live fullnode in CI); the day it moves, this goes red and the fixture owes a re-capture.
  test('the fixture has not gone stale: its provenance names the CURRENT release pins', () => {
    expect(is_current(truth._provenance.package_latest)).toBe(true)
    expect(pin.origin).toBe(truth._provenance.package_origin)
  })

  test('the binding discriminates — every superseded id of that package is REJECTED', () => {
    // The same predicate over REAL dead ids from the package's own retired-lineage list. A binding that said
    // `true` here would be a green light with nothing behind it.
    for (const dead of pin.previous ?? [])
      expect(is_current(dead), dead).toBe(false)
  })

  test('the derived group COUNT matches the chain', () => {
    expect(mob_rows()).toHaveLength(truth.chain_group_count)
  })

  test('every derived spawn_id matches the chain, in stream order', () => {
    // Stream order IS the mob-bitmap bit index and the claim door's scan order — an id at the wrong index is
    // as fatal as a missing one.
    expect(mob_rows().map(row => row.spawn_id)).toEqual(
      truth.chain_mob_groups.map(row => row.spawn_id),
    )
  })

  test('every derived group lands where the chain says it lands', () => {
    expect(mob_rows().map(({ x, z }) => ({ x, z }))).toEqual(
      truth.chain_mob_groups.map(({ x, z }) => ({ x, z })),
    )
  })

  test('every derived group carries the template the chain picked', () => {
    expect(mob_rows().map(row => row.template_id)).toEqual(
      truth.chain_mob_groups.map(row => row.template_id),
    )
  })

  test('the derived resource cells match the chain, in stream order', () => {
    // The res-bitmap index the gather door keys on — same contract as the mob stream, same failure mode.
    expect(res_rows()).toHaveLength(truth.chain_resource_count)
    expect(
      res_rows().map(({ x, z, template_id, job }) => ({
        x,
        z,
        template_id,
        job,
      })),
    ).toEqual(
      truth.chain_resource_cells.map(({ x, z, template_id, job }) => ({
        x,
        z,
        template_id,
        job,
      })),
    )
  })

  test('the commitment format byte SELECTS the derivation — dropping the root derives another world', () => {
    // The failure this whole fix exists to prevent: a read path that forwards the seed but not the commitment
    // root silently falls back to the legacy derivation and produces ids the chain never committed. Assert the
    // gate is load-bearing, so a caller that drops `group_root` fails HERE and not at a player's claim.
    expect(commitment_format(truth.zone.group_root)).toBe(2)
    const without_root = derive_zone({
      zone: { ...truth.zone, group_root: undefined },
      zx: truth.zone.zx,
      zy: truth.zone.zy,
      world: truth.world,
      team_bound: truth.team_bound,
    }).filter(row => row.kind === 'mob')
    expect(commitment_format(undefined)).toBe(1)
    expect(without_root.map(row => row.spawn_id)).not.toEqual(
      truth.chain_mob_groups.map(row => row.spawn_id),
    )
  })

  test('spawn spacing holds by construction (the lattice guarantee)', () => {
    // The chain places one spawn per 40×40 lattice cell, jittered into the middle 21 blocks — so neighbours
    // are ≥ 20 blocks apart without any rejection sampling. Assert the invariant the lattice replaced.
    const rows = mob_rows()
    for (let i = 0; i < rows.length; i++)
      for (let j = i + 1; j < rows.length; j++) {
        const dx = rows[i].x - rows[j].x
        const dz = rows[i].z - rows[j].z
        expect(dx * dx + dz * dz).toBeGreaterThanOrEqual(400)
      }
  })
})
