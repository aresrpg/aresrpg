// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { useStore } from 'zustand'
import { useEffect, useMemo } from 'react'

import type { FinanceSession } from './model.ts'
import { create_finance_runtime, type FinanceOptions } from './runtime.ts'

export const useFinance = (options: FinanceOptions, session?: FinanceSession | null) => {
  const runtime = useMemo(
    () =>
      create_finance_runtime(
        {
          network: options.network,
          rpc_url: options.rpc_url,
          managed: options.managed,
        },
        session ?? null
      ),
    [options.network, options.rpc_url, options.managed, session]
  )
  const state = useStore(runtime.store)
  useEffect(() => runtime.start(), [runtime])
  useEffect(() => {
    // eslint-disable-next-line one-pipeline/no-settimeout-in-stores -- This visible-page lifecycle timer dispatches refresh inputs; only chain snapshots own reward time.
    const timer = globalThis.setInterval(() => {
      if (document.visibilityState === 'visible') runtime.dispatch({ type: 'request', request: { kind: 'refresh' } })
    }, 30_000)
    return () => globalThis.clearInterval(timer)
  }, [runtime])
  return { state, dispatch: runtime.dispatch }
}
