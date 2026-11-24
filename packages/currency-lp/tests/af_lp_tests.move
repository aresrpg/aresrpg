#[test_only]
module aresrpg_currency_lp::af_lp_tests;

use amm::pool::CreatePoolCapV2;
use aresrpg_currency_lp::af_lp;
use sui::test_scenario;

#[test]
fun publication_hands_the_pool_creation_cap_to_the_publisher() {
    let mut scenario = test_scenario::begin(@0xA);
    af_lp::init_for_testing(scenario.ctx());
    scenario.next_tx(@0xA);
    scenario.return_to_sender(scenario.take_from_sender<CreatePoolCapV2>());
    scenario.end();
}
