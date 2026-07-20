// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// @aresrpg/fight — the ONE generic HEADLESS fight core (world · dungeon · kolizeum). One state atom behind one
// input door `input(msg, now)`; three cooperating pure folds (chain log · settlement · presentation); outputs =
// projections + THE BEAT STREAM (`state.wave` rows of beats `{kind, at, duration, payload}`) the renderer plays
// verbatim and acks — it computes nothing (D769 render contract). Context shims live in the frontend and only
// provide the fight id + roster and route settlement — zero fight logic ever lives in a shim.
//
// Import graph is hermetic by law (ares test fightcore gate a + depcruise fight-core-hermetic + the package's
// own hermetic.test.js): this package imports @aresrpg/sim, @aresrpg/sdk and zustand/vanilla — NEVER React,
// three.js, DOM, or any frontend module. Effects (tx submit, toasts, rendering) subscribe at the edges.

export * from './inputs.js'
export * from './store.js'
export * from './present.js'
export * as project from './project.js'
// …and the same projections as top-level named exports (collision-checked against every star export here):
// consumers imported them from fight/project.js directly pre-promotion — one entry point now.
export * from './project.js'
export * from './weapon.js'
export * from './txs.js'
// The absorbed generic organs (the census's wrong-home leaves, promoted 2026-07-17 — M1a):
export * from './board_state.js'
export * from './fight_render_events.js'
export * from './turn_commit.js'
export * from './fight_control.js'
export * from './fight_status_snapshot.js'
export * from './los.js'
export * from './draft_budget.js'
export * from './predict_cast.js'
