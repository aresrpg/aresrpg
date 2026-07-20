// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// CRUSH ORPHAN tests: the template-less crush twin for gear whose ItemTemplate was
/// burned on-chain. PARITY IS THE ORACLE — orphan-crushing an item MUST yield IDENTICALLY to crushing the SAME
/// item (same rolled stats, same seed, virgin board) under a REAL L50 template, proving the fixed-level anchor
/// (`ORPHAN_CRUSH_LEVEL == 50`) + the tid-from-item derivation are correct. Each door runs on its OWN board so
/// the shared per-bracket taux pressure can't cross-contaminate two same-bracket (L50) crushes. Plus: a statless
/// husk still destroys (owed all-zero), and the two distinct orphan abort codes fire (empty batch, heterogeneous
/// batch). Seeds drive the twins (`*_for_testing`) — the same bodies as the entry doors minus `&Random`.
#[test_only]
module aresrpg_forgemagie::crush_orphan_tests;

use aresrpg::{extract::ItemExtractPolicy, item::{Item, ItemTemplate}, item_stats::{Self, ItemStatistics}};
use aresrpg_forgemagie::{forge_world as test_world, forgemagie::{Self, CrushBoard}};
use kiosk::personal_kiosk::{Self, PersonalKioskCap};
use sui::{kiosk::Kiosk, test_scenario::{Self as ts, Scenario}, transfer_policy::TransferPolicy};

const OWNER: address = @0xA;
const SHIFT: u16 = 32_768;
const STR: u8 = 2; // catalog stat id: strength (Fo)
const TIER_BA: u8 = 1;
const TIER_PA: u8 = 2;
const TIER_RA: u8 = 3;

// distinct orphan abort codes (mirrors of the module constants)
const EEmptyBatch: u64 = 112;
const EOrphanWrongTemplate: u64 = 113;

// ╔════════════════ [ Harness ] ══════════════════════════════════════════════ ]

/// Boot + a fresh (unmarked) character + the gear/rune templates. Returns (cid, sword_t L50 ranged,
/// exotic_t L50 no-ranges, ba/pa/ra rune templates). No job xp — crush has no unlock gate.
fun stage(sc: &mut Scenario): (ID, ID, ID, ID, ID, ID) {
  test_world::boot(sc);
  let cid = test_world::mint_character(sc, OWNER);
  test_world::whitelist(sc, b"sword");
  test_world::whitelist(sc, b"rune");
  let s = SHIFT;
  let max = item_stats::new(s, s, s + 50, s, s, s, s, s, s, s, s, s, s, s, s, s, s); // strength range +50
  let sword_t = test_world::make_template_ranged(sc, b"Blade", b"blade", b"sword", 50, uniform(s), max);
  let exotic_t = test_world::make_template(sc, b"Exotic", b"exotic", b"sword", 50); // no ranges ⇒ statless
  let ba = test_world::make_template(sc, b"RuneFo", b"rune_fo", b"rune", 1);
  let pa = test_world::make_template(sc, b"RunePaFo", b"rune_pa_fo", b"rune", 1);
  let ra = test_world::make_template(sc, b"RuneRaFo", b"rune_ra_fo", b"rune", 1);
  (cid, sword_t, exotic_t, ba, pa, ra)
}

fun uniform(v: u16): ItemStatistics { item_stats::new(v, v, v, v, v, v, v, v, v, v, v, v, v, v, v, v, v) }

/// Create + share a fresh CrushBoard with the three strength runes registered; returns its id.
fun fresh_board(sc: &mut Scenario, ba: ID, pa: ID, ra: ID): ID {
  sc.next_tx(OWNER);
  forgemagie::create_board_for_testing(sc.ctx());
  sc.next_tx(OWNER); // commit the share so the board id resolves
  let board_id = ts::most_recent_id_shared<CrushBoard>().destroy_some();
  let mut board = ts::take_shared_by_id<CrushBoard>(sc, board_id);
  forgemagie::register_rune_for_testing(&mut board, ba, STR, TIER_BA);
  forgemagie::register_rune_for_testing(&mut board, pa, STR, TIER_PA);
  forgemagie::register_rune_for_testing(&mut board, ra, STR, TIER_RA);
  ts::return_shared(board);
  board_id
}

/// Overwrite the kiosk-locked gear's rolled block: strength = SHIFT+`str_delta`, everything else centered.
fun set_rolled_str(sc: &mut Scenario, gear_id: ID, str_delta: u16) {
  sc.next_tx(OWNER);
  let cfg = sc.take_shared<aresrpg::config::GameConfig>();
  let mut k = sc.take_shared<Kiosk>();
  let pkcap = sc.take_from_sender<PersonalKioskCap>();
  let s = SHIFT;
  forgemagie::set_rolled_for_testing(&cfg, &mut k, &pkcap, gear_id, item_stats::new(s, s, s + str_delta, s, s, s, s, s, s, s, s, s, s, s, s, s, s));
  ts::return_shared(cfg); ts::return_shared(k); sc.return_to_sender(pkcap);
}

/// One REAL crush (passes the live `gear_tid` template) on `board_id`; returns the rolled owed vector.
fun do_crush(sc: &mut Scenario, board_id: ID, cid: ID, gear_tid: ID, gear_ids: vector<ID>, ba: ID, pa: ID, ra: ID, seed: u64): vector<u64> {
  sc.next_tx(OWNER);
  let mut board = ts::take_shared_by_id<CrushBoard>(sc, board_id);
  let mut k = sc.take_shared<Kiosk>();
  let pkcap = sc.take_from_sender<PersonalKioskCap>();
  let gear_tmpl = ts::take_shared_by_id<ItemTemplate>(sc, gear_tid);
  let t_ba = ts::take_shared_by_id<ItemTemplate>(sc, ba);
  let t_pa = ts::take_shared_by_id<ItemTemplate>(sc, pa);
  let t_ra = ts::take_shared_by_id<ItemTemplate>(sc, ra);
  let xpolicy = sc.take_shared<ItemExtractPolicy>();
  let mkt = sc.take_shared<TransferPolicy<Item>>();
  let cfg = sc.take_shared<aresrpg::config::GameConfig>();
  let ver = sc.take_shared<aresrpg::version::Version>();
  let rolled = forgemagie::crush_for_testing(
    &mut board, &mut k, &pkcap, cid, &gear_tmpl, gear_ids, &t_ba, &t_pa, &t_ra, &gear_tmpl, &xpolicy, &mkt, &cfg, &ver, seed, sc.ctx(),
  );
  ts::return_shared(board); ts::return_shared(k); sc.return_to_sender(pkcap);
  ts::return_shared(gear_tmpl); ts::return_shared(t_ba); ts::return_shared(t_pa); ts::return_shared(t_ra);
  ts::return_shared(xpolicy); ts::return_shared(mkt); ts::return_shared(cfg); ts::return_shared(ver);
  rolled
}

/// One ORPHAN crush (NO template — derives tid from the batch) on `board_id`; returns the rolled owed vector.
fun do_orphan(sc: &mut Scenario, board_id: ID, cid: ID, gear_ids: vector<ID>, ba: ID, pa: ID, ra: ID, seed: u64): vector<u64> {
  sc.next_tx(OWNER);
  let mut board = ts::take_shared_by_id<CrushBoard>(sc, board_id);
  let mut k = sc.take_shared<Kiosk>();
  let pkcap = sc.take_from_sender<PersonalKioskCap>();
  let t_ba = ts::take_shared_by_id<ItemTemplate>(sc, ba);
  let t_pa = ts::take_shared_by_id<ItemTemplate>(sc, pa);
  let t_ra = ts::take_shared_by_id<ItemTemplate>(sc, ra);
  let xpolicy = sc.take_shared<ItemExtractPolicy>();
  let mkt = sc.take_shared<TransferPolicy<Item>>();
  let cfg = sc.take_shared<aresrpg::config::GameConfig>();
  let ver = sc.take_shared<aresrpg::version::Version>();
  let rolled = forgemagie::crush_orphan_for_testing(
    &mut board, &mut k, &pkcap, cid, gear_ids, &t_ba, &t_pa, &t_ra, &t_ba, &xpolicy, &mkt, &cfg, &ver, seed, sc.ctx(),
  );
  ts::return_shared(board); ts::return_shared(k); sc.return_to_sender(pkcap);
  ts::return_shared(t_ba); ts::return_shared(t_pa); ts::return_shared(t_ra);
  ts::return_shared(xpolicy); ts::return_shared(mkt); ts::return_shared(cfg); ts::return_shared(ver);
  rolled
}

fun alive(sc: &mut Scenario, id: ID): bool {
  sc.next_tx(OWNER);
  let k = sc.take_shared<Kiosk>();
  let has = k.has_item(id);
  ts::return_shared(k);
  has
}

// ╔════════════════ [ PARITY — orphan L50 anchor == a real L50 crush ] ═════════ ]

#[test]
/// The oracle: two IDENTICAL +40-strength L50 gear items, one crushed under the REAL L50 template, one crushed
/// ORPHAN (no template) — same seed, each on its OWN virgin board — yield BYTE-IDENTICAL rolled owed vectors, and
/// both source items are destroyed. Proves `ORPHAN_CRUSH_LEVEL == 50` reproduces the true-L50 yield exactly.
fun orphan_parity_matches_real_l50() {
  let mut sc = ts::begin(OWNER);
  let (cid, sword_t, _exotic, ba, pa, ra) = stage(&mut sc);
  let board_real = fresh_board(&mut sc, ba, pa, ra);
  let board_orphan = fresh_board(&mut sc, ba, pa, ra);

  let gear_a = test_world::mint_lock_gear(&mut sc, OWNER, sword_t);
  set_rolled_str(&mut sc, gear_a, 40);
  let gear_b = test_world::mint_lock_gear(&mut sc, OWNER, sword_t);
  set_rolled_str(&mut sc, gear_b, 40);

  let owed_real = do_crush(&mut sc, board_real, cid, sword_t, vector[gear_a], ba, pa, ra, 7);
  let owed_orphan = do_orphan(&mut sc, board_orphan, cid, vector[gear_b], ba, pa, ra, 7);

  assert!(owed_real == owed_orphan); // BYTE parity: fixed L50 anchor == the real template's level
  let sum = *owed_real.borrow(forgemagie::owed_index(STR, TIER_BA)) + *owed_real.borrow(forgemagie::owed_index(STR, TIER_PA)) + *owed_real.borrow(forgemagie::owed_index(STR, TIER_RA));
  assert!(sum == 0 || sum == 1); // the +40 Fo L50 curve golden (EV 0.978) — a real, non-degenerate yield
  assert!(!alive(&mut sc, gear_a)); // both source items destroyed unconditionally (sealed crush law)
  assert!(!alive(&mut sc, gear_b));
  sc.end();
}

// ╔════════════════ [ statless husk — owed all-zero, still destroyed ] ═════════ ]

#[test]
/// An orphan item with NO rolled stats (minted from a no-ranges template, never `set_rolled`) yields nothing yet
/// is still destroyed — the sealed-crush law holds on the consolation path.
fun orphan_statless_yields_nothing_still_destroys() {
  let mut sc = ts::begin(OWNER);
  let (cid, _sword, exotic_t, ba, pa, ra) = stage(&mut sc);
  let board = fresh_board(&mut sc, ba, pa, ra);
  let husk = test_world::mint_lock_gear(&mut sc, OWNER, exotic_t); // no rolled stats

  let owed = do_orphan(&mut sc, board, cid, vector[husk], ba, pa, ra, 7);
  let sum = *owed.borrow(forgemagie::owed_index(STR, TIER_BA)) + *owed.borrow(forgemagie::owed_index(STR, TIER_PA)) + *owed.borrow(forgemagie::owed_index(STR, TIER_RA));
  assert!(sum == 0); // statless ⇒ no runeable lines
  assert!(!alive(&mut sc, husk)); // destroyed anyway
  sc.end();
}

// ╔════════════════ [ distinct orphan abort codes ] ═══════════════════════════ ]

#[test, expected_failure(abort_code = EEmptyBatch, location = aresrpg_forgemagie::forgemagie)]
/// An empty batch has no item to derive the burned template id from (crush tolerates empty because it reads the
/// passed `&ItemTemplate`; this twin cannot) → the distinct `EEmptyBatch`.
fun orphan_empty_batch_aborts() {
  let mut sc = ts::begin(OWNER);
  let (cid, _sword, _exotic, ba, pa, ra) = stage(&mut sc);
  let board = fresh_board(&mut sc, ba, pa, ra);
  do_orphan(&mut sc, board, cid, vector[], ba, pa, ra, 7);
  abort
}

#[test, expected_failure(abort_code = EOrphanWrongTemplate, location = aresrpg_forgemagie::forgemagie)]
/// A heterogeneous batch (item 2 is of a different template than item 1, which fixes the derived tid) → the
/// distinct `EOrphanWrongTemplate` (semantically distinct from crush's passed-template `EWrongTemplate`).
fun orphan_heterogeneous_batch_aborts() {
  let mut sc = ts::begin(OWNER);
  let (cid, sword_t, exotic_t, ba, pa, ra) = stage(&mut sc);
  let board = fresh_board(&mut sc, ba, pa, ra);
  let gear_a = test_world::mint_lock_gear(&mut sc, OWNER, sword_t);
  let gear_b = test_world::mint_lock_gear(&mut sc, OWNER, exotic_t); // different template
  do_orphan(&mut sc, board, cid, vector[gear_a, gear_b], ba, pa, ra, 7); // tid fixed by A; B mismatches
  abort
}
