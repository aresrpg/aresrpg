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

import truth from './fixtures/zone_487_chain_truth.json'

/** The lineage that PRODUCED these bytes, as the fixture itself recorded it — this binding's only authority. */
const capture = truth._provenance
const is_capture_lineage = package_id => capture.package_latest === package_id
const ID_RE = /^0x[0-9a-f]{64}$/

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
  // PROVENANCE BINDING (#1189, re-cut). These rows are bytes ONE SPECIFIC package produced, so the lineage the
  // fixture itself recorded is what they must be read against — never whatever release.json points at today. This
  // binding used to compare the recording to the CURRENT pins, which coupled a chain-truth capture to an unrelated
  // event: a republish moves the pins, but it does not retroactively change which bytecode resolved this zone, so
  // the fixture went red for a reason that was not about its own correctness. Re-capturing on a fresh lineage is a
  // POST-ENABLE CEREMONY LEG (the new packages are dark until `--enable`, and a capture needs a seeded World); when
  // that leg runs it rewrites `_provenance` — including `superseded` — and this binding keeps working unchanged.
  test('the fixture records the lineage that produced these bytes', () => {
    expect(capture.network).toBeTruthy()
    expect(capture.package_origin).toMatch(ID_RE)
    expect(capture.package_latest).toMatch(ID_RE)
    expect(capture.captured).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  test('the binding discriminates — every id outside the capture lineage is REJECTED', () => {
    // REAL dead ids, recorded beside the capture: the lineage this package had already retired when these bytes
    // were read. A predicate that said `true` here would be a green light with nothing behind it. The set is
    // asserted NON-EMPTY before it is walked — reading it from a live artifact is exactly how this loop silently
    // went vacuous once the republish emptied that artifact's retired list.
    const superseded = capture.superseded ?? []
    expect(superseded.length).toBeGreaterThan(0)
    for (const dead of superseded)
      expect(is_capture_lineage(dead), dead).toBe(false)
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
