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

/** The canonical ENTITY ROWS of `fight_visible_view` — identity · cells · vitals · statuses, id-keyed (#1993).
 *  Referentially stable by construction: the view is memoized on the fight state's identity, so this returns the
 *  same frozen object until the store publishes a new state — exactly what useSyncExternalStore requires. */
const fight_visible_entities = () => fight_visible_view(fight_store.getState()).entities

/**
 * React hook: subscribe a component to the canonical fight-visible ENTITY rows. A board position, a vitals
 * number or an identity label answers from HERE — never from a mirrored slice beside it, and never from the
 * legacy projection's presentation-shaped fields (#1993 WP5: `cells.committed` is the gameplay answer,
 * `cells.display_xy` is where the rig is drawn).
 * @returns {ReturnType<typeof fight_visible_view>['entities']}
 */
export function useFightVisibleEntities() {
  return useSyncExternalStore(fight_store.subscribe, fight_visible_entities, fight_visible_entities)
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
