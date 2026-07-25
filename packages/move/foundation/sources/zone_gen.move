// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// ZONE GEN — the SEED-DERIVED zone composition kernel (search-cost rework, "good search
/// design"). `search_zone` no longer MATERIALISES spawns as on-chain rows (the searcher paid ~0.1 SUI of storage
/// whose rebate later flowed to OTHER players' fights — the redistribution bug): it stores ONLY the zone's
/// composition SEED + consumed-BITMAPS, and the exact mob-group / resource-cell lists DERIVE from the seed HERE —
/// deterministically, so the client map (JS mirror `packages/sim/src/zone_derive.js`) and the on-chain
/// fight/gather doors reproduce IDENTICAL lists (composition-at-discovery, DECISIONS 07-08). The derivation
/// threads the foundation `prng` (mulberry32) instead of Sui's `RandomGenerator` because only a seedable PRNG is
/// replayable + JS-mirrorable — `&Random` fires ONCE at search (the seed); everything after is a pure function.
/// SPAWN SPACING: there should be a minimum distance of 20 blocks between each spawn
/// of mobs, enforced IN the position derivation by rejection sampling — deterministic, every deriver agrees.
/// Pure transforms over plain scalars (quarantine law): zero objects, zero events, zero state.
module aresrpg_foundation::zone_gen;

use aresrpg_foundation::{prng, world_math};
use sui::{bcs, hash};

const MOB_SALT: u64 = 0x4d4f_425f; // sub-seed decorrelation for the mob stream
const RES_SALT: u64 = 0x5245_535f; // sub-seed decorrelation for the resource stream
/// The gather jobs whose resource entries derive as a CONTIGUOUS FIELD (SPEC §6: 0 FARMER · 1 HERBALIST · 2
/// MINER); a `job` above this = a non-gather resource, a single cell. MOVED here from `zones.move` with the
/// search-cost rework — the derivation kernel is now the one home for how a resource row becomes cells.
const MAX_GATHER_JOB: u8 = 2;
/// Hard rail on cells per gather field — matches the client wheat-field cap (moved from `zones.move`, same law).
const CLUSTER_CAP: u64 = 20;
const MIN_SPAWN_SPACING: u64 = 20; // mob group spawns pairwise ≥ 20 blocks apart
const SPACING_D2: u64 = MIN_SPAWN_SPACING * MIN_SPAWN_SPACING; // squared compare (no sqrt) = 400
const POS_ATTEMPTS: u64 = 64; // rejection-sampling cap; on exhaustion accept the last roll (a zone too small to fit)
/// LATTICE placement: the zone box is diced into whole `GRID_CELL` squares, one spawn per cell, drawn without
/// replacement. Spacing becomes STRUCTURAL rather than rejection-sampled — two spawns can never share a cell, and
/// the `GRID_PAD` inset around a `GRID_JITTER` span keeps any two neighbours ≥ `MIN_SPAWN_SPACING` on every axis
/// (40 − 2×10 + 0 = 20 worst case). Cheaper AND stricter than the 64-attempt reject loop it supersedes.
const GRID_CELL: u64 = 40;
const GRID_PAD: u64 = 10; // a spawn sits in the middle 21 blocks of its cell
const GRID_JITTER: u64 = 20; // inclusive jitter span [0, 20] per axis
const EBadGroupCommitmentInput: u64 = 1;
const GROUP_HASH_BYTES: u64 = 32;
const MAX_GROUPS: u64 = 64;
/// Stored-commitment FORMAT bytes. A bare 32-byte digest is the legacy Merkle root (format 1); a 33-byte
/// `0x02 ‖ digest` is the whole-set commitment (format 2) that ALSO selects lattice placement for the zone.
const GROUP_FORMAT_LEGACY: u8 = 1;
const GROUP_FORMAT_LATTICE: u8 = 2;

/// Canonical BCS leaf for a searched-zone commitment. The pure foundation can calculate hashes, but only the
/// owning `zones` module can attach a root to World state.
public struct MobGroupLeaf has copy, drop {
  world: ID,
  zx: u32,
  zy: u32,
  zone_seed: u64,
  discovered_at_ms: u64,
  index: u64,
  spawn_id: u64,
  template: ID,
  x: u32,
  z: u32,
  group_size: u16,
  group_seed: u64,
}

/// One group of a whole-set commitment (format 2) — the per-group facts, positional in BCS.
public struct MobGroup has copy, drop {
  spawn_id: u64,
  template: ID,
  x: u32,
  z: u32,
  group_size: u16,
  group_seed: u64,
}

/// The zone's ENTIRE derived group list committed as one value — a claim proves membership by re-deriving the
/// list and comparing the whole commitment, so no per-index Merkle path travels with the transaction.
public struct MobGroupSet has copy, drop {
  world: ID,
  zx: u32,
  zy: u32,
  zone_seed: u64,
  discovered_at_ms: u64,
  groups: vector<MobGroup>,
}

// ╔════════════════ [ prng-threaded roll primitives (replayable twins of the retired &Random helpers) ] ═ ]

/// Roll an inclusive `[lo, hi]` off the mulberry32 state — the SKIP-when-`lo>=hi` rule is preserved so a point /
/// malformed band advances the stream identically on chain and in the JS mirror (never a phantom draw). Returns
/// the advanced state alongside the value (functional threading — the caller re-binds `state`).
public fun p_roll_u64(state: u64, lo: u64, hi: u64): (u64, u64) {
  if (lo >= hi) (state, lo) else prng::rng_range(state, lo, hi)
}

/// Weighted index pick: ALWAYS draws once (mirrors the retired `&Random` original, which never skipped), so a
/// single-row table still advances the stream. `none` on an empty / all-zero table.
public fun p_pick_weighted(state: u64, weights: &vector<u64>): (u64, Option<u64>) {
  let n = weights.length();
  if (n == 0) return (state, option::none());
  let mut total = 0u64;
  let mut i = 0;
  while (i < n) { total = total + weights[i]; i = i + 1; };
  if (total == 0) return (state, option::none());
  let (s1, roll) = prng::rng_range(state, 0, total - 1);
  let mut acc = 0u64;
  let mut j = 0;
  while (j < n) {
    acc = acc + weights[j];
    if (roll < acc) return (s1, option::some(j));
    j = j + 1;
  };
  (s1, option::some(n - 1)) // unreachable (roll < total) — terminal value the compiler needs
}

/// Two draws (x then z) inside the zone box `[ox,ox+zsize)×[oz,oz+zsize)`, clamped in-bounds exactly like the
/// retired `&Random` `roll_pos` (a straddling last zone behaves identically).
fun p_roll_pos(state: u64, ox: u32, oz: u32, zsize: u32, bx: u32, bz: u32): (u64, u32, u32) {
  let (s1, dx) = p_roll_u64(state, 0, (zsize as u64) - 1);
  let (s2, dz) = p_roll_u64(s1, 0, (zsize as u64) - 1);
  let mut x = ox + (dx as u32);
  let mut z = oz + (dz as u32);
  if (x >= bx) x = bx - 1;
  if (z >= bz) z = bz - 1;
  (s2, x, z)
}

// ╔════════════════ [ The 20-block spacing law ] ═════════════════ ]

/// `true` iff `(x, z)` is ≥ `MIN_SPAWN_SPACING` blocks (squared) from EVERY already-placed group.
fun far_enough(xs: &vector<u32>, zs: &vector<u32>, x: u32, z: u32): bool {
  let n = xs.length();
  let mut i = 0;
  while (i < n) {
    let dx = world_math::abs_diff(x, xs[i]);
    let dz = world_math::abs_diff(z, zs[i]);
    if (dx * dx + dz * dz < SPACING_D2) return false;
    i = i + 1;
  };
  true
}

/// Roll a position that clears the 20-block spacing against `(xs, zs)` — rejection sampling, up to `POS_ATTEMPTS`.
/// Deterministic given `state` (same seed → same accept/reject sequence → same position on chain and in JS). On
/// exhaustion (a zone too small to fit the spacing — never in a real world) accept the LAST roll rather than hang.
fun p_roll_pos_spaced(state: u64, xs: &vector<u32>, zs: &vector<u32>, ox: u32, oz: u32, zsize: u32, bx: u32, bz: u32): (u64, u32, u32) {
  let mut s = state;
  let mut attempt = 0;
  let mut fx = 0u32;
  let mut fz = 0u32;
  while (attempt < POS_ATTEMPTS) {
    let (s2, x, z) = p_roll_pos(s, ox, oz, zsize, bx, bz);
    s = s2;
    fx = x;
    fz = z;
    if (far_enough(xs, zs, x, z)) return (s, x, z);
    attempt = attempt + 1;
  };
  (s, fx, fz)
}

// ╔════════════════ [ The placement lattice (structural spacing) ] ═══════════════ ]

/// Dice the zone box — clipped to the world bounds, so a straddling last zone loses its out-of-world strip —
/// into whole `GRID_CELL` squares. Returns `(cols, pool)` where `pool` is every cell index `0 .. cols*rows - 1`;
/// callers draw from it WITHOUT replacement, which is what makes spacing structural. A zone smaller than one
/// cell on either axis yields an EMPTY pool (and therefore hosts no spawns at all).
fun grid_cell_pool(ox: u32, oz: u32, zsize: u32, bx: u32, bz: u32): (u64, vector<u64>) {
  let end_x = (ox as u64) + (zsize as u64);
  let end_z = (oz as u64) + (zsize as u64);
  let max_x = if (end_x < (bx as u64)) end_x else (bx as u64);
  let max_z = if (end_z < (bz as u64)) end_z else (bz as u64);
  let span_x = if (max_x > (ox as u64)) max_x - (ox as u64) else 0;
  let span_z = if (max_z > (oz as u64)) max_z - (oz as u64) else 0;
  let cols = span_x / GRID_CELL;
  let total = cols * (span_z / GRID_CELL);
  let mut pool = vector<u64>[];
  let mut i = 0;
  while (i < total) {
    pool.push_back(i);
    i = i + 1;
  };
  (cols, pool)
}

/// Consume the `i`-th lattice cell. THREE draws: a partial Fisher-Yates selection from the unconsumed tail
/// `pool[i..]` (swapped down to `i`, so `pool` carries the draw state — the LAST cell costs no draw at all,
/// because `p_roll_u64` skips when `lo >= hi`), then one jitter draw per axis inside the chosen cell.
fun p_pick_grid_pos(state: u64, pool: &mut vector<u64>, i: u64, cols: u64, ox: u32, oz: u32): (u64, u32, u32) {
  let (s1, j) = p_roll_u64(state, i, pool.length() - 1);
  pool.swap(i, j);
  let cell = pool[i];
  let (s2, jx) = p_roll_u64(s1, 0, GRID_JITTER);
  let (s3, jz) = p_roll_u64(s2, 0, GRID_JITTER);
  let x = (ox as u64) + (cell % cols) * GRID_CELL + GRID_PAD + jx;
  let z = (oz as u64) + (cell / cols) * GRID_CELL + GRID_PAD + jz;
  (s3, x as u32, z as u32)
}

// ╔════════════════ [ Mob-group derivation ] ═══════════════════════════════════ ]

/// Derive a discovered zone's FULL mob-group list from its composition `seed` — the on-chain twin of
/// `zone_derive.js::derive_mob_groups`. Pure over the seed + the caller's distance-filtered tables (weights /
/// per-row group bands, all PARALLEL to the caller's mob template table) + zone geometry. Returns six PARALLEL
/// vectors, one entry per group (in stream order — the bit index the consumed-bitmap keys on):
///   `(spawn_ids, template_idxs, xs, zs, sizes, group_seeds)`.
/// Draw order PER GROUP (mirrored byte-for-byte in JS): weighted template pick · group-size roll (clamped to
/// `size_bound`, no draw) · SPACED position (2 draws × attempts) · `group_seed` (1 draw) · `spawn_id` hi+lo (2
/// draws → a 64-bit id: `mix(seed)`-decorrelated per search so the fight engine's `(world, spawn_id)` first-come
/// claim never collides across zones/searches). `size_bound` is the §4 distance group-size cap; positions are
/// pairwise ≥ 20 blocks (the spawn-spacing law) BY CONSTRUCTION.
public fun derive_mob_groups(
  seed: u64,
  min_g: u64,
  max_g: u64,
  weights: &vector<u64>,
  min_group: &vector<u64>,
  max_group: &vector<u64>,
  size_bound: u64,
  ox: u32,
  oz: u32,
  zsize: u32,
  bx: u32,
  bz: u32,
): (vector<u64>, vector<u64>, vector<u32>, vector<u32>, vector<u16>, vector<u64>) {
  let mut spawn_ids = vector<u64>[];
  let mut tmpl_idxs = vector<u64>[];
  let mut xs = vector<u32>[];
  let mut zs = vector<u32>[];
  let mut sizes = vector<u16>[];
  let mut seeds = vector<u64>[];
  let mut s = prng::rng_seed(prng::mix(seed, MOB_SALT));
  let (s0, g) = p_roll_u64(s, min_g, max_g);
  s = s0;
  let mut i = 0;
  while (i < g) {
    let (s1, opt) = p_pick_weighted(s, weights);
    s = s1;
    if (opt.is_none()) break;
    let idx = opt.destroy_some();
    let (s2, raw) = p_roll_u64(s, min_group[idx], max_group[idx]);
    s = s2;
    let gsize = world_math::clamp_group_u16(raw, size_bound);
    let (s3, x, z) = p_roll_pos_spaced(s, &xs, &zs, ox, oz, zsize, bx, bz);
    s = s3;
    let (s4, gseed) = prng::rng_next(s);
    let (s5, sid_hi) = prng::rng_next(s4);
    let (s6, sid_lo) = prng::rng_next(s5);
    s = s6;
    spawn_ids.push_back((sid_hi << 32) | sid_lo);
    tmpl_idxs.push_back(idx);
    xs.push_back(x);
    zs.push_back(z);
    sizes.push_back(gsize);
    seeds.push_back(gseed);
    i = i + 1;
  };
  (spawn_ids, tmpl_idxs, xs, zs, sizes, seeds)
}

/// LATTICE twin of `derive_mob_groups` — same tables, same stream salt, same six PARALLEL returns; the ONLY
/// difference is placement: instead of the 2-draws-per-attempt rejection loop, group `i` consumes lattice cell
/// `i` (`p_pick_grid_pos`, a fixed 3 draws). Draw order PER GROUP is therefore weighted pick(1) · size roll(1) ·
/// cell + jitter(3) · `group_seed`(1) · `spawn_id` hi+lo(2) = 8 — 7 for the last cell, whose selection roll is
/// skipped. The pool ALSO caps the count: a zone with fewer cells than the rolled group target hosts one group
/// per cell. Mirrored byte-for-byte in `zone_derive.js` (format 2).
public fun derive_mob_groups_grid(
  seed: u64,
  min_g: u64,
  max_g: u64,
  weights: &vector<u64>,
  min_group: &vector<u64>,
  max_group: &vector<u64>,
  size_bound: u64,
  ox: u32,
  oz: u32,
  zsize: u32,
  bx: u32,
  bz: u32,
): (vector<u64>, vector<u64>, vector<u32>, vector<u32>, vector<u16>, vector<u64>) {
  let mut spawn_ids = vector<u64>[];
  let mut tmpl_idxs = vector<u64>[];
  let mut xs = vector<u32>[];
  let mut zs = vector<u32>[];
  let mut sizes = vector<u16>[];
  let mut seeds = vector<u64>[];
  let mut s = prng::rng_seed(prng::mix(seed, MOB_SALT));
  let (s0, g) = p_roll_u64(s, min_g, max_g);
  s = s0;
  let (cols, mut pool) = grid_cell_pool(ox, oz, zsize, bx, bz);
  let mut i = 0;
  while (i < g && i < pool.length()) {
    let (s1, opt) = p_pick_weighted(s, weights);
    s = s1;
    if (opt.is_none()) break;
    let idx = opt.destroy_some();
    let (s2, raw) = p_roll_u64(s, min_group[idx], max_group[idx]);
    let (s3, x, z) = p_pick_grid_pos(s2, &mut pool, i, cols, ox, oz);
    let gsize = world_math::clamp_group_u16(raw, size_bound);
    let (s4, gseed) = prng::rng_next(s3);
    let (s5, sid_hi) = prng::rng_next(s4);
    let (s6, sid_lo) = prng::rng_next(s5);
    s = s6;
    spawn_ids.push_back((sid_hi << 32) | sid_lo);
    tmpl_idxs.push_back(idx);
    xs.push_back(x);
    zs.push_back(z);
    sizes.push_back(gsize);
    seeds.push_back(gseed);
    i = i + 1;
  };
  (spawn_ids, tmpl_idxs, xs, zs, sizes, seeds)
}

// ╔════════════════ [ Authenticated mob-group commitments ] ══════════════════ ]

fun mob_group_leaf_hash(
  world: ID, zx: u32, zy: u32, zone_seed: u64, discovered_at_ms: u64, index: u64,
  spawn_id: u64, template: ID, x: u32, z: u32, group_size: u16, group_seed: u64,
): vector<u8> {
  let leaf = MobGroupLeaf {
    world, zx, zy, zone_seed, discovered_at_ms, index, spawn_id, template, x, z, group_size, group_seed,
  };
  let mut bytes = b"aresrpg.zone-group.leaf";
  bytes.append(bcs::to_bytes(&leaf));
  hash::blake2b256(&bytes)
}

fun mob_group_node_hash(left: &vector<u8>, right: &vector<u8>): vector<u8> {
  let mut bytes = b"aresrpg.zone-group.node";
  bytes.append(*left);
  bytes.append(*right);
  hash::blake2b256(&bytes)
}

fun mob_group_leaves(
  world: ID, zx: u32, zy: u32, zone_seed: u64, discovered_at_ms: u64,
  spawn_ids: &vector<u64>, templates: &vector<ID>, xs: &vector<u32>, zs: &vector<u32>,
  sizes: &vector<u16>, group_seeds: &vector<u64>,
): vector<vector<u8>> {
  let count = spawn_ids.length();
  assert!(count <= MAX_GROUPS && templates.length() == count && xs.length() == count &&
    zs.length() == count && sizes.length() == count && group_seeds.length() == count, EBadGroupCommitmentInput);
  let mut out = vector[];
  let mut i = 0;
  while (i < count) {
    out.push_back(mob_group_leaf_hash(
      world, zx, zy, zone_seed, discovered_at_ms, i, spawn_ids[i], templates[i], xs[i], zs[i],
      sizes[i], group_seeds[i],
    ));
    i = i + 1;
  };
  out
}

/// One Merkle level; an odd final node is paired with itself at every level.
fun next_mob_group_level(nodes: &vector<vector<u8>>): vector<vector<u8>> {
  let mut next = vector[];
  let mut i = 0;
  while (i < nodes.length()) {
    let right = if (i + 1 < nodes.length()) &nodes[i + 1] else &nodes[i];
    next.push_back(mob_group_node_hash(&nodes[i], right));
    i = i + 2;
  };
  next
}

/// Pure root calculation over authoritative arrays already derived by search.
public fun mob_group_root(
  world: ID, zx: u32, zy: u32, zone_seed: u64, discovered_at_ms: u64,
  spawn_ids: &vector<u64>, templates: &vector<ID>, xs: &vector<u32>, zs: &vector<u32>,
  sizes: &vector<u16>, group_seeds: &vector<u64>,
): vector<u8> {
  let mut nodes = mob_group_leaves(
    world, zx, zy, zone_seed, discovered_at_ms, spawn_ids, templates, xs, zs, sizes, group_seeds,
  );
  if (nodes.is_empty()) return hash::blake2b256(&b"aresrpg.zone-group.empty");
  while (nodes.length() > 1) nodes = next_mob_group_level(&nodes);
  nodes.pop_back()
}

/// Which commitment a stored root IS, read off its own bytes — the one home for the format dispatch every
/// deriver (chain, SDK, client mirror) makes. `1` = a bare 32-byte Merkle root (legacy, spaced placement);
/// `2` = `0x02 ‖ digest`, the whole-set commitment that ALSO selects lattice placement; `0` = neither, which
/// no writer produces. A zone with NO stored commitment reads as `1` at the caller (`zones`), not here.
public fun mob_group_commitment_format(bytes: &vector<u8>): u8 {
  if (bytes.length() == GROUP_HASH_BYTES) GROUP_FORMAT_LEGACY
  else if (bytes.length() == GROUP_HASH_BYTES + 1 && bytes[0] == GROUP_FORMAT_LATTICE) GROUP_FORMAT_LATTICE
  else 0
}

/// Commit the zone's ENTIRE derived group list as one value: `0x02 ‖ blake2b256(domain ‖ 0x02 ‖ bcs(MobGroupSet))`.
/// A claim authenticates by RE-DERIVING the list and comparing this whole commitment, so no per-index Merkle
/// path rides the transaction — the derivation is the proof. Same input validation as `mob_group_root`.
public fun mob_group_commitment(
  world: ID, zx: u32, zy: u32, zone_seed: u64, discovered_at_ms: u64,
  spawn_ids: &vector<u64>, templates: &vector<ID>, xs: &vector<u32>, zs: &vector<u32>,
  sizes: &vector<u16>, group_seeds: &vector<u64>,
): vector<u8> {
  let count = spawn_ids.length();
  assert!(count <= MAX_GROUPS && templates.length() == count && xs.length() == count &&
    zs.length() == count && sizes.length() == count && group_seeds.length() == count, EBadGroupCommitmentInput);
  let mut groups = vector<MobGroup>[];
  let mut i = 0;
  while (i < count) {
    groups.push_back(MobGroup {
      spawn_id: spawn_ids[i], template: templates[i], x: xs[i], z: zs[i],
      group_size: sizes[i], group_seed: group_seeds[i],
    });
    i = i + 1;
  };
  let set = MobGroupSet { world, zx, zy, zone_seed, discovered_at_ms, groups };
  let mut bytes = b"aresrpg.zone-group.commitment";
  bytes.push_back(GROUP_FORMAT_LATTICE);
  bytes.append(bcs::to_bytes(&set));
  let mut out = vector[GROUP_FORMAT_LATTICE];
  out.append(hash::blake2b256(&bytes));
  out
}

/// `true` iff `commitment` is a format-2 commitment AND it equals the one these arrays produce. A legacy or
/// malformed stored value returns `false` rather than falling back — the caller picks its verifier by format.
public fun mob_group_commitment_matches(
  commitment: &vector<u8>, world: ID, zx: u32, zy: u32, zone_seed: u64, discovered_at_ms: u64,
  spawn_ids: &vector<u64>, templates: &vector<ID>, xs: &vector<u32>, zs: &vector<u32>,
  sizes: &vector<u16>, group_seeds: &vector<u64>,
): bool {
  if (mob_group_commitment_format(commitment) != GROUP_FORMAT_LATTICE) return false;
  *commitment == mob_group_commitment(
    world, zx, zy, zone_seed, discovered_at_ms, spawn_ids, templates, xs, zs, sizes, group_seeds,
  )
}

fun mob_group_proof_depth(mut count: u64): u64 {
  let mut depth = 0;
  while (count > 1) { count = (count + 1) / 2; depth = depth + 1; };
  depth
}

/// Verify one flattened proof against a root borrowed by `zones`; index bits determine sibling ordering.
public fun mob_group_root_matches(
  root: &vector<u8>, count: u64, world: ID, zx: u32, zy: u32, zone_seed: u64,
  discovered_at_ms: u64, index: u64, spawn_id: u64, template: ID, x: u32, z: u32,
  group_size: u16, group_seed: u64, proof: &vector<u8>,
): bool {
  if (count == 0 || count > MAX_GROUPS || index >= count) return false;
  let depth = mob_group_proof_depth(count);
  if (proof.length() != depth * GROUP_HASH_BYTES) return false;
  let mut digest = mob_group_leaf_hash(
    world, zx, zy, zone_seed, discovered_at_ms, index, spawn_id, template, x, z, group_size, group_seed,
  );
  let mut cursor = index;
  let mut level = 0;
  while (level < depth) {
    let mut sibling = vector[];
    let mut j = 0;
    while (j < GROUP_HASH_BYTES) {
      sibling.push_back(proof[level * GROUP_HASH_BYTES + j]);
      j = j + 1;
    };
    digest = if (cursor % 2 == 0) mob_group_node_hash(&digest, &sibling)
      else mob_group_node_hash(&sibling, &digest);
    cursor = cursor / 2;
    level = level + 1;
  };
  digest == *root
}

#[test_only]
public fun mob_group_proof_for_testing(
  world: ID, zx: u32, zy: u32, zone_seed: u64, discovered_at_ms: u64,
  spawn_ids: &vector<u64>, templates: &vector<ID>, xs: &vector<u32>, zs: &vector<u32>,
  sizes: &vector<u16>, group_seeds: &vector<u64>, mut index: u64,
): vector<u8> {
  let mut nodes = mob_group_leaves(
    world, zx, zy, zone_seed, discovered_at_ms, spawn_ids, templates, xs, zs, sizes, group_seeds,
  );
  assert!(index < nodes.length(), EBadGroupCommitmentInput);
  let mut proof = vector[];
  while (nodes.length() > 1) {
    let sibling = if (index % 2 == 1) index - 1
      else if (index + 1 < nodes.length()) index + 1 else index;
    proof.append(nodes[sibling]);
    nodes = next_mob_group_level(&nodes);
    index = index / 2;
  };
  proof
}

// ╔════════════════ [ Resource-cell derivation (one-harvest / one-bit) ] ═══════ ]

/// Derive a discovered zone's FULL resource-cell list from its composition `seed` — the on-chain twin of
/// `zone_derive.js::derive_resources`. Same table-roll SHAPE as the retired materialising search loop: roll a
/// node target in `[min_n, max_n]`, then per pick a GATHER entry (`job ≤ MAX_GATHER_JOB`) grows a contiguous
/// FIELD of `min(qty, CLUSTER_CAP)` cells while a non-gather entry lands ONE cell — but EVERY derived cell is now
/// ONE-HARVEST/ONE-BIT (2110/2110 seeded resources were `remaining: 1`; the multi-charge
/// branch carried zero real data — the `remaining` concept collapses into the consumed-bitmap). Returns four
/// PARALLEL vectors, one entry per CELL in stream order (the res-bitmap bit index):
///   `(spawn_ids, template_idxs, xs, zs)`.
/// Draw order PER PICK (mirrored byte-for-byte in JS): weighted template pick · qty roll (band `[min,max]`) ·
/// anchor/pos (2 draws) · [gather only: the cluster-growth draws] · per-cell `spawn_id` hi+lo (2 draws each —
/// fresh ids per re-search so a re-rolled zone reconciles cleanly client-side).
public fun derive_resources(
  seed: u64,
  min_n: u64,
  max_n: u64,
  weights: &vector<u64>,
  min_qty: &vector<u64>,
  max_qty: &vector<u64>,
  jobs: &vector<u8>,
  ox: u32,
  oz: u32,
  zsize: u32,
  bx: u32,
  bz: u32,
): (vector<u64>, vector<u64>, vector<u32>, vector<u32>) {
  let mut spawn_ids = vector<u64>[];
  let mut tmpl_idxs = vector<u64>[];
  let mut xs = vector<u32>[];
  let mut zs = vector<u32>[];
  let mut s = prng::rng_seed(prng::mix(seed, RES_SALT));
  let (s0, target_n) = p_roll_u64(s, min_n, max_n);
  s = s0;
  // zone ∩ world inclusive box (the last zone of a world may straddle the barrier) — the field-growth confinement
  let max_cx = { let m = ox + zsize - 1; if (m > bx - 1) bx - 1 else m };
  let max_cz = { let m = oz + zsize - 1; if (m > bz - 1) bz - 1 else m };
  while (xs.length() < target_n) {
    let (s1, opt) = p_pick_weighted(s, weights);
    s = s1;
    if (opt.is_none()) break;
    let idx = opt.destroy_some();
    let (s2, qty) = p_roll_u64(s, min_qty[idx], max_qty[idx]);
    s = s2;
    let (s3, ax, az) = p_roll_pos(s, ox, oz, zsize, bx, bz);
    s = s3;
    if (jobs[idx] <= MAX_GATHER_JOB) {
      // FIELD: grow k contiguous cells from the anchor; each cell is one bit (one plant, one harvest)
      let k = if (qty > CLUSTER_CAP) CLUSTER_CAP else qty;
      let (s4, cxs, czs) = p_grow_cluster(s, ax, az, k, ox, max_cx, oz, max_cz);
      s = s4;
      let cells = cxs.length();
      let mut c = 0;
      while (c < cells) {
        let (s5, sid_hi) = prng::rng_next(s);
        let (s6, sid_lo) = prng::rng_next(s5);
        s = s6;
        spawn_ids.push_back((sid_hi << 32) | sid_lo);
        tmpl_idxs.push_back(idx);
        xs.push_back(cxs[c]);
        zs.push_back(czs[c]);
        c = c + 1;
      };
    } else {
      // non-gather resource: ONE cell, one harvest (the one-bit collapse — no multi-charge nodes)
      let (s5, sid_hi) = prng::rng_next(s);
      let (s6, sid_lo) = prng::rng_next(s5);
      s = s6;
      spawn_ids.push_back((sid_hi << 32) | sid_lo);
      tmpl_idxs.push_back(idx);
      xs.push_back(ax);
      zs.push_back(az);
    };
  };
  (spawn_ids, tmpl_idxs, xs, zs)
}

/// LATTICE twin of `derive_resources` — identical table rolls, field growth and one-bit cells; the ONLY
/// difference is the ANCHOR, which comes from the placement lattice (`p_pick_grid_pos`, a fixed 3 draws) rather
/// than the unspaced 2-draw roll. The cursor advances once per ENTRY, not per cell: a grown field spends ONE
/// lattice cell for its anchor and then walks out of it normally, so fields still touch. The pool also caps the
/// entry count. Mirrored byte-for-byte in `zone_derive.js` (format 2).
public fun derive_resources_grid(
  seed: u64,
  min_n: u64,
  max_n: u64,
  weights: &vector<u64>,
  min_qty: &vector<u64>,
  max_qty: &vector<u64>,
  jobs: &vector<u8>,
  ox: u32,
  oz: u32,
  zsize: u32,
  bx: u32,
  bz: u32,
): (vector<u64>, vector<u64>, vector<u32>, vector<u32>) {
  let mut spawn_ids = vector<u64>[];
  let mut tmpl_idxs = vector<u64>[];
  let mut xs = vector<u32>[];
  let mut zs = vector<u32>[];
  let mut s = prng::rng_seed(prng::mix(seed, RES_SALT));
  let (s0, target_n) = p_roll_u64(s, min_n, max_n);
  s = s0;
  let (cols, mut pool) = grid_cell_pool(ox, oz, zsize, bx, bz);
  let mut anchor_i = 0;
  // zone ∩ world inclusive box (the last zone of a world may straddle the barrier) — the field-growth confinement
  let max_cx = { let m = ox + zsize - 1; if (m > bx - 1) bx - 1 else m };
  let max_cz = { let m = oz + zsize - 1; if (m > bz - 1) bz - 1 else m };
  while (xs.length() < target_n && anchor_i < pool.length()) {
    let (s1, opt) = p_pick_weighted(s, weights);
    s = s1;
    if (opt.is_none()) break;
    let idx = opt.destroy_some();
    let (s2, qty) = p_roll_u64(s, min_qty[idx], max_qty[idx]);
    let (s3, ax, az) = p_pick_grid_pos(s2, &mut pool, anchor_i, cols, ox, oz);
    s = s3;
    anchor_i = anchor_i + 1;
    if (jobs[idx] <= MAX_GATHER_JOB) {
      // FIELD: grow k contiguous cells from the anchor; each cell is one bit (one plant, one harvest)
      let k = if (qty > CLUSTER_CAP) CLUSTER_CAP else qty;
      let (s4, cxs, czs) = p_grow_cluster(s, ax, az, k, ox, max_cx, oz, max_cz);
      s = s4;
      let cells = cxs.length();
      let mut c = 0;
      while (c < cells) {
        let (s5, sid_hi) = prng::rng_next(s);
        let (s6, sid_lo) = prng::rng_next(s5);
        s = s6;
        spawn_ids.push_back((sid_hi << 32) | sid_lo);
        tmpl_idxs.push_back(idx);
        xs.push_back(cxs[c]);
        zs.push_back(czs[c]);
        c = c + 1;
      };
    } else {
      // non-gather resource: ONE cell, one harvest (the one-bit collapse — no multi-charge nodes)
      let (s5, sid_hi) = prng::rng_next(s);
      let (s6, sid_lo) = prng::rng_next(s5);
      s = s6;
      spawn_ids.push_back((sid_hi << 32) | sid_lo);
      tmpl_idxs.push_back(idx);
      xs.push_back(ax);
      zs.push_back(az);
    };
  };
  (spawn_ids, tmpl_idxs, xs, zs)
}

// ╔════════════════ [ Gather-field growth (prng twin of the retired grow_cluster) ] ═ ]

/// The SAME hashed-Prim's field walk the retired `world_math::grow_cluster` ran, threading the replayable
/// mulberry32 state instead of a Sui `RandomGenerator` (each offered cell takes ONE `rng_next` draw as its
/// priority, exactly where the `&Random` version drew `generate_u64`). Identical guarantees: `xs[0]`/`zs[0]` is
/// the anchor, every prefix is edge-connected, cells never leave the inclusive box (a boxed-in anchor grows a
/// smaller in-box field). Mirrored byte-for-byte in `zone_derive.js`.
fun p_grow_cluster(
  state: u64,
  ax: u32,
  az: u32,
  cap: u64,
  min_x: u32,
  max_x: u32,
  min_z: u32,
  max_z: u32,
): (u64, vector<u32>, vector<u32>) {
  let mut xs = vector[ax];
  let mut zs = vector[az];
  if (cap <= 1) return (state, xs, zs); // a 1-cell field is just the anchor — no growth, no draws
  let mut s = state;
  let mut seen_x = vector[ax];
  let mut seen_z = vector[az];
  let mut fx = vector<u32>[];
  let mut fz = vector<u32>[];
  let mut fp = vector<u64>[];
  s = p_offer(s, ax, az, min_x, max_x, min_z, max_z, &mut seen_x, &mut seen_z, &mut fx, &mut fz, &mut fp);
  while (xs.length() < cap && !fx.is_empty()) {
    let mut best = 0;
    let mut i = 1;
    let flen = fp.length();
    while (i < flen) {
      if (fp[i] < fp[best]) best = i;
      i = i + 1;
    };
    let cx = fx[best];
    let cz = fz[best];
    fx.swap_remove(best);
    fz.swap_remove(best);
    fp.swap_remove(best);
    xs.push_back(cx);
    zs.push_back(cz);
    s = p_offer(s, cx, cz, min_x, max_x, min_z, max_z, &mut seen_x, &mut seen_z, &mut fx, &mut fz, &mut fp);
  };
  (s, xs, zs)
}

/// Offer every in-box, not-yet-seen 4-neighbour of `(cx, cz)` into the frontier (one priority draw each).
fun p_offer(
  state: u64,
  cx: u32,
  cz: u32,
  min_x: u32,
  max_x: u32,
  min_z: u32,
  max_z: u32,
  seen_x: &mut vector<u32>,
  seen_z: &mut vector<u32>,
  fx: &mut vector<u32>,
  fz: &mut vector<u32>,
  fp: &mut vector<u64>,
): u64 {
  let mut s = state;
  if (cx < max_x) s = p_try_cell(s, cx + 1, cz, seen_x, seen_z, fx, fz, fp);
  if (cx > min_x) s = p_try_cell(s, cx - 1, cz, seen_x, seen_z, fx, fz, fp);
  if (cz < max_z) s = p_try_cell(s, cx, cz + 1, seen_x, seen_z, fx, fz, fp);
  if (cz > min_z) s = p_try_cell(s, cx, cz - 1, seen_x, seen_z, fx, fz, fp);
  s
}

/// Offer one candidate cell: if unseen, mark it seen and push it to the frontier with a fresh priority draw.
fun p_try_cell(
  state: u64,
  x: u32,
  z: u32,
  seen_x: &mut vector<u32>,
  seen_z: &mut vector<u32>,
  fx: &mut vector<u32>,
  fz: &mut vector<u32>,
  fp: &mut vector<u64>,
): u64 {
  if (contains_cell(seen_x, seen_z, x, z)) return state;
  let (s, priority) = prng::rng_next(state);
  seen_x.push_back(x);
  seen_z.push_back(z);
  fx.push_back(x);
  fz.push_back(z);
  fp.push_back(priority);
  s
}

/// `true` iff `(x, z)` already appears in the parallel `(vx, vz)` cell set.
fun contains_cell(vx: &vector<u32>, vz: &vector<u32>, x: u32, z: u32): bool {
  let mut i = 0;
  let n = vx.length();
  while (i < n) {
    if (vx[i] == x && vz[i] == z) return true;
    i = i + 1;
  };
  false
}
