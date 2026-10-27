// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { browser_auth_storage } from '../auth_storage.ts'
import { env } from '../env.ts'
import type { AppInput, AppModule, AppState } from '../store.ts'
import {
  initial_wallet_state,
  reduce_wallet,
  type WalletInput,
  type WalletState,
  type WalletChoice,
} from '../wallet/model.ts'
import { observe_wallet } from '../wallet/observer.ts'
import { sui_session, type ExternalSession, type CryptoWalletSession } from '../wallet/external_session.ts'

export type ExternalWalletState = WalletState<ExternalSession> &
  Readonly<{
    connector_enabled: boolean
    connector_request: number | null
  }>
export type ExternalWalletInput =
  | WalletInput<ExternalSession>
  | Readonly<{ type: 'external_wallet/crypto_requested' }>
  | Readonly<{ type: 'external_wallet/connector_failed' }>
  | Readonly<{ type: 'external_wallet/crypto_ready'; wallets: readonly WalletChoice<CryptoWalletSession>[] }>
export const initial_external_wallet_state = (): ExternalWalletState => ({
  ...initial_wallet_state<ExternalSession>(),
  connector_enabled: false,
  connector_request: null,
})

const selection_input = (type: string): boolean =>
  [
    'external_wallet/select',
    'external_wallet/authorize',
    'external_wallet/disconnect',
    'external_wallet/forget',
    'external_wallet/crypto_requested',
  ].includes(type)

/** Discovery replaces only its own family; the other connector's authorized choices survive. */
const merge_discovery = (
  state: ExternalWalletState,
  input: Extract<ExternalWalletInput, { wallets: readonly WalletChoice[] }>
): WalletInput<ExternalSession> => {
  const crypto = input.type === 'external_wallet/crypto_ready'
  const wallets = [...input.wallets, ...state.wallets.filter((wallet) => Boolean(wallet.family) !== crypto)]
  return input.type === 'external_wallet/ready'
    ? { ...input, wallets }
    : { type: 'external_wallet/discovered', wallets }
}

const reduce = (state: AppState, event: AppInput): AppState => {
  if (!event.type.startsWith('external_wallet/')) return state
  const input = event as ExternalWalletInput
  const current = state.external_wallet
  if (input.type === 'external_wallet/connector_failed')
    return {
      ...state,
      external_wallet: {
        ...current,
        connector_enabled: false,
        connector_request: null,
        sequence: current.sequence + 1,
        request: null,
        remembered: null,
        session: sui_session(current.session),
        wallets: current.wallets.filter((wallet) => !wallet.family),
        accounts: current.accounts.filter((account) => !account.family),
        error: 'funding_route_unavailable',
      },
    }
  const busy = [state.distribution.pending, current.request, current.connector_request].some(
    (operation) => operation !== null && operation !== 'load'
  )
  if (selection_input(input.type) && busy) return state
  if (input.type === 'external_wallet/crypto_requested')
    return {
      ...state,
      external_wallet: {
        ...current,
        connector_enabled: true,
        remembered: null,
        connector_request: current.sequence + 1,
        sequence: current.sequence + 1,
        error: null,
      },
    }
  const forwarded = 'wallets' in input ? merge_discovery(current, input) : (input as WalletInput<ExternalSession>)
  const next = reduce_wallet(current, forwarded)
  if (next === current) return state
  return {
    ...state,
    external_wallet: {
      ...next,
      connector_enabled: current.connector_enabled || !!next.remembered?.family,
      connector_request: ['external_wallet/connected', 'external_wallet/failed', 'external_wallet/cancel'].includes(
        input.type
      )
        ? null
        : current.connector_request,
    },
  }
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
