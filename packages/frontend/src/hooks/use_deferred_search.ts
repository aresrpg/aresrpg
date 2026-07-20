// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { useEffect, useRef, useState, useDeferredValue } from 'react'
import { useSearchParams } from 'react-router-dom'

/**
 * Shared search-box state for the encyclopedia tabs (the single home for it — items,
 * bestiary and worlds all drive their `?q=` filter through here).
 *
 * Three concerns, decoupled so typing never janks over a 1.8k-row corpus:
 *   - `value`  — the LOCAL input state. Every keystroke updates it synchronously ⇒ the typed characters
 *                are instant, never waiting on a filter or a router round-trip.
 *   - `term`   — a React `useDeferredValue` of `value`: the expensive filter/useMemo keys off THIS, so the
 *                heavy recompute runs in a low-priority pass and the input stays responsive. It settles
 *                once, on the last keystroke.
 *   - `?q=`    — mirrored on a debounce (default 180ms, `replace` so history never spams) for
 *                shareable/back-button state, without thrashing the address bar per character.
 *
 * External `?q=` changes (back/forward, a cleared filter) are adopted back into the input, guarded by the
 * last value WE pushed so an in-flight debounce can never clobber active typing.
 */
export function use_deferred_search(key = 'q', delay = 180) {
  const [params, set_params] = useSearchParams()
  const url_value = params.get(key) ?? ''

  const [value, set_value] = useState(url_value)
  const term = useDeferredValue(value)
  const last_pushed = useRef(url_value)

  // Adopt genuinely-external URL changes (nav / programmatic clear), never our own debounced write-back.
  useEffect(() => {
    if (url_value !== last_pushed.current) {
      last_pushed.current = url_value
      set_value(url_value)
    }
  }, [url_value])

  // Debounced write-through to ?q=.
  useEffect(() => {
    if (value === url_value) return
    const id = setTimeout(() => {
      last_pushed.current = value
      set_params(
        (prev) => {
          const next = new URLSearchParams(prev)
          if (value) next.set(key, value)
          else next.delete(key)
          return next
        },
        { replace: true }
      )
    }, delay)
    return () => clearTimeout(id)
  }, [value, url_value, key, delay, set_params])

  return { value, set_value, term }
}
