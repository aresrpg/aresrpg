// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// MEMBER-LIST (format 3) TWIN PARITY — #1110/#1111. The twin law: the Move kernel
// (`aresrpg_foundation::zone_gen::derive_mob_groups_members`) and this JS mirror must agree BYTE FOR BYTE, or a
// mixed pack the client draws on the map is not the pack the chain seats in the fight. The fixture below is the
// single shared truth: this file asserts the JS side of it, `zone_gen_members_tests.move` asserts the Move side
// of the SAME numbers. Neither twin checks itself.
//
// The stream is also where the boss fence lives, so the fence's three clauses are re-asserted here rather than
// trusted from the Move suite — a fence that holds on chain but not in the client still ships a lying map.
import { describe, test, expect } from 'bun:test'

import {
  derive_mob_groups_members,
  commitment_format,
} from '../src/zone_derive.js'

import { zone_members_parity as fixture } from './fixtures/zone_members_format4_witness.js'

const derived = () =>
  derive_mob_groups_members({
    ...fixture.inputs,
    seed: BigInt(fixture.inputs.seed),
  })

const [BOSS] = fixture.inputs.boss_rows
const single_spec = members => members.every(m => m === members[0])

describe('zone_derive ↔ zone_gen member-list parity (format 3)', () => {
  test('every group matches the pinned fixture, in stream order', () => {
    // Stream order IS the mob-bitmap bit index the claim door scans — a right row at the wrong index is as
    // fatal as a missing one.
    expect(
      derived().map(g => ({
        spawn_id: g.spawn_id.toString(),
        template_idx: g.template_idx,
        members: g.members,
        x: g.x,
        z: g.z,
        size: g.size,
        group_seed: g.group_seed,
      })),
    ).toEqual(fixture.groups)
  })

  test('FIXTURE ① — no group mixes a boss row with any other row', () => {
    for (const g of derived())
      if (g.members.includes(BOSS)) expect(single_spec(g.members)).toBe(true)
  })

  test('FIXTURE ② — a primary-boss group is single-spec at its own row', () => {
    const boss_groups = derived().filter(g => g.template_idx === BOSS)
    expect(boss_groups.length).toBeGreaterThan(0) // a vacuous pass would prove nothing
    for (const g of boss_groups) {
      expect(single_spec(g.members)).toBe(true)
      expect(g.members[0]).toBe(BOSS)
    }
  })

  test('FIXTURE ④ — a non-boss primary can draw a genuinely mixed pack', () => {
    expect(
      derived().filter(g => !single_spec(g.members)).length,
    ).toBeGreaterThan(0)
  })

  test('FIXTURE ③ — a mask-absent world (empty boss mask) derives well-formed rosters', () => {
    // An absent `boss_mask` dynamic field reads as an EMPTY index vector, so the member table is the pick table
    // unchanged — the one uniform degradation path, and exactly what a dungeon-only-boss world looks like.
    const rows = derive_mob_groups_members({
      ...fixture.inputs,
      seed: BigInt(fixture.inputs.seed),
      member_weights: fixture.inputs.weights,
    })
    expect(rows.length).toBeGreaterThan(0)
    for (const g of rows) {
      expect(g.members).toHaveLength(4) // the roster is the RAW roll, never the team-bound clamp
      expect(g.members[0]).toBe(g.template_idx)
      for (const m of g.members)
        expect(m).toBeLessThan(fixture.inputs.weights.length)
    }
  })

  test('the stream is independent of the live team bound', () => {
    // `zones_view` derives with bound 1 to read ids; the claim door derives with the live bound. If the bound
    // moved the stream, every spawn id the map advertises would be fiction.
    const at = size_bound =>
      derive_mob_groups_members({
        ...fixture.inputs,
        seed: BigInt(fixture.inputs.seed),
        size_bound,
      })
    // compare everything BUT the clamped size — that is the one value the bound is allowed to move
    const strip = rows =>
      rows.map(row => ({
        spawn_id: row.spawn_id.toString(),
        template_idx: row.template_idx,
        members: row.members,
        x: row.x,
        z: row.z,
        group_seed: row.group_seed,
      }))
    expect(strip(at(1))).toEqual(strip(at(6)))
    expect(at(1)[0].size).toBe(1)
    expect(at(6)[0].size).toBe(4)
  })

  test('the format byte dispatches format 3 without disturbing 1 and 2', () => {
    expect(commitment_format(new Uint8Array(32))).toBe(1)
    expect(commitment_format([2, ...new Array(32).fill(0)])).toBe(2)
    expect(commitment_format([3, ...new Array(32).fill(0)])).toBe(3)
    // 4 = the member TREE (#2194) — the same stream as 3, committed per group. 5 stands in for "a format this
    // build cannot derive", which stays 0: an unknown commitment is never guessed at.
    expect(commitment_format([4, ...new Array(32).fill(0)])).toBe(4)
    expect(commitment_format([5, ...new Array(32).fill(0)])).toBe(0)
    expect(commitment_format(null)).toBe(1) // an absent root is a pre-commitment zone = legacy
  })
})
