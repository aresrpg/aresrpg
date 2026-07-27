// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// FORGEMAGIE real-`&Random`-ENTRY coverage: the money-core scribe/crush BODIES are proven deterministically in
/// `forgemagie_tests.move` through the `*_for_testing` seed twins; THIS file drives the two live `entry` doors
/// (`scribe_rune`, `crush`) that draw their seed from a framework `&Random`, so the thin entry wrappers (seed
/// draw + the 35-slot mint walk) are themselves exercised. Seeded framework Random via the standard
/// `create_for_testing` + first-round `update_randomness_state_for_testing` (@0x0) ceremony.
#[test_only]
module aresrpg_forgemagie::forgemagie_entry_tests;

use aresrpg::{admin::AdminCap, config::GameConfig, version::Version};
use aresrpg_forgemagie::{forge_world as test_world, forgemagie::{Self, CrushBoard}};
use aresrpg::{extract::ItemExtractPolicy, item::{Item, ItemTemplate}, item_stats::{Self, ItemStatistics}};
use kiosk::personal_kiosk::{Self, PersonalKioskCap};
use sui::{kiosk::Kiosk, random::{Self, Random}, test_scenario::{Self as ts, Scenario}, transfer_policy::TransferPolicy};

const OWNER: address = @0xA;
const SHIFT: u16 = 32_768;
const XP_L70: u64 = 156_481; // job curve: total xp to job level 70 (the scribe unlock)
const STR: u8 = 2; // catalog stat id: strength (Fo)
const TIER_BA: u8 = 1;

// ╔════════════════ [ Compact stage (mirror of forgemagie_tests::stage, trimmed to one Ba rune) ] ═ ]

/// Boot + a job-70 character + the CrushBoard with ONE registered strength(Ba) rune + a L50 sword template
/// carrying strength-max ranges. Returns (cid, sword_t, rune_t).
fun stage(sc: &mut Scenario): (ID, ID, ID) {
  test_world::boot(sc);
  let cid = test_world::mint_character(sc, OWNER);
  test_world::bank_job_xp(sc, OWNER, cid, 3, XP_L70);
  test_world::whitelist(sc, b"sword");
  test_world::whitelist(sc, b"rune");
  let sword_t = make_str_ranged(sc, b"Blade", b"blade", 50, 50);
  let rune_t = test_world::make_template(sc, b"RuneFo", b"rune_fo", b"rune", 1);

  sc.next_tx(OWNER);
  let cap = sc.take_from_sender<AdminCap>();
  let ver = sc.take_shared<Version>();
  forgemagie::create_board(&cap, &ver, sc.ctx());
  sc.next_tx(OWNER);
  let mut board = sc.take_shared<CrushBoard>();
  forgemagie::register_rune(&cap, &mut board, rune_t, STR, TIER_BA, &ver, sc.ctx());
  ts::return_shared(board); ts::return_shared(ver); sc.return_to_sender(cap);
  (cid, sword_t, rune_t)
}

fun uniform(v: u16): ItemStatistics { item_stats::new(v, v, v, v, v, v, v, v, v, v, v, v, v, v, v, v, v) }

/// Author a ranged sword template: strength max +`str_max`, all other columns flat SHIFT (only strength is
/// template-granted). Split port: ranges attach at authoring — `attach_ranges` is core-package-private.
fun make_str_ranged(sc: &mut Scenario, name: vector<u8>, item_type: vector<u8>, level: u16, str_max: u16): ID {
  let s = SHIFT;
  let max = item_stats::new(s, s, s + str_max, s, s, s, s, s, s, s, s, s, s, s, s, s, s);
  test_world::make_template_ranged(sc, name, item_type, b"sword", level, uniform(s), max)
}

fun set_rolled_str(sc: &mut Scenario, gear_id: ID, str_val: u16) {
  sc.next_tx(OWNER);
  let cfg = sc.take_shared<GameConfig>();
  let mut k = sc.take_shared<Kiosk>();
  let pkcap = sc.take_from_sender<PersonalKioskCap>();
  let s = SHIFT;
  forgemagie::set_rolled_for_testing(&cfg, &mut k, &pkcap, gear_id, item_stats::new(s, s, str_val, s, s, s, s, s, s, s, s, s, s, s, s, s, s));
  ts::return_shared(cfg); ts::return_shared(k); sc.return_to_sender(pkcap);
}

/// Seed a shared framework Random (create + first-round randomness update as @0x0), leaving it shared.
fun seed_random(sc: &mut Scenario, byte: u8) {
  sc.next_tx(@0x0);
  random::create_for_testing(sc.ctx());
  sc.next_tx(@0x0);
  let mut r = sc.take_shared<Random>();
  let bytes = vector[byte, byte, byte, byte, byte, byte, byte, byte, byte, byte, byte, byte, byte, byte, byte, byte,
    byte, byte, byte, byte, byte, byte, byte, byte, byte, byte, byte, byte, byte, byte, byte, byte];
  random::update_randomness_state_for_testing(&mut r, 0, bytes, sc.ctx());
  ts::return_shared(r);
}

fun kiosk_has(sc: &mut Scenario, id: ID): (bool, u32) {
  sc.next_tx(OWNER);
  let k = sc.take_shared<Kiosk>();
  let has = k.has_item(id); let count = k.item_count();
  ts::return_shared(k);
  (has, count)
}

// ╔════════════════ [ scribe_rune — the real &Random entry ] ══════════════════ ]

#[test]
/// The live `scribe_rune` entry: draws its roll seed from a framework `&Random`, consuming EXACTLY one rune unit
/// off the stack (the write-shape invariant that holds across all three outcomes — the deterministic per-outcome
/// audit is in `forgemagie_tests`). Proves the entry wrapper runs end to end.
fun scribe_rune_entry_consumes_one_unit() {
  let mut sc = ts::begin(OWNER);
  let (cid, sword_t, rune_t) = stage(&mut sc);
  let gear = test_world::mint_lock_gear(&mut sc, OWNER, sword_t);
  set_rolled_str(&mut sc, gear, SHIFT + 40);
  let stack = test_world::mint_lock_stack(&mut sc, OWNER, rune_t, 2); // qty-2: one unit leaves, remainder re-mints
  seed_random(&mut sc, 0x11);
  let (_, count_before) = kiosk_has(&mut sc, stack);

  sc.next_tx(OWNER);
  {
    let board = sc.take_shared<CrushBoard>();
    let mut k = sc.take_shared<Kiosk>();
    let pkcap = sc.take_from_sender<PersonalKioskCap>();
    let gear_tmpl = ts::take_shared_by_id<ItemTemplate>(&sc, sword_t);
    let rune_tmpl = ts::take_shared_by_id<ItemTemplate>(&sc, rune_t);
    let xpolicy = sc.take_shared<ItemExtractPolicy>();
    let mkt = sc.take_shared<TransferPolicy<Item>>();
    let cfg = sc.take_shared<aresrpg::config::GameConfig>();
    let ver = sc.take_shared<Version>();
    let r = sc.take_shared<Random>();
    forgemagie::scribe_rune(
      &board, &mut k, &pkcap, cid, gear, &gear_tmpl, stack, &rune_tmpl, &xpolicy, &mkt, &cfg, &ver, &r, sc.ctx(),
    );
    ts::return_shared(board); ts::return_shared(k); sc.return_to_sender(pkcap);
    ts::return_shared(gear_tmpl); ts::return_shared(rune_tmpl); ts::return_shared(xpolicy);
    ts::return_shared(mkt); ts::return_shared(cfg); ts::return_shared(ver); ts::return_shared(r);
  };

  let (old_alive, count_after) = kiosk_has(&mut sc, stack);
  assert!(!old_alive); // the qty-2 stack object was consumed…
  assert!(count_after == count_before); // …and a 1-unit remainder re-minted: exactly one unit left the economy
  sc.end();
}

// ╔════════════════ [ crush — the real &Random entry (35-slot mint walk) ] ════ ]

#[test]
/// The live `crush` entry: draws its seed from a framework `&Random`, then walks all 35 mint slots. A STATLESS
/// gear yields nothing (empty owed), so every slot no-ops and `assert_owed_empty` passes — the gear is destroyed
/// unconditionally (sealed crush law) and nothing is minted. Exercises the entry's seed draw + full 35-slot walk.
fun crush_entry_statless_destroys_and_mints_nothing() {
  let mut sc = ts::begin(OWNER);
  let (cid, sword_t, _rune_t) = stage(&mut sc);
  let husk = test_world::mint_lock_gear(&mut sc, OWNER, sword_t); // never set_rolled → statless → zero yield
  seed_random(&mut sc, 0x22);
  let (_, count_before) = kiosk_has(&mut sc, husk);

  sc.next_tx(OWNER);
  {
    let mut board = sc.take_shared<CrushBoard>();
    let mut k = sc.take_shared<Kiosk>();
    let pkcap = sc.take_from_sender<PersonalKioskCap>();
    let t = ts::take_shared_by_id<ItemTemplate>(&sc, sword_t); // one template ref, passed as gear_template + all 35 pads
    let xpolicy = sc.take_shared<ItemExtractPolicy>();
    let mkt = sc.take_shared<TransferPolicy<Item>>();
    let cfg = sc.take_shared<aresrpg::config::GameConfig>();
    let ver = sc.take_shared<Version>();
    let r = sc.take_shared<Random>();
    forgemagie::crush(
      &mut board, &mut k, &pkcap, cid, &t, vector[husk],
      &t, &t, &t, &t, &t, &t, &t, &t, &t, &t,
      &t, &t, &t, &t, &t, &t, &t, &t, &t, &t,
      &t, &t, &t, &t, &t, &t, &t, &t, &t, &t,
      &t, &t, &t, &t, &t,
      &xpolicy, &mkt, &cfg, &ver, &r, sc.ctx(),
    );
    ts::return_shared(board); ts::return_shared(k); sc.return_to_sender(pkcap);
    ts::return_shared(t); ts::return_shared(xpolicy); ts::return_shared(mkt);
    ts::return_shared(cfg); ts::return_shared(ver); ts::return_shared(r);
  };

  let (alive, count_after) = kiosk_has(&mut sc, husk);
  assert!(!alive); // destroyed unconditionally
  assert!(count_after == count_before - 1); // nothing minted, only the gear left
  sc.end();
}
