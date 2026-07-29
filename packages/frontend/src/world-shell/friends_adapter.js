// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Frontend edge for the friend-roster reducer: one store, one typed input helper, one read reconciler.

import { useStore } from 'zustand'
import { create_friends_store } from '@aresrpg/world/friends'

import { report_error } from '../core/report.js'

import { read_roster } from './friends_reads.js'

export const friends_store = create_friends_store()

export function friends_input(input, now) {
  friends_store.getState().input(input, now)
}

export const use_friends = Object.assign((selector) => useStore(friends_store, selector), {
  getState: () => friends_store.getState(),
  subscribe: (listener) => friends_store.subscribe(listener),
})

/**
 * Read and reconcile one address's roster. Completion always re-enters through the friend input door.
 * @param {string|null|undefined} address @param {AbortSignal} [signal]
 */
export async function refresh_friends(address, signal) {
  friends_input({ type: 'session_bound', address: address ?? null })
  if (!address) return
  friends_input({ type: 'load_started', address })
  try {
    const snapshot = await read_roster(address, signal)
    friends_input({ type: 'snapshot', address, ...snapshot })
  } catch (error) {
    friends_input({
      type: 'load_failed',
      address,
      error: error instanceof Error ? error.message : String(error),
    })
    if (error?.name !== 'AbortError') report_error(error, { area: 'friends', action: 'refresh' })
  }
}
