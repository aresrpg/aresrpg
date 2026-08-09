// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// ZONE-DERIVATION GOLDEN VECTORS — behavior identity across the ceremony leg-2 twins-collapse.
///
/// `claim_members_at_zone` / `find_member_group` / `y72` were near-duplicates of the
/// format-1/2 functions and were collapsed into them, format-gated by PARAMETER. The bodies changed
/// legally (all three are private or `public(package)` — outside the compatibility surface), so the only
/// thing that can prove the collapse safe is the OUTPUT.
///
/// These vectors were captured BEFORE the collapse and are asserted byte-identical AFTER it. The
/// format-1/2 hashes are the load-bearing ones: in-flight zones replay that derivation, so any drift
/// there re-derives every live zone into fiction. The format-3 hash pins the ruled model's own stream.
///
/// Each hash folds the COMPLETE output of a derivation — every spawn id, template id, coordinate, size,
/// group seed, roster member and progress value — over a sweep of zones × seeds × team bounds. A single
/// changed byte anywhere in any of those vectors moves the hash.
#[test_only]
module aresrpg::zone_derivation_golden_tests;

use aresrpg::{admin::{Self, AdminCap}, version::{Self, Version}, world::{Self, World}, zone_comp};
use std::unit_test::assert_eq;
use sui::test_scenario::{Self as ts, Scenario};

const OWNER: address = @0xA;
const SEED: u64 = 16076161905812157559;

/// Fold modulus — a Mersenne prime under 2^31 so `acc * MUL + v % P` can never overflow u64 (Move
/// arithmetic aborts on overflow; it does not wrap).
const P: u64 = 2147483647;
const MUL: u64 = 131;

fun fold(acc: u64, v: u64): u64 { (acc * MUL + (v % P)) % P }

fun fold_id(acc: u64, id: ID): u64 {
  let bytes = object::id_to_bytes(&id);
  let mut a = acc;
  let mut i = 0;
  while (i < bytes.length()) { a = fold(a, bytes[i] as u64); i = i + 1; };
  a
}

fun fold_u64s(acc: u64, v: &vector<u64>): u64 {
  let mut a = fold(acc, v.length());
  let mut i = 0;
  while (i < v.length()) { a = fold(a, v[i]); i = i + 1; };
  a
}

fun fold_u32s(acc: u64, v: &vector<u32>): u64 {
  let mut a = fold(acc, v.length());
  let mut i = 0;
  while (i < v.length()) { a = fold(a, v[i] as u64); i = i + 1; };
  a
}

fun fold_u16s(acc: u64, v: &vector<u16>): u64 {
  let mut a = fold(acc, v.length());
  let mut i = 0;
  while (i < v.length()) { a = fold(a, v[i] as u64); i = i + 1; };
  a
}

fun fold_u8s(acc: u64, v: &vector<u8>): u64 {
  let mut a = fold(acc, v.length());
  let mut i = 0;
  while (i < v.length()) { a = fold(a, v[i] as u64); i = i + 1; };
  a
}

fun fold_ids(acc: u64, v: &vector<ID>): u64 {
  let mut a = fold(acc, v.length());
  let mut i = 0;
  while (i < v.length()) { a = fold_id(a, v[i]); i = i + 1; };
  a
}

fun fold_id_rows(acc: u64, v: &vector<vector<ID>>): u64 {
  let mut a = fold(acc, v.length());
  let mut i = 0;
  while (i < v.length()) { a = fold_ids(a, &v[i]); i = i + 1; };
  a
}

fun boot(sc: &mut Scenario) {
  version::test_init(sc.ctx());
  admin::test_init(sc.ctx());
}

/// A world with a three-row mob roster at distinct eligibility levels (so the legacy level cap actually
/// bites at close range and relaxes far out) and a two-row resource table.
fun make(sc: &mut Scenario, boss_mask: vector<u16>) {
  sc.next_tx(OWNER);
  let cap = sc.take_from_sender<AdminCap>();
  let ver = sc.take_shared<Version>();
  world::create_world(&cap, &ver, SEED, b"verdant".to_string(), sc.ctx());
  ts::return_shared(ver);
  sc.return_to_sender(cap);

  sc.next_tx(OWNER);
  let cap = sc.take_from_sender<AdminCap>();
  let ver = sc.take_shared<Version>();
  let mut w = sc.take_shared<World>();
  let chicklet = object::id_from_address(@0xC1);
  let mid = object::id_from_address(@0xC2);
  let boss = object::id_from_address(@0xC3);
  world::add_mob_entry(&cap, &mut w, chicklet, 100, 2, 5, &ver, sc.ctx());
  world::add_mob_entry(&cap, &mut w, mid, 250, 3, 4, &ver, sc.ctx());
  world::add_mob_entry(&cap, &mut w, boss, 75, 4, 4, &ver, sc.ctx());
  world::set_mob_level(&cap, &mut w, chicklet, 3, &ver, sc.ctx());
  world::set_mob_level(&cap, &mut w, mid, 50, &ver, sc.ctx());
  world::set_mob_level(&cap, &mut w, boss, 120, &ver, sc.ctx());
  world::add_resource_entry(&cap, &mut w, object::id_from_address(@0xD1), 100, 1, 3, 0, 1, &ver, sc.ctx());
  world::add_resource_entry(&cap, &mut w, object::id_from_address(@0xD2), 200, 2, 2, 1, 2, &ver, sc.ctx());
  world::set_density(&cap, &mut w, 6, 24, 3, 9, &ver, sc.ctx());
  if (!boss_mask.is_empty()) world::set_boss_mask(&cap, &mut w, boss_mask, &ver, sc.ctx());
  ts::return_shared(w); ts::return_shared(ver); sc.return_to_sender(cap);
}

/// The sweep every hash runs over: zones spanning the spawn box, the mid ring and past the authored edge,
/// crossed with three seeds and three team bounds.
fun zones(): vector<u32> { vector[487, 493, 500, 512] }
fun seeds(): vector<u64> { vector[SEED, 1, 18446744073709551615] }
fun bounds(): vector<u64> { vector[1, 4, 6] }

fun sweep_mobs(w: &World, grid: bool): u64 {
  let (zs, ss, bs) = (zones(), seeds(), bounds());
  let mut acc = 0u64;
  let mut a = 0;
  while (a < zs.length()) {
    let mut b = 0;
    while (b < ss.length()) {
      let mut c = 0;
      while (c < bs.length()) {
        let (sids, tpls, xs, zzs, sizes, gseeds) = if (grid) {
          zone_comp::y71(w, zs[a], zs[a], ss[b], bs[c])
        } else {
          zone_comp::derive_mobs(w, zs[a], zs[a], ss[b], bs[c])
        };
        acc = fold_u64s(acc, &sids);
        acc = fold_ids(acc, &tpls);
        acc = fold_u32s(acc, &xs);
        acc = fold_u32s(acc, &zzs);
        acc = fold_u16s(acc, &sizes);
        acc = fold_u64s(acc, &gseeds);
        c = c + 1;
      };
      b = b + 1;
    };
    a = a + 1;
  };
  acc
}

fun sweep_res(w: &World, grid: bool): u64 {
  let (zs, ss) = (zones(), seeds());
  let mut acc = 0u64;
  let mut a = 0;
  while (a < zs.length()) {
    let mut b = 0;
    while (b < ss.length()) {
      let (sids, tpls, xs, zzs, jobs, tiers) = zone_comp::derive_res(w, zs[a], zs[a], ss[b], grid);
      acc = fold_u64s(acc, &sids);
      acc = fold_ids(acc, &tpls);
      acc = fold_u32s(acc, &xs);
      acc = fold_u32s(acc, &zzs);
      acc = fold_u8s(acc, &jobs);
      acc = fold_u8s(acc, &tiers);
      b = b + 1;
    };
    a = a + 1;
  };
  acc
}

fun sweep_members(w: &World): u64 {
  let (zs, ss, bs) = (zones(), seeds(), bounds());
  let mut acc = 0u64;
  let mut a = 0;
  while (a < zs.length()) {
    let mut b = 0;
    while (b < ss.length()) {
      let mut c = 0;
      while (c < bs.length()) {
        let (sids, tpls, members, xs, zzs, sizes, gseeds, progress) =
          zone_comp::y72(w, zs[a], zs[a], ss[b], bs[c]);
        acc = fold_u64s(acc, &sids);
        acc = fold_ids(acc, &tpls);
        acc = fold_id_rows(acc, &members);
        acc = fold_u32s(acc, &xs);
        acc = fold_u32s(acc, &zzs);
        acc = fold_u16s(acc, &sizes);
        acc = fold_u64s(acc, &gseeds);
        acc = fold(acc, progress);
        c = c + 1;
      };
      b = b + 1;
    };
    a = a + 1;
  };
  acc
}

// ── The pinned vectors. Captured 2026-07-27 on the PRE-collapse tree (commit 078211e6). ──
const GOLDEN_MOBS_STREAM: u64 = 821012158;
const GOLDEN_MOBS_GRID: u64 = 365082555;
const GOLDEN_RES_STREAM: u64 = 456134711;
const GOLDEN_RES_GRID: u64 = 1611368815;
const GOLDEN_MEMBERS_NO_MASK: u64 = 101554010;
const GOLDEN_MEMBERS_MASKED: u64 = 866799028;

#[test]
/// FORMAT 1/2 — the published derivation. This hash may never move: every in-flight zone replays it.
fun format_1_2_derivation_is_byte_identical() {
  let mut sc = ts::begin(OWNER);
  boot(&mut sc);
  make(&mut sc, vector[]);
  sc.next_tx(OWNER);
  let w = sc.take_shared<World>();
  assert_eq!(sweep_mobs(&w, false), GOLDEN_MOBS_STREAM);
  assert_eq!(sweep_mobs(&w, true), GOLDEN_MOBS_GRID);
  assert_eq!(sweep_res(&w, false), GOLDEN_RES_STREAM);
  assert_eq!(sweep_res(&w, true), GOLDEN_RES_GRID);
  ts::return_shared(w);
  sc.end();
}

#[test]
/// FORMAT 3 — the ruled model's own stream, with and without a boss mask.
fun format_3_derivation_is_byte_identical() {
  let mut sc = ts::begin(OWNER);
  boot(&mut sc);
  make(&mut sc, vector[]);
  sc.next_tx(OWNER);
  let w = sc.take_shared<World>();
  assert_eq!(sweep_members(&w), GOLDEN_MEMBERS_NO_MASK);
  ts::return_shared(w);
  sc.end();
}

#[test]
fun format_3_masked_derivation_is_byte_identical() {
  let mut sc = ts::begin(OWNER);
  boot(&mut sc);
  make(&mut sc, vector[2]);
  sc.next_tx(OWNER);
  let w = sc.take_shared<World>();
  assert_eq!(sweep_members(&w), GOLDEN_MEMBERS_MASKED);
  ts::return_shared(w);
  sc.end();
}
