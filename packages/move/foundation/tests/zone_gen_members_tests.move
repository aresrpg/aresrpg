// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// MEMBER-LIST DERIVATION (format 3, #1110/#1111) — the design ruling's named fixtures. The ruling's boss fence is
// the sharp edge: 9 boss rows sit in the live pick tables, so a naive per-member draw could mint multi-boss packs
// or a boss riding a chicklet group. Every assertion below is one clause of that fence, plus the identity law the
// whole format bump exists to protect: an in-flight (format-2) zone must keep deriving BYTE-FOR-BYTE.
//
// The zone geometry is the live 487:487 lattice used by `zone_gen_grid_tests` (same box, same bounds), so the
// placement half is already pinned to chain truth there and this file can concentrate on membership.
#[test_only]
module aresrpg_foundation::zone_gen_members_tests;

use aresrpg_foundation::zone_gen;

const SEED: u64 = 16076161905812157559;
const OX: u32 = 249344;
const OZ: u32 = 249344;
const ZSIZE: u32 = 512;
const BX: u32 = 500000;
const BZ: u32 = 500000;
const SIZE_BOUND: u64 = 6;
const BOSS_ROW: u16 = 2;

/// Five equal-rate rows — the ruled model's equal-spawn table (#1111), no rarity weighting. Row 2 is the world's
/// BOSS row. Every row rolls a 4-strong group, so each derived roster is 4 members long.
fun tables(): (vector<u64>, vector<u64>, vector<u64>, vector<u64>) {
  let weights = vector<u64>[100, 100, 100, 100, 100];
  // the member table = the pick table with every BOSS row zeroed (what `zone_comp` builds off the world's mask)
  let member_weights = vector<u64>[100, 100, 0, 100, 100];
  let min_group = vector<u64>[4, 4, 4, 4, 4];
  let max_group = vector<u64>[4, 4, 4, 4, 4];
  (weights, member_weights, min_group, max_group)
}

fun derive(member_weights: &vector<u64>): (vector<u64>, vector<vector<u16>>, vector<u16>) {
  let (weights, _mw, min_group, max_group) = tables();
  let (_ids, idxs, members, _xs, _zs, sizes, _gs) = zone_gen::derive_mob_groups_members(
    SEED, 8, 16, &weights, member_weights, &min_group, &max_group, SIZE_BOUND, OX, OZ, ZSIZE, BX, BZ,
  );
  (idxs, members, sizes)
}

/// `true` iff every member of `roster` is the same row.
fun single_spec(roster: &vector<u16>): bool {
  let mut i = 1;
  while (i < roster.length()) {
    if (roster[i] != roster[0]) return false;
    i = i + 1;
  };
  true
}

fun contains_row(roster: &vector<u16>, row: u16): bool {
  let mut i = 0;
  while (i < roster.length()) {
    if (roster[i] == row) return true;
    i = i + 1;
  };
  false
}

#[test]
/// FIXTURE ① — NO GROUP MIXES A BOSS ROW WITH ANYTHING. The content QA finding this fence exists for: a boss
/// must never ride along in a chicklet pack, and two bosses must never share one pack. Stated positively: a
/// roster that contains the boss row contains NOTHING else.
fun no_group_mixes_a_boss_with_another_row() {
  let (_weights, member_weights, _min, _max) = tables();
  let (_idxs, members, _sizes) = derive(&member_weights);
  assert!(!members.is_empty(), 0);
  let mut i = 0;
  while (i < members.length()) {
    let roster = &members[i];
    if (contains_row(roster, BOSS_ROW)) assert!(single_spec(roster), 1);
    i = i + 1;
  };
}

#[test]
/// FIXTURE ② — A PRIMARY-BOSS GROUP IS SINGLE-SPEC. The boss group keeps today's shape exactly: every member is
/// the boss's own row, at the boss's own authored band. At least one group must actually land on the boss row,
/// or the fixture proves nothing (a vacuous pass is a lying-green row).
fun a_primary_boss_group_stays_single_spec() {
  let (_weights, member_weights, _min, _max) = tables();
  let (idxs, members, _sizes) = derive(&member_weights);
  let mut boss_groups = 0;
  let mut i = 0;
  while (i < members.length()) {
    if (idxs[i] == (BOSS_ROW as u64)) {
      boss_groups = boss_groups + 1;
      assert!(single_spec(&members[i]), 1);
      assert!(members[i][0] == BOSS_ROW, 2);
    };
    i = i + 1;
  };
  assert!(boss_groups > 0, 0); // the table is 5 equal rows over 8-16 groups — a boss primary is near-certain
}

#[test]
/// FIXTURE ④ — A MIXED GROUP IS POSSIBLE ON A NON-BOSS DRAW. The whole point of the wave (#1110): with a
/// non-boss primary, the pack draws its remaining members from the eligible non-boss pool, so at least one
/// derived group holds two different species. Without this the fence would be indistinguishable from "never mix".
fun a_non_boss_primary_can_draw_a_mixed_pack() {
  let (_weights, member_weights, _min, _max) = tables();
  let (_idxs, members, _sizes) = derive(&member_weights);
  let mut mixed = 0;
  let mut i = 0;
  while (i < members.length()) {
    if (!single_spec(&members[i])) mixed = mixed + 1;
    i = i + 1;
  };
  assert!(mixed > 0, 0);
}

#[test]
/// FIXTURE ③ — A MASK-ABSENT WORLD DEGRADES SAFELY. An absent `boss_mask` dynamic field reads as an EMPTY index
/// vector, so the member table is the pick table unchanged (the uniform degradation path). The derivation must
/// still produce well-formed rosters — one entry per rolled unit, every entry a real row of the table, the
/// primary first — and must never abort. It is also what a world whose bosses are all dungeon-only looks like.
fun a_mask_absent_world_derives_well_formed_rosters() {
  let (weights, _mw, _min, _max) = tables();
  let (idxs, members, sizes) = derive(&weights); // member table == pick table: nothing is marked a boss
  assert!(!members.is_empty(), 0);
  let mut i = 0;
  while (i < members.length()) {
    let roster = &members[i];
    assert!(roster.length() == 4, 1); // the rolled band is a flat 4 — the roster is the RAW roll, never the clamp
    assert!(sizes[i] == 4, 2); // and the size bound (6) leaves it untouched
    assert!((roster[0] as u64) == idxs[i], 3); // members[0] IS the primary
    let mut j = 0;
    while (j < roster.length()) {
      assert!((roster[j] as u64) < weights.length(), 4);
      j = j + 1;
    };
    i = i + 1;
  };
}

#[test]
/// A MEMBER LIST IS NEVER TRUNCATED BY THE LIVE ENGINE BOUND. `sizes` clamps to the caller's team bound, but the
/// roster and the whole draw stream must not — otherwise `zones_view` (which derives with bound 1 to read ids)
/// and the claim door (which derives with the live bound) would disagree about every spawn id in the zone.
fun the_stream_is_independent_of_the_team_bound() {
  let (weights, member_weights, min_group, max_group) = tables();
  let (ids_a, idxs_a, members_a, xs_a, _zs, sizes_a, _gs) = zone_gen::derive_mob_groups_members(
    SEED, 8, 16, &weights, &member_weights, &min_group, &max_group, 1, OX, OZ, ZSIZE, BX, BZ,
  );
  let (ids_b, idxs_b, members_b, xs_b, _zs2, sizes_b, _gs2) = zone_gen::derive_mob_groups_members(
    SEED, 8, 16, &weights, &member_weights, &min_group, &max_group, 6, OX, OZ, ZSIZE, BX, BZ,
  );
  assert!(ids_a == ids_b, 0);
  assert!(idxs_a == idxs_b, 1);
  assert!(members_a == members_b, 2);
  assert!(xs_a == xs_b, 3);
  assert!(sizes_a[0] == 1 && sizes_b[0] == 4, 4); // only the CLAMP moved
}

#[test]
/// FIXTURE ⑥ — FORMAT-2 BYTE IDENTITY. The wave's most dangerous failure mode is silent: a draw-order change
/// inside the OLD paths re-derives every in-flight zone into fiction (every spawn id becomes unclaimable). This
/// pins the format-2 lattice stream on the same tables the member derivation uses, so any edit that leaks into
/// the shared primitives (`p_pick_weighted`, `p_roll_u64`, `p_pick_grid_pos`) fails HERE, not on chain.
/// The live-chain vectors in `zone_gen_grid_tests` are the second, independent half of this proof.
fun format_2_derivation_is_byte_identical() {
  let (weights, _mw, min_group, max_group) = tables();
  let (ids, idxs, xs, zs, sizes, gseeds) = zone_gen::derive_mob_groups_grid(
    SEED, 8, 16, &weights, &min_group, &max_group, SIZE_BOUND, OX, OZ, ZSIZE, BX, BZ,
  );
  assert!(ids == vector<u64>[
    3786384621367390285, 14303406521639674587, 5210785996690010018, 9055932198808986744,
    14858966446792429895, 10966300328458190410, 3459657329614647695, 10597610377060817547,
    6557598006215965886, 4349760583260888982, 11078977046736900853,
  ], 0);
  assert!(idxs == vector<u64>[3, 4, 1, 1, 4, 1, 0, 2, 3, 2, 0], 1);
  assert!(xs == vector<u32>[
    249607, 249405, 249529, 249359, 249644, 249451, 249797, 249717, 249678, 249399, 249795,
  ], 2);
  assert!(zs == vector<u32>[
    249805, 249720, 249755, 249522, 249805, 249638, 249650, 249409, 249770, 249686, 249684,
  ], 3);
  let mut i = 0;
  while (i < sizes.length()) { assert!(sizes[i] == 4, 4); i = i + 1; };
  assert!(gseeds.length() == ids.length(), 5);
}

#[test]
/// TWIN PARITY — the JS mirror's rows, row for row. Every number here also lives in
/// `packages/sim/test/fixtures/replay/zone_members_format3_parity.json`, which
/// `packages/sim/test/zone_members_parity.test.js` asserts on the client side: ONE fixture, both twins, neither
/// checking itself. A mixed pack the map draws that the chain does not seat is the whole failure mode this
/// derivation can have, and it is silent — the fight simply spawns a different world than the player was shown.
fun the_member_stream_matches_the_js_mirror() {
  let (weights, member_weights, min_group, max_group) = tables();
  let (ids, idxs, members, xs, zs, sizes, gseeds) = zone_gen::derive_mob_groups_members(
    SEED, 8, 16, &weights, &member_weights, &min_group, &max_group, SIZE_BOUND, OX, OZ, ZSIZE, BX, BZ,
  );
  assert!(ids == vector<u64>[
    3786384621367390285, 9997039409087500615, 6514587898257154650, 9476135193594931962,
    18079486600054645577, 13332129928644417017, 5059802549243133926, 6287833867785998722,
    15093131309284661592, 2308627228473291405, 2133959765632640338,
  ], 0);
  assert!(idxs == vector<u64>[3, 0, 0, 2, 4, 2, 4, 2, 1, 0, 0], 1);
  assert!(members == vector<vector<u16>>[
    vector[3, 3, 3, 3], vector[0, 0, 4, 3], vector[0, 3, 4, 4], vector[2, 2, 2, 2],
    vector[4, 1, 4, 1], vector[2, 2, 2, 2], vector[4, 1, 1, 0], vector[2, 2, 2, 2],
    vector[1, 3, 1, 1], vector[0, 1, 0, 0], vector[0, 4, 1, 1],
  ], 2);
  assert!(xs == vector<u32>[
    249607, 249451, 249483, 249450, 249362, 249476, 249475, 249806, 249604, 249484, 249367,
  ], 3);
  assert!(zs == vector<u32>[
    249805, 249724, 249679, 249636, 249763, 249769, 249404, 249648, 249397, 249454, 249732,
  ], 4);
  assert!(gseeds == vector<u64>[
    3839885020, 921252135, 4203116114, 3598897479, 4194303562, 668584164, 2926397485, 1012757556,
    2579525356, 381898037, 541510641,
  ], 5);
  let mut i = 0;
  while (i < sizes.length()) { assert!(sizes[i] == 4, 6); i = i + 1; };
  // and the FIRST group's id is the format-2 id at the same index — the primary draw kept its stream position
  assert!(ids[0] == 3786384621367390285, 7);
}

#[test]
/// The format-3 COMMITMENT is a distinct, self-describing value: its own tag byte, its own dispatch, and it
/// BINDS the roster — swap one member for a softer species and the commitment stops matching.
fun the_member_commitment_binds_the_roster() {
  let (weights, member_weights, min_group, max_group) = tables();
  let (ids, idxs, members, xs, zs, sizes, gseeds) = zone_gen::derive_mob_groups_members(
    SEED, 8, 16, &weights, &member_weights, &min_group, &max_group, SIZE_BOUND, OX, OZ, ZSIZE, BX, BZ,
  );
  let world = object::id_from_address(@0xbe3f36264b09c95e86491a9f0c1bcb744071d0bcc4176f0b7e2e60a22f115e1c);
  let rows = vector<ID>[
    object::id_from_address(@0x01), object::id_from_address(@0x02), object::id_from_address(@0x03),
    object::id_from_address(@0x04), object::id_from_address(@0x05),
  ];
  let mut templates = vector<ID>[];
  let mut member_templates = vector<vector<ID>>[];
  let mut i = 0;
  while (i < ids.length()) {
    templates.push_back(rows[idxs[i]]);
    let mut mt = vector<ID>[];
    let mut j = 0;
    while (j < members[i].length()) { mt.push_back(rows[members[i][j] as u64]); j = j + 1; };
    member_templates.push_back(mt);
    i = i + 1;
  };
  let got = zone_gen::mob_group_commitment_members(
    world, 487, 487, SEED, 1784980009967, &ids, &templates, &member_templates, &xs, &zs, &sizes, &gseeds,
  );
  assert!(zone_gen::mob_group_commitment_format(&got) == 3, 0);
  assert!(zone_gen::mob_group_commitment_members_matches(
    &got, world, 487, 487, SEED, 1784980009967, &ids, &templates, &member_templates, &xs, &zs, &sizes, &gseeds,
  ), 1);
  // sad path first: one member swapped ⇒ the commitment must refuse
  let swapped = *member_templates[0].borrow(1);
  let replacement = if (swapped == rows[0]) rows[1] else rows[0];
  *member_templates[0].borrow_mut(1) = replacement;
  assert!(!zone_gen::mob_group_commitment_members_matches(
    &got, world, 487, 487, SEED, 1784980009967, &ids, &templates, &member_templates, &xs, &zs, &sizes, &gseeds,
  ), 2);
  // and a format-2 commitment is NOT a format-3 one — the dispatch never falls back across formats
  let f2 = zone_gen::mob_group_commitment(
    world, 487, 487, SEED, 1784980009967, &ids, &templates, &xs, &zs, &sizes, &gseeds,
  );
  assert!(zone_gen::mob_group_commitment_format(&f2) == 2, 3);
  assert!(!zone_gen::mob_group_commitment_members_matches(
    &f2, world, 487, 487, SEED, 1784980009967, &ids, &templates, &member_templates, &xs, &zs, &sizes, &gseeds,
  ), 4);
}
