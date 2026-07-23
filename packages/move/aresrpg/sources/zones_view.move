// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// ZONES VIEW — the DERIVED zone getters (RPC + tests): every value here is recomputed from the zone's stored
/// seed through `zone_comp` (the search-cost rework stores seed+bitmaps, never rows). Per-index getters take the
/// DERIVATION index (stream order — stable across consumption, unlike the retired swap-remove positional index).
/// `*_count` getters return the LIVE (unconsumed) population; `*_total` the full derived population (the index
/// bound). Deriving per call is compute-only. Split out of `zones` on the file-size law — `zones` keeps the
/// state, doors, and bit-side probes (`zone_seed`, `mob_group_live`, `resource_remaining`, bitmap byte lengths).
module aresrpg::zones_view;

use aresrpg::{config::GameConfig, world::World, zones};

/// Total DERIVED mob groups (the mob index bound).
public fun mob_group_total(world: &World, zx: u32, zy: u32): u64 {
  let (sids, _t, _x, _z, _s, _g) = zones::derive_mobs(world, zx, zy, zones::zone_seed(world, zx, zy), 1);
  sids.length()
}

/// LIVE (unconsumed) mob groups — what the map still advertises.
public fun mob_group_count(world: &World, zx: u32, zy: u32): u64 {
  let total = mob_group_total(world, zx, zy);
  let mut live = 0;
  let mut i = 0;
  while (i < total) {
    if (zones::mob_group_live(world, zx, zy, i)) live = live + 1;
    i = i + 1;
  };
  live
}

public fun mob_spawn_id(world: &World, zx: u32, zy: u32, i: u64): u64 {
  let (sids, _t, _x, _z, _s, _g) = zones::derive_mobs(world, zx, zy, zones::zone_seed(world, zx, zy), 1);
  sids[i]
}

public fun mob_group_pos(world: &World, zx: u32, zy: u32, i: u64): (u32, u32) {
  let (_sids, _t, xs, zs, _s, _g) = zones::derive_mobs(world, zx, zy, zones::zone_seed(world, zx, zy), 1);
  (xs[i], zs[i])
}

public fun mob_group_template(world: &World, zx: u32, zy: u32, i: u64): ID {
  let (_sids, tpls, _x, _z, _s, _g) = zones::derive_mobs(world, zx, zy, zones::zone_seed(world, zx, zy), 1);
  tpls[i]
}

/// Group size DOES read the live `team_size_bound` dial (§4 size cap) — the one getter needing `config`.
public fun mob_group_size(world: &World, config: &GameConfig, zx: u32, zy: u32, i: u64): u16 {
  let (_sids, _t, _x, _z, sizes, _g) = zones::derive_mobs(world, zx, zy, zones::zone_seed(world, zx, zy), config.team_size_bound());
  sizes[i]
}

/// Total DERIVED resource cells (the resource index bound).
public fun resource_node_total(world: &World, zx: u32, zy: u32): u64 {
  let (sids, _t, _x, _z, _j, _r) = zones::derive_res(world, zx, zy, zones::zone_seed(world, zx, zy));
  sids.length()
}

/// LIVE (unharvested) resource cells.
public fun resource_node_count(world: &World, zx: u32, zy: u32): u64 {
  let total = resource_node_total(world, zx, zy);
  let mut live = 0;
  let mut i = 0;
  while (i < total) {
    if (zones::resource_remaining(world, zx, zy, i) == 1) live = live + 1;
    i = i + 1;
  };
  live
}

public fun resource_pos(world: &World, zx: u32, zy: u32, i: u64): (u32, u32) {
  let (_sids, _t, xs, zs, _j, _r) = zones::derive_res(world, zx, zy, zones::zone_seed(world, zx, zy));
  (xs[i], zs[i])
}

public fun resource_template(world: &World, zx: u32, zy: u32, i: u64): ID {
  let (_sids, tpls, _x, _z, _j, _r) = zones::derive_res(world, zx, zy, zones::zone_seed(world, zx, zy));
  tpls[i]
}

public fun resource_job(world: &World, zx: u32, zy: u32, i: u64): u8 {
  let (_sids, _t, _x, _z, jobs, _r) = zones::derive_res(world, zx, zy, zones::zone_seed(world, zx, zy));
  jobs[i]
}

public fun resource_tier(world: &World, zx: u32, zy: u32, i: u64): u8 {
  let (_sids, _t, _x, _z, _j, tiers) = zones::derive_res(world, zx, zy, zones::zone_seed(world, zx, zy));
  tiers[i]
}
