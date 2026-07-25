// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//
// ┌──────────────────────────────────────────────────────────────────────────────────────────────────────┐
// │ TEMPORARY SEAM — DELETED AT THE L2 REBASE.                                                           │
// │ Lane L4 (the fight end-to-end) was built in parallel with lane L2, which owns the local chain:        │
// │ `packages/fight/src/sim_chain.js` (docs/design/simulator_rebuild_spec.md §4). That module does not    │
// │ exist in this tree yet, so this file stands in for its import site and NOTHING else.                  │
// │                                                                                                       │
// │ REBASE TODO (two lines, no logic): once `@aresrpg/fight/sim_chain` lands, replace the two throwing     │
// │ stubs below with `export { snapshot_from_sim, encode_sim_step } from '@aresrpg/fight/sim_chain'` and   │
// │ delete the rest of this file. Every L4 consumer imports these names from HERE, so the rebase touches   │
// │ exactly one file. If L2's real API differs, adapt THIS file — never a second implementation.           │
// └──────────────────────────────────────────────────────────────────────────────────────────────────────┘
//
// WHY THESE STUBS THROW RATHER THAN APPROXIMATE. Encoding sim events into the chain's `fight_events`
// vocabulary is L2's whole slice, and it carries the spec's drift gate (§4.4: "one observable, two folders").
// A placeholder encoder here would be a SECOND encoder — the exact drift the twin contract exists to forbid —
// and a plausible-looking one would let a green test lie about a leg that was never built. So the honest
// stand-in is a loud failure: L4's own gates inject their encoder explicitly (the driver takes `encode_step`
// as a parameter for precisely this reason), and any production path that reaches these names before the
// rebase fails immediately and by name instead of silently rendering a fabricated fight.

const MISSING =
  'simulator: @aresrpg/fight/sim_chain is not in this tree yet (lane L2). ' +
  'See packages/frontend/src/simulator/sim_chain_seam.js — the L2 rebase replaces this stub.'

/**
 * L2 · spec §4.3 — the decoded-Fight shape the fight store's snapshot door adopts.
 * @type {(sim_state: any, board: any, roster: any[], mobs: any[]) => any}
 */
export const snapshot_from_sim = () => {
  throw new Error(MISSING)
}

/**
 * L2 · spec §4.4 — sim events + pre/post state → chain rows (`0xsim::fight_events::<Kind>` + parsedJson),
 * the rows the store's receipt door decodes through `normalize_events`.
 * @type {(pre_state: any, post_state: any, sim_events: any[]) => any[]}
 */
export const encode_sim_step = () => {
  throw new Error(MISSING)
}

/** True once L2's real module has replaced the stubs — the page gates START on this so a pre-rebase build
 *  refuses honestly ("local chain not built yet") instead of throwing from inside the fight core. */
export const sim_chain_ready = () => false
