// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// REGRESSION FENCE — ECONOMY (docs/REGRESSION_ENFORCEMENT.md · domain: economy) — NEEDS-SEED (not run tonight)
//
// Regressions this domain must fence:
//  · R-ECON-1  shop reads via /v1, NOT 60 chain-direct gRPC BatchGetObjects per mount (07-10 13:35 shop storm).
//    ENFORCED TONIGHT as a STATIC check, not sdk gameplay — see static_not_wired.mjs → `shop_reads_v1`.
//  · R-ECON-2  buy → own the item → equip renders the stat delta (07-10 equip/inventory reports).
//    budgets: `buy` (5000ms), `equip` (3000ms).
//  · R-ECON-3  royalty-bypass — a 0-amount ghost stack must NOT dodge royalty on a secondary listing
//    (07-11 09:24). This belongs to the ADVERSARY track (test/localnet/bots/adversary + the new Move
//    `item_listing_rule` EZeroAmount rule), NOT this gameplay fence — cross-referenced only.
//
// WHY NOT RUN TONIGHT (declared B-wave gap, tracked in the map, NOT smoke-hidden):
//  · `buy` needs a SEEDED shop Sale id — the gold seed (seed_content.json: 18 items / 3 mobs / 1 world) does
//    not guarantee a shop sale, and no full-corpus localnet seeder exists yet (B0's open gap).
//  · (the gather SDK-drift blocker is CLOSED 07-11: gather_ptb carries the 17-arg protector signature and the
//    backend `loot` verb now mints fight drops — items can also enter via fight→loot, see first_tool.behavior.js.)
//
// READY TO RUN once a full-corpus seeder lands: fill $shop_id/$sale_id from the boot manifest
// (test/gold/.gold-deployment.json → seed) and drop --wallet fresh.
import fund from '../sub/_fund.behavior.js'

export default {
  name: 'regr_economy',
  description: 'REGRESSION (needs-seed): buy from shop → own → equip → list → delist through the SDK choke',
  ui_truth: 'never',
  defaults: { shop_id: null, sale_id: null },
  steps: [
    { use: fund, with: { sui: 10 } },
    { do: 'create_character', with: { class: 'senshi', name_prefix: 'regr_econ' } },
    { do: 'buy', with: { shop_id: '$shop_id', sale_id: '$sale_id' } }, // pushes item_id into ctx.inventory
    { assert: { oracle: 'chain.inventory_owned', gte: 1 } }, // owns the bought item (kiosk-locked)
    { do: 'equip', with: {} }, // equips the last-owned item (R-ECON-2 stat-delta path)
    { do: 'list', with: { price_mist: 50000000 } }, // relist on the kiosk marketplace
    { do: 'delist', with: {} },
    { checkpoint: 'economy_loop_intact' },
  ],
}
