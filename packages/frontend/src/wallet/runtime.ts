// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { createStore } from 'zustand/vanilla'

import { initial_wallet_state, reduce_wallet, type WalletInput, type WalletSession } from './model.ts'
import { observe_wallet, type WalletObserverOptions } from './observer.ts'

/** Standalone hosts reuse the same reducer and observer as the application's wallet module. */
export const create_wallet_runtime = <S extends WalletSession>(options: WalletObserverOptions<S>) => {
  const store = createStore(initial_wallet_state<S>)
  const dispatch = (input: WalletInput<S>): void => store.setState((state) => reduce_wallet(state, input), true)
  const start = (): (() => void) => {
    const controller = new AbortController()
    observe_wallet(
      {
        get_state: store.getState,
        dispatch,
        signal: controller.signal,
        subscribe: (listener) => {
          const stop = store.subscribe(listener)
          controller.signal.addEventListener('abort', stop, { once: true })
        },
      },
      options
    )
    return () => {
      controller.abort()
    }
  }
  return { store, dispatch, start }
}

export { browser_auth_storage } from '../auth_storage.ts'
