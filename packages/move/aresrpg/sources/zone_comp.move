// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// ZONE COMP — the seed → composition pipeline of the search-cost rework: snapshots a World's tables + the §4
/// distance-difficulty inputs (the EXACT inputs the retired materialising search computed) and runs the pure
/// `aresrpg_foundation::zone_gen` kernel. ONE home for "what does zone (zx,zy) of this world contain at seed S" —
/// every reader reaches it through `zones`' derivation door, which picks the placement a zone's own stored
/// commitment names — the claim door, the gather seam and `zones_view` (the RPC/test getters) all take that one
/// route, and the client mirror (`packages/sim/src/zone_derive.js::derive_zone`) reads the same byte and runs
/// the identical pipeline, so map, claim, and fight can never disagree (composition-at-discovery).
module aresrpg::zone_comp;

use aresrpg::world::{Self, World};
use aresrpg_foundation::{world_math, zone_gen};

/// Which derivation `z89` runs. STREAM and GRID are the PUBLISHED formats (1/2) and differ only in
/// placement; MEMBERS is the ruled member-list model (format 3, #1110/#1111).
const MODE_STREAM: u8 = 0;
const MODE_GRID: u8 = 1;
const MODE_MEMBERS: u8 = 2;

/// Derive the zone's FULL mob-group list from `seed`. Returns PARALLEL `(spawn_ids, template_ids, xs, zs, sizes,
/// group_seeds)` in stream order — the index IS the zone mob-bitmap's bit index. `team_bound` (the live
/// `team_size_bound` dial) feeds ONLY the §4 size cap: the kernel's size clamp never draws, so ids/positions/
/// templates are identical for any bound (callers that never read sizes pass 1).
public(package) fun derive_mobs(world: &World, zx: u32, zy: u32, seed: u64, team_bound: u64): (vector<u64>, vector<ID>, vector<u32>, vector<u32>, vector<u16>, vector<u64>) {
  let (sids, tpls, _m, xs, zs, sizes, gseeds, _p) = z89(world, zx, zy, seed, team_bound, MODE_STREAM);
  (sids, tpls, xs, zs, sizes, gseeds)
}

// name shortened 2026-07-27: aresrpg at Sui object-size ceiling (ceremony leg-2); see the growth row
/// LATTICE variant — identical snapshot + §4 inputs, `zone_gen::derive_mob_groups_grid` for placement. Selected
/// per zone by `zones::derive_mobs` off the stored commitment's format byte, never by a caller's preference.
public(package) fun z44(world: &World, zx: u32, zy: u32, seed: u64, team_bound: u64): (vector<u64>, vector<ID>, vector<u32>, vector<u32>, vector<u16>, vector<u64>) {
  let (sids, tpls, _m, xs, zs, sizes, gseeds, _p) = z89(world, zx, zy, seed, team_bound, MODE_GRID);
  (sids, tpls, xs, zs, sizes, gseeds)
}

// name shortened 2026-07-27: aresrpg at Sui object-size ceiling (ceremony leg-2); see the growth row
/// The ONE snapshot + §4 difficulty pipeline EVERY mob derivation shares. `mode` names the only three things
/// that differ — which kernel places the groups, how the pick table is weighted, and whether a member roster
/// comes back. Everything around them (the table snapshot, the §4 progress and size cap, the per-row group
/// bands, the index→template mapping) is identical by construction, so the derivations can never drift apart
/// on anything but the parts `mode` names.
///
/// Returns the SUPERSET; the format-1/2 wrappers drop the two fields they have no use for. `member_tpls` is
/// empty and `progress` is still the real §4 value for modes 0/1 — an absent roster is the empty one, never a
/// second shape.
fun z89(
  world: &World, zx: u32, zy: u32, seed: u64, team_bound: u64, mode: u8,
): (vector<u64>, vector<ID>, vector<vector<ID>>, vector<u32>, vector<u32>, vector<u16>, vector<u64>, u64) {
  let zsize = world::zone_size(world);
  let bx = world::bounds_x(world);
  let bz = world::bounds_z(world);
  let (ox, oz) = world::zone_origin(world, zx, zy);
  let mob_tab = world::mobs_snapshot(world);
  // §4 distance-difficulty (harder the further you walk out): radial distance OUTSIDE the authored spawn-zone
  // box raises the GROUP-SIZE cap on every path, and the eligible mob LEVEL cap on the published ones. Every
  // zone intersecting the first-join box therefore stays at the roster floor; beyond its edge the existing
  // continuous curve runs.
  let progress = world_math::spawn_distance_progress(
    ox, oz, zsize, bx, bz, world::spawn_zone_x(world), world::spawn_zone_z(world),
  );
  let size_bound = world_math::size_cap(progress, team_bound);
  let n = mob_tab.length();
  let mut min_gs = vector<u64>[];
  let mut max_gs = vector<u64>[];
  let mut i = 0;
  while (i < n) {
    let e = &mob_tab[i];
    min_gs.push_back(world::me_min_group(e) as u64);
    max_gs.push_back(world::me_max_group(e) as u64);
    i = i + 1;
  };
  let (min_g, max_g) = (world::min_groups(world) as u64, world::max_groups(world) as u64);
  let (sids, idxs, member_idxs, xs, zs, sizes, gseeds) = if (mode == MODE_MEMBERS) {
    // THE RULED SPAWN MODEL (#1110/#1111): membership stops depending on distance — the roll is weighted by
    // the authored `rate_bp` alone — and the MEMBER table zeroes every row the world's boss mask names, which
    // the kernel reads as "this primary is a boss" and keeps that group single-spec. An absent mask reads as
    // EMPTY, so the member table is simply the pick table: one degradation path, no second shape.
    let boss = world::boss_mask(world);
    let mut weights = vector<u64>[];
    let mut member_w = vector<u64>[];
    let mut j = 0;
    while (j < n) {
      let w = world::me_rate_bp(&mob_tab[j]) as u64;
      weights.push_back(w);
      member_w.push_back(if (boss.contains(&(j as u16))) 0 else w);
      j = j + 1;
    };
    zone_gen::derive_mob_groups_members(
      seed, min_g, max_g, &weights, &member_w, &min_gs, &max_gs, size_bound, ox, oz, zsize, bx, bz,
    )
  } else {
    // FORMATS 1/2 — the PUBLISHED derivation: the §4 level cap gates MEMBERSHIP (levels default 0 = dormant).
    // In-flight zones replay this exact stream, so a different weight total here would pick a different row
    // from the same roll and re-derive every live zone into fiction.
    let mob_lv = world::mob_levels_snapshot(world);
    let (rmin, rmax) = world_math::roster_bounds(&mob_lv);
    let lvl_cap = world_math::level_cap(progress, rmin, rmax);
    let elig_w = z91(&mob_tab, &mob_lv, lvl_cap);
    let (s, ix, x, z, sz, g) = if (mode == MODE_GRID) {
      zone_gen::derive_mob_groups_grid(
        seed, min_g, max_g, &elig_w, &min_gs, &max_gs, size_bound, ox, oz, zsize, bx, bz,
      )
    } else {
      zone_gen::derive_mob_groups(
        seed, min_g, max_g, &elig_w, &min_gs, &max_gs, size_bound, ox, oz, zsize, bx, bz,
      )
    };
    (s, ix, vector<vector<u16>>[], x, z, sz, g)
  };
  let mut tpls = vector<ID>[];
  let mut member_tpls = vector<vector<ID>>[];
  let m = idxs.length();
  let mut j = 0;
  while (j < m) {
    tpls.push_back(world::me_template(&mob_tab[idxs[j]]));
    if (mode == MODE_MEMBERS) {
      let roster = &member_idxs[j];
      let mut row = vector<ID>[];
      let mut k = 0;
      while (k < roster.length()) {
        row.push_back(world::me_template(&mob_tab[roster[k] as u64]));
        k = k + 1;
      };
      member_tpls.push_back(row);
    };
    j = j + 1;
  };
  (sids, tpls, member_tpls, xs, zs, sizes, gseeds, progress)
}

// name shortened 2026-07-27: aresrpg at Sui object-size ceiling (ceremony leg-2); see the growth row
/// MEMBER-LIST variant (format 3, #1110/#1111) — the RULED SPAWN MODEL. Two substitutions land here together,
/// because either one alone is a shipped regression (the design ruling's words):
///
/// 1. **The level cap is GONE from the pick table.** `z91` zeroes a row whose eligibility level
///    sits above the zone's distance cap, which is what made 9 of 20 worlds admit ≤2 species at their own spawn
///    box (7 of them at 100% one mob). The ruled model is EQUAL SPAWN EVERYWHERE: every authored row of the
///    world may appear anywhere in it, and DISTANCE grades the difficulty instead of the membership. So this
///    path weights the roll by the authored `rate_bp` alone.
/// 2. **Difficulty rides distance.** `progress` (0-1000, the §4 curve) comes back as the eighth return value:
///    it still caps GROUP SIZE here, and it is the value the fight door plumbs into the engine so a member's
///    level is drawn from a window that slides up its authored band with distance from the world centre.
///
/// Formats 1/2 keep their own untouched functions above — dropping the level cap on THEIR path would re-derive
/// every in-flight zone into fiction (a different weight total picks a different row from the same roll), so the
/// substitution is format-gated by construction, not by a flag.
///
/// The MEMBER table is the pick table with every row named by the world's `boss_mask` zeroed — the kernel reads
/// a zero there as "this primary is a boss" and keeps that group single-spec. An absent mask reads as EMPTY, so
/// the member table is simply the pick table: one degradation path, no second shape.
public(package) fun z45(world: &World, zx: u32, zy: u32, seed: u64, team_bound: u64): (vector<u64>, vector<ID>, vector<vector<ID>>, vector<u32>, vector<u32>, vector<u16>, vector<u64>, u64) {
  z89(world, zx, zy, seed, team_bound, MODE_MEMBERS)
}

/// Derive the zone's FULL resource-cell list from `seed` — table snapshot → the pure `zone_gen` kernel (gather
/// entries grow contiguous FIELDS; every cell is one-harvest/one-bit). Returns PARALLEL `(spawn_ids,
/// template_ids, xs, zs, jobs, tiers)` in stream order — the index IS the zone res-bitmap's bit index.
public(package) fun derive_res(world: &World, zx: u32, zy: u32, seed: u64): (vector<u64>, vector<ID>, vector<u32>, vector<u32>, vector<u8>, vector<u8>) {
  z90(world, zx, zy, seed, false)
}

// name shortened 2026-07-27: aresrpg at Sui object-size ceiling (ceremony leg-2); see the growth row
/// LATTICE variant — identical table snapshot, `zone_gen::derive_resources_grid` for anchor placement.
public(package) fun z46(world: &World, zx: u32, zy: u32, seed: u64): (vector<u64>, vector<ID>, vector<u32>, vector<u32>, vector<u8>, vector<u8>) {
  z90(world, zx, zy, seed, true)
}

// name shortened 2026-07-27: aresrpg at Sui object-size ceiling (ceremony leg-2); see the growth row
/// The ONE table-snapshot pipeline both resource variants share — `grid` picks only the anchor kernel.
fun z90(world: &World, zx: u32, zy: u32, seed: u64, grid: bool): (vector<u64>, vector<ID>, vector<u32>, vector<u32>, vector<u8>, vector<u8>) {
  let zsize = world::zone_size(world);
  let bx = world::bounds_x(world);
  let bz = world::bounds_z(world);
  let (ox, oz) = world::zone_origin(world, zx, zy);
  let res_tab = world::resources_snapshot(world);
  let n = res_tab.length();
  let mut weights = vector<u64>[];
  let mut min_q = vector<u64>[];
  let mut max_q = vector<u64>[];
  let mut jobs_in = vector<u8>[];
  let mut i = 0;
  while (i < n) {
    let e = &res_tab[i];
    weights.push_back(world::re_rate_bp(e) as u64);
    min_q.push_back(world::re_min_qty(e) as u64);
    max_q.push_back(world::re_max_qty(e) as u64);
    jobs_in.push_back(world::re_job(e));
    i = i + 1;
  };
  let (sids, idxs, xs, zs) = if (grid) {
    zone_gen::derive_resources_grid(
      seed, world::min_nodes(world) as u64, world::max_nodes(world) as u64,
      &weights, &min_q, &max_q, &jobs_in, ox, oz, zsize, bx, bz,
    )
  } else {
    zone_gen::derive_resources(
      seed, world::min_nodes(world) as u64, world::max_nodes(world) as u64,
      &weights, &min_q, &max_q, &jobs_in, ox, oz, zsize, bx, bz,
    )
  };
  let mut tpls = vector<ID>[];
  let mut jobs = vector<u8>[];
  let mut tiers = vector<u8>[];
  let m = idxs.length();
  let mut j = 0;
  while (j < m) {
    let e = &res_tab[idxs[j]];
    tpls.push_back(world::re_template(e));
    jobs.push_back(world::re_job(e));
    tiers.push_back(world::re_tier(e));
    j = j + 1;
  };
  (sids, tpls, xs, zs, jobs, tiers)
}

// name shortened 2026-07-27: aresrpg at Sui object-size ceiling (ceremony leg-2); see the growth row
/// Weight vector for the DISTANCE-GATED mob roll (§4 wave-2b): a row keeps its `rate_bp` weight iff its eligibility
/// level (`levels[i]`, PARALLEL to `tab`) is at or below `lvl_cap` (the zone-distance ceiling), else 0 — rare mobs
/// stay rare WITHIN the eligible set (weights untouched, only zeroed when locked out). `roster_bounds` floors the
/// cap at a REAL roster level, so the floor mob always survives and the kernel's pick is never starved.
fun z91(tab: &vector<world::MobEntry>, levels: &vector<u16>, lvl_cap: u16): vector<u64> {
  let mut w = vector[];
  let mut i = 0;
  while (i < tab.length()) {
    w.push_back(if (levels[i] <= lvl_cap) world::me_rate_bp(&tab[i]) as u64 else 0);
    i = i + 1;
  };
  w
}

#[test_only]
public(package) fun distance_progress_for_testing(
  zx: u32, zy: u32, zsize: u32, bx: u32, bz: u32, spawn_x: u32, spawn_z: u32,
): u64 {
  world_math::spawn_distance_progress(zx * zsize, zy * zsize, zsize, bx, bz, spawn_x, spawn_z)
}
