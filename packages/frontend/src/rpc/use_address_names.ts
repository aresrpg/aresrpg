// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// useAddressNames — D52 SuiNS reverse resolution for the frontend, one call per PANEL, never per row.
//
// Unlike the live §14 views (useRpcView's continuous short-poll), SuiNS names change rarely — this is
// a one-shot resolve per distinct address SET, re-running only when that set's membership changes, not
// on an interval. A caller passes the WHOLE list of addresses it currently renders (e.g. every row in a
// panel) so they resolve in ONE /v1/names round trip; get_names' own dedup + rpc_get's LRU (rpc/client.ts)
// absorb re-render bursts and repeat mounts for free — no second cache layer here.
//
// Best-effort by construction: a failed resolve just leaves those addresses unresolved (undefined) — the
// presentational side (components/address_name.tsx) already falls back to the shortened address, so a
// resolver hiccup never blocks or breaks a row.

import { useEffect, useState } from 'react'

import { get_names } from './client'
import type { RpcNames } from './views'

export function useAddressNames(addresses: (string | null | undefined)[]): RpcNames {
  const key = [...new Set(addresses.filter((a): a is string => !!a))].sort().join(',')
  const [names, set_names] = useState<RpcNames>({})

  useEffect(() => {
    if (!key) return
    const controller = new AbortController()
    get_names(key.split(','), controller.signal)
      .then((resolved) => set_names((prev) => ({ ...prev, ...resolved })))
      .catch(() => {}) // best-effort — see file header
    return () => controller.abort()
  }, [key])

  return names
}
