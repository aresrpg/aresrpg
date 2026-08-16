// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// @aresrpg/party — the headless party client core: ONE vanilla-store atom per instance behind ONE
// write door. The reducer (reduce.js / group_loop.js) owns every domain transition; this factory
// binds it to a zustand/vanilla atom whose `input` action IS the door (CODE_LAW L-P4 — async
// continuations may dispatch a door; nothing else ever writes). `dispatch` RETURNS the reducer's
// outputs — it never executes them; effects (PTBs, p2p broadcast, /v1 polling, toasts) live at the
// caller's edge. Edge-owned keys (tx-phase flags, an injected method table) may ride in
// `edge_state`; the reducer spreads state, so they survive every fold untouched.

import { createStore } from 'zustand/vanilla'

import { empty_party_state, reduce } from './reduce.js'
import { empty_group_state, reduce_group } from './group_loop.js'

/** Bind one pure reducer to a vanilla atom; the store's `input` ACTION is the one sanctioned door. */
const bind_reducer_store = (initial_state, fold) => {
  const store = createStore((set, get) => ({
    ...initial_state,
    /** THE domain write door: fold one input through the pure reducer, commit, hand back the outputs. */
    input: (/** @type {any} */ input) => {
      const { state, outputs } = fold(get(), input)
      set(state)
      return outputs
    },
  }))
  return { store, dispatch: (/** @type {any} */ input) => store.getState().input(input) }
}

/**
 * @param {Record<string, any>} [edge_state] edge-owned keys folded into the initial atom
 * @returns {{ store: import('zustand/vanilla').StoreApi<any>, dispatch: (input: any) => any }}
 */
export function create_party_store(edge_state = {}) {
  return bind_reducer_store({ ...empty_party_state(), ...edge_state }, reduce)
}

/**
 * The GROUP LOOP atom — same idiom, second domain (group_loop.js): effects at the caller's edge,
 * edge-owned keys riding the atom untouched.
 * @param {Record<string, any>} [edge_state]
 * @returns {{ store: import('zustand/vanilla').StoreApi<any>, dispatch: (input: any) => any }}
 */
export function create_group_store(edge_state = {}) {
  return bind_reducer_store({ ...empty_group_state(), ...edge_state }, reduce_group)
}
