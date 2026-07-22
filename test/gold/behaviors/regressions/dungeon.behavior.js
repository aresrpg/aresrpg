// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// REGRESSION FENCE — DUNGEON (docs/REGRESSION_ENFORCEMENT.md · domain: dungeon) — NEEDS-SEED (not run tonight)
//
// Regressions this domain must fence:
//  · R-DUN-1  no more "create dungeon" / "browse" — enter by CONSUMING a key, then teleport to room 1
//    (reported 2026-07-09: "it seem I can enter the dungeon without a key… it should open the modal and propose to
//    consume a key… then teleport us to the first room"). enter_dungeon REQUIRES a key_item_id; the RunPass
//    only mints when a valid key is consumed → a keyless entry aborts (the fence).
//  · R-DUN-2  the first fight inside the dungeon runs to a settle (07-10 dungeon-fight reports).
//  · R-DUN-3  (TIMING — needs-L1) 7s enter → the teleport must fire RIGHT AWAY, not after the tx — a 7s wait
//    before entry read as broken (dungeons must teleport immediately, never block on the tx).
//    Enforced by budgets.json `dungeon_teleport` (<=1500ms; pre-fix 7000) in ui-mode (L1) — NOT this sdk fence.
//
// WHY NOT RUN TONIGHT (declared gap in the map, not smoke-hidden): the gold seed carries NO dungeon-key item
// template and NO dungeon-enabled world. This fence RUNS once a full-corpus localnet seeder lands (B0 open gap)
// and a key is obtained (shop-seed a key — reported 2026-07-10: "seed dungeon keys on the shop", or admin-grant).
// Fill $key_item_id from a prior buy/gather-loot step or the boot manifest.
import fund from '../sub/_fund.behavior.js'

export default {
  name: 'regr_dungeon',
  description: 'REGRESSION (needs-seed): dungeon requires a key, teleports to room 1, the first fight runs & settles',
  ui_truth: 'never',
  defaults: { key_item_id: null },
  steps: [
    { use: fund, with: { sui: 5 } },
    { do: 'create_character', with: { class: 'senshi', name_prefix: 'regr_dun' } },
    { do: 'enter_world' },
    // R-DUN-1: keyless entry MUST abort — a real key_item_id is mandatory to mint the RunPass.
    { do: 'enter_dungeon', with: { key_item_id: '$key_item_id' } },
    { do: 'dungeon_fight', with: {} }, // R-DUN-2: first room fight
    { do: 'exit_dungeon', with: {} },
    { assert: { oracle: 'chain.character.exists', eq: true } },
    { checkpoint: 'dungeon_run_intact' },
  ],
}
