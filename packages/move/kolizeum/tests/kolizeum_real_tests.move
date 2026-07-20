/// KOLIZEUM real-door tests: the PUBLIC `create_public` + `join` entries read the fighter's AUTHENTIC on-chain
/// level off a real kiosk-locked `Character` (the money-core unit suite injects the level via `*_for_testing`;
/// THIS drives the real level-reading doors). The kolizeum level gate is lowered to 1 so a fresh level-1 character
/// clears it. `start`/`seat`/`settle` require the full fight engine and are left to the localnet layer.
#[test_only]
module aresrpg_kolizeum::kolizeum_real_tests;

use aresrpg::{
  character::{Self, Character},
  config::GameConfig,
  version::Version
};
use aresrpg_kolizeum::{kolizeum::{Self, Kolizeum}, koli_world};
use aresrpg_social::{
  admin::{Self as social_admin, AdminCap as SocialAdminCap},
  friends::{Self, FriendList, FriendRegistry},
  version::{Self as social_version, Version as SocialVersion}
};
use kiosk::personal_kiosk::{Self, PersonalKioskCap};
use std::unit_test::{assert_eq, destroy};
use sui::{coin, kiosk::{Self, Kiosk}, sui::SUI, test_scenario::{Self as ts, Scenario}, transfer_policy::TransferPolicy};

const JOINER: address = @0xB1;
const PLEDGE: u64 = 1_000;

#[test]
/// `create_public` (creator level read off the real character, pot seeded) then `join` (a second player's level
/// read off THEIR character, auto-balanced onto side B). The joiner's character rides a LOCAL personal kiosk so
/// the single shared kiosk (the creator's) stays unambiguous.
fun create_public_and_join_real_characters() {
  let mut sc = ts::begin(koli_world::owner());
  koli_world::boot(&mut sc);
  koli_world::open_gate(&mut sc);
  let creator_cid = koli_world::mint_character(&mut sc, koli_world::owner());

  // CREATE — borrow the creator's character read-only out of its shared kiosk
  sc.next_tx(koli_world::owner());
  {
    let k = sc.take_shared<Kiosk>();
    let pkcap = sc.take_from_sender<PersonalKioskCap>();
    let cfg = sc.take_shared<GameConfig>();
    let ver = sc.take_shared<Version>();
    let pay = coin::mint_for_testing<SUI>(PLEDGE, sc.ctx());
    let chr = k.borrow<Character>(personal_kiosk::borrow(&pkcap), creator_cid);
    kolizeum::create_public(&cfg, 1 /*1v1*/, PLEDGE, 100 /*max diff*/, chr, pay, &ver, sc.ctx());
    ts::return_shared(k); sc.return_to_sender(pkcap); ts::return_shared(cfg); ts::return_shared(ver);
  };

  // JOIN — build the joiner's character on a LOCAL kiosk, borrow it for the real join door
  sc.next_tx(JOINER);
  let cpolicy = sc.take_shared<TransferPolicy<Character>>();
  let cust = character::new_customization(1, 2, 3);
  let (jchr, jpledge) = character::new_for_testing(b"joiner".to_string(), b"senshi".to_string(), true, cust, 1000, sc.ctx());
  let jcid = character::id(&jchr);
  let (mut jk, kcap) = kiosk::new(sc.ctx());
  let jpkcap = personal_kiosk::new(&mut jk, kcap, sc.ctx());
  character::lock_in_kiosk(jpledge, jchr, &mut jk, personal_kiosk::borrow(&jpkcap), &cpolicy);
  ts::return_shared(cpolicy);

  let mut lobby = sc.take_shared<Kolizeum>();
  let cfg = sc.take_shared<GameConfig>();
  let ver = sc.take_shared<Version>();
  let pay = coin::mint_for_testing<SUI>(PLEDGE, sc.ctx());
  {
    let jc = jk.borrow<Character>(personal_kiosk::borrow(&jpkcap), jcid);
    kolizeum::join(&mut lobby, jc, pay, &cfg, &ver, sc.ctx());
  };

  assert_eq!(kolizeum::fighter_count(&lobby), 2); // creator + joiner seated
  assert_eq!(kolizeum::pot_value(&lobby), PLEDGE * 2); // both pledges in the pot
  ts::return_shared(lobby); ts::return_shared(cfg); ts::return_shared(ver);

  destroy(jk); destroy(jpkcap);
  sc.end();
}

/// Stand up + ENABLE the sibling `aresrpg_social` package (its own Version + AdminCap + FriendRegistry) and mint
/// a soulbound FriendList for the test persona, so the kolizeum FRIENDS-ONLY door has a real cross-package list to snapshot.
fun social_friend_list(sc: &mut Scenario) {
  social_version::test_init(sc.ctx());
  social_admin::test_init(sc.ctx());
  friends::test_init(sc.ctx());

  sc.next_tx(koli_world::owner());
  let scap = sc.take_from_sender<SocialAdminCap>();
  let mut sver = sc.take_shared<SocialVersion>();
  social_admin::admin_set_enabled(&scap, &mut sver, true, sc.ctx());
  ts::return_shared(sver); sc.return_to_sender(scap);

  sc.next_tx(koli_world::owner());
  let mut reg = sc.take_shared<FriendRegistry>();
  let sver = sc.take_shared<SocialVersion>();
  friends::create_friend_list(&mut reg, &sver, sc.ctx());
  ts::return_shared(reg); ts::return_shared(sver);
}

#[test]
/// `create_friends_only`: the real friends-only door reads the creator's level off a live kiosk-locked Character
/// AND snapshots the allowlist from the creator's own cross-package `FriendList` (§7). Proves the entry runs and
/// seeds the lobby with the creator (pot = one pledge).
fun create_friends_only_real_character_and_list() {
  let mut sc = ts::begin(koli_world::owner());
  koli_world::boot(&mut sc);
  koli_world::open_gate(&mut sc);
  social_friend_list(&mut sc); // the persona now holds a FriendList
  let creator_cid = koli_world::mint_character(&mut sc, koli_world::owner());

  sc.next_tx(koli_world::owner());
  {
    let k = sc.take_shared<Kiosk>();
    let pkcap = sc.take_from_sender<PersonalKioskCap>();
    let flist = sc.take_from_sender<FriendList>(); // the persona's soulbound list
    let cfg = sc.take_shared<GameConfig>();
    let ver = sc.take_shared<Version>();
    let pay = coin::mint_for_testing<SUI>(PLEDGE, sc.ctx());
    let chr = k.borrow<Character>(personal_kiosk::borrow(&pkcap), creator_cid);
    kolizeum::create_friends_only(&cfg, 1 /*1v1*/, PLEDGE, 100 /*max diff*/, &flist, chr, pay, &ver, sc.ctx());
    ts::return_shared(k); sc.return_to_sender(pkcap); sc.return_to_sender(flist);
    ts::return_shared(cfg); ts::return_shared(ver);
  };

  sc.next_tx(koli_world::owner());
  let lobby = sc.take_shared<Kolizeum>();
  assert_eq!(kolizeum::fighter_count(&lobby), 1); // creator seated
  assert_eq!(kolizeum::pot_value(&lobby), PLEDGE); // exactly the creator's pledge
  ts::return_shared(lobby);
  sc.end();
}
