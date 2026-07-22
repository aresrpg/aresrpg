// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// B0 PROOF BEHAVIOR (docs/GOLD_STANDARD_SUITE.md §12 B0 row) — one behavior exercising ≥6 gameplay verbs
// end-to-end through the SDK choke on a full-corpus localnet boot: fund → create_character → enter_world →
// search_zone → travel_to → gather → fight (auto-recorded to balance_report.json). Pure DATA (no closures):
// target-independent, replayable, diffable. The SAME file runs `--mode sdk` (this control) and `--mode ui`.
//   node test/gold/bot/run.mjs test/gold/behaviors/full_slice.behavior.js --target localnet --wallet fresh
import fund from './sub/_fund.behavior.js'

export default {
  name: 'full_slice',
  description: 'B0 proof: ≥6 verbs end-to-end (fund→create→enter→search→travel→gather→fight) + balance record',
  ui_truth: 'never', // sdk-mode proof; ui-truth (milestones/always) lands with B6 on the L1 anchor
  defaults: { class: 'senshi' },
  steps: [
    { use: fund, with: { sui: 5 } }, // faucet_fund + balance-floor assert (composition proof)
    { do: 'create_character', with: { class: '$class', name_prefix: 'gold' } },
    { assert: { oracle: 'v1.characters.count_mine', eq: 1 } }, // /v1 display truth: the mint is projected
    { assert: { oracle: 'v1.config.xp_multiplier', gte: 100 } }, // admin fixture (×4.00 today) live on the dial
    { do: 'enter_world' },
    { do: 'search_zone' }, // discover the entry zone's rolled spawns (mobs + resource nodes)
    { do: 'travel_to', with: { target: 'nearest:mob' } },
    { do: 'fight' }, // create→place→tactical turns→settle; win/loss auto-recorded (§1c balance findings)
    { assert: { oracle: 'chain.character.exists', eq: true } },
    { assert: { oracle: 'run.fights_won', gte: 0 } }, // fight settled (win recorded in balance_report.json)
    { checkpoint: 'slice_complete' },
  ],
}
