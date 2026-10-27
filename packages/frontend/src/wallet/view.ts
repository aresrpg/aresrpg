// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { env } from '../env.ts'
import type { ExternalWalletState } from '../modules/external_wallet.ts'
import { dispatch_app, read_app_state } from '../store.ts'

import type { WalletView, WalletUiInput } from './model.ts'

const request_selection = (input: WalletUiInput | Readonly<{ type: 'external_wallet/crypto_requested' }>): void => {
  const { session } = read_app_state().external_wallet
  if (session && !session.is_transaction_idle()) return
  dispatch_app(input)
}

export const external_wallet_view = (state: ExternalWalletState): WalletView => ({
  state,
  dispatch: request_selection,
  busy:
    state.request !== null ||
    state.connector_request !== null ||
    (!!state.session && !state.session.is_transaction_idle()),
  ...(env.privy_app_id
    ? {
        connect_other: () => request_selection({ type: 'external_wallet/crypto_requested' }),
      }
    : {}),
})
