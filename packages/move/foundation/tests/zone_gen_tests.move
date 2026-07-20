/// ZONE GEN TESTS — the seed-derived zone composition kernel (search-cost rework + the 20-block spawn-spacing
/// law). The PARITY tests pin reference vectors captured LIVE from the JS mirror `packages/sim/src/zone_derive.js`
/// (its own suite `zone_derive.test.js` asserts the identical vectors) — if either side drifts, one suite fails
/// before the map can lie to a player about the fight the chain would materialise.
#[test_only]
module aresrpg_foundation::zone_gen_tests;

use aresrpg_foundation::zone_gen;

// ╔════════════════ [ Mob-group derivation ] ═══════════════════════════════════ ]

#[test]
/// PARITY CONTRACT — `derive_mob_groups` reproduces the JS mirror BYTE-FOR-BYTE. Vectors: seed 123456789 · fixed
/// 8 groups · weights [100,50] · group bands [1..6]/[2..6] · size_bound 6 · zone box (0,0) 512 wide, 500k world.
fun t_derive_mob_groups_matches_js_mirror() {
  let (sids, idxs, xs, zs, sizes, seeds) = zone_gen::derive_mob_groups(
    123456789, 8, 8, &vector[100, 50], &vector[1, 2], &vector[6, 6], 6, 0, 0, 512, 500000, 500000);
  assert!(xs.length() == 8, 0);
  // group 0
  assert!(idxs[0] == 0 && xs[0] == 510 && zs[0] == 404 && sizes[0] == 2 && seeds[0] == 2711362666 && sids[0] == 4560507522876923188, 1);
  // group 1
  assert!(idxs[1] == 1 && xs[1] == 127 && zs[1] == 313 && sizes[1] == 6 && seeds[1] == 4214906596 && sids[1] == 148739572111110642, 2);
  // group 4 (mid-stream)
  assert!(idxs[4] == 1 && xs[4] == 213 && zs[4] == 278 && sizes[4] == 3 && seeds[4] == 572914111 && sids[4] == 665305103150388313, 3);
  // group 7 (last)
  assert!(idxs[7] == 1 && xs[7] == 63 && zs[7] == 92 && sizes[7] == 6 && seeds[7] == 1370609044 && sids[7] == 522455783208353171, 4);
}

#[test]
/// THE SPAWN-SPACING LAW as a PROPERTY test (minimum distance of 20 blocks
/// between each spawn of mobs): derive 8 groups for MANY seeds → EVERY pair is ≥ 20 blocks apart (squared ≥ 400).
/// Deterministic rejection sampling inside the derivation guarantees it BY CONSTRUCTION, on chain and in JS alike.
fun t_derive_mob_groups_spacing_law_holds() {
  let mut seed = 1u64;
  while (seed <= 60) {
    let (_s, _i, xs, zs, _sz, _gs) = zone_gen::derive_mob_groups(
      seed, 8, 8, &vector[100, 50], &vector[1, 2], &vector[6, 6], 6, 0, 0, 512, 500000, 500000);
    let n = xs.length();
    let mut a = 0;
    while (a < n) {
      let mut b = a + 1;
      while (b < n) {
        let dx = if (xs[a] >= xs[b]) (xs[a] - xs[b]) as u64 else (xs[b] - xs[a]) as u64;
        let dz = if (zs[a] >= zs[b]) (zs[a] - zs[b]) as u64 else (zs[b] - zs[a]) as u64;
        assert!(dx * dx + dz * dz >= 400, seed);
        b = b + 1;
      };
      a = a + 1;
    };
    seed = seed + 1;
  };
}

#[test]
/// Determinism + confinement: the SAME seed regrows the IDENTICAL list, and every position sits inside the zone
/// box ∩ world bounds (a straddling last zone clamps in, never off).
fun t_derive_mob_groups_deterministic_and_confined() {
  let (s1, i1, x1, z1, z1s, g1) = zone_gen::derive_mob_groups(
    999, 5, 5, &vector[10, 20, 30], &vector[1, 1, 1], &vector[4, 4, 4], 5, 100, 200, 256, 400000, 400000);
  let (s2, i2, x2, z2, z2s, g2) = zone_gen::derive_mob_groups(
    999, 5, 5, &vector[10, 20, 30], &vector[1, 1, 1], &vector[4, 4, 4], 5, 100, 200, 256, 400000, 400000);
  assert!(s1 == s2 && i1 == i2 && x1 == x2 && z1 == z2 && z1s == z2s && g1 == g2, 0);
  let n = x1.length();
  let mut i = 0;
  while (i < n) {
    assert!(x1[i] >= 100 && x1[i] < 356 && z1[i] >= 200 && z1[i] < 456, 1);
    i = i + 1;
  };
}

#[test]
/// An all-zero weight table derives ZERO groups (starved pick breaks the loop, never hangs or aborts).
fun t_derive_mob_groups_starved_table_is_empty() {
  let (sids, _i, xs, _z, _sz, _gs) = zone_gen::derive_mob_groups(
    7, 3, 3, &vector[0, 0], &vector[1, 1], &vector[6, 6], 6, 0, 0, 512, 500000, 500000);
  assert!(sids.length() == 0 && xs.length() == 0, 0);
}

// ╔════════════════ [ Resource-cell derivation (one-harvest / one-bit) ] ═══════ ]

#[test]
/// PARITY CONTRACT — `derive_resources` reproduces the JS mirror BYTE-FOR-BYTE. Vectors: seed 424242 · target 8 ·
/// FARMER (job 0) + non-gather (job 5), both qty 6 / weights 100 · zone (0,0) 512 wide, 500k world. The stream
/// happened to pick the FARMER row twice → two 6-cell FIELDS (12 cells total, overshooting the target — the
/// legacy row-counting shape).
fun t_derive_resources_matches_js_mirror() {
  let (sids, idxs, xs, zs) = zone_gen::derive_resources(
    424242, 8, 8, &vector[100, 100], &vector[6, 6], &vector[6, 6], &vector[0, 5], 0, 0, 512, 500000, 500000);
  assert!(xs.length() == 12, 0);
  // field 1 anchor + sample cells (the anchor is ALWAYS cell 0 of its pick)
  assert!(idxs[0] == 0 && xs[0] == 11 && zs[0] == 40 && sids[0] == 4278267242700732727, 1);
  assert!(idxs[1] == 0 && xs[1] == 12 && zs[1] == 40 && sids[1] == 6634652389384369540, 2);
  assert!(idxs[5] == 0 && xs[5] == 13 && zs[5] == 39 && sids[5] == 13261909094981075068, 3);
  // field 2 anchor + last cell
  assert!(idxs[6] == 0 && xs[6] == 245 && zs[6] == 162 && sids[6] == 14448448036690126015, 4);
  assert!(idxs[11] == 0 && xs[11] == 243 && zs[11] == 162 && sids[11] == 390510390697315139, 5);
}

#[test]
/// Non-gather branch parity (job > 2): ONE cell per pick, one harvest, one bit — the one-bit collapse
/// (07-13 ruling: 2110/2110 seeded resources were remaining:1; the multi-charge branch carried zero real data).
fun t_derive_resources_non_gather_single_cells_match_js() {
  let (sids, idxs, xs, zs) = zone_gen::derive_resources(
    424242, 3, 3, &vector[100], &vector[4], &vector[4], &vector[5], 0, 0, 512, 500000, 500000);
  assert!(xs.length() == 3, 0); // 3 picks → exactly 3 single cells (no field growth for job 5)
  assert!(idxs[0] == 0 && xs[0] == 11 && zs[0] == 40 && sids[0] == 2975216761506653025, 1);
  assert!(idxs[1] == 0 && xs[1] == 379 && zs[1] == 15 && sids[1] == 12390894354587740079, 2);
  assert!(idxs[2] == 0 && xs[2] == 494 && zs[2] == 395 && sids[2] == 13191861150870521758, 3);
}

#[test]
/// A gather pick's field is CONTIGUOUS: every cell after its anchor is edge-adjacent (Manhattan 1) to an earlier
/// cell of the SAME pick — the wheat-field law survives the derivation port.
fun t_derive_resources_fields_are_contiguous() {
  let (_s, _i, xs, zs) = zone_gen::derive_resources(
    424242, 8, 8, &vector[100, 100], &vector[6, 6], &vector[6, 6], &vector[0, 5], 0, 0, 512, 500000, 500000);
  // cells 0..5 = field 1, cells 6..11 = field 2 (the parity vector above pins this layout)
  assert!(connected(&xs, &zs, 0, 6), 0);
  assert!(connected(&xs, &zs, 6, 12), 1);
}

#[test]
/// Determinism: the SAME seed rederives the IDENTICAL cell list.
fun t_derive_resources_deterministic() {
  let (a1, b1, c1, d1) = zone_gen::derive_resources(
    77, 5, 5, &vector[100], &vector[3, 3], &vector[3, 3], &vector[1], 0, 0, 256, 400000, 400000);
  let (a2, b2, c2, d2) = zone_gen::derive_resources(
    77, 5, 5, &vector[100], &vector[3, 3], &vector[3, 3], &vector[1], 0, 0, 256, 400000, 400000);
  assert!(a1 == a2 && b1 == b2 && c1 == c2 && d1 == d2, 0);
}

/// Every cell in `[from, to)` (after the first) edge-adjacent to an EARLIER cell of the range — one connected blob.
fun connected(xs: &vector<u32>, zs: &vector<u32>, from: u64, to: u64): bool {
  let mut k = from + 1;
  while (k < to) {
    let mut adjacent = false;
    let mut j = from;
    while (j < k) {
      let dx = if (xs[k] >= xs[j]) xs[k] - xs[j] else xs[j] - xs[k];
      let dz = if (zs[k] >= zs[j]) zs[k] - zs[j] else zs[j] - zs[k];
      if (((dx as u64) + (dz as u64)) == 1) { adjacent = true; break };
      j = j + 1;
    };
    if (!adjacent) return false;
    k = k + 1;
  };
  true
}
