import { describe, test, expect } from 'bun:test'

// TEST-ONLY cross-package oracle (the pattern packages/rpc/api/group_witness.unit.test.js established):
// the runtime SDK ships NO @aresrpg/sim dependency (published ↔ private, one-way boundary) — production
// callers inject `derive_zone`; this suite injects the real one so the pin exercises the true pipeline.
import { derive_zone } from '../../sim/src/zone_derive.js'
import { create_fight_ptb, mob_group_witness } from '../src/fight.js'

import { IDS, id, targets } from './_onchain_fixtures.js'

const hex = bytes => Buffer.from(Uint8Array.from(bytes)).toString('hex')

// ── FROZEN VECTORS — copied VERBATIM from packages/rpc/api/group_witness.unit.test.js (the witness-producer
// lane's chain-accepted pin, 2026-07-17: executed proof-door digest 9nUaG4hFWgYk4tCto4EE5N634Tj2vaAWkiBrB82HShds).
// Duplicated BY DESIGN: two packages independently pinned to the same frozen bytes — regenerate ONLY on a
// deliberate, chain-coordinated change of the commitment scheme. Ids are SHORT synthetic forms (the repo's
// chain-id gate sanction): bcs.Address left-pads them to the identical 32 bytes the vectors froze. ─────────
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
  mobs: [
    { template_id: TPL, rate_bp: 10000, min_group: 1, max_group: 3, level: 0 },
  ],
  resources: [],
})

const G64 = {
  world_id: '0xe0164',
  zx: 8,
  zy: 8,
  // The /v1 single-zone STATE form (views.js shape_zone): seed STRING (2^53 law), root a plain byte
  // array, live consumption bitmaps served alongside.
  doc: {
    zone_id: '8:8',
    zx: 8,
    zy: 8,
    discovered: true,
    discovered_at_ms: 1700000009000,
    seed: '9007199254740993',
    mob_bitmap: [],
    res_bitmap: [],
    group_root: [
      0xee, 0x2e, 0x1b, 0x02, 0x06, 0x15, 0x28, 0x69, 0xb9, 0xb0, 0x20, 0xfb,
      0xd6, 0xa2, 0x57, 0xa4, 0x2d, 0xfd, 0x5b, 0xb4, 0x22, 0x14, 0x19, 0xde,
      0xd8, 0xf5, 0xfe, 0x0b, 0x01, 0x05, 0x8e, 0xdc,
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
    zone_id: '3:4',
    zx: 3,
    zy: 4,
    discovered: true,
    discovered_at_ms: 1700000042000,
    seed: '424242',
    mob_bitmap: [],
    res_bitmap: [],
    group_root: [
      0x5e, 0x88, 0x92, 0x9f, 0x6a, 0x05, 0x5d, 0x7c, 0xbc, 0xce, 0xa3, 0xcb,
      0xf9, 0x08, 0xcb, 0x47, 0x68, 0xe1, 0xbf, 0x7b, 0x84, 0xd8, 0x0f, 0x0a,
      0xbb, 0xf0, 0x58, 0x18, 0x42, 0x91, 0xc4, 0x14,
    ],
    group_count: 5,
  },
  index: 4, // the odd tail — every tree level duplicates its last node under this path
  proof_hex:
    'de814766442d407153d63976510062f5f219c112ffbd585a39851c1c739b8917f37d91102e6209b80733d1cae14a2bb0' +
    '1f9723c429b835af4bdd0a81cfe26cec7679c9348f18943a6174f6bc9c8acb7c7760af18602ed5c9a371a8ade39bb8cd',
}

/** The /v1-consumer call shape: served doc + client-cached world doc + the injected sim derivation. */
const witness_of = (fixture, selector) =>
  mob_group_witness({
    world_id: fixture.world_id,
    zx: fixture.zx,
    zy: fixture.zy,
    zone: fixture.doc,
    world: world_doc(fixture.doc.group_count, fixture.doc.group_count),
    team_bound: 6,
    derive_zone,
    ...selector,
  })

describe('mob_group_witness — the /v1-ingredient witness producer', () => {
  test('G=64 by index: reproduces the frozen chain-accepted witness byte-exact (192B, 6 siblings)', () => {
    const witness = witness_of(G64, { index: G64.index })
    expect(witness).not.toBeNull()
    expect(witness.index).toBe(0)
    expect(witness.facts).toEqual(G64.facts)
    expect(witness.proof.length).toBe(192)
    expect(hex(witness.proof)).toBe(G64.proof_hex)
  })

  test('G=64 by spawn_id (+ template guard): the frontend click shape resolves to the same frozen bytes', () => {
    const witness = witness_of(G64, {
      spawn_id: G64.facts.spawn_id,
      mob_template_id: TPL,
    })
    expect(witness).not.toBeNull()
    expect(witness.index).toBe(0)
    expect(hex(witness.proof)).toBe(G64.proof_hex)
  })

  test('G=5 odd tail by index: the duplicate-last lane reproduces the frozen 96B witness', () => {
    const witness = witness_of(G5, { index: G5.index })
    expect(witness).not.toBeNull()
    expect(witness.index).toBe(4)
    expect(witness.proof.length).toBe(96)
    expect(hex(witness.proof)).toBe(G5.proof_hex)
  })

  test('door polarity: proof door ONLY under a stamped diet manifest; old door is the silent default', () => {
    // BOTH polarities (advisor pass-67): the manifest pin — ZONE_GROUP_ROOT_PACKAGE_ID — decides the door
    // at composition time; a witness never overrides an unstamped deployment (no try-new-fallback-old).
    const stamped = { network: 'testnet', ids: IDS }
    const unstamped = {
      network: 'testnet',
      ids: { aresrpg: { ...IDS.aresrpg, ZONE_GROUP_ROOT_PACKAGE_ID: '' } },
    }
    const base = {
      world_id: G64.world_id,
      kiosk_id: id('k0'),
      personal_kiosk_cap_id: id('pk0'),
      character_id: id('ca0'),
      spawn_id: G64.facts.spawn_id,
      zx: G64.zx,
      zy: G64.zy,
      mob_template_id: TPL,
    }
    const witness = witness_of(G64, { spawn_id: G64.facts.spawn_id })
    // stamped manifest + witness → the cheap proof door
    expect(
      targets(create_fight_ptb(stamped)({ ...base, group_proof: witness })),
    ).toEqual(['zones::claim_mob_group_in_zone_with_proof', 'fight::create'])
    // stamped manifest + unavailable ingredients (null witness) → the ORIGINAL door, never a broken create
    expect(
      targets(create_fight_ptb(stamped)({ ...base, group_proof: null })),
    ).toEqual(['zones::claim_mob_group_in_zone', 'fight::create'])
    // UNSTAMPED manifest: the same witness is IGNORED — old claim+create, BYTE-IDENTICAL to the null path
    const unstamped_with_witness = create_fight_ptb(unstamped)({
      ...base,
      group_proof: witness,
    })
    expect(targets(unstamped_with_witness)).toEqual([
      'zones::claim_mob_group_in_zone',
      'fight::create',
    ])
    expect(unstamped_with_witness.serialize()).toBe(
      create_fight_ptb(unstamped)({ ...base, group_proof: null }).serialize(),
    )
  })

  test('degrades to null (old door) on every missing /v1 ingredient', () => {
    const cases = [
      { zone: null }, // undiscovered zone (empty zones array)
      { zone: { ...G64.doc, seed: undefined } }, // pre-snapshot doc — not yet derivable
      { zone: { ...G64.doc, group_root: null } }, // pre-diet zone / snapshot lag
      { zone: { ...G64.doc, group_count: null } },
      { world: null }, // world doc not cached yet
    ]
    for (const override of cases)
      expect(
        mob_group_witness({
          world_id: G64.world_id,
          zx: G64.zx,
          zy: G64.zy,
          zone: G64.doc,
          world: world_doc(64, 64),
          team_bound: 6,
          derive_zone,
          index: 0,
          ...override,
        }),
      ).toBeNull()
  })

  test('fails shut: consumed target, unknown/dupe selector, template mismatch, tampered root → null', () => {
    // index 0 consumed on the SERVED live bitmap — the claim door could never take it.
    expect(
      witness_of(
        { ...G64, doc: { ...G64.doc, mob_bitmap: [0b1] } },
        { index: 0 },
      ),
    ).toBeNull()
    // an index outside the stream / a spawn_id nobody derived
    expect(witness_of(G64, { index: 64 })).toBeNull()
    expect(witness_of(G64, { spawn_id: '1' })).toBeNull()
    // the clicked template must match the derived truth (stale render guard)
    expect(
      witness_of(G64, {
        spawn_id: G64.facts.spawn_id,
        mob_template_id: id('mt0'),
      }),
    ).toBeNull()
    // index + spawn_id cross-check: both provided must name the SAME group
    expect(
      witness_of(G64, { index: 1, spawn_id: G64.facts.spawn_id }),
    ).toBeNull()
    // a tampered root can never compose (the composer replay-verifies and refuses)
    const tampered = [...G64.doc.group_root]
    tampered[31] ^= 1
    expect(
      witness_of(
        { ...G64, doc: { ...G64.doc, group_root: tampered } },
        { index: 0 },
      ),
    ).toBeNull()
    // a wrong world doc (wrong spawn tables → wrong leaves) refuses rather than emit a doomed proof
    expect(
      mob_group_witness({
        world_id: G64.world_id,
        zx: G64.zx,
        zy: G64.zy,
        zone: G64.doc,
        world: world_doc(5, 5),
        team_bound: 6,
        derive_zone,
        index: 0,
      }),
    ).toBeNull()
  })

  test('programmer errors are LOUD: missing derive_zone or missing selector throws, never silent-nulls', () => {
    expect(() =>
      mob_group_witness({
        world_id: G64.world_id,
        zx: G64.zx,
        zy: G64.zy,
        zone: G64.doc,
        world: world_doc(64, 64),
        index: 0,
      }),
    ).toThrow(/derive_zone/)
    expect(() =>
      mob_group_witness({
        world_id: G64.world_id,
        zx: G64.zx,
        zy: G64.zy,
        zone: G64.doc,
        world: world_doc(64, 64),
        derive_zone,
      }),
    ).toThrow(/index or spawn_id/)
  })
})
