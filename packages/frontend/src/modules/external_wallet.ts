// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { AuthSession } from '../auth.ts'
import { browser_auth_storage } from '../auth_storage.ts'
import { env } from '../env.ts'
import type { AppInput, AppModule, AppState } from '../store.ts'
import { initial_wallet_state, reduce_wallet, type WalletInput, type WalletState } from '../wallet/model.ts'
import { observe_wallet } from '../wallet/observer.ts'

export type ExternalWalletState = WalletState<AuthSession>
export type ExternalWalletInput = WalletInput<AuthSession>
export const initial_external_wallet_state = initial_wallet_state<AuthSession>

const reduce = (state: AppState, input: AppInput): AppState => {
  if (!input.type.startsWith('external_wallet/')) return state
  if (
    state.distribution.pending &&
    state.distribution.pending !== 'load' &&
    ['external_wallet/select', 'external_wallet/authorize', 'external_wallet/disconnect'].includes(input.type)
  )
    return state
  const external_wallet = reduce_wallet(state.external_wallet, input as ExternalWalletInput)
  return external_wallet === state.external_wallet ? state : { ...state, external_wallet }
}

const observe: NonNullable<AppModule['observe']> = ({ get_state, dispatch, events, signal }) => {
  observe_wallet(
    {
      get_state: () => get_state().external_wallet,
      dispatch,
      signal,
      subscribe: (listener) =>
        events.on('STATE_UPDATED', (state, previous) => listener(state.external_wallet, previous.external_wallet)),
    },
    {
      network: env.network,
      storage: browser_auth_storage(),
      create_auth: async () => (await import('../auth.ts')).create_external_auth(),
    }
  )
}

export default Object.freeze({ name: 'external_wallet', reduce, observe }) satisfies AppModule
