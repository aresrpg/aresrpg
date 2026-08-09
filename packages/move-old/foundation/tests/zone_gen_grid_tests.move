// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// LATTICE DERIVATION — pinned to LIVE CHAIN TRUTH, not to a second copy of our own model. Every number below is
// zone 487:487 of the live testnet world as the deployed package reports it, captured 2026-07-25 and stored in
// `packages/sim/test/fixtures/zone_487_chain_truth.json` (world
// 0xbe3f36264b09c95e86491a9f0c1bcb744071d0bcc4176f0b7e2e60a22f115e1c, package origin
// 0x045fdf6f7d05914335288d6acac90b6a0023395968b9b38fd6fdcc0c7180adc9, read via SimulateTransaction over
// `zones_view`). The JS twin (`packages/sim/src/zone_derive.js`) asserts the SAME rows in
// `packages/sim/test/zone_chain_parity.test.js` — twin fixture, both sides, one truth.
//
// The kernel inputs here are the §4 pipeline's OUTPUT for that zone (progress 0 → level cap 3 → one eligible
// mob row of weight 8000, size cap 2), so this file pins the kernel; `zone_comp` pins the pipeline that feeds it.
#[test_only]
module aresrpg_foundation::zone_gen_grid_tests;

use aresrpg_foundation::zone_gen;
use sui::object;

const SEED: u64 = 16076161905812157559;
const OX: u32 = 249344;
const OZ: u32 = 249344;
const ZSIZE: u32 = 512;
const BX: u32 = 500000;
const BZ: u32 = 500000;
const SIZE_BOUND: u64 = 2;
const DISCOVERED_AT_MS: u64 = 1784980009967;

/// The zone's eligible mob weights / group bands — 13 authored rows, only row 1 under the distance level cap.
fun mob_tables(): (vector<u64>, vector<u64>, vector<u64>) {
  let weights = vector<u64>[
    0, 8000, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0
  ];
  let min_group = vector<u64>[
    2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2
  ];
  let max_group = vector<u64>[
    3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3
  ];
  (weights, min_group, max_group)
}

/// The zone's resource table — three gather rows (FARMER / HERBALIST / MINER), all rate 9000.
fun res_tables(): (vector<u64>, vector<u64>, vector<u64>, vector<u8>) {
  let weights = vector<u64>[
    9000, 9000, 9000
  ];
  let min_qty = vector<u64>[
    10, 4, 2
  ];
  let max_qty = vector<u64>[
    20, 8, 4
  ];
  let jobs = vector<u8>[
    0, 1, 2
  ];
  (weights, min_qty, max_qty, jobs)
}

#[test]
/// The 56 spawn ids the chain committed, in stream order — the mob-bitmap bit index and the claim door's scan
/// order. An id at the wrong index is as fatal as a missing one: the chain scans ITS list for the id we name.
fun grid_mob_stream_matches_chain_truth() {
  let (weights, min_group, max_group) = mob_tables();
  let want_ids = vector<u64>[
    9483156179699600152, 3956747793522794080, 15712696867173293924, 17164133525421668382, 17734715892265347531,
    16717748575114832898, 10597610377060817547, 11263499087509702832, 11533174949868818775, 14769273445014229030,
    2308627228473291405, 15372486481835117553, 7450599555184445850, 5157450651353377093, 4342232277918087955,
    12180663767956476493, 16342695157413170768, 16123577614681289364, 2815668929994256523, 10383472789507226224,
    1310373993043663299, 4182957782296108420, 14369617656583931374, 1447039819242308283, 11586568831637676708,
    3918450749518300127, 12509037454869368898, 11927643954766135549, 5614322156601917414, 3758447193627207877,
    16579078640198656063, 13583416734949622317, 3925831448591650734, 17923868208369947998, 16180815752135326521,
    9815596324010499525, 18207139346505718543, 17954592270587125381, 15659779727741614751, 4683230473891578611,
    12983718588699156427, 1961551753736192676, 842952419278074399, 631115553060599450, 801097593051132484,
    2262818648959485850, 7898408916553514933, 3826906193829946358, 10242654154304706998, 11619171767743055430,
    15205745322365917126, 1423577371038342702, 3688583933955578509, 13308345270818536226, 4734307666840426224,
    17865526105560969621
  ];
  let want_x = vector<u32>[
    249645, 249727, 249803, 249447, 249795, 249399, 249717, 249490, 249528, 249730, 249364, 249759, 249727,
    249652, 249366, 249799, 249691, 249634, 249364, 249363, 249760, 249653, 249798, 249733, 249474, 249357,
    249355, 249685, 249527, 249478, 249397, 249572, 249407, 249678, 249355, 249805, 249649, 249360, 249401,
    249413, 249516, 249810, 249560, 249514, 249483, 249772, 249362, 249453, 249800, 249556, 249685, 249410,
    249765, 249692, 249562, 249363
  ];
  let want_z = vector<u32>[
    249487, 249411, 249442, 249364, 249599, 249357, 249449, 249650, 249520, 249366, 249654, 249491, 249685,
    249611, 249764, 249686, 249555, 249442, 249681, 249801, 249407, 249682, 249520, 249651, 249358, 249733,
    249573, 249803, 249762, 249481, 249601, 249479, 249809, 249358, 249438, 249481, 249769, 249354, 249692,
    249442, 249634, 249719, 249603, 249813, 249435, 249573, 249487, 249674, 249642, 249356, 249449, 249395,
    249530, 249763, 249732, 249398
  ];
  let (ids, idxs, xs, zs, sizes, _gseeds) = zone_gen::derive_mob_groups_grid(
    SEED, 48, 64, &weights, &min_group, &max_group, SIZE_BOUND, OX, OZ, ZSIZE, BX, BZ,
  );
  assert!(ids.length() == 56, 0);
  assert!(ids == want_ids, 1);
  assert!(xs == want_x, 2);
  assert!(zs == want_z, 3);
  let mut i = 0;
  while (i < 56) {
    assert!(idxs[i] == 1, 4); // the only row under the level cap
    assert!(sizes[i] == 2, 5); // clamped to the distance size cap
    i = i + 1;
  };
}

#[test]
/// The 36 resource cells the chain committed, in stream order — the res-bitmap index the gather door keys on.
fun grid_resource_stream_matches_chain_truth() {
  let (weights, min_qty, max_qty, jobs) = res_tables();
  let want_x = vector<u32>[
    249573, 249574, 249573, 249573, 249573, 249572, 249573, 249574, 249574, 249575, 249573, 249572, 249572,
    249573, 249572, 249572, 249571, 249570, 249648, 249648, 249649, 249647, 249646, 249646, 249645, 249645,
    249645, 249644, 249645, 249644, 249644, 249647, 249650, 249650, 249645, 249645
  ];
  let want_z = vector<u32>[
    249357, 249357, 249356, 249355, 249354, 249354, 249353, 249353, 249354, 249354, 249352, 249352, 249351,
    249351, 249350, 249349, 249349, 249349, 249760, 249759, 249759, 249759, 249759, 249760, 249759, 249758,
    249757, 249757, 249756, 249756, 249755, 249760, 249759, 249758, 249755, 249754
  ];
  let (ids, idxs, xs, zs) = zone_gen::derive_resources_grid(
    SEED, 24, 42, &weights, &min_qty, &max_qty, &jobs, OX, OZ, ZSIZE, BX, BZ,
  );
  assert!(ids.length() == 36, 0);
  assert!(xs == want_x, 1);
  assert!(zs == want_z, 2);
  let mut i = 0;
  while (i < 36) { assert!(idxs[i] == 0, 3); i = i + 1; };
}

#[test]
/// The LIVE `ZoneGroupCommitment.root` byte-for-byte: `0x02 ‖ blake2b256(domain ‖ 0x02 ‖ bcs(MobGroupSet))`.
/// This is the strongest single assertion in the file — it pins the domain string, the format tag, the BCS field
/// order of both structs AND all 56 derived rows at once. If the commitment layout drifts by one byte, every
/// proof-taking claim against a live zone stops authenticating.
fun grid_commitment_matches_the_live_stored_root() {
  let (weights, min_group, max_group) = mob_tables();
  let (ids, idxs, xs, zs, sizes, gseeds) = zone_gen::derive_mob_groups_grid(
    SEED, 48, 64, &weights, &min_group, &max_group, SIZE_BOUND, OX, OZ, ZSIZE, BX, BZ,
  );
  let world = object::id_from_address(@0xbe3f36264b09c95e86491a9f0c1bcb744071d0bcc4176f0b7e2e60a22f115e1c);
  let template = object::id_from_address(@0x4a00a579a3ae4592310219ec550fba0c97ea0171a2bcdf38caa41b7aecdcbe97);
  let mut templates = vector<ID>[];
  let mut i = 0;
  while (i < idxs.length()) { templates.push_back(template); i = i + 1; };
  let got = zone_gen::mob_group_commitment(
    world, 487, 487, SEED, DISCOVERED_AT_MS, &ids, &templates, &xs, &zs, &sizes, &gseeds,
  );
  assert!(got == x"023a1b46c7193310c14872557986a477364fe5dc1257acfab3f9395fd3aa3c805e", 0);
  assert!(zone_gen::mob_group_commitment_format(&got) == 2, 1);
  assert!(zone_gen::mob_group_commitment_matches(
    &got, world, 487, 487, SEED, DISCOVERED_AT_MS, &ids, &templates, &xs, &zs, &sizes, &gseeds,
  ), 2);
}

#[test]
/// The commitment is BINDING: change one derived fact and it stops matching. (Sad path first — a commitment that
/// accepts a mutated set is worse than no commitment.)
fun grid_commitment_rejects_a_mutated_set() {
  let (weights, min_group, max_group) = mob_tables();
  let (ids, idxs, xs, mut zs, sizes, gseeds) = zone_gen::derive_mob_groups_grid(
    SEED, 48, 64, &weights, &min_group, &max_group, SIZE_BOUND, OX, OZ, ZSIZE, BX, BZ,
  );
  let world = object::id_from_address(@0xbe3f36264b09c95e86491a9f0c1bcb744071d0bcc4176f0b7e2e60a22f115e1c);
  let template = object::id_from_address(@0x4a00a579a3ae4592310219ec550fba0c97ea0171a2bcdf38caa41b7aecdcbe97);
  let mut templates = vector<ID>[];
  let mut i = 0;
  while (i < idxs.length()) { templates.push_back(template); i = i + 1; };
  let root = x"023a1b46c7193310c14872557986a477364fe5dc1257acfab3f9395fd3aa3c805e";
  *(&mut zs[7]) = zs[7] + 1;
  assert!(!zone_gen::mob_group_commitment_matches(
    &root, world, 487, 487, SEED, DISCOVERED_AT_MS, &ids, &templates, &xs, &zs, &sizes, &gseeds,
  ), 0);
}

#[test]
/// Format dispatch: a bare 32-byte digest is legacy(1), `0x02 ‖ digest` is lattice(2), anything else is 0 — and
/// a legacy root never authenticates through the commitment door.
fun commitment_format_reads_the_stored_bytes() {
  let legacy = x"3a1b46c7193310c14872557986a477364fe5dc1257acfab3f9395fd3aa3c805e";
  assert!(zone_gen::mob_group_commitment_format(&legacy) == 1, 0);
  assert!(zone_gen::mob_group_commitment_format(&x"023a1b46c7193310c14872557986a477364fe5dc1257acfab3f9395fd3aa3c805e") == 2, 1);
  assert!(zone_gen::mob_group_commitment_format(&b"short") == 0, 2);
  let mut wrong_tag = x"023a1b46c7193310c14872557986a477364fe5dc1257acfab3f9395fd3aa3c805e";
  *(&mut wrong_tag[0]) = 1;
  assert!(zone_gen::mob_group_commitment_format(&wrong_tag) == 0, 3);
}

#[test]
/// The lattice guarantee the rejection loop used to pay 64 attempts for: one spawn per 40×40 cell, jittered into
/// the middle 21 blocks, so EVERY pair is ≥ 20 blocks apart by construction. Asserted over all 1540 live pairs.
fun grid_spacing_holds_by_construction() {
  let (weights, min_group, max_group) = mob_tables();
  let (_ids, _idxs, xs, zs, _sizes, _gseeds) = zone_gen::derive_mob_groups_grid(
    SEED, 48, 64, &weights, &min_group, &max_group, SIZE_BOUND, OX, OZ, ZSIZE, BX, BZ,
  );
  let n = xs.length();
  let mut i = 0;
  while (i < n) {
    let mut j = i + 1;
    while (j < n) {
      let dx = if (xs[i] > xs[j]) xs[i] - xs[j] else xs[j] - xs[i];
      let dz = if (zs[i] > zs[j]) zs[i] - zs[j] else zs[j] - zs[i];
      assert!((dx as u64) * (dx as u64) + (dz as u64) * (dz as u64) >= 400, 0);
      j = j + 1;
    };
    i = i + 1;
  };
}

#[test]
/// The lattice CAPS the count: a zone with fewer cells than the rolled group target hosts one group per cell,
/// and the last cell costs no selection draw (`p_roll_u64` skips when `lo >= hi`) — the pool is exhausted, never
/// over-drawn. A 120-block zone dices into 3×3 = 9 cells.
fun grid_pool_caps_the_group_count() {
  let (weights, min_group, max_group) = mob_tables();
  let (ids, _idxs, xs, zs, _sizes, _gseeds) = zone_gen::derive_mob_groups_grid(
    SEED, 48, 64, &weights, &min_group, &max_group, SIZE_BOUND, 0, 0, 120, 100000, 100000,
  );
  assert!(ids.length() == 9, 0);
  let mut i = 0;
  while (i < 9) {
    assert!(xs[i] < 120 && zs[i] < 120, 1); // every spawn inside the zone box
    i = i + 1;
  };
}

#[test]
/// A zone smaller than one lattice cell has NO cells, so it hosts nothing at all — the degenerate edge the
/// pool's `max(span, 0) / 40` floor produces. Both streams agree.
fun grid_zone_smaller_than_a_cell_is_empty() {
  let (weights, min_group, max_group) = mob_tables();
  let (ids, _i, _x, _z, _s, _g) = zone_gen::derive_mob_groups_grid(
    SEED, 48, 64, &weights, &min_group, &max_group, SIZE_BOUND, 0, 0, 39, 100000, 100000,
  );
  assert!(ids.is_empty(), 0);
  let (rw, min_qty, max_qty, jobs) = res_tables();
  let (rids, _ri, _rx, _rz) = zone_gen::derive_resources_grid(
    SEED, 24, 42, &rw, &min_qty, &max_qty, &jobs, 0, 0, 39, 100000, 100000,
  );
  assert!(rids.is_empty(), 1);
}

#[test]
/// The LEGACY kernel is untouched by this port: the same inputs still produce the spaced-sampler stream, and it
/// is a DIFFERENT world from the lattice one. Format-1 zones keep deriving exactly as they always did.
fun legacy_kernel_is_unchanged_and_distinct() {
  let (weights, min_group, max_group) = mob_tables();
  let (legacy_ids, _a, legacy_x, _b, _c, _d) = zone_gen::derive_mob_groups(
    SEED, 48, 64, &weights, &min_group, &max_group, SIZE_BOUND, OX, OZ, ZSIZE, BX, BZ,
  );
  let (grid_ids, _e, grid_x, _f, _g, _h) = zone_gen::derive_mob_groups_grid(
    SEED, 48, 64, &weights, &min_group, &max_group, SIZE_BOUND, OX, OZ, ZSIZE, BX, BZ,
  );
  assert!(legacy_ids != grid_ids, 0);
  assert!(legacy_x != grid_x, 1);
}
