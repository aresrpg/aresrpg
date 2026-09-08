// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { useEffect, useMemo, useSyncExternalStore } from 'react'
import { create_kares_wallet_auth } from '@aresrpg/sdk/kares'
import { create_wallet_runtime, browser_auth_storage } from '@aresrpg/frontend/wallet/runtime'
import { useFinance } from '@aresrpg/frontend/finance/runtime'

import { env } from './env.ts'
import { LaunchView, type LaunchViewProps } from './LaunchView.tsx'

export default function LaunchController(props: Omit<LaunchViewProps, 'state' | 'dispatch' | 'wallet'>) {
  const runtime = useMemo(
    () =>
      create_wallet_runtime({
        network: env.network,
        storage: browser_auth_storage(),
        create_auth: async () => create_kares_wallet_auth({ network: env.network, rpc_url: env.sui_rpc_url }),
      }),
    []
  )
  const wallet_state = useSyncExternalStore(
    runtime.store.subscribe,
    runtime.store.getState,
    runtime.store.getInitialState
  )
  useEffect(() => runtime.start(), [runtime])
  const { state, dispatch } = useFinance({ network: env.network, rpc_url: env.sui_rpc_url }, wallet_state.session)
  return (
    <LaunchView
      {...props}
      dispatch={dispatch}
      state={state}
      wallet={{ state: wallet_state, dispatch: runtime.dispatch }}
    />
  )
}
