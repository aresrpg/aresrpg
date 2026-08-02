// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// useRpcView — the reactive short-poll reader (SPEC §14 UI-DATA LAW).
//
// THE LAW, enforced here so no surface can break it:
//   • ALL live display data is req/res short-poll — a plain interval GET. NEVER a stream/subscription.
//   • NEVER silently stale — on a failed poll the hook KEEPS the last-good data (no flicker to empty) but
//     raises `stale`/`error`, so the surface renders a visible "reconnecting" chip (see RpcStale.tsx). A stale
//     value shown as if fresh is the failure this hook exists to prevent.
//
// Token/quota discipline: polling PAUSES while the tab is hidden (document.hidden) and fires one immediate
// catch-up fetch on re-show — a backgrounded tab burns zero requests. AbortController cancels any in-flight
// poll on unmount, dep-change, or manual refetch, so a superseded response can never overwrite a newer one.

import { useCallback, useEffect, useRef, useState } from 'react'

import { RpcError } from './client'

export interface RpcViewState<T> {
  data: T | null
  error: RpcError | null
  /** true once a fetch failed while we still hold prior data — the surface must show it's not live. */
  stale: boolean
  /** true only before the FIRST successful (or failed) fetch — drives skeletons, not the stale chip. */
  loading: boolean
  refetch: () => void
}

export interface RpcViewOptions {
  /** poll cadence; default 5000ms to match the api's `cache-control: max-age=5`. */
  interval_ms?: number
  /** gate polling (e.g. until an address is known); default true. When false the hook idles, data stays null. */
  enabled?: boolean
  /** re-subscribe (and reset) when any of these change — the STABLE identity of the query, since `fetcher`
   * is read via a ref and its render-to-render identity is ignored. Analogous to a react-query key. */
  deps?: readonly unknown[]
}

/**
 * Poll `fetcher` on an interval and expose its latest result reactively.
 *
 * @param fetcher receives an AbortSignal — pass it to the rpc client so an unmount cancels the request.
 * @example
 *   const { data, stale } = useRpcView(s => get_pools(undefined, s), { deps: [], interval_ms: 4000 })
 */
export function useRpcView<T>(
  fetcher: (signal: AbortSignal) => Promise<T>,
  { interval_ms = 5000, enabled = true, deps = [] }: RpcViewOptions = {}
): RpcViewState<T> {
  const [data, set_data] = useState<T | null>(null)
  const [error, set_error] = useState<RpcError | null>(null)
  const [loading, set_loading] = useState<boolean>(enabled)

  // Latest closure without re-subscribing the effect (the react-query-less inline-fn pattern).
  const fetcher_ref = useRef(fetcher)
  fetcher_ref.current = fetcher
  // Whether we currently hold data — read inside the poller without adding `data` to the effect deps.
  const has_data_ref = useRef(false)
  has_data_ref.current = data != null
  // Bumped by refetch() to force an immediate out-of-band poll.
  const [tick, set_tick] = useState(0)
  const refetch = useCallback(() => set_tick((t) => t + 1), [])

  useEffect(() => {
    if (!enabled) {
      set_loading(false)
      return
    }

    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let controller: AbortController | undefined

    const run = async () => {
      controller = new AbortController()
      try {
        const result = await fetcher_ref.current(controller.signal)
        if (cancelled) return
        set_data(result)
        set_error(null)
        set_loading(false)
      } catch (e) {
        // An intentional abort (unmount / supersede) is not a failure — drop it silently.
        if (cancelled || (e as Error)?.name === 'AbortError') return
        const err = e instanceof RpcError ? e : new RpcError('RPC_UNAVAILABLE', 0, (e as Error)?.message)
        set_error(err) // keep prior `data` — stale is derived, never blanked (the no-silent-stale contract)
        set_loading(false)
      } finally {
        // Schedule the next poll only while visible; a hidden tab resumes via the visibility handler below.
        if (!cancelled && !document.hidden) timer = setTimeout(run, interval_ms)
      }
    }

    const on_visibility = () => {
      if (document.hidden) {
        clearTimeout(timer)
      } else if (!cancelled) {
        clearTimeout(timer)
        controller?.abort()
        run() // immediate catch-up on re-show, then the interval resumes from run()'s finally
      }
    }
    document.addEventListener('visibilitychange', on_visibility)

    run()

    return () => {
      cancelled = true
      clearTimeout(timer)
      controller?.abort()
      document.removeEventListener('visibilitychange', on_visibility)
    }
    // fetcher is intentionally excluded (read via ref); `deps` is the query identity.
  }, [enabled, interval_ms, tick, ...deps])

  return { data, error, stale: error != null && has_data_ref.current, loading, refetch }
}
