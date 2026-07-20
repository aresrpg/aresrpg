/// CHARACTER_LINK spell-ledger + progression-read tests: the per-spell invested-level slot (set → read), the
/// running spent-spell-points counter (add → read), the DERIVED unspent-points view (saturating floor at 0), and
/// the live progression HP read (born via a fight HP write-back). These are the `public(package)` write doors the
/// `spell_level` spend door composes and the free reads the fight snapshot consumes — driven directly here off a
/// kiosk-locked character (a fabricated spell ID stands in for a real cross-package SpellTemplate, since these DFs
/// key on a plain `ID`).
#[test_only]
module aresrpg::character_link_tests;

use aresrpg::{character_link, test_world, version::Version};
use kiosk::personal_kiosk::{Self, PersonalKioskCap};
use std::unit_test::assert_eq;
use sui::{kiosk::Kiosk, test_scenario::{Self as ts}};

// A stand-in spell identity — `SpellLevelKey` keys on a plain `ID`, so no real SpellTemplate is needed to exercise
// the per-spell invested-level slot.
fun spell_id(): ID { object::id_from_address(@0x5EED) }

#[test]
/// The full write→read round-trip: an invested spell level is stored and read back; spent points accumulate; the
/// unspent view floors at 0 once spending exceeds anything earnable; and the progression HP read reflects a fight
/// HP write-back. One character, one borrow-mut block for the writes, a fresh tx for the free reads.
fun spell_ledger_and_progression_hp_roundtrip() {
  let mut sc = ts::begin(test_world::owner());
  test_world::boot(&mut sc);
  let cid = test_world::mint_character(&mut sc, test_world::owner());
  let sid = spell_id();

  // ── writes (as the test_world sender; game enabled by boot) ──
  sc.next_tx(test_world::owner());
  {
    let mut k = sc.take_shared<Kiosk>();
    let pkcap = sc.take_from_sender<PersonalKioskCap>();
    let ver = sc.take_shared<Version>();
    {
      let chr = k.borrow_mut(personal_kiosk::borrow(&pkcap), cid);
      character_link::set_spell_level(chr, sid, 3, &ver); // invest this spell to level 3
      character_link::add_spell_points_spent(chr, 1_000_000, &ver); // spend far more than any earnable total
      character_link::write_back_hp(chr, 42, 1000, &ver); // births the progression block with hp = 42
    };
    ts::return_shared(k);
    sc.return_to_sender(pkcap);
    ts::return_shared(ver);
  };

  // ── free reads ──
  sc.next_tx(test_world::owner());
  {
    let k = sc.take_shared<Kiosk>();
    let pkcap = sc.take_from_sender<PersonalKioskCap>();
    let chr = k.borrow(personal_kiosk::borrow(&pkcap), cid);
    assert_eq!(character_link::spell_level(chr, sid), 3); // the invested level round-trips
    assert_eq!(character_link::spell_points_spent(chr), 1_000_000); // spent counter accumulated
    assert_eq!(character_link::unspent_spell_points(chr), 0); // spent >> earnable → saturating floor
    assert_eq!(character_link::progression_hp(chr), 42); // live block HP read
    ts::return_shared(k);
    sc.return_to_sender(pkcap);
  };
  sc.end();
}

#[test]
/// A never-invested spell reads the free baseline level 1 (absent slot), and a fresh character has 0 spent points —
/// the absent-slot default branches of the two spell readers.
fun spell_defaults_when_absent() {
  let mut sc = ts::begin(test_world::owner());
  test_world::boot(&mut sc);
  let cid = test_world::mint_character(&mut sc, test_world::owner());

  sc.next_tx(test_world::owner());
  let k = sc.take_shared<Kiosk>();
  let pkcap = sc.take_from_sender<PersonalKioskCap>();
  let chr = k.borrow(personal_kiosk::borrow(&pkcap), cid);
  assert_eq!(character_link::spell_level(chr, spell_id()), 1); // absent → baseline 1
  assert_eq!(character_link::spell_points_spent(chr), 0); // never spent
  ts::return_shared(k);
  sc.return_to_sender(pkcap);
  sc.end();
}
