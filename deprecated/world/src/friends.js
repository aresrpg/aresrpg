// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Friend roster core — one pure reducer and one input door. Optimistic writes carry request-correlated
// pending/confirmed phases; async success/failure and read snapshots reconcile through that same door.

import { createStore } from 'zustand/vanilla'

const initial_state = Object.freeze({
  address: null,
  list_id: null,
  rows: [],
  optimistic_adds: {},
  optimistic_removes: {},
  loading: false,
  loaded: false,
  error: null,
})

const friend_row = (address) => ({
  address,
  name: null,
  class: null,
  level: null,
  jobs: {},
  world: null,
  routes: [],
  zone: null,
  online: false,
})

const for_session = (state, input) => !!state.address && input.address === state.address

function adopt_snapshot(state, input) {
  if (!for_session(state, input)) return state
  const incoming = Array.isArray(input.rows) ? input.rows : []
  const incoming_addresses = new Set(incoming.map((row) => row?.address).filter(Boolean))
  const optimistic_adds = Object.fromEntries(
    Object.entries(state.optimistic_adds).filter(([address]) => !incoming_addresses.has(address))
  )
  const optimistic_removes = Object.fromEntries(
    Object.entries(state.optimistic_removes).filter(([address]) => incoming_addresses.has(address))
  )
  const visible = incoming.filter((row) => row?.address && !optimistic_removes[row.address])
  const visible_addresses = new Set(visible.map((row) => row.address))
  const pending = Object.keys(optimistic_adds)
    .filter((address) => !visible_addresses.has(address))
    .map(friend_row)
  return {
    ...state,
    list_id: input.list_id ?? state.list_id,
    rows: pending.length ? [...visible, ...pending] : visible,
    optimistic_adds,
    optimistic_removes,
    loading: false,
    loaded: true,
    error: null,
  }
}

const start_friend_add = (state, input, now) => {
  if (
    !for_session(state, input) ||
    !input.friend ||
    !input.request_id ||
    state.rows.some((row) => row?.address === input.friend)
  )
    return state
  return {
    ...state,
    rows: [...state.rows, friend_row(input.friend)],
    optimistic_adds: {
      ...state.optimistic_adds,
      [input.friend]: { request_id: input.request_id, phase: 'pending', started_at: now },
    },
    loaded: true,
    error: null,
  }
}

const confirm_friend_add = (state, input, now) => {
  const optimistic = state.optimistic_adds[input.friend]
  if (!for_session(state, input) || !optimistic || optimistic.request_id !== input.request_id) return state
  return {
    ...state,
    list_id: input.list_id ?? state.list_id,
    optimistic_adds: {
      ...state.optimistic_adds,
      [input.friend]: { ...optimistic, phase: 'confirmed', confirmed_at: now },
    },
    error: null,
  }
}

const rollback_friend_add = (state, input) => {
  const optimistic = state.optimistic_adds[input.friend]
  if (!for_session(state, input) || !optimistic || optimistic.request_id !== input.request_id) return state
  const { [input.friend]: _failed, ...optimistic_adds } = state.optimistic_adds
  return {
    ...state,
    rows: state.rows.filter((row) => row?.address !== input.friend),
    optimistic_adds,
  }
}

/**
 * Fold one friend-roster input. Time is supplied by the edge so the reducer stays deterministic.
 * @param {typeof initial_state & Record<string, any>} state
 * @param {Record<string, any>} input
 * @param {number} now
 */
export function reduce_friends(state, input, now) {
  switch (input?.type) {
    case 'session_bound':
      return input.address === state.address
        ? state
        : { ...initial_state, address: input.address ?? null, loaded: !input.address }
    case 'load_started':
      return for_session(state, input) ? { ...state, loading: true, error: null } : state
    case 'load_failed':
      return for_session(state, input)
        ? { ...state, loading: false, loaded: true, error: input.error ?? 'friend roster read failed' }
        : state
    case 'snapshot':
      return adopt_snapshot(state, input)
    case 'friend_list_created':
      return for_session(state, input) && input.list_id ? { ...state, list_id: input.list_id } : state
    case 'friend_add_started':
      return start_friend_add(state, input, now)
    case 'friend_add_succeeded':
      return confirm_friend_add(state, input, now)
    case 'friend_add_failed':
      return rollback_friend_add(state, input)
    // Receipt-confirmed legacy input retained for callers/tests that predate the explicit async lifecycle.
    case 'friend_added': {
      if (!for_session(state, input) || !input.friend) return state
      const rows = state.rows.some((row) => row?.address === input.friend)
        ? state.rows
        : [...state.rows, friend_row(input.friend)]
      const { [input.friend]: _removed, ...optimistic_removes } = state.optimistic_removes
      return {
        ...state,
        list_id: input.list_id ?? state.list_id,
        rows,
        optimistic_adds: {
          ...state.optimistic_adds,
          [input.friend]: { request_id: null, phase: 'confirmed', started_at: now, confirmed_at: now },
        },
        optimistic_removes,
        loaded: true,
        error: null,
      }
    }
    case 'friend_removed': {
      if (!for_session(state, input) || !input.friend) return state
      const { [input.friend]: _added, ...optimistic_adds } = state.optimistic_adds
      return {
        ...state,
        rows: state.rows.filter((row) => row?.address !== input.friend),
        optimistic_adds,
        optimistic_removes: { ...state.optimistic_removes, [input.friend]: now },
        loaded: true,
        error: null,
      }
    }
    default:
      return state
  }
}

/** Create an isolated friend-roster atom. Every effect feeds `state.input`; no outside writer is exposed. */
export function create_friends_store() {
  return createStore((set) => ({
    ...initial_state,
    input: (input, now = Date.now()) => set((state) => reduce_friends(state, input, now)),
  }))
}
