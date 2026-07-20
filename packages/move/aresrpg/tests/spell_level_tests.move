// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// SPELL_LEVEL spend-door test: `raise_spell_level` reads a cross-package `SpellTemplate` (class-matched to the
/// character), gates on the target level's `min_char_level` + the character's UNSPENT spell points, then invests
/// one level (spending `current` points). Drives it end to end off a kiosk-locked character leveled via the real
/// `grant_fight_xp` progression door, with a hand-built senshi SpellTemplate whose level-2 gate is low enough for
/// a level-3 character to clear. The template's 6 monotone band-valid levels mirror the `aresrpg_spells` fixture.
#[test_only]
module aresrpg::spell_level_tests;

use aresrpg::{character_link, config::GameConfig, spell_level, test_world, version::Version};
use aresrpg_foundation::{character_xp, spell, spell_effect::{Self, SpellLevel}};
use aresrpg_spells::{
  admin::{Self as spell_admin, AdminCap as SpellAdminCap},
  spell_template::{Self, SpellRegistry, SpellTemplate},
  version::{Self as spell_version, Version as SpellVersion}
};
use kiosk::personal_kiosk::{Self, PersonalKioskCap};
use std::unit_test::assert_eq;
use sui::{kiosk::Kiosk, test_scenario::{Self as ts, Scenario}};

const B: u64 = 40; // damage-budget base (mirrors the aresrpg_spells fixture dials)
const P: u64 = 5; // damage-budget per-level slope

fun fire(): u8 { spell::el_fire() }

/// One band-legal spell level (ap 4, range 1..4, LOS, ap-bounded casts, crit → +10 base).
fun lvl(min_char_level: u16, base: u64): SpellLevel {
  spell_effect::new_spell_level(
    min_char_level, 4, 1, 4, false, false, true, false, 255, 255, 0, 50, false, vector[], vector[],
    vector[spell_effect::damage(fire(), base)],
    vector[spell_effect::damage(fire(), base + 10)],
  )
}

/// 6 monotone levels with LOW early gates (level 2 requires char level 2), L6 = unlock(1) + 100 = 101.
fun levels(): vector<SpellLevel> {
  vector[lvl(1, 15), lvl(2, 17), lvl(3, 19), lvl(4, 21), lvl(5, 23), lvl(101, 25)]
}

/// Stand up `aresrpg_spells` and mint one senshi spell (class-matched to `test_world::mint_character`), returning
/// its shared-object id.
fun mint_senshi_spell(sc: &mut Scenario): ID {
  spell_version::test_init(sc.ctx());
  spell_admin::test_init(sc.ctx());
  spell_template::test_init(sc.ctx());

  sc.next_tx(test_world::owner());
  let cap = sc.take_from_sender<SpellAdminCap>();
  let mut reg = sc.take_shared<SpellRegistry>();
  let sver = sc.take_shared<SpellVersion>();
  let sid = spell_template::mint_spell(
    &cap, &mut reg, b"senshi".to_string(), 1, b"fireball".to_string(), levels(), B, P, &sver, sc.ctx(),
  );
  ts::return_shared(reg); ts::return_shared(sver); sc.return_to_sender(cap);
  sid
}

/// Grant fight xp to raise the kiosk-locked character to the stored level for `target_xp` (the real progression
/// door — births the progression block from base experience 0).
fun level_up(sc: &mut Scenario, cid: ID, target_xp: u64) {
  sc.next_tx(test_world::owner());
  let mut k = sc.take_shared<Kiosk>();
  let pkcap = sc.take_from_sender<PersonalKioskCap>();
  let cfg = sc.take_shared<GameConfig>();
  let ver = sc.take_shared<Version>();
  {
    let chr = k.borrow_mut(personal_kiosk::borrow(&pkcap), cid);
    character_link::grant_fight_xp(&cfg, chr, target_xp, &ver);
  };
  ts::return_shared(k); sc.return_to_sender(pkcap); ts::return_shared(cfg); ts::return_shared(ver);
}

#[test]
/// The full spend: a level-3 senshi (2 unspent points) raises its class fireball from the free baseline (1) to
/// level 2 — the target gate (char level 2) clears, the cost (current level = 1 point) is paid, and the invested
/// level round-trips to 2 while unspent points drop by exactly one.
fun raise_spell_level_invests_one_level() {
  let mut sc = ts::begin(test_world::owner());
  test_world::boot(&mut sc);
  let cid = test_world::mint_character(&mut sc, test_world::owner());
  level_up(&mut sc, cid, character_xp::xp_for_level(3)); // stored level 3 → 2 unspent points
  let sid = mint_senshi_spell(&mut sc);

  // pre: free baseline level 1, 2 unspent points
  sc.next_tx(test_world::owner());
  {
    let k = sc.take_shared<Kiosk>();
    let pkcap = sc.take_from_sender<PersonalKioskCap>();
    let chr = k.borrow<aresrpg::character::Character>(personal_kiosk::borrow(&pkcap), cid);
    assert_eq!(character_link::spell_level(chr, sid), 1);
    assert_eq!(character_link::unspent_spell_points(chr), 2);
    ts::return_shared(k); sc.return_to_sender(pkcap);
  };

  // RAISE via the real door
  sc.next_tx(test_world::owner());
  {
    let mut k = sc.take_shared<Kiosk>();
    let pkcap = sc.take_from_sender<PersonalKioskCap>();
    let spell = sc.take_shared<SpellTemplate>();
    let ver = sc.take_shared<Version>();
    spell_level::raise_spell_level(&mut k, &pkcap, cid, &spell, &ver);
    ts::return_shared(k); sc.return_to_sender(pkcap); ts::return_shared(spell); ts::return_shared(ver);
  };

  // post: invested level 2, one point spent (2 → 1 unspent)
  sc.next_tx(test_world::owner());
  {
    let k = sc.take_shared<Kiosk>();
    let pkcap = sc.take_from_sender<PersonalKioskCap>();
    let chr = k.borrow<aresrpg::character::Character>(personal_kiosk::borrow(&pkcap), cid);
    assert_eq!(character_link::spell_level(chr, sid), 2);
    assert_eq!(character_link::spell_points_spent(chr), 1);
    assert_eq!(character_link::unspent_spell_points(chr), 1);
    ts::return_shared(k); sc.return_to_sender(pkcap);
  };
  sc.end();
}
