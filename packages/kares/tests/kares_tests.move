#[test_only]
module aresrpg_kares::kares_tests;

use aresrpg_kares::kares::{Self, Genesis, KARES};
use sui::coin::TreasuryCap;
use sui::coin_registry::{Currency, MetadataCap as RegistryMetadataCap};
use sui::test_scenario;

#[test]
fun native_metadata_authority_cannot_change_supply_or_token_identity() {
    let mut scenario = test_scenario::begin(@0xA);
    kares::init_for_testing(scenario.ctx());
    scenario.next_tx(@0xA);
    let genesis = scenario.take_from_sender<Genesis>();
    let (mut inventory, metadata_cap) = kares::consume(genesis);
    assert!(inventory.value() == 1_000_000 * kares::unit());
    assert!(test_scenario::ids_for_address<TreasuryCap<KARES>>(@0xA).is_empty());
    assert!(test_scenario::ids_for_address<RegistryMetadataCap<KARES>>(@0xA).is_empty());
    let mut currency = scenario.take_from_address<Currency<KARES>>(@0xC);
    assert!(currency.is_supply_burn_only());
    assert!(!currency.is_metadata_cap_deleted());
    assert!(currency.metadata_cap_id() == option::some(object::id(&metadata_cap)));
    assert!(currency.name() == b"kAres".to_string());
    assert!(currency.icon_url() == b"https://launchpad.aresrpg.world/kares.png".to_string());
    currency.set_name(&metadata_cap, b"Updated KARES display".to_string());
    currency.set_description(&metadata_cap, b"Updated presentation only".to_string());
    currency.set_icon_url(&metadata_cap, b"https://launchpad.aresrpg.world/updated-kares.png".to_string());
    assert!(currency.name() == b"Updated KARES display".to_string());
    assert!(currency.description() == b"Updated presentation only".to_string());
    assert!(currency.icon_url() == b"https://launchpad.aresrpg.world/updated-kares.png".to_string());
    assert!(currency.decimals() == 9 && currency.symbol() == b"KARES".to_string());
    assert!(currency.is_supply_burn_only());
    assert!(currency.total_supply() == option::some(1_000_000 * kares::unit()));
    kares::burn(&mut currency, inventory.split(100 * kares::unit()).into_coin(scenario.ctx()));
    assert!(currency.total_supply() == option::some(999_900 * kares::unit()));
    kares::burn(&mut currency, inventory.into_coin(scenario.ctx()));
    assert!(currency.total_supply() == option::some(0));
    transfer::public_transfer(metadata_cap, @0xB);
    test_scenario::return_to_address(@0xC, currency);
    scenario.end();
}
