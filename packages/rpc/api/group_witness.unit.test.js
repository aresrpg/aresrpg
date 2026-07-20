// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// THE WITNESS-PRODUCER PARITY PIN (fight-create compute diet, 2026-07-17). Proves the /v1 zone-state
// SHAPE this api serves (`seed` string + `discovered_at_ms` + `group_root` byte array + `group_count`
// — see views.js shape_zone / snapshot.rs map_group_root_field) composes into the EXACT authenticated
// mob-group witness the chain's proof door accepts, byte-for-byte against a frozen vector.
//
// Cross-package imports are TEST-ONLY (never shipped in the deps-free docker image): the runtime api
// stays a documented mirror with no cross-language/package deps, and THIS suite is the mechanical gate
// that the mirror and the composer still agree. Two independently proven oracles anchor the pin:
//   • `@aresrpg/sim` derive_zone — parity-pinned against the chain (zone_derive.test.js ↔ Move tests);
//   • `@aresrpg/sdk` compose_mob_group_proof — chain-accepted on the 07-17 localnet rehearsal
//     (executed proof-door digest 9nUaG4hFWgYk4tCto4EE5N634Tj2vaAWkiBrB82HShds, 192B/6-sibling
//     witness; the rehearsal chain was regenerated so its raw state is unrecoverable — this frozen
//     vector re-pins the same code paths deterministically).
// The Merkle root is ALSO recomputed here with Bun's NATIVE blake2b256 over the SDK's exported leaf
// BCS: the composer (noble blake2b) must accept it, so any drift in hash impl, domain separation,
// leaf layout, tree shape, or prng derivation turns this suite red.

import { describe, expect, test } from 'bun:test'

import { derive_zone } from '../../sim/src/zone_derive.js'
import { compose_mob_group_proof, mob_group_leaf_bytes } from '../../sdk/src/fight_proof.js'

const LEAF_DOMAIN = new TextEncoder().encode('aresrpg.zone-group.leaf') // = zone_gen.move / fight_proof.js
const NODE_DOMAIN = new TextEncoder().encode('aresrpg.zone-group.node')
const blake = (...parts) => {
  const hasher = new Bun.CryptoHasher('blake2b256')
  for (const part of parts) hasher.update(part)
  return new Uint8Array(hasher.digest())
}
const hex = (bytes) => Buffer.from(bytes).toString('hex')

// Duplicate-last Merkle root — the zone_gen.move tree shape, INDEPENDENTLY rebuilt (Bun blake).
const root_of = (leaves) => {
  let nodes = leaves
  while (nodes.length > 1) {
    const next = []
    for (let i = 0; i < nodes.length; i += 2) next.push(blake(NODE_DOMAIN, nodes[i], nodes[i + 1] ?? nodes[i]))
    nodes = next
  }
  return nodes[0]
}

// Derive the FULL mob-group stream from a zone doc EXACTLY as the SDK witness leg must: EMPTY bitmaps
// (the committed root spans every derivation-stream entry; consumption is the claim door's own
// occupancy check, never a tree mutation), then the mob rows in stream order.
const full_stream = (doc, zx, zy, world) =>
  derive_zone({
    zone: { seed: doc.seed, discovered_at_ms: doc.discovered_at_ms, mob_bitmap: [], res_bitmap: [] },
    zx,
    zy,
    world,
    team_bound: 6,
  })
    .filter((r) => r.kind === 'mob')
    .map((r) => ({
      index: r.index,
      spawn_id: r.spawn_id,
      template_id: r.template_id,
      x: r.x,
      z: r.z,
      size: r.size,
      group_seed: r.group_seed,
    }))

// Compose from the /v1-SERVED field names verbatim — the exact consumption contract of the follow-up
// SDK leg (zone doc + the client's cached world doc → group_proof for create_fight_ptb).
const witness_from_served = (world_id, zx, zy, doc, world, index) =>
  compose_mob_group_proof({
    world_id,
    zx,
    zy,
    zone_seed: doc.seed, // STRING (2^53 law) — the composer must take it verbatim
    discovered_at_ms: doc.discovered_at_ms,
    group_root: doc.group_root,
    group_count: doc.group_count,
    groups: full_stream(doc, zx, zy, world),
    index,
  })

// Short synthetic ids (chain-id gate: no new full-width 0x…64-hex literals in source — the repo's
// fixture idiom, e.g. sdk fight.test.js `world_id: '0x1'`). `bcs.Address` left-pads them to the SAME
// 32 bytes as their full-width forms, so the frozen root/proof bytes below are id-form-independent.
const TPL = '0xae01'
const world_doc = (min_groups, max_groups) => ({
  zone_size: 32,
  bounds_x: 512,
  bounds_z: 512,
  min_groups,
  max_groups,
  min_nodes: 0,
  max_nodes: 0,
  spawn_zone_x: 32,
  spawn_zone_z: 32,
  mobs: [{ template_id: TPL, rate_bp: 10000, min_group: 1, max_group: 3, level: 0 }],
  resources: [],
})

// ── FROZEN VECTORS (generated 2026-07-17 by a one-off fixture script — regenerate ONLY on
// a deliberate, chain-coordinated change of the commitment scheme) ─────────────────────────────────
const G64 = {
  world_id: '0xe0164',
  zx: 8,
  zy: 8,
  // The served /v1 doc shape (state form): seed STRING > 2^53, root as a plain byte array.
  doc: {
    seed: '9007199254740993',
    discovered_at_ms: 1700000009000,
    group_root: [
      0xee, 0x2e, 0x1b, 0x02, 0x06, 0x15, 0x28, 0x69, 0xb9, 0xb0, 0x20, 0xfb, 0xd6, 0xa2, 0x57, 0xa4, 0x2d, 0xfd, 0x5b,
      0xb4, 0x22, 0x14, 0x19, 0xde, 0xd8, 0xf5, 0xfe, 0x0b, 0x01, 0x05, 0x8e, 0xdc,
    ],
    group_count: 64,
  },
  index: 0,
  facts: {
    spawn_id: '902532234245404755',
    template_id: TPL,
    x: 262,
    z: 263,
    group_size: 2,
    group_seed: '1725358327',
  },
  proof_hex:
    'ea23f42283d3a968a340d474aaa18556b08216ab70af491fdaeb4899cc2c39e57a9717ef3f7c9238c91a51522ebc97f4' +
    'dbcdd802ceff99b42cd731453687d16e32d801445f4e206d15eb527991c9028140197b60fa6f97b41dd4580f4e5f271b' +
    'c272ee7cd29f7e215c40d8e7b886f0cc27159d2d4eec432006ca05c9562266e5af4b25c508260cac75318d11591a510c' +
    'b8c144a7b80417586f39b4eb8909ceb0f30539c15c27aba9708049eebcecf74ce67aca2e5997f160dd5c10e864410153',
}
const G5 = {
  world_id: '0xe0105',
  zx: 3,
  zy: 4,
  doc: {
    seed: '424242',
    discovered_at_ms: 1700000042000,
    group_root: [
      0x5e, 0x88, 0x92, 0x9f, 0x6a, 0x05, 0x5d, 0x7c, 0xbc, 0xce, 0xa3, 0xcb, 0xf9, 0x08, 0xcb, 0x47, 0x68, 0xe1, 0xbf,
      0x7b, 0x84, 0xd8, 0x0f, 0x0a, 0xbb, 0xf0, 0x58, 0x18, 0x42, 0x91, 0xc4, 0x14,
    ],
    group_count: 5,
  },
  index: 4, // the odd tail — every tree level duplicates its last node under this path
  proof_hex:
    'de814766442d407153d63976510062f5f219c112ffbd585a39851c1c739b8917f37d91102e6209b80733d1cae14a2bb0' +
    '1f9723c429b835af4bdd0a81cfe26cec7679c9348f18943a6174f6bc9c8acb7c7760af18602ed5c9a371a8ade39bb8cd',
}

describe('witness producer parity pin', () => {
  test('Bun blake2b256 is real blake2b-256 (canonical test vector, not a truncated 512)', () => {
    // blake2b's digest length is an INIT parameter — slicing blake2b-512 gives DIFFERENT bytes.
    expect(hex(blake(new TextEncoder().encode('abc')))).toBe(
      'bddd813c634239723171ef3fee98579b94964e3bb1cb3e427262c8c068d52319'
    )
  })

  test('G=64: the derived stream re-roots to the frozen commitment under Bun-native blake', () => {
    const groups = full_stream(G64.doc, G64.zx, G64.zy, world_doc(64, 64))
    expect(groups.length).toBe(64)
    const context = {
      world_id: G64.world_id,
      zx: G64.zx,
      zy: G64.zy,
      zone_seed: G64.doc.seed,
      discovered_at_ms: G64.doc.discovered_at_ms,
    }
    const leaves = groups.map((g) => blake(LEAF_DOMAIN, mob_group_leaf_bytes({ ...context, ...g, group_size: g.size })))
    expect(hex(root_of(leaves))).toBe(hex(G64.doc.group_root))
  })

  test('G=64: the served /v1 shape composes into the frozen witness byte-exact (192B, 6 siblings)', () => {
    const witness = witness_from_served(G64.world_id, G64.zx, G64.zy, G64.doc, world_doc(64, 64), G64.index)
    expect(witness).not.toBeNull()
    expect(witness.index).toBe(0)
    expect(witness.facts).toEqual(G64.facts) // the GroupTicket facts the chain door re-binds
    expect(witness.proof.length).toBe(192) // ceil(log2(64)) = 6 sibling hashes — the rehearsal's shape
    expect(hex(witness.proof)).toBe(G64.proof_hex)
  })

  test('G=5 odd tail: the duplicate-last lane composes into the frozen witness (96B, 3 siblings)', () => {
    const witness = witness_from_served(G5.world_id, G5.zx, G5.zy, G5.doc, world_doc(5, 5), G5.index)
    expect(witness).not.toBeNull()
    expect(witness.index).toBe(4)
    expect(witness.proof.length).toBe(96)
    expect(hex(witness.proof)).toBe(G5.proof_hex)
  })

  test('fails shut: a tampered root composes to null (the old claim door), never a bad witness', () => {
    const tampered = { ...G64.doc, group_root: [...G64.doc.group_root.slice(0, 31), G64.doc.group_root[31] ^ 1] }
    expect(witness_from_served(G64.world_id, G64.zx, G64.zy, tampered, world_doc(64, 64), 0)).toBeNull()
  })

  test('fails shut: a consumption-FILTERED stream composes to null (the empty-bitmap law)', () => {
    // The trap the SDK leg must never hit: deriving with the LIVE bitmaps drops consumed rows, and a
    // partial stream can never re-root — the composer refuses rather than emit a doomed proof.
    const groups = full_stream(G64.doc, G64.zx, G64.zy, world_doc(64, 64)).filter((g) => g.index !== 7)
    expect(
      compose_mob_group_proof({
        world_id: G64.world_id,
        zx: G64.zx,
        zy: G64.zy,
        zone_seed: G64.doc.seed,
        discovered_at_ms: G64.doc.discovered_at_ms,
        group_root: G64.doc.group_root,
        group_count: G64.doc.group_count,
        groups,
        index: 0,
      })
    ).toBeNull()
  })
})
