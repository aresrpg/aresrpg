// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// CHARACTER↔WORLD SESSION GATE. Creation already commits world membership in its mint PTB (#1714), so this
// atom tracks only settled binding truth and the indexer catch-up guard used by manual world switches.

import { createStore } from 'zustand/vanilla'

export const SCENE_SPECTATE = 'spectate'
export const SCENE_SESSION = 'session'

/** @typedef {{ type: 'binding_published', character_id: string|null, world: string|null, source: 'manual'|'poll' }} BindingPublishedInput */
/** @typedef {{ type: 'roster_observed', rows: Array<{ character_id: string, world: string|null }> }} RosterObservedInput */
/** @typedef {{ type: 'character_selected', character_id: string, world_id: string|null }} CharacterSelectedInput */
/** @typedef {{ type: 'binding_reset' }} BindingResetInput */
/** @typedef {BindingPublishedInput|RosterObservedInput|CharacterSelectedInput|BindingResetInput} SessionGateInput */
/** @typedef {{ seq: number, character_id: string, target: string|null }} StalePollRow */
/** Provenance + freshness per binding: WHICH evidence wrote it, and whether a lagging source has caught up. */
/** @typedef {{ world: string|null, source: 'manual'|'poll'|'roster', confirmed: boolean }} BindingRow */
/**
 * @typedef {{
 *   character_id: string|null,
 *   world: string|null|undefined,
 *   character_world_by_id: Map<string, BindingRow>,
 *   stale_poll: StalePollRow|null,
 *   input: (input: SessionGateInput, now?: number) => void
 * }} SessionGateState
 */

/** THE binding answer for one character: `undefined` = unknown, `null` = confirmed unbound. */
export function select_bound_world(state, character_id) {
  if (!character_id) return undefined
  return state.character_world_by_id.get(character_id)?.world
}

/** Member-roster projection for cross-domain consumers (group follow): unknown reads as unbound, never invented. */
export function select_world_rows(state, character_ids) {
  return (character_ids ?? [])
    .filter(Boolean)
    .map((character_id) => ({ character_id, world_id: select_bound_world(state, character_id) ?? null }))
}

/** Re-derive the selected character's projection from the book — `world` is a VIEW of it, never a second fact. */
const with_book = (state, book) => {
  const world = state.character_id ? book.get(state.character_id)?.world : undefined
  if (book === state.character_world_by_id && world === state.world) return state
  return { ...state, character_world_by_id: book, world }
}

const stale_row = (state, character_id, target) => ({
  ...state,
  stale_poll: { seq: (state.stale_poll?.seq ?? 0) + 1, character_id, target },
})

/**
 * The ONE door every character↔world observation enters — the cached roster feed, the selected character's
 * independent re-read, the doc poll, and a join receipt all reconcile here instead of in four consumers.
 * RECEIPT FLOOR: a 'manual' write (chain truth: the join PTB's receipt, creation's atomic bind, a
 * resolve-time read) arms an unconfirmed row; a lagging observation that DISAGREES with it is discarded
 * until it agrees, and agreement confirms the row.
 * @param {SessionGateState} state
 * @param {{ character_id: string|null, world: string|null, source: 'manual'|'poll'|'roster' }} observation
 * @returns {SessionGateState}
 */
function fold_observation(state, { character_id, world, source }) {
  const id = character_id ?? null
  if (!id) return state
  const previous = state.character_world_by_id.get(id)
  if (previous?.source === 'manual' && !previous.confirmed && source !== 'manual') {
    // #708 — a lagging snapshot must never lower a chain-truth write back to its pre-travel value. A poll
    // discarded this way is the one honest log row; the batched roster feed is a cache by construction.
    if (world !== previous.world)
      return source === 'poll' ? stale_row(state, id, previous.world) : state
    return with_book(state, new Map(state.character_world_by_id).set(id, { ...previous, confirmed: true }))
  }
  const row = { world, source, confirmed: source !== 'manual' }
  if (previous && previous.world === row.world && previous.source === row.source && previous.confirmed === row.confirmed)
    return state
  return with_book(state, new Map(state.character_world_by_id).set(id, row))
}

/** @param {SessionGateState} state @param {SessionGateInput} input @returns {SessionGateState} */
export function reduce_session_gate(state, input) {
  switch (input.type) {
    case 'binding_published': {
      const id = input.character_id ?? null
      // BOOTSTRAP ONLY: an unselected session adopts the first binding it learns. Once a character IS
      // selected, no observation about ANOTHER character re-keys the live session — an owned alt's
      // world-join receipt is a fact about the alt, never a selection (#509's focus-steal class, closed at
      // the fact's own door instead of at each publisher).
      const adopted = id && state.character_id == null ? { ...state, character_id: id } : state
      return fold_observation(adopted, { character_id: id, world: input.world ?? null, source: input.source })
    }
    case 'roster_observed': {
      let next = state
      for (const row of input.rows ?? [])
        next = fold_observation(next, {
          character_id: row?.character_id ?? null,
          world: row?.world ?? null,
          source: 'roster',
        })
      return next
    }
    case 'character_selected': {
      // The card's `world_id` is a CACHED snapshot — it enters as roster-grade evidence, so a reselect can
      // never clobber a fresher chain-truth binding for the same character (the guard every caller used to
      // hand-roll now lives in the book).
      const selected = state.character_id === input.character_id ? state : { ...state, character_id: input.character_id }
      const rekeyed = selected === state ? state : with_book(selected, selected.character_world_by_id)
      return fold_observation(rekeyed, {
        character_id: input.character_id,
        world: input.world_id ?? null,
        source: 'roster',
      })
    }
    case 'binding_reset': {
      const blank =
        state.character_id === null &&
        state.world === undefined &&
        state.character_world_by_id.size === 0 &&
        state.stale_poll === null
      return blank
        ? state
        : {
            ...state,
            character_id: null,
            world: undefined,
            character_world_by_id: new Map(),
            stale_poll: null,
          }
    }
    default:
      return state
  }
}

const make_session_gate_input = (set, get) => (input) => {
  const state = get()
  const next = reduce_session_gate(state, input)
  if (next !== state) set(next, true)
}

/** @returns {import('zustand/vanilla').StoreApi<SessionGateState>} */
export function create_session_gate_store() {
  return createStore((set, get) => ({
    character_id: null,
    world: undefined,
    character_world_by_id: new Map(),
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
