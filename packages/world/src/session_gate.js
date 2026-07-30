// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// CHARACTER↔WORLD SESSION GATE. Creation already commits world membership in its mint PTB (#1714), so this
// atom tracks only settled binding truth and the indexer catch-up guard used by manual world switches.

import { createStore } from 'zustand/vanilla'

export const SCENE_SPECTATE = 'spectate'
export const SCENE_SESSION = 'session'

/** @typedef {{ type: 'binding_published', character_id: string|null, world: string|null, source: 'manual'|'poll' }} BindingPublishedInput */
/** @typedef {{ type: 'character_selected', character_id: string, world_id: string|null }} CharacterSelectedInput */
/** @typedef {{ type: 'binding_reset' }} BindingResetInput */
/** @typedef {BindingPublishedInput|CharacterSelectedInput|BindingResetInput} SessionGateInput */
/** @typedef {{ seq: number, character_id: string, target: string|null }} StalePollRow */
/**
 * @typedef {{
 *   character_id: string|null,
 *   world: string|null|undefined,
 *   pending_manual_target: Map<string, string|null>,
 *   stale_poll: StalePollRow|null,
 *   input: (input: SessionGateInput, now?: number) => void
 * }} SessionGateState
 */

/**
 * Stale-poll reconciliation for a chain-truth write followed by an indexer-lagged poll.
 * @param {SessionGateState} state
 * @param {BindingPublishedInput} input
 * @returns {SessionGateState}
 */
function fold_binding_published(state, input) {
  const id = input.character_id ?? null
  const world = input.world ?? null
  if (id && input.source === 'poll' && state.character_id != null && id !== state.character_id)
    return {
      ...state,
      stale_poll: { seq: (state.stale_poll?.seq ?? 0) + 1, character_id: id, target: state.world ?? null },
    }

  let pending = state.pending_manual_target
  if (id && input.source === 'poll' && pending.has(id)) {
    const target = pending.get(id) ?? null
    if (world !== target)
      return { ...state, stale_poll: { seq: (state.stale_poll?.seq ?? 0) + 1, character_id: id, target } }
    pending = new Map(pending)
    pending.delete(id)
  }
  if (id && input.source === 'manual' && (!pending.has(id) || pending.get(id) !== world)) {
    pending = new Map(pending)
    pending.set(id, world)
  }
  if (state.character_id === id && state.world === world && pending === state.pending_manual_target) return state
  return { ...state, character_id: id, world, pending_manual_target: pending }
}

/** @param {SessionGateState} state @param {SessionGateInput} input @returns {SessionGateState} */
export function reduce_session_gate(state, input) {
  switch (input.type) {
    case 'binding_published':
      return fold_binding_published(state, input)
    case 'character_selected':
      return fold_binding_published(state, {
        type: 'binding_published',
        character_id: input.character_id,
        world: input.world_id ?? null,
        source: 'manual',
      })
    case 'binding_reset': {
      const blank =
        state.character_id === null &&
        state.world === undefined &&
        state.pending_manual_target.size === 0 &&
        state.stale_poll === null
      return blank
        ? state
        : {
            ...state,
            character_id: null,
            world: undefined,
            pending_manual_target: new Map(),
            stale_poll: null,
          }
    }
    default:
      return state
  }
}

const make_session_gate_input =
  (set, get) =>
  (input) => {
    const state = get()
    const next = reduce_session_gate(state, input)
    if (next !== state) set(next, true)
  }

/** @returns {import('zustand/vanilla').StoreApi<SessionGateState>} */
export function create_session_gate_store() {
  return createStore((set, get) => ({
    character_id: null,
    world: undefined,
    pending_manual_target: new Map(),
    stale_poll: null,
    input: make_session_gate_input(set, get),
  }))
}

/**
 * Effect edge for discarded stale polls.
 * @param {import('zustand/vanilla').StoreApi<SessionGateState>} store
 * @param {(row: StalePollRow) => void} on_row
 */
export function subscribe_stale_poll(store, on_row) {
  return store.subscribe((state, prev) => {
    if (state.stale_poll && state.stale_poll !== prev.stale_poll) on_row(state.stale_poll)
  })
}

/**
 * @param {{ on_world_tab: boolean, authenticated: boolean, world: string|null|undefined }} args
 * @returns {'spectate' | 'session'}
 */
export function scene_target({ on_world_tab, authenticated, world }) {
  if (!on_world_tab || !authenticated) return SCENE_SPECTATE
  return world === null ? SCENE_SPECTATE : SCENE_SESSION
}

/**
 * @param {{ show_world: boolean, authenticated: boolean, on_world_tab: boolean,
 *   world: string|null|undefined, character_id?: string|null, following?: boolean,
 *   auth_loading?: boolean }} args
 * @returns {{ action: 'hidden'|'await-auth'|'spectate'|'resident'|'session', key: string|null }}
 */
export function plan_scene({
  show_world,
  authenticated,
  on_world_tab,
  world,
  character_id = null,
  following = false,
  auth_loading = false,
}) {
  if (!show_world) return { action: 'hidden', key: null }
  if (!authenticated && auth_loading) return { action: 'await-auth', key: null }
  if (scene_target({ on_world_tab, authenticated, world }) === SCENE_SPECTATE)
    return { action: 'spectate', key: 'spectate' }
  const world_seg = !following && typeof world === 'string' ? `:${world}` : ''
  const key = `${following ? 'follow' : 'lobby'}:${character_id ?? 'none'}${world_seg}`
  return { action: typeof world === 'string' ? 'resident' : 'session', key }
}

/** Post-resolution mount mode: a resolved character with no bound world mounts the spectate backdrop. */
export function resolved_mode(world) {
  return world ? SCENE_SESSION : SCENE_SPECTATE
}
