// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// REGRESSION FENCE — FIRST-TOOL BOOTSTRAP (docs/REGRESSION_ENFORCEMENT.md P6 · domain: progression)
// Ratified design (coordinator, 07-11): a FRESH bare-handed character must reach GATHERING through
// loot→craft — kill L1 mobs → loot the tool ingredients (crude_branch etc.) → craft the job tools (all 3:
// basic_pickaxe, old_hoe, tool_herbalist) → equip → gather succeeds. A failure at ANY link = the
// diamond-deadlock class regression (gathering is tool-gated: gathering.move ENoTool 105 — a tool recipe
// whose ingredients need gathering is circularly unsatisfiable; the 07-11 pickaxe incident).
//
// ORDER LAW (the soak's harness bug, encoded here): loot→craft→equip come BEFORE any gather. A fresh
// character can NEVER gather first — the gameplay track's original loot→gather→craft order was itself the
// bug this fence pins. Every ingredient below enters via MOB LOOT, never via gathering.
//
// LINKS ASSERTED (each `do` step is RED on failure with an honest note; oracles pin the state deltas):
//   1. kill L1 mobs        → fight (win) — run.fights_won ≥ 1
//   2. loot ingredients    → loot (mint_rolled from the settled FightResult) — run.inventory_count ≥ 1
//   3. craft the 3 tools   → craft ×3 (recipe + EXACT inputs resolved from the boot manifest by role/index)
//   4. equip the tools     → equip ×3 by item_role (the job-tool slots)
//   5. gather succeeds     → gather — chain.inventory_owned grows past the tools (the tool-gate payoff)
//
// SEEDER CONTRACT (needs-seed): the active minimal corpus seeds only 2 recipes (longsword, heal_potion) and
// NO job tools — so the tool recipe_index defaults (2/3/4) honest-fail ("no recipe at index N in manifest")
// until the full-corpus seeder lands (map §Gaps). When it lands, bind the real indices/input roles below
// (basic_pickaxe = crude_branch ×2 is the ratified recipe; hoe/herbalist inputs are placeholders to rebind).
// Until then the LIVE vehicle for this row is the gate's gameplay track (post-reorder), which drives the
// same Driver sequence against its own seed.
//
//   node test/gold/bot/run.mjs test/gold/behaviors/regressions/first_tool.behavior.js --target localnet --wallet fresh
import fund from '../sub/_fund.behavior.js'

export default {
  name: 'regr_first_tool',
  description:
    'REGRESSION (needs-seed): bare-hand bootstrap — loot mob ingredients → craft all 3 job tools → equip → gather succeeds (diamond-deadlock fence)',
  ui_truth: 'never',
  defaults: {
    class: 'senshi',
    // seeder contract — rebind when the full-corpus seeder lands (active seed: 0=longsword, 1=heal_potion)
    pickaxe_recipe: 2,
    hoe_recipe: 3,
    herbalist_recipe: 4,
    pickaxe_input: 'crude_branch', // ratified: basic_pickaxe = crude_branch ×2 (bare-hand reachable, 07-11 fix)
    hoe_input: 'crude_branch', // SEEDER-TODO: bind the real old_hoe ingredient role
    herbalist_input: 'crude_branch', // SEEDER-TODO: bind the real tool_herbalist ingredient role
    input_qty: 2,
  },
  steps: [
    { use: fund, with: { sui: 5 } },
    { do: 'create_character', with: { class: '$class', name_prefix: 'regr_tool' } },
    { assert: { oracle: 'chain.character.exists', eq: true } },
    { do: 'enter_world' },
    // LINK 1+2 — kill L1 mobs and LOOT the ingredients (loop until loot stacks exist; watchdogs mandatory).
    // NO gather here: the character is bare-handed — gather would abort ENoTool (that abort is the regression).
    {
      loop: [{ do: 'fight' }, { do: 'loot' }],
      until: { oracle: 'run.inventory_count', gte: 3 },
      max_iters: 8,
      max_minutes: 30,
    },
    { assert: { oracle: 'run.fights_won', gte: 1 } }, // link 1: mobs died
    { assert: { oracle: 'run.inventory_count', gte: 3 } }, // link 2: ingredient stacks looted (loot-only entry)
    { checkpoint: 'ingredients_looted_bare_hand' },
    // LINK 3 — craft ALL THREE job tools from looted stacks (EXACT-tally inputs; craft REDs with the stack
    // list if the subset can't be formed — that failure note names the balance/seed defect).
    { do: 'craft', with: { recipe_index: '$pickaxe_recipe', input_role: '$pickaxe_input', input_qty: '$input_qty' } },
    { do: 'craft', with: { recipe_index: '$hoe_recipe', input_role: '$hoe_input', input_qty: '$input_qty' } },
    {
      do: 'craft',
      with: { recipe_index: '$herbalist_recipe', input_role: '$herbalist_input', input_qty: '$input_qty' },
    },
    { checkpoint: 'three_tools_crafted' },
    // LINK 4 — equip the tools into their job slots (equip-by-role reads the manifest's template ids).
    { do: 'equip', with: { item_role: 'basic_pickaxe' } },
    { do: 'equip', with: { item_role: 'old_hoe' } },
    { do: 'equip', with: { item_role: 'tool_herbalist' } },
    // LINK 5 — THE PAYOFF: gather now SUCCEEDS (pre-fix class: ENoTool 105 / circular recipe = RED here).
    { do: 'search_zone' },
    { do: 'travel_to', with: { target: 'nearest:resource' } },
    { do: 'gather' },
    { assert: { oracle: 'chain.inventory_owned', gte: 4 } }, // 3 tools + ≥1 gathered resource survived the chain
    { checkpoint: 'bare_hand_to_gathering_bootstrap_complete' },
  ],
}
