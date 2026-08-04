// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// THE MEMBER-TREE (format-4) COMMITMENT — #2194. Format 3 committed the whole derived set as one flat hash, so
// the only way to authenticate one group was to make the chain re-derive the zone; format 4 commits the SAME
// stream as a Merkle tree over per-group leaves and a claim carries one inclusion path instead.
//
// The witness is the one artifact a claim is checked against, so the root AND the path are pinned on BOTH sides
// of the language boundary: the bytes below and
// `aresrpg_foundation::zone_gen_members_tests::the_member_tree_proves_one_group_without_the_zone` name the same
// 33 root bytes and the same 128-byte path over the same stream. If the BCS field order, the leaf domain, or
// the tag byte drifts on either side, a client composes witnesses the chain will never accept.
//
// The stream is the shared parity fixture the sim twin also asserts (one fixture, three consumers).
import { describe, test, expect } from 'bun:test'

import fixture from '../../sim/test/fixtures/zone_members_format3_parity.json' with { type: 'json' }
import { compose_mob_group_proof } from '../src/fight_proof.js'

// GROUND TRUTH — pinned identically by the Move suite:
//   0x04 ‖ merkle_root(blake2b256("aresrpg.zone-group.member-leaf" ‖ bcs(MobGroupMemberLeaf)))
const ROOT_HEX =
  '045f45b05f1c2c39b05a521e67edd816b953bd28f6006cc6969a88bba87ab0ef15'
const PROOF_HEX =
  '2363f31e53651f2a7615011ff6bfee5f24fca9907fec6bd77b901cdfa167ffda7d56bc6f9d7fa809831086aae5063191b4d54489f54214bddb0324cd7b5fe0ad3ba5f1affcbd4930f0c221682132603cbcef917128ec55d97234a4d587e3ae5002d11e199e560fce3175e16a11b8cddff33a942a15ad94c396f35fa167e63986'

const WORLD_ID = '0xbe3f'
const DISCOVERED_AT_MS = '1784980009967'
const PROGRESS = 613 // the §4 value the Move suite pins — the leaf binds it
const ROWS = [1, 2, 3, 4, 5].map(n => `0x${n.toString(16).padStart(64, '0')}`)

const hex = bytes => Buffer.from(Uint8Array.from(bytes)).toString('hex')

const groups = () =>
  fixture.groups.map((g, index) => ({
    index,
    spawn_id: g.spawn_id,
    template_id: ROWS[g.template_idx],
    // the SEATING roster — the derived roster truncated to the group's size, exactly what the chain commits
    member_template_ids: g.members.slice(0, g.size).map(m => ROWS[m]),
    x: g.x,
    z: g.z,
    size: g.size,
    group_seed: String(g.group_seed),
  }))

const compose = (overrides = {}) =>
  compose_mob_group_proof({
    world_id: WORLD_ID,
    zx: 487,
    zy: 487,
    zone_seed: fixture.inputs.seed,
    discovered_at_ms: DISCOVERED_AT_MS,
    progress: PROGRESS,
    group_root: Array.from(Buffer.from(ROOT_HEX, 'hex')),
    group_count: fixture.groups.length,
    groups: groups(),
    index: 0,
    ...overrides,
  })

describe('the member-tree (format-4) witness', () => {
  test('the SDK reproduces the Move-pinned inclusion path for group 0', () => {
    const witness = compose()
    expect(witness).not.toBeNull()
    expect(hex(witness.proof)).toBe(PROOF_HEX)
    expect(witness.index).toBe(0)
  })

  test('the witness carries the roster and progress the claim door takes', () => {
    const { facts } = compose()
    expect(facts.member_template_ids).toEqual(groups()[0].member_template_ids)
    expect(facts.progress).toBe(PROGRESS)
    expect(facts.spawn_id).toBe(fixture.groups[0].spawn_id)
  })

  test('the path is a real tree, not the empty vector formats 2/3 take', () => {
    expect(compose().proof.length).toBe(4 * 32)
  })

  // SAD PATHS FIRST — the composer FAILS SHUT so the caller keeps the derive door instead of signing a
  // transaction the chain will abort.
  test('a swapped member re-roots — the witness is refused', () => {
    const rows = groups()
    const roster = rows[0].member_template_ids
    rows[0] = {
      ...rows[0],
      member_template_ids: [
        roster[0] === ROWS[0] ? ROWS[1] : ROWS[0],
        ...roster.slice(1),
      ],
    }
    expect(compose({ groups: rows })).toBeNull()
  })

  test('a dialled-down progress re-roots — the witness is refused', () => {
    expect(compose({ progress: PROGRESS - 1 })).toBeNull()
  })

  test('a stream that is not the chain’s stream is refused, never trimmed to fit', () => {
    expect(compose({ groups: groups().slice(0, 4), group_count: 4 })).toBeNull()
  })

  test('the format-3 tag over the same digest is NOT a member tree — no cross-format fallback', () => {
    const mislabelled = Array.from(Buffer.from(ROOT_HEX, 'hex'))
    mislabelled[0] = 3
    expect(compose({ group_root: mislabelled })).toBeNull()
  })
})
