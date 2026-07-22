// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// REGRESSION FENCE — PROGRESSION (docs/REGRESSION_ENFORCEMENT.md · domain: progression)
//
// Regression pinned here:
//  · R-PROG-1 "classes coming soon" — the 4 core classes (senshi / yajin / tomoda / shugo) must ALWAYS be
//    creatable, and the publish gate must ASSERT it — every core class stays always available, never
//    gated 'coming soon'. This is the
//    ACTIVE localnet enforcement of that mandate: mint one of EACH core class through the SDK choke and prove
//    it on chain (immediate) + in /v1 (the roster a player actually sees).
//
//    PRE-FIX FAILURE MODE: if any class were gated "coming soon" (config whitelist / UI), create_character
//    aborts on-chain → the `do` step throws → the run is RED. A GREEN run = all 4 classes mintable.
//
// Follows the gate precedent `core-classes-creatable` (test/localnet/gate/signals.mjs → assert_core_classes),
// and CLOSES its documented gap: that gate reads a `core_classes` field NO bot emits today (scenario.js still
// lists retro-era placeholder class names), so the dimension never actually fires. This behavior is the
// missing producer, in the gold lane — it exercises the real config.move class ids 0/1/9/5.
//
// PROGRESSION-DOMAIN ORDER LAW (soak-proven, ratified 2026-07-11): a fresh character sequences
// loot→craft→equip BEFORE any gather — gathering is tool-gated (ENoTool 105), so gather-first is ALWAYS a
// harness bug on a bare-handed character. This file has no gather step; the full bootstrap chain lives in
// first_tool.behavior.js (map row P6 — the diamond-deadlock class fence).
//
//   node test/gold/bot/run.mjs test/gold/behaviors/regressions/progression.behavior.js --target localnet --wallet fresh
import fund from '../sub/_fund.behavior.js'

export default {
  name: 'regr_progression',
  description: 'REGRESSION: the 4 core classes (senshi/yajin/tomoda/shugo) are ALWAYS creatable — never "coming soon"',
  ui_truth: 'never', // sdk-mode gameplay proof
  steps: [
    // Paid door reads the LIVE Creation price (10 SUI default) every mint; the localnet faucet mints ~1000 SUI
    // per hit, so 5 hits funds all four paid creates + gas with wide headroom.
    { use: fund, with: { sui: 5 } },
    { do: 'create_character', with: { class: 'senshi', name_prefix: 'regr_senshi' } },
    { assert: { oracle: 'chain.character.exists', eq: true } }, // chain truth = immediate, no indexer lag
    { do: 'create_character', with: { class: 'yajin', name_prefix: 'regr_yajin' } },
    { assert: { oracle: 'chain.character.exists', eq: true } },
    { do: 'create_character', with: { class: 'tomoda', name_prefix: 'regr_tomoda' } },
    { assert: { oracle: 'chain.character.exists', eq: true } },
    { do: 'create_character', with: { class: 'shugo', name_prefix: 'regr_shugo' } },
    { assert: { oracle: 'chain.character.exists', eq: true } },
    // /v1 display truth: all four mints are projected onto the roster the app renders (roster-load path).
    { assert: { oracle: 'v1.characters.count_mine', gte: 4 } },
    { checkpoint: 'four_core_classes_creatable' },
  ],
}
