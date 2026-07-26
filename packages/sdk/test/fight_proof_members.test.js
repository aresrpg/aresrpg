// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// THE MEMBER-LIST (format-3) COMMITMENT — #1110. A witness is the one artifact a claim is checked against, so
// the digest is pinned on BOTH sides of the language boundary: the assertion below and
// `aresrpg_foundation::zone_gen_members_tests::the_member_commitment_binds_the_roster` name the same 33 bytes
// over the same stream. If the BCS field order, the domain string, or the tag byte drifts on either side, a
// client composes witnesses the chain will never accept and every claim silently falls back to the derivation
// door — or worse, aborts.
//
// The stream is the shared parity fixture the sim twin also asserts (one fixture, three consumers).
import { describe, test, expect } from 'bun:test'
import { PublicKey } from '@mysten/sui/cryptography'
import { fromHex } from '@mysten/sui/utils'

import fixture from '../../sim/test/fixtures/replay/zone_members_format3_parity.json' with { type: 'json' }
import {
  compose_mob_group_proof,
  mob_group_member_set_bytes,
} from '../src/fight_proof.js'

// GROUND TRUTH — the 33-byte format-3 commitment, pinned identically by the Move suite:
//   0x03 ‖ blake2b256("aresrpg.zone-group.commitment" ‖ 0x03 ‖ bcs(MobGroupMemberSet))
const COMMITMENT_HEX =
  '03405e4489411fc5fd83864e61c272b3c35da8e518e4e52bd3d43fd9379af022b2'

const WORLD_ID =
  '0xbe3f36264b09c95e86491a9f0c1bcb744071d0bcc4176f0b7e2e60a22f115e1c'
const DISCOVERED_AT_MS = '1784980009967'
// the five authored rows of the fixture's table, as the Move suite names them
const ROWS = [1, 2, 3, 4, 5].map(n => `0x${n.toString(16).padStart(64, '0')}`)

const blake2b_256 = bytes =>
  fromHex(PublicKey.prototype.toSuiAddress.call({ toSuiBytes: () => bytes }))

const context = {
  world_id: WORLD_ID,
  zx: 487,
  zy: 487,
  zone_seed: fixture.inputs.seed,
  discovered_at_ms: DISCOVERED_AT_MS,
}

const groups = () =>
  fixture.groups.map((g, index) => ({
    index,
    spawn_id: g.spawn_id,
    template_id: ROWS[g.template_idx],
    member_template_ids: g.members.map(m => ROWS[m]),
    x: g.x,
    z: g.z,
    size: g.size,
    group_seed: String(g.group_seed),
  }))

const commitment_of = rows => {
  const preimage = mob_group_member_set_bytes({ ...context, groups: rows })
  const domain = new TextEncoder().encode('aresrpg.zone-group.commitment')
  const buf = new Uint8Array(domain.length + 1 + preimage.length)
  buf.set(domain, 0)
  buf[domain.length] = 3
  buf.set(preimage, domain.length + 1)
  return `03${Buffer.from(blake2b_256(buf)).toString('hex')}`
}

describe('the member-list (format-3) commitment', () => {
  test('the SDK preimage hashes to the Move-pinned commitment, byte for byte', () => {
    expect(commitment_of(groups())).toBe(COMMITMENT_HEX)
  })

  test('it BINDS the roster — swapping one member changes the commitment', () => {
    // The whole point of putting members inside the preimage: without it a claimant could name a pack of
    // chicklets and be seated against the roster the chain derived, or vice versa.
    const tampered = groups()
    tampered[0] = {
      ...tampered[0],
      member_template_ids: [
        tampered[0].member_template_ids[0],
        ROWS[4] === tampered[0].member_template_ids[1] ? ROWS[0] : ROWS[4],
        ...tampered[0].member_template_ids.slice(2),
      ],
    }
    expect(commitment_of(tampered)).not.toBe(COMMITMENT_HEX)
  })

  test('a format-3 root composes an EMPTY-proof witness through the producer', () => {
    // Format 3 has no Merkle tree — `zones` re-derives the stream and compares the whole-set hash, so the door
    // takes an empty proof vector. Reproducing the digest locally is what makes the witness honest.
    const witness = compose_mob_group_proof({
      ...context,
      group_root: Array.from(fromHex(COMMITMENT_HEX)),
      group_count: fixture.groups.length,
      groups: groups(),
      index: 3,
    })
    expect(witness).not.toBeNull()
    expect(witness.proof).toEqual([])
    expect(witness.index).toBe(3)
    expect(witness.facts.spawn_id).toBe(fixture.groups[3].spawn_id)
  })

  test('FAIL SHUT — a stream that does not reproduce the commitment yields no witness', () => {
    const wrong = groups()
    wrong[2] = { ...wrong[2], x: wrong[2].x + 1 }
    expect(
      compose_mob_group_proof({
        ...context,
        group_root: Array.from(fromHex(COMMITMENT_HEX)),
        group_count: fixture.groups.length,
        groups: wrong,
        index: 3,
      }),
    ).toBeNull()
  })

  test('a format-2 root over the SAME stream is a different commitment', () => {
    // The formats never fall back across each other: a member-list zone verified as a set commitment (or the
    // reverse) must simply not authenticate.
    expect(
      compose_mob_group_proof({
        ...context,
        group_root: [2, ...Array.from(fromHex(COMMITMENT_HEX)).slice(1)],
        group_count: fixture.groups.length,
        groups: groups(),
        index: 3,
      }),
    ).toBeNull()
  })
})
