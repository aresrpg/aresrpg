// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// PROGRESSION SOAK — ARTISAN / ECONOMY (the economy loop, the artisan specialization,
// and shop/cosmetic buying). The FIGHTER proves the fight-xp path; THIS bot proves the MATERIAL economy: fight →
// LOOT the drops (the seed's Test Brute drops iron_ore + a longsword) → EQUIP a looted weapon (gear upgrade) →
// CRAFT gear from the loot through the SDK craft choke → LIST it on the kiosk marketplace + DELIST (the sell-side
// round-trip). The BUY-side (shop / bonding-curve pools) and the artisan-COMMISSION loop are declared gaps on this
// corpus — the optional steps below record the precise blocker (root cause + the corpus/module that would unblock).
//
// ARTISAN-ROLE NOTE: no on-chain commission/artisan module exists (grep of packages/move) and
// every item is kiosk-locked forever, so a fighter CANNOT hand raw resources to a separate artisan without a
// marketplace BUY builder (the SDK ships list/delist only — kiosk purchase has no *_ptb). So the artisan loop runs
// SINGLE-WALLET here (this bot both loots AND crafts); the cross-bot commission is a declared gap, not a fake.
//
//   node test/gold/bot/run.mjs test/gold/behaviors/artisan_economy.behavior.js --target localnet --wallet fresh
import fund from './sub/_fund.behavior.js'

export default {
  name: 'artisan_economy',
  description:
    'SOAK: fight→LOOT→equip(gear upgrade)→CRAFT→list/delist (economy sell-side); buy/pool/commission gaps declared',
  ui_truth: 'never',
  steps: [
    { use: fund, with: { sui: 6 } },
    { do: 'create_character', with: { class: 'yajin', name_prefix: 'artisan' } },
    { assert: { oracle: 'chain.character.exists', eq: true } },
    { do: 'enter_world' },

    // ── accumulate LOOT: the material base (Test Brute drops iron_ore 80% [1-3] + longsword 50%) ──────────────
    {
      loop: [
        { do: 'fight' }, // wins + settles (records balance); ctx.result_id = the settled FightResult
        { do: 'loot', optional: true }, // mint the rolled drops into the kiosk (proves "loot enough")
      ],
      until: { oracle: 'run.inventory_count', gte: 5 }, // more iron_ore stacks ⇒ better exact-subset odds for craft
      max_iters: 9, // literals — run.mjs does not resolve $params inside loop caps
      max_minutes: 14,
    },
    { checkpoint: 'looted' },
    { assert: { oracle: 'run.inventory_count', gte: 1 } }, // the loot path minted at least one owned item

    // ── GEAR UPGRADE: equip a looted longsword (weapon) — proves loot → equip actually lands ─────────────────
    { do: 'equip', with: { item_role: 'longsword' }, optional: true },

    // ── ECONOMY SELL-SIDE: list a looted iron_ore stack on the kiosk marketplace, then delist (round-trip) ────
    { do: 'list', with: { item_role: 'iron_ore', price_mist: 50000000 }, optional: true },
    { do: 'delist', optional: true },
    { checkpoint: 'economy_sell_side' },

    // ── CRAFT: iron_ore → gear via the SDK craft choke. Try BOTH seed recipes (longsword needs 2 units, potions
    //    need 3) — either succeeding proves the craft path; the tally is EXACT so subset-select the looted stacks. ──
    { do: 'craft', with: { recipe_index: 0, input_role: 'iron_ore', input_qty: 2 }, optional: true }, // smith_longsword
    { do: 'craft', with: { recipe_index: 1, input_role: 'iron_ore', input_qty: 3 }, optional: true }, // brew_heal_potions
    { checkpoint: 'crafted' },

    // ── DECLARED GAPS — cover what's seeded, note the rest: buy-side is un-seeded here ─────────────────────────
    { do: 'buy', optional: true }, // shop buy → declares "no Sale seeded on this corpus" (rider 3: shop/supply/cosmetic)
    { do: 'pool_swap', with: { side: 'buy' }, optional: true }, // pool → declares "no Pool seeded" (economy rider)
    { checkpoint: 'artisan_economy_complete' },
  ],
}
