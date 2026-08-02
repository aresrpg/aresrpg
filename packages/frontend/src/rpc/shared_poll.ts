// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// ONE ticking poll per KEY, shared by every live consumer of that key — factored out of the read-layer
// census fix (#242): several surfaces each ran their OWN useRpcView instance for identical /v1 data (three
// independent /v1/zones pollers, three independent /v1/sponsor/remaining pollers), multiplying the request
// rate for data that is the SAME for every consumer. A shared poll's timer runs iff ≥1 consumer wants that
// key (the listener Set's own size is the refcount — no second counter to drift out of sync) and stops the
// instant the last one releases it, so a poll never outlives every component that asked for it.
//
// React callers get a useRpcView-shaped hook (`{ data, error, loading, stale, refetch }`); non-React
// callers (a plain factory/module, e.g. world_spawns.js) use `subscribe`/`snapshot` directly.

import { useCallback, useEffect, useState } from 'react'

import { RpcError } from './client'

export interface SharedPollView<T> {
  data: T | null
  error: RpcError | null
  loading: boolean
  stale: boolean
}

type Slot<T> = SharedPollView<T> & {
  timer: ReturnType<typeof setInterval>
  listeners: Set<(view: SharedPollView<T>) => void>
}

type SharedPollDeps = {
  set_interval?: (handler: () => void, delay_ms: number) => ReturnType<typeof setInterval>
  clear_interval?: (handle: ReturnType<typeof setInterval>) => void
}

const empty_view = <T>(): SharedPollView<T> => ({ data: null, error: null, loading: false, stale: false })

/**
 * @param fetch_by_key resolves the ONE value for a key — every live subscriber of that key shares its result.
 * @param interval_ms poll cadence.
 */
export function create_shared_poll<T>(
  fetch_by_key: (key: string) => Promise<T>,
  interval_ms: number,
  {
    set_interval = (handler, delay_ms) => globalThis.setInterval(handler, delay_ms),
    clear_interval = (handle) => globalThis.clearInterval(handle),
  }: SharedPollDeps = {}
) {
  const slots = new Map<string, Slot<T>>()

  const view_of = (slot: Slot<T>): SharedPollView<T> => ({
    data: slot.data,
    error: slot.error,
    loading: slot.loading,
    stale: slot.stale,
  })

  function publish(key: string, patch: Partial<SharedPollView<T>>) {
    const slot = slots.get(key)
    if (!slot) return
    Object.assign(slot, patch)
    for (const listener of slot.listeners) listener(view_of(slot))
  }

  async function tick(key: string) {
    const slot = slots.get(key)
    if (!slot) return
    try {
      const data = await fetch_by_key(key)
      if (slots.get(key) !== slot) return // this slot was released + a fresh one started under the same key
      publish(key, { data, error: null, loading: false, stale: false })
    } catch (error) {
      if (slots.get(key) !== slot) return
      const err = error instanceof RpcError ? error : new RpcError('RPC_UNAVAILABLE', 0, (error as Error)?.message)
      publish(key, { error: err, loading: false, stale: slot.data != null })
    }
  }

  function snapshot(key: string): SharedPollView<T> {
    const slot = slots.get(key)
    return slot ? view_of(slot) : empty_view()
  }

  /** Start (or join) the shared poll for `key`; returns the release function. */
  function subscribe(key: string, listener: (view: SharedPollView<T>) => void): () => void {
    let slot = slots.get(key)
    if (!slot) {
      slot = { data: null, error: null, loading: true, stale: false, listeners: new Set() } as Slot<T>
      slot.timer = set_interval(() => void tick(key), interval_ms)
      slots.set(key, slot)
      void tick(key)
    }
    slot.listeners.add(listener)
    listener(view_of(slot))

    let released = false
    return () => {
      if (released) return
      released = true
      const current = slots.get(key)
      if (!current) return
      current.listeners.delete(listener)
      if (current.listeners.size === 0) {
        clear_interval(current.timer)
        slots.delete(key)
      }
    }
  }

  /** Force an out-of-band read now (e.g. the caller's own write just changed the truth). No-op if nobody is subscribed. */
  function refetch(key: string): void {
    if (slots.has(key)) void tick(key)
  }

  /** React hook, useRpcView-shaped. `key` null/undefined idles (mirrors `enabled: !!key`). */
  function useSharedPoll(key: string | null | undefined) {
    const [state, set_state] = useState<SharedPollView<T>>(() => (key ? snapshot(key) : empty_view()))
    useEffect(() => {
      if (!key) {
        set_state(empty_view())
        return undefined
      }
      return subscribe(key, set_state)
    }, [key])
    // Stable across renders (mirrors useRpcView's useCallback-memoized refetch) — callers that depend on it
    // in an effect array (CompassStrip's search-reconcile listener) never re-subscribe on every render.
    const stable_refetch = useCallback(() => {
      if (key) refetch(key)
    }, [key])
    return { ...state, refetch: stable_refetch }
  }

  /** Test-only: force every slot to stop, as if every consumer released it. */
  function _reset_for_test(): void {
    for (const slot of slots.values()) clear_interval(slot.timer)
    slots.clear()
  }

  return { subscribe, snapshot, refetch, useSharedPoll, _reset_for_test }
}
