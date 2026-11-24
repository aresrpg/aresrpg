#[test_only]
module aresrpg_currency::kares_tests;

use aresrpg_currency::kares::{Self, Genesis, KARES};
use sui::coin_registry::{Currency, MetadataCap};
use sui::test_scenario;

const PUBLISHER: address = @0xA;
// The registry receives every one-time-witness currency until its registration is finalized.
const REGISTRY: address = @0xC;

#[test]
fun publication_issues_one_billion_once_and_splits_the_three_shares() {
    let mut scenario = test_scenario::begin(PUBLISHER);
    kares::init_for_testing(scenario.ctx());
    scenario.next_tx(PUBLISHER);
    let currency = scenario.take_from_address<Currency<KARES>>(REGISTRY);
    assert!(currency.decimals() == 9 && currency.is_supply_burn_only());
    assert!(currency.symbol() == b"KARES".to_string() && currency.name() == b"KARES".to_string());
    assert!(currency.icon_url() == b"https://aresrpg.world/kares.png".to_string());
    assert!(currency.total_supply().destroy_some() == 1_000_000_000_000_000_000);
    test_scenario::return_to_address(REGISTRY, currency);
    // The metadata authority stays with the publisher.
    scenario.return_to_sender(scenario.take_from_sender<MetadataCap<KARES>>());
    let (liquidity, reserves, team) = kares::split(scenario.take_from_sender<Genesis>(), scenario.ctx());
    assert!(liquidity.value() == kares::liquidity_tokens() && liquidity.value() == 540_000_000_000_000_000);
    assert!(reserves.value() == kares::reserve_tokens() && reserves.value() == 410_000_000_000_000_000);
    assert!(team.value() == kares::team_tokens() && team.value() == 50_000_000_000_000_000);
    liquidity.burn_for_testing();
    reserves.burn_for_testing();
    team.burn_for_testing();
    scenario.end();
}
