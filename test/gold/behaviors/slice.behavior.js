// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// THE PROOF-OF-FORMAT BEHAVIOR (docs/GOLD_STANDARD_SUITE.md §1c/§13) — the skeleton's vertical
// slice expressed as a behavior file: fund → create a character through the SDK choke → assert
// display truth off /v1. Pure data (no closures): target-independent, replayable, diffable.
//   node test/gold/bot/run.mjs test/gold/behaviors/slice.behavior.js --target localnet --wallet fresh
import fund from './sub/_fund.behavior.js'

export default {
  name: 'vertical_slice',
  description: 'skeleton proof: fund → create character → /v1 display truth',
  ui_truth: 'never', // sdk-mode proof; ui-truth behaviors land with B6 (needs the L1 anchor)
  defaults: { class: 'senshi' },
  steps: [
    { use: fund, with: { sui: 2 } },
    { do: 'create_character', with: { class: '$class', name_prefix: 'bot' } },
    { assert: { oracle: 'v1.characters.count_mine', eq: 1 } },
    { assert: { oracle: 'v1.config.xp_multiplier', gte: 100 } },
    { assert: { oracle: 'v1.encyclopedia.worlds_has_seeded', eq: true } },
    { checkpoint: 'character_live' },
  ],
}
