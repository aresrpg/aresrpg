// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// PROGRESSION SOAK — FIGHTER: prove the bots can reach lvl 50, visit worlds, win fights, level their jobs,
// and craft/loot to progress HAPPILY. This is the FIGHT-XP path: create → enter world → the core
// grind loop [win a fight → gain xp → LEVEL UP → allocate the level's stat points] repeated UNTIL level ≥ 50 OR
// the loop watchdog (max_iters / max_minutes) trips — then a MULTI-WORLD hop (enter a 2nd world + fight there,
// proving world traversal) and a DUNGEON run. Pure DATA (no closures): the backend resolves all runtime ids
// (zone groups, protector, world 2) from the boot manifest + live discovery. The admin fixture cranks xp/loot to
// the sanctioned test max (×1000) for reachability; the balance recorder captures RAW xp_share per fight so the
// report PROJECTS the real x1 fights-to-L50 curve (§1c balance findings).
//
//   node test/gold/bot/run.mjs test/gold/behaviors/progression_l50.behavior.js --target localnet --wallet fresh
import fund from './sub/_fund.behavior.js'

export default {
  name: 'progression_l50',
  description: 'SOAK: fight→xp→level→stat-spend loop to L50, then multi-world hop + dungeon (fight-xp path)',
  ui_truth: 'never', // sdk-mode gameplay proof (the pure-progression control)
  defaults: { class: 'senshi', target_level: 50, loop_minutes: 34, loop_iters: 80 },
  steps: [
    { use: fund, with: { sui: 6 } }, // paid create reads the live Creation price (~10 SUI); faucet mints ~1000/hit
    { do: 'create_character', with: { class: '$class', name_prefix: 'fighter' } },
    { assert: { oracle: 'chain.character.exists', eq: true } },
    { assert: { oracle: 'v1.config.xp_multiplier', gte: 100 } }, // the admin xp dial is live (≥1.00x)
    { do: 'enter_world' }, // world 1 (the primary seeded world)
    { checkpoint: 'onboarded_world1' },

    // ── the core grind: fight → xp → level → spend the level's stat points, until L50 or the watchdog ──────────
    {
      loop: [
        { do: 'fight' }, // walks the zone's groups, re-discovers a fresh zone when exhausted; records balance + xp
        { do: 'spend_stat_points', optional: true }, // (level−1)*5 − spent; clean noop when none owed; abort → finding
      ],
      until: { oracle: 'run.level', gte: 50 }, // NOTE: max_iters/max_minutes are read RAW by run.mjs (compile does
      max_iters: 80, //                              not resolve $params inside a loop's caps) — so they MUST be literals.
      max_minutes: 34,
    },
    { checkpoint: 'grind_complete' },
    { assert: { oracle: 'run.stat_points_spent', gte: 1 } }, // stat allocation actually landed on chain

    // ── MULTI-WORLD: enter a 2nd world + fight there (world-traversal proof). Optional — declared gap if absent ──
    { do: 'enter_world', with: { world_index: 1 }, optional: true },
    { do: 'fight', optional: true },
    { checkpoint: 'world2_visited' },

    // ── DUNGEON: a run in world 1 (needs a dungeon key item — optional; declared gap if unobtainable) ──────────
    { do: 'enter_world', with: { world_index: 0 }, optional: true },
    { do: 'enter_dungeon', optional: true },
    { do: 'dungeon_fight', optional: true },
    { do: 'exit_dungeon', optional: true },
    { checkpoint: 'soak_complete' },
  ],
}
