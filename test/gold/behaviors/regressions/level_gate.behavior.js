// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// REGRESSION FENCE — WORLD LEVEL-GATE LADDER (docs/REGRESSION_ENFORCEMENT.md W14 · domain: world)
// NEEDS-SEED + BLOCKED ON RUNNER GRAMMAR (both declared gaps, not smoke-hidden).
//
// Regression this fences ("world level-gate ladder"): a fresh L1 character
// must be REFUSED entry into a world whose required_level exceeds theirs (first-worlds scope: world 03+),
// surfacing ELevelTooLow — never a silent teleport-in. The admin-side half (dialing a world's required_level
// via the GATES tab, FIXED/compose-proven) — an ADMIN-ONLY PTB exercised once at boot by
// up_gold.mjs's admin pass (config.move set_xp_multiplier/set_loot_multiplier precedent, §4 of
// docs/GOLD_STANDARD_SUITE.md), NOT a per-run bot verb, so it is not re-modeled here.
//
// WHY NOT RUNNABLE TODAY (two declared gaps):
//   1. NEEDS-SEED — a gated world at world_index ≥1 with required_level > 1. The active gold corpus seeds
//      only world_index 0 (ungated; manifest.seed.worlds is empty — backend_sdk.mjs world_id_at()). Bind
//      $gated_world_index once the multi-world corpus (5 biome worlds, commit 995140c) lands in the gold
//      seeder and up_gold.mjs's admin pass dials a real required_level onto one of them.
//   2. NEEDS-GRAMMAR — `enter_world` returning ok:false is normally a RED: bot/run.mjs's run_steps() throws
//      on ANY `do` step with ok:false (unless `step.optional`, which would make a REGRESSED "always allow"
//      gate look like a silent finding instead of a hard failure — the wrong polarity for a security fence).
//      This is the first regression whose PASS condition is a REFUSAL — the same unsolved tension already
//      visible in dungeon.behavior.js's R-DUN-1 comment ("a keyless entry aborts (the fence)"), just never
//      named as a runner gap there. Needs one new field on `do` steps, spec'd (not implemented — runner
//      edits are out of this lane's fence) in docs/REGRESSION_ENFORCEMENT.md → "New step-grammar: `expect`":
//
//        { do: 'enter_world', with: { world_index: 1 }, expect: { ok: false, note_includes: 'ELevelTooLow' } }
//
//      Semantics: when `step.expect` is present, run_steps() compares `res.ok` to `expect.ok` (and, if given,
//      checks `res.note` includes `expect.note_includes`) INSTEAD of requiring `res.ok === true`. A match is a
//      PASS (counts as progressed, never a soft-lock ding); a mismatch — including the gate REGRESSING to
//      "always allow" (res.ok:true when refusal was expected) — throws RED with both the expected and actual
//      shape in the message. ~10 lines in the existing `if (step.do) {...}` branch; no new executor needed.
//
//   node test/gold/bot/run.mjs test/gold/behaviors/regressions/level_gate.behavior.js --target localnet --wallet fresh
import fund from '../sub/_fund.behavior.js'

export default {
  name: 'regr_level_gate',
  description:
    'REGRESSION (needs-seed + needs-grammar): a fresh L1 character is REFUSED entry into a required_level-gated world (ELevelTooLow), never silently let in',
  ui_truth: 'never',
  defaults: {
    class: 'senshi',
    gated_world_index: 1, // SEEDER-TODO: bind to a real required_level>1 world once the multi-world corpus seeds
  },
  steps: [
    { use: fund, with: { sui: 5 } },
    { do: 'create_character', with: { class: '$class', name_prefix: 'regr_gate' } },
    { assert: { oracle: 'chain.character.exists', eq: true } }, // a fresh mint is ALWAYS level 1 — the gate's subject
    {
      expect_abort: {
        do: 'enter_world',
        with: { world_index: '$gated_world_index' },
        module: 'zones',
        abort_code: 101,
        no_digest: true,
        no_state_delta: ['chain.character.snapshot'],
      },
    },
    { assert: { oracle: 'chain.character.exists', eq: true } }, // the refused character survives intact, not bricked
    { checkpoint: 'level_gate_refusal_intact' },
  ],
}
