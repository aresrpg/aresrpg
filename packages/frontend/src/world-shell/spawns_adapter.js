// SPAWNS ADAPTER (D770a W2) — the frontend edge of @aresrpg/world's spawns_zones core: THE one store
// instance, the session_gate → spawns ferry (a bound-world change is a typed RESET input, never a shared
// reference), and the dispatch helper every effect edge uses. The renderer (game/world_spawns.js) syncs its
// rig residency from `spawn_rows` projections and reports `player_pos`; the tx edges (discovery_actions /
// gather_actions / world_spawns' claim executor) dispatch intents and receipts through here.

import { useStore } from 'zustand'
import { create_spawns_store } from '@aresrpg/world'

import { use_world_binding } from './session_gate.js'

/** THE one spawns/zones atom for the app (the package factory owns its shape + door). */
export const spawns_store = create_spawns_store()

/** Dispatch one typed spawns input without exposing store plumbing at call sites. */
export function spawns_input(input, now) {
  spawns_store.getState().input(input, now)
}

/**
 * React binding + imperative statics (the M2 use_party idiom).
 * @type {(<T>(selector: (state: import('@aresrpg/world').SpawnsState) => T) => T) & Pick<import('zustand/vanilla').StoreApi<import('@aresrpg/world').SpawnsState>, 'getState' | 'subscribe'>}
 */
export const use_spawns = Object.assign((selector) => useStore(spawns_store, selector), {
  getState: () => spawns_store.getState(),
  subscribe: (listener) => spawns_store.subscribe(listener),
})

// ── THE SESSION→SPAWNS FERRY — the composition-root seam (design note: cross-domain facts travel as typed
// inputs; a world change is a reset input). The session gate's bound world is the only cross-domain fact the
// spawns core consumes; polling cadence stays the renderer's (polling is an effect — cores never know it).
// Seed once at module init (a binding published before this module loaded would otherwise never ferry), then
// follow every change.
const ferry_world = (world) => spawns_input({ type: 'world_bound', world_id: typeof world === 'string' ? world : null })
ferry_world(use_world_binding.getState().world)
use_world_binding.subscribe((state, prev) => {
  if (state.world !== prev.world) ferry_world(state.world)
})
