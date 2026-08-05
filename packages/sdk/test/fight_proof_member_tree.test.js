// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// THE MEMBER-TREE (format-4) COMMITMENT — #2194. Format 3 committed the whole derived set as one flat hash, so
// the only way to authenticate one group was to make the chain re-derive the zone; format 4 commits the SAME
// stream as a Merkle tree over per-group leaves and a claim carries one inclusion path instead.
//
// The frozen cross-language witness lives in the shared sim test fixture; this suite consumes it through imports.
import { describe, test, expect } from 'bun:test'

import {
  member_tree_groups,
  member_tree_witness,
} from '../../sim/test/fixtures/zone_members_format4_witness.js'
import { compose_mob_group_proof } from '../src/fight_proof.js'

const hex = bytes => Buffer.from(Uint8Array.from(bytes)).toString('hex')

const compose = (overrides = {}) =>
  compose_mob_group_proof({
    world_id: member_tree_witness.world_id,
    zx: member_tree_witness.zx,
    zy: member_tree_witness.zy,
    zone_seed: member_tree_witness.zone_seed,
    discovered_at_ms: member_tree_witness.discovered_at_ms,
    progress: member_tree_witness.progress,
    group_root: Array.from(
      Buffer.from(member_tree_witness.root_hex, 'hex'),
    ),
    group_count: member_tree_groups().length,
    groups: member_tree_groups(),
    index: 0,
    ...overrides,
  })

describe('the member-tree (format-4) witness', () => {
  test('the SDK reproduces the Move-pinned inclusion path for group 0', () => {
    const witness = compose()
    expect(witness).not.toBeNull()
    expect(hex(witness.proof)).toBe(member_tree_witness.proof_hex)
    expect(witness.index).toBe(0)
  })

  test('the witness carries the roster and progress the claim door takes', () => {
    const { facts } = compose()
    expect(facts.member_template_ids).toEqual(
      member_tree_groups()[0].member_template_ids,
    )
    expect(facts.progress).toBe(member_tree_witness.progress)
    expect(facts.spawn_id).toBe(member_tree_groups()[0].spawn_id)
  })

  test('the path is a real tree, not the empty vector formats 2/3 take', () => {
    expect(compose().proof.length).toBe(4 * 32)
  })

  // SAD PATHS FIRST — the composer FAILS SHUT so the caller keeps the derive door instead of signing a
  // transaction the chain will abort.
  test('a swapped member re-roots — the witness is refused', () => {
    const rows = member_tree_groups()
    const roster = rows[0].member_template_ids
    rows[0] = {
      ...rows[0],
      member_template_ids: [
        roster[0] === member_tree_witness.templates[0]
          ? member_tree_witness.templates[1]
          : member_tree_witness.templates[0],
        ...roster.slice(1),
      ],
    }
    expect(compose({ groups: rows })).toBeNull()
  })

  test('a dialled-down progress re-roots — the witness is refused', () => {
    expect(
      compose({ progress: member_tree_witness.progress - 1 }),
    ).toBeNull()
  })

  test('a stream that is not the chain’s stream is refused, never trimmed to fit', () => {
    expect(
      compose({ groups: member_tree_groups().slice(0, 4), group_count: 4 }),
    ).toBeNull()
  })

  test('the format-3 tag over the same digest is NOT a member tree — no cross-format fallback', () => {
    const mislabelled = Array.from(
      Buffer.from(member_tree_witness.root_hex, 'hex'),
    )
    mislabelled[0] = 3
    expect(compose({ group_root: mislabelled })).toBeNull()
  })
})
