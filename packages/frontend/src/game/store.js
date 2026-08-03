// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// React ↔ engine binding. The engine (src/core/game.js) is the single source of state; React
// subscribes to its STATE_UPDATED emitter via useSyncExternalStore and renders. React NEVER
// mutates state directly — it dispatches actions / sends packets through the context.

import { useSyncExternalStore } from 'react'

import { fight_view, fight_visible_view } from '@aresrpg/fight/project'
import { fight_store } from '@aresrpg/fight/store'

import { context } from './core/game.js'

/**
 * @param {(state: import('./core/game.js').State) => any} cb
 * @returns {() => void}
 */
const subscribe = cb => {
  context.events.on('STATE_UPDATED', cb)
  return () => context.events.off('STATE_UPDATED', cb)
}

/**
 * Subscribe a component to a slice of engine state. The selector MUST return a value that is
 * referentially stable between updates (the whole state object, or a primitive) — returning a
 * fresh object/array every call will loop. Default returns the whole (stable) state object.
 * @template T
 * @param {(state: import('./core/game.js').State) => T} [selector]
 * @returns {T}
 */
export function useGameState(selector = s => /** @type {any} */ (s)) {
  return useSyncExternalStore(
    subscribe,
    () => selector(context.get_state()),
    () => selector(context.get_state()),
  )
}

// Re-export the engine handle so components dispatch / send / connect without reaching into core.
export { context } from './core/game.js'

/**
 * React hook: subscribe a component to the live FIGHT VIEW (fight/project.js engine_view — null between
 * fights). S2 MIRROR KILL: fight truth has ONE home (fight/store.js) and this is its ONE
 * React binding — synchronous core state, never the deleted async `state.fight` copy. Bound with
 * useSyncExternalStore directly (same shape as useGameState above): the SERVER snapshot reads the SAME
 * live state as the client one — the repo's no-jsdom SSR test harness law — where zustand v5's own hook
 * would pin static renders to getInitialState and render every seeded test empty. Lives HERE (not fight/)
 * so the fight core stays react-free (depcruise fight-core-hermetic, a hard-zero ratchet).
 * @returns {ReturnType<typeof fight_view>}
 */
export function useFightView() {
  return useSyncExternalStore(fight_store.subscribe, fight_view, fight_view)
}

// ── THE CANONICAL DOORS (#1993) ───────────────────────────────────────────────────────────────────────────────
// `fight_visible_view` owns SIX fight-visible facts (turn · entities · result · sync · mount · controls) and this
// file is their ONE React binding. Until this block existed only `entities` had a door, so every surface that
// needed a turn, a result or a mount fact had no canonical way to ask for it and reached for the legacy
// projection (`useFightView`) or the raw core (`useFight`) instead — which is precisely why this file and
// `world/use_fight_phase.js` are the epic's TEMPORARY carve-out (arch_law.yml scope note). One door per record
// closes that gap: a consumer selects the RECORD it means, and the legacy/raw doors become migration debt with a
// visible floor rather than the only road.
//
// Referential stability is by construction, not by comparison: `fight_visible_view` is memoized on the fight
// state's identity (project_views.js VISIBLE_VIEWS) and each record is a frozen sub-object of that view, so a
// reader returns the SAME object until the store publishes a new state — exactly what useSyncExternalStore
// requires. Readers are module-level (never rebuilt per render) for the same reason.
/** @param {'turn'|'entities'|'result'|'sync'|'mount'|'controls'} key */
const record_reader = (key) => () => fight_visible_view(fight_store.getState())[key]

const read_entities = record_reader('entities')
const read_turn = record_reader('turn')
const read_result = record_reader('result')
const read_sync = record_reader('sync')
const read_mount = record_reader('mount')
const read_controls = record_reader('controls')

/**
 * React hook: subscribe a component to the canonical fight-visible ENTITY rows. A board position, a vitals
 * number or an identity label answers from HERE — never from a mirrored slice beside it, and never from the
 * legacy projection's presentation-shaped fields (#1993 WP5: `cells.committed` is the gameplay answer,
 * `cells.display_xy` is where the rig is drawn).
 * @returns {ReturnType<typeof fight_visible_view>['entities']}
 */
export function useFightVisibleEntities() {
  return useSyncExternalStore(fight_store.subscribe, read_entities, read_entities)
}

/**
 * React hook: the canonical TURN record — order, actors, phase, deadlines, the arming door, and the chain's
 * §7 turn-SEED inputs (`turn.seed`). The seed tuple has one home, the decoded Fight (`s.view`); a surface that
 * composes a crit/tackle preview reads it here rather than off the `use_dungeon` mirror of the same fold.
 * @returns {ReturnType<typeof fight_visible_view>['turn']}
 */
export function useFightVisibleTurn() {
  return useSyncExternalStore(fight_store.subscribe, read_turn, read_turn)
}

/**
 * React hook: the canonical RESULT record — the monotonic terminal fact in `result_record.js`'s own vocabulary
 * (kind · winner · run · provenance · conflicts), so the live card and the persistent one read one shape.
 * @returns {ReturnType<typeof fight_visible_view>['result']}
 */
export function useFightVisibleResult() {
  return useSyncExternalStore(fight_store.subscribe, read_result, read_result)
}

/**
 * React hook: the canonical SYNC record — is the board here, does the turn clock resolve to a real fighter, and
 * how far truth has outrun the eye. `actor_unresolved` is the one home for "this turn names nobody yet".
 * @returns {ReturnType<typeof fight_visible_view>['sync']}
 */
export function useFightVisibleSync() {
  return useSyncExternalStore(fight_store.subscribe, read_sync, read_sync)
}

/**
 * React hook: the canonical MOUNT record — fight presence, session scope (`world_active` / `sim_active`, the
 * partition `fight_session_scope.js` spells shell-side), and who the viewer is inside it.
 * @returns {ReturnType<typeof fight_visible_view>['mount']}
 */
export function useFightVisibleMount() {
  return useSyncExternalStore(fight_store.subscribe, read_mount, read_mount)
}

/**
 * React hook: the canonical CONTROLS record — the core's commit flight, the draft count, the END-TURN 3-state,
 * and `min_turn_ready_at` (the min-turn floor as an ABSOLUTE INSTANT; the caller does the `now` subtraction so
 * the view stays pure).
 * @returns {ReturnType<typeof fight_visible_view>['controls']}
 */
export function useFightVisibleControls() {
  return useSyncExternalStore(fight_store.subscribe, read_controls, read_controls)
}

/**
 * React hook: subscribe a component to the RAW fight-core state (the vanilla `fight_store`, promoted to
 * @aresrpg/fight at M1a). The selector must be referentially stable between updates (same law as
 * useGameState above). This is the core's ONE raw React binding — non-React consumers call
 * `fight_store.getState()` directly.
 * @template T
 * @param {(state: any) => T} [selector]
 * @returns {T}
 */
export function useFight(selector = s => /** @type {any} */ (s)) {
  return useSyncExternalStore(
    fight_store.subscribe,
    () => selector(fight_store.getState()),
    () => selector(fight_store.getState()),
  )
}
