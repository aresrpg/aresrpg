// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { SuiGrpcClient } from '@mysten/sui/grpc'
import type { Wallet, WalletAccount } from '@mysten/wallet-standard'

import { SDK, sui_transport, type Pins, type SdkNetwork } from './client.ts'
import { kares_actions, type KaresActions } from './kares_actions.ts'
import { create_wallet_binding, installed_wallets, on_wallets_changed, selectable_wallet } from './wallet_standard.ts'

export type KaresWalletSession = Readonly<{
  address: string
  wallet_name: string
  kares: KaresActions
  on_invalidated: (listener: () => void) => () => void
  disconnect: () => Promise<void>
  dispose: () => void
}>

/** Finance-only wallet entry: no Enoki registration, game reads, or game action factories. */
export const create_kares_wallet_auth = (options: Readonly<{ network: SdkNetwork; rpc_url?: string; pins?: Pins }>) => {
  const client = new SuiGrpcClient({
    network: options.network,
    baseUrl: options.rpc_url ?? `https://fullnode.${options.network}.sui.io:443`,
  })
  const connect = (wallet: Wallet, account: WalletAccount): KaresWalletSession => {
    const binding = create_wallet_binding(wallet, account, options.network)
    const sdk = SDK({
      client: sui_transport(client),
      address: account.address,
      network: options.network,
      pins: options.pins,
      sign_transaction: binding.sign_transaction,
    })
    return Object.freeze({
      address: account.address,
      wallet_name: wallet.name,
      kares: kares_actions({ sdk, client, address: account.address }),
      dispose: binding.dispose,
      on_invalidated: binding.on_invalidated,
      disconnect: binding.disconnect,
    })
  }
  return Object.freeze({
    wallets: () => installed_wallets().map((wallet) => selectable_wallet(wallet, connect)),
    on_wallets_changed,
  })
}
