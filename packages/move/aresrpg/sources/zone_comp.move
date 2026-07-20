// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// ZONE COMP — the seed → composition pipeline of the search-cost rework: snapshots a World's tables + the §4
/// distance-difficulty inputs (the EXACT inputs the retired materialising search computed) and runs the pure
/// `aresrpg_foundation::zone_gen` kernel. ONE home for "what does zone (zx,zy) of this world contain at seed S" —
/// `zones` (search event counts, the claim door, the gather seam) and `zones_view` (the RPC/test getters) both
/// call through here, and the client mirror (`packages/sim/src/zone_derive.js::derive_zone`) runs the identical
/// pipeline over the same World doc, so map, claim, and fight can never disagree (composition-at-discovery).
module aresrpg::zone_comp;

use aresrpg::world::{Self, World};
use aresrpg_foundation::{world_math, zone_gen};

/// Derive the zone's FULL mob-group list from `seed`. Returns PARALLEL `(spawn_ids, template_ids, xs, zs, sizes,
/// group_seeds)` in stream order — the index IS the zone mob-bitmap's bit index. `team_bound` (the live
/// `team_size_bound` dial) feeds ONLY the §4 size cap: the kernel's size clamp never draws, so ids/positions/
/// templates are identical for any bound (callers that never read sizes pass 1).
public(package) fun derive_mobs(world: &World, zx: u32, zy: u32, seed: u64, team_bound: u64): (vector<u64>, vector<ID>, vector<u32>, vector<u32>, vector<u16>, vector<u64>) {
  let zsize = world::zone_size(world);
  let bx = world::bounds_x(world);
  let bz = world::bounds_z(world);
  let (ox, oz) = world::zone_origin(world, zx, zy);
  let mob_tab = world::mobs_snapshot(world);
  let mob_lv = world::mob_levels_snapshot(world);
  // §4 distance-difficulty (harder the further you walk out): radial distance OUTSIDE the
  // authored spawn-zone box raises the eligible mob LEVEL cap and the GROUP-SIZE cap. Every zone intersecting
  // the first-join box therefore stays at the roster floor; beyond its edge the existing continuous curve runs.
  // Levels default 0 (unauthored) → dormant.
  let (rmin, rmax) = world_math::roster_bounds(&mob_lv);
  let progress = spawn_distance_progress(
    ox, oz, zsize, bx, bz, world::spawn_zone_x(world), world::spawn_zone_z(world),
  );
  let lvl_cap = world_math::level_cap(progress, rmin, rmax);
  let size_bound = world_math::size_cap(progress, team_bound);
  let elig_w = eligible_mob_weights(&mob_tab, &mob_lv, lvl_cap);
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
  let (sids, idxs, xs, zs, sizes, gseeds) = zone_gen::derive_mob_groups(
    seed, world::min_groups(world) as u64, world::max_groups(world) as u64,
    &elig_w, &min_gs, &max_gs, size_bound, ox, oz, zsize, bx, bz,
  );
  let mut tpls = vector<ID>[];
  let m = idxs.length();
  let mut j = 0;
  while (j < m) {
    tpls.push_back(world::me_template(&mob_tab[idxs[j]]));
    j = j + 1;
  };
  (sids, tpls, xs, zs, sizes, gseeds)
}

/// Derive the zone's FULL resource-cell list from `seed` — table snapshot → the pure `zone_gen` kernel (gather
/// entries grow contiguous FIELDS; every cell is one-harvest/one-bit). Returns PARALLEL `(spawn_ids,
/// template_ids, xs, zs, jobs, tiers)` in stream order — the index IS the zone res-bitmap's bit index.
public(package) fun derive_res(world: &World, zx: u32, zy: u32, seed: u64): (vector<u64>, vector<ID>, vector<u32>, vector<u32>, vector<u8>, vector<u8>) {
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
  let (sids, idxs, xs, zs) = zone_gen::derive_resources(
    seed, world::min_nodes(world) as u64, world::max_nodes(world) as u64,
    &weights, &min_q, &max_q, &jobs_in, ox, oz, zsize, bx, bz,
  );
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

/// Weight vector for the DISTANCE-GATED mob roll (§4 wave-2b): a row keeps its `rate_bp` weight iff its eligibility
/// level (`levels[i]`, PARALLEL to `tab`) is at or below `lvl_cap` (the zone-distance ceiling), else 0 — rare mobs
/// stay rare WITHIN the eligible set (weights untouched, only zeroed when locked out). `roster_bounds` floors the
/// cap at a REAL roster level, so the floor mob always survives and the kernel's pick is never starved.
fun eligible_mob_weights(tab: &vector<world::MobEntry>, levels: &vector<u16>, lvl_cap: u16): vector<u64> {
  let mut w = vector[];
  let mut i = 0;
  while (i < tab.length()) {
    w.push_back(if (levels[i] <= lvl_cap) world::me_rate_bp(&tab[i]) as u64 else 0);
    i = i + 1;
  };
  w
}

/// Difficulty distance between the searched zone rectangle and the centred first-join rectangle. Distance is
/// zero when they intersect (so ANY legal fresh-join position sees the roster floor), then grows continuously
/// from the spawn-zone boundary through `world_math::distance_progress`'s authored 250/1000/5000 anchors.
fun spawn_distance_progress(
  ox: u32, oz: u32, zsize: u32, bx: u32, bz: u32, spawn_x: u32, spawn_z: u32,
): u64 {
  let spawn_min_x = bx / 2 - spawn_x / 2;
  let spawn_min_z = bz / 2 - spawn_z / 2;
  let spawn_max_x = spawn_min_x + spawn_x - 1;
  let spawn_max_z = spawn_min_z + spawn_z - 1;
  let raw_zone_max_x = ox + zsize - 1;
  let raw_zone_max_z = oz + zsize - 1;
  let zone_max_x = if (raw_zone_max_x < bx) raw_zone_max_x else bx - 1;
  let zone_max_z = if (raw_zone_max_z < bz) raw_zone_max_z else bz - 1;
  let dx = axis_gap(ox, zone_max_x, spawn_min_x, spawn_max_x);
  let dz = axis_gap(oz, zone_max_z, spawn_min_z, spawn_max_z);
  world_math::distance_progress(dx, dz, 0, 0)
}

fun axis_gap(a_min: u32, a_max: u32, b_min: u32, b_max: u32): u32 {
  if (a_max < b_min) b_min - a_max
  else if (b_max < a_min) a_min - b_max
  else 0
}

#[test_only]
public(package) fun distance_progress_for_testing(
  zx: u32, zy: u32, zsize: u32, bx: u32, bz: u32, spawn_x: u32, spawn_z: u32,
): u64 {
  spawn_distance_progress(zx * zsize, zy * zsize, zsize, bx, bz, spawn_x, spawn_z)
}
