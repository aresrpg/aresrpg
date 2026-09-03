// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// The GAS RATCHET (Lever 0 of the ÷10 plan): these tests exist to be metered, not to prove
/// behavior. The gate runs them as their own invocation under `--gas-limit N`; a fight-path
/// change that inflates instruction count reds HERE before it ever reaches a player. N only
/// ratchets DOWN — after a lever lands, re-measure and tighten, never loosen.
#[test_only]
module aresrpg::fight_gas_tests;

use aresrpg::world;
use aresrpg_control::admin;
use aresrpg_seed::{registry, world_content::{Self, WorldContent}};
use sui::test_scenario;

const OWNER: address = @0xA11CE;

// The board-generation probe died with Lever 1: on-chain generation left the runtime
// (test-only fixture machinery now), and a catalog pick is one dynamic-field read — nothing
// left to ratchet. Fight-creation cost is verified post-republish by `sui replay --trace`.

#[test]
fun the_world_object_stays_slim() {
  // Lever 2's tooth: the mutable World is id+name ONLY (~40 bytes) — every search/gather/
  // engage rewrites it, so bytes here are a tax on every world transaction. The 39KB of
  // authored content lives in the seed package's WorldContent, read-only.
  let mut scenario = sui::test_scenario::begin(OWNER);
  let cap = admin::cap_for_testing(scenario.ctx());
  let mut root = registry::registry_for_testing(scenario.ctx());
  let content = world_content::create(&cap, &mut root, b"nauvis".to_string(), 1, scenario.ctx());
  world::create(&cap, &mut root, &content, scenario.ctx());
  world_content::share(content);
  scenario.next_tx(OWNER);
  let w = scenario.take_shared<world::World>();
  let content = scenario.take_shared<WorldContent>();
  assert!(std::bcs::to_bytes(&w).length() <= 100, 0);
  sui::test_scenario::return_shared(w);
  sui::test_scenario::return_shared(content);
  registry::destroy_for_testing(root);
  admin::destroy_for_testing(cap);
  scenario.end();
}
