// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Friend roster core — one pure reducer and one input door. Confirmed writes create optimistic floors;
// lagging read snapshots reconcile through the same door and cannot erase receipt-proven membership.

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
        optimistic_adds: { ...state.optimistic_adds, [input.friend]: now },
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
